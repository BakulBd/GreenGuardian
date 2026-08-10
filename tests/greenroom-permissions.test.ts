import { describe, it, expect } from "vitest";
import {
  capabilitiesFor,
  canPerform,
  canShareScreen,
  canUnmuteSelf,
  isModerator,
} from "@/lib/greenroom/permissions";
import { DEFAULT_MEETING_SETTINGS } from "@/lib/greenroom/constants";
import { MeetingSettings, ModerationAction } from "@/lib/greenroom/types";

const settings = (overrides: Partial<MeetingSettings> = {}): MeetingSettings => ({
  ...DEFAULT_MEETING_SETTINGS,
  ...overrides,
});

describe("isModerator", () => {
  it("counts host and cohost, not participant", () => {
    expect(isModerator("host")).toBe(true);
    expect(isModerator("cohost")).toBe(true);
    expect(isModerator("participant")).toBe(false);
  });
});

describe("capabilitiesFor", () => {
  it("gives the host everything", () => {
    const caps = capabilitiesFor("host", settings());
    expect(caps.endMeeting).toBe(true);
    expect(caps.assignCoHost).toBe(true);
    expect(caps.removeParticipants).toBe(true);
    expect(caps.lockMeeting).toBe(true);
  });

  it("withholds exactly two powers from a co-host", () => {
    const caps = capabilitiesFor("cohost", settings());
    // A co-host moderates day to day...
    expect(caps.admitParticipants).toBe(true);
    expect(caps.removeParticipants).toBe(true);
    expect(caps.muteOthers).toBe(true);
    expect(caps.lockMeeting).toBe(true);
    // ...but cannot end the class or mint more co-hosts.
    expect(caps.endMeeting).toBe(false);
    expect(caps.assignCoHost).toBe(false);
  });

  it("gives a participant no moderation powers at all", () => {
    const caps = capabilitiesFor("participant", settings());
    expect(caps.admitParticipants).toBe(false);
    expect(caps.removeParticipants).toBe(false);
    expect(caps.muteOthers).toBe(false);
    expect(caps.assignCoHost).toBe(false);
    expect(caps.lockMeeting).toBe(false);
    expect(caps.endMeeting).toBe(false);
    expect(caps.updateSettings).toBe(false);
  });

  it("applies participant policy toggles to participants", () => {
    const locked = settings({
      allowChat: false,
      allowReactions: false,
      allowParticipantUnmute: false,
      allowParticipantScreenShare: false,
    });
    const caps = capabilitiesFor("participant", locked);
    expect(caps.sendChat).toBe(false);
    expect(caps.sendReactions).toBe(false);
    expect(caps.unmuteSelf).toBe(false);
    expect(caps.shareScreen).toBe(false);
  });

  it("exempts moderators from participant policy toggles", () => {
    // A host who disables chat for the room must still be able to post.
    const locked = settings({
      allowChat: false,
      allowReactions: false,
      allowParticipantUnmute: false,
      allowParticipantScreenShare: false,
    });
    for (const role of ["host", "cohost"] as const) {
      const caps = capabilitiesFor(role, locked);
      expect(caps.sendChat).toBe(true);
      expect(caps.sendReactions).toBe(true);
      expect(caps.unmuteSelf).toBe(true);
      expect(caps.shareScreen).toBe(true);
    }
  });

  it("turns the camera off for everyone in audio-only mode, hosts included", () => {
    const audioOnly = settings({ audioOnly: true });
    expect(capabilitiesFor("host", audioOnly).enableCamera).toBe(false);
    expect(capabilitiesFor("cohost", audioOnly).enableCamera).toBe(false);
    expect(capabilitiesFor("participant", audioOnly).enableCamera).toBe(false);
  });
});

describe("canPerform", () => {
  const moderationActions: ModerationAction[] = [
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

  it("refuses every moderation action for a plain participant", () => {
    // This is the check the API actually runs; a student calling the endpoint
    // directly must be refused regardless of what the UI rendered.
    for (const action of moderationActions) {
      const verdict = canPerform("participant", action, settings());
      expect(verdict.allowed, `participant should not be able to ${action}`).toBe(false);
    }
  });

  it("allows the host every moderation action", () => {
    for (const action of moderationActions) {
      expect(canPerform("host", action, settings()).allowed, action).toBe(true);
    }
  });

  it("blocks a co-host from ending the meeting, with a specific reason", () => {
    const verdict = canPerform("cohost", "end", settings());
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toMatch(/only the host/i);
    }
  });

  it("blocks a co-host from changing co-hosts, with a specific reason", () => {
    for (const action of ["promote", "demote"] as const) {
      const verdict = canPerform("cohost", action, settings());
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.reason).toMatch(/co-hosts/i);
    }
  });

  it("lets a co-host run ordinary moderation", () => {
    for (const action of ["admit", "reject", "mute", "remove", "lowerHand", "start"] as const) {
      expect(canPerform("cohost", action, settings()).allowed, action).toBe(true);
    }
  });

  it("rejects an unknown action rather than defaulting to allow", () => {
    const verdict = canPerform("host", "definitelyNotAnAction" as ModerationAction, settings());
    expect(verdict.allowed).toBe(false);
  });
});

describe("self-service guards", () => {
  it("stops a participant unmuting when the room forbids it", () => {
    expect(canUnmuteSelf("participant", settings({ allowParticipantUnmute: false }))).toBe(false);
    expect(canUnmuteSelf("participant", settings({ allowParticipantUnmute: true }))).toBe(true);
  });

  it("never stops a host unmuting", () => {
    expect(canUnmuteSelf("host", settings({ allowParticipantUnmute: false }))).toBe(true);
  });

  it("gates participant screen share on the room setting", () => {
    expect(canShareScreen("participant", settings({ allowParticipantScreenShare: false }))).toBe(false);
    expect(canShareScreen("participant", settings({ allowParticipantScreenShare: true }))).toBe(true);
    expect(canShareScreen("host", settings({ allowParticipantScreenShare: false }))).toBe(true);
  });

  it("defaults to participants not being able to share their screen", () => {
    // Screen share is the most disruptive participant capability, so the
    // out-of-the-box default matters.
    expect(DEFAULT_MEETING_SETTINGS.allowParticipantScreenShare).toBe(false);
    expect(DEFAULT_MEETING_SETTINGS.waitingRoom).toBe(true);
  });
});
