/**
 * Admin-visible deployment health check.
 *
 * Reports whether the server-side capabilities the platform depends on are
 * actually wired up in THIS deployment. Worth having because the two most
 * damaging misconfigurations are both silent:
 *
 *   - No Firebase Admin credentials: registration falls back to the REST path
 *     and every admin-only server action (create student, reset password)
 *     returns 503. Nothing on-screen would otherwise say why.
 *   - No SMTP: OTP and password-reset emails are written to the server console
 *     instead of being delivered, so users simply never receive a code.
 *
 * Gated by `requireAdmin`, which itself returns 503 when the Admin SDK is
 * missing — the client treats that specific status as the "not configured"
 * answer rather than an error.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "view system health");
  if (auth instanceof NextResponse) return auth;

  const smtpConfigured = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.MAIL_FROM
  );

  // Prove the credentials actually work, rather than only that they are
  // present — an expired or wrong-project key looks identical until it fails.
  let firestoreOk = false;
  let authOk = false;
  try {
    await getAdminDb().collection("settings").doc("global").get();
    firestoreOk = true;
  } catch (e) {
    console.error("[health] Firestore check failed:", e);
  }
  try {
    await getAdminAuth().listUsers(1);
    authOk = true;
  } catch (e) {
    console.error("[health] Auth check failed:", e);
  }

  return NextResponse.json({
    success: true,
    adminSdk: { configured: true, firestoreOk, authOk },
    email: {
      configured: smtpConfigured,
      // Without SMTP, sendEmail() logs to the console instead of delivering.
      mode: smtpConfigured ? "smtp" : "console-only",
    },
    encryption: { configured: !!process.env.REGISTRATION_ENC_KEY },
    passwordReset: {
      // Self-serve reset works either way (Firebase can send its own mail);
      // admin-initiated reset needs the Admin SDK, which we have here.
      selfServe: true,
      adminInitiated: true,
      branded: smtpConfigured,
    },
  });
}
