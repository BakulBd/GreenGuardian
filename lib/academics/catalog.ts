import { collection, getDocs, query, orderBy, onSnapshot, where } from "firebase/firestore";
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

// ===================== Dynamic Firestore Catalog =====================
// These helpers load Courses/Batches/Sections from Firestore collections
// (managed by lib/academics/courseManagement.ts) with static defaults as fallback.

/**
 * Load all courses from Firestore. Falls back to DEFAULT_COURSES if empty/unavailable.
 */
export async function getCoursesFromFirestore(): Promise<Course[]> {
  try {
    const q = query(collection(db, "courses"), orderBy("name", "asc"));
    const snapshot = await getDocs(q);
    if (snapshot.size > 0) {
      return snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          code: d.code || "",
          name: d.name || "",
          departmentId: d.departmentId || DEFAULT_DEPARTMENT.id,
          departmentName: d.departmentName || DEFAULT_DEPARTMENT.name,
        } as Course;
      });
    }
  } catch (error) {
    console.warn("Failed to load courses from Firestore, using defaults:", error);
  }
  return DEFAULT_COURSES;
}

/**
 * Load all batches from Firestore, optionally scoped to a course.
 * Falls back to DEFAULT_BATCHES if empty/unavailable.
 */
export async function getBatchesFromFirestore(courseId?: string): Promise<Batch[]> {
  try {
    let q = query(collection(db, "batches"), orderBy("name", "asc"));
    if (courseId) {
      q = query(collection(db, "batches"), where("courseId", "==", courseId), orderBy("name", "asc"));
    }
    const snapshot = await getDocs(q);
    if (snapshot.size > 0) {
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "",
      } as Batch));
    }
  } catch (error) {
    console.warn("Failed to load batches from Firestore, using defaults:", error);
  }
  return DEFAULT_BATCHES;
}

/**
 * Load all sections from Firestore, optionally scoped to a batch.
 * Falls back to DEFAULT_SECTIONS if empty/unavailable.
 */
export async function getSectionsFromFirestore(batchId?: string): Promise<Section[]> {
  try {
    let q = query(collection(db, "sections"), orderBy("name", "asc"));
    if (batchId) {
      q = query(collection(db, "sections"), where("batchId", "==", batchId), orderBy("name", "asc"));
    }
    const snapshot = await getDocs(q);
    if (snapshot.size > 0) {
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "",
      } as Section));
    }
  } catch (error) {
    console.warn("Failed to load sections from Firestore, using defaults:", error);
  }
  return DEFAULT_SECTIONS;
}

/**
 * Subscribe to real-time course updates. Callback receives courses from Firestore
 * or DEFAULT_COURSES fallback. Returns an unsubscribe function.
 */
export function subscribeToCatalogCourses(callback: (courses: Course[]) => void): () => void {
  const q = query(collection(db, "courses"), orderBy("name", "asc"));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.size > 0) {
      callback(snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          code: d.code || "",
          name: d.name || "",
          departmentId: d.departmentId || DEFAULT_DEPARTMENT.id,
          departmentName: d.departmentName || DEFAULT_DEPARTMENT.name,
        } as Course;
      }));
    } else {
      callback(DEFAULT_COURSES);
    }
  }, (error) => {
    console.warn("Courses real-time subscription error, using defaults:", error);
    callback(DEFAULT_COURSES);
  });
  return unsubscribe;
}

/**
 * Subscribe to real-time batch updates (optionally scoped to a course).
 * Falls back to DEFAULT_BATCHES if empty/unavailable.
 */
export function subscribeToCatalogBatches(courseId: string | undefined, callback: (batches: Batch[]) => void): () => void {
  let q = query(collection(db, "batches"), orderBy("name", "asc"));
  if (courseId) {
    q = query(collection(db, "batches"), where("courseId", "==", courseId), orderBy("name", "asc"));
  }
  const unsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.size > 0) {
      callback(snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "",
      } as Batch)));
    } else {
      callback(DEFAULT_BATCHES);
    }
  }, (error) => {
    console.warn("Batches real-time subscription error, using defaults:", error);
    callback(DEFAULT_BATCHES);
  });
  return unsubscribe;
}

/**
 * Subscribe to real-time section updates (optionally scoped to a batch).
 * Falls back to DEFAULT_SECTIONS if empty/unavailable.
 */
export function subscribeToCatalogSections(batchId: string | undefined, callback: (sections: Section[]) => void): () => void {
  let q = query(collection(db, "sections"), orderBy("name", "asc"));
  if (batchId) {
    q = query(collection(db, "sections"), where("batchId", "==", batchId), orderBy("name", "asc"));
  }
  const unsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.size > 0) {
      callback(snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "",
      } as Section)));
    } else {
      callback(DEFAULT_SECTIONS);
    }
  }, (error) => {
    console.warn("Sections real-time subscription error, using defaults:", error);
    callback(DEFAULT_SECTIONS);
  });
  return unsubscribe;
}
