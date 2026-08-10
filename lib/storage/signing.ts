/**
 * Signed capability URLs for private B2 objects (server-only — uses node:crypto).
 *
 * The problem this solves: a presigned B2 URL expires (7 days at most), but the
 * URL persisted in a Firestore document — a notice attachment, an avatar, a
 * proctoring screenshot — has to keep working indefinitely, and is rendered by
 * plain `<img src>` / `<a href>` markup that cannot attach a bearer token.
 *
 * So Firestore stores an app URL instead:
 *
 *   /api/storage/download?key=<object key>&exp=<unix>&sig=<hmac>
 *
 * `/api/storage/download` verifies the HMAC and only then mints a short-lived
 * presigned B2 URL to redirect to. The bucket stays private, no credential ever
 * reaches the browser, and the link is stable for as long as the app wants it
 * to be. This is the same capability-URL model Firebase Storage used with its
 * unguessable `?token=` download links, so nothing about who can open a stored
 * attachment changed with the move to B2.
 *
 * The signature covers the key AND the expiry, so a holder of one link cannot
 * edit it into a link for another object or a later expiry.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Default lifetime of a stored link: 10 years, i.e. "as long as the record".
 * These URLs live inside Firestore documents that have no natural expiry, and
 * an expired link would render an existing notice or avatar broken with no way
 * to regenerate it. Confidentiality comes from the signature being unguessable
 * and from `/api/storage/download` being the only way to reach the object.
 */
const DEFAULT_LINK_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

/**
 * Secret used to sign links.
 *
 * `STORAGE_URL_SECRET` is preferred: it can be rotated on its own schedule.
 * Falling back to `B2_APPLICATION_KEY` means a working deployment needs no new
 * environment variable — at the cost of invalidating every previously issued
 * link if that key is ever rotated, which is why the dedicated variable is the
 * documented choice for production.
 */
function signingSecret(): string {
  const secret = (process.env.STORAGE_URL_SECRET || process.env.B2_APPLICATION_KEY || "").trim();
  if (!secret) {
    throw new Error(
      "Cannot sign storage links: set STORAGE_URL_SECRET (or B2_APPLICATION_KEY) on this deployment."
    );
  }
  return secret;
}

function computeSignature(key: string, expiresAt: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${key}\n${expiresAt}`)
    .digest("base64url");
}

export interface SignedLink {
  /** Relative URL to persist in Firestore and render in the UI. */
  url: string;
  key: string;
  expiresAt: number;
}

/**
 * Builds the durable, signed in-app URL for an object key.
 *
 * @param key Object key in the B2 bucket.
 * @param ttlSeconds Overrides the default 10-year lifetime.
 */
export function createSignedStorageUrl(key: string, ttlSeconds: number = DEFAULT_LINK_TTL_SECONDS): SignedLink {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = computeSignature(key, expiresAt);
  const params = new URLSearchParams({ key, exp: String(expiresAt), sig: signature });
  return { url: `/api/storage/download?${params.toString()}`, key, expiresAt };
}

export type SignatureCheck =
  | { valid: true }
  | { valid: false; reason: "missing" | "expired" | "invalid" };

/**
 * Verifies a link signature. Compared in constant time so a caller cannot
 * recover a valid signature byte by byte from response timing.
 */
export function verifySignedStorageUrl(key: string, exp: string | null, sig: string | null): SignatureCheck {
  if (!key || !exp || !sig) return { valid: false, reason: "missing" };

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return { valid: false, reason: "invalid" };
  if (expiresAt < Math.floor(Date.now() / 1000)) return { valid: false, reason: "expired" };

  const expected = Buffer.from(computeSignature(key, expiresAt));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length) return { valid: false, reason: "invalid" };

  return timingSafeEqual(expected, provided) ? { valid: true } : { valid: false, reason: "invalid" };
}
