/**
 * Shared bearer-token authentication for API route handlers (server-only).
 *
 * Every route that touches privileged data repeated the same three steps —
 * pull the `Authorization` header, refuse when the Admin SDK has no
 * credentials, verify the ID token — with small inconsistencies between
 * copies. This centralises them and adds the piece most copies were missing:
 * loading the caller's `users/{uid}` document so a route can authorise on
 * **role and account status**, not just "some valid token was presented".
 *
 * Failing closed when `isAdminSdkConfigured()` is false is deliberate. If the
 * server cannot verify who is calling, it must not act on their behalf.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";

export type UserRole = "student" | "teacher" | "admin";

export interface AuthedUser {
  uid: string;
  email: string;
  role: UserRole;
  status: string;
  name: string;
  studentCode: string;
  /** Raw `users/{uid}` payload for callers needing more than the common fields. */
  data: Record<string, any>;
}

/** Extracts the bearer token from an `Authorization` header. */
function bearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

/** Error codes the Admin SDK raises for a genuinely bad/expired user token. */
const USER_TOKEN_ERROR_CODES = new Set([
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/argument-error",
  "auth/invalid-argument",
]);

/**
 * Maps a `verifyIdToken()` failure to the right response.
 *
 * Not every failure here means the user's session is bad. If the Admin SDK's
 * own service-account credential is missing, revoked, or malformed, or the
 * verification call can't reach Google at all, `verifyIdToken` throws too —
 * but that is a server outage, not something "signing in again" fixes. Telling
 * a user to re-login for a problem on our end is actively misleading, and
 * collapsing both cases into one message is what made this class of bug hard
 * to diagnose. The real error is always logged server-side (never the
 * credential itself) so it's actually possible to tell the two apart in logs.
 */
export function tokenVerificationErrorResponse(err: any): NextResponse {
  const code = String(err?.code || "");
  const isUserTokenProblem = USER_TOKEN_ERROR_CODES.has(code) || code.startsWith("auth/id-token");

  if (isUserTokenProblem) {
    return jsonError("Invalid or expired session. Please sign in again.", 401);
  }

  console.error("[api-auth] Token verification failed for a reason other than the user's session:", err);

  // A credential the Admin SDK cannot load is a permanent misconfiguration,
  // not a blip: "try again shortly" is wrong advice and sends whoever is
  // debugging it back round the same loop. Say what actually needs fixing.
  const isCredentialProblem =
    code === "app/invalid-credential" ||
    code === "app/invalid-app-options" ||
    /Firebase Admin SDK (could not use|has no usable)/.test(String(err?.message || ""));

  if (isCredentialProblem) {
    return jsonError(
      "Server authentication is misconfigured: the Firebase service-account credential could not be loaded. " +
        "Signing in again will not help — an administrator needs to check FIREBASE_SERVICE_ACCOUNT on this deployment.",
      503
    );
  }

  return jsonError(
    "Server authentication is temporarily unavailable. This is not a problem with your session — please try again shortly.",
    503
  );
}

/**
 * Verify the caller and load their profile.
 *
 * Returns a `NextResponse` (which the caller should return as-is) on any
 * failure, or the resolved user on success. Accounts an admin has put on
 * `hold`/`suspended` are rejected here so every protected route inherits that
 * check rather than re-implementing it.
 *
 * @param allowedRoles When given, the caller's role must be one of these.
 * @param forbiddenMessage Overrides the message used for a role mismatch
 *   specifically (not the hold/suspended case, which always keeps its own
 *   message). Lets callers like `requireAdmin` say what the caller tried to
 *   do without duplicating the whole auth check.
 */
export async function requireAuthedUser(
  req: NextRequest,
  allowedRoles?: UserRole[],
  forbiddenMessage?: string
): Promise<AuthedUser | NextResponse> {
  const token = bearerToken(req);
  if (!token) return jsonError("Authentication required.", 401);

  if (!isAdminSdkConfigured()) {
    return jsonError(
      "Server auth is not configured. Set FIREBASE_SERVICE_ACCOUNT so this request can be verified.",
      503
    );
  }

  let uid: string;
  let email: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email || "";
  } catch (err: any) {
    return tokenVerificationErrorResponse(err);
  }

  const snap = await getAdminDb().collection("users").doc(uid).get();
  if (!snap.exists) {
    return jsonError("No profile exists for this account.", 403);
  }

  const data = snap.data() || {};
  const status = String(data.status || "active");
  if (status === "hold" || status === "suspended") {
    return jsonError(
      "Your account access has been restricted. Please contact an administrator.",
      403
    );
  }

  const role = String(data.role || "") as UserRole;
  if (allowedRoles && !allowedRoles.includes(role)) {
    return jsonError(forbiddenMessage || "You do not have permission to perform this action.", 403);
  }

  return {
    uid,
    email: email || String(data.email || ""),
    role,
    status,
    name: String(data.name || ""),
    studentCode: String(data.studentCode || ""),
    data,
  };
}
