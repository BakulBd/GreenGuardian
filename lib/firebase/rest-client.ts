/**
 * Server-only Firebase REST client.
 *
 * Lets the server create Auth users and write Firestore documents WITHOUT the
 * Firebase Admin SDK. This is what makes local development (and CI/edge
 * deployments without a service account) work out of the box:
 *
 *   - Auth: `identitytoolkit.googleapis.com` endpoints, authenticated with the
 *     public web API key (NEXT_PUBLIC_FIREBASE_API_KEY).
 *   - Firestore: REST commit using the idToken returned by the signUp call.
 *
 * IMPORTANT: This path is gated so it ONLY runs AFTER a user has verified their
 * email OTP — the account is never created before verification. When the Admin
 * SDK IS configured, the more robust Admin SDK path is still preferred.
 */

const WEB_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "greenguardian2026";

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1";
const FIRESTORE_REST = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Raw sign-up via REST. Returns the idToken + uid, or throws. */
export async function restCreateUser(input: {
  email: string;
  password: string;
  displayName?: string;
  emailVerified?: boolean;
}) {
  if (!WEB_API_KEY) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set.");
  }
  const res = await fetch(
    `${IDENTITY_TOOLKIT}/accounts:signUp?key=${encodeURIComponent(WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        returnSecureToken: true,
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.localId) {
    const code = data.error?.message || `REST signUp failed (${res.status})`;
    const err: any = new Error(code);
    err.code = data.error?.message;
    throw err;
  }
  return {
    uid: data.localId as string,
    idToken: data.idToken as string,
    email: (data.email as string) || input.email,
  };
}

/** Raw sign-in via REST. Returns the idToken + uid, or throws. */
export async function restSignIn(
  email: string,
  password: string
): Promise<{ uid: string; idToken: string; email: string }> {
  if (!WEB_API_KEY) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set.");
  }
  const res = await fetch(
    `${IDENTITY_TOOLKIT}/accounts:signInWithPassword?key=${encodeURIComponent(WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.idToken) {
    const code = data.error?.message || `REST signIn failed (${res.status})`;
    const err: any = new Error(code);
    err.code = data.error?.message;
    throw err;
  }
  return {
    uid: data.localId as string,
    idToken: data.idToken as string,
    email: (data.email as string) || email,
  };
}

/** Check if an email already exists via REST (public API key only). */
export async function restLookupEmail(email: string): Promise<boolean> {
  if (!WEB_API_KEY) return false;
  try {
    const res = await fetch(
      `${IDENTITY_TOOLKIT}/accounts:lookup?key=${encodeURIComponent(WEB_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: [email] }),
      }
    );
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return false;
    return Array.isArray((data as any).users) && (data as any).users.length > 0;
  } catch {
    return false;
  }
}

/** Write a Firestore document using the user's idToken (bypasses rules). */
export async function restWriteUserDoc(
  uid: string,
  userData: Record<string, any>,
  idToken: string
): Promise<void> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(userData)) {
    if (v instanceof Date) {
      fields[k] = { timestampValue: v.toISOString() };
    } else if (typeof v === "boolean") {
      fields[k] = { booleanValue: v };
    } else if (typeof v === "number") {
      fields[k] = { integerValue: String(v) };
    } else if (typeof v === "string") {
      fields[k] = { stringValue: v };
    } else if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  // `allowMissing=true` tells Firestore this is an upsert (create if missing,
  // otherwise update). Without it, a PATCH on a non-existent document is
  // treated as an update, which Firestore rules DENY because there is no
  // existing `resource.data` to validate against — causing a 403.
  const res = await fetch(
    `${FIRESTORE_REST}/users/${uid}?allowMissing=true&updateMask.fieldPaths=name&updateMask.fieldPaths=email&updateMask.fieldPaths=role&updateMask.fieldPaths=approved&updateMask.fieldPaths=rejected&updateMask.fieldPaths=emailVerified&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=updatedAt`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fields }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firestore write failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

