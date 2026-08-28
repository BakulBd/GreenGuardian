/**
 * AI answer-script evaluation — the pure half.
 *
 * Everything in this module is deterministic and dependency-free so it can be
 * unit-tested (`tests/ai-evaluation.test.ts`) without a model, a network, or
 * Firestore. The impure half — reading the question paper and the answer
 * script, calling Gemini, writing the result — lives in
 * `lib/server/ai-evaluation-runner.ts`.
 *
 * The split exists because the risky part of AI marking is not the model call,
 * it is what happens to the model's reply afterwards. A grade that came back as
 * `"awardedMarks": 14` on a 10-mark question, or an authorship split of
 * 80% human / 60% AI, must never reach a student's transcript. So the model's
 * output is treated as *untrusted input*: parsed, matched against the real
 * question set, clamped to the teacher's marks, and rejected outright when it
 * cannot be made to make sense. A rejected reply becomes a `failed` /
 * `needs_review` evaluation — never an invented mark.
 */
import { isAutoGradable, isAnswerCorrect } from "./grading";

/** Lifecycle of one submission's AI evaluation. */
export type AiEvaluationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "needs_review"
  | "failed";

/** How confident we are that a human, rather than an LLM, wrote the script. */
export type AuthorshipStatus = "likely_human" | "likely_ai" | "mixed" | "uncertain";

export type AnswerVerdict =
  | "correct"
  | "partially_correct"
  | "incorrect"
  | "unrelated"
  | "unanswered"
  | "unreadable";

const VERDICTS: readonly AnswerVerdict[] = [
  "correct",
  "partially_correct",
  "incorrect",
  "unrelated",
  "unanswered",
  "unreadable",
];

/** A question the AI is asked to mark against, with the teacher's marks. */
export interface EvaluableQuestion {
  /** Stable id when the question came from the `questions` collection. */
  id: string;
  /** 1-based position, used to match the model's reply when ids are absent. */
  number: number;
  text: string;
  /** The ceiling for this question. The AI can never exceed it. */
  maxMarks: number;
  type?: string;
  options?: string[];
  /** Answer key, present only for option-based questions. Never sent to a student. */
  correctAnswer?: string | string[];
  /** The student's typed answer, when the exam was answered online. */
  studentAnswerText?: string;
}

export interface QuestionEvaluation {
  questionId: string;
  questionNumber: number;
  questionText: string;
  maxMarks: number;
  awardedMarks: number;
  verdict: AnswerVerdict;
  /** 0-100 sub-scores. Reported to the teacher, never used to derive the mark. */
  relevance: number;
  correctness: number;
  completeness: number;
  reasoningQuality: number;
  keyConceptsCovered: string[];
  keyConceptsMissing: string[];
  /** What the model read as the student's answer to this question. */
  studentAnswer: string;
  feedback: string;
  /** True when the mark came from the answer key rather than the model. */
  gradedFromAnswerKey?: boolean;
}

export interface AuthorshipEstimate {
  humanPercent: number;
  aiPercent: number;
  status: AuthorshipStatus;
  confidence: number;
  indicators: string[];
  rationale: string;
}

export interface AiEvaluationResult {
  questions: QuestionEvaluation[];
  totalMarks: number;
  maxMarks: number;
  percentage: number;
  summary: string;
  authorship: AuthorshipEstimate;
  /** Set when the script could not be read reliably enough to stand on its own. */
  needsReview: boolean;
  needsReviewReasons: string[];
}

export type ValidationOutcome =
  | { ok: true; result: AiEvaluationResult }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

/**
 * Marks are awarded in half-mark steps and can never leave `[0, max]`.
 *
 * The clamp is the single most important line in this file: it is what makes
 * "a 10-mark question can score 0-10, never more than 10" a property of the
 * system rather than a request in a prompt.
 */
export function clampMarks(value: unknown, maxMarks: number): number {
  const max = Number.isFinite(Number(maxMarks)) ? Math.max(0, Number(maxMarks)) : 0;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  const bounded = Math.min(max, Math.max(0, raw));
  return Math.round(bounded * 2) / 2;
}

/** Clamp a 0-100 signal, defaulting when the model sent something unusable. */
export function clampPercent(value: unknown, fallback = 0): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ *
 * JSON extraction
 * ------------------------------------------------------------------ */

/**
 * Pull a JSON object out of a model reply.
 *
 * Gemini is asked for raw JSON and usually obeys, but wraps it in a fenced
 * block often enough that failing on that would make the feature flaky for no
 * reason. Anything beyond a fence or surrounding prose is a genuine protocol
 * failure and is reported as one — the caller retries, then gives up. It never
 * falls back to a default object, because a default object here is exactly the
 * "fake AI response" this system must not produce.
 */
export function parseModelJson(text: string): Record<string, any> {
  const raw = String(text ?? "").trim();
  if (!raw) throw new Error("The model returned an empty response.");

  const candidate = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the brace scan below.
  }

  // Prose around the JSON: take the outermost balanced object.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Reported below.
    }
  }

  throw new Error("The model response was not valid JSON.");
}

/* ------------------------------------------------------------------ *
 * Question set normalisation
 * ------------------------------------------------------------------ */

export interface ExtractedPaperQuestion {
  text: string;
  maxMarks: number;
  type?: string;
  options?: string[];
}

/**
 * Turn questions read off a scanned question paper into an evaluable set.
 *
 * The marks a model reads off a paper are the least reliable part of the
 * extraction — a "[10]" in a margin is easy to miss, and a question with no
 * marks at all would silently make the whole paper worth less than it is. So
 * when the extracted marks do not add up to the total the teacher recorded on
 * the exam, they are rescaled to it and the caller is told they were. The
 * teacher's `totalMarks` is authoritative; the model only proposes the split.
 */
export function normalizePaperQuestions(
  extracted: ExtractedPaperQuestion[],
  examTotalMarks?: number
): { questions: EvaluableQuestion[]; marksRescaled: boolean } {
  const cleaned = extracted
    .map((q) => ({
      text: String(q?.text ?? "").trim(),
      maxMarks: Number(q?.maxMarks),
      type: typeof q?.type === "string" ? q.type : undefined,
      options: Array.isArray(q?.options) ? q.options.map(String) : undefined,
    }))
    .filter((q) => q.text.length > 0);

  if (cleaned.length === 0) return { questions: [], marksRescaled: false };

  const target = Number(examTotalMarks);
  const hasTarget = Number.isFinite(target) && target > 0;
  const extractedTotal = cleaned.reduce(
    (sum, q) => sum + (Number.isFinite(q.maxMarks) && q.maxMarks > 0 ? q.maxMarks : 0),
    0
  );

  let marks: number[];
  let marksRescaled = false;

  if (extractedTotal > 0 && (!hasTarget || Math.abs(extractedTotal - target) < 0.01)) {
    marks = cleaned.map((q) => (Number.isFinite(q.maxMarks) && q.maxMarks > 0 ? q.maxMarks : 0));
  } else if (extractedTotal > 0 && hasTarget) {
    const factor = target / extractedTotal;
    marks = cleaned.map((q) =>
      roundTo((Number.isFinite(q.maxMarks) && q.maxMarks > 0 ? q.maxMarks : 0) * factor, 2)
    );
    marksRescaled = true;
  } else if (hasTarget) {
    // No usable marks anywhere on the paper — split the exam total evenly.
    marks = cleaned.map(() => roundTo(target / cleaned.length, 2));
    marksRescaled = true;
  } else {
    marks = cleaned.map(() => 1);
    marksRescaled = true;
  }

  // Absorb rounding drift into the last question so the paper still adds up.
  if (hasTarget && marks.length > 0) {
    const sum = marks.reduce((a, b) => a + b, 0);
    const drift = roundTo(target - sum, 2);
    if (Math.abs(drift) >= 0.01) {
      marks[marks.length - 1] = Math.max(0, roundTo(marks[marks.length - 1] + drift, 2));
    }
  }

  return {
    questions: cleaned.map((q, index) => ({
      id: `p${index + 1}`,
      number: index + 1,
      text: q.text,
      maxMarks: marks[index],
      type: q.type,
      options: q.options,
    })),
    marksRescaled,
  };
}

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

export const QUESTION_EXTRACTION_PROMPT = [
  "You are reading an exam QUESTION PAPER (it may be a scan, a photo, or a PDF).",
  "",
  "Transcribe every question exactly as printed, in order, together with the marks allocated to it.",
  "",
  "Rules:",
  "- Include sub-questions (1a, 1b, ...) as separate entries when they carry their own marks.",
  '- "marks" is the marks allocated to that question on the paper. If a question shows no marks, use 0 and let the caller decide.',
  "- Do NOT answer the questions. Do NOT invent questions that are not on the paper.",
  '- If the paper is unreadable, return {"readable": false, "questions": []}.',
  "",
  "Return ONLY this JSON object, with no commentary and no code fence:",
  "{",
  '  "readable": true,',
  '  "questions": [',
  '    { "number": 1, "text": "full question text", "marks": 10, "type": "mcq|short_answer|essay|true_false|numerical", "options": ["A", "B"] }',
  "  ]",
  "}",
].join("\n");

/**
 * The marking prompt.
 *
 * Written to force semantic marking rather than keyword overlap, and to make
 * the two things this system must keep apart — academic quality and who wrote
 * the script — explicitly independent of each other.
 */
export function buildEvaluationPrompt(
  questions: EvaluableQuestion[],
  context: {
    examTitle?: string;
    courseName?: string;
    /**
     * The teacher's own instructions for the paper, when they set any.
     *
     * Included so marking follows the rubric that was actually issued —
     * "show all working", "answer any three", "credit is for method not the
     * final number" — rather than a generic idea of what each question
     * deserves. Bounded because it is free text on the exam document.
     */
    instructions?: string;
    hasAttachedScript: boolean;
    hasTypedAnswers: boolean;
  }
): string {
  const questionBlock = questions
    .map((q) => {
      const lines = [
        `Question ${q.number} (id: ${q.id}) — worth ${q.maxMarks} marks`,
        q.text,
      ];
      if (q.options && q.options.length > 0) {
        lines.push(`Options: ${q.options.map((o, i) => `(${i + 1}) ${o}`).join("  ")}`);
      }
      if (q.studentAnswerText && q.studentAnswerText.trim()) {
        lines.push(`Student's typed answer: "${q.studentAnswerText.trim().slice(0, 6000)}"`);
      } else if (!context.hasAttachedScript) {
        lines.push("Student's typed answer: (left blank)");
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const sources: string[] = [];
  if (context.hasAttachedScript) {
    sources.push(
      "the attached answer script file(s) — images or PDF, possibly handwritten; read them with vision"
    );
  }
  if (context.hasTypedAnswers) sources.push("the typed answers quoted under each question");

  const rubric = String(context.instructions || "").trim().slice(0, 4000);

  return [
    "You are an experienced university examiner marking one student's answer script.",
    "",
    `Exam: ${context.examTitle || "Untitled exam"}${context.courseName ? ` (${context.courseName})` : ""}`,
    "",
    `You are given the QUESTION PAPER below and the STUDENT'S ANSWER SCRIPT from ${sources.join(" and ")}.`,
    "",
    ...(rubric
      ? [
          "=== THE TEACHER'S INSTRUCTIONS FOR THIS PAPER ===",
          rubric,
          "Follow these where they bear on how an answer should be marked. They do",
          "not override the per-question maximum marks below, and they never",
          "change the authorship estimate.",
          "=== END TEACHER'S INSTRUCTIONS ===",
          "",
        ]
      : []),
    "=== QUESTION PAPER ===",
    questionBlock,
    "=== END QUESTION PAPER ===",
    "",
    "HOW TO MARK",
    "1. Read and understand each question FIRST. Then find the part of the answer script that answers it — the student may number answers differently, answer out of order, or run answers together.",
    "2. Mark on meaning, not on wording. Never award marks for keyword overlap, length, effort, or neat presentation. A short answer that is completely correct earns full marks. A long, fluent answer that is wrong earns near zero.",
    "3. Judge: relevance to the question asked, factual correctness, completeness against what the question demands, the quality of the reasoning shown, and whether the important concepts are present.",
    "4. For mathematics, physics, chemistry, accounting, statistics and programming: follow the actual working. Check the method, the setup, the algebra/arithmetic, units, and the final result. Award partial marks for a correct method with a downstream arithmetic slip, and for a correct approach left incomplete. For code, judge whether it would actually work — correctness of logic, edge cases, and complexity where relevant.",
    "5. Award partial marks whenever part of the answer is genuinely correct.",
    "6. If an answer is unrelated to the question, or is a restatement of the question, or is blank, award 0. Submitting something is not worth marks.",
    "7. awardedMarks must be between 0 and that question's marks, inclusive. Never exceed the maximum. Use half marks where they are justified.",
    '8. Return an entry for EVERY question on the paper, including ones the student did not answer (verdict "unanswered", 0 marks).',
    '9. Do NOT guess at text you cannot actually read. If a question\'s answer is illegible or missing from the script, use verdict "unreadable" and say so in the feedback rather than inventing content.',
    "",
    "SEPARATELY: AUTHORSHIP",
    "Estimate whether the answer script was written by the student or produced by an AI assistant, based on the writing itself: voice, self-correction, natural error patterns, idiosyncratic phrasing and structure versus uniform register, template-like scaffolding, and generic filler. Handwriting is NOT evidence of human authorship, and typed text is NOT evidence of AI authorship — a student can copy an AI answer out by hand, and can type their own work. This is a probabilistic estimate, not proof. humanWrittenPercent and aiGeneratedPercent MUST sum to exactly 100.",
    "",
    "This estimate MUST NOT influence any mark. Mark a suspected AI-written answer exactly as you would mark it if a human had written it.",
    "",
    "Return ONLY this JSON object, with no commentary and no code fence:",
    "{",
    '  "answerScriptReadable": true,',
    '  "unreadableReason": "",',
    '  "evaluations": [',
    "    {",
    '      "questionId": "the id given above",',
    '      "questionNumber": 1,',
    '      "studentAnswer": "what the student actually wrote for this question, transcribed",',
    '      "verdict": "correct|partially_correct|incorrect|unrelated|unanswered|unreadable",',
    '      "relevance": 0,',
    '      "correctness": 0,',
    '      "completeness": 0,',
    '      "reasoningQuality": 0,',
    '      "keyConceptsCovered": [],',
    '      "keyConceptsMissing": [],',
    '      "awardedMarks": 0,',
    '      "feedback": "why this mark: what is right, what is wrong, what is missing"',
    "    }",
    "  ],",
    '  "overallFeedback": "a short summary of the script as a whole",',
    '  "authorship": {',
    '    "humanWrittenPercent": 0,',
    '    "aiGeneratedPercent": 0,',
    '    "confidence": 0,',
    '    "indicators": ["concrete observations from the text"],',
    '    "rationale": "one or two sentences"',
    "  }",
    "}",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Authorship
 * ------------------------------------------------------------------ */

/**
 * Normalise the model's authorship estimate.
 *
 * The two percentages are forced to total exactly 100 — a split that does not
 * is meaningless to a reader, and the model does occasionally return one. When
 * the model gives nothing usable the result is an honest 50/50 "uncertain"
 * rather than a confident-looking guess.
 *
 * The status is DERIVED from the normalised numbers rather than taken from the
 * model, so the label and the percentages can never contradict each other.
 */
export function normalizeAuthorship(raw: unknown): AuthorshipEstimate {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;

  const humanRaw = Number(source.humanWrittenPercent ?? source.humanPercent);
  const aiRaw = Number(source.aiGeneratedPercent ?? source.aiPercent);

  const hasHuman = Number.isFinite(humanRaw);
  const hasAi = Number.isFinite(aiRaw);

  let human: number;
  if (hasHuman && hasAi) {
    const h = Math.max(0, humanRaw);
    const a = Math.max(0, aiRaw);
    human = h + a > 0 ? (h / (h + a)) * 100 : 50;
  } else if (hasHuman) {
    human = Math.min(100, Math.max(0, humanRaw));
  } else if (hasAi) {
    human = 100 - Math.min(100, Math.max(0, aiRaw));
  } else {
    human = 50;
  }

  const humanPercent = Math.round(human);
  const aiPercent = 100 - humanPercent;

  const confidence = clampPercent(source.confidence, hasHuman || hasAi ? 50 : 0);

  let status: AuthorshipStatus;
  if (confidence < 40) {
    status = "uncertain";
  } else if (aiPercent >= 65) {
    status = "likely_ai";
  } else if (humanPercent >= 65) {
    status = "likely_human";
  } else {
    status = "mixed";
  }

  const indicators = Array.isArray(source.indicators)
    ? source.indicators.map((i: unknown) => String(i).slice(0, 300)).filter(Boolean).slice(0, 12)
    : [];

  return {
    humanPercent,
    aiPercent,
    status,
    confidence,
    indicators,
    rationale: String(source.rationale ?? "").slice(0, 2000),
  };
}

/** Human-readable label for an authorship status. */
export function authorshipLabel(status: AuthorshipStatus): string {
  switch (status) {
    case "likely_human":
      return "Likely Human";
    case "likely_ai":
      return "Likely AI";
    case "mixed":
      return "Mixed";
    default:
      return "Uncertain";
  }
}

/* ------------------------------------------------------------------ *
 * Payload validation
 * ------------------------------------------------------------------ */

function normalizeVerdict(value: unknown, awarded: number, maxMarks: number): AnswerVerdict {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((VERDICTS as readonly string[]).includes(raw)) return raw as AnswerVerdict;
  // Derive rather than default to "incorrect": a missing verdict on a
  // full-marks answer labelled "incorrect" would be actively misleading.
  if (maxMarks > 0 && awarded >= maxMarks) return "correct";
  if (awarded > 0) return "partially_correct";
  return "incorrect";
}

/**
 * Validate and normalise a model reply against the real question set.
 *
 * Returns `{ok: false}` — never a partial-credit guess — when the reply cannot
 * be matched to the paper at all. The caller retries once and then records a
 * `failed` evaluation.
 */
export function validateEvaluationPayload(
  raw: unknown,
  questions: EvaluableQuestion[]
): ValidationOutcome {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "The model response was not a JSON object." };
  }
  if (questions.length === 0) {
    return { ok: false, error: "There are no questions to evaluate against." };
  }

  const payload = raw as Record<string, any>;
  const rawEvaluations = Array.isArray(payload.evaluations) ? payload.evaluations : null;
  if (!rawEvaluations) {
    return { ok: false, error: "The model response contained no 'evaluations' array." };
  }
  if (rawEvaluations.length === 0) {
    return { ok: false, error: "The model returned an empty evaluation list." };
  }

  // Index the reply by id and by number so answers can be matched however the
  // model chose to identify them.
  const byId = new Map<string, any>();
  const byNumber = new Map<number, any>();
  rawEvaluations.forEach((entry: any, index: number) => {
    if (!entry || typeof entry !== "object") return;
    const id = String(entry.questionId ?? "").trim();
    if (id && !byId.has(id)) byId.set(id, entry);
    const number = Number(entry.questionNumber);
    const key = Number.isFinite(number) ? number : index + 1;
    if (!byNumber.has(key)) byNumber.set(key, entry);
  });

  const needsReviewReasons: string[] = [];
  const unmatched: number[] = [];

  const evaluations: QuestionEvaluation[] = questions.map((question) => {
    const entry = byId.get(question.id) ?? byNumber.get(question.number) ?? null;

    if (!entry) {
      unmatched.push(question.number);
      return {
        questionId: question.id,
        questionNumber: question.number,
        questionText: question.text,
        maxMarks: question.maxMarks,
        awardedMarks: 0,
        verdict: "unanswered",
        relevance: 0,
        correctness: 0,
        completeness: 0,
        reasoningQuality: 0,
        keyConceptsCovered: [],
        keyConceptsMissing: [],
        studentAnswer: "",
        feedback: "The evaluation did not cover this question — it needs a human look.",
      };
    }

    const awardedMarks = clampMarks(entry.awardedMarks, question.maxMarks);

    return {
      questionId: question.id,
      questionNumber: question.number,
      questionText: question.text,
      maxMarks: question.maxMarks,
      awardedMarks,
      verdict: normalizeVerdict(entry.verdict, awardedMarks, question.maxMarks),
      relevance: clampPercent(entry.relevance),
      correctness: clampPercent(entry.correctness),
      completeness: clampPercent(entry.completeness),
      reasoningQuality: clampPercent(entry.reasoningQuality),
      keyConceptsCovered: Array.isArray(entry.keyConceptsCovered)
        ? entry.keyConceptsCovered
            .map((c: unknown) => String(c).slice(0, 200))
            .filter(Boolean)
            .slice(0, 20)
        : [],
      keyConceptsMissing: Array.isArray(entry.keyConceptsMissing)
        ? entry.keyConceptsMissing
            .map((c: unknown) => String(c).slice(0, 200))
            .filter(Boolean)
            .slice(0, 20)
        : [],
      studentAnswer: String(entry.studentAnswer ?? "").slice(0, 20000),
      feedback: String(entry.feedback ?? "").slice(0, 4000),
    };
  });

  // A reply that matched nothing is a protocol failure, not a zero.
  if (unmatched.length === questions.length) {
    return {
      ok: false,
      error: "The model's evaluation could not be matched to any question on the paper.",
    };
  }
  if (unmatched.length > 0) {
    needsReviewReasons.push(
      `The model did not evaluate question${unmatched.length > 1 ? "s" : ""} ${unmatched.join(", ")}.`
    );
  }

  if (payload.answerScriptReadable === false) {
    needsReviewReasons.push(
      String(payload.unreadableReason || "").trim() ||
        "The model reported that the answer script could not be read reliably."
    );
  }

  if (evaluations.some((e) => e.verdict === "unreadable")) {
    needsReviewReasons.push("At least one answer could not be read from the script.");
  }

  const maxMarks = roundTo(
    questions.reduce((sum, q) => sum + (Number.isFinite(q.maxMarks) ? q.maxMarks : 0), 0),
    2
  );
  const totalMarks = roundTo(
    evaluations.reduce((sum, e) => sum + e.awardedMarks, 0),
    2
  );

  return {
    ok: true,
    result: {
      questions: evaluations,
      totalMarks,
      maxMarks,
      percentage: maxMarks > 0 ? roundTo((totalMarks / maxMarks) * 100, 1) : 0,
      summary: String(payload.overallFeedback ?? "").slice(0, 4000),
      authorship: normalizeAuthorship(payload.authorship),
      needsReview: needsReviewReasons.length > 0,
      needsReviewReasons,
    },
  };
}

/** Recompute the totals after per-question marks have been adjusted. */
export function recomputeTotals(evaluations: QuestionEvaluation[]): {
  totalMarks: number;
  maxMarks: number;
  percentage: number;
} {
  const maxMarks = roundTo(
    evaluations.reduce((sum, e) => sum + e.maxMarks, 0),
    2
  );
  const totalMarks = roundTo(
    evaluations.reduce((sum, e) => sum + e.awardedMarks, 0),
    2
  );
  return {
    totalMarks,
    maxMarks,
    percentage: maxMarks > 0 ? roundTo((totalMarks / maxMarks) * 100, 1) : 0,
  };
}

/**
 * Replace the model's mark with the answer key's verdict where a key exists.
 *
 * For an option-based question the key is a decision, not an opinion: it is
 * both cheaper and strictly more accurate than asking a model. The AI's
 * reasoning is kept as feedback, only the number changes. Written questions
 * (short/long/code) have no key and keep the AI's mark, which is the whole
 * reason the AI pass exists.
 */
export function applyAnswerKeyMarks(
  result: AiEvaluationResult,
  questions: EvaluableQuestion[],
  submittedAnswers: Record<string, any>
): AiEvaluationResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let changed = false;

  const evaluations = result.questions.map((evaluation) => {
    const question = byId.get(evaluation.questionId);
    if (!question) return evaluation;
    if (!isAutoGradable(question.type)) return evaluation;
    if (question.correctAnswer === undefined || question.correctAnswer === null) return evaluation;

    const submitted = submittedAnswers?.[question.id];
    const hasSubmission = String(submitted ?? "").trim().length > 0;

    if (!hasSubmission) {
      // Nothing selected for an option question is unambiguously zero.
      if (evaluation.awardedMarks === 0 && evaluation.verdict === "unanswered") return evaluation;
      changed = true;
      return {
        ...evaluation,
        awardedMarks: 0,
        verdict: "unanswered" as const,
        gradedFromAnswerKey: true,
      };
    }

    const correct = isAnswerCorrect(submitted, question.correctAnswer);
    const awardedMarks = correct ? clampMarks(question.maxMarks, question.maxMarks) : 0;
    if (awardedMarks === evaluation.awardedMarks && evaluation.gradedFromAnswerKey) {
      return evaluation;
    }
    changed = true;
    return {
      ...evaluation,
      awardedMarks,
      verdict: correct ? ("correct" as const) : ("incorrect" as const),
      gradedFromAnswerKey: true,
    };
  });

  if (!changed) return result;

  return { ...result, questions: evaluations, ...recomputeTotals(evaluations) };
}

/* ------------------------------------------------------------------ *
 * Final marks
 * ------------------------------------------------------------------ */

export type FinalMarksSource = "teacher" | "ai" | "auto";

export interface TeacherOverrideInput {
  marks?: number | null;
  totalMarks?: number | null;
}

export interface FinalMarks {
  marks: number;
  totalMarks: number;
  percentage: number;
  source: FinalMarksSource;
}

/**
 * Decide the mark the student actually sees.
 *
 * Teacher beats AI beats answer-key auto-grading. The AI evaluation is never
 * consulted unless it actually produced marks — a `failed` or still-`processing`
 * evaluation contributes nothing, which is what keeps a broken model call from
 * quietly becoming a zero on someone's transcript.
 *
 * Nothing here mutates the AI evaluation. An override is an additional record
 * beside it, so the original AI marks survive forever.
 */
export function resolveFinalMarks(input: {
  aiEvaluation?: { status?: string; totalMarks?: number; maxMarks?: number } | null;
  teacherOverride?: TeacherOverrideInput | null;
  autoGrading?: { obtainedMarks?: number; totalMarks?: number } | null;
  examTotalMarks?: number;
}): FinalMarks | null {
  const fallbackTotal = Number(input.examTotalMarks);

  const pick = (marks: unknown, total: unknown, source: FinalMarksSource): FinalMarks | null => {
    const m = Number(marks);
    if (!Number.isFinite(m)) return null;
    const candidates = [Number(total), fallbackTotal];
    const t = candidates.find((c) => Number.isFinite(c) && c > 0) ?? 0;
    const bounded = t > 0 ? Math.min(t, Math.max(0, m)) : Math.max(0, m);
    return {
      marks: roundTo(bounded, 2),
      totalMarks: roundTo(t, 2),
      percentage: t > 0 ? roundTo((bounded / t) * 100, 1) : 0,
      source,
    };
  };

  const override = input.teacherOverride;
  if (override && override.marks !== undefined && override.marks !== null) {
    const resolved = pick(override.marks, override.totalMarks, "teacher");
    if (resolved) return resolved;
  }

  const ai = input.aiEvaluation;
  if (ai && (ai.status === "completed" || ai.status === "needs_review")) {
    const resolved = pick(ai.totalMarks, ai.maxMarks, "ai");
    if (resolved) return resolved;
  }

  const auto = input.autoGrading;
  if (auto) {
    const resolved = pick(auto.obtainedMarks, auto.totalMarks, "auto");
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Whether the student should be told an evaluation is still running rather
 * than shown a mark. A `needs_review` evaluation DOES carry a mark, so it is
 * not "in progress" — it is a real result a teacher has been asked to confirm.
 */
export function isEvaluationInProgress(status?: string | null): boolean {
  return status === "queued" || status === "processing";
}
