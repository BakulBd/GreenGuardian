/**
 * Green Room — server-side meeting authorization (Admin SDK, server-only).
 *
 * Sits on top of `requireAuthedUser` (lib/server/api-auth.ts): that answers
 * "who is calling and is their account in good standing", this answers "what
 * are they inside THIS meeting". The two are separate on purpose — a teacher
 * with a perfectly valid session is still only a `participant` in a meeting
 * they do not own.
 *
 * Meeting role is always re-derived from Firestore here. It is never taken
 * from the request body, and never inferred from the app-level role.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError, AuthedUser } from "@/lib/server/api-auth";
import { MEETINGS, PARTICIPANTS, SECRETS, participantId } from "@/lib/greenroom/constants";
import { DEFAULT_MEETING_SETTINGS } from "@/lib/greenroom/constants";
import { normalizePasscode } from "@/lib/greenroom/codes";
import { decryptSecret } from "@/lib/otp";
import {
  Meeting,
  MeetingParticipant,
  MeetingRole,
  MeetingSettings,
} from "@/lib/greenroom/types";

export interface MeetingContext {
  user: AuthedUser;
  meetingId: string;
  meeting: Meeting;
  /** The caller's authority inside this meeting, read from Firestore. */
  role: MeetingRole;
  /** The caller's participant document, when one exists yet. */
  participant: MeetingParticipant | null;
  settings: MeetingSettings;
}

/** Settings with defaults filled in — old documents may predate a new toggle. */
export function resolveSettings(raw: any): MeetingSettings {
  return { ...DEFAULT_MEETING_SETTINGS, ...(raw || {}) };
}

/**
 * Hash a passcode for storage in `greenRoomSecrets`.
 *
 * Salted per meeting so two meetings sharing a passcode do not share a hash,
 * and so a stolen hash cannot be replayed against another meeting. A meeting
 * passcode is a short-lived, low-value, deliberately-shared secret (every
 * invitee gets it), so SHA-256 with a per-meeting salt is proportionate —
 * the real gate is the eligibility check and rate limit in the join route.
 */
export function hashPasscode(passcode: string, meetingId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${meetingId}:${normalizePasscode(passcode)}`)
    .digest("hex");
}

/** Constant-time comparison so a wrong passcode leaks no timing signal. */
export function passcodeMatches(
  submitted: string,
  storedHash: string,
  meetingId: string
): boolean {
  const candidate = hashPasscode(submitted, meetingId);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(String(storedHash || ""), "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Read the stored passcode hash. Server-only — rules deny all client access. */
export async function readPasscodeHash(meetingId: string): Promise<string | null> {
  const snap = await getAdminDb().collection(SECRETS).doc(meetingId).get();
  return snap.exists ? String(snap.data()?.passcodeHash || "") || null : null;
}

/**
 * Recover the plaintext passcode for a meeting — for the HOST only.
 *
 * A hash alone would be more conservative, but the host has to be able to
 * re-read the passcode every time they re-share an invite, and forcing a
 * regeneration (invalidating links already sent to students) is worse than
 * storing it reversibly. So `greenRoomSecrets` keeps both: the hash for
 * constant-time verification on join, and an AES-256-GCM ciphertext for
 * display. The document is unreadable by every client (`allow read: if
 * false`), and this function is only ever called behind a host check.
 *
 * Returns null for meetings created before this field existed, or if the
 * server encryption key has changed — callers offer to regenerate instead.
 */
export async function readPasscode(meetingId: string): Promise<string | null> {
  const snap = await getAdminDb().collection(SECRETS).doc(meetingId).get();
  const encrypted = snap.exists ? String(snap.data()?.passcodeEncrypted || "") : "";
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch (error) {
    console.warn("[greenroom] Could not decrypt passcode (key rotated?):", error);
    return null;
  }
}

/**
 * Determine a caller's meeting role from stored state.
 *
 * The meeting's owning teacher is always the host, even before their
 * participant document exists — otherwise a teacher who opens their own room
 * first would arrive with no authority to admit anyone. Admins are treated as
 * hosts so they can moderate/close a room in an emergency.
 */
export function deriveRole(
  meeting: Pick<Meeting, "teacherId">,
  user: Pick<AuthedUser, "uid" | "role">,
  participant: MeetingParticipant | null
): MeetingRole {
  if (meeting.teacherId === user.uid) return "host";
  if (user.role === "admin") return "host";
  if (participant?.role === "host" || participant?.role === "cohost") {
    return participant.role;
  }
  return "participant";
}

async function loadMeeting(meetingId: string): Promise<Meeting | null> {
  const snap = await getAdminDb().collection(MEETINGS).doc(meetingId).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as any), id: snap.id } as Meeting;
}

/** Look a meeting up by its human `123-456-789` code. */
export async function findMeetingByCode(meetingCode: string): Promise<Meeting | null> {
  const snap = await getAdminDb()
    .collection(MEETINGS)
    .where("meetingCode", "==", meetingCode)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { ...(doc.data() as any), id: doc.id } as Meeting;
}

export async function loadParticipant(
  meetingId: string,
  userId: string
): Promise<MeetingParticipant | null> {
  const snap = await getAdminDb()
    .collection(PARTICIPANTS)
    .doc(participantId(meetingId, userId))
    .get();
  if (!snap.exists) return null;
  return { ...(snap.data() as any), id: snap.id } as MeetingParticipant;
}

/**
 * Authenticate the caller and resolve their standing in a meeting.
 *
 * Returns a `NextResponse` on any failure, which the route returns as-is.
 */
export async function requireMeetingContext(
  req: NextRequest,
  meetingId: string
): Promise<MeetingContext | NextResponse> {
  const user = await requireAuthedUser(req);
  if (user instanceof NextResponse) return user;

  if (!meetingId) return jsonError("meetingId is required.", 400);

  const meeting = await loadMeeting(meetingId);
  if (!meeting) return jsonError("Meeting not found.", 404);

  const participant = await loadParticipant(meetingId, user.uid);
  const role = deriveRole(meeting, user, participant);

  return {
    user,
    meetingId,
    meeting,
    role,
    participant,
    settings: resolveSettings(meeting.settings),
  };
}

/**
 * As `requireMeetingContext`, but refuses anyone who is not a moderator.
 *
 * Fine-grained "which action may this moderator perform" is decided by
 * `canPerform()` from the shared permission matrix — this only filters out
 * plain participants early so routes do not repeat that check.
 */
export async function requireMeetingModerator(
  req: NextRequest,
  meetingId: string
): Promise<MeetingContext | NextResponse> {
  const context = await requireMeetingContext(req, meetingId);
  if (context instanceof NextResponse) return context;

  if (context.role !== "host" && context.role !== "cohost") {
    return jsonError("Only the host or a co-host can do that.", 403);
  }
  return context;
}

/**
 * Is this student allowed into this meeting at all?
 *
 * A valid passcode proves the student was *invited*; this proves they belong
 * to the class. Both are required, so a leaked code circulating outside the
 * cohort still does not get a stranger into the room.
 *
 * Eligibility is satisfied by any of:
 *   - the meeting has no course/classroom scoping (open to the teacher's
 *     assigned students);
 *   - the student is a member of the meeting's classroom;
 *   - the student is assigned to the meeting's owning teacher.
 */
export async function isStudentEligible(
  meeting: Meeting,
  user: AuthedUser
): Promise<boolean> {
  const db = getAdminDb();

  // Assigned to this teacher — the same field notices and exams already trust.
  const assignedTeacherIds: string[] = Array.isArray(user.data?.assignedTeacherIds)
    ? user.data.assignedTeacherIds
    : [];
  if (assignedTeacherIds.includes(meeting.teacherId)) return true;

  // Member of the classroom this meeting belongs to.
  if (meeting.classroomId) {
    const memberSnap = await db
      .collection("classroomMembers")
      .doc(`${meeting.classroomId}_${user.uid}`)
      .get();
    if (memberSnap.exists) return true;
  }

  // Explicit roster link to the teacher (admin Course/Batch/Section mapping).
  const mappingSnap = await db
    .collection("teacher_student_mapping")
    .where("studentId", "==", user.uid)
    .where("teacherId", "==", meeting.teacherId)
    .limit(1)
    .get();
  if (!mappingSnap.empty) return true;

  return false;
}
