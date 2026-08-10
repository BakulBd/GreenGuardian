/**
 * Mints a presigned Backblaze B2 upload URL for the signed-in caller.
 *
 * This is the only way anything gets into the bucket from a browser. The
 * bucket is private and the B2 credentials live exclusively on the server, so
 * the client never holds anything reusable: it receives a URL that is valid
 * for one object key, one content type, and ten minutes.
 *
 * Everything the browser claims is re-checked here — the key it wants to write
 * to (`lib/storage/policy.ts` decides which prefixes that caller's role may
 * touch), the content type, and the size. A client-side check only decides
 * what to bother uploading; this decides what is allowed.
 *
 * The response also carries the durable `/api/storage/download?…` link the
 * caller stores in Firestore, so the upload and the record of it agree on one
 * URL without a second round trip.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import {
  createPresignedUploadUrl,
  isB2Configured,
  missingB2EnvVars,
  UPLOAD_URL_TTL_SECONDS,
} from "@/lib/storage/b2";
import { createSignedStorageUrl } from "@/lib/storage/signing";
import { normalizeStorageKey, authorizeStorageKey } from "@/lib/storage/policy";
import { ALL_ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/storage/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    if (!isB2Configured()) {
      return jsonError(
        `File storage is not configured on this deployment (missing ${missingB2EnvVars().join(", ")}). Contact an administrator.`,
        503
      );
    }

    const body = await req.json().catch(() => null);

    const normalized = normalizeStorageKey(body?.path);
    if (!normalized.ok) return jsonError(normalized.error!, 400);

    const permission = authorizeStorageKey({
      key: normalized.key,
      uid: auth.uid,
      role: auth.role,
      operation: "upload",
    });
    if (!permission.allowed) return jsonError(permission.error!, 403);

    const contentType = String(body?.contentType || "").trim() || "application/octet-stream";
    if (!ALL_ALLOWED_UPLOAD_TYPES.includes(contentType)) {
      return jsonError(`File type "${contentType}" is not allowed.`, 400);
    }

    const size = Number(body?.size);
    if (!Number.isFinite(size) || size <= 0) {
      return jsonError("A valid file size is required.", 400);
    }
    if (size > MAX_UPLOAD_BYTES) {
      return jsonError(
        `File is too large (${(size / (1024 * 1024)).toFixed(1)}MB). The maximum is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
        400
      );
    }

    const uploadUrl = await createPresignedUploadUrl(normalized.key, contentType);
    const link = createSignedStorageUrl(normalized.key);

    return NextResponse.json({
      success: true,
      key: normalized.key,
      uploadUrl,
      // The browser MUST send exactly this header on the PUT — the value is
      // part of what was signed, and any other value fails the signature.
      headers: { "Content-Type": contentType },
      url: link.url,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
  } catch (error: any) {
    console.error("API /api/storage/upload-url error:", error);
    return jsonError(error?.message || "Could not prepare the upload.", 500);
  }
}
