import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { CourseDoc, BatchDoc, SectionDoc } from "../types";

// ===================== Courses =====================

/**
 * Validate course data before saving.
 * Course Name and Code are required. Course Code must be unique.
 */
async function validateCourseData(data: { name: string; code: string }, excludeId?: string): Promise<void> {
  if (!data.name || !data.name.trim()) {
    throw new Error("Course name is required.");
  }
  if (!data.code || !data.code.trim()) {
    throw new Error("Course code is required.");
  }
  const name = data.name.trim();
  const code = data.code.trim();

  const q = query(collection(db, "courses"));
  const snapshot = await getDocs(q);
  const duplicate = snapshot.docs.find((d) => {
    const c = d.data() as CourseDoc;
    return d.id !== excludeId && (c.code === code || c.name.toLowerCase() === name.toLowerCase());
  });

  if (duplicate) {
    const existing = duplicate.data() as CourseDoc;
    if (existing.code === code) {
      throw new Error(`Course code "${code}" already exists. Course codes must be unique.`);
    }
    throw new Error(`Course name "${name}" already exists. Course names must be unique.`);
  }
}

/**
 * Get all courses from Firestore.
 */
export async function getAllCourses(): Promise<CourseDoc[]> {
  const q = query(collection(db, "courses"), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as CourseDoc));
}

/**
 * Create a new course in Firestore.
 */
export async function createCourse(data: { name: string; code: string; departmentId?: string; departmentName?: string }): Promise<string> {
  await validateCourseData(data);
  const docRef = await addDoc(collection(db, "courses"), {
    name: data.name.trim(),
    code: data.code.trim().toUpperCase(),
    departmentId: data.departmentId || "cse",
    departmentName: data.departmentName || "CSE Department",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Update an existing course in Firestore.
 */
export async function updateCourse(courseId: string, data: { name: string; code: string }): Promise<void> {
  await validateCourseData(data, courseId);
  await updateDoc(doc(db, "courses", courseId), {
    name: data.name.trim(),
    code: data.code.trim().toUpperCase(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a course and all its associated batches and sections.
 */
export async function deleteCourse(courseId: string): Promise<void> {
  const batch = writeBatch(db);

  // Delete all batches under this course
  const batchesQ = query(collection(db, "batches"), where("courseId", "==", courseId));
  const batchesSnap = await getDocs(batchesQ);

  for (const bDoc of batchesSnap.docs) {
    // Delete all sections under this batch
    const sectionsQ = query(collection(db, "sections"), where("batchId", "==", bDoc.id));
    const sectionsSnap = await getDocs(sectionsQ);
    sectionsSnap.docs.forEach((sDoc) => batch.delete(doc(db, "sections", sDoc.id)));
    batch.delete(doc(db, "batches", bDoc.id));
  }

  batch.delete(doc(db, "courses", courseId));
  await batch.commit();
}

/**
 * Subscribe to real-time course updates.
 */
export function subscribeToCourses(callback: (courses: CourseDoc[]) => void): () => void {
  const q = query(collection(db, "courses"), orderBy("name", "asc"));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const courses = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as CourseDoc));
    callback(courses);
  }, (error) => {
    console.error("[CourseManagement] Courses subscription error:", error);
  });
  return unsubscribe;
}

// ===================== Batches =====================

/**
 * Validate batch data. Batch name must be unique within a course.
 */
async function validateBatchData(data: { courseId: string; name: string }, excludeId?: string): Promise<void> {
  if (!data.courseId) {
    throw new Error("A course must be selected to create a batch.");
  }
  if (!data.name || !data.name.trim()) {
    throw new Error("Batch name is required.");
  }
  const name = data.name.trim();

  const q = query(collection(db, "batches"), where("courseId", "==", data.courseId));
  const snapshot = await getDocs(q);
  const duplicate = snapshot.docs.find((d) => d.id !== excludeId && (d.data() as BatchDoc).name === name);

  if (duplicate) {
    throw new Error(`Batch "${name}" already exists for this course. Batch names must be unique within a course.`);
  }
}

/**
 * Get all batches for a specific course.
 */
export async function getBatchesByCourse(courseId: string): Promise<BatchDoc[]> {
  const q = query(collection(db, "batches"), where("courseId", "==", courseId), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as BatchDoc));
}

/**
 * Get all batches across all courses (flat list).
 */
export async function getAllBatches(): Promise<BatchDoc[]> {
  const q = query(collection(db, "batches"), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as BatchDoc));
}

/**
 * Create a new batch under a course.
 */
export async function createBatch(data: { courseId: string; name: string }): Promise<string> {
  await validateBatchData(data);
  const docRef = await addDoc(collection(db, "batches"), {
    courseId: data.courseId,
    name: data.name.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Update an existing batch.
 */
export async function updateBatch(batchId: string, data: { courseId: string; name: string }): Promise<void> {
  await validateBatchData(data, batchId);
  await updateDoc(doc(db, "batches", batchId), {
    courseId: data.courseId,
    name: data.name.trim(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a batch and all its associated sections.
 */
export async function deleteBatch(batchId: string): Promise<void> {
  const batch = writeBatch(db);
  const sectionsQ = query(collection(db, "sections"), where("batchId", "==", batchId));
  const sectionsSnap = await getDocs(sectionsQ);
  sectionsSnap.docs.forEach((sDoc) => batch.delete(doc(db, "sections", sDoc.id)));
  batch.delete(doc(db, "batches", batchId));
  await batch.commit();
}

/**
 * Subscribe to real-time batch updates for a course.
 */
export function subscribeToBatches(courseId: string, callback: (batches: BatchDoc[]) => void): () => void {
  const q = query(collection(db, "batches"), where("courseId", "==", courseId), orderBy("name", "asc"));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const batches = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as BatchDoc));
    callback(batches);
  }, (error) => {
    console.error("[CourseManagement] Batches subscription error:", error);
  });
  return unsubscribe;
}

// ===================== Sections =====================

/**
 * Validate section data. Section name must be unique within a batch.
 */
async function validateSectionData(data: { batchId: string; name: string }, excludeId?: string): Promise<void> {
  if (!data.batchId) {
    throw new Error("A batch must be selected to create a section.");
  }
  if (!data.name || !data.name.trim()) {
    throw new Error("Section name is required.");
  }
  const name = data.name.trim();

  const q = query(collection(db, "sections"), where("batchId", "==", data.batchId));
  const snapshot = await getDocs(q);
  const duplicate = snapshot.docs.find((d) => d.id !== excludeId && (d.data() as SectionDoc).name === name);

  if (duplicate) {
    throw new Error(`Section "${name}" already exists for this batch. Section names must be unique within a batch.`);
  }
}

/**
 * Get all sections for a specific batch.
 */
export async function getSectionsByBatch(batchId: string): Promise<SectionDoc[]> {
  const q = query(collection(db, "sections"), where("batchId", "==", batchId), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as SectionDoc));
}

/**
 * Get all sections across all batches (flat list).
 */
export async function getAllSections(): Promise<SectionDoc[]> {
  const q = query(collection(db, "sections"), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as SectionDoc));
}

/**
 * Create a new section under a batch.
 */
export async function createSection(data: { batchId: string; courseId: string; name: string }): Promise<string> {
  await validateSectionData(data);
  const docRef = await addDoc(collection(db, "sections"), {
    batchId: data.batchId,
    courseId: data.courseId,
    name: data.name.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * Update an existing section.
 */
export async function updateSection(sectionId: string, data: { batchId: string; name: string }): Promise<void> {
  await validateSectionData(data, sectionId);
  await updateDoc(doc(db, "sections", sectionId), {
    batchId: data.batchId,
    name: data.name.trim(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a section.
 */
export async function deleteSection(sectionId: string): Promise<void> {
  await deleteDoc(doc(db, "sections", sectionId));
}

/**
 * Subscribe to real-time section updates for a batch.
 */
export function subscribeToSections(batchId: string, callback: (sections: SectionDoc[]) => void): () => void {
  const q = query(collection(db, "sections"), where("batchId", "==", batchId), orderBy("name", "asc"));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const sections = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as SectionDoc));
    callback(sections);
  }, (error) => {
    console.error("[CourseManagement] Sections subscription error:", error);
  });
  return unsubscribe;
}

// ===================== Seed Defaults =====================

/**
 * Seed the default courses/batches/sections into Firestore if they don't exist.
 * Idempotent: safe to call multiple times.
 */
export async function seedDefaultCatalog(): Promise<void> {
  const coursesSnap = await getDocs(collection(db, "courses"));
  if (coursesSnap.size > 0) {
    // Catalog already seeded, do nothing
    return;
  }

  // Import defaults lazily to avoid circular dependency
  const { DEFAULT_COURSES, DEFAULT_BATCHES, DEFAULT_SECTIONS } = await import("./catalog");

  const batch = writeBatch(db);

  for (const course of DEFAULT_COURSES) {
    const courseRef = doc(collection(db, "courses"));
    batch.set(courseRef, {
      name: course.name,
      code: course.code,
      departmentId: course.departmentId,
      departmentName: course.departmentName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Create all batches under this course
    for (const b of DEFAULT_BATCHES) {
      const batchRef = doc(collection(db, "batches"));
      batch.set(batchRef, {
        courseId: courseRef.id,
        name: b.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Create all sections under this batch
      for (const s of DEFAULT_SECTIONS) {
        const sectionRef = doc(collection(db, "sections"));
        batch.set(sectionRef, {
          batchId: batchRef.id,
          courseId: courseRef.id,
          name: s.name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  }

  await batch.commit();
}

