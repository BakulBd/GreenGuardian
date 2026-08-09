/**
 * Statistical analysis of exam performance.
 *
 * Deliberately split into two layers:
 *
 *   - The functions in this file are PURE. They take already-loaded exams,
 *     submissions and students and return numbers. No Firestore, no auth, no
 *     React — so the grading maths can be unit tested without a project, and
 *     the teacher and admin dashboards cannot drift apart by computing "pass
 *     rate" two slightly different ways.
 *   - `lib/firebase/analytics.ts` does the loading and scoping.
 *
 * Grade boundaries come from `calculateGrade` in lib/firebase/results.ts so
 * that a grade shown on a dashboard is the same grade shown on a result slip.
 */
import { calculateGrade } from "@/lib/firebase/results";
import type { Answer, Exam, User } from "@/lib/types";

/** Grades in descending order — the x-axis order for every distribution chart. */
export const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"] as const;
export type Grade = (typeof GRADE_ORDER)[number];

/** One student's outcome on one exam, normalised to a percentage. */
export interface ScoredSubmission {
  answerId: string;
  examId: string;
  studentId: string;
  studentName: string;
  score: number;
  totalMarks: number;
  percentage: number;
  grade: Grade;
  gpa: number;
  passed: boolean;
}

export interface DistributionBucket {
  label: string;
  count: number;
}

export interface PerformanceSummary {
  submissions: number;
  /** Distinct students represented, which is not the same as submissions. */
  students: number;
  passed: number;
  failed: number;
  /** 0–100. `null` when there is nothing to average. */
  passRate: number | null;
  averagePercentage: number | null;
  medianPercentage: number | null;
  highestPercentage: number | null;
  lowestPercentage: number | null;
  averageGpa: number | null;
  gradeDistribution: DistributionBucket[];
}

/**
 * The pass mark for an exam, as a percentage.
 *
 * `passingMarks` is stored in raw marks, so it only means anything relative to
 * the exam's `totalMarks`. Exams that never set one fall back to the 40% floor
 * `calculateGrade` uses for a D — the lowest passing grade — so the two
 * definitions of "passed" agree instead of quietly disagreeing at the margin.
 */
export function passThresholdPercent(exam: Pick<Exam, "passingMarks" | "totalMarks">): number {
  const total = Number(exam?.totalMarks) || 0;
  const passing = Number(exam?.passingMarks) || 0;
  if (total > 0 && passing > 0) return (passing / total) * 100;
  return 40;
}

/**
 * Normalises a graded answer document into a comparable outcome.
 *
 * Returns `null` for anything not yet graded. An ungraded submission is not a
 * zero — counting it as one would drag every average down and make a pass rate
 * report on work nobody has marked.
 */
export function scoreSubmission(
  answer: Answer,
  exam: Pick<Exam, "passingMarks" | "totalMarks"> | undefined
): ScoredSubmission | null {
  const score = Number(answer?.score);
  if (!Number.isFinite(score)) return null;

  // Prefer the marks recorded on the submission — an exam edited after the fact
  // must not retroactively change a result that was already issued.
  const totalMarks = Number(answer?.totalMarks) || Number(exam?.totalMarks) || 0;
  if (totalMarks <= 0) return null;

  const percentage = Math.max(0, Math.min(100, (score / totalMarks) * 100));
  const { grade, gpa } = calculateGrade(percentage);
  const threshold = exam ? passThresholdPercent(exam) : 40;

  return {
    answerId: answer.id,
    examId: String(answer.examId || ""),
    studentId: String(answer.studentId || ""),
    studentName: String(answer.studentName || ""),
    score,
    totalMarks,
    percentage,
    grade: grade as Grade,
    gpa,
    passed: percentage >= threshold,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Aggregate a set of scored submissions into the numbers a dashboard shows. */
export function summarise(scored: ScoredSubmission[]): PerformanceSummary {
  const percentages = scored.map((s) => s.percentage);
  const counts = new Map<string, number>(GRADE_ORDER.map((g) => [g, 0]));
  for (const s of scored) counts.set(s.grade, (counts.get(s.grade) || 0) + 1);

  const passed = scored.filter((s) => s.passed).length;

  return {
    submissions: scored.length,
    students: new Set(scored.map((s) => s.studentId)).size,
    passed,
    failed: scored.length - passed,
    passRate: scored.length ? (passed / scored.length) * 100 : null,
    averagePercentage: mean(percentages),
    medianPercentage: median(percentages),
    highestPercentage: percentages.length ? Math.max(...percentages) : null,
    lowestPercentage: percentages.length ? Math.min(...percentages) : null,
    averageGpa: mean(scored.map((s) => s.gpa)),
    gradeDistribution: GRADE_ORDER.map((grade) => ({
      label: grade,
      count: counts.get(grade) || 0,
    })),
  };
}

/** A named slice of the data (one exam, one course, one batch, one teacher). */
export interface GroupedSummary extends PerformanceSummary {
  key: string;
  label: string;
  sublabel?: string;
}

/**
 * Groups submissions by an arbitrary key and summarises each group.
 *
 * Groups are ordered by average score descending, then by submission count —
 * a leaderboard read top-down, with a stable order for ties so the rows do not
 * shuffle between refreshes.
 */
export function summariseBy(
  scored: ScoredSubmission[],
  keyOf: (submission: ScoredSubmission) => { key: string; label: string; sublabel?: string } | null
): GroupedSummary[] {
  const groups = new Map<string, { label: string; sublabel?: string; items: ScoredSubmission[] }>();

  for (const submission of scored) {
    const identity = keyOf(submission);
    if (!identity) continue;
    const existing = groups.get(identity.key);
    if (existing) {
      existing.items.push(submission);
    } else {
      groups.set(identity.key, {
        label: identity.label,
        sublabel: identity.sublabel,
        items: [submission],
      });
    }
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: group.label,
      sublabel: group.sublabel,
      ...summarise(group.items),
    }))
    .sort(
      (a, b) =>
        (b.averagePercentage ?? -1) - (a.averagePercentage ?? -1) ||
        b.submissions - a.submissions ||
        a.label.localeCompare(b.label)
    );
}

/**
 * Students who have not submitted anything for an exam they were assigned.
 *
 * Reported separately rather than folded into "failed": not sitting an exam and
 * failing it are different problems with different remedies, and merging them
 * is how a pass rate ends up lying.
 */
export function nonSubmitters(exam: Exam, scored: ScoredSubmission[], students: User[]): User[] {
  const targets = new Set(exam.targetStudentIds || []);
  if (targets.size === 0) return [];
  const submitted = new Set(scored.filter((s) => s.examId === exam.id).map((s) => s.studentId));
  return students.filter((student) => targets.has(student.id) && !submitted.has(student.id));
}
