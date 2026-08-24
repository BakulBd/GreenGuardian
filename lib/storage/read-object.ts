/**
 * Server-side resolution of a stored file reference to its bytes (server-only).
 *
 * Attachment URLs come in three shapes across this project, and anything that
 * needs the actual bytes on the server — the OCR/AI pass over an uploaded
 * answer, most importantly — has to handle all three:
 *
 *   1. `/api/storage/download?key=…&exp=…&sig=…`
 *      The current form. Relative by design, so it works in `<img src>` and
 *      survives a domain change. `fetch()` cannot take a relative URL in Node,
 *      which is exactly how the OCR pass would break if it just called fetch:
 *      it would throw "Failed to parse URL". This module reads the object
 *      straight out of B2 instead, which is also a round trip faster and does
 *      not depend on the deployment being able to call itself.
 *
 *   2. `data:…;base64,…`
 *      The inline fallback used when object storage was unreachable at upload
 *      time. Decoded here directly.
 *
 *   3. An absolute `https://…` URL.
 *      Legacy Firebase Storage links stored before the migration, and any
 *      external reference. Fetched normally.
 *
 * Authorisation is the CALLER's responsibility: reaching this code already
 * means the request passed the route's own auth check. The link signature is
 * not re-verified for case 1 — the server is reading its own bucket on behalf
 * of an already-authorised user, not honouring a capability URL.
 *
 * A route whose reference came from the BROWSER must therefore put it through
 * `checkClientFileReference` first, which narrows the accepted shapes and does
 * verify the signature. `readFileReference` on its own would happily resolve a
 * bare object key a caller made up.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, getB2BucketName, isB2Configured } from "./b2";
import { normalizeStorageKey } from "./policy";
import { verifySignedStorageUrl } from "./signing";

export interface ObjectBytes {
  base64: string;
  mimeType: string;
  byteLength: number;
}

/** Largest file we will pull into memory for analysis (Gemini's own cap is lower). */
const MAX_INLINE_BYTES = 25 * 1024 * 1024;

function guessMimeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

interface StorageLinkParts {
  key: string;
  exp: string | null;
  sig: string | null;
}

/**
 * Splits an app storage link into its key and signature parameters, or `null`
 * when the URL is not one. Accepts the relative form and an absolute form
 * carrying the same path, since a link may have been stored with an origin
 * prefix.
 */
function parseStorageLink(url: string): StorageLinkParts | null {
  if (!url) return null;

  const marker = "/api/storage/download";
  const index = url.indexOf(marker);
  if (index === -1) return null;

  const queryStart = url.indexOf("?", index);
  if (queryStart === -1) return null;

  const params = new URLSearchParams(url.slice(queryStart + 1));
  const normalized = normalizeStorageKey(params.get("key"));
  if (!normalized.ok) return null;

  return { key: normalized.key, exp: params.get("exp"), sig: params.get("sig") };
}

/**
 * Extracts the object key from an app storage link, or `null` when the URL is
 * not one.
 */
export function storageKeyFromUrl(url: string): string | null {
  return parseStorageLink(url)?.key ?? null;
}

export type ReferenceCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether a file reference supplied by a BROWSER caller may be resolved.
 *
 * `readFileReference` accepts more shapes than a client should be allowed to
 * name — in particular a bare object key, which exists so server-side callers
 * can pass a stored `path` directly. Handing that to the browser would turn any
 * route that resolves a reference into a way to read arbitrary bucket objects
 * by guessing keys, so client input is narrowed here to the three shapes the
 * upload layer actually persists:
 *
 *   - `data:` URLs, from the inline upload fallback (the bytes are already in
 *     the caller's hand, so there is nothing to authorise);
 *   - `/api/storage/download?key=…&exp=…&sig=…` links, whose HMAC is verified
 *     exactly as `/api/storage/download` verifies it — holding a link grants
 *     that one object and nothing else;
 *   - absolute `https://…` URLs, i.e. legacy Firebase Storage links stored
 *     before the migration.
 *
 * A relative app link is NOT an http(s) URL and must not be rejected for that:
 * every attachment uploaded since the move to B2 is stored in exactly that
 * form (see `createSignedStorageUrl`), and `readFileReference` reads it out of
 * the bucket directly.
 */
export function checkClientFileReference(reference: unknown): ReferenceCheck {
  if (typeof reference !== "string" || !reference.trim()) {
    return { ok: false, error: "A file reference is required." };
  }

  const url = reference.trim();

  if (url.startsWith("data:")) return { ok: true };

  const link = parseStorageLink(url);
  if (link) {
    let signature;
    try {
      signature = verifySignedStorageUrl(link.key, link.exp, link.sig);
    } catch (error: any) {
      // Only reachable when the deployment has no signing secret at all, in
      // which case no stored link works anywhere — say so rather than blaming
      // the file.
      return {
        ok: false,
        error: error?.message || "Storage links cannot be verified on this deployment.",
      };
    }

    if (signature.valid) return { ok: true };
    if (signature.reason === "expired") {
      return { ok: false, error: "This file link has expired. Reload the page and try again." };
    }
    return { ok: false, error: "This file link is not valid." };
  }

  if (/^https?:\/\//i.test(url)) return { ok: true };

  return {
    ok: false,
    error: "File references must be a stored attachment link, a data URL, or an http(s) URL.",
  };
}

function decodeDataUrl(url: string): ObjectBytes {
  // `[\s\S]` rather than the `s` flag: the project's TS target predates it.
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) throw new Error("Malformed data URL.");

  const [, mime, isBase64, payload] = match;
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  return {
    base64: buffer.toString("base64"),
    mimeType: mime || "application/octet-stream",
    byteLength: buffer.byteLength,
  };
}

async function readFromB2(key: string): Promise<ObjectBytes> {
  if (!isB2Configured()) {
    throw new Error("Object storage is not configured, so this file cannot be read.");
  }

  const response = await getB2Client().send(
    new GetObjectCommand({ Bucket: getB2BucketName(), Key: key })
  );

  const size = Number(response.ContentLength || 0);
  if (size > MAX_INLINE_BYTES) {
    throw new Error(
      `File is too large to analyse (${(size / (1024 * 1024)).toFixed(1)}MB).`
    );
  }

  const bytes = await response.Body!.transformToByteArray();
  const buffer = Buffer.from(bytes);

  return {
    base64: buffer.toString("base64"),
    mimeType: String(response.ContentType || "") || guessMimeFromKey(key),
    byteLength: buffer.byteLength,
  };
}

async function readFromHttp(url: string): Promise<ObjectBytes> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file from URL: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_INLINE_BYTES) {
    throw new Error(
      `File is too large to analyse (${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB).`
    );
  }

  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
  return {
    base64: buffer.toString("base64"),
    mimeType: contentType || guessMimeFromKey(url),
    byteLength: buffer.byteLength,
  };
}

/** Reads any supported file reference into base64 bytes plus its MIME type. */
export async function readFileReference(reference: string): Promise<ObjectBytes> {
  const url = (reference || "").trim();
  if (!url) throw new Error("No file reference was given.");

  if (url.startsWith("data:")) return decodeDataUrl(url);

  const key = storageKeyFromUrl(url);
  if (key) return readFromB2(key);

  // A bare object key (no scheme, no query) — accepted so server-side callers
  // can pass a stored `path`/`storagePath` directly.
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    const normalized = normalizeStorageKey(url);
    if (normalized.ok) return readFromB2(normalized.key);
  }

  if (/^https?:\/\//i.test(url)) return readFromHttp(url);

  throw new Error(`Unsupported file reference: ${url.slice(0, 80)}`);
}
