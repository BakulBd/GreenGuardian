/**
 * Server-side loading of an exam's question set, answer keys included.
 *
 * Mirrors the read half of `getQuestionsByExam()` (lib/firebase/exams.ts) but
 * for the Admin SDK, and deliberately **without** its migration side effect:
 * the client version writes missing questions back into the `questions`
 * collection while reading, which is not something a student's grade request
 * should be able to trigger.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { GradableQuestion } from "./grading";

/**
 * Recursively convert Firestore `Timestamp`s to ISO strings.
 *
 * The Admin SDK serialises a Timestamp to `{_seconds, _nanoseconds}` over
 * JSON, which `new Date(...)` reads as `Invalid Date`. Exam clients do date
 * maths on `endDate`/`startDate`, so timestamps are normalised here instead.
 */
export function serializeFirestoreData<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (typeof (value as any)?.toDate === "function") {
    return (value as any).toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeFirestoreData(item)) as unknown as T;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeFirestoreData(item);
    }
    return out as unknown as T;
  }

  return value;
}

/**
 * Load an exam's questions with their answer keys.
 *
 * The `questions` collection is the source of truth; the array embedded on the
 * exam document is a denormalized copy kept for older exams (and, since the
 * answer-key hardening, one that no longer carries `correctAnswer`). The
 * embedded copy is therefore only a fallback for exams whose questions were
 * never split out.
 *
 * @param examData Pre-read exam document data, when the caller already has it.
 */
export async function loadExamQuestions(
  db: Firestore,
  examId: string,
  examData?: Record<string, any>
): Promise<GradableQuestion[]> {
  const snapshot = await db.collection("questions").where("examId", "==", examId).get();

  if (!snapshot.empty) {
    return snapshot.docs
      .map((doc) => serializeFirestoreData({ ...doc.data(), id: doc.id }) as GradableQuestion & {
        order?: number;
      })
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  const exam = examData ?? (await db.collection("exams").doc(examId).get()).data() ?? {};
  const embedded = Array.isArray(exam.questions) ? exam.questions : [];
  return embedded.map((q: any, index: number) =>
    serializeFirestoreData({ ...q, id: q.id ?? String(index) })
  ) as GradableQuestion[];
}
