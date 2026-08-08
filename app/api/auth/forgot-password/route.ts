/**
 * Self-serve password reset.
 *
 * Always answers with the same success payload regardless of whether the
 * address exists — otherwise this endpoint becomes a free account-enumeration
 * oracle for anyone with a list of emails.
 */
import { NextRequest, NextResponse } from "next/server";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { validateEmail } from "@/lib/utils/validation";

export const dynamic = "force-dynamic";

const GENERIC_RESPONSE = {
  success: true,
  message:
    "If an account exists for that email, a password reset link is on its way. Please check your inbox and spam folder.",
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`forgot-password:${ip}`, 5, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Too many reset requests. Please try again in a few minutes.",
      },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const email = (body.email || "").trim().toLowerCase();
  const emailCheck = validateEmail(email);
  if (!emailCheck.isValid) {
    return NextResponse.json(
      { success: false, error: emailCheck.error },
      { status: 400 }
    );
  }

  // A second, per-address limit. The IP limit alone doesn't stop a distributed
  // attempt to flood one person's inbox.
  const emailLimit = checkRateLimit(`forgot-password-email:${email}`, 3, 15 * 60 * 1000);
  if (!emailLimit.allowed) {
    // Still generic — don't confirm the address exists.
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const result = await sendPasswordResetEmail({ email });

  if (!result.ok && !result.userNotFound) {
    console.error("[forgot-password] Delivery failed:", result.error);
    return NextResponse.json(
      {
        success: false,
        error: "We couldn't send the reset email right now. Please try again shortly.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ...GENERIC_RESPONSE,
    // Development convenience only — `sendPasswordResetEmail` refuses to
    // populate this outside development.
    devLink: result.devLink,
  });
}
