/**
 * Classwork submissions — the student hand-in and the teacher's evaluation of
 * it.
 *
 * Two deliberate design choices worth stating up front:
 *
 *   1. The document id is `${classworkId}_${studentId}`. A second submission
 *      for the same pair is therefore an UPDATE of an existing document, not a
 *      new one, so duplicate hand-ins are impossible by construction rather
 *      than by a uniqueness check that races.
 *   2. Marks are written only by the grading functions here, and
 *      `firestore.rules` refuses a student write that touches any grading
 *      field. A student may edit their own work right up until it is returned;
 *      after that the record is closed to them.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./config";
import type {
  ClassroomAttachment,
  ClassworkItem,
  ClassworkSubmission,
  User,
} from "../types";
import {
  getSubmissionWindow,
  resolveLateFlag,
  LATE_SUBMISSION_BLOCKED_MESSAGE,
} from "../utils/submission-window";

const SUBMISSIONS = "classroomSubmissions";

export function submissionId(classworkId: string, studentId: string): string {
  return `${classworkId}_${studentId}`;
}

function stripUndefined(data: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) clean[key] = value;
  });
  return clean;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Classwork types a student can actually hand something in for. */
export function isSubmittable(item: Pick<ClassworkItem, "type">): boolean {
  return item.type === "assignment" || item.type === "quiz";
}

export interface SubmitInput {
  classwork: ClassworkItem;
  student: Pick<User, "id" | "name" | "email" | "studentCode">;
  text?: string;
  attachments?: ClassroomAttachment[];
}

/**
 * Creates or replaces the student's own submission.
 *
 * `setDoc` with the deterministic id rather than `addDoc`, so re-submitting
 * before the due date overwrites the previous attempt instead of leaving the
 * teacher with two documents and no way to tell which one counts.
 */
export async function submitClasswork(input: SubmitInput): Promise<string> {
  const { classwork, student } = input;

  if (!isSubmittable(classwork)) {
    throw new Error("This item does not accept submissions.");
  }
  if (classwork.status !== "published") {
    throw new Error("This classwork is not open for submissions yet.");
  }

  // Deadline policy. Checked here so the student gets a sentence they can act
  // on rather than a bare "permission denied" — but the authority is
  // `firestore.rules`, which re-evaluates the same condition against the
  // classwork document and the server's own clock. A student who edits the
  // page, replays the write, or lies about the due date is refused there.
  // Not named `window` — that shadows the global in a module that also runs in
  // the browser.
  const submissionWindow = getSubmissionWindow(classwork);
  if (!submissionWindow.canSubmit) {
    throw new Error(LATE_SUBMISSION_BLOCKED_MESSAGE);
  }

  const text = input.text?.trim() || "";
  const attachments = input.attachments || [];
  if (!text && attachments.length === 0) {
    throw new Error("Add some text or attach a file before submitting.");
  }

  const id = submissionId(classwork.id, student.id);
  const ref = doc(db, SUBMISSIONS, id);
  const existing = await readSubmissionSafely(ref);

  if (existing?.exists() && existing.data()?.status === "returned") {
    throw new Error("This submission has already been marked and can no longer be changed.");
  }

  // `null` means the pre-read itself was refused (an older ruleset that still
  // denies the not-yet-existing document). Optimistically take the create
  // path; if the document turns out to exist, the rules reject the create and
  // the revision path below runs instead. The student never sees either.
  if (existing === null) {
    try {
      await createSubmission(ref, input, text, attachments);
      return id;
    } catch (error: any) {
      if (error?.code !== "permission-denied") throw error;
      await updateDoc(ref, stripUndefined({ text, attachments, updatedAt: serverTimestamp() }));
      return id;
    }
  }

  if (existing.exists()) {
    // REVISION. `firestore.rules` lets a student change only
    // ['text', 'attachments', 'updatedAt', 'submittedAt'] on their own
    // submission, and `diff().affectedKeys()` counts every field whose value
    // actually changed. Re-sending the whole create payload therefore failed
    // with permission-denied the moment any of the other fields drifted —
    // `late` flipping once the due date passed, or `classworkTitle` after the
    // teacher renamed the assignment. Writing only what a student is allowed
    // to change keeps the write inside the rule by construction.
    await updateDoc(
      ref,
      stripUndefined({
        text,
        attachments,
        updatedAt: serverTimestamp(),
      })
    );
    return id;
  }

  await createSubmission(ref, input, text, attachments);
  return id;
}

/**
 * Reads the student's own submission, returning `null` when the read itself
 * was refused rather than propagating the error.
 *
 * A first hand-in necessarily reads a document that does not exist yet, and a
 * ruleset that dereferences the missing `resource` denies that read — which
 * surfaced to students as "insufficient permissions" on an assignment they
 * were perfectly entitled to submit. `firestore.rules` now allows a student to
 * probe their own submission id whether or not the document exists; this stays
 * defensive so a deployment running an older ruleset degrades to "let the
 * write decide" instead of blocking hand-in entirely.
 */
async function readSubmissionSafely(ref: ReturnType<typeof doc>) {
  try {
    return await getDoc(ref);
  } catch (error: any) {
    console.warn("[Submissions] Submission pre-read unavailable:", error?.code || error);
    return null;
  }
}

/** Writes the full first-hand-in payload. Split out so it has exactly one caller shape. */
async function createSubmission(
  ref: ReturnType<typeof doc>,
  input: SubmitInput,
  text: string,
  attachments: ClassroomAttachment[]
): Promise<void> {
  const { classwork, student } = input;
  const due = toDate(classwork.dueDate);

  await setDoc(
    ref,
    stripUndefined({
      classroomId: classwork.classroomId,
      classworkId: classwork.id,
      classworkTitle: classwork.title,
      teacherId: classwork.teacherId,
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      studentCode: student.studentCode,
      text,
      attachments,
      status: "submitted",
      // Lateness is resolved once, at hand-in. Recomputing it on read would
      // let a teacher extending the deadline retroactively un-flag work that
      // genuinely arrived late — and vice versa.
      late: resolveLateFlag(classwork),
      // The deadline AS IT STOOD at hand-in, denormalized so the teacher's
      // review can show "submitted 10:35pm / deadline 9:00pm" without a second
      // read, and so the comparison still reads correctly if the teacher moves
      // the due date afterwards.
      dueAtSubmission: due || null,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

/** Withdraws a submission so the student can work on it again. */
export async function unsubmitClasswork(classworkId: string, studentId: string): Promise<void> {
  const id = submissionId(classworkId, studentId);
  const existing = await readSubmissionSafely(doc(db, SUBMISSIONS, id));
  if (!existing) {
    // Could not read it; the delete rule still checks ownership and status.
    await deleteDoc(doc(db, SUBMISSIONS, id));
    return;
  }
  if (!existing.exists()) return;
  if (existing.data()?.status === "returned") {
    throw new Error("This submission has already been marked and can no longer be withdrawn.");
  }
  await deleteDoc(doc(db, SUBMISSIONS, id));
}

export async function getOwnSubmission(
  classworkId: string,
  studentId: string
): Promise<ClassworkSubmission | null> {
  const snap = await readSubmissionSafely(doc(db, SUBMISSIONS, submissionId(classworkId, studentId)));
  return snap?.exists() ? ({ ...snap.data(), id: snap.id } as ClassworkSubmission) : null;
}

/** Live view of one student's own submission. */
export function subscribeToOwnSubmission(
  classworkId: string,
  studentId: string,
  callback: (submission: ClassworkSubmission | null) => void
): () => void {
  return onSnapshot(
    doc(db, SUBMISSIONS, submissionId(classworkId, studentId)),
    (snap) => callback(snap.exists() ? ({ ...snap.data(), id: snap.id } as ClassworkSubmission) : null),
    (error) => {
      console.warn("[Submissions] Own-submission subscription error:", error.code || error);
      callback(null);
    }
  );
}

function sortSubmissions(items: ClassworkSubmission[]): ClassworkSubmission[] {
  return items.sort((a, b) => {
    // Ungraded first — that is the teacher's actual queue — then by name so
    // the order is stable between refreshes.
    const aPending = a.status !== "returned" ? 0 : 1;
    const bPending = b.status !== "returned" ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return (a.studentName || "").localeCompare(b.studentName || "");
  });
}

export interface SubmissionQueryOptions {
  /**
   * The signed-in teacher's uid. REQUIRED for a teacher; omitted for an admin.
   *
   * This is not a convenience filter — it is what makes the query legal.
   * Firestore evaluates a list query against the rules STATICALLY: it will only
   * run one it can prove returns nothing unreadable. The teacher's read grant
   * is `resource.data.teacherId == request.auth.uid`, so a query filtered on
   * `classworkId` alone is not provably safe and is refused outright with
   * `permission-denied` — which is exactly why "Review submissions" came back
   * empty for every teacher, on classwork they owned, with students' work
   * sitting in the collection. Constraining `teacherId` in the query itself is
   * what lets the rule engine discharge the condition.
   *
   * Admins read under `isAdmin()`, which has no per-document condition, so
   * they must NOT pass this — filtering on their own uid would return nothing.
   */
  teacherId?: string;
}

/** Every submission for one piece of classwork (teacher/admin view). */
export function subscribeToClassworkSubmissions(
  classworkId: string,
  callback: (submissions: ClassworkSubmission[]) => void,
  onError?: (error: any) => void,
  options?: SubmissionQueryOptions
): () => void {
  const constraints = [where("classworkId", "==", classworkId)];
  if (options?.teacherId) constraints.push(where("teacherId", "==", options.teacherId));
  const q = query(collection(db, SUBMISSIONS), ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      callback(
        sortSubmissions(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassworkSubmission)))
      );
    },
    (error) => {
      console.warn("[Submissions] Classwork submissions subscription error:", error.code || error);
      callback([]);
      onError?.(error);
    }
  );
}

export async function getClassworkSubmissions(
  classworkId: string,
  options?: SubmissionQueryOptions
): Promise<ClassworkSubmission[]> {
  const constraints = [where("classworkId", "==", classworkId)];
  // Same rule-satisfaction requirement as the subscription above.
  if (options?.teacherId) constraints.push(where("teacherId", "==", options.teacherId));
  const snap = await getDocs(query(collection(db, SUBMISSIONS), ...constraints));
  return sortSubmissions(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassworkSubmission)));
}

export interface GradeInput {
  submissionId: string;
  marks: number;
  totalMarks: number;
  feedback?: string;
  grader: Pick<User, "id" | "name">;
}

/**
 * Records a teacher's evaluation and returns the submission to the student.
 *
 * The mark is validated here as well as in the UI: a grade above the item's
 * total, or a negative one, is a data error that would silently corrupt every
 * average computed from it downstream.
 *
 * Safe to call again on an already-returned submission — correcting a mark is
 * an ordinary thing for a teacher to do, and making them reopen the work
 * (which invites the student to resubmit) just to fix a typo was worse. The
 * update is idempotent and the student simply sees the new number.
 */
export async function gradeSubmission(input: GradeInput): Promise<void> {
  const { marks, totalMarks } = input;
  if (!Number.isFinite(marks) || marks < 0) {
    throw new Error("Enter a mark of zero or more.");
  }
  if (totalMarks > 0 && marks > totalMarks) {
    throw new Error(`The mark cannot exceed the total of ${totalMarks}.`);
  }

  await updateDoc(
    doc(db, SUBMISSIONS, input.submissionId),
    stripUndefined({
      marks,
      totalMarks,
      feedback: input.feedback?.trim() || "",
      status: "returned",
      gradedBy: input.grader.id,
      gradedByName: input.grader.name,
      gradedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

/** Reopens a returned submission so the student can revise and resubmit. */
export async function returnForRevision(submissionIdValue: string): Promise<void> {
  await updateDoc(doc(db, SUBMISSIONS, submissionIdValue), {
    status: "submitted",
    updatedAt: serverTimestamp(),
  });
}

/**
 * Stores the machine-assisted reading of a submission.
 *
 * Written separately from `gradeSubmission` and never touching `marks`: the
 * suggestion informs the teacher, it does not grade the student.
 */
export async function saveAiSuggestion(
  submissionIdValue: string,
  suggestion: { ocrText?: string; aiSuggestedMarks?: number; aiRationale?: string }
): Promise<void> {
  await updateDoc(
    doc(db, SUBMISSIONS, submissionIdValue),
    stripUndefined({
      ocrText: suggestion.ocrText,
      aiSuggestedMarks: suggestion.aiSuggestedMarks,
      aiRationale: suggestion.aiRationale,
      aiCheckedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

/** Aggregate progress for a teacher's classwork card. */
export function submissionProgress(submissions: ClassworkSubmission[]): {
  total: number;
  graded: number;
  pending: number;
  late: number;
} {
  const graded = submissions.filter((s) => s.status === "returned").length;
  return {
    total: submissions.length,
    graded,
    pending: submissions.length - graded,
    late: submissions.filter((s) => s.late).length,
  };
}
