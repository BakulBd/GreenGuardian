import { sendEmail } from "./send";

const MAX_EMAIL_ATTEMPTS = 3;

export interface NotifyRecipient {
  id: string;
  email: string;
  name: string;
}

export interface NotifyResult {
  sent: number;
  failed: number;
}

/**
 * Emails a list of recipients with per-recipient retry + backoff, same
 * pattern already proven in /api/classroom/notify. `onResult` is called once
 * per recipient so the caller can write its own log/notification records
 * without this helper needing to know which Firestore collection to use.
 */
export async function sendBulkEmails(
  recipients: NotifyRecipient[],
  buildEmail: (recipient: NotifyRecipient) => { subject: string; html: string },
  onResult?: (recipient: NotifyRecipient, result: { ok: boolean; attempts: number; error?: string }) => Promise<void> | void
): Promise<NotifyResult> {
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    if (!recipient.email) {
      failed++;
      continue;
    }

    const { subject, html } = buildEmail(recipient);
    let attempts = 0;
    let ok = false;
    let lastError = "";

    while (attempts < MAX_EMAIL_ATTEMPTS && !ok) {
      attempts++;
      const result = await sendEmail({ to: recipient.email, subject, html });
      if (result.ok) {
        ok = true;
      } else {
        lastError = result.error;
        if (attempts < MAX_EMAIL_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempts * 500));
        }
      }
    }

    if (onResult) {
      await onResult(recipient, { ok, attempts, error: ok ? undefined : lastError });
    }

    if (ok) sent++;
    else failed++;
  }

  return { sent, failed };
}
