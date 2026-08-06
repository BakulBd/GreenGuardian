import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
  EmailAuthProvider,
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
import { User, UserRole, UserStatus } from "../types";

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

    // Blocked accounts (set by an admin) may not sign in at all.
    if (userData.status === "suspended") {
      await firebaseSignOut(auth);
      return {
        user: null,
        error: userData.statusReason
          ? `Your account has been suspended: ${userData.statusReason}`
          : "Your account has been suspended. Please contact an administrator.",
      };
    }
    if (userData.status === "hold") {
      await firebaseSignOut(auth);
      return {
        user: null,
        error: userData.statusReason
          ? `Your account is on hold: ${userData.statusReason}`
          : "Your account is on hold. Please contact an administrator.",
      };
    }

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
    let errorMessage = error.message || "Login failed";
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
      errorMessage = "Invalid email or password.";
    }
    return { user: null, error: errorMessage };
  }
}

export async function signOut(): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.removeItem("greenguardian_user_cache");
    localStorage.removeItem("greenguardian_auth_token");
  }
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

/**
 * Sets a student or teacher's account status (admin only — enforced by
 * Firestore rules). "hold" and "suspended" both block login and further app
 * access; "active" restores it. See loginUser() and AuthContext's live
 * status listener for enforcement.
 */
export async function setUserStatus(
  userId: string,
  status: UserStatus,
  adminId: string,
  reason?: string
): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    status,
    statusReason: reason || "",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: adminId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Changes the signed-in user's password. Re-authenticates with the current
 * password first — Firebase requires a recent login for this operation, and
 * doing so also doubles as verifying the current password is correct.
 * Firebase Auth is the sole source of truth for the credential; no password
 * data is stored in Firestore, so there is nothing to sync there.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser || !firebaseUser.email) {
    return { success: false, error: "You must be signed in to change your password." };
  }

  try {
    const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, newPassword);
    return { success: true };
  } catch (error: any) {
    let errorMessage = error.message || "Failed to change password.";
    if (
      error.code === "auth/wrong-password" ||
      error.code === "auth/invalid-credential"
    ) {
      errorMessage = "Current password is incorrect.";
    } else if (error.code === "auth/weak-password") {
      errorMessage = "New password is too weak.";
    } else if (error.code === "auth/requires-recent-login") {
      errorMessage = "Please log out and log back in, then try again.";
    } else if (error.code === "auth/too-many-requests") {
      errorMessage = "Too many attempts. Please try again later.";
    } else if (error.code === "auth/network-request-failed") {
      errorMessage = "Network error. Please check your connection and try again.";
    }
    return { success: false, error: errorMessage };
  }
}
