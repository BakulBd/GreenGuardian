/**
 * When a piece of classwork will accept a hand-in.
 *
 * Pure and dependency-free so the same answer is reached in three places that
 * must never disagree: the student's UI (which disables the button), the
 * client hand-in helper (which explains *why*), and `firestore.rules` (which
 * is the only one of the three a determined caller cannot skip). The rule is
 * written separately in the rules language, but it is written against exactly
 * the logic below — see the `classroomSubmissions` create rule.
 *
 * Unit-tested in `tests/submission-window.test.ts`.
 */

/** The classwork fields this decision actually depends on. */
export interface SubmissionWindowInput {
  dueDate?: unknown;
  /**
   * Whether work handed in after the due date is accepted.
   *
   * Undefined means "not set", which is treated as ALLOWED. Every assignment
   * created before this field existed accepted late work — silently switching
   * those to reject it would lock out students mid-term on rules they were
   * never shown. New assignments get an explicit value from the create form.
   */
  lateSubmissionAllowed?: boolean;
}

export type SubmissionWindowState =
  /** No deadline set, or the deadline has not passed. */
  | "open"
  /** Past the deadline, but late work is accepted (and will be flagged late). */
  | "open_late"
  /** Past the deadline and late work is refused. */
  | "closed";

export interface SubmissionWindow {
  state: SubmissionWindowState;
  /** Whether a hand-in attempted right now would be accepted. */
  canSubmit: boolean;
  /** Whether a hand-in attempted right now would be recorded as late. */
  isLate: boolean;
  dueAt: Date | null;
  /** Ready-to-render explanation, or "" when there is nothing to explain. */
  message: string;
}

export const LATE_SUBMISSION_BLOCKED_MESSAGE =
  "Late submission is not allowed for this assignment.";

/**
 * Firestore `Timestamp` | `Date` | ISO string | epoch millis -> `Date`.
 *
 * Returns `null` for anything unparseable rather than an Invalid Date, so a
 * malformed due date reads as "no deadline" (open) instead of comparing false
 * against everything and locking every student out.
 */
export function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as any)?.toDate === "function") {
    const converted = (value as any).toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whether this classwork accepts work handed in after its due date. */
export function allowsLateSubmission(classwork: SubmissionWindowInput): boolean {
  return classwork.lateSubmissionAllowed !== false;
}

/**
 * Resolve the submission window for a piece of classwork.
 *
 * @param now Injected so tests are not clock-dependent.
 */
export function getSubmissionWindow(
  classwork: SubmissionWindowInput,
  now: Date = new Date()
): SubmissionWindow {
  const dueAt = toDateOrNull(classwork.dueDate);
  const lateAllowed = allowsLateSubmission(classwork);

  // No deadline means nothing can be late.
  if (!dueAt) {
    return { state: "open", canSubmit: true, isLate: false, dueAt: null, message: "" };
  }

  const pastDue = now.getTime() > dueAt.getTime();

  if (!pastDue) {
    return { state: "open", canSubmit: true, isLate: false, dueAt, message: "" };
  }

  if (lateAllowed) {
    return {
      state: "open_late",
      canSubmit: true,
      isLate: true,
      dueAt,
      message: "The deadline has passed. Late submission is allowed and your work will be marked late.",
    };
  }

  return {
    state: "closed",
    canSubmit: false,
    isLate: false,
    dueAt,
    message: LATE_SUBMISSION_BLOCKED_MESSAGE,
  };
}

/**
 * Whether a submission arrived after its deadline.
 *
 * Resolved once, at hand-in, and stored on the submission — never recomputed
 * on read. A teacher extending a deadline afterwards must not retroactively
 * un-flag work that genuinely arrived late, nor flag work that did not.
 */
export function resolveLateFlag(classwork: SubmissionWindowInput, submittedAt: Date = new Date()): boolean {
  const dueAt = toDateOrNull(classwork.dueDate);
  if (!dueAt) return false;
  return submittedAt.getTime() > dueAt.getTime();
}
