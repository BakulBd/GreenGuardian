import {
  collection,
  doc,
  getDoc,
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
import { batchIdFor, sectionIdFor, sameName } from "./ids";

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
/**
 * Refuse to delete a catalog entry that teacher assignments still point at.
 *
 * Deleting cascaded to batches and sections but never touched
 * `teacher_assignments` or `teacher_student_mapping`. Those rows survived
 * pointing at a course/batch/section that no longer existed, and because
 * `users.assignedTeacherIds` is derived from them the teacher kept access to
 * the students — while "My Courses" listed a course that had been deleted.
 * Blocking is safer than cascading: silently revoking a live class's teacher
 * links is not something to do behind a generic "Delete" button.
 */
async function assertNoAssignments(
  field: "courseId" | "batchId" | "sectionId",
  id: string,
  label: string
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, "teacher_assignments"), where(field, "==", id))
  );
  if (!snap.empty) {
    const names = Array.from(
      new Set(snap.docs.map((d) => d.data().teacherName || d.data().teacherId))
    );
    throw new Error(
      `${label} is still assigned to ${snap.size} teacher assignment${snap.size !== 1 ? "s" : ""} (${names
        .slice(0, 3)
        .join(", ")}${names.length > 3 ? ", …" : ""}). Remove those assignments first.`
    );
  }
}

/**
 * Delete a course.
 *
 * Deliberately does NOT cascade into batches and sections any more. Under the
 * old per-course model that cascade made sense; now a batch is a shared intake
 * cohort, so deleting one course would have wiped the batches and sections that
 * every other course — and every student — depends on.
 */
export async function deleteCourse(courseId: string): Promise<void> {
  await assertNoAssignments("courseId", courseId, "This course");
  await deleteDoc(doc(db, "courses", courseId));
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
 * Validate batch data. Batch names are globally unique — a batch is an intake
 * cohort ("241"), not something that exists separately per course.
 */
async function validateBatchData(data: { name: string }, excludeId?: string): Promise<void> {
  if (!data.name || !data.name.trim()) {
    throw new Error("Batch name is required.");
  }
  const name = data.name.trim();

  const snapshot = await getDocs(collection(db, "batches"));
  const duplicate = snapshot.docs.find(
    (d) => d.id !== excludeId && sameName((d.data() as BatchDoc).name, name)
  );

  if (duplicate) {
    throw new Error(`Batch "${name}" already exists. Batch names must be unique.`);
  }
}

/**
 * Get all batches (flat list). Batches are global, so there is no per-course
 * variant of this any more.
 */
export async function getAllBatches(): Promise<BatchDoc[]> {
  const q = query(collection(db, "batches"), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as BatchDoc));
}

/**
 * Create a batch. The document ID is derived from the name (see
 * lib/academics/ids.ts), so creating the same batch twice is a no-op rather
 * than a duplicate.
 */
export async function createBatch(data: { name: string }): Promise<string> {
  await validateBatchData(data);
  const name = data.name.trim();
  const id = batchIdFor(name);
  await setDoc(doc(db, "batches", id), {
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Rename a batch.
 *
 * The document ID is derived from the name, so a rename would strictly mean
 * moving the document — along with every section under it and every
 * `teacher_assignments` / student profile row that stores the old name. That is
 * a migration, not an edit, so it is refused rather than half-performed.
 */
export async function updateBatch(batchId: string, data: { name: string }): Promise<void> {
  const snap = await getDoc(doc(db, "batches", batchId));
  const current = snap.exists() ? (snap.data() as BatchDoc).name : "";
  if (!sameName(current, data.name)) {
    throw new Error(
      `A batch cannot be renamed once created — students, sections and teacher assignments all reference "${current}" by name. Create the new batch and move its sections instead.`
    );
  }
  await updateDoc(doc(db, "batches", batchId), { updatedAt: serverTimestamp() });
}

/**
 * Delete a batch and all its sections.
 *
 * Refused while any teacher assignment references the batch (see
 * assertNoAssignments) or while any student is still in it — deleting the batch
 * out from under a student leaves them with a `batch` value that resolves to
 * nothing, which is exactly how students end up invisible.
 */
export async function deleteBatch(batchId: string): Promise<void> {
  await assertNoAssignments("batchId", batchId, "This batch");

  const snap = await getDoc(doc(db, "batches", batchId));
  const batchName = snap.exists() ? (snap.data() as BatchDoc).name : batchId;
  await assertNoStudents("batch", batchName, `Batch "${batchName}"`);

  const batch = writeBatch(db);
  const sectionsQ = query(collection(db, "sections"), where("batchId", "==", batchId));
  const sectionsSnap = await getDocs(sectionsQ);
  sectionsSnap.docs.forEach((sDoc) => batch.delete(doc(db, "sections", sDoc.id)));
  batch.delete(doc(db, "batches", batchId));
  await batch.commit();
}

/**
 * Subscribe to real-time batch updates.
 */
export function subscribeToBatches(callback: (batches: BatchDoc[]) => void): () => void {
  const q = query(collection(db, "batches"), orderBy("name", "asc"));
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
 * Refuse to remove a catalog entry that students are still placed in.
 *
 * A student whose `batch`/`section` no longer resolves to a catalog entry can't
 * be matched by any teacher assignment, so they drop out of every roster and
 * receive nothing — silently. Blocking here is what keeps that from happening
 * behind a Delete button.
 */
async function assertNoStudents(
  field: "batch" | "section",
  name: string,
  label: string
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, "users"), where("role", "==", "student"), where(field, "==", name))
  );
  if (!snap.empty) {
    throw new Error(
      `${label} still has ${snap.size} student${snap.size !== 1 ? "s" : ""} in it. Move them to another ${field} first.`
    );
  }
}

/**
 * Validate section data. Section names are unique within their batch.
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
  const duplicate = snapshot.docs.find(
    (d) => d.id !== excludeId && sameName((d.data() as SectionDoc).name, name)
  );

  if (duplicate) {
    throw new Error(`Section "${name}" already exists in this batch. Section names must be unique within a batch.`);
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
 * Create a section under a batch. The ID is `{batchId}_{name}`, so the same
 * section can't be created twice and the batch is part of its identity.
 */
export async function createSection(data: { batchId: string; name: string }): Promise<string> {
  await validateSectionData(data);
  const batchSnap = await getDoc(doc(db, "batches", data.batchId));
  if (!batchSnap.exists()) {
    throw new Error("That batch no longer exists. Refresh and try again.");
  }
  const batchName = (batchSnap.data() as BatchDoc).name;
  const name = data.name.trim();
  const id = sectionIdFor(batchName, name);

  await setDoc(doc(db, "sections", id), {
    batchId: data.batchId,
    batchName,
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Rename a section. Refused for the same reason as renaming a batch: student
 * profiles and teacher assignments both store the section by name.
 */
export async function updateSection(sectionId: string, data: { batchId: string; name: string }): Promise<void> {
  const snap = await getDoc(doc(db, "sections", sectionId));
  const current = snap.exists() ? (snap.data() as SectionDoc).name : "";
  if (!sameName(current, data.name)) {
    throw new Error(
      `A section cannot be renamed once created — students and teacher assignments reference "${current}" by name. Create the new section and move its students instead.`
    );
  }
  await updateDoc(doc(db, "sections", sectionId), { updatedAt: serverTimestamp() });
}

/**
 * Delete a section.
 */
export async function deleteSection(sectionId: string): Promise<void> {
  await assertNoAssignments("sectionId", sectionId, "This section");

  const snap = await getDoc(doc(db, "sections", sectionId));
  if (snap.exists()) {
    const section = snap.data() as SectionDoc;
    // Scoped by batch: two batches can both have a "D1", and only this one's
    // students are affected.
    const studentsSnap = await getDocs(
      query(
        collection(db, "users"),
        where("role", "==", "student"),
        where("batch", "==", section.batchName || ""),
        where("section", "==", section.name)
      )
    );
    if (!studentsSnap.empty) {
      throw new Error(
        `Section ${section.batchName}/${section.name} still has ${studentsSnap.size} student${
          studentsSnap.size !== 1 ? "s" : ""
        } in it. Move them to another section first.`
      );
    }
  }

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
 * Seed the default catalog. Safe to run repeatedly.
 *
 * Under the old per-course model this wrote 11 courses x 10 batches x 5
 * sections = 671 documents in a single `writeBatch` — past Firestore's 500
 * operation limit, so the "Seed Defaults" button threw every single time.
 * Global batches bring it to 11 + 10 + 50 = 71, and the writes are chunked
 * anyway so the count can grow without reintroducing the ceiling.
 *
 * Batches and sections use deterministic IDs, so re-seeding overwrites rather
 * than duplicating. Courses keep random IDs (their names are editable and
 * assignments reference them by ID), so they are only created when the
 * collection is empty.
 */
const MAX_BATCH_WRITES = 400; // headroom under Firestore's 500-op limit

async function commitChunked(writes: ((b: ReturnType<typeof writeBatch>) => void)[]): Promise<void> {
  for (let i = 0; i < writes.length; i += MAX_BATCH_WRITES) {
    const chunk = writes.slice(i, i + MAX_BATCH_WRITES);
    const batch = writeBatch(db);
    chunk.forEach((apply) => apply(batch));
    await batch.commit();
  }
}

export async function seedDefaultCatalog(): Promise<{
  coursesCreated: number;
  batchesCreated: number;
  sectionsCreated: number;
}> {
  // Import defaults lazily to avoid a circular dependency with ./catalog.
  const { DEFAULT_COURSES, DEFAULT_BATCHES, DEFAULT_SECTIONS } = await import("./catalog");

  const writes: ((b: ReturnType<typeof writeBatch>) => void)[] = [];

  const coursesSnap = await getDocs(collection(db, "courses"));
  let coursesCreated = 0;
  if (coursesSnap.empty) {
    for (const course of DEFAULT_COURSES) {
      const courseRef = doc(collection(db, "courses"));
      writes.push((b) =>
        b.set(courseRef, {
          name: course.name,
          code: course.code,
          departmentId: course.departmentId,
          departmentName: course.departmentName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      coursesCreated++;
    }
  }

  for (const b of DEFAULT_BATCHES) {
    const batchId = batchIdFor(b.name);
    writes.push((wb) =>
      wb.set(
        doc(db, "batches", batchId),
        { name: b.name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      )
    );

    for (const s of DEFAULT_SECTIONS) {
      writes.push((wb) =>
        wb.set(
          doc(db, "sections", sectionIdFor(b.name, s.name)),
          {
            batchId,
            batchName: b.name,
            name: s.name,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      );
    }
  }

  await commitChunked(writes);

  return {
    coursesCreated,
    batchesCreated: DEFAULT_BATCHES.length,
    sectionsCreated: DEFAULT_BATCHES.length * DEFAULT_SECTIONS.length,
  };
}

