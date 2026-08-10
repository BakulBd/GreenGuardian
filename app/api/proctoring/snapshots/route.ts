/**
 * Server-side deletion of proctoring warning screenshots.
 *
 * Deletion has to happen here rather than in the browser: proctoring evidence
 * must not be destroyable by the student it was raised against, and deciding
 * that requires reading the related exam document to establish who owns the
 * screenshot. `lib/storage/policy.ts` refuses `warningScreenshots/` deletes
 * from the generic storage route for exactly that reason, so this route — which
 * checks exam ownership first — is the only way one is ever removed.
 *
 * The object itself lives in the private Backblaze B2 bucket and is deleted
 * with the server's credentials, so no CORS or client permission is involved.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { deleteObject, isB2Configured } from "@/lib/storage/b2";
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
    // `inline:` paths come from the base64 fallback (object storage was
    // unavailable at capture time) — there is no stored object to delete.
    if (storagePath && !storagePath.startsWith("inline:") && isB2Configured()) {
      try {
        await deleteObject(storagePath);
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
