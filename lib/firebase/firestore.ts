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
  const q = query(collection(db, "users"), where("role", "==", role));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as User));
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

  const users = usersSnapshot.docs.map((doc) => doc.data());
  const exams = examsSnapshot.docs.map((doc) => doc.data());
  const sessions = sessionsSnapshot.docs.map((doc) => doc.data());

  const totalStudents = users.filter((u) => u.role === "student").length;
  const totalTeachers = users.filter((u) => u.role === "teacher" && u.approved).length;
  const pendingApprovals = users.filter(
    (u) => u.role === "teacher" && !u.approved && !u.rejected
  ).length;
  const totalExams = exams.length;
  const activeExams = exams.filter((e) => e.status === "active").length;
  const flaggedSessions = sessions.filter((s) => s.flagged).length;

  return {
    totalStudents,
    totalTeachers,
    totalExams,
    activeExams,
    pendingApprovals,
    flaggedSessions,
  };
}
