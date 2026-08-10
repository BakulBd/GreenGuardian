/**
 * Green Room — meeting collection endpoint.
 *
 *   GET  — meetings visible to the caller (a teacher's own; a student's
 *          eligible ones).
 *   POST — schedule a meeting, or start an instant one.
 *
 * Meetings are created here rather than client-side because creation mints the
 * passcode and decides the owning teacher. A client-side create would let a
 * student write a meeting document naming themselves as `teacherId`, which is
 * host authority (see `deriveRole`). `firestore.rules` therefore denies all
 * client writes to `greenRoomMeetings`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { hashPasscode, resolveSettings } from "@/lib/server/greenroom-auth";
import { encryptSecret } from "@/lib/otp";
import {
  MEETINGS,
  SECRETS,
  DEFAULT_MEETING_SETTINGS,
} from "@/lib/greenroom/constants";
import { generateMeetingCode, generatePasscode } from "@/lib/greenroom/codes";
import { Meeting, MeetingSettings } from "@/lib/greenroom/types";

export const dynamic = "force-dynamic";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 8 * 60;
const LIST_LIMIT = 100;

/** Firestore Timestamp/Date → ISO string, so the client gets plain JSON. */
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

/** Allocate a meeting code that is not already taken. */
async function allocateMeetingCode(db: FirebaseFirestore.Firestore): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateMeetingCode();
    const existing = await db
      .collection(MEETINGS)
      .where("meetingCode", "==", code)
      .limit(1)
      .get();
    if (existing.empty) return code;
  }
  throw new Error("Could not allocate a unique meeting ID. Please try again.");
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const db = getAdminDb();
    const scope = req.nextUrl.searchParams.get("scope") || "";

    let meetings: Meeting[] = [];

    if (auth.role === "teacher" || (auth.role === "admin" && scope === "mine")) {
      const snap = await db
        .collection(MEETINGS)
        .where("teacherId", "==", auth.uid)
        .limit(LIST_LIMIT)
        .get();
      meetings = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
    } else if (auth.role === "admin") {
      const snap = await db.collection(MEETINGS).limit(LIST_LIMIT).get();
      meetings = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
    } else {
      // Students: every meeting from a teacher they are assigned to. Filtering
      // by `assignedTeacherIds` mirrors how exams and notices already scope
      // student visibility, so a student never sees another cohort's classes.
      const assignedTeacherIds: string[] = Array.isArray(auth.data?.assignedTeacherIds)
        ? auth.data.assignedTeacherIds.filter(Boolean)
        : [];
      if (assignedTeacherIds.length === 0) {
        return NextResponse.json({ success: true, meetings: [] });
      }
      // Firestore `in` accepts at most 30 values.
      const collected: Meeting[] = [];
      for (let i = 0; i < assignedTeacherIds.length; i += 30) {
        const chunk = assignedTeacherIds.slice(i, i + 30);
        const snap = await db
          .collection(MEETINGS)
          .where("teacherId", "in", chunk)
          .limit(LIST_LIMIT)
          .get();
        snap.docs.forEach((d) => collected.push({ ...(d.data() as any), id: d.id }));
      }
      // Cancelled classes are noise on a student's list.
      meetings = collected.filter((m) => m.status !== "cancelled");
    }

    // Sorted in memory: the student path unions several queries, so a Firestore
    // orderBy would not produce a single ordered result anyway.
    const sorted = meetings.sort((a, b) => {
      const at = new Date(serialize(a.scheduledStart) || 0).getTime();
      const bt = new Date(serialize(b.scheduledStart) || 0).getTime();
      return bt - at;
    });

    return NextResponse.json({
      success: true,
      meetings: sorted.map((m) => serialize({ ...m, settings: resolveSettings(m.settings) })),
    });
  } catch (error: any) {
    console.error("API /api/greenroom/meetings GET error:", error);
    return jsonError(error?.message || "Failed to load meetings.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req, ["teacher", "admin"], "Only teachers can create a Green Room class.");
    if (auth instanceof NextResponse) return auth;

    const rate = checkRateLimit(`greenroom-create:${auth.uid}:${getClientIp(req)}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many meetings created. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid request body.", 400);

    const title = String(body.title || "").trim();
    if (!title) return jsonError("A class title is required.", 400);
    if (title.length > MAX_TITLE_LENGTH) {
      return jsonError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`, 400);
    }

    const description = String(body.description || "").trim().slice(0, MAX_DESCRIPTION_LENGTH);

    const durationMinutes = Number(body.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
      return jsonError(
        `Duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`,
        400
      );
    }

    // `instant: true` starts now; otherwise a valid future-ish start is required.
    const instant = body.instant === true;
    let scheduledStart: Date;
    if (instant) {
      scheduledStart = new Date();
    } else {
      const parsed = new Date(String(body.scheduledStart || ""));
      if (Number.isNaN(parsed.getTime())) {
        return jsonError("A valid start date and time is required.", 400);
      }
      scheduledStart = parsed;
    }

    // Only known setting keys are accepted, so a crafted body cannot inject
    // extra fields into the meeting document.
    const requested = (body.settings || {}) as Partial<MeetingSettings>;
    const settings: MeetingSettings = {
      waitingRoom: Boolean(requested.waitingRoom ?? DEFAULT_MEETING_SETTINGS.waitingRoom),
      joinBeforeHost: Boolean(requested.joinBeforeHost ?? DEFAULT_MEETING_SETTINGS.joinBeforeHost),
      allowParticipantScreenShare: Boolean(
        requested.allowParticipantScreenShare ?? DEFAULT_MEETING_SETTINGS.allowParticipantScreenShare
      ),
      allowChat: Boolean(requested.allowChat ?? DEFAULT_MEETING_SETTINGS.allowChat),
      allowReactions: Boolean(requested.allowReactions ?? DEFAULT_MEETING_SETTINGS.allowReactions),
      allowParticipantUnmute: Boolean(
        requested.allowParticipantUnmute ?? DEFAULT_MEETING_SETTINGS.allowParticipantUnmute
      ),
      audioOnly: Boolean(requested.audioOnly ?? DEFAULT_MEETING_SETTINGS.audioOnly),
      locked: false,
    };

    const db = getAdminDb();
    const meetingCode = await allocateMeetingCode(db);
    const passcode = generatePasscode();
    const now = new Date();

    const meetingRef = db.collection(MEETINGS).doc();
    const meeting = {
      title,
      description,
      meetingCode,
      teacherId: auth.uid,
      teacherName: auth.name || "Teacher",
      courseId: body.courseId ? String(body.courseId) : undefined,
      courseName: body.courseName ? String(body.courseName) : undefined,
      classroomId: body.classroomId ? String(body.classroomId) : undefined,
      status: instant ? "live" : "scheduled",
      settings,
      scheduledStart,
      durationMinutes,
      startedAt: instant ? now : undefined,
      activeParticipantCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Strip undefined — Firestore rejects it.
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(meeting)) if (v !== undefined) clean[k] = v;

    // The passcode hash goes in a separate, client-unreadable document. Both
    // writes commit together so a meeting can never exist without its secret.
    const batch = db.batch();
    batch.set(meetingRef, clean);
    batch.set(db.collection(SECRETS).doc(meetingRef.id), {
      meetingId: meetingRef.id,
      // Hash verifies a join in constant time; the ciphertext lets the host
      // re-read the passcode when re-sharing the invite. See readPasscode().
      passcodeHash: hashPasscode(passcode, meetingRef.id),
      passcodeEncrypted: encryptSecret(passcode),
      createdAt: now,
    });
    await batch.commit();

    return NextResponse.json({
      success: true,
      meeting: serialize({ ...clean, id: meetingRef.id }),
      // Returned exactly once, to the creating teacher, so they can share it.
      // It is never stored in readable form, so this is the only way to see it.
      passcode,
    });
  } catch (error: any) {
    console.error("API /api/greenroom/meetings POST error:", error);
    return jsonError(error?.message || "Failed to create the meeting.", 500);
  }
}
