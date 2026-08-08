/**
 * Server-side password-reset dispatch, shared by the self-serve
 * (`/api/auth/forgot-password`) and admin-initiated
 * (`/api/admin/reset-password`) flows.
 *
 * Two delivery strategies, in order of preference:
 *
 *   1. Admin SDK + our own SMTP. `generatePasswordResetLink()` mints the oob
 *      link without sending anything, so we can wrap it in the GreenGuardian
 *      template and send it through the same SMTP account as the OTP mail.
 *      This keeps every message the platform sends visually consistent and
 *      avoids depending on Firebase's own (unbranded, easily spam-filed) mail.
 *
 *   2. Firebase's `sendOobCode` REST endpoint. No service account needed, but
 *      Firebase composes and sends the email itself. Used when the Admin SDK
 *      isn't configured or when SMTP is unavailable.
 *
 * Callers get back which strategy actually delivered, for logging/diagnostics.
 */
import { getAdminAuth, isAdminSdkConfigured } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/email/send";
import { renderPasswordResetEmail } from "@/lib/email/templates/passwordReset";

export type ResetDeliveryMode = "branded-smtp" | "firebase" | "dev-log";

export interface SendResetResult {
  ok: boolean;
  mode?: ResetDeliveryMode;
  /** Present only when the account genuinely does not exist. */
  userNotFound?: boolean;
  error?: string;
  /** Dev-only: surfaced so a developer without SMTP can still complete a reset. */
  devLink?: string;
}

/** Absolute URL the reset link returns the user to after completion. */
function continueUrl(): string | undefined {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/login`;
}

function smtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.MAIL_FROM
  );
}

/** Fallback: ask Firebase to compose and send its own reset email. */
async function sendViaFirebase(email: string): Promise<SendResetResult> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Firebase API key is not configured." };
  }
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = data?.error?.message || `sendOobCode failed (${res.status})`;
      if (code.includes("EMAIL_NOT_FOUND")) {
        return { ok: false, userNotFound: true, error: code };
      }
      return { ok: false, error: code };
    }
    return { ok: true, mode: "firebase" };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error sending reset email." };
  }
}

/**
 * Sends a password-reset link to `email`.
 *
 * `userNotFound` is reported truthfully to the caller; it is the CALLER's job
 * to decide whether to reveal that to the end user. The self-serve endpoint
 * must not (account enumeration); the admin endpoint should.
 */
export async function sendPasswordResetEmail(input: {
  email: string;
  name?: string;
  initiatedByAdmin?: boolean;
  adminName?: string;
}): Promise<SendResetResult> {
  const email = (input.email || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  // --- Strategy 1: Admin SDK link + our branded SMTP email ---
  if (isAdminSdkConfigured()) {
    let link: string;
    try {
      const url = continueUrl();
      link = await getAdminAuth().generatePasswordResetLink(
        email,
        url ? { url, handleCodeInApp: false } : undefined
      );
    } catch (err: any) {
      if (err?.code === "auth/user-not-found") {
        return { ok: false, userNotFound: true, error: "No account with that email." };
      }
      // `generatePasswordResetLink` rejects a continueUrl whose domain is not
      // in Firebase's authorized list. Retry without it rather than failing —
      // the default post-reset page is a fine outcome.
      if (String(err?.code || "").includes("invalid-continue-uri") ||
          String(err?.code || "").includes("unauthorized-continue-uri")) {
        try {
          link = await getAdminAuth().generatePasswordResetLink(email);
        } catch (retryErr: any) {
          console.error("[password-reset] Link generation failed:", retryErr);
          return await sendViaFirebase(email);
        }
      } else {
        console.error("[password-reset] Admin link generation failed:", err);
        return await sendViaFirebase(email);
      }
    }

    const html = renderPasswordResetEmail({
      name: input.name,
      resetLink: link,
      expiryHours: 1,
      initiatedByAdmin: input.initiatedByAdmin,
      adminName: input.adminName,
    });

    const mail = await sendEmail({
      to: email,
      subject: input.initiatedByAdmin
        ? "Reset your GreenGuardian password"
        : "Reset your GreenGuardian password",
      html,
    });

    if (mail.ok) {
      return {
        ok: true,
        mode: mail.mode === "dev" ? "dev-log" : "branded-smtp",
        // Without SMTP there is no email to click, so hand the link back for
        // local development. Never exposed in production.
        devLink:
          mail.mode === "dev" && process.env.NODE_ENV !== "production" ? link : undefined,
      };
    }

    // SMTP failed but the account is real — let Firebase deliver it instead of
    // dropping the request on the floor.
    console.warn("[password-reset] Branded SMTP send failed, falling back to Firebase.");
    return await sendViaFirebase(email);
  }

  // --- Strategy 2: no Admin SDK ---
  if (!smtpConfigured()) {
    return await sendViaFirebase(email);
  }
  return await sendViaFirebase(email);
}
