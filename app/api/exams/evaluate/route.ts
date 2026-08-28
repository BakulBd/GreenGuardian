/**
 * Teacher/admin override of a submission's mark.
 *
 * The AI evaluation (`/api/exams/ai-evaluate`) produces a mark automatically.
 * This route lets a teacher disagree with it — overall, or question by
 * question — and it is the teacher's number the student then sees.
 *
 * The override is written to its own `teacherOverride` field. It NEVER writes
 * into `aiEvaluation`, so the original AI marks, per-question reasoning and
 * authorship estimate survive the override in full and remain auditable:
 *
 *     aiEvaluation.totalMarks = 78     (untouched, forever)
 *     teacherOverride.marks   = 84
 *     finalMarks              = 84     (derived — what the student sees)
 *
 * Remove the override and `finalMarks` falls back to the AI mark on its own,
 * because it is derived rather than stored twice (see `lib/server/final-marks.ts`).
 *
 * The write happens here rather than in the browser so that the answer
 * document, the exam session and the student's published result cannot drift
 * apart, and so ownership is enforced with the Admin SDK rather than trusted
 * from the client.
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { clampMarks } from "@/lib/server/ai-evaluation";
import {
  answerFinalMarksPatch,
  computeAnswerFinalMarks,
  sessionFinalMarksPatch,
} from "@/lib/server/final-marks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FEEDBACK_LENGTH = 5000;
const MAX_QUESTION_OVERRIDES = 200;

interface QuestionOverride {
  questionId: string;
  marks: number;
  feedback: string;
}

/**
 * Normalise per-question overrides against the AI evaluation's question set.
 *
 * Each entry is clamped to that question's own maximum, so a teacher cannot
 * award 12 on a 10-mark question any more than the model can. Unknown question
 * ids are rejected rather than silently dropped — a typo that quietly loses
 * marks is worse than an error message.
 */
function normalizeQuestionOverrides(
  raw: unknown,
  aiQuestions: Array<{ questionId: string; maxMarks: number }>
): { ok: true; overrides: QuestionOverride[]; total: number } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "questionMarks must be an array." };
  if (raw.length > MAX_QUESTION_OVERRIDES) {
    return { ok: false, error: "Too many question overrides in one request." };
  }
  if (aiQuestions.length === 0) {
    return {
      ok: false,
      error: "This submission has no question-wise AI evaluation to override. Enter an overall mark instead.",
    };
  }

  const maxById = new Map(aiQuestions.map((q) => [q.questionId, Number(q.maxMarks) || 0]));
  const overrides: QuestionOverride[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const questionId = String(record.questionId ?? "").trim();
    if (!questionId || !maxById.has(questionId)) {
      return { ok: false, error: `Unknown question in the override: "${questionId}".` };
    }
    const marks = Number(record.marks);
    if (!Number.isFinite(marks) || marks < 0) {
      return { ok: false, error: `Enter a mark of zero or more for question "${questionId}".` };
    }
    const max = maxById.get(questionId)!;
    if (marks > max) {
      return { ok: false, error: `Question "${questionId}" is worth ${max} marks — ${marks} is too high.` };
    }
    overrides.push({
      questionId,
      marks: clampMarks(marks, max),
      feedback: String(record.feedback ?? "").slice(0, MAX_FEEDBACK_LENGTH),
    });
  }

  if (overrides.length === 0) {
    return { ok: false, error: "No usable question marks were supplied." };
  }

  // Questions the teacher did not touch keep the AI's mark, so a partial
  // override does not silently zero the rest of the paper.
  const overrideById = new Map(overrides.map((o) => [o.questionId, o.marks]));
  const total = aiQuestions.reduce((sum, q) => {
    const overridden = overrideById.get(q.questionId);
    return sum + (overridden !== undefined ? overridden : 0);
  }, 0);

  return { ok: true, overrides, total: Math.round(total * 100) / 100 };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req, ["teacher", "admin"], "evaluate exam submissions");
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return jsonError("Invalid request body.", 400);

    const answerId = String(body.answerId || "").trim();
    if (!answerId) return jsonError("answerId is required.", 400);

    const db = getAdminDb();
    const answerRef = db.collection("answers").doc(answerId);
    const answerSnap = await answerRef.get();
    if (!answerSnap.exists) return jsonError("Submission not found.", 404);

    const answer = answerSnap.data() || {};
    const examId = String(answer.examId || "");

    // Ownership: a teacher may only mark submissions for their own exams.
    // Reading the exam rather than trusting a field on the submission is what
    // stops one teacher marking another's paper.
    let exam: Record<string, any> = {};
    if (examId) {
      const examSnap = await db.collection("exams").doc(examId).get();
      exam = examSnap.data() || {};
    }
    if (auth.role === "teacher") {
      const owns = exam.teacherId === auth.uid || exam.createdBy === auth.uid;
      if (!owns) return jsonError("You do not have access to this submission.", 403);
    }

    const aiEvaluation = (answer.aiEvaluation || null) as Record<string, any> | null;
    const aiQuestions: Array<{ questionId: string; maxMarks: number }> = Array.isArray(
      aiEvaluation?.questions
    )
      ? aiEvaluation!.questions.map((q: any) => ({
          questionId: String(q.questionId ?? ""),
          maxMarks: Number(q.maxMarks) || 0,
        }))
      : [];

    const totalMarks = Number(
      body.totalMarks ??
        aiEvaluation?.maxMarks ??
        answer.grading?.totalMarks ??
        answer.totalMarks ??
        exam.totalMarks ??
        100
    );
    if (!Number.isFinite(totalMarks) || totalMarks <= 0) {
      return jsonError("This exam has no valid total marks to grade against.", 400);
    }

    // Clearing an override hands the mark back to the AI evaluation. This is
    // the only supported way to "undo" a teacher mark, and it works because
    // `finalMarks` is derived rather than stored in two places.
    if (body.clearOverride === true) {
      const final = computeAnswerFinalMarks(
        {
          grading: answer.grading,
          aiEvaluation,
          teacherOverride: null,
          totalMarks: answer.totalMarks,
        },
        Number(exam.totalMarks)
      );

      const batch = db.batch();
      batch.update(answerRef, {
        teacherOverride: FieldValue.delete(),
        evaluation: FieldValue.delete(),
        gradedBy: aiEvaluation ? "ai" : "server",
        ...answerFinalMarksPatch(final),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const sessionIdForClear = String(answer.sessionId || answer.examSessionId || "");
      if (sessionIdForClear) {
        const sessionRef = db.collection("examSessions").doc(sessionIdForClear);
        if ((await sessionRef.get()).exists) {
          batch.update(sessionRef, {
            ...sessionFinalMarksPatch(final, aiEvaluation?.status),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      await batch.commit();

      return NextResponse.json({
        success: true,
        answerId,
        cleared: true,
        marks: final?.marks ?? null,
        totalMarks: final?.totalMarks ?? totalMarks,
        accuracy: final?.percentage ?? 0,
        finalMarksSource: final?.source ?? null,
      });
    }

    // Either a question-by-question override or a single overall mark.
    let marks: number;
    let questionOverrides: QuestionOverride[] = [];

    if (body.questionMarks !== undefined) {
      const normalized = normalizeQuestionOverrides(body.questionMarks, aiQuestions);
      if (!normalized.ok) return jsonError(normalized.error, 400);
      questionOverrides = normalized.overrides;
      marks = normalized.total;
    } else {
      marks = Number(body.marks);
      if (!Number.isFinite(marks) || marks < 0) {
        return jsonError("Enter a mark of zero or more.", 400);
      }
      if (marks > totalMarks) {
        return jsonError(`The mark cannot exceed the total of ${totalMarks}.`, 400);
      }
    }

    const feedback = String(body.feedback || "").trim().slice(0, MAX_FEEDBACK_LENGTH);

    const teacherOverride = {
      marks,
      totalMarks,
      feedback,
      questionMarks: questionOverrides,
      scope: questionOverrides.length > 0 ? "question" : "overall",
      overriddenBy: auth.uid,
      overriddenByName: auth.name || auth.email,
      overriddenByRole: auth.role,
      overriddenAt: new Date().toISOString(),
      // What the AI had said at the moment of the override, so the record still
      // reads correctly if the evaluation is later re-run.
      aiMarksAtOverride: Number.isFinite(Number(aiEvaluation?.totalMarks))
        ? Number(aiEvaluation!.totalMarks)
        : null,
    };

    const final = computeAnswerFinalMarks(
      {
        grading: answer.grading,
        aiEvaluation,
        teacherOverride,
        totalMarks: answer.totalMarks,
      },
      Number(exam.totalMarks)
    );

    const accuracy = final?.percentage ?? Math.round((marks / totalMarks) * 1000) / 10;

    // `evaluation` keeps the shape the existing review screens already read,
    // so nothing downstream needs a special case for an overridden mark.
    const evaluation = {
      marks,
      totalMarks,
      feedback,
      evaluatedBy: auth.uid,
      evaluatedByName: auth.name || auth.email,
      evaluatedByRole: auth.role,
      evaluatedAt: FieldValue.serverTimestamp(),
      method: "manual",
      ...(Number.isFinite(Number(aiEvaluation?.totalMarks))
        ? { aiSuggestedMarks: Number(aiEvaluation!.totalMarks) }
        : Number.isFinite(Number(body.aiSuggestedMarks))
        ? { aiSuggestedMarks: Number(body.aiSuggestedMarks) }
        : {}),
    };

    const batch = db.batch();

    batch.update(answerRef, {
      teacherOverride,
      evaluation,
      // `grading` is the auto-grader's own record and is left alone; only the
      // derived final-mark fields move.
      ...answerFinalMarksPatch(final),
      gradedBy: "teacher",
      evaluatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(feedback ? { teacherFeedback: feedback } : {}),
    });

    // Keep the session in step — the student's own results list and the
    // teacher's session-results table both read from it, and a mark that
    // showed in one place but not the other is the sort of inconsistency that
    // gets reported as "the marks disappeared".
    const sessionId = String(answer.sessionId || answer.examSessionId || "");
    if (sessionId) {
      const sessionRef = db.collection("examSessions").doc(sessionId);
      if ((await sessionRef.get()).exists) {
        batch.update(sessionRef, {
          ...sessionFinalMarksPatch(final, aiEvaluation?.status),
          evaluatedBy: auth.uid,
          evaluatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      answerId,
      marks: final?.marks ?? marks,
      totalMarks: final?.totalMarks ?? totalMarks,
      accuracy,
      feedback,
      finalMarksSource: final?.source ?? "teacher",
      aiTotalMarks: aiEvaluation?.totalMarks ?? null,
      questionMarks: questionOverrides,
      evaluatedByName: auth.name || auth.email,
    });
  } catch (error: any) {
    console.error("API /api/exams/evaluate error:", error);
    return jsonError(error?.message || "Could not save the evaluation.", 500);
  }
}
