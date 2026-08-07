import { NextRequest, NextResponse } from "next/server";
import {
  hashOtp,
  safeEqual,
  decryptSecret,
  OTP_MAX_ATTEMPTS,
} from "@/lib/otp";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  getPending,
  updatePending,
  consumePending,
} from "@/lib/registration-store";
import { isAdminSdkConfigured, getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  restCreateUser,
  restWriteUserDoc,
  restSignIn,
} from "@/lib/firebase/rest-client";

export const dynamic = "force-dynamic";

interface VerifyBody {
  email?: string;
  otp?: string;
  verificationToken?: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`verify-otp:${ip}`, 10, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts. Please try again later." },
      { status: 429 }
    );
  }

  let body: VerifyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const otp = (body.otp || "").trim();
  const verificationToken = (body.verificationToken || "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }
  if (!otp || !/^\d{6}$/.test(otp)) {
    return NextResponse.json(
      { error: "Please enter the 6-digit verification code." },
      { status: 400 }
    );
  }
  if (!verificationToken) {
    return NextResponse.json(
      { error: "Missing verification session. Please register again." },
      { status: 400 }
    );
  }

  // 1. Load pending registration (works with both Firestore and file store).
  const pending = await getPending(email);
  if (!pending) {
    return NextResponse.json(
      { error: "No pending registration found. Please register again." },
      { status: 404 }
    );
  }

  // Match the session token (prevents replay across another browser session).
  if (!pending.verificationToken || pending.verificationToken !== verificationToken) {
    return NextResponse.json(
      { error: "Invalid verification session. Please register again." },
      { status: 400 }
    );
  }

  if (Date.now() > pending.expiresAt) {
    await consumePending(email, pending.otpHash).catch(() => {});
    return NextResponse.json(
      { error: "This verification code has expired. Please register again." },
      { status: 410 }
    );
  }

  if ((pending.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await consumePending(email, pending.otpHash).catch(() => {});
    return NextResponse.json(
      {
        error: "Too many incorrect attempts. Please register again to receive a new code.",
      },
      { status: 429 }
    );
  }

  const otpHash = hashOtp(otp);
  if (!pending.otpHash || !safeEqual(otpHash, pending.otpHash)) {
    const newAttempts = (pending.attempts || 0) + 1;
    await updatePending(email, { attempts: newAttempts }).catch(() => {});
    const remaining = OTP_MAX_ATTEMPTS - newAttempts;
    return NextResponse.json(
      {
        error:
          remaining > 0
            ? `Invalid verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Too many incorrect attempts. Please register again.",
      },
      { status: 400 }
    );
  }

  // 2. Consume the OTP (single-use). In Admin mode this is an atomic
  // Firestore transaction; in file mode it is a single-writer delete. Either
  // way, the OTP can only be used once.
  const consumed = await consumePending(email, pending.otpHash);
  if (!consumed) {
    return NextResponse.json(
      {
        error:
          Date.now() > pending.expiresAt
            ? "This verification code has expired. Please register again."
            : "This verification code has already been used.",
      },
      { status: 409 }
    );
  }

  // 3. Decrypt the password.
  let plainPassword: string;
  try {
    plainPassword = decryptSecret(consumed.password);
  } catch (e) {
    console.error("Failed to decrypt password:", e);
    return NextResponse.json(
      { error: "Registration data is invalid. Please register again." },
      { status: 400 }
    );
  }

  const isTeacher = consumed.role === "teacher";

  if (isAdminSdkConfigured()) {
    // --- Preferred: Admin SDK path (production / emulator) ---
    let adminAuth: ReturnType<typeof getAdminAuth>;
    let adminDb: ReturnType<typeof getAdminDb>;
    try {
      adminAuth = getAdminAuth();
      adminDb = getAdminDb();
    } catch (err: any) {
      console.error("[verify-otp] Admin SDK init failed:", err?.message || err);
      return NextResponse.json(
        {
          error: "Registration service is not configured (missing Firebase Admin credentials). Please contact support.",
          detail: process.env.NODE_ENV === "development" ? err?.message : undefined,
        },
        { status: 500 }
      );
    }

    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: consumed.email,
        password: plainPassword,
        displayName: consumed.name,
        emailVerified: true,
      });
      uid = userRecord.uid;
    } catch (err: any) {
      console.error("createUser failed after OTP verification:", err);
      if (err.code === "auth/email-already-exists") {
        return NextResponse.json(
          { error: "An account with this email already exists. Please login instead." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Account creation failed. Please try again." },
        { status: 500 }
      );
    }

    const userRef = adminDb.collection("users").doc(uid);
    try {
      await userRef.set({
        id: uid,
        name: consumed.name,
        email: consumed.email,
        role: consumed.role,
        approved: !isTeacher,
        rejected: false,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error("Failed to write user profile:", err);
      try {
        await adminAuth.deleteUser(uid);
      } catch (cleanupErr) {
        console.error("Failed to clean up auth user after profile write error:", cleanupErr);
      }
      return NextResponse.json(
        { error: "Account creation failed. Please try again." },
        { status: 500 }
      );
    }

    // Mint a custom token so the browser can sign into this account
    // immediately — without this, the client's Firebase Auth session stays
    // null after verification and every post-verify redirect (dashboard /
    // pending-approval) bounces straight back to /login.
    let customToken: string | undefined;
    try {
      customToken = await adminAuth.createCustomToken(uid);
    } catch (err) {
      console.error("Failed to mint custom token after verification:", err);
    }

    return NextResponse.json({
      success: true,
      user: {
        uid,
        email: consumed.email,
        name: consumed.name,
        role: consumed.role,
        approved: !isTeacher,
      },
      customToken,
    });
  }

  // --- Zero-credential path: Firebase REST API ---
  const userDocData = {
    id: "",
    name: consumed.name,
    email: consumed.email,
    role: consumed.role,
    approved: !isTeacher,
    rejected: false,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Try to create the account. If the email already exists, the account may be
  // an orphan from an earlier failed profile write — recover it by signing in
  // with the (same) password and completing the profile.
  let created: { uid: string; idToken: string };
  try {
    created = await restCreateUser({
      email: consumed.email,
      password: plainPassword,
      displayName: consumed.name,
      emailVerified: true,
    });
  } catch (err: any) {
    const msg = err?.code || err?.message || "";
    if (msg.includes("EMAIL_EXISTS")) {
      try {
        console.warn("[verify-otp] Email exists — attempting orphan-account recovery via sign-in.");
        created = await restSignIn(consumed.email, plainPassword);
      } catch (signInErr: any) {
        const signInMsg = signInErr?.code || signInErr?.message || "";
        if (
          signInMsg.includes("INVALID_LOGIN_CREDENTIALS") ||
          signInMsg.includes("INVALID_PASSWORD") ||
          signInMsg.includes("USER_DISABLED")
        ) {
          return NextResponse.json(
            { error: "An account with this email already exists. Please login instead." },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: "Account creation failed. Please try again." },
          { status: 500 }
        );
      }
    } else {
      console.error("REST createUser failed after OTP verification:", err);
      return NextResponse.json(
        { error: "Account creation failed. Please try again." },
        { status: 500 }
      );
    }
  }

  userDocData.id = created.uid;

  // Write the Firestore user profile using the newly minted idToken.
  try {
    await restWriteUserDoc(created.uid, userDocData, created.idToken);
  } catch (err) {
    console.error("Failed to write user profile (REST):", err);
    return NextResponse.json(
      { error: "Account creation failed. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    user: {
      uid: created.uid,
      email: consumed.email,
      name: consumed.name,
      role: consumed.role,
      approved: !isTeacher,
    },
    // No Admin SDK here, so no custom token can be minted. The client already
    // holds the plaintext password from the registration form — tell it to
    // sign in with that instead so it doesn't bounce back to /login.
    needsPasswordSignIn: true,
  });
}

