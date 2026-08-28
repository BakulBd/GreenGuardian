/**
 * Run (or re-run) the AI evaluation for one submission.
 *
 * Normally nothing calls this by hand: `/api/exams/grade` schedules it with
 * `after()` the moment a submission lands, so evaluation starts on its own.
 * The endpoint exists for the three cases automation cannot cover —
 *
 *   - the student's browser confirming the run actually started (the server
 *     process can be torn down before a scheduled task finishes on some hosts);
 *   - a teacher re-running an evaluation after a `failed` / `needs_review`;
 *   - a teacher forcing a fresh evaluation after replacing the question paper.
 *
 * A student may only trigger their own submission and may never force a
 * re-run: re-rolling the dice until the marks come out better is not a feature.
 *
 * GET returns the current evaluation state, so the student's result screen can
 * show "AI Evaluation Processing…" and then the mark without granting anyone
 * extra read access to the answer document.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { runAiEvaluation } from "@/lib/server/ai-evaluation-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * A vision pass over a multi-page handwritten script is slow. The default
 * serverless timeout cuts it off mid-call, which shows up as an evaluation
 * stuck in `processing` until the claim expires.
 */
export const maxDuration = 300;

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Whether `auth` may act on this submission at all. */
async function authorize(
  db: FirebaseFirestore.Firestore,
  answerId: string,
  auth: { uid: string; role: string }
): Promise<{ ok: true; answer: Record<string, any> } | { ok: false; response: NextResponse }> {
  const snap = await db.collection("answers").doc(answerId).get();
  if (!snap.exists) return { ok: false, response: jsonError("Submission not found.", 404) };

  const answer = snap.data() || {};

  if (auth.role === "student") {
    if (answer.studentId !== auth.uid) {
      return { ok: false, response: jsonError("This submission does not belong to you.", 403) };
    }
    return { ok: true, answer };
  }

  if (auth.role === "teacher") {
    const examId = String(answer.examId || "");
    const exam = examId ? (await db.collection("exams").doc(examId).get()).data() || {} : {};
    const owns = exam.teacherId === auth.uid || exam.createdBy === auth.uid;
    if (!owns) {
      return { ok: false, response: jsonError("You do not have access to this submission.", 403) };
    }
  }

  return { ok: true, answer };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const rate = checkRateLimit(
      `ai-evaluate:${auth.uid}:${getClientIp(req)}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many evaluation requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return jsonError("Invalid request body.", 400);

    const answerId = String(body.answerId || "").trim();
    if (!answerId) return jsonError("answerId is required.", 400);

    const db = getAdminDb();
    const access = await authorize(db, answerId, auth);
    if (!access.ok) return access.response;

    // Only staff may re-run a finished evaluation.
    const force = body.force === true && (auth.role === "teacher" || auth.role === "admin");

    const outcome = await runAiEvaluation({
      db,
      answerId,
      force,
      triggeredBy: `${auth.role}:${auth.uid}`,
    });

    return NextResponse.json({
      success: outcome.status !== "failed",
      answerId,
      status: outcome.status,
      reason: outcome.reason,
      aiEvaluation: outcome.aiEvaluation ?? null,
    });
  } catch (error: any) {
    console.error("API /api/exams/ai-evaluate error:", error);
    return jsonError(error?.message || "Could not run the AI evaluation.", 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const answerId = String(req.nextUrl.searchParams.get("answerId") || "").trim();
    if (!answerId) return jsonError("answerId is required.", 400);

    const db = getAdminDb();
    const access = await authorize(db, answerId, auth);
    if (!access.ok) return access.response;

    const answer = access.answer;
    const evaluation = answer.aiEvaluation || null;

    return NextResponse.json({
      success: true,
      answerId,
      status: evaluation?.status ?? "none",
      error: evaluation?.error ?? null,
      finalMarks: answer.finalMarks ?? answer.score ?? null,
      totalMarks: answer.finalTotalMarks ?? answer.totalMarks ?? null,
      percentage: answer.finalPercentage ?? answer.accuracy ?? null,
      finalMarksSource: answer.finalMarksSource ?? null,
      aiTotalMarks: evaluation?.totalMarks ?? null,
      aiMaxMarks: evaluation?.maxMarks ?? null,
      // Authorship is an integrity signal about the student, not a grade —
      // staff-only, exactly like the plagiarism report.
      authorship:
        auth.role === "teacher" || auth.role === "admin" ? answer.authorship ?? null : null,
    });
  } catch (error: any) {
    console.error("API /api/exams/ai-evaluate GET error:", error);
    return jsonError(error?.message || "Could not read the evaluation status.", 500);
  }
}
