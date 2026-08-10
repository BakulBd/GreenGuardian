/**
 * Resolves a stored file link to the private object behind it.
 *
 * Every attachment URL persisted in Firestore points here. The bucket is
 * private, so this route mints a short-lived presigned B2 URL and redirects to
 * it — the browser gets the bytes straight from B2 without this function ever
 * proxying them, and without any B2 credential leaving the server.
 *
 * Two ways to authorise a request, both supported deliberately:
 *
 *   1. A signed link (`key` + `exp` + `sig`). This is what `<img src>` and
 *      `<a href>` use, since neither can attach an Authorization header. The
 *      signature is unguessable and covers the key, so holding one link grants
 *      access to that one object and nothing else — the same capability-URL
 *      model Firebase Storage's `?token=` download links used.
 *   2. A bearer ID token, for authenticated fetches (tools, scripts, and any
 *      future UI that resolves a key it holds without a stored link).
 *
 * An unsigned, unauthenticated request gets 401 — a bare `?key=` is never
 * enough, so nobody can walk the bucket by guessing paths.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { createPresignedDownloadUrl, isB2Configured, headObject } from "@/lib/storage/b2";
import { verifySignedStorageUrl } from "@/lib/storage/signing";
import { normalizeStorageKey, filenameFromKey } from "@/lib/storage/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    if (!isB2Configured()) {
      return jsonError("File storage is not configured on this deployment.", 503);
    }

    const params = req.nextUrl.searchParams;

    const normalized = normalizeStorageKey(params.get("key"));
    if (!normalized.ok) return jsonError(normalized.error!, 400);
    const key = normalized.key;

    const signature = verifySignedStorageUrl(key, params.get("exp"), params.get("sig"));

    if (!signature.valid) {
      if (signature.reason === "expired") {
        return jsonError("This file link has expired.", 410);
      }
      // No usable signature — fall back to a bearer-authenticated caller.
      const auth = await requireAuthedUser(req);
      if (auth instanceof NextResponse) {
        return signature.reason === "missing"
          ? auth
          : jsonError("This file link is not valid.", 403);
      }
    }

    // A missing object would otherwise redirect to a presigned URL that fails
    // with B2's own XML error page — confusing, and it looks like a broken
    // link rather than a deleted file.
    const metadata = await headObject(key);
    if (!metadata) return jsonError("This file no longer exists.", 404);

    const presigned = await createPresignedDownloadUrl(key, {
      downloadFilename: params.get("download") === "1" ? filenameFromKey(key) : undefined,
    });

    // `no-store` matters: the redirect target is short-lived, and a cached 302
    // would hand a stale (expired) presigned URL to the next visitor.
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error: any) {
    console.error("API /api/storage/download error:", error);
    return jsonError(error?.message || "Could not open this file.", 500);
  }
}
