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

import { resyncStudentAssignments } from "./assignments";

export async function updateUserProfile(
  userId: string,
  data: Partial<User>
): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

  if (data.batch || data.section || data.sections || data.courses) {
    try {
      await resyncStudentAssignments(userId);
    } catch (e) {
      console.warn("[Auth] Failed to resync student assignments on profile update:", e);
    }
  }
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
  if (!firebaseUser) {
    return { success: false, error: "You must be signed in to change your password." };
  }

  if (!currentPassword) {
    return { success: false, error: "Please enter your current password." };
  }

  try {
    // Refresh the locally cached Auth record before building the credential.
    //
    // `reauthenticateWithCredential` posts `currentUser.email` to
    // `accounts:signInWithPassword`, and that field is a *snapshot* taken when
    // the session was established. Anything that changes the account
    // server-side — an admin issuing a temporary password or correcting an
    // email address through the Admin SDK — leaves the browser holding a stale
    // copy, and the reauth request then carries an email/password pair the
    // backend has no record of. That is the HTTP 400 this flow was failing
    // with: not a wrong password, but a reauthentication built from stale
    // parameters. Reloading first makes the request describe the account as it
    // actually is.
    await firebaseUser.reload().catch((reloadError) => {
      // A failed reload is not fatal — the cached values may still be correct.
      console.warn("[Auth] Could not refresh the account before reauth:", reloadError);
    });

    const email = firebaseUser.email;
    if (!email) {
      return {
        success: false,
        error:
          "This account has no email sign-in credential, so its password cannot be changed here.",
      };
    }

    // A password can only be changed on an account that actually has a
    // password provider. Saying so beats a raw "invalid credential".
    const hasPasswordProvider = firebaseUser.providerData.some(
      (provider) => provider?.providerId === EmailAuthProvider.PROVIDER_ID
    );
    if (firebaseUser.providerData.length > 0 && !hasPasswordProvider) {
      return {
        success: false,
        error:
          "This account signs in through an external provider and has no password to change.",
      };
    }

    const credential = EmailAuthProvider.credential(email, currentPassword);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, newPassword);

    // Clear the "must change password" flag an admin-issued temporary password
    // sets. Best-effort: the password change itself already succeeded, and
    // failing here would be a confusing thing to report back.
    try {
      await updateDoc(doc(db, "users", firebaseUser.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      });
    } catch (flagError) {
      console.warn("[Auth] Could not clear mustChangePassword flag:", flagError);
    }

    return { success: true };
  } catch (error: any) {
    // The raw code is the only thing that distinguishes "wrong password" from
    // "your session no longer matches this account" — both surface as a 400
    // from `signInWithPassword`, and collapsing them is what made this
    // undiagnosable from a bug report.
    console.warn("[Auth] Password change failed:", error?.code, error?.message);

    const messagesByCode: Record<string, string> = {
      "auth/wrong-password": "Current password is incorrect.",
      "auth/invalid-credential": "Current password is incorrect.",
      "auth/invalid-login-credentials": "Current password is incorrect.",
      "auth/missing-password": "Please enter your current password.",
      "auth/weak-password":
        "New password is too weak. Use at least 8 characters with upper and lower case, a number, and a symbol.",
      "auth/requires-recent-login": "Please log out and log back in, then try again.",
      "auth/too-many-requests":
        "Too many attempts. Please wait a few minutes before trying again.",
      "auth/network-request-failed":
        "Network error. Please check your connection and try again.",
      // The three below all mean the browser's session no longer describes the
      // account — typically because an admin changed it underneath us. A
      // re-login rebuilds the session and the change then succeeds.
      "auth/user-mismatch": "Please sign out and sign in again, then try once more.",
      "auth/user-token-expired": "Your session has expired. Please sign in again.",
      "auth/invalid-user-token": "Your session is no longer valid. Please sign in again.",
      "auth/user-not-found": "This account no longer exists. Please contact an administrator.",
      "auth/user-disabled": "This account has been disabled. Please contact an administrator.",
      "auth/operation-not-allowed":
        "Email/password sign-in is disabled for this project. Please contact an administrator.",
    };

    return {
      success: false,
      error: messagesByCode[error?.code] || error?.message || "Failed to change password.",
    };
  }
}
