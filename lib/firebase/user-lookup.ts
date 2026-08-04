/**
 * Server-only email existence lookup.
 * Checks Firestore users collection AND Firebase Auth to prevent sending verification
 * emails to already registered accounts.
 */
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "./config";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "./admin";

/**
 * True when a user with `email` exists in Firestore `users` collection
 * or Firebase Auth.
 */
export async function hasCompleteProfile(email: string): Promise<boolean> {
  const cleanEmail = (email || "").trim().toLowerCase();
  
  if (isAdminSdkConfigured()) {
    try {
      const user = await getAdminAuth().getUserByEmail(cleanEmail);
      const doc = await getAdminDb().collection("users").doc(user.uid).get();
      if (doc.exists) return true;
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") return false;
    }
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) return true;
  } catch (e) {
    // Ignore query failure
  }

  return false;
}

/**
 * True when an email is already registered in Firebase Auth or Firestore users collection.
 */
export async function isEmailRegistered(email: string): Promise<boolean> {
  const cleanEmail = (email || "").trim().toLowerCase();

  // 1. Direct Firestore check
  try {
    const q = query(collection(db, "users"), where("email", "==", cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) return true;
  } catch (e) {
    // Ignore query failure
  }

  // 2. Preferred: Admin SDK check
  if (isAdminSdkConfigured()) {
    try {
      await getAdminAuth().getUserByEmail(cleanEmail);
      return true;
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") return false;
      return false;
    }
  }

  // 3. Fallback: Firebase Auth REST endpoint using public API key
  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) return false;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: [cleanEmail] }),
      }
    );
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return false;
    return Array.isArray((data as any).users) && (data as any).users.length > 0;
  } catch (e) {
    return false;
  }
}
