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
} from "firebase/firestore";
import { db } from "./config";
import { Exam, Question, ExamSession, Answer, ExamLog } from "../types";

// Exams
export async function createExam(examData: Omit<Exam, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const docRef = await addDoc(collection(db, "exams"), {
    ...examData,
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

  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  const map = new Map<string, Exam>();

  snap1.docs.forEach((doc) => map.set(doc.id, { ...doc.data(), id: doc.id } as Exam));
  snap2.docs.forEach((doc) => map.set(doc.id, { ...doc.data(), id: doc.id } as Exam));

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

export async function updateExam(examId: string, data: Partial<Exam>): Promise<void> {
  await updateDoc(doc(db, "exams", examId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
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
        questions: remainingQuestions,
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
        questions: remainingQuestions,
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

