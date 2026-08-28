/**
 * Tests for the part of AI marking that must never depend on a model: what
 * happens to the model's reply once it arrives.
 *
 * The properties under test are the ones that keep a bad reply out of a
 * student's transcript — marks stay inside the teacher's bounds, an
 * unmatchable reply is rejected rather than defaulted, the authorship split
 * always totals 100, and a teacher override never destroys the AI record.
 */
import { describe, it, expect } from "vitest";
import {
  applyAnswerKeyMarks,
  authorshipLabel,
  clampMarks,
  clampPercent,
  isEvaluationInProgress,
  normalizeAuthorship,
  normalizePaperQuestions,
  parseModelJson,
  recomputeTotals,
  resolveFinalMarks,
  validateEvaluationPayload,
  type EvaluableQuestion,
} from "@/lib/server/ai-evaluation";
import {
  answerFinalMarksPatch,
  computeAnswerFinalMarks,
  sessionFinalMarksPatch,
} from "@/lib/server/final-marks";

const questions: EvaluableQuestion[] = [
  { id: "q1", number: 1, text: "Define entropy.", maxMarks: 10 },
  { id: "q2", number: 2, text: "Solve 2x + 3 = 11.", maxMarks: 5 },
];

function payload(overrides: Record<string, any> = {}) {
  return {
    answerScriptReadable: true,
    evaluations: [
      {
        questionId: "q1",
        questionNumber: 1,
        studentAnswer: "Entropy measures disorder.",
        verdict: "partially_correct",
        relevance: 90,
        correctness: 60,
        completeness: 50,
        reasoningQuality: 55,
        keyConceptsCovered: ["disorder"],
        keyConceptsMissing: ["second law"],
        awardedMarks: 6,
        feedback: "Right idea, missing the second law.",
      },
      {
        questionId: "q2",
        questionNumber: 2,
        studentAnswer: "x = 4",
        verdict: "correct",
        relevance: 100,
        correctness: 100,
        completeness: 100,
        reasoningQuality: 90,
        awardedMarks: 5,
        feedback: "Correct.",
      },
    ],
    overallFeedback: "Solid.",
    authorship: {
      humanWrittenPercent: 80,
      aiGeneratedPercent: 20,
      confidence: 70,
      indicators: ["crossings-out", "inconsistent spacing"],
      rationale: "Natural self-correction throughout.",
    },
    ...overrides,
  };
}

describe("clampMarks", () => {
  it("never exceeds the question maximum", () => {
    expect(clampMarks(14, 10)).toBe(10);
    expect(clampMarks(1000, 5)).toBe(5);
  });

  it("floors at zero and rejects non-numbers", () => {
    expect(clampMarks(-3, 10)).toBe(0);
    expect(clampMarks("banana", 10)).toBe(0);
    expect(clampMarks(null, 10)).toBe(0);
    expect(clampMarks(undefined, 10)).toBe(0);
  });

  it("rounds to the nearest half mark", () => {
    expect(clampMarks(7.3, 10)).toBe(7.5);
    expect(clampMarks(7.1, 10)).toBe(7);
  });

  it("treats a question with no marks as worth nothing", () => {
    expect(clampMarks(5, 0)).toBe(0);
  });
});

describe("clampPercent", () => {
  it("bounds to 0-100 and falls back when unusable", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent("x", 50)).toBe(50);
  });
});

describe("parseModelJson", () => {
  it("reads plain JSON", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads JSON wrapped in a code fence", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reads JSON surrounded by prose", () => {
    expect(parseModelJson('Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it("throws rather than inventing an object", () => {
    expect(() => parseModelJson("not json at all")).toThrow();
    expect(() => parseModelJson("")).toThrow();
    // An array is not an evaluation payload.
    expect(() => parseModelJson("[1,2,3]")).toThrow();
  });
});

describe("validateEvaluationPayload", () => {
  it("accepts a well-formed reply and totals it", () => {
    const outcome = validateEvaluationPayload(payload(), questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.totalMarks).toBe(11);
    expect(outcome.result.maxMarks).toBe(15);
    expect(outcome.result.percentage).toBeCloseTo(73.3, 1);
    expect(outcome.result.needsReview).toBe(false);
    expect(outcome.result.questions).toHaveLength(2);
  });

  it("clamps a mark the model pushed above the question maximum", () => {
    const raw = payload();
    raw.evaluations[0].awardedMarks = 25; // question is worth 10
    const outcome = validateEvaluationPayload(raw, questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.questions[0].awardedMarks).toBe(10);
    expect(outcome.result.totalMarks).toBe(15);
    expect(outcome.result.totalMarks).toBeLessThanOrEqual(outcome.result.maxMarks);
  });

  it("gives an unrelated answer zero rather than credit for existing", () => {
    const raw = payload();
    raw.evaluations[0] = {
      ...raw.evaluations[0],
      verdict: "unrelated",
      awardedMarks: 0,
      relevance: 0,
      correctness: 0,
      feedback: "This answers a different question entirely.",
    };
    const outcome = validateEvaluationPayload(raw, questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.questions[0].awardedMarks).toBe(0);
    expect(outcome.result.questions[0].verdict).toBe("unrelated");
    expect(outcome.result.totalMarks).toBe(5);
  });

  it("matches by question number when the model omits ids", () => {
    const raw = payload();
    raw.evaluations = raw.evaluations.map(({ questionId, ...rest }: any) => rest);
    const outcome = validateEvaluationPayload(raw, questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.questions[0].awardedMarks).toBe(6);
  });

  it("flags a partially answered reply for review instead of silently zeroing it", () => {
    const raw = payload();
    raw.evaluations = [raw.evaluations[0]];
    const outcome = validateEvaluationPayload(raw, questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.needsReview).toBe(true);
    expect(outcome.result.needsReviewReasons.join(" ")).toContain("2");
    expect(outcome.result.questions[1].awardedMarks).toBe(0);
    expect(outcome.result.questions[1].verdict).toBe("unanswered");
  });

  it("needs review when the model says it could not read the script", () => {
    const outcome = validateEvaluationPayload(
      payload({ answerScriptReadable: false, unreadableReason: "The scan is out of focus." }),
      questions
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.needsReview).toBe(true);
    expect(outcome.result.needsReviewReasons[0]).toContain("focus");
  });

  it("rejects a reply that matches no question at all", () => {
    const raw = payload();
    raw.evaluations = [{ questionId: "nope", questionNumber: 99, awardedMarks: 10 }] as any;
    const outcome = validateEvaluationPayload(raw, questions);
    expect(outcome.ok).toBe(false);
  });

  it("rejects structurally broken replies rather than defaulting", () => {
    expect(validateEvaluationPayload(null, questions).ok).toBe(false);
    expect(validateEvaluationPayload({}, questions).ok).toBe(false);
    expect(validateEvaluationPayload({ evaluations: [] }, questions).ok).toBe(false);
    expect(validateEvaluationPayload(payload(), []).ok).toBe(false);
  });

  it("lets a short but correct answer take full marks", () => {
    const raw = payload();
    raw.evaluations[1].studentAnswer = "4";
    raw.evaluations[1].awardedMarks = 5;
    const outcome = validateEvaluationPayload(raw, questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.questions[1].awardedMarks).toBe(5);
  });
});

describe("applyAnswerKeyMarks", () => {
  const mcqQuestions: EvaluableQuestion[] = [
    { id: "q1", number: 1, text: "2 + 2 = ?", maxMarks: 10, type: "mcq", correctAnswer: "4" },
    { id: "q2", number: 2, text: "Explain recursion.", maxMarks: 5, type: "long" },
  ];

  function mcqResult(q1Marks: number) {
    const raw = payload();
    raw.evaluations[0].awardedMarks = q1Marks;
    const outcome = validateEvaluationPayload(raw, mcqQuestions);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.result;
  }

  it("overrides the model with the answer key when the student is right", () => {
    const result = applyAnswerKeyMarks(mcqResult(6), mcqQuestions, { q1: "4", q2: "..." });
    expect(result.questions[0].awardedMarks).toBe(10);
    expect(result.questions[0].verdict).toBe("correct");
    expect(result.questions[0].gradedFromAnswerKey).toBe(true);
    // Totals follow the corrected marks.
    expect(result.totalMarks).toBe(15);
  });

  it("overrides the model with the answer key when the student is wrong", () => {
    const result = applyAnswerKeyMarks(mcqResult(6), mcqQuestions, { q1: "5", q2: "..." });
    expect(result.questions[0].awardedMarks).toBe(0);
    expect(result.questions[0].verdict).toBe("incorrect");
    expect(result.totalMarks).toBe(5);
  });

  it("leaves written questions to the model", () => {
    const result = applyAnswerKeyMarks(mcqResult(6), mcqQuestions, { q1: "4", q2: "..." });
    expect(result.questions[1].awardedMarks).toBe(5);
    expect(result.questions[1].gradedFromAnswerKey).toBeUndefined();
  });

  it("scores an unattempted option question as zero", () => {
    const result = applyAnswerKeyMarks(mcqResult(6), mcqQuestions, { q2: "..." });
    expect(result.questions[0].awardedMarks).toBe(0);
    expect(result.questions[0].verdict).toBe("unanswered");
  });

  it("changes nothing when no question carries an answer key", () => {
    const raw = validateEvaluationPayload(payload(), questions);
    if (!raw.ok) throw new Error(raw.error);
    const result = applyAnswerKeyMarks(raw.result, questions, {});
    expect(result).toBe(raw.result);
  });
});

describe("normalizeAuthorship", () => {
  it("keeps a split that already totals 100", () => {
    const result = normalizeAuthorship({
      humanWrittenPercent: 80,
      aiGeneratedPercent: 20,
      confidence: 70,
    });
    expect(result.humanPercent).toBe(80);
    expect(result.aiPercent).toBe(20);
    expect(result.humanPercent + result.aiPercent).toBe(100);
    expect(result.status).toBe("likely_human");
  });

  it("renormalises a split that does not total 100", () => {
    const result = normalizeAuthorship({
      humanWrittenPercent: 80,
      aiGeneratedPercent: 60,
      confidence: 80,
    });
    expect(result.humanPercent + result.aiPercent).toBe(100);
    expect(result.humanPercent).toBe(57);
  });

  it("derives the missing half of the split", () => {
    const result = normalizeAuthorship({ aiGeneratedPercent: 90, confidence: 85 });
    expect(result.humanPercent).toBe(10);
    expect(result.aiPercent).toBe(90);
    expect(result.status).toBe("likely_ai");
  });

  it("is honestly uncertain when the model gives nothing", () => {
    const result = normalizeAuthorship(undefined);
    expect(result.humanPercent).toBe(50);
    expect(result.aiPercent).toBe(50);
    expect(result.confidence).toBe(0);
    expect(result.status).toBe("uncertain");
  });

  it("reports a genuine middle as mixed", () => {
    const result = normalizeAuthorship({
      humanWrittenPercent: 50,
      aiGeneratedPercent: 50,
      confidence: 75,
    });
    expect(result.status).toBe("mixed");
  });

  it("falls back to uncertain when confidence is low, whatever the split", () => {
    const result = normalizeAuthorship({
      humanWrittenPercent: 95,
      aiGeneratedPercent: 5,
      confidence: 10,
    });
    expect(result.status).toBe("uncertain");
    expect(result.humanPercent).toBe(95);
  });

  it("labels every status", () => {
    expect(authorshipLabel("likely_human")).toBe("Likely Human");
    expect(authorshipLabel("likely_ai")).toBe("Likely AI");
    expect(authorshipLabel("mixed")).toBe("Mixed");
    expect(authorshipLabel("uncertain")).toBe("Uncertain");
  });
});

describe("normalizePaperQuestions", () => {
  it("keeps marks that already add up to the exam total", () => {
    const { questions: parsed, marksRescaled } = normalizePaperQuestions(
      [
        { text: "Q1", maxMarks: 10 },
        { text: "Q2", maxMarks: 15 },
      ],
      25
    );
    expect(marksRescaled).toBe(false);
    expect(parsed.map((q) => q.maxMarks)).toEqual([10, 15]);
  });

  it("rescales marks that do not add up to the exam total", () => {
    const { questions: parsed, marksRescaled } = normalizePaperQuestions(
      [
        { text: "Q1", maxMarks: 1 },
        { text: "Q2", maxMarks: 1 },
      ],
      50
    );
    expect(marksRescaled).toBe(true);
    expect(parsed.reduce((sum, q) => sum + q.maxMarks, 0)).toBe(50);
  });

  it("splits the total evenly when the paper shows no marks", () => {
    const { questions: parsed } = normalizePaperQuestions(
      [{ text: "Q1", maxMarks: 0 }, { text: "Q2", maxMarks: 0 }, { text: "Q3", maxMarks: 0 }],
      30
    );
    expect(parsed.map((q) => q.maxMarks)).toEqual([10, 10, 10]);
  });

  it("absorbs rounding drift so the paper still totals correctly", () => {
    const { questions: parsed } = normalizePaperQuestions(
      [{ text: "Q1", maxMarks: 0 }, { text: "Q2", maxMarks: 0 }, { text: "Q3", maxMarks: 0 }],
      100
    );
    expect(parsed.reduce((sum, q) => sum + q.maxMarks, 0)).toBe(100);
  });

  it("drops entries with no text", () => {
    const { questions: parsed } = normalizePaperQuestions(
      [{ text: "  ", maxMarks: 5 }, { text: "Q2", maxMarks: 5 }],
      10
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].number).toBe(1);
  });
});

describe("recomputeTotals", () => {
  it("re-adds marks after a per-question change", () => {
    const outcome = validateEvaluationPayload(payload(), questions);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const adjusted = outcome.result.questions.map((q, i) =>
      i === 0 ? { ...q, awardedMarks: 10 } : q
    );
    expect(recomputeTotals(adjusted)).toEqual({
      totalMarks: 15,
      maxMarks: 15,
      percentage: 100,
    });
  });
});

describe("resolveFinalMarks", () => {
  const ai = { status: "completed", totalMarks: 78, maxMarks: 100 };

  it("uses the AI mark when there is no teacher override", () => {
    const final = resolveFinalMarks({ aiEvaluation: ai });
    expect(final).toEqual({ marks: 78, totalMarks: 100, percentage: 78, source: "ai" });
  });

  it("prefers the teacher override and leaves the AI mark untouched", () => {
    const aiRecord = { ...ai };
    const final = resolveFinalMarks({
      aiEvaluation: aiRecord,
      teacherOverride: { marks: 84, totalMarks: 100 },
    });
    expect(final).toEqual({ marks: 84, totalMarks: 100, percentage: 84, source: "teacher" });
    // The AI record is an input, never mutated by the resolution.
    expect(aiRecord.totalMarks).toBe(78);
  });

  it("ignores an AI evaluation that failed", () => {
    const final = resolveFinalMarks({
      aiEvaluation: { status: "failed", totalMarks: 0, maxMarks: 100 },
      autoGrading: { obtainedMarks: 12, totalMarks: 20 },
    });
    expect(final?.source).toBe("auto");
    expect(final?.marks).toBe(12);
  });

  it("ignores an AI evaluation that is still running", () => {
    const final = resolveFinalMarks({
      aiEvaluation: { status: "processing" },
      autoGrading: { obtainedMarks: 5, totalMarks: 20 },
    });
    expect(final?.source).toBe("auto");
  });

  it("still yields a mark for a needs_review evaluation", () => {
    const final = resolveFinalMarks({
      aiEvaluation: { status: "needs_review", totalMarks: 40, maxMarks: 100 },
    });
    expect(final?.source).toBe("ai");
    expect(final?.marks).toBe(40);
  });

  it("returns null when nothing has produced a mark", () => {
    expect(resolveFinalMarks({})).toBeNull();
    expect(resolveFinalMarks({ aiEvaluation: { status: "queued" } })).toBeNull();
  });

  it("clamps an override to the total", () => {
    const final = resolveFinalMarks({ teacherOverride: { marks: 150, totalMarks: 100 } });
    expect(final?.marks).toBe(100);
  });

  it("falls back to the exam total when no source carries one", () => {
    const final = resolveFinalMarks({
      teacherOverride: { marks: 45 },
      examTotalMarks: 50,
    });
    expect(final).toEqual({ marks: 45, totalMarks: 50, percentage: 90, source: "teacher" });
  });
});

describe("final-marks patches", () => {
  it("mirrors the final mark onto the fields existing readers use", () => {
    const final = computeAnswerFinalMarks(
      {
        aiEvaluation: { status: "completed", totalMarks: 78, maxMarks: 100 },
        teacherOverride: { marks: 84, totalMarks: 100 },
      },
      100
    );
    const patch = answerFinalMarksPatch(final);

    expect(patch.finalMarks).toBe(84);
    expect(patch.finalMarksSource).toBe("teacher");
    expect(patch.score).toBe(84);
    expect(patch.accuracy).toBe(84);
    // The AI's own record is not part of the patch, so it cannot be clobbered.
    expect(patch).not.toHaveProperty("aiEvaluation");
    expect(patch).not.toHaveProperty("grading");
  });

  it("hands the mark back to the AI when the override is removed", () => {
    const final = computeAnswerFinalMarks(
      {
        aiEvaluation: { status: "completed", totalMarks: 78, maxMarks: 100 },
        teacherOverride: null,
      },
      100
    );
    expect(final?.marks).toBe(78);
    expect(final?.source).toBe("ai");
  });

  it("carries the status onto the session even before a mark exists", () => {
    expect(sessionFinalMarksPatch(null, "processing")).toEqual({
      aiEvaluationStatus: "processing",
    });
  });

  it("writes marks and status together once evaluation finishes", () => {
    const patch = sessionFinalMarksPatch(
      { marks: 78, totalMarks: 100, percentage: 78, source: "ai" },
      "completed"
    );
    expect(patch).toMatchObject({
      aiEvaluationStatus: "completed",
      score: 78,
      totalMarks: 100,
      percentage: 78,
      marksSource: "ai",
      evaluated: true,
    });
  });
});

describe("isEvaluationInProgress", () => {
  it("is true only while the evaluation has not produced a result", () => {
    expect(isEvaluationInProgress("queued")).toBe(true);
    expect(isEvaluationInProgress("processing")).toBe(true);
    expect(isEvaluationInProgress("completed")).toBe(false);
    // A needs_review evaluation HAS a mark — it is a result awaiting
    // confirmation, not work still in flight.
    expect(isEvaluationInProgress("needs_review")).toBe(false);
    expect(isEvaluationInProgress("failed")).toBe(false);
    expect(isEvaluationInProgress(undefined)).toBe(false);
  });
});
