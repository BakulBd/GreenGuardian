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
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, getB2BucketName, isB2Configured } from "./b2";
import { normalizeStorageKey } from "./policy";

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

/**
 * Extracts the object key from an app storage link, or `null` when the URL is
 * not one. Accepts the relative form and an absolute form carrying the same
 * path, since a link may have been stored with an origin prefix.
 */
export function storageKeyFromUrl(url: string): string | null {
  if (!url) return null;

  const marker = "/api/storage/download";
  const index = url.indexOf(marker);
  if (index === -1) return null;

  const queryStart = url.indexOf("?", index);
  if (queryStart === -1) return null;

  const key = new URLSearchParams(url.slice(queryStart + 1)).get("key");
  if (!key) return null;

  const normalized = normalizeStorageKey(key);
  return normalized.ok ? normalized.key : null;
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
