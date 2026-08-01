import { NextRequest, NextResponse } from "next/server";
import {
  generateOtp,
  hashOtp,
  generateVerificationToken,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_SENDS,
} from "@/lib/otp";
import { sendEmail } from "@/lib/email/send";
import { renderOtpEmail } from "@/lib/email/templates/otp";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getPending, updatePending } from "@/lib/registration-store";

export const dynamic = "force-dynamic";

interface ResendBody {
  email?: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`resend-otp:${ip}`, 5, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: ResendBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }

  const pending = await getPending(email);
  if (!pending) {
    return NextResponse.json(
      { error: "No pending registration found for this email. Please register again." },
      { status: 404 }
    );
  }

  // 60-second cooldown between sends.
  const elapsed = Date.now() - (pending.lastSentAt || 0);
  if (elapsed < OTP_RESEND_COOLDOWN_MS) {
    return NextResponse.json(
      {
        error: `Please wait ${Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000)} seconds before resending.`,
        retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000),
      },
      { status: 429 }
    );
  }

  // Total send cap.
  if ((pending.sendCount || 0) >= OTP_MAX_SENDS) {
    return NextResponse.json(
      { error: "Maximum resend limit reached. Please try again later." },
      { status: 429 }
    );
  }

  // Generate a brand-new OTP. This REPLACES (invalidates) the previous one.
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const newToken = generateVerificationToken();
  const expiresAt = Date.now() + OTP_TTL_MS;

  try {
    await updatePending(email, {
      otpHash,
      verificationToken: newToken,
      expiresAt,
      attempts: 0,
      sendCount: (pending.sendCount || 0) + 1,
      lastSentAt: Date.now(),
    });
  } catch (err: any) {
    console.error("[resend-otp] Failed to update pending registration:", err?.message || err);
    return NextResponse.json(
      { error: "We couldn't resend the code. Please try again." },
      { status: 500 }
    );
  }

  let mailResult: Awaited<ReturnType<typeof sendEmail>>;
  try {
    mailResult = await sendEmail({
      to: email,
      subject: "Your New GreenGuardian Verification Code",
      html: renderOtpEmail({
        name: pending.name || "there",
        otp,
        expiryMinutes: OTP_TTL_MS / 60000,
      }),
    });
  } catch (err: any) {
    console.error("[resend-otp] sendEmail threw:", err?.message || err);
    return NextResponse.json(
      { error: "We couldn't send the verification email. Please try again." },
      { status: 500 }
    );
  }

  if (!mailResult.ok) {
    return NextResponse.json(
      { error: "We couldn't send the verification email. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    verificationToken: newToken,
    expiresInSeconds: OTP_TTL_MS / 1000,
    resendCooldownSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    emailMode: mailResult.mode,
  });
}

