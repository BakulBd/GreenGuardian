import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "./config";
import { Result, ResultSubject, StudentWarning, ResultFilters, WarningType, WarningStatus } from "../types";

// ===================== Results =====================

/**
 * Get all published results for a student, with optional filters.
 * Results are sorted by resultPublishedDate descending (latest first).
 */
export async function getStudentResults(
  studentId: string,
  filters?: ResultFilters
): Promise<Result[]> {
  const combinedResults: Result[] = [];
  const processedExamIds = new Set<string>();

  // 1. Fetch from 'results' collection
  try {
    const q = query(
      collection(db, "results"),
      where("studentId", "==", studentId),
      where("isPublished", "==", true)
    );
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((docSnap) => {
      const r = { id: docSnap.id, ...docSnap.data() } as Result;
      combinedResults.push(r);
      if (r.examId) processedExamIds.add(r.examId);
    });
  } catch (error) {
    console.warn("Error fetching from results collection:", error);
  }

  // 2. Fetch completed examSessions for student (so submitted online exams show automatically)
  try {
    const sQuery = query(
      collection(db, "examSessions"),
      where("studentId", "==", studentId)
    );
    const sSnapshot = await getDocs(sQuery);

    for (const docSnap of sSnapshot.docs) {
      const sData = docSnap.data();
      const isSubmitted =
        sData.submitted === true ||
        sData.status === "submitted" ||
        sData.status === "auto-submitted" ||
        sData.status === "completed";

      if (!isSubmitted) continue;

      // Avoid duplicate if already present in results collection
      if (sData.examId && processedExamIds.has(sData.examId)) {
        continue;
      }

      const obtained = sData.score ?? 0;
      const total = sData.totalMarks || 100;
      const percentage = total > 0 ? (obtained / total) * 100 : 0;
      const gradeInfo = calculateGrade(percentage);

      combinedResults.push({
        id: docSnap.id,
        studentId: sData.studentId,
        studentName: sData.studentName || "Student",
        examName: sData.examTitle || "Online Exam",
        courseName: sData.courseName || sData.courseId || "CSE Course",
        batchName: sData.batch || "N/A",
        sectionName: sData.section || "N/A",
        totalMarks: total,
        obtainedMarks: obtained,
        percentage: percentage,
        grade: gradeInfo.grade,
        gpa: gradeInfo.gpa,
        passFailStatus: gradeInfo.isPassed ? "Pass" : "Fail",
        isPublished: true,
        resultPublishedDate: sData.completedAt || sData.createdAt || new Date(),
        academicYear: new Date().getFullYear().toString(),
        examId: sData.examId,
      } as Result);
    }
  } catch (error) {
    console.warn("Error fetching from examSessions fallback:", error);
  }

  // 3. Client-side Filter Application
  let filtered = combinedResults;

  if (filters?.courseName) {
    filtered = filtered.filter((r) => r.courseName === filters.courseName);
  }
  if (filters?.batchName) {
    filtered = filtered.filter((r) => r.batchName === filters.batchName);
  }
  if (filters?.sectionName) {
    filtered = filtered.filter((r) => r.sectionName === filters.sectionName);
  }
  if (filters?.semester) {
    filtered = filtered.filter((r) => r.semester === filters.semester);
  }
  if (filters?.academicYear) {
    filtered = filtered.filter((r) => r.academicYear === filters.academicYear);
  }
  if (filters?.examName) {
    filtered = filtered.filter((r) => r.examName === filters.examName);
  }
  if (filters?.searchQuery) {
    const qTerm = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.examName?.toLowerCase().includes(qTerm) ||
        r.courseName?.toLowerCase().includes(qTerm)
    );
  }

  // Sort descending by date
  filtered.sort((a, b) => {
    const dateA = (a.resultPublishedDate as any)?.toDate ? (a.resultPublishedDate as any).toDate().getTime() : new Date(a.resultPublishedDate as any || 0).getTime();
    const dateB = (b.resultPublishedDate as any)?.toDate ? (b.resultPublishedDate as any).toDate().getTime() : new Date(b.resultPublishedDate as any || 0).getTime();
    return dateB - dateA;
  });

  return filtered;
}

/**
 * Get the latest published result for a student.
 */
export async function getLatestResult(studentId: string): Promise<Result | null> {
  const results = await getStudentResults(studentId);
  return results.length > 0 ? results[0] : null;
}

/**
 * Get complete result history for a student (all published results).
 */
export async function getResultHistory(studentId: string): Promise<Result[]> {
  return getStudentResults(studentId);
}

/**
 * Get full details of a single result by ID.
 */
export async function getResultDetails(resultId: string): Promise<Result | null> {
  try {
    const resultDoc = await getDoc(doc(db, "results", resultId));
    if (resultDoc.exists()) {
      return { ...resultDoc.data(), id: resultDoc.id } as Result;
    }

    // Fallback: Check if resultId is an examSession ID
    const sessionDoc = await getDoc(doc(db, "examSessions", resultId));
    if (sessionDoc.exists()) {
      const sData = sessionDoc.data();
      const obtained = sData.score ?? 0;
      const total = sData.totalMarks || 100;
      const percentage = total > 0 ? (obtained / total) * 100 : 0;
      const gradeInfo = calculateGrade(percentage);

      let examTitle = sData.examTitle || "Online Exam";
      let courseName = sData.courseName || "Course Exam";
      let courseCode = sData.courseCode || "";

      if (sData.examId) {
        try {
          const eDoc = await getDoc(doc(db, "exams", sData.examId));
          if (eDoc.exists()) {
            const eData = eDoc.data();
            examTitle = eData.title || examTitle;
            courseName = eData.courseName || courseName;
            courseCode = eData.courseId || courseCode;
          }
        } catch (e) {}
      }

      return {
        id: sessionDoc.id,
        studentId: sData.studentId,
        studentName: sData.studentName || "Student",
        examName: examTitle,
        courseName: courseName,
        courseCode: courseCode,
        batchName: sData.batch || "N/A",
        sectionName: sData.section || "N/A",
        totalMarks: total,
        obtainedMarks: obtained,
        percentage: percentage,
        grade: gradeInfo.grade,
        gpa: gradeInfo.gpa,
        passFailStatus: gradeInfo.isPassed ? "Pass" : "Fail",
        isPublished: true,
        resultPublishedDate: sData.completedAt || sData.createdAt || new Date(),
        academicYear: new Date().getFullYear().toString(),
        examId: sData.examId,
      } as Result;
    }

    return null;
  } catch (error) {
    console.error("Error fetching result details:", error);
    return null;
  }
}

/**
 * Create a new result (admin/teacher only).
 */
export async function createResult(
  data: Omit<Result, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const docRef = await addDoc(collection(db, "results"), {
    ...data,
    isPublished: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Publish a result - makes it visible to students.
 */
export async function publishResult(resultId: string): Promise<void> {
  await updateDoc(doc(db, "results", resultId), {
    isPublished: true,
    resultPublishedDate: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Update a result (admin/teacher only).
 */
export async function updateResult(
  resultId: string,
  data: Partial<Result>
): Promise<void> {
  await updateDoc(doc(db, "results", resultId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a result (admin only).
 */
export async function deleteResult(resultId: string): Promise<void> {
  await deleteDoc(doc(db, "results", resultId));
}

/**
 * Subscribe to real-time updates for a student's published results.
 * Returns an unsubscribe function.
 */
export function subscribeToResults(
  studentId: string,
  callback: (results: Result[]) => void
): () => void {
  const q = query(
    collection(db, "results"),
    where("studentId", "==", studentId),
    where("isPublished", "==", true),
    orderBy("resultPublishedDate", "desc")
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const results = snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as Result));
    callback(results);
  });

  return unsubscribe;
}

// ===================== Result Subjects =====================

/**
 * Get subjects for a specific result.
 */
export async function getResultSubjects(resultId: string): Promise<ResultSubject[]> {
  const result = await getResultDetails(resultId);
  if (!result) return [];
  return result.subjects || [];
}

// ===================== Student Warnings =====================

/**
 * Get all warnings for a student, sorted by date issued descending.
 */
export async function getStudentWarnings(
  studentId: string,
  statusFilter?: WarningStatus
): Promise<StudentWarning[]> {
  const constraints: any[] = [where("studentId", "==", studentId)];

  if (statusFilter) {
    constraints.push(where("status", "==", statusFilter));
  }

  constraints.push(orderBy("dateIssued", "desc")); // Will need a composite index

  const q = query(collection(db, "studentWarnings"), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as StudentWarning));
}

/**
 * Get active warnings for a student.
 */
export async function getActiveWarnings(studentId: string): Promise<StudentWarning[]> {
  return getStudentWarnings(studentId, "active");
}

/**
 * Create a warning for a student (admin/teacher only).
 */
export async function createWarning(
  data: Omit<StudentWarning, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const docRef = await addDoc(collection(db, "studentWarnings"), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Update a warning status (admin/teacher only).
 */
export async function updateWarning(
  warningId: string,
  data: Partial<StudentWarning>
): Promise<void> {
  await updateDoc(doc(db, "studentWarnings", warningId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Resolve a warning (mark as resolved).
 */
export async function resolveWarning(warningId: string): Promise<void> {
  await updateDoc(doc(db, "studentWarnings", warningId), {
    status: "resolved",
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a warning (admin only).
 */
export async function deleteWarning(warningId: string): Promise<void> {
  await deleteDoc(doc(db, "studentWarnings", warningId));
}

/**
 * Subscribe to real-time warning updates for a student.
 */
export function subscribeToWarnings(
  studentId: string,
  callback: (warnings: StudentWarning[]) => void
): () => void {
  const q = query(
    collection(db, "studentWarnings"),
    where("studentId", "==", studentId),
    where("status", "==", "active"),
    orderBy("dateIssued", "desc")
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const warnings = snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as StudentWarning));
    callback(warnings);
  });

  return unsubscribe;
}

// ===================== Helper Functions =====================

/**
 * Calculate grade based on percentage.
 * Standard grading scale.
 */
export function calculateGrade(percentage: number): {
  grade: string;
  gpa: number;
  isPassed: boolean;
} {
  if (percentage >= 80) return { grade: "A+", gpa: 4.0, isPassed: true };
  if (percentage >= 75) return { grade: "A", gpa: 3.75, isPassed: true };
  if (percentage >= 70) return { grade: "A-", gpa: 3.5, isPassed: true };
  if (percentage >= 65) return { grade: "B+", gpa: 3.25, isPassed: true };
  if (percentage >= 60) return { grade: "B", gpa: 3.0, isPassed: true };
  if (percentage >= 55) return { grade: "B-", gpa: 2.75, isPassed: true };
  if (percentage >= 50) return { grade: "C+", gpa: 2.5, isPassed: true };
  if (percentage >= 45) return { grade: "C", gpa: 2.25, isPassed: true };
  if (percentage >= 40) return { grade: "D", gpa: 2.0, isPassed: true };
  return { grade: "F", gpa: 0.0, isPassed: false };
}

/**
 * Get appropriate color for a grade badge.
 */
export function getGradeColor(grade: string): string {
  switch (grade) {
    case "A+":
    case "A":
    case "A-":
      return "bg-green-100 text-green-800 border-green-300";
    case "B+":
    case "B":
    case "B-":
      return "bg-blue-100 text-blue-800 border-blue-300";
    case "C+":
    case "C":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "D":
      return "bg-orange-100 text-orange-800 border-orange-300";
    case "F":
      return "bg-red-100 text-red-800 border-red-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-300";
  }
}

/**
 * Get appropriate color for a GPA badge.
 */
export function getGpaColor(gpa: number): string {
  if (gpa >= 3.5) return "bg-green-100 text-green-800";
  if (gpa >= 3.0) return "bg-blue-100 text-blue-800";
  if (gpa >= 2.5) return "bg-yellow-100 text-yellow-800";
  if (gpa >= 2.0) return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-800";
}

/**
 * Get warning icon and color based on warning type.
 */
export function getWarningStyle(type: WarningType): {
  color: string;
  bgColor: string;
  icon: string;
} {
  switch (type) {
    case "attendance":
      return { color: "text-orange-600", bgColor: "bg-orange-50 border-orange-200", icon: "⚠️" };
    case "academic":
      return { color: "text-red-600", bgColor: "bg-red-50 border-red-200", icon: "📚" };
    case "low_gpa":
      return { color: "text-yellow-600", bgColor: "bg-yellow-50 border-yellow-200", icon: "📉" };
    case "failed_subject":
      return { color: "text-red-700", bgColor: "bg-red-50 border-red-300", icon: "❌" };
    case "due_payment":
      return { color: "text-purple-600", bgColor: "bg-purple-50 border-purple-200", icon: "💰" };
    case "custom":
      return { color: "text-blue-600", bgColor: "bg-blue-50 border-blue-200", icon: "📋" };
    default:
      return { color: "text-gray-600", bgColor: "bg-gray-50 border-gray-200", icon: "📌" };
  }
}
