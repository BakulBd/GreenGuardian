/**
 * Branded HTML email for password reset links.
 *
 * Used by both the self-serve "Forgot password" flow and the admin-initiated
 * reset, which is why `initiatedByAdmin` changes the copy: a link the user did
 * not ask for needs to explain itself.
 */
export interface PasswordResetTemplateData {
  name?: string;
  resetLink: string;
  expiryHours?: number;
  initiatedByAdmin?: boolean;
  adminName?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPasswordResetEmail({
  name,
  resetLink,
  expiryHours = 1,
  initiatedByAdmin = false,
  adminName,
}: PasswordResetTemplateData): string {
  const appName = "GreenGuardian";
  const safeName = escapeHtml(name?.trim() || "there");
  const safeLink = escapeHtml(resetLink);

  const intro = initiatedByAdmin
    ? `${
        adminName ? escapeHtml(adminName) : "An administrator"
      } has started a password reset for your ${appName} account. Use the button below to choose a new password.`
    : `We received a request to reset the password for your ${appName} account. Click the button below to choose a new one.`;

  const disclaimer = initiatedByAdmin
    ? "If you were not expecting this, please contact your administrator before using the link. Your current password stays valid until you set a new one."
    : "If you did not request this, you can safely ignore this email — your password will not change.";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Reset Your Password</title>
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
    .btn-wrap { text-align: center; margin-bottom: 24px; }
    .btn { display: inline-block; background: #16a34a; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 700; padding: 14px 32px; border-radius: 10px; }
    .fallback { font-size: 12.5px; color: #6b7280; line-height: 1.6; word-break: break-all; background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 10px; padding: 12px 16px; }
    .note { font-size: 13px; color: #6b7280; line-height: 1.6; margin-top: 16px; }
    .warning { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 16px; font-size: 12.5px; color: #92400e; line-height: 1.5; margin-top: 20px; }
    .footer { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6; text-align: center; font-size: 12px; color: #9ca3af; line-height: 1.6; }
  </style>
</head>
<body>
  <table class="wrapper" role="presentation">
    <tr><td>
      <div class="container">
        <div class="header">
          <div class="logo">${appName}</div>
          <div class="sub">Secure Online Examination Platform</div>
        </div>
        <div class="body">
          <div class="greeting">Hi ${safeName},</div>
          <p class="message">${intro}</p>
          <div class="btn-wrap">
            <a class="btn" href="${safeLink}" target="_blank" rel="noopener">Reset My Password</a>
          </div>
          <p class="note">If the button doesn't work, copy and paste this link into your browser:</p>
          <div class="fallback">${safeLink}</div>
          <div class="warning">
            This link expires in ${expiryHours} hour${expiryHours === 1 ? "" : "s"} and can only be used once.
            ${disclaimer}
          </div>
        </div>
        <div class="footer">
          This is an automated message from ${appName}. Please do not reply.
        </div>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}
