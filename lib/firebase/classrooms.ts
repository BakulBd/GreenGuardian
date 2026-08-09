import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot,
  increment,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "./config";
import {
  Classroom,
  ClassroomMember,
  ClassroomPost,
  ClassroomComment,
  ClassworkItem,
  ClassroomPostType,
  ClassworkType,
  ClassroomAttachment,
  User,
} from "../types";
import { getStudentGroup } from "./assignments";
import { authedFetch } from "../utils/api-client";

/**
 * Ask the server to recompute `users/{id}.assignedTeacherIds` for these
 * students from both admin assignments and classroom memberships.
 *
 * This cannot run on the client: students may not read
 * `teacher_student_mapping` and teachers may not write another user's doc,
 * so a client-side recompute would silently drop admin assignments (or fail
 * outright) and leave the student unable to see notices/exams.
 *
 * It is deliberately NON-FATAL. Every caller has already committed the write
 * the user actually asked for (the membership document) before getting here,
 * so a failed sync means "teacher content may take a moment to appear", not
 * "the operation failed". Throwing was what surfaced a server-side problem —
 * a 503 from an unconfigured Admin SDK, a 401 from a stale token — as
 * "Invalid or Expired Session" on a classroom that had, in fact, just been
 * created. The outcome is reported back so callers can mention a delay
 * without claiming failure.
 */
export interface AccessSyncOutcome {
  ok: boolean;
  /** Present when the sync did not complete; already user-readable. */
  error?: string;
}

async function syncClassroomAccess(
  studentIds: string[],
  options?: { keepalive?: boolean }
): Promise<AccessSyncOutcome> {
  if (studentIds.length === 0) return { ok: true };
  try {
    await authedFetch("/api/classroom/sync-access", {
      method: "POST",
      body: { studentIds },
      fallbackError: "Could not refresh classroom access.",
      keepalive: options?.keepalive,
    });
    return { ok: true };
  } catch (error: any) {
    console.warn("[Classrooms] Access sync failed (non-fatal):", error?.message || error);
    return { ok: false, error: error?.message || "Could not refresh classroom access." };
  }
}

const CLASSROOMS = "classrooms";
const MEMBERS = "classroomMembers";
const POSTS = "classroomPosts";
const COMMENTS = "classroomComments";
const CLASSWORK = "classroomClasswork";

function memberId(classroomId: string, studentId: string): string {
  return `${classroomId}_${studentId}`;
}

function stripUndefined(data: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined) clean[k] = v;
  });
  return clean;
}

// ===================== Classrooms =====================

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, I/1 — avoids ambiguity

function randomCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function generateUniqueClassroomCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const existing = await getDocs(query(collection(db, CLASSROOMS), where("code", "==", code)));
    if (existing.empty) return code;
  }
  // Astronomically unlikely, but fall back to a longer code rather than looping forever.
  return randomCode(10);
}

export interface CreateClassroomInput {
  name: string;
  subject: string;
  section: string;
  semester?: string;
  description?: string;
  teacherId: string;
  teacherName: string;
}

export async function createClassroom(input: CreateClassroomInput): Promise<string> {
  if (!input.name?.trim()) throw new Error("Classroom name is required.");
  if (!input.subject?.trim()) throw new Error("Subject is required.");
  if (!input.section?.trim()) throw new Error("Section is required.");

  const code = await generateUniqueClassroomCode();

  const docRef = await addDoc(collection(db, CLASSROOMS), stripUndefined({
    name: input.name.trim(),
    subject: input.subject.trim(),
    section: input.section.trim(),
    semester: input.semester?.trim() || undefined,
    description: input.description?.trim() || "",
    code,
    teacherId: input.teacherId,
    teacherName: input.teacherName,
    status: "active",
    studentCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  return docRef.id;
}

export async function updateClassroom(
  classroomId: string,
  data: Partial<Pick<Classroom, "name" | "subject" | "section" | "semester" | "description">>
): Promise<void> {
  await updateDoc(doc(db, CLASSROOMS, classroomId), stripUndefined({ ...data, updatedAt: serverTimestamp() }));
}

export async function archiveClassroom(classroomId: string): Promise<void> {
  await updateDoc(doc(db, CLASSROOMS, classroomId), {
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function restoreClassroom(classroomId: string): Promise<void> {
  await updateDoc(doc(db, CLASSROOMS, classroomId), {
    status: "active",
    archivedAt: null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Permanently deletes a classroom and everything in it. Firestore has no
 * cascade delete, so this best-effort cleans up members/posts/comments/
 * classwork first — mirrors the pattern in lib/firebase/exams.ts#deleteExam.
 */
export async function deleteClassroom(classroomId: string): Promise<void> {
  const collections = [MEMBERS, POSTS, CLASSWORK];
  for (const col of collections) {
    const snap = await getDocs(query(collection(db, col), where("classroomId", "==", classroomId)));
    for (const d of snap.docs) {
      await deleteDoc(doc(db, col, d.id)).catch(() => {});
    }
  }
  const commentsSnap = await getDocs(query(collection(db, COMMENTS), where("classroomId", "==", classroomId)));
  for (const d of commentsSnap.docs) {
    await deleteDoc(doc(db, COMMENTS, d.id)).catch(() => {});
  }
  await deleteDoc(doc(db, CLASSROOMS, classroomId));
}

export async function getClassroom(classroomId: string): Promise<Classroom | null> {
  const snap = await getDoc(doc(db, CLASSROOMS, classroomId));
  return snap.exists() ? ({ ...snap.data(), id: snap.id } as Classroom) : null;
}

export async function getClassroomByCode(code: string): Promise<Classroom | null> {
  const snap = await getDocs(query(collection(db, CLASSROOMS), where("code", "==", code.trim().toUpperCase())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...d.data(), id: d.id } as Classroom;
}

export async function getTeacherClassrooms(teacherId: string): Promise<Classroom[]> {
  const snap = await getDocs(query(collection(db, CLASSROOMS), where("teacherId", "==", teacherId)));
  const classrooms = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Classroom));
  return classrooms.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export function subscribeToTeacherClassrooms(teacherId: string, callback: (classrooms: Classroom[]) => void): () => void {
  const q = query(collection(db, CLASSROOMS), where("teacherId", "==", teacherId));
  return onSnapshot(
    q,
    (snap) => {
      const classrooms = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Classroom));
      callback(classrooms.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
    },
    (error) => {
      // Hand back an empty list as well as logging: callers flip their
      // `loading` flag inside the success callback, so a silent failure left
      // the page spinning forever with no way out but a reload.
      console.warn("[Classrooms] Teacher classrooms subscription error:", error.code || error);
      callback([]);
    }
  );
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ===================== Membership (join/leave/roster) =====================

export type JoinClassroomResult =
  | {
      success: true;
      classroomId: string;
      classroomName: string;
      /**
       * The join committed, but `assignedTeacherIds` could not be recomputed.
       * The classroom is joined; this teacher's notices and exams may not
       * appear until the next sync.
       */
      accessSyncPending?: boolean;
    }
  | { success: false; error: string };

/**
 * Join a classroom by code. Classroom membership is its own source of
 * truth for teacher access — joining does NOT require a pre-existing admin
 * Course/Batch/Section assignment (that used to be a hard, undocumented
 * dependency between two unrelated features and was why "join by code"
 * looked broken for any student the admin hadn't separately assigned).
 * Any student with a valid, active code may join; doing so denormalizes
 * `teacherId` on the membership and recomputes the student's
 * `assignedTeacherIds` so exam/notice visibility picks it up immediately.
 */
export async function joinClassroomByCode(code: string, student: User): Promise<JoinClassroomResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { success: false, error: "Please enter a classroom code." };

  const classroom = await getClassroomByCode(trimmed);
  if (!classroom) return { success: false, error: "Invalid classroom code." };
  if (classroom.status !== "active") return { success: false, error: "This classroom is archived and not accepting new members." };

  const existing = await getDoc(doc(db, MEMBERS, memberId(classroom.id, student.id)));
  if (existing.exists()) return { success: false, error: "You have already joined this classroom." };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, MEMBERS, memberId(classroom.id, student.id)), stripUndefined({
      classroomId: classroom.id,
      teacherId: classroom.teacherId,
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      studentCode: student.studentCode,
      addedVia: "code",
      joinedAt: serverTimestamp(),
    }));
    batch.update(doc(db, CLASSROOMS, classroom.id), { studentCount: increment(1), updatedAt: serverTimestamp() });
    await batch.commit();
  } catch (error: any) {
    // Log the real cause — collapsing every permission-denied into one
    // friendly string previously made this failure undiagnosable in prod.
    console.error("[Classrooms] Join failed:", error?.code, error?.message);
    return {
      success: false,
      error:
        error?.code === "permission-denied"
          ? "You are not allowed to join this classroom."
          : error?.message || "Failed to join classroom.",
    };
  }

  // Membership is already committed at this point — a sync failure must not
  // be reported as a failed join. It only means teacher content may take a
  // moment (or an admin re-sync) to appear.
  const sync = await syncClassroomAccess([student.id]);

  return {
    success: true,
    classroomId: classroom.id,
    classroomName: classroom.name,
    accessSyncPending: !sync.ok,
  };
}

export async function leaveClassroom(classroomId: string, studentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, MEMBERS, memberId(classroomId, studentId)));
  batch.update(doc(db, CLASSROOMS, classroomId), { studentCount: increment(-1), updatedAt: serverTimestamp() });
  await batch.commit();
  // Recompute rather than blindly unassign — the student may still be
  // linked to this teacher via an admin assignment or another classroom.
  //
  // `keepalive` matters here: leaving is frequently the last thing a student
  // does before navigating away, and a normal fetch is cancelled the moment
  // the page starts unloading — which is what made this call look like a 503
  // rather than an aborted request. The membership row is already gone either
  // way, so a missed sync self-corrects on the student's next join/leave.
  await syncClassroomAccess([studentId], { keepalive: true });
}

export async function removeClassroomMember(classroomId: string, studentId: string): Promise<void> {
  return leaveClassroom(classroomId, studentId);
}

/**
 * Teacher-initiated: add a single student directly to a classroom (no code
 * needed). Requires the caller to already know the student's `User` record
 * (looked up by the UI, e.g. via search).
 */
export async function addStudentToClassroom(classroom: Pick<Classroom, "id" | "teacherId">, student: User): Promise<void> {
  const existing = await getDoc(doc(db, MEMBERS, memberId(classroom.id, student.id)));
  if (existing.exists()) throw new Error(`${student.name} is already a member of this classroom.`);

  const batch = writeBatch(db);
  batch.set(doc(db, MEMBERS, memberId(classroom.id, student.id)), stripUndefined({
    classroomId: classroom.id,
    teacherId: classroom.teacherId,
    studentId: student.id,
    studentName: student.name,
    studentEmail: student.email,
    studentCode: student.studentCode,
    addedVia: "teacher",
    joinedAt: serverTimestamp(),
  }));
  batch.update(doc(db, CLASSROOMS, classroom.id), { studentCount: increment(1), updatedAt: serverTimestamp() });
  await batch.commit();
  await syncClassroomAccess([student.id]);
}

/**
 * Teacher-initiated bulk add: every student currently in a Course+Batch+
 * Section group (reusing the same resolution as admin Assignments — see
 * lib/firebase/assignments.ts#getStudentGroup) is added as a classroom
 * member in one pass. Students already in the classroom are skipped.
 */
export async function addStudentsToClassroomByGroup(
  classroom: Pick<Classroom, "id" | "teacherId">,
  courseId: string,
  batchName: string,
  sectionName: string
): Promise<{ added: number; alreadyMembers: number; accessSyncPending?: boolean }> {
  const [group, existingMembers] = await Promise.all([
    getStudentGroup(courseId, batchName, sectionName),
    getClassroomMembers(classroom.id),
  ]);
  const existingIds = new Set(existingMembers.map((m) => m.studentId));
  const toAdd = group.filter((s) => !existingIds.has(s.id));
  if (toAdd.length === 0) return { added: 0, alreadyMembers: group.length };

  const CHUNK = 400; // stay under Firestore's 500-write batch limit alongside the studentCount update
  for (let i = 0; i < toAdd.length; i += CHUNK) {
    const chunk = toAdd.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const student of chunk) {
      batch.set(doc(db, MEMBERS, memberId(classroom.id, student.id)), stripUndefined({
        classroomId: classroom.id,
        teacherId: classroom.teacherId,
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        studentCode: student.studentCode,
        addedVia: "teacher",
        joinedAt: serverTimestamp(),
      }));
    }
    batch.update(doc(db, CLASSROOMS, classroom.id), { studentCount: increment(chunk.length), updatedAt: serverTimestamp() });
    await batch.commit();
  }

  const sync = await syncClassroomAccess(toAdd.map((s) => s.id));
  return {
    added: toAdd.length,
    alreadyMembers: group.length - toAdd.length,
    accessSyncPending: !sync.ok,
  };
}

export async function isClassroomMember(classroomId: string, studentId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, MEMBERS, memberId(classroomId, studentId)));
  return snap.exists();
}

export async function getClassroomMembers(classroomId: string): Promise<ClassroomMember[]> {
  const snap = await getDocs(query(collection(db, MEMBERS), where("classroomId", "==", classroomId)));
  const members = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassroomMember));
  return members.sort((a, b) => (a.studentName || "").localeCompare(b.studentName || ""));
}

export function subscribeToClassroomMembers(classroomId: string, callback: (members: ClassroomMember[]) => void): () => void {
  const q = query(collection(db, MEMBERS), where("classroomId", "==", classroomId));
  return onSnapshot(
    q,
    (snap) => {
      const members = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassroomMember));
      callback(members.sort((a, b) => (a.studentName || "").localeCompare(b.studentName || "")));
    },
    (error) => {
      console.warn("[Classrooms] Members subscription error:", error.code || error);
      callback([]);
    }
  );
}

export async function getStudentClassrooms(studentId: string): Promise<Classroom[]> {
  const memberSnap = await getDocs(query(collection(db, MEMBERS), where("studentId", "==", studentId)));
  const classroomIds = memberSnap.docs.map((d) => d.data().classroomId as string);
  if (classroomIds.length === 0) return [];

  const classrooms: Classroom[] = [];
  for (let i = 0; i < classroomIds.length; i += 30) {
    const chunk = classroomIds.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, CLASSROOMS), where(documentId(), "in", chunk)));
    snap.docs.forEach((d) => classrooms.push({ ...d.data(), id: d.id } as Classroom));
  }
  return classrooms.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export function subscribeToStudentClassrooms(studentId: string, callback: (classrooms: Classroom[]) => void): () => void {
  const q = query(collection(db, MEMBERS), where("studentId", "==", studentId));
  return onSnapshot(
    q,
    async (snap) => {
      const classroomIds = snap.docs.map((d) => d.data().classroomId as string);
      if (classroomIds.length === 0) {
        callback([]);
        return;
      }
      try {
        const classrooms: Classroom[] = [];
        for (let i = 0; i < classroomIds.length; i += 30) {
          const chunk = classroomIds.slice(i, i + 30);
          const classSnap = await getDocs(query(collection(db, CLASSROOMS), where(documentId(), "in", chunk)));
          classSnap.docs.forEach((d) => classrooms.push({ ...d.data(), id: d.id } as Classroom));
        }
        callback(classrooms.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
      } catch (error) {
        console.warn("[Classrooms] Failed to resolve student classrooms:", error);
        callback([]);
      }
    },
    (error) => {
      console.warn("[Classrooms] Student classrooms subscription error:", error.code || error);
      callback([]);
    }
  );
}

export async function getSuggestedClassroomsForStudent(student: User): Promise<Classroom[]> {
  if (!student || (!student.section && !student.batch)) return [];
  try {
    const q = query(collection(db, CLASSROOMS), where("status", "==", "active"));
    const snap = await getDocs(q);
    const joinedSnap = await getDocs(query(collection(db, MEMBERS), where("studentId", "==", student.id)));
    const joinedIds = new Set(joinedSnap.docs.map((d) => d.data().classroomId as string));

    const studentSections = student.sections && student.sections.length > 0 ? student.sections : student.section ? [student.section] : [];

    const suggested = snap.docs
      .map((d) => ({ ...d.data(), id: d.id } as Classroom))
      .filter((c) => {
        if (joinedIds.has(c.id)) return false;
        if (c.section && studentSections.includes(c.section)) return true;
        return false;
      });

    return suggested;
  } catch (err) {
    console.warn("[Classrooms] Failed to fetch suggested classrooms:", err);
    return [];
  }
}

// ===================== Stream (posts + comments) =====================

export interface CreatePostInput {
  classroomId: string;
  teacherId: string;
  teacherName: string;
  type: ClassroomPostType;
  title?: string;
  content: string;
  attachments?: ClassroomAttachment[];
}

export async function createClassroomPost(input: CreatePostInput): Promise<string> {
  if (!input.content?.trim() && (!input.attachments || input.attachments.length === 0)) {
    throw new Error("A post needs either text content or an attachment.");
  }
  const docRef = await addDoc(collection(db, POSTS), stripUndefined({
    classroomId: input.classroomId,
    teacherId: input.teacherId,
    teacherName: input.teacherName,
    type: input.type,
    title: input.title?.trim() || undefined,
    content: input.content.trim(),
    attachments: input.attachments || [],
    pinned: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return docRef.id;
}

export async function updateClassroomPost(postId: string, data: Partial<Pick<ClassroomPost, "title" | "content" | "attachments">>): Promise<void> {
  await updateDoc(doc(db, POSTS, postId), stripUndefined({ ...data, updatedAt: serverTimestamp() }));
}

export async function deleteClassroomPost(postId: string): Promise<void> {
  const commentsSnap = await getDocs(query(collection(db, COMMENTS), where("postId", "==", postId)));
  for (const d of commentsSnap.docs) {
    await deleteDoc(doc(db, COMMENTS, d.id)).catch(() => {});
  }
  await deleteDoc(doc(db, POSTS, postId));
}

export async function togglePinPost(postId: string, pinned: boolean): Promise<void> {
  await updateDoc(doc(db, POSTS, postId), { pinned, updatedAt: serverTimestamp() });
}

export function subscribeToClassroomPosts(classroomId: string, callback: (posts: ClassroomPost[]) => void): () => void {
  const q = query(collection(db, POSTS), where("classroomId", "==", classroomId));
  return onSnapshot(
    q,
    (snap) => {
      const posts = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassroomPost));
      posts.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return toMillis(b.createdAt) - toMillis(a.createdAt);
      });
      callback(posts);
    },
    (error) => {
      console.warn("[Classrooms] Posts subscription error:", error.code || error);
      callback([]);
    }
  );
}

export interface CreateCommentInput {
  postId: string;
  classroomId: string;
  authorId: string;
  authorName: string;
  authorRole: ClassroomComment["authorRole"];
  content: string;
}

export async function addClassroomComment(input: CreateCommentInput): Promise<string> {
  if (!input.content?.trim()) throw new Error("Comment cannot be empty.");
  const docRef = await addDoc(collection(db, COMMENTS), {
    postId: input.postId,
    classroomId: input.classroomId,
    authorId: input.authorId,
    authorName: input.authorName,
    authorRole: input.authorRole,
    content: input.content.trim(),
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function deleteClassroomComment(commentId: string): Promise<void> {
  await deleteDoc(doc(db, COMMENTS, commentId));
}

/**
 * Live comments on one post.
 *
 * The query filters on `classroomId` as well as `postId` so it matches the
 * shape the security rule authorises on (classroom membership). Equality-only
 * filters need no composite index, so this costs nothing and keeps the query
 * and the rule describing the same set of documents.
 */
export function subscribeToPostComments(
  postId: string,
  classroomId: string,
  callback: (comments: ClassroomComment[]) => void,
  onError?: (error: any) => void
): () => void {
  const q = query(
    collection(db, COMMENTS),
    where("classroomId", "==", classroomId),
    where("postId", "==", postId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const comments = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassroomComment));
      callback(comments.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
    },
    (error) => {
      console.warn("[Classrooms] Comments subscription error:", error.code || error);
      // Resolve the caller's loading state, but tell it the list is empty
      // *because it failed* — silently showing "no comments" for a
      // permission error is what hid this bug in the first place.
      callback([]);
      onError?.(error);
    }
  );
}

// ===================== Classwork =====================

export interface CreateClassworkInput {
  classroomId: string;
  teacherId: string;
  teacherName: string;
  type: ClassworkType;
  title: string;
  instructions?: string;
  attachments?: ClassroomAttachment[];
  externalLink?: string;
  dueDate?: Date | null;
  totalMarks?: number;
  status: "draft" | "published";
  scheduledAt?: Date | null;
}

export async function createClasswork(input: CreateClassworkInput): Promise<string> {
  if (!input.title?.trim()) throw new Error("Title is required.");
  const docRef = await addDoc(collection(db, CLASSWORK), stripUndefined({
    classroomId: input.classroomId,
    teacherId: input.teacherId,
    teacherName: input.teacherName,
    type: input.type,
    title: input.title.trim(),
    instructions: input.instructions?.trim() || "",
    attachments: input.attachments || [],
    externalLink: input.externalLink?.trim() || undefined,
    dueDate: input.dueDate || undefined,
    totalMarks: input.totalMarks,
    status: input.status,
    scheduledAt: input.scheduledAt || undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  return docRef.id;
}

export async function updateClasswork(itemId: string, data: Partial<CreateClassworkInput>): Promise<void> {
  await updateDoc(doc(db, CLASSWORK, itemId), stripUndefined({ ...data, updatedAt: serverTimestamp() }));
}

export async function publishClasswork(itemId: string): Promise<void> {
  await updateDoc(doc(db, CLASSWORK, itemId), { status: "published", updatedAt: serverTimestamp() });
}

export async function deleteClasswork(itemId: string): Promise<void> {
  await deleteDoc(doc(db, CLASSWORK, itemId));
}

/**
 * Classwork feed. Students MUST pass `publishedOnly` — the security rule only
 * lets a non-teacher read published items, and Firestore rejects a list query
 * it can't prove is entirely readable. Querying without the status filter as a
 * student was denied outright, and because the error path never invoked the
 * callback the tab sat on a spinner forever instead of showing an empty state.
 */
export function subscribeToClasswork(
  classroomId: string,
  callback: (items: ClassworkItem[]) => void,
  options?: { publishedOnly?: boolean; onError?: (error: any) => void }
): () => void {
  const constraints = [where("classroomId", "==", classroomId)];
  if (options?.publishedOnly) {
    constraints.push(where("status", "==", "published"));
  }
  const q = query(collection(db, CLASSWORK), ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassworkItem));
      callback(items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
    },
    (error) => {
      console.warn("[Classrooms] Classwork subscription error:", error.code || error);
      // Always resolve the caller's loading state, even on failure.
      callback([]);
      options?.onError?.(error);
    }
  );
}

// ===================== Notifications =====================

/**
 * Fire-and-forget trigger for /api/classroom/notify — fans a just-created
 * post/classwork item out to email + in-app notifications for every student
 * currently assigned to this classroom's teacher. Never throws; a failure
 * here should not block the teacher's post/publish action.
 */
export async function notifyClassroom(input: { classroomId: string; postId?: string; classworkId?: string; kind: "post" | "classwork" }): Promise<void> {
  try {
    await authedFetch("/api/classroom/notify", { method: "POST", body: input });
  } catch (error) {
    console.warn("[Classrooms] Notification trigger failed (non-fatal):", error);
  }
}
