/**
 * Server-side deletion of proctoring warning screenshots.
 *
 * This used to happen directly from the browser (Firebase Storage SDK
 * `deleteObject()`), which had two problems:
 *   - `storage.rules` allowed ANY authenticated user to delete a
 *     `warningScreenshots/*` object — including the student the warning was
 *     raised against, who has every incentive to destroy the evidence.
 *   - A direct-from-browser DELETE requires the live Storage bucket's CORS
 *     config to allow it; a committed `cors.json` in the repo does nothing
 *     until it's actually applied to the bucket, and in the meantime the
 *     preflight request is blocked by the browser.
 *
 * Moving deletion here fixes both: the Admin SDK call has no CORS
 * involved at all, and ownership (the caller's teacher owns the exam this
 * screenshot belongs to, or is an admin) is enforced before anything is
 * deleted — something `storage.rules` cannot express on its own, since that
 * would require reading the related exam document.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, getAdminBucket } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req, ["teacher", "admin"]);
    if (auth instanceof NextResponse) return auth;

    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) return jsonError("id is required.", 400);

    const db = getAdminDb();
    const snapshotRef = db.collection("warningScreenshots").doc(id);
    const snapshotDoc = await snapshotRef.get();
    if (!snapshotDoc.exists) {
      return jsonError("Snapshot not found.", 404);
    }
    const snapshot = snapshotDoc.data() || {};

    if (auth.role === "teacher") {
      const examId = String(snapshot.examId || "");
      if (!examId) {
        return jsonError("You do not have access to this snapshot.", 403);
      }
      const examDoc = await db.collection("exams").doc(examId).get();
      const exam = examDoc.data() || {};
      if (exam.teacherId !== auth.uid && exam.createdBy !== auth.uid) {
        return jsonError("You do not have access to this snapshot.", 403);
      }
    }
    // Admins may delete any snapshot.

    const storagePath = String(snapshot.storagePath || "");
    // `inline:` paths come from the base64 fallback (Storage was unavailable
    // at capture time) — there is no actual Storage object to delete.
    if (storagePath && !storagePath.startsWith("inline:")) {
      try {
        await getAdminBucket().file(storagePath).delete();
      } catch (error) {
        // Already gone, or never actually uploaded — the Firestore record is
        // the source of truth for whether the warning still "exists".
        console.warn("[proctoring/snapshots] Storage delete failed (continuing):", error);
      }
    }

    await snapshotRef.delete();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API /api/proctoring/snapshots error:", error);
    return jsonError(error?.message || "Failed to delete the snapshot.", 500);
  }
}
