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

/**
 * Delete an Auth account using its own idToken. Used to roll back a half-built
 * account when the Firestore profile write fails, so a retry with the same
 * email doesn't hit "email already exists".
 */
export async function restDeleteUser(idToken: string): Promise<void> {
  if (!WEB_API_KEY) return;
  await fetch(`${IDENTITY_TOOLKIT}/accounts:delete?key=${encodeURIComponent(WEB_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  }).catch(() => {});
}

/** True when `users/{uid}` already exists (read with the user's own idToken). */
export async function restUserDocExists(uid: string, idToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${FIRESTORE_REST}/users/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return res.ok;
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
  /** Firestore REST typed value. Arrays matter here: `sections` and
   *  `assignedTeacherIds` are both arrays, and the previous catch-all
   *  `String(v)` would have stored them as the literal text "" or "a,b". */
  const toValue = (v: any): Record<string, any> => {
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) {
      return v.length === 0
        ? { arrayValue: {} }
        : { arrayValue: { values: v.map(toValue) } };
    }
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === "string") return { stringValue: v };
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "object") {
      const inner: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) inner[k] = toValue(val);
      return { mapValue: { fields: inner } };
    }
    return { stringValue: String(v) };
  };

  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(userData)) {
    fields[k] = toValue(v);
  }
  // Firestore's REST `documents.patch` is already an upsert: it creates the
  // document when it does not exist, and rules then evaluate the write as a
  // `create` (resource == null). There is NO `allowMissing` query parameter on
  // this endpoint — sending one makes Firestore reject the whole request with
  // `400 INVALID_ARGUMENT: Unknown name "allowMissing"`, which is what silently
  // broke every REST-path registration (the Auth user was created, the profile
  // write 400'd, and the user was left orphaned).
  //
  // The updateMask is derived from the payload so callers can't drift out of
  // sync with a hardcoded field list.
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const res = await fetch(
    `${FIRESTORE_REST}/users/${encodeURIComponent(uid)}?${mask}`,
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

