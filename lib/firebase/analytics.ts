/**
 * Data loading for the analytics dashboards.
 *
 * Kept apart from `lib/analytics/exam-analytics.ts`, which holds the pure
 * maths. This file only decides WHICH documents a given role may aggregate:
 *
 *   - a teacher sees their own exams and the submissions to them;
 *   - an admin sees everything.
 *
 * Both scopes are already what `firestore.rules` permits, so the queries here
 * cannot pull anything the caller could not read directly — but resolving the
 * scope explicitly means the numbers on a teacher's dashboard describe their
 * own teaching rather than the whole institution.
 */
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./config";
import { getAllExams, getExamsByTeacher } from "./exams";
import type { Answer, Exam, User } from "../types";

/** Firestore rejects an `in` filter with more than 30 values. */
const IN_CHUNK = 30;

function chunked<T>(values: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Every graded/ungraded submission belonging to the given exams. */
async function getAnswersForExams(examIds: string[]): Promise<Answer[]> {
  if (examIds.length === 0) return [];
  const answers: Answer[] = [];
  for (const chunk of chunked(examIds)) {
    const snap = await getDocs(query(collection(db, "answers"), where("examId", "in", chunk)));
    snap.docs.forEach((d) => answers.push({ ...(d.data() as any), id: d.id } as Answer));
  }
  return answers;
}

export interface AnalyticsDataset {
  exams: Exam[];
  answers: Answer[];
  /** Only populated for the admin scope, which needs teacher/student names. */
  users: User[];
}

/** Everything one teacher's analytics page needs, in one round of reads. */
export async function loadTeacherAnalytics(teacherId: string): Promise<AnalyticsDataset> {
  const exams = await getExamsByTeacher(teacherId);
  const answers = await getAnswersForExams(exams.map((e) => e.id));
  return { exams, answers, users: [] };
}

/** Institution-wide dataset for the admin analytics page. */
export async function loadAdminAnalytics(): Promise<AnalyticsDataset> {
  const [exams, usersSnap] = await Promise.all([
    getAllExams(),
    getDocs(collection(db, "users")),
  ]);
  const users = usersSnap.docs.map((d) => ({ ...(d.data() as any), id: d.id } as User));
  const answers = await getAnswersForExams(exams.map((e) => e.id));
  return { exams, answers, users };
}
