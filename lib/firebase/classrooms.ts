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
    (error) => console.warn("[Classrooms] Teacher classrooms subscription error:", error.code || error)
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
  | { success: true; classroomId: string; classroomName: string }
  | { success: false; error: string };

/**
 * Join a classroom by code. Validates, in order: code exists, classroom is
 * active, student is not already a member, and — the actual security
 * boundary, enforced again server-side by firestore.rules — the classroom's
 * teacher is one this student is actually assigned to (Task 10's
 * `assignedTeacherIds`). A student who knows a code for a teacher they
 * aren't assigned to is rejected here AND would be denied by the rules even
 * if this check were bypassed.
 */
export async function joinClassroomByCode(code: string, student: User): Promise<JoinClassroomResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { success: false, error: "Please enter a classroom code." };

  const classroom = await getClassroomByCode(trimmed);
  if (!classroom) return { success: false, error: "Invalid classroom code." };
  if (classroom.status !== "active") return { success: false, error: "This classroom is archived and not accepting new members." };

  const existing = await getDoc(doc(db, MEMBERS, memberId(classroom.id, student.id)));
  if (existing.exists()) return { success: false, error: "You have already joined this classroom." };

  const assignedTeacherIds = student.assignedTeacherIds || [];
  if (!assignedTeacherIds.includes(classroom.teacherId)) {
    return { success: false, error: "You are not assigned to this teacher, so you cannot join this classroom." };
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, MEMBERS, memberId(classroom.id, student.id)), stripUndefined({
      classroomId: classroom.id,
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      studentCode: student.studentCode,
      joinedAt: serverTimestamp(),
    }));
    batch.update(doc(db, CLASSROOMS, classroom.id), { studentCount: increment(1), updatedAt: serverTimestamp() });
    await batch.commit();
    return { success: true, classroomId: classroom.id, classroomName: classroom.name };
  } catch (error: any) {
    return { success: false, error: error.code === "permission-denied" ? "You are not allowed to join this classroom." : (error.message || "Failed to join classroom.") };
  }
}

export async function leaveClassroom(classroomId: string, studentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, MEMBERS, memberId(classroomId, studentId)));
  batch.update(doc(db, CLASSROOMS, classroomId), { studentCount: increment(-1), updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function removeClassroomMember(classroomId: string, studentId: string): Promise<void> {
  return leaveClassroom(classroomId, studentId);
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
    (error) => console.warn("[Classrooms] Members subscription error:", error.code || error)
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
    (error) => console.warn("[Classrooms] Student classrooms subscription error:", error.code || error)
  );
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
    (error) => console.warn("[Classrooms] Posts subscription error:", error.code || error)
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

export function subscribeToPostComments(postId: string, callback: (comments: ClassroomComment[]) => void): () => void {
  const q = query(collection(db, COMMENTS), where("postId", "==", postId));
  return onSnapshot(
    q,
    (snap) => {
      const comments = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassroomComment));
      callback(comments.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
    },
    (error) => console.warn("[Classrooms] Comments subscription error:", error.code || error)
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

export function subscribeToClasswork(classroomId: string, callback: (items: ClassworkItem[]) => void): () => void {
  const q = query(collection(db, CLASSWORK), where("classroomId", "==", classroomId));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id } as ClassworkItem));
      callback(items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
    },
    (error) => console.warn("[Classrooms] Classwork subscription error:", error.code || error)
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
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const token = await currentUser.getIdToken();
    await fetch("/api/classroom/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  } catch (error) {
    console.warn("[Classrooms] Notification trigger failed (non-fatal):", error);
  }
}
