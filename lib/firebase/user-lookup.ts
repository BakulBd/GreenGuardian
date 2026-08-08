/**
 * Server-only email existence lookup for the registration flow.
 *
 * An email can be in one of three states, and the difference matters:
 *
 *   "available"  — nothing exists. Registration proceeds normally.
 *   "orphan"     — a Firebase Auth account exists but has NO Firestore
 *                  `users/{uid}` profile. This is the wreckage of a
 *                  registration that died between account creation and the
 *                  profile write. It must NOT block a new registration:
 *                  /api/auth/verify-otp adopts and repairs the account.
 *   "registered" — a real, complete account. Registration is refused.
 *
 * Collapsing "orphan" into "registered" is what permanently locked users out
 * of their own email address ("An account with this email already exists")
 * with no way to recover.
 *
 * NOTE: these run on the server. They must use the Admin SDK — the client
 * Firebase SDK has no authenticated session here, so any `users` query it
 * makes is rejected by security rules and silently returns "not found".
 */
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "./admin";
import { restLookupEmail } from "./rest-client";

export type EmailRegistrationStatus = "available" | "orphan" | "registered";

export async function getEmailRegistrationStatus(
  email: string
): Promise<EmailRegistrationStatus> {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return "available";

  if (isAdminSdkConfigured()) {
    let uid: string;
    try {
      const user = await getAdminAuth().getUserByEmail(cleanEmail);
      uid = user.uid;
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") {
        // No Auth account. A stray profile doc with this email would still be
        // a real account from the app's point of view, so check for one.
        try {
          const snap = await getAdminDb()
            .collection("users")
            .where("email", "==", cleanEmail)
            .limit(1)
            .get();
          return snap.empty ? "available" : "registered";
        } catch {
          return "available";
        }
      }
      // Any other Auth error is a service problem, not a verdict. Surface it
      // so the caller can return a 500 rather than wrongly allowing/denying.
      throw e;
    }

    const profile = await getAdminDb().collection("users").doc(uid).get();
    return profile.exists ? "registered" : "orphan";
  }

  // --- No Admin SDK: public REST lookup only ---
  // We can see whether an Auth account exists, but not whether it has a
  // profile (reading `users/{uid}` needs that user's own token). Report
  // "orphan" so registration is allowed to continue: verify-otp then proves
  // ownership by signing in with the submitted password before it writes
  // anything, and refuses if a profile already exists.
  const exists = await restLookupEmail(cleanEmail);
  return exists ? "orphan" : "available";
}

/**
 * True only for emails that already have a COMPLETE account.
 * Orphaned Auth records deliberately return false — see above.
 */
export async function isEmailRegistered(email: string): Promise<boolean> {
  return (await getEmailRegistrationStatus(email)) === "registered";
}

/** True when `email` has both an Auth account and a Firestore profile. */
export async function hasCompleteProfile(email: string): Promise<boolean> {
  return isEmailRegistered(email);
}
