/**
 * Green Room — moderation actions (admit, mute, remove, promote, lock, end…).
 *
 * Every host/co-host control in the UI routes through here. The authority
 * check is `canPerform()` from `lib/greenroom/permissions.ts` — the SAME
 * function the browser uses to decide whether to draw the button. Sharing it
 * is the point: a hidden button is a courtesy, this is the enforcement, and
 * because both read one matrix they cannot disagree.
 *
 * The caller's meeting role is re-derived from Firestore on every request
 * (`requireMeetingContext`). It is never read from the request body.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { jsonError } from "@/lib/server/api-auth";
import { requireMeetingContext, loadParticipant } from "@/lib/server/greenroom-auth";
import { canPerform } from "@/lib/greenroom/permissions";
import { MEETINGS, MESSAGES, PARTICIPANTS, participantId } from "@/lib/greenroom/constants";
import { toMillis } from "@/lib/greenroom/codes";
import {
  MeetingSettings,
  ModerationAction,
  MeetingParticipant,
} from "@/lib/greenroom/types";

export const dynamic = "force-dynamic";

const VALID_ACTIONS: ModerationAction[] = [
  "admit",
  "reject",
  "mute",
  "requestUnmute",
  "remove",
  "promote",
  "demote",
  "lowerHand",
  "updateSettings",
  "start",
  "end",
];

/** Append a system message so the room sees why something changed. */
async function postSystemMessage(meetingId: string, text: string): Promise<void> {
  try {
    await getAdminDb().collection(MESSAGES).add({
      meetingId,
      senderId: "system",
      senderName: "Green Room",
      text,
      type: "system",
      createdAt: new Date(),
    });
  } catch (error) {
    // A missing status line must never fail the moderation action itself.
    console.warn("[greenroom/moderate] system message failed:", error);
  }
}

/**
 * Close a participant's open session and bank the elapsed time.
 * Attendance must survive being removed or the meeting ending, so this is
 * applied on every terminal transition rather than only on a clean leave.
 */
function sessionCloseUpdate(participant: MeetingParticipant, now: Date): Record<string, any> {
  const joined = toMillis(participant.joinedAt);
  const banked = participant.totalDurationMs || 0;
  const elapsed = joined > 0 ? Math.max(0, now.getTime() - joined) : 0;
  return {
    leftAt: now,
    totalDurationMs: banked + elapsed,
    micOn: false,
    camOn: false,
    screenSharing: false,
    handRaised: false,
    updatedAt: now,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid request body.", 400);

    const meetingId = String(body.meetingId || "");
    const action = String(body.action || "") as ModerationAction;
    const targetUserId = body.targetUserId ? String(body.targetUserId) : "";

    if (!VALID_ACTIONS.includes(action)) {
      return jsonError(`Unknown action "${action}".`, 400);
    }

    const context = await requireMeetingContext(req, meetingId);
    if (context instanceof NextResponse) return context;

    // --- authority check (shared matrix) ----------------------------------
    const verdict = canPerform(context.role, action, context.settings);
    if (!verdict.allowed) {
      return jsonError(verdict.reason, 403);
    }

    const db = getAdminDb();
    const now = new Date();

    // --- meeting-level actions --------------------------------------------
    if (action === "start") {
      if (context.meeting.status === "ended") {
        return jsonError("This meeting has already ended.", 409);
      }
      await db.collection(MEETINGS).doc(meetingId).update({
        status: "live",
        startedAt: context.meeting.startedAt || now,
        updatedAt: now,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "end") {
      // Close every open session so attendance is complete, then mark ended.
      const activeSnap = await db
        .collection(PARTICIPANTS)
        .where("meetingId", "==", meetingId)
        .where("state", "==", "joined")
        .get();

      const batch = db.batch();
      activeSnap.docs.forEach((d) => {
        const participant = { ...(d.data() as any), id: d.id } as MeetingParticipant;
        batch.update(d.ref, { ...sessionCloseUpdate(participant, now), state: "left" });
      });
      batch.update(db.collection(MEETINGS).doc(meetingId), {
        status: "ended",
        endedAt: now,
        activeParticipantCount: 0,
        updatedAt: now,
      });
      await batch.commit();

      await postSystemMessage(meetingId, "The host ended this meeting.");
      return NextResponse.json({ success: true, ended: true });
    }

    if (action === "updateSettings") {
      const current = context.settings;
      const requested = (body.settings || {}) as Partial<MeetingSettings>;
      const next: MeetingSettings = {
        waitingRoom: Boolean(requested.waitingRoom ?? current.waitingRoom),
        joinBeforeHost: Boolean(requested.joinBeforeHost ?? current.joinBeforeHost),
        allowParticipantScreenShare: Boolean(
          requested.allowParticipantScreenShare ?? current.allowParticipantScreenShare
        ),
        allowChat: Boolean(requested.allowChat ?? current.allowChat),
        allowReactions: Boolean(requested.allowReactions ?? current.allowReactions),
        allowParticipantUnmute: Boolean(
          requested.allowParticipantUnmute ?? current.allowParticipantUnmute
        ),
        audioOnly: Boolean(requested.audioOnly ?? current.audioOnly),
        locked: Boolean(requested.locked ?? current.locked),
      };
      await db.collection(MEETINGS).doc(meetingId).update({ settings: next, updatedAt: now });
      return NextResponse.json({ success: true, settings: next });
    }

    // --- participant-targeted actions -------------------------------------
    if (!targetUserId) {
      return jsonError("targetUserId is required for this action.", 400);
    }

    const target = await loadParticipant(meetingId, targetUserId);
    if (!target) return jsonError("That participant is not in this meeting.", 404);

    const targetRef = db.collection(PARTICIPANTS).doc(participantId(meetingId, targetUserId));

    // The meeting owner is not demotable, removable, or mutable by a co-host.
    // Without this a co-host could remove the teacher from their own class.
    const targetIsOwner = target.userId === context.meeting.teacherId;
    if (targetIsOwner && action !== "lowerHand") {
      return jsonError("The meeting host cannot be moderated.", 403);
    }

    switch (action) {
      case "admit":
        await targetRef.update({
          state: "joined",
          joinedAt: now,
          firstJoinedAt: target.firstJoinedAt || now,
          lastSeenAt: now,
          updatedAt: now,
        });
        return NextResponse.json({ success: true });

      case "reject":
        await targetRef.update({ state: "rejected", updatedAt: now });
        return NextResponse.json({ success: true });

      case "remove":
        await targetRef.update({
          ...sessionCloseUpdate(target, now),
          state: "removed",
        });
        await postSystemMessage(meetingId, `${target.name} was removed from the meeting.`);
        return NextResponse.json({ success: true });

      case "mute":
        // Server-forced mute. The participant's own client stops its track when
        // it observes this, and cannot simply flip it back if the room also has
        // allowParticipantUnmute off.
        await targetRef.update({ micOn: false, updatedAt: now });
        return NextResponse.json({ success: true });

      case "requestUnmute":
        // A request, not a command: a server cannot ethically or technically
        // open someone's microphone for them, so this only raises a prompt.
        await targetRef.update({ unmuteRequestedAt: now, updatedAt: now });
        return NextResponse.json({ success: true, requested: true });

      case "lowerHand":
        await targetRef.update({ handRaised: false, updatedAt: now });
        return NextResponse.json({ success: true });

      case "promote":
        await targetRef.update({ role: "cohost", updatedAt: now });
        await postSystemMessage(meetingId, `${target.name} is now a co-host.`);
        return NextResponse.json({ success: true });

      case "demote":
        await targetRef.update({ role: "participant", updatedAt: now });
        return NextResponse.json({ success: true });

      default:
        return jsonError(`Unsupported action "${action}".`, 400);
    }
  } catch (error: any) {
    console.error("API /api/greenroom/moderate error:", error);
    return jsonError(error?.message || "Moderation action failed.", 500);
  }
}
