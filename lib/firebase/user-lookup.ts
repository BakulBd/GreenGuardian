/**
 * Server-only email existence lookup.
 *
 * Uses the Firebase Admin SDK when configured (production / emulator). When the
 * Admin SDK is NOT configured (local dev without a service account), it falls
 * back to the Firebase Auth REST `accounts:lookup` endpoint, which only needs
 * the public web API key (already available via NEXT_PUBLIC_FIREBASE_API_KEY).
 *
 * The lookup is best-effort: if it fails for any reason it returns `false` so
 * registration is not blocked — a duplicate email is still caught later at
 * account-creation time.
 */
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "./admin";

/**
 * True when an Auth user exists for `email` AND its Firestore `users/{uid}`
 * profile document exists (i.e. a fully-registered account).
 *
 * Used by the register route to distinguish a real, existing account (block
 * re-registration) from an "orphaned" Auth user that was created but whose
 * profile write failed partway through the OTP flow. Orphaned accounts are
 * allowed to re-register — the verify step completes their profile via the
 * sign-in recovery path.
 */
export async function hasCompleteProfile(email: string): Promise<boolean> {
  if (isAdminSdkConfigured()) {
    try {
      const user = await getAdminAuth().getUserByEmail(email);
      const doc = await getAdminDb().collection("users").doc(user.uid).get();
      return doc.exists;
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") return false;
      console.warn("[user-lookup] hasCompleteProfile (Admin) failed:", e?.message || e);
      return false;
    }
  }

  // REST mode: without the user's password we have no idToken to read the
  // profile. Returning false lets the verify step handle it via the sign-in
  // recovery path (EMAIL_EXISTS → sign in → write profile).
  return false;
}

export async function isEmailRegistered(email: string): Promise<boolean> {
  // Preferred: Admin SDK (no network round trip to an unversioned endpoint).
  if (isAdminSdkConfigured()) {
    try {
      await getAdminAuth().getUserByEmail(email);
      return true;
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") return false;
      // Any other error — don't block registration; duplicate catch happens later.
      console.warn("[user-lookup] Admin SDK email lookup failed:", e?.message || e);
      return false;
    }
  }

  // Fallback: Firebase Auth REST endpoint using the public API key.
  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) return false;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: [email] }),
      }
    );
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return false;
    return Array.isArray((data as any).users) && (data as any).users.length > 0;
  } catch (e) {
    console.warn("[user-lookup] REST email lookup failed:", e);
    return false;
  }
}

