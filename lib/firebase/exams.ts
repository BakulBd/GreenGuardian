import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  addDoc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "./config";
import { Exam, Question, ExamSession, Answer, ExamLog } from "../types";

/**
 * Remove answer keys from the question array that gets denormalized onto the
 * exam document.
 *
 * `exams/{id}` is readable by every targeted student (they need the title,
 * duration and instructions), so anything stored on it is public to the class.
 * The embedded `questions` array used to be a verbatim copy — answer keys
 * included — which meant the key was one `getDoc` away for any student, no
 * matter how tightly the `questions` collection itself was locked down.
 *
 * The full question, with its key, lives only in the `questions` collection
 * (staff + Admin SDK) and in the post-submission `questionSnapshot`.
 */
export function stripAnswerKeys<T extends Record<string, any>>(questions: T[]): T[] {
  return questions.map((q) => {
    const { correctAnswer: _correctAnswer, explanation: _explanation, ...rest } = q;
    return rest as T;
  });
}

// Exams
/**
 * The admin's global proctoring defaults (settings/global.proctoring), used to
 * seed a newly created exam. Exam creation used to hardcode all three flags to
 * `true`, which made the corresponding admin switches decorative.
 *
 * Falls back to the safe (all-on) defaults if the document is missing or
 * unreadable — creating an exam must never fail because of a settings read.
 */
export async function getGlobalProctoringDefaults(): Promise<{
  faceDetection: boolean;
  tabSwitchDetection: boolean;
  fullscreenRequired: boolean;
}> {
  const fallback = {
    faceDetection: true,
    tabSwitchDetection: true,
    fullscreenRequired: true,
  };
  try {
    const snap = await getDoc(doc(db, "settings", "global"));
    const configured = snap.exists() ? (snap.data()?.proctoring ?? {}) : {};
    return {
      faceDetection: configured.faceDetection ?? fallback.faceDetection,
      tabSwitchDetection: configured.tabSwitchDetection ?? fallback.tabSwitchDetection,
      fullscreenRequired: configured.fullscreenRequired ?? fallback.fullscreenRequired,
    };
  } catch {
    return fallback;
  }
}

export async function createExam(examData: Omit<Exam, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const docRef = await addDoc(collection(db, "exams"), {
    ...examData,
    // The exam document is student-readable; the answer key is not.
    ...(Array.isArray(examData.questions)
      ? { questions: stripAnswerKeys(examData.questions as any[]) }
      : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // If questions array was supplied, also create questions in the questions collection
  if (examData.questions && Array.isArray(examData.questions) && examData.questions.length > 0) {
    for (let i = 0; i < examData.questions.length; i++) {
      const q = examData.questions[i];
      await addDoc(collection(db, "questions"), {
        ...q,
        examId: docRef.id,
        order: i,
        courseId: examData.courseId || "",
        batch: examData.batch || "",
        section: examData.section || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  return docRef.id;
}

export async function getExam(examId: string): Promise<Exam | null> {
  const examDoc = await getDoc(doc(db, "exams", examId));
  if (!examDoc.exists()) return null;
  const examData = { ...examDoc.data(), id: examDoc.id } as Exam;
  
  // Always fetch attached questions for this exam
  const questionsData = await getQuestionsByExam(examId);
  return {
    ...examData,
    questions: questionsData,
    questionCount: questionsData.length,
  };
}

export async function getExamsByTeacher(teacherId: string): Promise<Exam[]> {
  const q1 = query(collection(db, "exams"), where("teacherId", "==", teacherId));
  const q2 = query(collection(db, "exams"), where("createdBy", "==", teacherId));

  const [res1, res2] = await Promise.allSettled([getDocs(q1), getDocs(q2)]);
  const map = new Map<string, Exam>();

  if (res1.status === "fulfilled") {
    res1.value.docs.forEach((doc) => map.set(doc.id, { ...doc.data(), id: doc.id } as Exam));
  } else {
    console.warn("[getExamsByTeacher] teacherId query failed:", res1.reason);
  }

  if (res2.status === "fulfilled") {
    res2.value.docs.forEach((doc) => map.set(doc.id, { ...doc.data(), id: doc.id } as Exam));
  } else {
    console.warn("[getExamsByTeacher] createdBy query failed:", res2.reason);
  }

  const examsList = Array.from(map.values());
  return examsList.sort((a, b) => {
    const timeA = (a.createdAt as any)?.toDate?.()?.getTime?.() || new Date((a.createdAt as any) || 0).getTime();
    const timeB = (b.createdAt as any)?.toDate?.()?.getTime?.() || new Date((b.createdAt as any) || 0).getTime();
    return timeB - timeA;
  });
}

export async function getAllExams(): Promise<Exam[]> {
  const q = query(collection(db, "exams"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Exam));
}

/**
 * Realtime feed of published/active exams (Feature 5 — "visibility should
 * update automatically"). A student's exam list previously only refreshed
 * on page load, so an exam a teacher just published wouldn't appear until
 * the student manually reloaded.
 */
export function subscribeToPublishedExams(callback: (exams: Exam[]) => void): () => void {
  const q = query(collection(db, "exams"), where("status", "in", ["published", "active"]));
  return onSnapshot(
    q,
    (snapshot) => {
      const exams = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as Exam));
      callback(exams);
    },
    (error) => console.warn("[Exams] Published exams subscription error:", error.code || error)
  );
}

export async function updateExam(examId: string, data: Partial<Exam>): Promise<void> {
  await updateDoc(doc(db, "exams", examId), {
    ...data,
    ...(Array.isArray(data.questions)
      ? { questions: stripAnswerKeys(data.questions as any[]) }
      : {}),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Realtime feed of exams a specific student is allowed to see: published/
 * active AND this student's ID is in the exam's materialized
 * `targetStudentIds` (set at creation from the teacher's Course/Batch/
 * Section assignment — see `computeAssignmentTargetStudentIds`). This one
 * query is also exactly what `firestore.rules` allows a student to read, so
 * it can never come back permission-denied.
 *
 * Exams created before `targetStudentIds` existed won't appear here until
 * an admin runs the one-time backfill (`backfillExamTargetStudentIds`) —
 * the same fail-closed-until-backfilled tradeoff already used for
 * `assignedTeacherIds` (see `backfillAllAssignedTeacherIds`).
 */
export function subscribeToStudentVisibleExams(
  studentId: string,
  callback: (exams: Exam[]) => void,
  onError?: (error: Error) => void
): () => void {
  const q = query(
    collection(db, "exams"),
    where("targetStudentIds", "array-contains", studentId),
    where("status", "in", ["published", "active"])
  );
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as Exam)));
    },
    (error) => {
      console.warn("[Exams] Student-visible exams subscription error:", error.code || error);
      if (onError) onError(error as unknown as Error);
    }
  );
}

/**
 * One-time backfill for exams created before `targetStudentIds` existed.
 * Safe to run repeatedly (recomputes fresh each time). Mirrors
 * `backfillAllAssignedTeacherIds` in lib/firebase/assignments.ts.
 */
export async function backfillExamTargetStudentIds(): Promise<{ examsUpdated: number }> {
  const { computeAssignmentTargetStudentIds } = await import("./assignments");
  const snapshot = await getDocs(collection(db, "exams"));
  let examsUpdated = 0;

  for (const examDoc of snapshot.docs) {
    const data = examDoc.data();
    if (!data.teacherId || !data.courseId || !data.batchId || !data.sectionId) continue;
    if (Array.isArray(data.targetStudentIds) && data.targetStudentIds.length > 0) continue;

    const targetStudentIds = await computeAssignmentTargetStudentIds(
      data.teacherId,
      data.courseId,
      data.batchId,
      data.sectionId
    );
    if (targetStudentIds.length > 0) {
      await updateDoc(doc(db, "exams", examDoc.id), { targetStudentIds });
      examsUpdated++;
    }
  }

  return { examsUpdated };
}

/**
 * Email + in-app notification fan-out when a teacher publishes an exam,
 * reusing the same server-side pattern as classroom post notifications
 * (see /api/exams/notify). Fire-and-forget from the caller's perspective —
 * failures are logged, not surfaced, since the exam itself already saved.
 */
export async function notifyExamPublished(examId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  const { auth } = await import("./config");
  const token = await auth.currentUser?.getIdToken();
  if (!token) return;
  const res = await fetch("/api/exams/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ examId, studentIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Exam notify failed (${res.status})`);
  }
}

export async function deleteExam(examId: string): Promise<void> {
  // Delete associated questions first
  const questions = await getQuestionsByExam(examId);
  for (const q of questions) {
    if (q.id) {
      await deleteDoc(doc(db, "questions", q.id)).catch(() => {});
    }
  }
  await deleteDoc(doc(db, "exams", examId));
}

// Questions
export async function createQuestion(questionData: Omit<Question, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const docRef = await addDoc(collection(db, "questions"), {
    ...questionData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Sync back to embedded questions array on the exam document
  if (questionData.examId) {
    try {
      const remainingQuestions = await getQuestionsByExam(questionData.examId);
      await updateDoc(doc(db, "exams", questionData.examId), {
        questions: stripAnswerKeys(remainingQuestions as any[]),
        questionCount: remainingQuestions.length,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Could not sync embedded questions on exam doc:", e);
    }
  }

  return docRef.id;
}

export async function getQuestion(questionId: string): Promise<Question | null> {
  const questionDoc = await getDoc(doc(db, "questions", questionId));
  if (!questionDoc.exists()) return null;
  return { ...questionDoc.data(), id: questionDoc.id } as Question;
}

export async function getQuestionsByExam(examId: string): Promise<Question[]> {
  const q = query(
    collection(db, "questions"),
    where("examId", "==", examId)
  );
  const snapshot = await getDocs(q);
  let questions = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Question));

  // If questions table has no questions for this examId, check embedded questions in exam document
  if (questions.length === 0) {
    try {
      const examDoc = await getDoc(doc(db, "exams", examId));
      if (examDoc.exists()) {
        const eData = examDoc.data();
        if (Array.isArray(eData?.questions) && eData.questions.length > 0) {
          // Migration/backfill to questions collection
          for (let i = 0; i < eData.questions.length; i++) {
            const item = eData.questions[i];
            const qDocRef = await addDoc(collection(db, "questions"), {
              ...item,
              examId,
              order: i,
              courseId: item.courseId || eData.courseId || "",
              batch: item.batch || eData.batch || "",
              section: item.section || eData.section || "",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            questions.push({
              ...item,
              id: qDocRef.id,
              examId,
              order: i,
            } as Question);
          }
        }
      }
    } catch (err) {
      console.error("Error migrating embedded questions:", err);
    }
  }

  return questions.sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function updateQuestion(questionId: string, data: Partial<Question>): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

  const questionDoc = await getDoc(doc(db, "questions", questionId));
  if (questionDoc.exists()) {
    const examId = questionDoc.data()?.examId || data.examId;
    if (examId) {
      try {
        const remainingQuestions = await getQuestionsByExam(examId);
        await updateDoc(doc(db, "exams", examId), {
          questions: remainingQuestions,
          questionCount: remainingQuestions.length,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn("Could not sync embedded questions on update:", e);
      }
    }
  }
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const questionDoc = await getDoc(doc(db, "questions", questionId));
  const examId = questionDoc.exists() ? questionDoc.data().examId : null;

  await deleteDoc(doc(db, "questions", questionId));

  if (examId) {
    try {
      const remainingQuestions = await getQuestionsByExam(examId);
      await updateDoc(doc(db, "exams", examId), {
        questions: stripAnswerKeys(remainingQuestions as any[]),
        questionCount: remainingQuestions.length,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Could not sync embedded questions on delete:", e);
    }
  }
}

// Exam Sessions
export async function createExamSession(sessionData: Omit<ExamSession, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const docRef = await addDoc(collection(db, "examSessions"), {
    ...sessionData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function getExamSession(sessionId: string): Promise<ExamSession | null> {
  const sessionDoc = await getDoc(doc(db, "examSessions", sessionId));
  if (!sessionDoc.exists()) return null;
  return { ...sessionDoc.data(), id: sessionDoc.id } as ExamSession;
}

export async function getSessionsByExam(examId: string): Promise<ExamSession[]> {
  const q = query(
    collection(db, "examSessions"),
    where("examId", "==", examId)
  );
  const snapshot = await getDocs(q);
  const sessions = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as ExamSession));
  return sessions.sort((a, b) => {
    const aMs = (a.startTime as any)?.toDate?.()?.getTime?.() ?? 0;
    const bMs = (b.startTime as any)?.toDate?.()?.getTime?.() ?? 0;
    return bMs - aMs;
  });
}

export async function getSessionsByStudent(studentId: string): Promise<ExamSession[]> {
  const q = query(
    collection(db, "examSessions"),
    where("studentId", "==", studentId)
  );
  const snapshot = await getDocs(q);
  const sessions = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as ExamSession));
  return sessions.sort((a, b) => {
    const aMs = (a.startTime as any)?.toDate?.()?.getTime?.() ?? 0;
    const bMs = (b.startTime as any)?.toDate?.()?.getTime?.() ?? 0;
    return bMs - aMs;
  });
}

export async function updateExamSession(sessionId: string, data: Partial<ExamSession>): Promise<void> {
  await updateDoc(doc(db, "examSessions", sessionId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// Answers
export async function saveAnswer(answerData: Omit<Answer, "id" | "submittedAt" | "updatedAt">): Promise<string> {
  // Check if answer already exists
  const q = query(
    collection(db, "answers"),
    where("examSessionId", "==", answerData.examSessionId),
    where("questionId", "==", answerData.questionId)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    // Create new answer
    const docRef = await addDoc(collection(db, "answers"), {
      ...answerData,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } else {
    // Update existing answer
    const existingDoc = snapshot.docs[0];
    await updateDoc(doc(db, "answers", existingDoc.id), {
      ...answerData,
      updatedAt: serverTimestamp(),
    });
    return existingDoc.id;
  }
}

export async function getAnswersBySession(sessionId: string): Promise<Answer[]> {
  const q = query(
    collection(db, "answers"),
    where("examSessionId", "==", sessionId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Answer));
}

/** Teacher/admin overall feedback on a submission, shown in the review (Feature 4). */
export async function updateAnswerFeedback(answerId: string, feedback: string): Promise<void> {
  await updateDoc(doc(db, "answers", answerId), {
    teacherFeedback: feedback,
    teacherFeedbackAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function getAnswersByExam(examId: string): Promise<Answer[]> {
  const q = query(
    collection(db, "answers"),
    where("examId", "==", examId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Answer));
}

export async function getAnswersByTeacher(teacherId: string): Promise<any[]> {
  // First fetch exams created by this teacher
  const exams = await getExamsByTeacher(teacherId);
  if (exams.length === 0) return [];

  const examIds = exams.map(e => e.id);
  const answers: any[] = [];

  // Firestore in query allows up to 30 items per batch
  for (let i = 0; i < examIds.length; i += 30) {
    const chunk = examIds.slice(i, i + 30);
    const q = query(
      collection(db, "answers"),
      where("examId", "in", chunk)
    );
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((doc) => {
      answers.push({ ...doc.data(), id: doc.id });
    });
  }

  return answers;
}

export async function getAnswersByQuestion(questionId: string): Promise<Answer[]> {
  const q = query(
    collection(db, "answers"),
    where("questionId", "==", questionId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Answer));
}

// Exam Logs
export async function createExamLog(logData: Omit<ExamLog, "id" | "timestamp">): Promise<string> {
  const docRef = await addDoc(collection(db, "examLogs"), {
    ...logData,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}

export async function getLogsBySession(sessionId: string): Promise<ExamLog[]> {
  const q = query(
    collection(db, "examLogs"),
    where("examSessionId", "==", sessionId),
    orderBy("timestamp", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as ExamLog));
}

