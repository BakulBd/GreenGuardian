import { describe, expect, it } from "vitest";
import {
  GRADE_ORDER,
  passThresholdPercent,
  scoreSubmission,
  summarise,
  summariseBy,
  type ScoredSubmission,
} from "@/lib/analytics/exam-analytics";
import type { Answer, Exam } from "@/lib/types";

const exam = (overrides: Partial<Exam> = {}) =>
  ({ id: "e1", totalMarks: 100, ...overrides }) as Exam;

const answer = (overrides: Partial<Answer> = {}) =>
  ({
    id: "a1",
    examId: "e1",
    studentId: "s1",
    studentName: "Student One",
    ...overrides,
  }) as Answer;

describe("passThresholdPercent", () => {
  it("derives the threshold from passingMarks relative to totalMarks", () => {
    expect(passThresholdPercent({ passingMarks: 30, totalMarks: 60 })).toBe(50);
  });

  it("falls back to 40% — the lowest passing grade — when unset", () => {
    expect(passThresholdPercent({ totalMarks: 100 } as Exam)).toBe(40);
    expect(passThresholdPercent({ passingMarks: 0, totalMarks: 100 })).toBe(40);
  });
});

describe("scoreSubmission", () => {
  it("normalises a score into a percentage and grade", () => {
    const result = scoreSubmission(answer({ score: 76, totalMarks: 100 }), exam());
    expect(result).not.toBeNull();
    expect(result!.percentage).toBe(76);
    expect(result!.grade).toBe("A");
    expect(result!.passed).toBe(true);
  });

  it("returns null for an ungraded submission rather than scoring it zero", () => {
    expect(scoreSubmission(answer({}), exam())).toBeNull();
    expect(scoreSubmission(answer({ score: undefined }), exam())).toBeNull();
  });

  it("keeps a genuine zero, which is not the same as ungraded", () => {
    const result = scoreSubmission(answer({ score: 0, totalMarks: 50 }), exam());
    expect(result!.percentage).toBe(0);
    expect(result!.grade).toBe("F");
    expect(result!.passed).toBe(false);
  });

  it("prefers the marks recorded on the submission over the exam's current total", () => {
    // The exam was edited to be out of 200 after this was graded out of 50.
    const result = scoreSubmission(
      answer({ score: 25, totalMarks: 50 }),
      exam({ totalMarks: 200 })
    );
    expect(result!.percentage).toBe(50);
  });

  it("honours the exam's own pass mark", () => {
    const strict = scoreSubmission(
      answer({ score: 45, totalMarks: 100 }),
      exam({ passingMarks: 50 })
    );
    expect(strict!.passed).toBe(false);

    const lenient = scoreSubmission(
      answer({ score: 45, totalMarks: 100 }),
      exam({ passingMarks: 40 })
    );
    expect(lenient!.passed).toBe(true);
  });

  it("returns null when there is no usable total to divide by", () => {
    expect(scoreSubmission(answer({ score: 10 }), exam({ totalMarks: 0 }))).toBeNull();
  });
});

describe("summarise", () => {
  const scored = (percentages: number[], studentIds?: string[]): ScoredSubmission[] =>
    percentages
      .map((p, i) =>
        scoreSubmission(
          answer({
            id: `a${i}`,
            studentId: studentIds?.[i] ?? `s${i}`,
            score: p,
            totalMarks: 100,
          }),
          exam()
        )
      )
      .filter((s): s is ScoredSubmission => s !== null);

  it("reports an empty summary without dividing by zero", () => {
    const result = summarise([]);
    expect(result.submissions).toBe(0);
    expect(result.passRate).toBeNull();
    expect(result.averagePercentage).toBeNull();
    expect(result.gradeDistribution).toHaveLength(GRADE_ORDER.length);
    expect(result.gradeDistribution.every((b) => b.count === 0)).toBe(true);
  });

  it("computes pass rate, average, median and extremes", () => {
    const result = summarise(scored([90, 70, 50, 30]));
    expect(result.submissions).toBe(4);
    expect(result.passed).toBe(3); // 30% is below the 40% floor
    expect(result.failed).toBe(1);
    expect(result.passRate).toBe(75);
    expect(result.averagePercentage).toBe(60);
    expect(result.medianPercentage).toBe(60);
    expect(result.highestPercentage).toBe(90);
    expect(result.lowestPercentage).toBe(30);
  });

  it("counts distinct students separately from submissions", () => {
    const result = summarise(scored([80, 60], ["s1", "s1"]));
    expect(result.submissions).toBe(2);
    expect(result.students).toBe(1);
  });

  it("buckets grades in the fixed display order", () => {
    const result = summarise(scored([85, 82, 30]));
    const byLabel = Object.fromEntries(result.gradeDistribution.map((b) => [b.label, b.count]));
    expect(byLabel["A+"]).toBe(2);
    expect(byLabel["F"]).toBe(1);
    expect(result.gradeDistribution.map((b) => b.label)).toEqual([...GRADE_ORDER]);
  });
});

describe("summariseBy", () => {
  const build = (rows: { examId: string; score: number }[]) =>
    rows
      .map((r, i) =>
        scoreSubmission(
          answer({ id: `a${i}`, studentId: `s${i}`, examId: r.examId, score: r.score, totalMarks: 100 }),
          exam()
        )
      )
      .filter((s): s is ScoredSubmission => s !== null);

  it("groups and ranks by average score, highest first", () => {
    const groups = summariseBy(
      build([
        { examId: "low", score: 40 },
        { examId: "low", score: 50 },
        { examId: "high", score: 90 },
      ]),
      (s) => ({ key: s.examId, label: s.examId })
    );

    expect(groups.map((g) => g.key)).toEqual(["high", "low"]);
    expect(groups[0].averagePercentage).toBe(90);
    expect(groups[1].averagePercentage).toBe(45);
  });

  it("skips submissions the key function cannot place", () => {
    const groups = summariseBy(
      build([
        { examId: "keep", score: 70 },
        { examId: "drop", score: 70 },
      ]),
      (s) => (s.examId === "drop" ? null : { key: s.examId, label: s.examId })
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("keep");
  });
});
