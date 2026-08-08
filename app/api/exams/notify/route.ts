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
 * Emails + in-app-notifies every targeted student when a teacher publishes
 * an exam. Mirrors /api/classroom/notify's shape but for the standalone Exam
 * module (which has no classroomMembers row to denormalize an email from —
 * recipient emails are re-read from `users/{id}` here, server-side, so a
 * stale client-supplied address is never trusted).
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser(req);
    if (authResult instanceof NextResponse) return authResult;

    const rate = checkRateLimit(`exam-notify:${authResult.uid}:${getClientIp(req)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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
    const { examId, studentIds } = body as { examId?: string; studentIds?: string[] };
    if (!examId || typeof examId !== "string" || !Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ success: false, error: "examId and a non-empty studentIds array are required." }, { status: 400 });
    }

    const db = getAdminDb();

    const examSnap = await db.collection("exams").doc(examId).get();
    if (!examSnap.exists) {
      return NextResponse.json({ success: false, error: "Exam not found." }, { status: 404 });
    }
    const exam = examSnap.data()!;

    const requesterSnap = await db.collection("users").doc(authResult.uid).get();
    const requesterRole = requesterSnap.data()?.role;
    if (exam.teacherId !== authResult.uid && requesterRole !== "admin") {
      return NextResponse.json({ success: false, error: "You do not own this exam." }, { status: 403 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host") || "localhost:3000"}`;
    const examUrl = `${appUrl}/exam/${examId}`;

    const recipients: { id: string; email: string; name: string }[] = [];
    for (const studentId of studentIds.slice(0, 500)) {
      const studentSnap = await db.collection("users").doc(studentId).get();
      const student = studentSnap.data();
      if (student?.email) {
        recipients.push({ id: studentId, email: student.email, name: student.name || "Student" });
      }
    }

    const notifBatch = db.batch();
    for (const recipient of recipients) {
      const notifRef = db.collection("notifications").doc();
      notifBatch.set(notifRef, {
        userId: recipient.id,
        type: "exam",
        title: `New Exam: ${exam.title}`,
        message: `${exam.teacherName || "Your teacher"} published a new exam.`,
        examId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await notifBatch.commit();

    const { sent, failed } = await sendBulkEmails(
      recipients,
      (recipient) => ({
        subject: `New Exam: ${exam.title}`,
        html: renderNotificationEmail({
          studentName: recipient.name,
          teacherName: exam.teacherName || "Your teacher",
          kindLabel: "Exam",
          title: exam.title,
          detail: `${exam.duration} min · ${exam.totalMarks} marks`,
          actionUrl: examUrl,
          actionLabel: "View Exam",
        }),
      }),
      async (recipient, result) => {
        await db.collection("emailLogs").add({
          kind: "exam",
          examId,
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
    console.error("API /api/exams/notify error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error." }, { status: 500 });
  }
}
