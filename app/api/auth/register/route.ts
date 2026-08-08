import { NextRequest, NextResponse } from "next/server";
import {
  generateOtp,
  hashOtp,
  encryptSecret,
  generateVerificationToken,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS,
} from "@/lib/otp";
import { sendEmail } from "@/lib/email/send";
import { renderOtpEmail } from "@/lib/email/templates/otp";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isEmailRegistered } from "@/lib/firebase/user-lookup";
import { getPending, upsertPending, deletePending } from "@/lib/registration-store";
import { getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";

import { validateName, validateEmail, validateStudentCode } from "@/lib/utils/validation";
import { validatePlacement } from "@/lib/server/enrollment";

export const dynamic = "force-dynamic";

interface RegisterBody {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  // Students only — their academic placement, validated against the catalog.
  batch?: string;
  section?: string;
  studentCode?: string;
}

export async function POST(req: NextRequest) {
  // 1. IP-based rate limit to prevent spam/abuse.
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`register:${ip}`, 10, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many registration attempts from this IP. Please try again later.",
      },
      { status: 429 }
    );
  }

  // 1b. Honour the admin "Allow Self-Registration" switch. Enforced here
  // rather than by hiding the form, so the endpoint itself is closed.
  if (isAdminSdkConfigured()) {
    try {
      const settingsSnap = await getAdminDb().collection("settings").doc("global").get();
      if (settingsSnap.exists && settingsSnap.data()?.allowRegistration === false) {
        return NextResponse.json(
          {
            error:
              "Self-registration is currently closed. Please contact your administrator for an account.",
          },
          { status: 403 }
        );
      }
    } catch (err) {
      // A settings read failure must not lock everyone out of signing up.
      console.warn("[Register] Could not read registration setting:", err);
    }
  }

  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const role = body.role;

  // 2. Validate input.
  const nameValidation = validateName(name);
  if (!nameValidation.isValid) {
    return NextResponse.json({ error: nameValidation.error }, { status: 400 });
  }

  const emailValidation = validateEmail(email);
  if (!emailValidation.isValid) {
    return NextResponse.json({ error: emailValidation.error }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }
  if (password.length > 72) {
    return NextResponse.json(
      { error: "Password must be 72 characters or fewer." },
      { status: 400 }
    );
  }
  if (role !== "student" && role !== "teacher") {
    return NextResponse.json(
      { error: "Role must be either 'student' or 'teacher'." },
      { status: 400 }
    );
  }

  // 2b. Students must declare a batch + section, validated against the real
  // catalog.
  //
  // This is the difference between a working account and an invisible one.
  // Registration used to capture only name/email/password, so a new student
  // landed with no placement, matched no teacher assignment, and got an empty
  // `assignedTeacherIds` — which presents as "no notices, no exams, nothing".
  // An admin had to notice and fix each one by hand.
  //
  // Validated server-side rather than trusted from the form: these two values
  // decide whose exams and notices the account will receive.
  let placement: { batch: string; section: string } | null = null;
  let studentCode = "";
  if (role === "student") {
    const check = await validatePlacement({ batch: body.batch, section: body.section });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    placement = check.placement;

    studentCode = (body.studentCode || "").trim();
    const codeCheck = validateStudentCode(studentCode);
    if (!codeCheck.isValid) {
      return NextResponse.json({ error: codeCheck.error }, { status: 400 });
    }
  }

  // 3. Check if the email is already registered in Firebase.
  try {
    const alreadyRegistered = await isEmailRegistered(email);
    if (alreadyRegistered) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please login instead." },
        { status: 409 }
      );
    }
  } catch (err: any) {
    console.error("Error checking existing user:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  // 4. Check existing pending registration for this email (60s cooldown).
  const existingPending = await getPending(email);
  if (existingPending) {
    const lastSentAt = existingPending.lastSentAt || 0;
    const remaining = OTP_RESEND_COOLDOWN_MS - (Date.now() - lastSentAt);
    if (remaining > 0) {
      return NextResponse.json(
        {
          error: `A verification code was just sent. Please wait ${Math.ceil(
            remaining / 1000
          )} seconds before requesting another.`,
          retryAfterSeconds: Math.ceil(remaining / 1000),
        },
        { status: 429 }
      );
    }
  }

  // 5. Check per-email total send cap.
  if ((existingPending?.sendCount || 0) >= OTP_MAX_SENDS) {
    return NextResponse.json(
      {
        error: "Too many verification codes sent. Please try again later.",
      },
      { status: 429 }
    );
  }

  // 6. Generate OTP + store pending registration (hashed OTP, encrypted password).
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const token = generateVerificationToken();
  const expiresAt = Date.now() + OTP_TTL_MS;

  let encryptedPassword: string;
  try {
    encryptedPassword = encryptSecret(password);
  } catch (err: any) {
    console.error("Encryption key not configured:", err);
    return NextResponse.json(
      {
        error: "Registration service is misconfigured (encryption key missing). Please contact support.",
      },
      { status: 500 }
    );
  }

  try {
    await upsertPending({
      email,
      name,
      password: encryptedPassword,
      role,
      otpHash,
      verificationToken: token,
      expiresAt,
      sendCount: (existingPending?.sendCount || 0) + 1,
      attempts: 0,
      lastSentAt: Date.now(),
      createdAt: existingPending?.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...(placement ? { batch: placement.batch, section: placement.section } : {}),
      ...(studentCode ? { studentCode } : {}),
    });
  } catch (err: any) {
    console.error("[register] Failed to store pending registration:", err?.message || err);
    return NextResponse.json(
      {
        error: "We couldn't start your registration. Please try again.",
        detail: process.env.NODE_ENV === "development" ? err?.message : undefined,
      },
      { status: 500 }
    );
  }

  // 7. Send the OTP email.
  let mailResult: Awaited<ReturnType<typeof sendEmail>>;
  try {
    mailResult = await sendEmail({
      to: email,
      subject: "Your GreenGuardian Verification Code",
      html: renderOtpEmail({
        name,
        otp,
        expiryMinutes: OTP_TTL_MS / 60000,
      }),
    });
  } catch (err: any) {
    console.error("[register] sendEmail threw:", err?.message || err);
    await deletePending(email).catch(() => {});
    return NextResponse.json(
      { error: "We couldn't send the verification email. Please try again." },
      { status: 500 }
    );
  }

  if (!mailResult.ok) {
    // Clean up the pending record so the user can retry cleanly.
    await deletePending(email).catch(() => {});
    return NextResponse.json(
      { error: "We couldn't send the verification email. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    verificationToken: token,
    expiresInSeconds: OTP_TTL_MS / 1000,
    resendCooldownSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    emailMode: mailResult.mode,
  });
}

