import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  limit,
  QuerySnapshot,
  DocumentData,
} from "firebase/firestore";
import { db } from "./config";
import {
  TeacherAssignment,
  TeacherStudentMapping,
  AssignmentHistory,
  AssignmentAction,
  User,
  CourseDoc,
  BatchDoc,
  SectionDoc,
} from "../types";

const ASSIGNMENTS_COLLECTION = "teacher_assignments";
const MAPPINGS_COLLECTION = "teacher_student_mapping";
const HISTORY_COLLECTION = "assignmentHistory";

// ===================== Internal Helpers =====================

function stripUndefined(data: Record<string, any>): Record<string, any> {
  const cleanData: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  });
  return cleanData;
}

function docToData<T>(snap: QuerySnapshot<DocumentData>): T[] {
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
}

async function getCourseDoc(courseId: string): Promise<CourseDoc | null> {
  try {
    const snap = await getDoc(doc(db, "courses", courseId));
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as CourseDoc) : null;
  } catch {
    return null;
  }
}

async function getBatchDoc(batchId: string): Promise<BatchDoc | null> {
  try {
    const snap = await getDoc(doc(db, "batches", batchId));
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as BatchDoc) : null;
  } catch {
    return null;
  }
}

async function getSectionDoc(sectionId: string): Promise<SectionDoc | null> {
  try {
    const snap = await getDoc(doc(db, "sections", sectionId));
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as SectionDoc) : null;
  } catch {
    return null;
  }
}

async function getTeacherName(teacherId: string): Promise<string | undefined> {
  try {
    const snap = await getDoc(doc(db, "users", teacherId));
    return snap.exists() ? (snap.data() as User).name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch all students enrolled in a specific course+batch+section group.
 * Students are matched by batch name + section name + course membership.
 */
export async function getStudentGroup(
  courseId: string,
  batchName: string,
  sectionName: string
): Promise<User[]> {
  try {
    const q = query(collection(db, "users"), where("role", "==", "student"));
    const snapshot = await getDocs(q);
    const students = docToData<User>(snapshot);

    return students.filter((s) => {
      // Batch must match
      if (s.batch !== batchName) return false;

      // Section must match (student.section OR student.sections[])
      const studentSections = s.sections && s.sections.length > 0 ? s.sections : s.section ? [s.section] : [];
      if (!studentSections.includes(sectionName)) return false;

      // Course membership: student.courses[] may contain courseId or course name
      if (s.courses && s.courses.length > 0) {
        return s.courses.includes(courseId);
      }

      // If no course list is set on the student, treat as matching (legacy data)
      return true;
    });
  } catch (error) {
    console.warn("[Assignments] Failed to load student group:", error);
    return [];
  }
}

/**
 * Resolve the final set of student IDs for an assignment.
 * - If explicit studentIds are provided, they are used (must be subset of group).
 * - Otherwise all students in the course+batch+section group are used.
 */
export async function resolveAssignmentStudentIds(
  courseId: string,
  batchName: string,
  sectionName: string,
  studentIds?: string[]
): Promise<User[]> {
  const group = await getStudentGroup(courseId, batchName, sectionName);

  if (studentIds && studentIds.length > 0) {
    const idSet = new Set(studentIds);
    return group.filter((s) => idSet.has(s.id));
  }

  return group;
}

/**
 * Resolve the exact set of student IDs a teacher may target for a given
 * Course+Batch+Section, using the teacher's own `teacher_assignments` row
 * for that group (including any individual-student subset override). Used
 * by exam creation to materialize `Exam.targetStudentIds` so exam
 * visibility is driven by the same admin-assignment data as "My Courses"
 * and notices, instead of a free-text course/batch/section match.
 */
export async function computeAssignmentTargetStudentIds(
  teacherId: string,
  courseId: string,
  batchId: string,
  sectionId: string
): Promise<string[]> {
  const assignments = await getAssignmentsByTeacher(teacherId);
  const match = assignments.find(
    (a) => a.courseId === courseId && a.batchId === batchId && a.sectionId === sectionId
  );
  if (!match) return [];

  const students = await resolveAssignmentStudentIds(
    courseId,
    match.batchName || "",
    match.sectionName || "",
    match.studentIds
  );
  return students.map((s) => s.id);
}

// ===================== Denormalized student -> teacher sync =====================

/**
 * Recomputes and writes `users/{studentId}.assignedTeacherIds` from ALL
 * current sources of teacher access for each given student:
 *   1. `teacher_student_mapping` rows (admin Course/Batch/Section assignment)
 *   2. `classroomMembers` rows (classroom join-by-code or teacher-added)
 *
 * This is the field Firestore security rules and notice/notification/exam
 * queries check to guarantee teacher communication only reaches assigned
 * students — cheap to check in a rule, unlike a live query against the
 * mapping/membership collections. Always derives the full set fresh from
 * both live sources, so it's safe to call after any create/update/remove on
 * EITHER source without separately tracking deltas or reference counts: a
 * student who loses one source (e.g. leaves a classroom) keeps the teacher
 * in this list as long as the other source (e.g. an admin assignment, or a
 * different classroom with the same teacher) still grants it.
 */
export async function recomputeAssignedTeacherIds(studentIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(studentIds.filter(Boolean)));
  await Promise.all(
    uniqueIds.map(async (studentId) => {
      try {
        const [mappingsSnap, membershipsSnap] = await Promise.all([
          getDocs(query(collection(db, MAPPINGS_COLLECTION), where("studentId", "==", studentId))),
          getDocs(query(collection(db, "classroomMembers"), where("studentId", "==", studentId))),
        ]);
        const teacherIds = Array.from(
          new Set([
            ...mappingsSnap.docs.map((d) => d.data().teacherId),
            ...membershipsSnap.docs.map((d) => d.data().teacherId),
          ].filter(Boolean))
        );
        await updateDoc(doc(db, "users", studentId), {
          assignedTeacherIds: teacherIds,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn(`[Assignments] Failed to sync assignedTeacherIds for student ${studentId}:`, error);
      }
    })
  );
}

/**
 * One-time backfill for `users.assignedTeacherIds` (Feature 5 bug fix).
 *
 * Root cause of "published exams / notices are not visible": the denormalized
 * `assignedTeacherIds` field (Task 10) is only kept in sync going forward —
 * written when an assignment is created/updated/removed. Any assignment that
 * already existed before that sync logic shipped has a `teacher_student_mapping`
 * row but no corresponding field on the student's `users` doc, so every
 * exam-visibility and notice-visibility check (which reads that field) sees an
 * empty list and hides everything, even though the student IS assigned.
 *
 * Recomputes the field for every student who has at least one mapping row.
 * Safe to run repeatedly — it fully derives the field from the mapping
 * collection each time, so it can't double-apply or drift.
 */
export async function backfillAllAssignedTeacherIds(): Promise<{ studentsUpdated: number }> {
  const mappingsSnap = await getDocs(collection(db, MAPPINGS_COLLECTION));
  const studentIds = Array.from(
    new Set(mappingsSnap.docs.map((d) => d.data().studentId).filter(Boolean))
  ) as string[];

  await recomputeAssignedTeacherIds(studentIds);
  return { studentsUpdated: studentIds.length };
}

// ===================== Duplicate Validation =====================

/**
 * Ensure the same teacher is not assigned the same course+batch+section twice.
 */
async function validateDuplicateAssignment(
  data: {
    teacherId: string;
    courseId: string;
    batchId: string;
    sectionId: string;
  },
  excludeId?: string
): Promise<void> {
  const q = query(
    collection(db, ASSIGNMENTS_COLLECTION),
    where("teacherId", "==", data.teacherId),
    where("courseId", "==", data.courseId),
    where("batchId", "==", data.batchId),
    where("sectionId", "==", data.sectionId)
  );
  const snapshot = await getDocs(q);
  const duplicate = snapshot.docs.find((d) => d.id !== excludeId);
  if (duplicate) {
    throw new Error(
      "This teacher is already assigned to this Course + Batch + Section combination. Please choose a different teacher or group."
    );
  }
}

// ===================== History =====================

async function logAssignmentHistory(entry: Omit<AssignmentHistory, "id" | "timestamp">): Promise<void> {
  try {
    await addDoc(collection(db, HISTORY_COLLECTION), {
      ...entry,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("[Assignments] Failed to log history:", error);
  }
}

/**
 * Get assignment history, optionally filtered by teacher. Newest first.
 */
export async function getAssignmentHistory(
  teacherId?: string,
  maxItems: number = 100
): Promise<AssignmentHistory[]> {
  try {
    let q;
    if (teacherId) {
      q = query(
        collection(db, HISTORY_COLLECTION),
        where("teacherId", "==", teacherId),
        orderBy("timestamp", "desc"),
        limit(maxItems)
      );
    } else {
      q = query(
        collection(db, HISTORY_COLLECTION),
        orderBy("timestamp", "desc"),
        limit(maxItems)
      );
    }
    const snapshot = await getDocs(q);
    return docToData<AssignmentHistory>(snapshot);
  } catch (error) {
    console.warn("[Assignments] Failed to load history:", error);
    return [];
  }
}

// ===================== Admin: Create Assignment =====================

export interface CreateAssignmentInput {
  teacherId: string;
  teacherName?: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  batchId: string;
  batchName?: string;
  sectionId: string;
  sectionName?: string;
  studentIds?: string[]; // optional individual students
  createdByAdminId?: string;
  createdByAdminName?: string;
}

/**
 * Create a teacher assignment and generate all teacher_student_mapping records
 * for the students in the selected group. Logs to assignment history.
 */
export async function createTeacherAssignment(
  input: CreateAssignmentInput
): Promise<string> {
  if (!input.teacherId) throw new Error("Please select a teacher.");
  if (!input.courseId) throw new Error("Please select a course.");
  if (!input.batchId) throw new Error("Please select a batch.");
  if (!input.sectionId) throw new Error("Please select a section.");

  await validateDuplicateAssignment({
    teacherId: input.teacherId,
    courseId: input.courseId,
    batchId: input.batchId,
    sectionId: input.sectionId,
  });

  // Enrich names from the catalog if not provided
  const courseDoc = await getCourseDoc(input.courseId);
  const batchDoc = await getBatchDoc(input.batchId);
  const sectionDoc = await getSectionDoc(input.sectionId);

  const courseName = input.courseName || courseDoc?.name || "";
  const courseCode = input.courseCode || courseDoc?.code || "";
  const batchName = input.batchName || batchDoc?.name || "";
  const sectionName = input.sectionName || sectionDoc?.name || "";
  const teacherName = input.teacherName || (await getTeacherName(input.teacherId));

  // Resolve the student set
  const students = await resolveAssignmentStudentIds(
    input.courseId,
    batchName,
    sectionName,
    input.studentIds
  );

  const assignmentDoc: Record<string, any> = stripUndefined({
    teacherId: input.teacherId,
    teacherName,
    courseId: input.courseId,
    courseName,
    courseCode,
    batchId: input.batchId,
    batchName,
    sectionId: input.sectionId,
    sectionName,
    studentIds: input.studentIds && input.studentIds.length > 0 ? input.studentIds : undefined,
    createdByAdmin: input.createdByAdminId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Use a batch for atomic assignment + mapping creation
  const batch = writeBatch(db);
  const assignmentRef = doc(collection(db, ASSIGNMENTS_COLLECTION));
  batch.set(assignmentRef, assignmentDoc);

  for (const student of students) {
    const mappingRef = doc(collection(db, MAPPINGS_COLLECTION));
    batch.set(mappingRef, stripUndefined({
      teacherId: input.teacherId,
      studentId: student.id,
      studentName: student.name,
      studentCode: student.studentCode,
      courseId: input.courseId,
      courseName,
      batchId: input.batchId,
      batchName,
      sectionId: input.sectionId,
      sectionName,
      assignmentId: assignmentRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  await recomputeAssignedTeacherIds(students.map((s) => s.id));

  // Log history (best-effort, after commit)
  await logAssignmentHistory({
    assignmentId: assignmentRef.id,
    teacherId: input.teacherId,
    teacherName,
    courseId: input.courseId,
    courseName,
    batchName,
    sectionName,
    action: "created",
    studentIds: students.map((s) => s.id),
    studentCount: students.length,
    changedByAdminId: input.createdByAdminId,
    changedByAdminName: input.createdByAdminName,
  });

  return assignmentRef.id;
}

// ===================== Admin: Update Assignment =====================

/**
 * Update a teacher assignment. If the group/students change, the mappings are
 * re-synced (old mappings removed, new ones created). Logs to history.
 */
export async function updateTeacherAssignment(
  assignmentId: string,
  input: Partial<CreateAssignmentInput> & { teacherId: string }
): Promise<void> {
  const assignmentRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
  const existingSnap = await getDoc(assignmentRef);
  if (!existingSnap.exists()) {
    throw new Error("Assignment not found.");
  }
  const existing = { ...existingSnap.data(), id: existingSnap.id } as TeacherAssignment;

  const teacherId = input.teacherId || existing.teacherId;
  const courseId = input.courseId || existing.courseId;
  const batchId = input.batchId || existing.batchId;
  const sectionId = input.sectionId || existing.sectionId;

  await validateDuplicateAssignment(
    { teacherId, courseId, batchId, sectionId },
    assignmentId
  );

  // Resolve names
  const courseDoc = await getCourseDoc(courseId);
  const batchDoc = await getBatchDoc(batchId);
  const sectionDoc = await getSectionDoc(sectionId);
  const courseName = input.courseName || existing.courseName || courseDoc?.name || "";
  const courseCode = input.courseCode || existing.courseCode || courseDoc?.code || "";
  const batchName = input.batchName || existing.batchName || batchDoc?.name || "";
  const sectionName = input.sectionName || existing.sectionName || sectionDoc?.name || "";
  const teacherName = input.teacherName || existing.teacherName || (await getTeacherName(teacherId));

  // Resolve final students
  const students = await resolveAssignmentStudentIds(
    courseId,
    batchName,
    sectionName,
    input.studentIds
  );

  // Re-sync mappings in a batch
  const batch = writeBatch(db);

  // 1. Delete old mappings for this assignment
  const oldMappingsQ = query(
    collection(db, MAPPINGS_COLLECTION),
    where("assignmentId", "==", assignmentId)
  );
  const oldMappingsSnap = await getDocs(oldMappingsQ);
  const oldStudentIds = oldMappingsSnap.docs.map((m) => m.data().studentId).filter(Boolean) as string[];
  oldMappingsSnap.docs.forEach((m) => batch.delete(doc(db, MAPPINGS_COLLECTION, m.id)));

  // 2. Update the assignment document
  batch.update(assignmentRef, stripUndefined({
    teacherId,
    teacherName,
    courseId,
    courseName,
    courseCode,
    batchId,
    batchName,
    sectionId,
    sectionName,
    studentIds: input.studentIds && input.studentIds.length > 0 ? input.studentIds : undefined,
    updatedAt: serverTimestamp(),
  }));

  // 3. Create fresh mappings
  for (const student of students) {
    const mappingRef = doc(collection(db, MAPPINGS_COLLECTION));
    batch.set(mappingRef, stripUndefined({
      teacherId,
      studentId: student.id,
      studentName: student.name,
      studentCode: student.studentCode,
      courseId,
      courseName,
      batchId,
      batchName,
      sectionId,
      sectionName,
      assignmentId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }

  await batch.commit();
  // Union of old + new: students dropped from this assignment need their
  // assignedTeacherIds recomputed (they may still be covered by another
  // assignment to the same teacher, or not — recomputeAssignedTeacherIds derives
  // the correct answer fresh either way.
  await recomputeAssignedTeacherIds([...oldStudentIds, ...students.map((s) => s.id)]);

  await logAssignmentHistory({
    assignmentId,
    teacherId,
    teacherName,
    courseId,
    courseName,
    batchName,
    sectionName,
    action: "updated",
    studentIds: students.map((s) => s.id),
    studentCount: students.length,
    changedByAdminId: input.createdByAdminId,
    changedByAdminName: input.createdByAdminName,
  });
}

// ===================== Admin: Remove Assignment =====================

/**
 * Remove a teacher assignment and all its mappings. Logs to history.
 */
export async function removeTeacherAssignment(
  assignmentId: string,
  adminInfo?: { id?: string; name?: string }
): Promise<void> {
  const assignmentRef = doc(db, ASSIGNMENTS_COLLECTION, assignmentId);
  const existingSnap = await getDoc(assignmentRef);
  if (!existingSnap.exists()) {
    throw new Error("Assignment not found.");
  }
  const existing = { ...existingSnap.data(), id: existingSnap.id } as TeacherAssignment;

  const batch = writeBatch(db);

  // Delete mappings
  const mappingsQ = query(
    collection(db, MAPPINGS_COLLECTION),
    where("assignmentId", "==", assignmentId)
  );
  const mappingsSnap = await getDocs(mappingsQ);
  const studentIds: string[] = [];
  mappingsSnap.docs.forEach((m) => {
    const data = m.data();
    if (data.studentId) studentIds.push(data.studentId);
    batch.delete(doc(db, MAPPINGS_COLLECTION, m.id));
  });

  batch.delete(assignmentRef);
  await batch.commit();
  await recomputeAssignedTeacherIds(studentIds);

  await logAssignmentHistory({
    assignmentId,
    teacherId: existing.teacherId,
    teacherName: existing.teacherName,
    courseId: existing.courseId,
    courseName: existing.courseName,
    batchName: existing.batchName,
    sectionName: existing.sectionName,
    action: "removed",
    studentIds,
    studentCount: studentIds.length,
    changedByAdminId: adminInfo?.id,
    changedByAdminName: adminInfo?.name,
  });
}

// ===================== Queries =====================

/**
 * Get all teacher assignments (admin view).
 */
export async function getAllAssignments(): Promise<TeacherAssignment[]> {
  const q = query(collection(db, ASSIGNMENTS_COLLECTION), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return docToData<TeacherAssignment>(snapshot);
}

/**
 * Get assignments for a specific teacher.
 */
export async function getAssignmentsByTeacher(teacherId: string): Promise<TeacherAssignment[]> {
  const q = query(
    collection(db, ASSIGNMENTS_COLLECTION),
    where("teacherId", "==", teacherId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);
  return docToData<TeacherAssignment>(snapshot);
}

/**
 * Get unique assigned courses for a teacher.
 */
export async function getAssignedCourses(teacherId: string): Promise<TeacherAssignment[]> {
  const assignments = await getAssignmentsByTeacher(teacherId);
  const seen = new Map<string, TeacherAssignment>();
  assignments.forEach((a) => {
    if (!seen.has(a.courseId)) seen.set(a.courseId, a);
  });
  return Array.from(seen.values());
}

export interface AssignedCatalogEntry {
  courseId: string;
  courseName: string;
  courseCode?: string;
  batches: {
    batchId: string;
    batchName: string;
    sections: { sectionId: string; sectionName: string }[];
  }[];
}

/**
 * Pure grouping of a teacher's assignments into a Course -> Batch -> Section
 * tree. Shared by the one-shot `getAssignedBatchesSections` query and the
 * realtime `subscribeToAssignedCatalog` subscription below, so exam/notice/
 * classroom pickers that need "only what this teacher is actually assigned
 * to" all derive it the same way.
 */
export function groupAssignmentsByCourse(assignments: TeacherAssignment[]): AssignedCatalogEntry[] {
  const courseMap = new Map<string, { courseId: string; courseName: string; courseCode?: string; batches: Map<string, Set<string>> }>();
  assignments.forEach((a) => {
    if (!courseMap.has(a.courseId)) {
      courseMap.set(a.courseId, { courseId: a.courseId, courseName: a.courseName || a.courseId, courseCode: a.courseCode, batches: new Map() });
    }
    const course = courseMap.get(a.courseId)!;
    if (!course.batches.has(a.batchId)) course.batches.set(a.batchId, new Set());
    course.batches.get(a.batchId)!.add(a.sectionId);
  });

  return Array.from(courseMap.values()).map((c) => ({
    courseId: c.courseId,
    courseName: c.courseName,
    courseCode: c.courseCode,
    batches: Array.from(c.batches.entries()).map(([batchId, sectionIds]) => {
      const firstAssign = assignments.find((a) => a.batchId === batchId);
      return {
        batchId,
        batchName: firstAssign?.batchName || batchId,
        sections: Array.from(sectionIds).map((sid) => {
          const secAssign = assignments.find((a) => a.sectionId === sid && a.batchId === batchId);
          return { sectionId: sid, sectionName: secAssign?.sectionName || sid };
        }).sort((x, y) => x.sectionName.localeCompare(y.sectionName)),
      };
    }).sort((x, y) => x.batchName.localeCompare(y.batchName)),
  }));
}

/**
 * Get unique batch+section groups assigned to a teacher, grouped by course.
 */
export async function getAssignedBatchesSections(
  teacherId: string
): Promise<AssignedCatalogEntry[]> {
  const assignments = await getAssignmentsByTeacher(teacherId);
  return groupAssignmentsByCourse(assignments);
}

/**
 * Get all student mappings for a teacher (their assigned students).
 */
export async function getAssignedStudents(teacherId: string): Promise<TeacherStudentMapping[]> {
  const q = query(collection(db, MAPPINGS_COLLECTION), where("teacherId", "==", teacherId));
  const snapshot = await getDocs(q);
  return docToData<TeacherStudentMapping>(snapshot);
}

/**
 * Get the set of student IDs a teacher can access.
 */
export async function getAssignedStudentIds(teacherId: string): Promise<string[]> {
  const mappings = await getAssignedStudents(teacherId);
  return Array.from(new Set(mappings.map((m) => m.studentId)));
}

/**
 * Check if a teacher can access a specific student.
 */
export async function isStudentAssignedToTeacher(
  teacherId: string,
  studentId: string
): Promise<boolean> {
  const q = query(
    collection(db, MAPPINGS_COLLECTION),
    where("teacherId", "==", teacherId),
    where("studentId", "==", studentId),
    limit(1)
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

// ===================== Real-time Sync =====================

/**
 * Subscribe to a teacher's assignments (real-time). Returns unsubscribe.
 */
export function subscribeToTeacherAssignments(
  teacherId: string,
  callback: (assignments: TeacherAssignment[]) => void
): () => void {
  const q = query(
    collection(db, ASSIGNMENTS_COLLECTION),
    where("teacherId", "==", teacherId)
  );
  return onSnapshot(q, (snapshot) => {
    callback(docToData<TeacherAssignment>(snapshot));
  }, (error) => {
    console.error("[Assignments] Teacher assignments subscription error:", error);
  });
}

/**
 * Realtime Course -> Batch -> Section tree scoped to what THIS teacher was
 * actually assigned by an admin. This is the picker data source for exam
 * creation, notice creation, and classroom Course/Batch/Section bulk-add —
 * a teacher can only ever target students within a group they were assigned.
 */
export function subscribeToAssignedCatalog(
  teacherId: string,
  callback: (grouped: AssignedCatalogEntry[]) => void
): () => void {
  return subscribeToTeacherAssignments(teacherId, (assignments) => {
    callback(groupAssignmentsByCourse(assignments));
  });
}

/**
 * Subscribe to a teacher's assigned students (real-time). Returns unsubscribe.
 */
export function subscribeToAssignedStudents(
  teacherId: string,
  callback: (mappings: TeacherStudentMapping[]) => void
): () => void {
  const q = query(
    collection(db, MAPPINGS_COLLECTION),
    where("teacherId", "==", teacherId)
  );
  return onSnapshot(q, (snapshot) => {
    callback(docToData<TeacherStudentMapping>(snapshot));
  }, (error) => {
    console.error("[Assignments] Assigned students subscription error:", error);
  });
}

/**
 * Subscribe to all assignments (admin real-time view). Returns unsubscribe.
 */
export function subscribeToAllAssignments(
  callback: (assignments: TeacherAssignment[]) => void
): () => void {
  const q = query(collection(db, ASSIGNMENTS_COLLECTION), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(docToData<TeacherAssignment>(snapshot));
  }, (error) => {
    console.error("[Assignments] All assignments subscription error:", error);
  });
}

/**
 * Subscribe to assignment history (admin real-time view). Returns unsubscribe.
 */
export function subscribeToAssignmentHistory(
  callback: (history: AssignmentHistory[]) => void,
  maxItems: number = 100
): () => void {
  const q = query(
    collection(db, HISTORY_COLLECTION),
    orderBy("timestamp", "desc"),
    limit(maxItems)
  );
  return onSnapshot(q, (snapshot) => {
    callback(docToData<AssignmentHistory>(snapshot));
  }, (error) => {
    console.error("[Assignments] History subscription error:", error);
  });
}

