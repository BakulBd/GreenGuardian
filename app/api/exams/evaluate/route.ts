/**
 * Teacher/admin manual evaluation of an exam submission.
 *
 * Auto-grading only covers what the answer key can decide: option-based
 * questions in an ONLINE exam. Two whole categories of submission were
 * therefore ungradable, and until now had no path to a mark at all:
 *
 *   - UPLOAD-mode exams, where the answer is a scanned PDF. The submission
 *     document was written with no `score` and no `grading`, so every student
 *     showed as "0 / total" forever.
 *   - Written answers inside an online exam (short/long/code), and any answer
 *     sheets attached to one.
 *
 * The mark is recorded here rather than from the browser so that the answer
 * document, the exam session, and the published result cannot drift apart, and
 * so that ownership is enforced with the Admin SDK rather than trusted from the
 * client. An AI suggestion (see /api/ocr `grade_answer`) is only ever advisory:
 * the number stored is the one a person entered.
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FEEDBACK_LENGTH = 5000;

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

    const totalMarks = Number(
      body.totalMarks ?? answer.grading?.totalMarks ?? answer.totalMarks ?? exam.totalMarks ?? 100
    );
    if (!Number.isFinite(totalMarks) || totalMarks <= 0) {
      return jsonError("This exam has no valid total marks to grade against.", 400);
    }

    const marks = Number(body.marks);
    if (!Number.isFinite(marks) || marks < 0) {
      return jsonError("Enter a mark of zero or more.", 400);
    }
    if (marks > totalMarks) {
      return jsonError(`The mark cannot exceed the total of ${totalMarks}.`, 400);
    }

    const feedback = String(body.feedback || "").trim().slice(0, MAX_FEEDBACK_LENGTH);
    const accuracy = Math.round((marks / totalMarks) * 1000) / 10;

    const evaluation = {
      marks,
      totalMarks,
      feedback,
      evaluatedBy: auth.uid,
      evaluatedByName: auth.name || auth.email,
      evaluatedByRole: auth.role,
      evaluatedAt: FieldValue.serverTimestamp(),
      // Recorded so a later reviewer can tell a human mark from the auto-grade
      // that produced the same number.
      method: "manual",
      ...(Number.isFinite(Number(body.aiSuggestedMarks))
        ? { aiSuggestedMarks: Number(body.aiSuggestedMarks) }
        : {}),
    };

    // `grading` keeps the same shape auto-grading writes, so every downstream
    // reader (result cards, analytics, the student's review screen) works
    // without a special case for manually marked work.
    const grading = {
      ...(answer.grading || {}),
      obtainedMarks: marks,
      totalMarks,
      accuracy,
      gradedManually: true,
    };

    const batch = db.batch();

    batch.update(answerRef, {
      score: marks,
      totalMarks,
      accuracy,
      grading,
      evaluation,
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
          score: marks,
          totalMarks,
          percentage: accuracy,
          evaluated: true,
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
      marks,
      totalMarks,
      accuracy,
      feedback,
      evaluatedByName: auth.name || auth.email,
    });
  } catch (error: any) {
    console.error("API /api/exams/evaluate error:", error);
    return jsonError(error?.message || "Could not save the evaluation.", 500);
  }
}
