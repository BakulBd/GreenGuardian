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
  return docRef.id;
}

export async function getExam(examId: string): Promise<Exam | null> {
  const examDoc = await getDoc(doc(db, "exams", examId));
  if (!examDoc.exists()) return null;
  return { ...examDoc.data(), id: examDoc.id } as Exam;
}

export async function getExamsByTeacher(teacherId: string): Promise<Exam[]> {
  const q = query(
    collection(db, "exams"),
    where("teacherId", "==", teacherId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Exam));
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
  await deleteDoc(doc(db, "exams", examId));
}

// Questions
export async function createQuestion(questionData: Omit<Question, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const docRef = await addDoc(collection(db, "questions"), {
    ...questionData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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
    where("examId", "==", examId),
    orderBy("order", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Question));
}

export async function updateQuestion(questionId: string, data: Partial<Question>): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await deleteDoc(doc(db, "questions", questionId));
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
    where("examId", "==", examId),
    orderBy("startTime", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as ExamSession));
}

export async function getSessionsByStudent(studentId: string): Promise<ExamSession[]> {
  const q = query(
    collection(db, "examSessions"),
    where("studentId", "==", studentId),
    orderBy("startTime", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as ExamSession));
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
