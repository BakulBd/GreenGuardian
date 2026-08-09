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

  const text = input.text?.trim() || "";
  const attachments = input.attachments || [];
  if (!text && attachments.length === 0) {
    throw new Error("Add some text or attach a file before submitting.");
  }

  const id = submissionId(classwork.id, student.id);
  const existing = await getDoc(doc(db, SUBMISSIONS, id));
  if (existing.exists() && existing.data()?.status === "returned") {
    throw new Error("This submission has already been marked and can no longer be changed.");
  }

  const due = toDate(classwork.dueDate);

  await setDoc(
    doc(db, SUBMISSIONS, id),
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
      late: due ? Date.now() > due.getTime() : false,
      submittedAt: existing.exists() ? existing.data()?.submittedAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );

  return id;
}

/** Withdraws a submission so the student can work on it again. */
export async function unsubmitClasswork(classworkId: string, studentId: string): Promise<void> {
  const id = submissionId(classworkId, studentId);
  const existing = await getDoc(doc(db, SUBMISSIONS, id));
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
  const snap = await getDoc(doc(db, SUBMISSIONS, submissionId(classworkId, studentId)));
  return snap.exists() ? ({ ...snap.data(), id: snap.id } as ClassworkSubmission) : null;
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

/** Every submission for one piece of classwork (teacher/admin view). */
export function subscribeToClassworkSubmissions(
  classworkId: string,
  callback: (submissions: ClassworkSubmission[]) => void,
  onError?: (error: any) => void
): () => void {
  const q = query(collection(db, SUBMISSIONS), where("classworkId", "==", classworkId));
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

export async function getClassworkSubmissions(classworkId: string): Promise<ClassworkSubmission[]> {
  const snap = await getDocs(
    query(collection(db, SUBMISSIONS), where("classworkId", "==", classworkId))
  );
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
