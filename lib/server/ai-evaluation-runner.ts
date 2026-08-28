/**
 * AI answer-script evaluation — the impure half (server-only).
 *
 * Runs the real pipeline against the Gemini API configured in `.env`:
 *
 *   submission -> question paper -> answer script -> question/answer matching
 *   -> semantic marking -> authorship estimate -> totals -> Firestore
 *
 * Two properties are load-bearing and worth stating plainly:
 *
 * 1. **Nothing is invented.** Every mark comes from a real model call over the
 *    real question paper and the real script. If the API key is missing, the
 *    call fails, the reply will not parse, or the reply cannot be matched to
 *    the paper, the evaluation is recorded as `failed` / `needs_review` with
 *    the reason. There is no fallback that produces a number.
 *
 * 2. **Authorship never touches marks.** The human/AI estimate is written to
 *    its own `authorship` field and is not an input to any mark, anywhere.
 *
 * The model is given the answer script FILES (images/PDF) directly rather than
 * OCR text, because a vision pass over the original page is what makes
 * handwritten maths, diagrams and worked derivations markable at all. OCR text
 * is still produced and stored alongside — but as extracted text, not as
 * evidence that a human wrote it.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import { generateContentWithFallback, type ModelPart } from "@/lib/utils/gemini";
import { readFileReference } from "@/lib/storage/read-object";
import { loadExamQuestions } from "./exam-questions";
import type { GradableQuestion } from "./grading";
import {
  applyAnswerKeyMarks,
  buildEvaluationPrompt,
  normalizePaperQuestions,
  parseModelJson,
  validateEvaluationPayload,
  QUESTION_EXTRACTION_PROMPT,
  type AiEvaluationResult,
  type EvaluableQuestion,
  type ExtractedPaperQuestion,
} from "./ai-evaluation";
import { answerFinalMarksPatch, computeAnswerFinalMarks, sessionFinalMarksPatch } from "./final-marks";

/** Most answer-script files sent to the model in one evaluation. */
const MAX_SCRIPT_FILES = 8;
/** Most question-paper files sent to the model in one extraction. */
const MAX_PAPER_FILES = 4;
/** Ceiling on the bytes handed to the model per call, before base64 expansion. */
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;
/** How long a `processing` claim is honoured before another run may take over. */
export const EVALUATION_CLAIM_TTL_MS = 10 * 60 * 1000;

export class EvaluationError extends Error {
  readonly needsReview: boolean;
  constructor(message: string, needsReview = false) {
    super(message);
    this.name = "EvaluationError";
    this.needsReview = needsReview;
  }
}

interface StoredFile {
  url?: string;
  path?: string;
  downloadURL?: string;
  name?: string;
  type?: string;
}

/**
 * Turn stored attachments into model parts.
 *
 * `path` (the raw bucket key) is preferred over `url`, because the stored URL
 * is a *signed* link with an expiry — an evaluation re-run weeks after
 * submission would fail on a link that has since lapsed, even though the object
 * is still sitting in the bucket. The key never expires.
 *
 * The objects are fetched CONCURRENTLY. Each read is a round trip to Backblaze,
 * and a ten-page scanned script did ten of them end to end for no reason — the
 * reads are independent, and the model cannot start until the last one lands
 * either way. The size budget is still applied strictly in page order
 * afterwards, so which pages get dropped when a submission is too large does
 * not depend on which request happened to finish first.
 */
async function readFilesAsParts(
  files: StoredFile[],
  limit: number
): Promise<{ parts: ModelPart[]; names: string[]; errors: string[] }> {
  const considered = files.slice(0, limit);

  const results = await Promise.all(
    considered.map(async (file) => {
      // `inline:` paths are the base64 upload fallback — bytes live in `url`.
      const reference =
        file.path && !file.path.startsWith("inline:")
          ? file.path
          : file.url || file.downloadURL || "";

      const label = file.name || "A file";
      if (!reference) {
        return { ok: false as const, error: `${label} has no readable storage reference.` };
      }

      try {
        const bytes = await readFileReference(reference);
        return {
          ok: true as const,
          label,
          name: file.name || reference.split("/").pop() || "file",
          bytes,
        };
      } catch (error: any) {
        return {
          ok: false as const,
          error: `${label} could not be read: ${error?.message || error}`,
        };
      }
    })
  );

  const parts: ModelPart[] = [];
  const names: string[] = [];
  const errors: string[] = [];
  let totalBytes = 0;

  for (const result of results) {
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    if (totalBytes + result.bytes.byteLength > MAX_TOTAL_BYTES) {
      errors.push(
        `${result.label} was skipped — the submission exceeds the ${
          MAX_TOTAL_BYTES / (1024 * 1024)
        }MB analysis limit.`
      );
      continue;
    }
    totalBytes += result.bytes.byteLength;
    parts.push({ inlineData: { mimeType: result.bytes.mimeType, data: result.bytes.base64 } });
    names.push(result.name);
  }

  if (files.length > limit) {
    errors.push(`Only the first ${limit} of ${files.length} files were analysed.`);
  }

  return { parts, names, errors };
}

/* ------------------------------------------------------------------ *
 * Question paper
 * ------------------------------------------------------------------ */

export type QuestionSource = "structured" | "paper_document" | "unavailable";

interface ResolvedQuestions {
  questions: EvaluableQuestion[];
  source: QuestionSource;
  marksRescaled: boolean;
  notes: string[];
}

/**
 * Read the questions off an uploaded question paper.
 *
 * The result is cached on the exam document, keyed by the set of paper files:
 * every student's script is marked against the same paper, so re-reading it
 * once per submission would multiply the model spend by the size of the class
 * for no benefit. A teacher replacing the paper changes the key and the cache
 * misses, which is the behaviour you want.
 */
async function extractQuestionsFromPaperFiles(
  db: Firestore,
  examId: string,
  exam: Record<string, any>,
  papers: StoredFile[]
): Promise<{ questions: ExtractedPaperQuestion[]; readable: boolean; modelUsed?: string }> {
  const cacheKey = papers
    .map((p) => p.path || p.url || p.downloadURL || p.name || "")
    .join("|");
  const cached = exam.aiQuestionPaper;
  if (
    cached &&
    cached.cacheKey === cacheKey &&
    Array.isArray(cached.questions) &&
    cached.questions.length > 0
  ) {
    return { questions: cached.questions, readable: true, modelUsed: cached.modelUsed };
  }

  const { parts, errors } = await readFilesAsParts(papers, MAX_PAPER_FILES);
  if (parts.length === 0) {
    throw new EvaluationError(
      `The question paper could not be read. ${errors.join(" ")}`.trim(),
      true
    );
  }

  const { response, modelName } = await generateContentWithFallback([
    QUESTION_EXTRACTION_PROMPT,
    ...parts,
  ]);

  const payload = parseModelJson(response.text());
  if (payload.readable === false) {
    throw new EvaluationError(
      "The question paper could not be read reliably enough to mark against.",
      true
    );
  }

  const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  const questions: ExtractedPaperQuestion[] = rawQuestions
    .map((q: any) => ({
      text: String(q?.text ?? "").trim(),
      maxMarks: Number(q?.marks ?? q?.maxMarks),
      type: typeof q?.type === "string" ? q.type : undefined,
      options: Array.isArray(q?.options) ? q.options.map(String) : undefined,
    }))
    .filter((q: ExtractedPaperQuestion) => q.text.length > 0);

  if (questions.length === 0) {
    throw new EvaluationError("No questions could be parsed from the question paper.", true);
  }

  // Best-effort cache; a failure here costs a re-read, not the evaluation.
  try {
    await db.collection("exams").doc(examId).update({
      aiQuestionPaper: {
        cacheKey,
        questions,
        modelUsed: modelName,
        parsedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn("[ai-evaluation] Could not cache the parsed question paper:", error);
  }

  return { questions, readable: true, modelUsed: modelName };
}

/**
 * Assemble the question set to mark against.
 *
 * The `questions` collection is preferred whenever it has entries: those marks
 * were typed by the teacher and need no interpretation. Reading them off a
 * scanned paper is the fallback for upload-mode exams.
 */
export async function resolveQuestions(
  db: Firestore,
  examId: string,
  exam: Record<string, any>,
  submittedAnswers: Record<string, any>
): Promise<ResolvedQuestions> {
  const notes: string[] = [];

  const structured = (await loadExamQuestions(db, examId, exam)) as GradableQuestion[];
  const usable = structured.filter((q) => String(q.text ?? "").trim().length > 0);

  if (usable.length > 0) {
    return {
      questions: usable.map((q, index) => ({
        id: String(q.id ?? index + 1),
        number: index + 1,
        text: String(q.text ?? ""),
        maxMarks: Math.max(0, Number(q.marks) || 0),
        type: q.type,
        options: Array.isArray(q.options) ? q.options : undefined,
        correctAnswer: q.correctAnswer,
        studentAnswerText:
          submittedAnswers && q.id in submittedAnswers
            ? String(submittedAnswers[String(q.id)] ?? "")
            : undefined,
      })),
      source: "structured",
      marksRescaled: false,
      notes,
    };
  }

  const papers: StoredFile[] = Array.isArray(exam.examPapers) ? exam.examPapers : [];
  if (papers.length === 0) {
    throw new EvaluationError(
      "This exam has neither a question list nor an uploaded question paper, so there is nothing to mark against.",
      true
    );
  }

  const extracted = await extractQuestionsFromPaperFiles(db, examId, exam, papers);
  const { questions, marksRescaled } = normalizePaperQuestions(
    extracted.questions,
    Number(exam.totalMarks)
  );

  if (questions.length === 0) {
    throw new EvaluationError("No questions could be parsed from the question paper.", true);
  }
  if (marksRescaled) {
    notes.push(
      `Per-question marks were read from the paper and rescaled to the exam total of ${exam.totalMarks}.`
    );
  }

  return { questions, source: "paper_document", marksRescaled, notes };
}

/* ------------------------------------------------------------------ *
 * Marking
 * ------------------------------------------------------------------ */

/**
 * One marking pass, with a single retry.
 *
 * The retry exists for the one failure mode that is genuinely transient: a
 * reply that is not parseable JSON, or that does not line up with the paper.
 * It is NOT a retry loop around "the model gave a mark I did not like" — a
 * validated reply is accepted whatever it says.
 */
async function markWithModel(
  questions: EvaluableQuestion[],
  scriptParts: ModelPart[],
  context: {
    examTitle?: string;
    courseName?: string;
    instructions?: string;
    hasTypedAnswers: boolean;
  }
): Promise<{ result: AiEvaluationResult; modelUsed: string; attempts: number }> {
  const prompt = buildEvaluationPrompt(questions, {
    examTitle: context.examTitle,
    courseName: context.courseName,
    instructions: context.instructions,
    hasAttachedScript: scriptParts.length > 0,
    hasTypedAnswers: context.hasTypedAnswers,
  });

  const contents: ModelPart[] = [prompt];
  if (scriptParts.length > 0) {
    contents.push("=== STUDENT ANSWER SCRIPT (the attached file(s) follow) ===");
    contents.push(...scriptParts);
  }

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { response, modelName } = await generateContentWithFallback(
      attempt === 1
        ? contents
        : [
            ...contents,
            "Your previous reply could not be used: " +
              lastError +
              " Reply again with ONLY the JSON object described above, containing one entry per question.",
          ]
    );

    let payload: Record<string, any>;
    try {
      payload = parseModelJson(response.text());
    } catch (error: any) {
      lastError = error?.message || "The reply was not valid JSON.";
      continue;
    }

    const validated = validateEvaluationPayload(payload, questions);
    if (validated.ok) {
      return { result: validated.result, modelUsed: modelName, attempts: attempt };
    }
    lastError = validated.error;
  }

  throw new EvaluationError(
    `The AI evaluation could not be validated after two attempts. ${lastError}`
  );
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

export interface RunEvaluationOptions {
  db: Firestore;
  answerId: string;
  /** Re-run an evaluation that already completed (teacher-triggered). */
  force?: boolean;
  triggeredBy?: string;
}

export interface RunEvaluationOutcome {
  status: "completed" | "needs_review" | "failed" | "skipped";
  reason?: string;
  aiEvaluation?: Record<string, any>;
}

/**
 * Claim the submission for evaluation.
 *
 * A transaction, because the evaluation is kicked off automatically at submit
 * time AND can be triggered by a teacher: without a claim, two runs would
 * spend two lots of model quota on the same script and race each other's
 * writes. A stale claim (a run whose server died mid-flight) is taken over
 * after `EVALUATION_CLAIM_TTL_MS`.
 */
async function claimForEvaluation(
  db: Firestore,
  answerId: string,
  force: boolean,
  triggeredBy?: string
): Promise<{ claimed: boolean; reason?: string; answer?: Record<string, any> }> {
  const ref = db.collection("answers").doc(answerId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { claimed: false, reason: "Submission not found." };

    const answer = snap.data() || {};
    const current = answer.aiEvaluation || {};

    if (current.status === "processing") {
      const startedAt = Date.parse(String(current.startedAt || ""));
      const fresh = Number.isFinite(startedAt) && Date.now() - startedAt < EVALUATION_CLAIM_TTL_MS;
      if (fresh) {
        return { claimed: false, reason: "An evaluation is already running for this submission." };
      }
    }

    if (!force && (current.status === "completed" || current.status === "needs_review")) {
      return { claimed: false, reason: "This submission has already been evaluated." };
    }

    tx.update(ref, {
      "aiEvaluation.status": "processing",
      "aiEvaluation.startedAt": new Date().toISOString(),
      "aiEvaluation.triggeredBy": triggeredBy || "system",
      "aiEvaluation.error": FieldValue.delete(),
      aiEvaluationStatus: "processing",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { claimed: true, answer };
  });
}

/** Mirror the evaluation status onto the session so both dashboards agree. */
async function updateSessionStatus(
  db: Firestore,
  sessionId: string,
  patch: Record<string, any>
): Promise<void> {
  if (!sessionId || Object.keys(patch).length === 0) return;
  try {
    const ref = db.collection("examSessions").doc(sessionId);
    if ((await ref.get()).exists) {
      await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    }
  } catch (error) {
    console.warn("[ai-evaluation] Could not update the exam session:", error);
  }
}

async function recordFailure(
  db: Firestore,
  answerId: string,
  sessionId: string,
  status: "failed" | "needs_review",
  message: string
): Promise<RunEvaluationOutcome> {
  await db
    .collection("answers")
    .doc(answerId)
    .update({
      "aiEvaluation.status": status,
      "aiEvaluation.error": message.slice(0, 2000),
      "aiEvaluation.completedAt": new Date().toISOString(),
      aiEvaluationStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
    });

  await updateSessionStatus(db, sessionId, { aiEvaluationStatus: status });

  return { status, reason: message };
}

/**
 * Evaluate one submission end to end.
 *
 * Never throws for an evaluation-level problem: a failure is a recorded state
 * on the submission (`failed` / `needs_review`) so the teacher sees a real
 * status instead of a silently missing mark. It only rejects when the claim
 * itself could not be taken.
 */
export async function runAiEvaluation({
  db,
  answerId,
  force = false,
  triggeredBy,
}: RunEvaluationOptions): Promise<RunEvaluationOutcome> {
  const claim = await claimForEvaluation(db, answerId, force, triggeredBy);
  if (!claim.claimed) {
    return { status: "skipped", reason: claim.reason };
  }

  const answer = claim.answer || {};
  const sessionId = String(answer.sessionId || answer.examSessionId || answerId);
  const examId = String(answer.examId || "");

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new EvaluationError(
        "The AI evaluation service is not configured on this deployment (GEMINI_API_KEY is missing)."
      );
    }
    if (!examId) throw new EvaluationError("This submission is not linked to an exam.");

    const examSnap = await db.collection("exams").doc(examId).get();
    if (!examSnap.exists) throw new EvaluationError("The exam for this submission no longer exists.");
    const exam = examSnap.data() || {};

    const submittedAnswers: Record<string, any> =
      answer.answers && typeof answer.answers === "object" ? answer.answers : {};
    const answerFiles: StoredFile[] = Array.isArray(answer.answerFiles) ? answer.answerFiles : [];

    const hasTypedAnswers = Object.values(submittedAnswers).some(
      (value) => String(value ?? "").trim().length > 0
    );
    if (answerFiles.length === 0 && !hasTypedAnswers) {
      throw new EvaluationError(
        "This submission contains no answer script and no typed answers.",
        true
      );
    }

    // The question paper and the answer script are independent inputs, and
    // resolving the paper can itself be a model call (an upload-mode exam whose
    // questions have to be read off a scan). Running them end to end meant a
    // student waited for a paper parse and then a bucket fetch, when neither
    // needs the other's result. `Promise.all` rather than `allSettled`: if
    // either input cannot be obtained there is nothing to mark, and the first
    // rejection carries the reason the caller records.
    const [resolved, script] = await Promise.all([
      resolveQuestions(db, examId, exam, submittedAnswers),
      readFilesAsParts(answerFiles, MAX_SCRIPT_FILES),
    ]);

    if (answerFiles.length > 0 && script.parts.length === 0) {
      throw new EvaluationError(
        `The answer script could not be read. ${script.errors.join(" ")}`.trim(),
        true
      );
    }

    const marked = await markWithModel(resolved.questions, script.parts, {
      examTitle: String(exam.title || answer.examTitle || ""),
      courseName: String(exam.courseName || answer.courseName || ""),
      // The teacher's own instructions for the paper, so marking follows the
      // rubric they actually set ("show all working", "answer any three")
      // rather than a generic idea of what the questions deserve.
      instructions: String(exam.instructions || ""),
      hasTypedAnswers,
    });

    const withKeyMarks = applyAnswerKeyMarks(
      marked.result,
      resolved.questions,
      submittedAnswers
    );

    const needsReviewReasons = [
      ...withKeyMarks.needsReviewReasons,
      ...resolved.notes,
      ...script.errors,
    ];
    // A note about rescaled marks is context, not a reason to hold the result
    // back; only the payload's own reasons and unreadable files force review.
    const forcesReview =
      withKeyMarks.needsReview || script.errors.length > 0;
    const status = forcesReview ? "needs_review" : "completed";

    const aiEvaluation = {
      status,
      model: marked.modelUsed,
      attempts: marked.attempts,
      startedAt: String(answer.aiEvaluation?.startedAt || new Date().toISOString()),
      completedAt: new Date().toISOString(),
      totalMarks: withKeyMarks.totalMarks,
      maxMarks: withKeyMarks.maxMarks,
      percentage: withKeyMarks.percentage,
      summary: withKeyMarks.summary,
      questions: withKeyMarks.questions,
      questionSource: resolved.source,
      answerSource: script.parts.length > 0 ? (hasTypedAnswers ? "mixed" : "files") : "typed",
      filesAnalyzed: script.names,
      needsReviewReasons,
      triggeredBy: triggeredBy || "system",
    };

    // Kept on the answer document rather than in a staff-only collection,
    // matching how `similarityScore` is handled: a verdict about the student
    // themselves lives with their own submission, and only data naming OTHER
    // students (the similarity `matches` list) is moved out of reach. The
    // student's own screens do not render it — see `AiEvaluationPanel`, which
    // takes `authorship` only in its teacher variant.
    const authorship = {
      ...withKeyMarks.authorship,
      model: marked.modelUsed,
      analyzedAt: new Date().toISOString(),
      // Stated on the record itself so nobody downstream has to take it on
      // trust that the estimate was kept out of the marking.
      affectsMarks: false,
    };

    const final = computeAnswerFinalMarks(
      {
        grading: answer.grading,
        aiEvaluation,
        teacherOverride: answer.teacherOverride,
        totalMarks: answer.totalMarks,
      },
      Number(exam.totalMarks)
    );

    await db
      .collection("answers")
      .doc(answerId)
      .update({
        aiEvaluation,
        authorship,
        aiEvaluationStatus: status,
        ...answerFinalMarksPatch(final),
        updatedAt: FieldValue.serverTimestamp(),
      });

    await updateSessionStatus(db, sessionId, sessionFinalMarksPatch(final, status));

    return { status, aiEvaluation };
  } catch (error: any) {
    const message = String(error?.message || "The AI evaluation failed.");
    const status = error instanceof EvaluationError && error.needsReview ? "needs_review" : "failed";
    console.error(`[ai-evaluation] ${answerId} -> ${status}:`, error);
    return recordFailure(db, answerId, sessionId, status, message);
  }
}
