import { describe, it, expect } from "vitest";
import {
  gradeSubmission,
  isAnswerCorrect,
  isAutoGradable,
  sanitizeAnswerFiles,
  sanitizeQuestionsForStudent,
  MAX_ANSWER_FILES,
  MAX_INLINE_FILE_CHARS,
  type GradableQuestion,
} from "@/lib/server/grading";

const mcq = (id: string, correct: string, marks = 5, negativeMarks = 0): GradableQuestion => ({
  id,
  type: "mcq",
  marks,
  negativeMarks,
  correctAnswer: correct,
});

describe("isAutoGradable", () => {
  it("treats option-based types as auto-gradable", () => {
    expect(isAutoGradable("mcq")).toBe(true);
    expect(isAutoGradable("multiple-choice")).toBe(true);
    expect(isAutoGradable("true-false")).toBe(true);
  });

  it("treats a missing type as the legacy multiple-choice default", () => {
    expect(isAutoGradable(undefined)).toBe(true);
  });

  it("leaves free-text types for the teacher", () => {
    expect(isAutoGradable("short")).toBe(false);
    expect(isAutoGradable("long")).toBe(false);
    expect(isAutoGradable("code")).toBe(false);
  });
});

describe("isAnswerCorrect", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(isAnswerCorrect("  Paris ", "paris")).toBe(true);
  });

  it("rejects an empty submission even against an empty key", () => {
    expect(isAnswerCorrect("", "")).toBe(false);
    expect(isAnswerCorrect("   ", "anything")).toBe(false);
  });

  it("rejects when the exam has no key for the question", () => {
    expect(isAnswerCorrect("something", undefined)).toBe(false);
  });

  it("compares multi-select keys as an order-independent set", () => {
    expect(isAnswerCorrect("b,a", ["a", "b"])).toBe(true);
    expect(isAnswerCorrect("a, B", ["b", "a"])).toBe(true);
    expect(isAnswerCorrect("a", ["a", "b"])).toBe(false);
  });
});

describe("gradeSubmission", () => {
  it("scores correct answers and totals the marks on offer", () => {
    const summary = gradeSubmission(
      [mcq("q1", "a"), mcq("q2", "b"), mcq("q3", "c")],
      { q1: "a", q2: "b", q3: "c" }
    );

    expect(summary.correctAnswers).toBe(3);
    expect(summary.wrongAnswers).toBe(0);
    expect(summary.obtainedMarks).toBe(15);
    expect(summary.totalMarks).toBe(15);
    expect(summary.accuracy).toBe(100);
  });

  it("counts unanswered questions as unattempted, not wrong", () => {
    const summary = gradeSubmission([mcq("q1", "a"), mcq("q2", "b")], { q1: "a", q2: "   " });

    expect(summary.attemptedAnswers).toBe(1);
    expect(summary.wrongAnswers).toBe(0);
    expect(summary.correctAnswers).toBe(1);
    // Accuracy is over auto-graded answers only, so one correct out of one.
    expect(summary.accuracy).toBe(100);
    expect(summary.totalMarks).toBe(10);
  });

  it("applies negative marking to wrong answers", () => {
    const summary = gradeSubmission(
      [mcq("q1", "a", 5, 2), mcq("q2", "b", 5, 2)],
      { q1: "a", q2: "wrong" }
    );

    expect(summary.correctAnswers).toBe(1);
    expect(summary.wrongAnswers).toBe(1);
    expect(summary.obtainedMarks).toBe(3); // 5 − 2
    expect(summary.accuracy).toBe(50);
  });

  it("never reports a negative total", () => {
    const summary = gradeSubmission([mcq("q1", "a", 1, 10)], { q1: "wrong" });
    expect(summary.obtainedMarks).toBe(0);
  });

  it("defers free-text answers instead of marking them wrong", () => {
    const summary = gradeSubmission(
      [mcq("q1", "a"), { id: "q2", type: "long", marks: 10, correctAnswer: "an essay" }],
      { q1: "a", q2: "my own words" }
    );

    expect(summary.pendingManualReview).toBe(1);
    expect(summary.wrongAnswers).toBe(0);
    expect(summary.attemptedAnswers).toBe(2);
    // The essay's marks still count toward what the exam is out of.
    expect(summary.totalMarks).toBe(15);
    expect(summary.obtainedMarks).toBe(5);
  });

  it("reports zero accuracy for a submission with nothing auto-gradable", () => {
    const summary = gradeSubmission([{ id: "q1", type: "long", marks: 10 }], { q1: "words" });
    expect(summary.accuracy).toBe(0);
    expect(summary.pendingManualReview).toBe(1);
  });

  it("ignores answers submitted for questions that are not on the paper", () => {
    const summary = gradeSubmission([mcq("q1", "a")], { q1: "a", injected: "a" });
    expect(summary.totalQuestions).toBe(1);
    expect(summary.attemptedAnswers).toBe(1);
    expect(summary.obtainedMarks).toBe(5);
  });

  it("grades an empty submission as zero rather than throwing", () => {
    const summary = gradeSubmission([mcq("q1", "a")], {});
    expect(summary).toMatchObject({
      correctAnswers: 0,
      wrongAnswers: 0,
      attemptedAnswers: 0,
      obtainedMarks: 0,
      totalMarks: 5,
      accuracy: 0,
    });
  });
});

describe("sanitizeQuestionsForStudent", () => {
  it("removes the answer key and explanation but keeps what the paper needs", () => {
    const sanitized = sanitizeQuestionsForStudent([
      {
        id: "q1",
        text: "Capital of France?",
        type: "mcq",
        options: ["Paris", "Rome"],
        correctAnswer: "Paris",
        explanation: "It is Paris.",
        marks: 5,
        negativeMarks: 1,
      },
    ]);

    expect(sanitized[0]).not.toHaveProperty("correctAnswer");
    expect(sanitized[0]).not.toHaveProperty("explanation");
    expect(sanitized[0]).toMatchObject({
      id: "q1",
      text: "Capital of France?",
      options: ["Paris", "Rome"],
      marks: 5,
      // Students are entitled to know the penalty for guessing wrong.
      negativeMarks: 1,
    });
  });

  it("does not mutate the caller's questions", () => {
    const original: GradableQuestion[] = [{ id: "q1", correctAnswer: "a" }];
    sanitizeQuestionsForStudent(original);
    expect(original[0].correctAnswer).toBe("a");
  });
});

describe("sanitizeAnswerFiles", () => {
  // `FileUpload` hands back `UploadResult` objects, not URL strings. A
  // string-only filter here silently dropped every file on an upload-mode
  // exam, which loses the student's entire submission.
  it("keeps the UploadResult objects the uploader produces", () => {
    const files = sanitizeAnswerFiles([
      {
        url: "https://storage.example/answers/a.pdf",
        path: "answers/a.pdf",
        name: "a.pdf",
        type: "application/pdf",
        size: 1024,
      },
    ]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      url: "https://storage.example/answers/a.pdf",
      name: "a.pdf",
      type: "application/pdf",
      size: 1024,
    });
  });

  it("accepts bare URL strings from older clients", () => {
    expect(sanitizeAnswerFiles(["https://storage.example/a.pdf"])[0].url).toBe(
      "https://storage.example/a.pdf"
    );
  });

  it("drops entries with no usable url", () => {
    expect(sanitizeAnswerFiles([{ name: "a.pdf" }, null, 42, { url: "" }])).toEqual([]);
  });

  it("returns an empty list for a missing or non-array payload", () => {
    expect(sanitizeAnswerFiles(undefined)).toEqual([]);
    expect(sanitizeAnswerFiles({ url: "x" })).toEqual([]);
  });

  it("caps the number of files", () => {
    const many = Array.from({ length: MAX_ANSWER_FILES + 5 }, (_, i) => ({
      url: `https://storage.example/${i}.pdf`,
    }));
    expect(sanitizeAnswerFiles(many)).toHaveLength(MAX_ANSWER_FILES);
  });

  it("rejects an inline data URL that would blow the Firestore document limit", () => {
    const huge = `data:image/png;base64,${"A".repeat(MAX_INLINE_FILE_CHARS)}`;
    expect(sanitizeAnswerFiles([{ url: huge }])).toEqual([]);
    // A small inline fallback upload is still fine.
    expect(sanitizeAnswerFiles([{ url: "data:image/png;base64,AAAA" }])).toHaveLength(1);
  });

  it("truncates oversized name and type strings", () => {
    const files = sanitizeAnswerFiles([
      { url: "https://storage.example/a.pdf", name: "n".repeat(500), type: "t".repeat(500) },
    ]);
    expect(files[0].name!.length).toBe(300);
    expect(files[0].type!.length).toBe(120);
  });
});
