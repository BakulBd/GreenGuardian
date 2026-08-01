/**
 * Branded HTML email template for OTP verification.
 */
export interface OtpTemplateData {
  name: string;
  otp: string;
  expiryMinutes: number;
}

export function renderOtpEmail({ name, otp, expiryMinutes }: OtpTemplateData): string {
  const appName = "GreenGuardian";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Verify Your Email</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f0fdf4; -webkit-font-smoothing: antialiased; }
    table { border-collapse: collapse; width: 100%; }
    .wrapper { padding: 24px 12px; }
    .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.08); }
    .header { background: linear-gradient(135deg, #16a34a, #059669); padding: 28px 32px; text-align: center; }
    .header .logo { font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: 0.3px; }
    .header .sub { color: #d1fae5; font-size: 13px; margin-top: 4px; }
    .body { padding: 32px; }
    .greeting { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    .message { font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 24px; }
    .otp-box { background: #f0fdf4; border: 2px dashed #86efac; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px; }
    .otp-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; color: #15803d; margin-bottom: 8px; }
    .otp-code { font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #15803d; font-family: 'Courier New', monospace; }
    .note { font-size: 13px; color: #6b7280; line-height: 1.6; margin-bottom: 8px; }
    .warning { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 16px; font-size: 12.5px; color: #92400e; line-height: 1.5; margin-top: 20px; }
    .footer { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6; text-align: center; font-size: 12px; color: #9ca3af; line-height: 1.6; }
  </style>
</head>
<body>
  <table class="wrapper" role="presentation">
    <tr>
      <td>
        <div class="container">
          <div class="header">
            <div class="logo">&#128737;&#65039; ${appName}</div>
            <div class="sub">Email Verification</div>
          </div>
          <div class="body">
            <div class="greeting">Hi ${escapeHtml(name)},</div>
            <p class="message">Thank you for creating your ${appName} account. Use the 6-digit verification code below to confirm your email address and activate your registration.</p>
            <div class="otp-box">
              <div class="otp-label">Your Verification Code</div>
              <div class="otp-code">${otp}</div>
            </div>
            <p class="note">This code will expire in <strong>${expiryMinutes} minutes</strong>. For your security, it can only be used once.</p>
            <div class="warning">&#9888;&#65039; If you did not request this code, you can safely ignore this email. Never share this code with anyone. ${appName} will never ask for your code via phone or email.</div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} ${appName} &#8212; AI-Powered Exam Security Platform<br />
            This is an automated message, please do not reply.
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Minimal HTML-escaping for user-controlled values (name).
 * Entities are built via concatenation to keep the source unambiguous.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;")
    .replace(/'/g, "&#" + "039;");
}

