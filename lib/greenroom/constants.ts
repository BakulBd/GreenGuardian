/**
 * Green Room — collection names, capacity limits, and shared tuning constants.
 *
 * Kept free of imports from `firebase/*` so both the browser bundle and the
 * Admin-SDK server routes can use the same collection names and the same
 * capacity rules. Two copies of "what is the participant cap" is exactly the
 * kind of drift that turns into a security or capacity bug.
 */
import { MeetingSettings } from "./types";

// --- collections -----------------------------------------------------------

export const MEETINGS = "greenRoomMeetings";
/** Passcode hashes. Rules deny ALL client access; only the Admin SDK reads it. */
export const SECRETS = "greenRoomSecrets";
export const PARTICIPANTS = "greenRoomParticipants";
/** Parent of the per-meeting `peers` subcollection carrying SDP/ICE. */
export const SIGNALS = "greenRoomSignals";
export const MESSAGES = "greenRoomMessages";
export const REACTIONS = "greenRoomReactions";

/** Deterministic participant document id — mirrors the classroomMembers pattern. */
export function participantId(meetingId: string, userId: string): string {
  return `${meetingId}_${userId}`;
}

// --- capacity --------------------------------------------------------------

/**
 * Hard ceiling on simultaneous media participants.
 *
 * Green Room uses full-mesh WebRTC: every participant holds a peer connection
 * to every other one, so connection count grows as N×(N−1)/2 and each browser
 * encodes its camera once per peer. Past roughly 8 people that saturates CPU
 * and uplink on ordinary hardware, and the failure mode is ugly (frozen video,
 * audio dropouts) rather than a clean error.
 *
 * So the cap is enforced at join time server-side and surfaced as a clear
 * "this meeting is full" message. Raising it without moving to an SFU will
 * degrade the meeting, not extend it — see docs/KNOWN_LIMITATIONS.md.
 *
 * `audioOnly` mode skips video entirely, which is far cheaper; the cap is
 * relaxed by `AUDIO_ONLY_CAPACITY_MULTIPLIER` in that mode.
 */
export const MAX_MESH_PARTICIPANTS = readIntEnv(
  process.env.NEXT_PUBLIC_GREENROOM_MAX_PARTICIPANTS,
  8
);

/** Audio costs a fraction of video, so an audio-only room may hold more. */
export const AUDIO_ONLY_CAPACITY_MULTIPLIER = 2;

/** Effective cap for a meeting, given its settings. */
export function capacityFor(settings: Pick<MeetingSettings, "audioOnly">): number {
  return settings.audioOnly
    ? MAX_MESH_PARTICIPANTS * AUDIO_ONLY_CAPACITY_MULTIPLIER
    : MAX_MESH_PARTICIPANTS;
}

function readIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// --- media tuning ----------------------------------------------------------

/**
 * Outbound video resolution steps down as the room grows: each extra peer is
 * another encode of the same camera, so holding 720p for everyone is what
 * actually melts a laptop in a 6-person mesh call.
 */
export function videoConstraintsForPeerCount(peerCount: number): MediaTrackConstraints {
  if (peerCount <= 1) return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  if (peerCount <= 3) return { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 25, max: 30 } };
  if (peerCount <= 5) return { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } };
  return { width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 15, max: 20 } };
}

/** How often a joined participant refreshes `lastSeenAt`. */
export const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * A participant whose heartbeat is older than this is treated as gone (closed
 * laptop, killed tab) so the grid doesn't fill with ghosts. Generous relative
 * to the heartbeat so a slow network doesn't evict a live participant.
 */
export const PRESENCE_TIMEOUT_MS = 70_000;

/** Chat message ceiling — matches the notice/comment limits used elsewhere. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Reactions older than this are ignored by the client (they are ephemeral). */
export const REACTION_TTL_MS = 6_000;

// --- identifiers -----------------------------------------------------------

/** Digits per meeting-code group, rendered `123-456-789`. */
export const MEETING_CODE_GROUPS = 3;
export const MEETING_CODE_GROUP_SIZE = 3;
export const PASSCODE_LENGTH = 6;

/**
 * Default policy for a new meeting: waiting room on, participants muted-capable
 * but not screen-sharing. Conservative on purpose — a teacher can loosen it
 * per meeting, but an unattended default should not let a stranger with a
 * guessed code take over the projector.
 */
export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  waitingRoom: true,
  joinBeforeHost: false,
  allowParticipantScreenShare: false,
  allowChat: true,
  allowReactions: true,
  allowParticipantUnmute: true,
  audioOnly: false,
  locked: false,
};
