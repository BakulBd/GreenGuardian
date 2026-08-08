/**
 * Shared bearer-token admin gate for server API routes.
 *
 * The role is read from Firestore rather than trusted from the ID token: the
 * token proves *who* the caller is, the `users/{uid}` document decides *what*
 * they may do. That keeps role changes (and admin suspension) effective
 * immediately, without waiting for a token to expire and refresh.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";

export interface AdminCaller {
  uid: string;
  name: string;
  email: string;
}

export async function requireAdmin(
  req: NextRequest,
  action = "perform this action"
): Promise<AdminCaller | NextResponse> {
  const header = req.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }
  if (!isAdminSdkConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Server auth is not configured. Set FIREBASE_SERVICE_ACCOUNT (or add serviceAccountKey.json) so admin actions can run.",
      },
      { status: 503 }
    );
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid or expired session. Please sign in again." },
      { status: 401 }
    );
  }

  const snap = await getAdminDb().collection("users").doc(uid).get();
  const caller = snap.exists ? snap.data() : null;
  if (!caller || caller.role !== "admin") {
    return NextResponse.json(
      { success: false, error: `Only administrators can ${action}.` },
      { status: 403 }
    );
  }
  if (caller.status === "hold" || caller.status === "suspended") {
    return NextResponse.json(
      { success: false, error: "Your account access has been restricted." },
      { status: 403 }
    );
  }

  return { uid, name: caller.name || "An administrator", email: caller.email || "" };
}
