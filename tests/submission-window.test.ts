/**
 * Tests for the deadline policy behind "Late Submission Allowed".
 *
 * The same decision is made in three places — the student's button state, the
 * client hand-in helper's error message, and `firestore.rules` — and they must
 * agree. Two of the three read this module; the third is written against it by
 * hand, so the cases below double as the specification the rule is checked
 * against by eye.
 */
import { describe, it, expect } from "vitest";
import {
  allowsLateSubmission,
  getSubmissionWindow,
  LATE_SUBMISSION_BLOCKED_MESSAGE,
  resolveLateFlag,
  toDateOrNull,
} from "@/lib/utils/submission-window";

const DEADLINE = new Date("2026-08-28T21:00:00Z");
const BEFORE = new Date("2026-08-28T20:00:00Z");
const AFTER = new Date("2026-08-28T22:35:00Z");

describe("toDateOrNull", () => {
  it("accepts the shapes a due date actually arrives in", () => {
    expect(toDateOrNull(DEADLINE)).toEqual(DEADLINE);
    expect(toDateOrNull("2026-08-28T21:00:00Z")).toEqual(DEADLINE);
    expect(toDateOrNull(DEADLINE.getTime())).toEqual(DEADLINE);
    // Firestore Timestamp
    expect(toDateOrNull({ toDate: () => DEADLINE })).toEqual(DEADLINE);
  });

  it("treats anything unparseable as no deadline rather than an invalid one", () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
    expect(toDateOrNull("")).toBeNull();
    expect(toDateOrNull("not a date")).toBeNull();
    expect(toDateOrNull(new Date("nonsense"))).toBeNull();
    expect(toDateOrNull({ toDate: () => new Date("nonsense") })).toBeNull();
  });
});

describe("allowsLateSubmission", () => {
  it("only false blocks — undefined stays permissive for existing classwork", () => {
    expect(allowsLateSubmission({})).toBe(true);
    expect(allowsLateSubmission({ lateSubmissionAllowed: undefined })).toBe(true);
    expect(allowsLateSubmission({ lateSubmissionAllowed: true })).toBe(true);
    expect(allowsLateSubmission({ lateSubmissionAllowed: false })).toBe(false);
  });
});

describe("getSubmissionWindow", () => {
  it("is open before the deadline, whatever the late policy", () => {
    for (const lateSubmissionAllowed of [true, false, undefined]) {
      const window = getSubmissionWindow({ dueDate: DEADLINE, lateSubmissionAllowed }, BEFORE);
      expect(window.state).toBe("open");
      expect(window.canSubmit).toBe(true);
      expect(window.isLate).toBe(false);
      expect(window.message).toBe("");
    }
  });

  it("is open with no deadline at all", () => {
    const window = getSubmissionWindow({ lateSubmissionAllowed: false }, AFTER);
    expect(window.state).toBe("open");
    expect(window.canSubmit).toBe(true);
    expect(window.dueAt).toBeNull();
  });

  it("accepts and flags late work when late submission is allowed", () => {
    const window = getSubmissionWindow(
      { dueDate: DEADLINE, lateSubmissionAllowed: true },
      AFTER
    );
    expect(window.state).toBe("open_late");
    expect(window.canSubmit).toBe(true);
    expect(window.isLate).toBe(true);
    expect(window.message).toContain("Late submission is allowed");
  });

  it("refuses late work when late submission is off", () => {
    const window = getSubmissionWindow(
      { dueDate: DEADLINE, lateSubmissionAllowed: false },
      AFTER
    );
    expect(window.state).toBe("closed");
    expect(window.canSubmit).toBe(false);
    expect(window.isLate).toBe(false);
    expect(window.message).toBe(LATE_SUBMISSION_BLOCKED_MESSAGE);
  });

  it("keeps classwork that predates the toggle open after its deadline", () => {
    // The back-compat case that matters: an assignment created before
    // `lateSubmissionAllowed` existed must not start rejecting students.
    const window = getSubmissionWindow({ dueDate: DEADLINE }, AFTER);
    expect(window.state).toBe("open_late");
    expect(window.canSubmit).toBe(true);
  });

  it("is still open exactly on the deadline", () => {
    const window = getSubmissionWindow(
      { dueDate: DEADLINE, lateSubmissionAllowed: false },
      new Date(DEADLINE)
    );
    expect(window.canSubmit).toBe(true);
    expect(window.isLate).toBe(false);
  });

  it("closes one millisecond after the deadline", () => {
    const window = getSubmissionWindow(
      { dueDate: DEADLINE, lateSubmissionAllowed: false },
      new Date(DEADLINE.getTime() + 1)
    );
    expect(window.canSubmit).toBe(false);
  });

  it("stays open when the due date is unusable rather than locking everyone out", () => {
    const window = getSubmissionWindow(
      { dueDate: "garbage", lateSubmissionAllowed: false },
      AFTER
    );
    expect(window.state).toBe("open");
    expect(window.canSubmit).toBe(true);
  });

  it("reports the deadline so the UI can show it", () => {
    expect(getSubmissionWindow({ dueDate: DEADLINE }, AFTER).dueAt).toEqual(DEADLINE);
  });
});

describe("resolveLateFlag", () => {
  it("flags only work that actually arrived after the deadline", () => {
    expect(resolveLateFlag({ dueDate: DEADLINE }, BEFORE)).toBe(false);
    expect(resolveLateFlag({ dueDate: DEADLINE }, AFTER)).toBe(true);
    expect(resolveLateFlag({ dueDate: DEADLINE }, new Date(DEADLINE))).toBe(false);
  });

  it("never flags work for classwork with no deadline", () => {
    expect(resolveLateFlag({}, AFTER)).toBe(false);
  });

  it("is independent of the late-submission policy", () => {
    // A submission accepted under "late allowed" is still LATE — the policy
    // decides whether it is taken, not whether it is flagged.
    expect(resolveLateFlag({ dueDate: DEADLINE, lateSubmissionAllowed: true }, AFTER)).toBe(true);
  });
});
