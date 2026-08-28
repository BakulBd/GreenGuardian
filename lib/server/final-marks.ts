/**
 * The one place that decides what "the mark" is for a submission.
 *
 * Three different things can produce marks for the same answer document:
 *
 *   - answer-key auto-grading (`grading`), for option questions in an online exam;
 *   - the AI evaluation (`aiEvaluation`), for written work and uploaded scripts;
 *   - a teacher (`teacherOverride`), who beats both.
 *
 * They are stored SEPARATELY and none of them is ever overwritten by another —
 * a teacher raising a mark from 78 to 84 must not destroy the evidence of what
 * the AI said and why. What the student sees is a fourth, derived field
 * (`finalMarks`), recomputed from the other three by `resolveFinalMarks`.
 *
 * Both `/api/exams/ai-evaluate` and `/api/exams/evaluate` build their Firestore
 * patch from here, so a mark can never appear on the teacher's screen and not
 * the student's — the answer document and the exam session are always updated
 * with the same numbers.
 *
 * Kept free of Gemini and Firestore imports so the evaluation route can use it
 * without pulling the model client into its bundle.
 */
import { resolveFinalMarks, type FinalMarks } from "./ai-evaluation";

export type { FinalMarks };

/** The subset of an answer document the mark resolution actually reads. */
export interface MarkSources {
  grading?: { obtainedMarks?: number; totalMarks?: number } | null;
  aiEvaluation?: { status?: string; totalMarks?: number; maxMarks?: number } | null;
  teacherOverride?: { marks?: number | null; totalMarks?: number | null } | null;
  totalMarks?: number;
}

/**
 * Resolve the final mark for an answer document.
 *
 * `examTotalMarks` is the exam's own total, used when neither the AI nor the
 * teacher recorded one — without it an upload-mode script whose paper could not
 * be parsed would report a percentage out of zero.
 */
export function computeAnswerFinalMarks(
  answer: MarkSources,
  examTotalMarks?: number
): FinalMarks | null {
  return resolveFinalMarks({
    aiEvaluation: answer.aiEvaluation ?? null,
    teacherOverride: answer.teacherOverride ?? null,
    autoGrading: answer.grading ?? null,
    examTotalMarks: Number.isFinite(Number(examTotalMarks))
      ? Number(examTotalMarks)
      : Number(answer.totalMarks),
  });
}

/**
 * Firestore patch mirroring the final mark onto the answer document.
 *
 * `score`/`totalMarks`/`accuracy` are the fields every existing reader already
 * uses (result cards, analytics, the student review screen), so they keep
 * carrying the final mark and nothing downstream needs to learn about
 * `finalMarks`. `grading.obtainedMarks` is deliberately NOT touched: it is the
 * auto-grader's own record.
 */
export function answerFinalMarksPatch(final: FinalMarks | null): Record<string, any> {
  if (!final) return {};
  return {
    finalMarks: final.marks,
    finalMarksSource: final.source,
    finalTotalMarks: final.totalMarks,
    finalPercentage: final.percentage,
    score: final.marks,
    totalMarks: final.totalMarks,
    accuracy: final.percentage,
  };
}

/**
 * Firestore patch mirroring the final mark onto the exam session.
 *
 * The student's results list and the teacher's session-results table both read
 * the session rather than the answer, so a mark written to only one of the two
 * shows up as "the marks disappeared" on whichever screen missed it.
 */
export function sessionFinalMarksPatch(
  final: FinalMarks | null,
  aiEvaluationStatus?: string | null
): Record<string, any> {
  const patch: Record<string, any> = {};
  if (aiEvaluationStatus) patch.aiEvaluationStatus = aiEvaluationStatus;
  if (final) {
    patch.score = final.marks;
    patch.totalMarks = final.totalMarks;
    patch.percentage = final.percentage;
    patch.accuracy = final.percentage;
    patch.marksSource = final.source;
    patch.evaluated = true;
  }
  return patch;
}
