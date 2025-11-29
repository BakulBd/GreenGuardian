import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "./config";
import { User, UserRole } from "../types";

export async function registerUser(
  email: string,
  password: string,
  name: string,
  role: UserRole
): Promise<{ user: User; error?: string }> {
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const firebaseUser = userCredential.user;

    // Create user document in Firestore
    const userData: User = {
      id: firebaseUser.uid,
      name,
      email,
      role,
      approved: role === "student" || role === "admin", // Students and admins are auto-approved
      rejected: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, "users", firebaseUser.uid), userData);

    return { user: userData };
  } catch (error: any) {
    return {
      user: {} as User,
      error: error.message || "Registration failed",
    };
  }
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: User | null; error?: string }> {
  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    const firebaseUser = userCredential.user;

    // Get user data from Firestore
    const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));

    if (!userDoc.exists()) {
      await firebaseSignOut(auth);
      return { user: null, error: "User data not found" };
    }

    const userData = userDoc.data() as User;

    // Check if teacher is approved
    if (userData.role === "teacher" && !userData.approved) {
      // Allow login but will be redirected to pending page
      return { user: userData };
    }

    if (userData.rejected) {
      await firebaseSignOut(auth);
      return { user: null, error: "Your application was rejected" };
    }

    return { user: userData };
  } catch (error: any) {
    return { user: null, error: error.message || "Login failed" };
  }
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = { ...userDoc.data(), id: firebaseUser.uid } as User;
          callback(userData);
        } else {
          // User exists in Auth but not in Firestore - create minimal record
          console.warn("User found in Auth but not Firestore:", firebaseUser.uid);
          callback(null);
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        callback(null);
      }
    } else {
      callback(null);
    }
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return null;

  const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
  if (!userDoc.exists()) return null;

  return userDoc.data() as User;
}

export async function updateUserProfile(
  userId: string,
  data: Partial<User>
): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function approveTeacher(userId: string): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    approved: true,
    rejected: false,
    updatedAt: serverTimestamp(),
  });
}

export async function rejectTeacher(userId: string): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    approved: false,
    rejected: true,
    updatedAt: serverTimestamp(),
  });
}
