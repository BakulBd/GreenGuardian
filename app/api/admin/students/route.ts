import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Admin-only creation of a student account.
 *
 * This has to run server-side. The page used to call the client SDK's
 * `createUserWithEmailAndPassword`, which signs the *current browser session*
 * in as whoever it just created — so an admin adding a student was silently
 * logged out of their own account and became that student. The Admin SDK
 * creates the account out-of-band and leaves the caller's session untouched.
 */
async function requireAdmin(
  req: NextRequest
): Promise<{ uid: string } | NextResponse> {
  const header = req.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

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
          "Server auth is not configured. Set FIREBASE_SERVICE_ACCOUNT so accounts can be created.",
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

  // The role lives in Firestore, so it is checked there rather than trusted
  // from the token.
  const callerSnap = await getAdminDb().collection("users").doc(uid).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;
  if (!caller || caller.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "Only administrators can create student accounts." },
      { status: 403 }
    );
  }
  if (caller.status === "hold" || caller.status === "suspended") {
    return NextResponse.json(
      { success: false, error: "Your account access has been restricted." },
      { status: 403 }
    );
  }

  return { uid };
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if (authResult instanceof NextResponse) return authResult;

    const rate = checkRateLimit(
      `admin-create-student:${authResult.uid}:${getClientIp(req)}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const studentCode = String(body.studentCode ?? "").trim();
    const department = String(body.department ?? "").trim();
    const batch = String(body.batch ?? "").trim();
    const section = String(body.section ?? "").trim();

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Full name is required." },
        { status: 400 }
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: "A valid email address is required." },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        },
        { status: 400 }
      );
    }

    const adminAuth = getAdminAuth();
    const adminDb = getAdminDb();

    let uid: string;
    try {
      const created = await adminAuth.createUser({
        email,
        password,
        displayName: name,
        emailVerified: true,
      });
      uid = created.uid;
    } catch (err: any) {
      if (err?.code === "auth/email-already-exists") {
        return NextResponse.json(
          { success: false, error: "An account with that email already exists." },
          { status: 409 }
        );
      }
      throw err;
    }

    const now = new Date();
    await adminDb
      .collection("users")
      .doc(uid)
      .set({
        id: uid,
        name,
        email,
        role: "student",
        approved: true,
        rejected: false,
        status: "active",
        studentCode: studentCode || `STU-${Date.now().toString().slice(-6)}`,
        department,
        batch,
        section,
        sections: section ? [section] : [],
        assignedTeacherIds: [],
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ success: true, studentId: uid });
  } catch (error: any) {
    console.error("API /api/admin/students error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to create student account." },
      { status: 500 }
    );
  }
}
