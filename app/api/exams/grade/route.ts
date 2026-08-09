/**
 * Authoritative exam submission + grading.
 *
 * Before this route existed, `ExamClient.handleSubmit()` computed the score in
 * the browser and wrote it straight into `answers` and `examSessions`. Two
 * things followed from that: the browser needed the answer key to do the maths
 * (so every student could read it), and nothing stopped a student from simply
 * writing `score: 100`. Firestore rules cannot check a score — verifying one
 * means reading the answer key, which rules must not expose.
 *
 * So the trust boundary moved here. The client sends what only it can know
 * (the answers the student picked, and the proctoring signals its own sensors
 * produced); the server owns everything derived from the answer key. The
 * matching `firestore.rules` change blocks students from writing any scoring
 * field themselves.
 *
 * The route is idempotent: the answer document id **is** the session id, so a
 * retry after a dropped response updates the same document instead of
 * creating a duplicate submission.
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import {
  gradeSubmission,
  sanitizeAnswerFiles,
  type GradableQuestion,
} from "@/lib/server/grading";
import { loadExamQuestions } from "@/lib/server/exam-questions";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Ceiling on a single submission payload, well above any real answer set. */
const MAX_ANSWER_CHARS = 500_000;

const VIOLATION_KEYS = [
  "tabSwitch",
  "faceNotDetected",
  "multipleFaces",
  "phoneDetected",
  "fullscreenExit",
  "copyPaste",
  "rightClick",
  "windowBlur",
  "other",
] as const;

/** Keep only the violation counters we recognise, as non-negative integers. */
function sanitizeViolationCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(VIOLATION_KEYS as readonly string[]).includes(key)) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
  }
  return out;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req, ["student"]);
    if (auth instanceof NextResponse) return auth;

    const rate = checkRateLimit(
      `grade:${auth.uid}:${getClientIp(req)}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many submission attempts. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonError("Invalid request body.", 400);
    }

    const {
      sessionId,
      answers: rawAnswers,
      answerFiles: rawAnswerFiles,
      behaviorScore: rawBehaviorScore,
      warnings: rawWarnings,
      violationCounts: rawViolationCounts,
      autoSubmitted,
      reason,
    } = body as Record<string, any>;

    if (!sessionId || typeof sessionId !== "string") {
      return jsonError("sessionId is required.", 400);
    }

    const answers: Record<string, string> = {};
    if (rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)) {
      let total = 0;
      for (const [key, value] of Object.entries(rawAnswers as Record<string, unknown>)) {
        const text = typeof value === "string" ? value : String(value ?? "");
        total += text.length;
        if (total > MAX_ANSWER_CHARS) {
          return jsonError("Submission is too large to process.", 413);
        }
        answers[key] = text;
      }
    }

    const answerFiles = sanitizeAnswerFiles(rawAnswerFiles);

    const db = getAdminDb();
    const sessionRef = db.collection("examSessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return jsonError("Exam session not found.", 404);

    const session = sessionSnap.data() || {};
    if (session.studentId !== auth.uid) {
      return jsonError("This exam session does not belong to you.", 403);
    }

    const examId = String(session.examId || "");
    if (!examId) return jsonError("This exam session has no exam attached.", 422);

    const examSnap = await db.collection("exams").doc(examId).get();
    if (!examSnap.exists) return jsonError("Exam not found.", 404);
    const exam = examSnap.data() || {};

    const answerRef = db.collection("answers").doc(sessionId);

    // A submitted session is terminal. Returning the stored result (rather
    // than 409) keeps a retried request harmless: the student's browser gets
    // the same confirmation it would have got the first time.
    const alreadySubmitted =
      session.submitted === true ||
      session.status === "submitted" ||
      session.status === "auto-submitted";

    if (alreadySubmitted) {
      const existing = await answerRef.get();
      return NextResponse.json({
        success: true,
        alreadySubmitted: true,
        answerId: existing.exists ? answerRef.id : null,
        grading: existing.exists ? existing.data()?.grading ?? null : null,
      });
    }

    const isUploadMode = exam.examMode === "upload";
    const questions = isUploadMode
      ? []
      : ((await loadExamQuestions(db, examId, exam)) as GradableQuestion[]);

    const grading = isUploadMode ? null : gradeSubmission(questions, answers);

    const behaviorScore = clampNumber(rawBehaviorScore, 0, 100, 100);
    const warnings = clampNumber(rawWarnings, 0, 1000, 0);
    const violationCounts = sanitizeViolationCounts(rawViolationCounts);
    const flagged = behaviorScore < 50;
    const auto = autoSubmitted === true;
    const sessionStatus = auto ? "auto-submitted" : "submitted";

    // Academic identity is re-read from the server's own documents. The client
    // used to supply these alongside the score, which meant a submission could
    // be filed under a different course/section than the one it belongs to.
    const answerData: Record<string, any> = {
      sessionId,
      examSessionId: sessionId,
      examId,
      examTitle: exam.title || "",
      studentId: auth.uid,
      studentName: auth.name,
      studentCode: auth.studentCode,
      studentEmail: auth.email,
      courseId: exam.courseId || "",
      courseName: exam.courseName || "",
      batch: exam.batch || auth.data.batch || "",
      section: exam.section || auth.data.section || "",
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      autoSubmitted: auto,
      behaviorScore,
      warningCount: warnings,
      flagged,
      flagReasons: flagged ? ["Poor behavior score"] : [],
      violationCounts,
      gradedBy: "server",
      ...(reason && typeof reason === "string" ? { reason: reason.slice(0, 500) } : {}),
    };

    if (isUploadMode) {
      answerData.answerFiles = answerFiles;
      answerData.ocrStatus = "pending_background";
    } else {
      answerData.answers = answers;
      // Snapshot the graded question set — answer keys included — onto the
      // submission so /exam/[id]/review renders from this document alone. The
      // key is safe to expose here: the attempt is over, and it keeps a past
      // result readable after the teacher archives or edits the exam.
      answerData.questionSnapshot = questions;
      answerData.score = grading!.obtainedMarks;
      answerData.totalMarks = grading!.totalMarks;
      answerData.accuracy = grading!.accuracy;
      answerData.grading = grading;
    }

    const sessionUpdate: Record<string, any> = {
      status: sessionStatus,
      submitted: true,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      studentName: auth.name,
      studentCode: auth.studentCode,
      courseId: exam.courseId || "",
      courseName: exam.courseName || "",
      batch: exam.batch || auth.data.batch || "",
      section: exam.section || auth.data.section || "",
      examTitle: exam.title || "",
      warnings,
      behaviorScore,
      violationCounts,
      autoSubmitted: auto,
      "proctoring.suspiciousEvents": warnings,
      flagged,
      flagReasons: flagged ? ["Poor behavior score"] : [],
    };

    if (grading) {
      Object.assign(sessionUpdate, {
        correctAnswers: grading.correctAnswers,
        wrongAnswers: grading.wrongAnswers,
        attemptedAnswers: grading.attemptedAnswers,
        totalQuestions: grading.totalQuestions,
        accuracy: grading.accuracy,
        score: grading.obtainedMarks,
        totalMarks: grading.totalMarks,
      });
    }

    // One batch so a submission can never be half-recorded: either the answer
    // exists and the session is closed, or neither happened and the student's
    // client retries.
    const batch = db.batch();
    batch.set(answerRef, answerData, { merge: true });
    batch.update(sessionRef, sessionUpdate);
    await batch.commit();

    return NextResponse.json({
      success: true,
      answerId: answerRef.id,
      grading,
    });
  } catch (error: any) {
    console.error("API /api/exams/grade error:", error);
    return jsonError(error?.message || "Failed to record the submission.", 500);
  }
}
