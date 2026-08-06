/**
 * Branded HTML email template for classroom stream/classwork notifications.
 */
export interface ClassroomPostTemplateData {
  studentName: string;
  teacherName: string;
  classroomName: string;
  postTypeLabel: string; // e.g. "Announcement", "Assignment", "Quiz"
  title: string;
  classroomUrl: string;
}

export function renderClassroomPostEmail({
  studentName,
  teacherName,
  classroomName,
  postTypeLabel,
  title,
  classroomUrl,
}: ClassroomPostTemplateData): string {
  const appName = "GreenGuardian";
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New ${escapeHtml(postTypeLabel)} in ${escapeHtml(classroomName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f0fdf4; }
    table { border-collapse: collapse; width: 100%; }
    .wrapper { padding: 24px 12px; }
    .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.08); }
    .header { background: linear-gradient(135deg, #16a34a, #059669); padding: 28px 32px; text-align: center; }
    .header .logo { font-size: 22px; font-weight: 800; color: #ffffff; }
    .header .sub { color: #d1fae5; font-size: 13px; margin-top: 4px; }
    .body { padding: 32px; }
    .greeting { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    .message { font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 20px; }
    .card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 18px 20px; margin-bottom: 24px; }
    .badge { display: inline-block; background: #16a34a; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 10px; border-radius: 999px; margin-bottom: 8px; }
    .card-title { font-size: 16px; font-weight: 700; color: #111827; }
    .card-sub { font-size: 12.5px; color: #6b7280; margin-top: 4px; }
    .button { display: inline-block; background: #16a34a; color: #fff !important; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px; }
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
            <div class="sub">Classroom Notification</div>
          </div>
          <div class="body">
            <div class="greeting">Hi ${escapeHtml(studentName)},</div>
            <p class="message">${escapeHtml(teacherName)} posted a new ${escapeHtml(postTypeLabel.toLowerCase())} in <strong>${escapeHtml(classroomName)}</strong>.</p>
            <div class="card">
              <span class="badge">${escapeHtml(postTypeLabel)}</span>
              <div class="card-title">${escapeHtml(title)}</div>
              <div class="card-sub">${escapeHtml(classroomName)} &middot; ${dateStr}</div>
            </div>
            <div style="text-align:center;">
              <a class="button" href="${escapeHtml(classroomUrl)}">Open Classroom</a>
            </div>
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

function escapeHtml(value: string): string {
  return (value || "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;")
    .replace(/'/g, "&#" + "039;");
}
