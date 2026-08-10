/**
 * Green Room — the role → capability matrix.
 *
 * This module is the ONLY place that decides what a meeting role may do, and
 * it is imported by both sides:
 *
 *   - the browser, to decide which controls to render;
 *   - `/api/greenroom/moderate`, to decide whether to actually perform the
 *     action.
 *
 * That shared import is the point. Hiding a button is a UI courtesy, never a
 * security boundary — a participant can call the API directly. Keeping one
 * matrix means the check the server runs is provably the same one the UI drew,
 * so the two cannot drift into "the button was hidden but the API allowed it".
 *
 * Pure functions only: no Firebase, no `window`, no environment access, so it
 * runs identically in a route handler, a component, and a unit test.
 */
import { MeetingRole, MeetingSettings, ModerationAction } from "./types";

/** Everything a participant might be allowed to do inside a meeting. */
export interface MeetingCapabilities {
  // moderation
  admitParticipants: boolean;
  removeParticipants: boolean;
  muteOthers: boolean;
  lowerOthersHands: boolean;
  assignCoHost: boolean;
  lockMeeting: boolean;
  updateSettings: boolean;
  startMeeting: boolean;
  endMeeting: boolean;
  // self
  shareScreen: boolean;
  sendChat: boolean;
  sendReactions: boolean;
  unmuteSelf: boolean;
  enableCamera: boolean;
}

export function isModerator(role: MeetingRole): boolean {
  return role === "host" || role === "cohost";
}

/**
 * Resolve what `role` may do in a meeting configured with `settings`.
 *
 * Host and co-host differ in exactly two places, deliberately:
 *   - only the host may **end** the meeting for everyone;
 *   - only the host may **assign** co-hosts.
 * Everything else a co-host needs for day-to-day moderation is granted, which
 * matches how a teaching assistant is actually used.
 *
 * Host/co-host are also exempt from the participant-facing policy toggles
 * (`allowChat`, `allowParticipantUnmute`, …). Those exist to restrain the
 * room, not the people running it — a host who disables chat must still be
 * able to post instructions.
 */
export function capabilitiesFor(
  role: MeetingRole,
  settings: MeetingSettings
): MeetingCapabilities {
  const host = role === "host";
  const moderator = isModerator(role);

  return {
    admitParticipants: moderator,
    removeParticipants: moderator,
    muteOthers: moderator,
    lowerOthersHands: moderator,
    assignCoHost: host,
    lockMeeting: moderator,
    updateSettings: moderator,
    startMeeting: moderator,
    endMeeting: host,

    shareScreen: moderator || settings.allowParticipantScreenShare,
    sendChat: moderator || settings.allowChat,
    sendReactions: moderator || settings.allowReactions,
    unmuteSelf: moderator || settings.allowParticipantUnmute,
    // Camera is never policy-gated per participant; `audioOnly` turns video
    // off for the whole room including hosts, so it is checked here too.
    enableCamera: !settings.audioOnly,
  };
}

/** Capability required by each moderation verb. */
const ACTION_CAPABILITY: Record<ModerationAction, keyof MeetingCapabilities> = {
  admit: "admitParticipants",
  reject: "admitParticipants",
  mute: "muteOthers",
  requestUnmute: "muteOthers",
  remove: "removeParticipants",
  promote: "assignCoHost",
  demote: "assignCoHost",
  lowerHand: "lowerOthersHands",
  updateSettings: "updateSettings",
  start: "startMeeting",
  end: "endMeeting",
};

/**
 * The single predicate `/api/greenroom/moderate` calls before doing anything.
 *
 * Returns a reason string on refusal so the API can answer with something
 * specific rather than a bare 403 — the caller is often a legitimate co-host
 * who simply cannot end a meeting.
 */
export function canPerform(
  role: MeetingRole,
  action: ModerationAction,
  settings: MeetingSettings
): { allowed: true } | { allowed: false; reason: string } {
  const capability = ACTION_CAPABILITY[action];
  if (!capability) {
    return { allowed: false, reason: `Unknown action "${action}".` };
  }

  if (capabilitiesFor(role, settings)[capability]) {
    return { allowed: true };
  }

  if (action === "end") {
    return { allowed: false, reason: "Only the host can end the meeting." };
  }
  if (action === "promote" || action === "demote") {
    return { allowed: false, reason: "Only the host can change co-hosts." };
  }
  return { allowed: false, reason: "Only the host or a co-host can do that." };
}

/**
 * Guard for self-service media changes.
 *
 * A muted participant in a room where `allowParticipantUnmute` is off must not
 * be able to simply write `micOn: true` on their own document. The Firestore
 * rules permit the field (they cannot read meeting settings cheaply), so this
 * check runs client-side before the write and server-side on moderation — the
 * host can always re-mute, which is the real backstop.
 */
export function canUnmuteSelf(role: MeetingRole, settings: MeetingSettings): boolean {
  return capabilitiesFor(role, settings).unmuteSelf;
}

/**
 * May this participant present? Screen share is the one participant-facing
 * capability with real disruption potential, so it is off by default and
 * gated by both settings and role.
 */
export function canShareScreen(role: MeetingRole, settings: MeetingSettings): boolean {
  return capabilitiesFor(role, settings).shareScreen;
}
