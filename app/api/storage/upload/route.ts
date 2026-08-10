/**
 * Server-proxied upload fallback: the browser posts the file here and this
 * route writes it to Backblaze B2 with the server's credentials.
 *
 * The primary path is a presigned PUT straight to B2 (`/api/storage/upload-url`),
 * which is faster and has no size ceiling. But a direct PUT is a cross-origin
 * request, so it only works once the bucket carries a CORS rule for this
 * origin — and a bucket whose CORS has not been applied yet fails in the
 * browser as an opaque network error with nothing actionable on screen. That
 * was the single most common way the old Firebase Storage setup broke, so the
 * replacement keeps a path that cannot break the same way: same-origin, no
 * preflight, no bucket configuration involved.
 *
 * Capped at `MAX_PROXY_UPLOAD_BYTES` because the body is buffered in the
 * function and the platform rejects larger request bodies outright. Anything
 * bigger has to use the presigned route.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { putObject, isB2Configured, missingB2EnvVars } from "@/lib/storage/b2";
import { createSignedStorageUrl } from "@/lib/storage/signing";
import { normalizeStorageKey, authorizeStorageKey } from "@/lib/storage/policy";
import {
  ALL_ALLOWED_UPLOAD_TYPES,
  MAX_PROXY_UPLOAD_BYTES,
} from "@/lib/storage/constants";

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

    const form = await req.formData().catch(() => null);
    if (!form) return jsonError("Expected a multipart form upload.", 400);

    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("No file was included in the request.", 400);

    const normalized = normalizeStorageKey(form.get("path"));
    if (!normalized.ok) return jsonError(normalized.error!, 400);

    const permission = authorizeStorageKey({
      key: normalized.key,
      uid: auth.uid,
      role: auth.role,
      operation: "upload",
    });
    if (!permission.allowed) return jsonError(permission.error!, 403);

    const contentType = file.type || String(form.get("contentType") || "") || "application/octet-stream";
    if (!ALL_ALLOWED_UPLOAD_TYPES.includes(contentType)) {
      return jsonError(`File type "${contentType}" is not allowed.`, 400);
    }

    if (file.size <= 0) return jsonError("The file is empty.", 400);
    if (file.size > MAX_PROXY_UPLOAD_BYTES) {
      return jsonError(
        `This upload route accepts files up to ${MAX_PROXY_UPLOAD_BYTES / (1024 * 1024)}MB. Larger files must use the direct upload URL.`,
        413
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(normalized.key, buffer, contentType);

    const link = createSignedStorageUrl(normalized.key);

    return NextResponse.json({
      success: true,
      key: normalized.key,
      url: link.url,
      size: buffer.byteLength,
      contentType,
    });
  } catch (error: any) {
    console.error("API /api/storage/upload error:", error);
    return jsonError(error?.message || "Upload failed.", 500);
  }
}
