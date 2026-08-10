/**
 * Green Room — leave a meeting.
 *
 * Attendance is the reason this is a server route rather than a client write.
 * `totalDurationMs`, `leftAt` and `state` are outside the participant's
 * Firestore field allowlist precisely so a student cannot inflate their
 * attended time, which means only the server can close a session.
 *
 * Best-effort by nature: a closed laptop never calls this. The heartbeat
 * (`lastSeenAt`) plus `PRESENCE_TIMEOUT_MS` is what covers that case on the
 * reading side, and a rejoin banks the previous session anyway.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { loadParticipant } from "@/lib/server/greenroom-auth";
import { MEETINGS, PARTICIPANTS, participantId } from "@/lib/greenroom/constants";
import { toMillis } from "@/lib/greenroom/codes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => null);
    const meetingId = String(body?.meetingId || "");
    if (!meetingId) return jsonError("meetingId is required.", 400);

    const participant = await loadParticipant(meetingId, auth.uid);
    // Nothing to close is a success, not an error — leaving twice (tab close
    // plus an explicit click) is normal and must stay idempotent.
    if (!participant || participant.state !== "joined") {
      return NextResponse.json({ success: true, alreadyLeft: true });
    }

    const now = new Date();
    const joined = toMillis(participant.joinedAt);
    const elapsed = joined > 0 ? Math.max(0, now.getTime() - joined) : 0;

    const db = getAdminDb();
    await db
      .collection(PARTICIPANTS)
      .doc(participantId(meetingId, auth.uid))
      .update({
        state: "left",
        leftAt: now,
        totalDurationMs: (participant.totalDurationMs || 0) + elapsed,
        micOn: false,
        camOn: false,
        screenSharing: false,
        handRaised: false,
        updatedAt: now,
      });

    // If the owning teacher leaves, the meeting keeps running — students may
    // legitimately stay in a breakout-style session, and ending a class is an
    // explicit host action ("End Meeting"), never a side effect of a dropped
    // connection.
    await db
      .collection(MEETINGS)
      .doc(meetingId)
      .update({ updatedAt: now })
      .catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API /api/greenroom/leave error:", error);
    return jsonError(error?.message || "Failed to leave the meeting.", 500);
  }
}
