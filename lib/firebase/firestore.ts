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
  limit,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "./config";
import { User, UserRole } from "../types";

// Users
export async function getUser(userId: string): Promise<User | null> {
  const userDoc = await getDoc(doc(db, "users", userId));
  if (!userDoc.exists()) return null;
  return { ...userDoc.data(), id: userDoc.id } as User;
}

export async function getAllUsers(): Promise<User[]> {
  const usersSnapshot = await getDocs(collection(db, "users"));
  return usersSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as User));
}

export async function getUsersByRole(role: UserRole): Promise<User[]> {
  try {
    const q = query(collection(db, "users"), where("role", "==", role));
    const snapshot = await getDocs(q);
    const users = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as User));
    if (users.length > 0) return users;

    // Fallback: fetch all users and filter in-memory
    const allUsers = await getAllUsers();
    return allUsers.filter(u => u.role === role || (role === "student" && u.role !== "teacher" && u.role !== "admin"));
  } catch (error) {
    console.warn("getUsersByRole fallback:", error);
    const allUsers = await getAllUsers();
    return allUsers.filter(u => u.role === role || (role === "student" && u.role !== "teacher" && u.role !== "admin"));
  }
}

export async function getPendingTeachers(): Promise<User[]> {
  const q = query(
    collection(db, "users"),
    where("role", "==", "teacher"),
    where("approved", "==", false),
    where("rejected", "!=", true)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as User));
}

export async function getApprovedTeachers(): Promise<User[]> {
  const q = query(
    collection(db, "users"),
    where("role", "==", "teacher"),
    where("approved", "==", true)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as User));
}

export async function updateUser(userId: string, data: Partial<User>): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await deleteDoc(doc(db, "users", userId));
}

// Dashboard Stats
export async function getDashboardStats() {
  const [usersSnapshot, examsSnapshot, sessionsSnapshot] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "exams")),
    getDocs(collection(db, "examSessions")),
  ]);

  const users = usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as any);
  const exams = examsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as any);
  const sessions = sessionsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as any);

  const totalStudents = users.filter((u) => u.role === "student").length;
  const totalTeachers = users.filter((u) => u.role === "teacher" && u.approved).length;
  const pendingApprovals = users.filter(
    (u) => u.role === "teacher" && !u.approved && !u.rejected
  ).length;
  const totalExams = exams.length;
  const activeExams = exams.filter((e) => e.status === "active").length;
  const flaggedSessions = sessions.filter((s) => s.flagged).length;

  // Sessions still open right now, using the same heartbeat window the
  // invigilation views use, so the dashboard and Watch Live agree.
  const now = Date.now();
  const liveSessions = sessions.filter((s) => {
    if (s.submitted === true) return false;
    if (s.status && s.status !== "in-progress" && s.status !== "started") return false;
    const last = toMillis(s.updatedAt || s.startTime);
    return last > 0 && now - last < 90_000;
  }).length;

  const publishedExams = exams.filter(
    (e) => e.status === "published" || e.status === "active"
  ).length;
  const submittedSessions = sessions.filter(
    (s) => s.submitted === true || s.status === "submitted" || s.status === "auto-submitted"
  ).length;
  const suspendedAccounts = users.filter(
    (u) => u.status === "hold" || u.status === "suspended"
  ).length;

  // A single recent-activity feed built from records that already exist —
  // newest first. The dashboard card used to render a hardcoded
  // "No recent activity" string that never changed no matter what happened.
  const activity: Array<{
    id: string;
    kind: "user" | "exam" | "session";
    message: string;
    detail?: string;
    at: number;
  }> = [];

  users.forEach((u) => {
    const at = toMillis(u.createdAt);
    if (!at) return;
    activity.push({
      id: `user-${u.id}`,
      kind: "user",
      message:
        u.role === "teacher"
          ? `${u.name || "A teacher"} registered as a teacher`
          : `${u.name || "A student"} registered`,
      detail:
        u.role === "teacher" && !u.approved && !u.rejected ? "Awaiting approval" : undefined,
      at,
    });
  });

  exams.forEach((e) => {
    const at = toMillis(e.createdAt);
    if (!at) return;
    activity.push({
      id: `exam-${e.id}`,
      kind: "exam",
      message: `Exam "${e.title || "Untitled"}" created`,
      detail: e.teacherName ? `by ${e.teacherName}` : undefined,
      at,
    });
  });

  sessions.forEach((s) => {
    const at = toMillis(s.completedAt || s.startTime);
    if (!at) return;
    activity.push({
      id: `session-${s.id}`,
      kind: "session",
      message: `${s.studentName || "A student"} ${
        s.submitted ? "submitted" : "started"
      } ${s.examTitle ? `"${s.examTitle}"` : "an exam"}`,
      detail: s.flagged ? "Flagged for review" : undefined,
      at,
    });
  });

  activity.sort((a, b) => b.at - a.at);

  return {
    totalStudents,
    totalTeachers,
    totalExams,
    activeExams,
    pendingApprovals,
    flaggedSessions,
    liveSessions,
    publishedExams,
    submittedSessions,
    suspendedAccounts,
    recentActivity: activity.slice(0, 8),
  };
}

/** Firestore Timestamp | Date | ISO string -> epoch ms (0 when unusable). */
function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const d = new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}
