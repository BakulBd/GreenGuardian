/**
 * Green Room — meeting codes, passcodes, and attendance arithmetic.
 *
 * Pure functions with no Firebase dependency so they are unit-testable and
 * usable from both the browser and route handlers. Anything that needs a
 * CSPRNG takes it from `globalThis.crypto`, which exists in both the browser
 * and Node 18+ (and therefore in Vercel route handlers).
 */
import {
  MEETING_CODE_GROUPS,
  MEETING_CODE_GROUP_SIZE,
  PASSCODE_LENGTH,
} from "./constants";
import { AttendanceRow, MeetingParticipant } from "./types";

/** Random integers in `[0, max)` from the platform CSPRNG. */
function randomInts(count: number, max: number): number[] {
  const buffer = new Uint32Array(count);
  globalThis.crypto.getRandomValues(buffer);
  // Modulo bias across 2^32 for these tiny ranges is far below anything that
  // matters for a meeting code; the passcode's security comes from the
  // server-side rate limit and eligibility check, not from raw entropy.
  return Array.from(buffer, (n) => n % max);
}

/**
 * Generate a meeting code formatted `123-456-789`.
 *
 * Digits only, grouped, because these get read aloud and typed on phones.
 * Uniqueness is not guaranteed here — the caller retries against Firestore.
 */
export function generateMeetingCode(): string {
  const digits = randomInts(MEETING_CODE_GROUPS * MEETING_CODE_GROUP_SIZE, 10);
  const groups: string[] = [];
  for (let i = 0; i < MEETING_CODE_GROUPS; i++) {
    groups.push(
      digits
        .slice(i * MEETING_CODE_GROUP_SIZE, (i + 1) * MEETING_CODE_GROUP_SIZE)
        .join("")
    );
  }
  return groups.join("-");
}

/**
 * Accept a meeting code the user typed, in any reasonable shape.
 *
 * People paste `123-456-789`, type `123456789`, or copy it with stray spaces.
 * All three mean the same meeting, so normalise to the canonical dashed form
 * and reject anything that isn't the right number of digits.
 */
export function normalizeMeetingCode(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== MEETING_CODE_GROUPS * MEETING_CODE_GROUP_SIZE) return null;

  const groups: string[] = [];
  for (let i = 0; i < MEETING_CODE_GROUPS; i++) {
    groups.push(digits.slice(i * MEETING_CODE_GROUP_SIZE, (i + 1) * MEETING_CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Passcode alphabet with no ambiguous glyphs (no O/0, I/l/1).
 * Same reasoning as the classroom join code and the admin temp password.
 */
const PASSCODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePasscode(): string {
  return randomInts(PASSCODE_LENGTH, PASSCODE_ALPHABET.length)
    .map((n) => PASSCODE_ALPHABET[n])
    .join("");
}

/** Passcodes are compared case-insensitively — they get typed by hand. */
export function normalizePasscode(raw: string): string {
  return String(raw || "").trim().toUpperCase();
}

/**
 * Build the invite text a teacher copies into an email or chat.
 * `origin` comes from the caller (`window.location.origin` or the request
 * host) so this stays environment-agnostic.
 */
export function buildInviteText(input: {
  title: string;
  meetingCode: string;
  passcode: string;
  origin: string;
  scheduledStart?: Date;
  teacherName?: string;
}): string {
  const lines = [
    `${input.teacherName ? `${input.teacherName} is inviting you` : "You are invited"} to a Green Room class.`,
    "",
    `Topic: ${input.title}`,
  ];
  if (input.scheduledStart) {
    lines.push(`Time: ${input.scheduledStart.toLocaleString()}`);
  }
  lines.push(
    "",
    `Join: ${buildJoinUrl(input.origin, input.meetingCode)}`,
    "",
    `Meeting ID: ${input.meetingCode}`,
    `Passcode: ${input.passcode}`
  );
  return lines.join("\n");
}

export function buildJoinUrl(origin: string, meetingCode: string): string {
  return `${origin.replace(/\/+$/, "")}/green-room/${encodeURIComponent(meetingCode)}`;
}

// --- attendance ------------------------------------------------------------

/**
 * Fraction of the meeting a student must be present for to count as `present`.
 * Below `PARTIAL_THRESHOLD` they are `absent`; between the two, `partial`.
 */
export const PRESENT_THRESHOLD = 0.75;
export const PARTIAL_THRESHOLD = 0.25;

/**
 * Classify attendance against how long the meeting actually ran.
 *
 * Measured against the real elapsed time rather than the *scheduled* duration:
 * a class that ends 20 minutes early should not mark everyone partial. A
 * non-positive meeting length means we have no basis to judge, so anyone who
 * showed up at all counts as present rather than being punished by a missing
 * timestamp.
 */
export function classifyAttendance(
  totalDurationMs: number,
  meetingDurationMs: number
): AttendanceRow["status"] {
  if (totalDurationMs <= 0) return "absent";
  if (meetingDurationMs <= 0) return "present";

  const ratio = totalDurationMs / meetingDurationMs;
  if (ratio >= PRESENT_THRESHOLD) return "present";
  if (ratio >= PARTIAL_THRESHOLD) return "partial";
  return "absent";
}

/** Firestore Timestamp | Date | number | ISO string → epoch millis (0 unknown). */
export function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Accumulated presence for a participant, including the session they are in
 * right now.
 *
 * `totalDurationMs` on the document only covers *completed* sessions — it is
 * written when someone leaves. While a participant is still connected, the
 * current open session has to be added on the fly, otherwise a teacher looking
 * at attendance during the class sees everyone at zero.
 */
export function effectiveDurationMs(
  participant: Pick<MeetingParticipant, "totalDurationMs" | "joinedAt" | "leftAt" | "state">,
  now: number = Date.now()
): number {
  const banked = participant.totalDurationMs || 0;
  if (participant.state !== "joined") return banked;

  const joined = toMillis(participant.joinedAt);
  const left = toMillis(participant.leftAt);
  // Still open when there is a join with no later leave.
  if (joined > 0 && left <= joined) {
    return banked + Math.max(0, now - joined);
  }
  return banked;
}

/** Build the teacher-facing attendance table from raw participant documents. */
export function buildAttendanceRows(
  participants: MeetingParticipant[],
  meetingDurationMs: number,
  now: number = Date.now()
): AttendanceRow[] {
  return participants
    .map((p) => {
      const totalDurationMs = effectiveDurationMs(p, now);
      return {
        userId: p.userId,
        name: p.name,
        email: p.email,
        firstJoinedAt: p.firstJoinedAt,
        leftAt: p.leftAt,
        totalDurationMs,
        reconnects: p.reconnects || 0,
        status: classifyAttendance(totalDurationMs, meetingDurationMs),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Human-readable duration, e.g. "1h 04m" / "12m 30s" / "45s". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
