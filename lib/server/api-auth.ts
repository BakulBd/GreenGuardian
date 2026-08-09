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

/**
 * Verify the caller and load their profile.
 *
 * Returns a `NextResponse` (which the caller should return as-is) on any
 * failure, or the resolved user on success. Accounts an admin has put on
 * `hold`/`suspended` are rejected here so every protected route inherits that
 * check rather than re-implementing it.
 *
 * @param allowedRoles When given, the caller's role must be one of these.
 */
export async function requireAuthedUser(
  req: NextRequest,
  allowedRoles?: UserRole[]
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
  } catch {
    return jsonError("Invalid or expired session. Please sign in again.", 401);
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
    return jsonError("You do not have permission to perform this action.", 403);
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
