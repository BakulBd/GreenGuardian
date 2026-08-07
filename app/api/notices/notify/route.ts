import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { sendBulkEmails } from "@/lib/email/notifyRecipients";
import { renderNotificationEmail } from "@/lib/email/templates/notification";
import { FieldValue } from "firebase-admin/firestore";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

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
 * Emails every targeted student when a teacher publishes a notice.
 * `lib/firebase/notices.ts#publishNoticeWithNotifications` already writes
 * the in-app `notifications` docs — this route only adds the email leg,
 * mirroring /api/exams/notify and /api/classroom/notify.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser(req);
    if (authResult instanceof NextResponse) return authResult;

    const rate = checkRateLimit(`notice-notify:${authResult.uid}:${getClientIp(req)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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
    const { noticeId, studentIds } = body as { noticeId?: string; studentIds?: string[] };
    if (!noticeId || typeof noticeId !== "string" || !Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ success: false, error: "noticeId and a non-empty studentIds array are required." }, { status: 400 });
    }

    const db = getAdminDb();

    const noticeSnap = await db.collection("notices").doc(noticeId).get();
    if (!noticeSnap.exists) {
      return NextResponse.json({ success: false, error: "Notice not found." }, { status: 404 });
    }
    const notice = noticeSnap.data()!;

    const requesterSnap = await db.collection("users").doc(authResult.uid).get();
    const requesterRole = requesterSnap.data()?.role;
    if (notice.teacherId !== authResult.uid && requesterRole !== "admin") {
      return NextResponse.json({ success: false, error: "You do not own this notice." }, { status: 403 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host") || "localhost:3000"}`;
    const noticeUrl = `${appUrl}/dashboard/student/notices`;

    const recipients: { id: string; email: string; name: string }[] = [];
    for (const studentId of studentIds.slice(0, 500)) {
      const studentSnap = await db.collection("users").doc(studentId).get();
      const student = studentSnap.data();
      if (student?.email) {
        recipients.push({ id: studentId, email: student.email, name: student.name || "Student" });
      }
    }

    const { sent, failed } = await sendBulkEmails(
      recipients,
      (recipient) => ({
        subject: `New Notice: ${notice.title}`,
        html: renderNotificationEmail({
          studentName: recipient.name,
          teacherName: notice.teacherName || "Your teacher",
          kindLabel: "Notice",
          title: notice.title,
          detail: notice.description ? String(notice.description).slice(0, 120) : undefined,
          actionUrl: noticeUrl,
          actionLabel: "View Notice",
        }),
      }),
      async (recipient, result) => {
        await db.collection("emailLogs").add({
          kind: "notice",
          noticeId,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          status: result.ok ? "sent" : "failed",
          error: result.ok ? null : result.error || null,
          attempts: result.attempts,
          timestamp: FieldValue.serverTimestamp(),
        });
      }
    );

    return NextResponse.json({ success: true, sent, failed, total: recipients.length });
  } catch (error: any) {
    console.error("API /api/notices/notify error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error." }, { status: 500 });
  }
}
