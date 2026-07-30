import { collection, getDocs, doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  departmentName?: string;
}

export interface Batch {
  id: string;
  name: string;
}

export interface Section {
  id: string;
  name: string;
}

export interface CourseAssignment {
  courseId: string;
  courseName: string;
  batch: string;
  section: string;
}

export interface TeacherCourseMapping {
  teacherId: string;
  assignments: CourseAssignment[];
}

export interface StudentCourseMapping {
  studentId: string;
  studentCode?: string; // e.g. 0182220005101001
  department: string;
  batch: string;
  section: string;
  sections: string[]; // e.g. ["D1", "D2", "D3"] or all
  courses: string[]; // course IDs or course names
}

export const DEFAULT_DEPARTMENT: Department = {
  id: "cse",
  name: "CSE Department",
  code: "CSE",
};

export const DEFAULT_COURSES: Course[] = [
  { id: "cse-101", code: "CSE 101", name: "Structured Programming", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-102", code: "CSE 102", name: "Object Oriented Programming", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-103", code: "CSE 103", name: "Discrete Mathematics", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-201", code: "CSE 201", name: "Data Structure", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-202", code: "CSE 202", name: "Algorithm", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-301", code: "CSE 301", name: "Database Management System", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-302", code: "CSE 302", name: "Operating System", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-303", code: "CSE 303", name: "Computer Networks", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-401", code: "CSE 401", name: "Software Engineering", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-402", code: "CSE 402", name: "Artificial Intelligence", departmentId: "cse", departmentName: "CSE Department" },
  { id: "cse-403", code: "CSE 403", name: "Machine Learning", departmentId: "cse", departmentName: "CSE Department" },
];

export const DEFAULT_BATCHES: Batch[] = [
  { id: "231", name: "231" },
  { id: "232", name: "232" },
  { id: "241", name: "241" },
  { id: "242", name: "242" },
  { id: "250", name: "250" },
  { id: "251", name: "251" },
  { id: "252", name: "252" },
  { id: "260", name: "260" },
  { id: "261", name: "261" },
  { id: "262", name: "262" },
];

export const DEFAULT_SECTIONS: Section[] = [
  { id: "D1", name: "D1" },
  { id: "D2", name: "D2" },
  { id: "D3", name: "D3" },
  { id: "D4", name: "D4" },
  { id: "D5", name: "D5" },
];

/**
 * Generate full default assignment for a teacher: All CSE courses, All batches, All sections
 */
export function getDefaultTeacherAssignments(): CourseAssignment[] {
  const assignments: CourseAssignment[] = [];
  for (const course of DEFAULT_COURSES) {
    for (const batch of DEFAULT_BATCHES) {
      for (const section of DEFAULT_SECTIONS) {
        assignments.push({
          courseId: course.id,
          courseName: course.name,
          batch: batch.name,
          section: section.name,
        });
      }
    }
  }
  return assignments;
}

/**
 * Fetch assigned courses for a teacher, returning default full assignments if not customized
 */
export async function getTeacherAssignments(teacherId: string): Promise<CourseAssignment[]> {
  try {
    const docRef = doc(db, "teacher_courses", teacherId);
    const snap = await getDoc(docRef);
    if (snap.exists() && snap.data().assignments?.length > 0) {
      return snap.data().assignments as CourseAssignment[];
    }
  } catch (error) {
    console.warn("Could not fetch custom teacher assignments, using defaults:", error);
  }
  return getDefaultTeacherAssignments();
}

/**
 * Save custom assignments for a teacher
 */
export async function saveTeacherAssignments(teacherId: string, assignments: CourseAssignment[]): Promise<void> {
  const docRef = doc(db, "teacher_courses", teacherId);
  await setDoc(docRef, {
    teacherId,
    assignments,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
