/**
 * Email sending module.
 *
 * Uses `nodemailer` with SMTP credentials from env vars. When SMTP is not
 * configured (development), it falls back to logging the message to the server
 * console so the flow can still be tested locally.
 *
 * Required env vars for real delivery:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.MAIL_FROM
  );
}

/**
 * Send an email. Returns `{ ok: true, mode }` on success or
 * `{ ok: false, mode, error }` when delivery fails.
 */
export async function sendEmail(input: SendEmailInput): Promise<
  { ok: true; mode: "smtp" | "dev" } | { ok: false; mode: "smtp" | "dev"; error: string }
> {
  if (!isSmtpConfigured()) {
    // Development fallback: log the OTP/message to the console.
    console.log("\n============================================");
    console.log("[EMAIL][DEV MODE] No SMTP configured — printing email");
    console.log(`To: ${input.to}`);
    console.log(`Subject: ${input.subject}`);
    // Extract just the OTP code for easy copying in dev.
    const otpMatch = input.html.match(/otp-code">(\d+)<\/div>/);
    if (otpMatch) {
      console.log(`>>> OTP CODE: ${otpMatch[1]}`);
    }
    console.log("============================================\n");
    return { ok: true, mode: "dev" };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || "false") === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    return { ok: true, mode: "smtp" };
  } catch (error: any) {
    console.error("[EMAIL][SMTP] Delivery failed:", error);
    return {
      ok: false,
      mode: "smtp",
      error: error?.message || "Failed to send email",
    };
  }
}

