import { describe, it, expect } from "vitest";
import {
  generateMeetingCode,
  normalizeMeetingCode,
  generatePasscode,
  normalizePasscode,
  buildJoinUrl,
  buildInviteText,
  classifyAttendance,
  effectiveDurationMs,
  buildAttendanceRows,
  formatDuration,
  toMillis,
  PRESENT_THRESHOLD,
  PARTIAL_THRESHOLD,
} from "@/lib/greenroom/codes";
import { PASSCODE_LENGTH } from "@/lib/greenroom/constants";
import { MeetingParticipant } from "@/lib/greenroom/types";

describe("meeting codes", () => {
  it("generates a 123-456-789 shaped code", () => {
    for (let i = 0; i < 25; i++) {
      expect(generateMeetingCode()).toMatch(/^\d{3}-\d{3}-\d{3}$/);
    }
  });

  it("normalizes the shapes users actually type", () => {
    // Dashed, bare, spaced, and mixed all mean the same meeting.
    expect(normalizeMeetingCode("123-456-789")).toBe("123-456-789");
    expect(normalizeMeetingCode("123456789")).toBe("123-456-789");
    expect(normalizeMeetingCode(" 123 456 789 ")).toBe("123-456-789");
    expect(normalizeMeetingCode("123–456–789")).toBe("123-456-789");
  });

  it("rejects codes of the wrong length", () => {
    expect(normalizeMeetingCode("12345678")).toBeNull();
    expect(normalizeMeetingCode("1234567890")).toBeNull();
    expect(normalizeMeetingCode("")).toBeNull();
    expect(normalizeMeetingCode("abc-def-ghi")).toBeNull();
  });

  it("round-trips its own output", () => {
    for (let i = 0; i < 10; i++) {
      const code = generateMeetingCode();
      expect(normalizeMeetingCode(code)).toBe(code);
    }
  });
});

describe("passcodes", () => {
  it("has the configured length", () => {
    expect(generatePasscode()).toHaveLength(PASSCODE_LENGTH);
  });

  it("avoids glyphs that are misread when typed from a slide", () => {
    // No O/0 or I/1 confusion — the same rule the classroom join code uses.
    for (let i = 0; i < 50; i++) {
      expect(generatePasscode()).not.toMatch(/[O0I1L]/);
    }
  });

  it("compares case-insensitively after normalization", () => {
    expect(normalizePasscode(" abc123 ")).toBe("ABC123");
    expect(normalizePasscode("AbC123")).toBe(normalizePasscode("abc123"));
  });
});

describe("invitations", () => {
  it("builds a join URL without a doubled slash", () => {
    expect(buildJoinUrl("https://green.bakul.app", "123-456-789")).toBe(
      "https://green.bakul.app/green-room/123-456-789"
    );
    expect(buildJoinUrl("https://green.bakul.app/", "123-456-789")).toBe(
      "https://green.bakul.app/green-room/123-456-789"
    );
  });

  it("includes the ID, passcode and link in the invite text", () => {
    const text = buildInviteText({
      title: "Data Structures — Week 3",
      meetingCode: "123-456-789",
      passcode: "AB23CD",
      origin: "https://green.bakul.app",
      teacherName: "Dr Rahman",
    });
    expect(text).toContain("Data Structures — Week 3");
    expect(text).toContain("123-456-789");
    expect(text).toContain("AB23CD");
    expect(text).toContain("https://green.bakul.app/green-room/123-456-789");
    expect(text).toContain("Dr Rahman");
  });
});

describe("toMillis", () => {
  it("reads Date, epoch millis, ISO strings and Firestore Timestamps", () => {
    const date = new Date("2026-08-10T10:00:00.000Z");
    expect(toMillis(date)).toBe(date.getTime());
    expect(toMillis(date.getTime())).toBe(date.getTime());
    expect(toMillis(date.toISOString())).toBe(date.getTime());
    expect(toMillis({ toMillis: () => 1234 })).toBe(1234);
    expect(toMillis({ toDate: () => date })).toBe(date.getTime());
  });

  it("returns 0 for missing or unparseable values", () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis(undefined)).toBe(0);
    expect(toMillis("not a date")).toBe(0);
  });
});

describe("classifyAttendance", () => {
  const meeting = 60 * 60 * 1000; // one hour

  it("marks someone present at or above the present threshold", () => {
    expect(classifyAttendance(meeting * PRESENT_THRESHOLD, meeting)).toBe("present");
    expect(classifyAttendance(meeting, meeting)).toBe("present");
  });

  it("marks someone partial between the two thresholds", () => {
    expect(classifyAttendance(meeting * 0.5, meeting)).toBe("partial");
    expect(classifyAttendance(meeting * PARTIAL_THRESHOLD, meeting)).toBe("partial");
  });

  it("marks a brief appearance absent", () => {
    expect(classifyAttendance(meeting * 0.1, meeting)).toBe("absent");
  });

  it("marks a no-show absent", () => {
    expect(classifyAttendance(0, meeting)).toBe("absent");
  });

  it("does not punish attendees when the meeting length is unknown", () => {
    // A missing startedAt must not mark a whole class partial/absent.
    expect(classifyAttendance(5000, 0)).toBe("present");
    expect(classifyAttendance(0, 0)).toBe("absent");
  });
});

describe("effectiveDurationMs", () => {
  const base = {
    totalDurationMs: 0,
    joinedAt: undefined,
    leftAt: undefined,
    state: "joined",
  } as unknown as MeetingParticipant;

  it("returns only banked time for someone who has left", () => {
    expect(
      effectiveDurationMs({ ...base, state: "left", totalDurationMs: 5000 } as any)
    ).toBe(5000);
  });

  it("adds the open session for someone still connected", () => {
    const now = 100_000;
    const value = effectiveDurationMs(
      { ...base, state: "joined", totalDurationMs: 1000, joinedAt: 60_000 } as any,
      now
    );
    // 1000 banked + 40000 still running
    expect(value).toBe(41_000);
  });

  it("does not double-count once a session is closed", () => {
    const value = effectiveDurationMs(
      { ...base, state: "joined", totalDurationMs: 9000, joinedAt: 1000, leftAt: 5000 } as any,
      100_000
    );
    expect(value).toBe(9000);
  });

  it("never returns a negative duration when clocks disagree", () => {
    const value = effectiveDurationMs(
      { ...base, state: "joined", totalDurationMs: 0, joinedAt: 200_000 } as any,
      100_000
    );
    expect(value).toBe(0);
  });
});

describe("buildAttendanceRows", () => {
  const participant = (over: Partial<MeetingParticipant>): MeetingParticipant =>
    ({
      id: "m_u",
      meetingId: "m",
      userId: "u",
      name: "Student",
      appRole: "student",
      role: "participant",
      state: "left",
      micOn: false,
      camOn: false,
      handRaised: false,
      screenSharing: false,
      totalDurationMs: 0,
      reconnects: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as MeetingParticipant;

  it("sorts alphabetically and classifies each row", () => {
    const hour = 60 * 60 * 1000;
    const rows = buildAttendanceRows(
      [
        participant({ userId: "b", name: "Bob", totalDurationMs: hour }),
        participant({ userId: "a", name: "Alice", totalDurationMs: hour * 0.1 }),
      ],
      hour
    );
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob"]);
    expect(rows[0].status).toBe("absent");
    expect(rows[1].status).toBe("present");
  });

  it("carries the reconnect count through", () => {
    const rows = buildAttendanceRows([participant({ reconnects: 3 })], 1000);
    expect(rows[0].reconnects).toBe(3);
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes and seconds readably", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000 + 30_000)).toBe("12m 30s");
    expect(formatDuration(64 * 60_000)).toBe("1h 04m");
  });
});
