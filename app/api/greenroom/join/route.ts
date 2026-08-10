/**
 * Green Room — join a meeting.
 *
 * This is the security boundary for the whole feature. It is the ONLY place a
 * participant document is created, and it is what decides the caller's meeting
 * role. `firestore.rules` denies client creates on `greenRoomParticipants`
 * precisely so this route cannot be bypassed: a participant who could write
 * their own document could set `role: "host"` and take over the class.
 *
 * Four independent gates, all of which must pass:
 *   1. Authentication      — a valid Firebase ID token (requireAuthedUser).
 *   2. Passcode            — proves they were invited.
 *   3. Eligibility         — proves they belong to this class (isStudentEligible).
 *   4. Capacity / lock     — the room has room and is accepting joins.
 *
 * Gates 2 and 3 are deliberately both required. A passcode circulating outside
 * the cohort is still useless to a stranger, and an eligible student still
 * cannot wander into a class they were not given the code for.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  findMeetingByCode,
  loadParticipant,
  deriveRole,
  passcodeMatches,
  readPasscodeHash,
  resolveSettings,
  isStudentEligible,
} from "@/lib/server/greenroom-auth";
import { MEETINGS, PARTICIPANTS, capacityFor, participantId } from "@/lib/greenroom/constants";
import { normalizeMeetingCode } from "@/lib/greenroom/codes";
import { MeetingParticipant, ParticipantState } from "@/lib/greenroom/types";

export const dynamic = "force-dynamic";

/** Deliberately strict: passcode guessing is the attack this route invites. */
const JOIN_ATTEMPTS_PER_MINUTE = 10;

function serialize(value: any): any {
  if (value == null) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const rate = checkRateLimit(
      `greenroom-join:${auth.uid}:${getClientIp(req)}`,
      JOIN_ATTEMPTS_PER_MINUTE,
      60_000
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many join attempts. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid request body.", 400);

    const meetingCode = normalizeMeetingCode(String(body.meetingCode || ""));
    if (!meetingCode) {
      return jsonError("That doesn't look like a valid Meeting ID.", 400);
    }

    const meeting = await findMeetingByCode(meetingCode);
    if (!meeting) return jsonError("No meeting exists with that Meeting ID.", 404);

    const settings = resolveSettings(meeting.settings);
    const db = getAdminDb();

    // Existing participant? Rejoining should not re-run the passcode gate —
    // a dropped connection mid-class must reconnect cleanly.
    const existing = await loadParticipant(meeting.id, auth.uid);
    const role = deriveRole(meeting, auth, existing);
    const isModerator = role === "host" || role === "cohost";

    if (existing?.state === "removed") {
      return jsonError("You were removed from this meeting by the host.", 403);
    }

    // --- Gate 2: passcode (skipped for the host and for a live rejoin) -----
    const isRejoin = Boolean(existing && existing.state !== "rejected");
    if (!isModerator && !isRejoin) {
      const submitted = String(body.passcode || "");
      if (!submitted) return jsonError("This meeting requires a passcode.", 401);

      const storedHash = await readPasscodeHash(meeting.id);
      if (!storedHash || !passcodeMatches(submitted, storedHash, meeting.id)) {
        return jsonError("That passcode is not correct.", 401);
      }
    }

    // --- Gate 3: eligibility ----------------------------------------------
    if (auth.role === "student") {
      const eligible = await isStudentEligible(meeting, auth);
      if (!eligible) {
        return jsonError(
          "You are not enrolled in this class, so you cannot join this meeting.",
          403
        );
      }
    }

    // --- Gate 4: meeting state, lock, capacity ----------------------------
    if (meeting.status === "cancelled") {
      return jsonError("This class was cancelled.", 409);
    }
    if (meeting.status === "ended") {
      return jsonError("This meeting has already ended.", 409);
    }
    if (!isModerator && settings.locked) {
      return jsonError("The host has locked this meeting to new participants.", 403);
    }
    if (!isModerator && meeting.status === "scheduled" && !settings.joinBeforeHost) {
      return jsonError(
        "The host hasn't started this class yet. Please wait and try again.",
        409
      );
    }

    // Capacity counts people actually in the room. Mesh WebRTC degrades badly
    // past the cap (see MAX_MESH_PARTICIPANTS), so this refuses cleanly rather
    // than letting the call fall apart for everyone already inside.
    if (!isModerator && !isRejoin) {
      const activeSnap = await db
        .collection(PARTICIPANTS)
        .where("meetingId", "==", meeting.id)
        .where("state", "==", "joined")
        .get();
      if (activeSnap.size >= capacityFor(settings)) {
        return jsonError(
          "This meeting is full. Green Room supports a limited number of simultaneous participants.",
          409
        );
      }
    }

    // --- Admit or park in the waiting room --------------------------------
    // Moderators never wait. Everyone else does when the waiting room is on
    // and they have not already been admitted for this meeting.
    const alreadyAdmitted =
      existing?.state === "admitted" || existing?.state === "joined" || existing?.state === "left";
    const state: ParticipantState =
      isModerator || !settings.waitingRoom || alreadyAdmitted ? "joined" : "waiting";

    const now = new Date();
    const docRef = db.collection(PARTICIPANTS).doc(participantId(meeting.id, auth.uid));

    if (existing) {
      // Reconnect: bank the previous session's time, then reopen a new one.
      const update: Record<string, any> = {
        state,
        role,
        updatedAt: now,
        lastSeenAt: now,
      };
      if (state === "joined") {
        update.joinedAt = now;
        update.reconnects = (existing.reconnects || 0) + 1;
        update.leftAt = null;
      }
      await docRef.update(update);
    } else {
      const participant: Omit<MeetingParticipant, "id"> = {
        meetingId: meeting.id,
        userId: auth.uid,
        name: auth.name || auth.email || "Participant",
        email: auth.email,
        appRole: (auth.role as any) || "student",
        role,
        state,
        micOn: false,
        // Muted-and-dark on entry is the classroom-safe default; the pre-join
        // screen is where a participant opts in to publishing.
        camOn: false,
        handRaised: false,
        screenSharing: false,
        lastSeenAt: now,
        firstJoinedAt: state === "joined" ? now : undefined,
        joinedAt: state === "joined" ? now : undefined,
        totalDurationMs: 0,
        reconnects: 0,
        createdAt: now,
        updatedAt: now,
      };
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(participant)) if (v !== undefined) clean[k] = v;
      await docRef.set(clean);
    }

    // A host arriving at a scheduled meeting starts it, so students waiting on
    // "the host hasn't started this class yet" get in without a separate click.
    if (isModerator && meeting.status === "scheduled") {
      await db.collection(MEETINGS).doc(meeting.id).update({
        status: "live",
        startedAt: now,
        updatedAt: now,
      });
      meeting.status = "live";
      (meeting as any).startedAt = now;
    }

    return NextResponse.json({
      success: true,
      meeting: serialize({ ...meeting, settings }),
      meetingId: meeting.id,
      role,
      state,
      // The client uses this to decide between the waiting screen and the room.
      waiting: state === "waiting",
    });
  } catch (error: any) {
    console.error("API /api/greenroom/join error:", error);
    return jsonError(error?.message || "Failed to join the meeting.", 500);
  }
}
