/**
 * Deletes an object from the private B2 bucket.
 *
 * Deletion is server-side only. The browser holds no B2 credential, so the
 * decision of who may remove which key lives entirely in
 * `lib/storage/policy.ts` — most notably `warningScreenshots/`, which this
 * route refuses outright because proctoring evidence must not be destroyable
 * by the student it was raised against. Those deletions go through
 * `/api/proctoring/snapshots`, which verifies exam ownership first.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { deleteObject, isB2Configured } from "@/lib/storage/b2";
import { normalizeStorageKey, authorizeStorageKey } from "@/lib/storage/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    if (!isB2Configured()) {
      return jsonError("File storage is not configured on this deployment.", 503);
    }

    const normalized = normalizeStorageKey(req.nextUrl.searchParams.get("key"));
    if (!normalized.ok) return jsonError(normalized.error!, 400);

    const permission = authorizeStorageKey({
      key: normalized.key,
      uid: auth.uid,
      role: auth.role,
      operation: "delete",
    });
    if (!permission.allowed) return jsonError(permission.error!, 403);

    // S3 delete is idempotent — an already-absent key reports success, which
    // is the behaviour callers want when they are cleaning up a record whose
    // file may never have been written.
    await deleteObject(normalized.key);

    return NextResponse.json({ success: true, key: normalized.key });
  } catch (error: any) {
    console.error("API /api/storage/object error:", error);
    return jsonError(error?.message || "Could not delete the file.", 500);
  }
}
