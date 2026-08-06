import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/send";
import { renderClassroomPostEmail } from "@/lib/email/templates/classroomPost";
import { FieldValue } from "firebase-admin/firestore";

/** Per-recipient retry attempts before giving up and logging a failure. */
const MAX_EMAIL_ATTEMPTS = 3;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const POST_TYPE_LABELS: Record<string, string> = {
  announcement: "Announcement",
  notice: "Notice",
  material: "Material",
};

const CLASSWORK_TYPE_LABELS: Record<string, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  material: "Study Material",
  resource: "Resource",
  link: "External Link",
};

async function requireUser(req: NextRequest): Promise<{ uid: string } | NextResponse> {
  const header = req.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }
  if (!isAdminSdkConfigured()) {
    return NextResponse.json(
      { success: false, error: "Server auth is not configured. Set FIREBASE_SERVICE_ACCOUNT so notifications can be sent." },
      { status: 503 }
    );
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid or expired session. Please sign in again." }, { status: 401 });
  }
}

/**
 * Fans a classroom post/classwork item out to email + in-app notifications.
 *
 * Recipients are the intersection of "joined this classroom" and
 * "currently assigned to this classroom's teacher" — re-checked here (not
 * just trusted from membership at join time) so that an admin revoking a
 * teacher assignment after a student joined stops further notifications
 * immediately, closing the loop on Task 10 / Feature 6's "no leakage"
 * requirement. Runs synchronously server-side (with per-recipient retry) so
 * the caller gets one reliable result; the client calls this without
 * awaiting it, which is what makes it "asynchronous" from the user's
 * perspective without needing a job queue this app has no infrastructure for.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser(req);
    if (authResult instanceof NextResponse) return authResult;

    const rate = checkRateLimit(`classroom-notify:${authResult.uid}:${getClientIp(req)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many notification requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
    }
    const { classroomId, postId, classworkId, kind } = body as Record<string, any>;
    if (!classroomId || typeof classroomId !== "string" || (kind !== "post" && kind !== "classwork")) {
      return NextResponse.json({ success: false, error: "classroomId and a valid kind are required." }, { status: 400 });
    }
    if (kind === "post" && !postId) {
      return NextResponse.json({ success: false, error: "postId is required for kind=post." }, { status: 400 });
    }
    if (kind === "classwork" && !classworkId) {
      return NextResponse.json({ success: false, error: "classworkId is required for kind=classwork." }, { status: 400 });
    }

    const db = getAdminDb();

    const classroomSnap = await db.collection("classrooms").doc(classroomId).get();
    if (!classroomSnap.exists) {
      return NextResponse.json({ success: false, error: "Classroom not found." }, { status: 404 });
    }
    const classroom = classroomSnap.data()!;

    // Only the classroom's own teacher (or an admin) may trigger notifications for it.
    const requesterSnap = await db.collection("users").doc(authResult.uid).get();
    const requesterRole = requesterSnap.data()?.role;
    if (classroom.teacherId !== authResult.uid && requesterRole !== "admin") {
      return NextResponse.json({ success: false, error: "You do not own this classroom." }, { status: 403 });
    }

    let title = "";
    let postTypeLabel = "";

    if (kind === "post") {
      const postSnap = await db.collection("classroomPosts").doc(postId).get();
      if (!postSnap.exists) return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
      const post = postSnap.data()!;
      title = post.title || String(post.content || "").slice(0, 80);
      postTypeLabel = POST_TYPE_LABELS[post.type] || "Post";
    } else {
      const cwSnap = await db.collection("classroomClasswork").doc(classworkId).get();
      if (!cwSnap.exists) return NextResponse.json({ success: false, error: "Classwork item not found." }, { status: 404 });
      const cw = cwSnap.data()!;
      title = cw.title;
      postTypeLabel = CLASSWORK_TYPE_LABELS[cw.type] || "Classwork";
    }

    const membersSnap = await db.collection("classroomMembers").where("classroomId", "==", classroomId).get();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host") || "localhost:3000"}`;
    const classroomUrl = `${appUrl}/dashboard/student/classrooms/${classroomId}`;

    const notifBatch = db.batch();
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const memberDoc of membersSnap.docs) {
      const member = memberDoc.data();
      const studentSnap = await db.collection("users").doc(member.studentId).get();
      const student = studentSnap.data();
      const assignedTeacherIds: string[] = student?.assignedTeacherIds || [];

      // Re-check current assignment — a student who left the teacher's
      // roster since joining must not keep receiving notifications.
      if (!assignedTeacherIds.includes(classroom.teacherId)) {
        skipped++;
        continue;
      }

      const notifRef = db.collection("notifications").doc();
      notifBatch.set(notifRef, {
        userId: member.studentId,
        type: "classroom",
        title: `New ${postTypeLabel} in ${classroom.name}`,
        message: title,
        classroomId,
        classroomPostId: postId || classworkId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      let attempts = 0;
      let ok = false;
      let lastError = "";
      while (attempts < MAX_EMAIL_ATTEMPTS && !ok) {
        attempts++;
        const html = renderClassroomPostEmail({
          studentName: member.studentName || "Student",
          teacherName: classroom.teacherName,
          classroomName: classroom.name,
          postTypeLabel,
          title,
          classroomUrl,
        });
        const result = await sendEmail({
          to: member.studentEmail,
          subject: `New ${postTypeLabel}: ${title}`,
          html,
        });
        if (result.ok) {
          ok = true;
        } else {
          lastError = result.error;
          if (attempts < MAX_EMAIL_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, attempts * 500));
          }
        }
      }

      await db.collection("classroomEmailLogs").add({
        classroomId,
        postId: postId || null,
        classworkId: classworkId || null,
        recipientId: member.studentId,
        recipientEmail: member.studentEmail,
        status: ok ? "sent" : "failed",
        error: ok ? null : lastError,
        attempts,
        timestamp: FieldValue.serverTimestamp(),
      });

      if (ok) sent++;
      else failed++;
    }

    await notifBatch.commit();

    return NextResponse.json({ success: true, sent, failed, skipped, total: membersSnap.size });
  } catch (error: any) {
    console.error("API /api/classroom/notify error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error." }, { status: 500 });
  }
}
