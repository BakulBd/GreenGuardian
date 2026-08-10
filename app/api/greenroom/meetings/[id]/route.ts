/**
 * Green Room — single meeting endpoint.
 *
 *   GET    — meeting detail. Hosts additionally receive the passcode and the
 *            attendance roster; participants receive neither.
 *   PATCH  — edit a scheduled meeting (host only).
 *   DELETE — cancel a meeting (host only). Soft-cancels by default so students
 *            keep the record; `?purge=true` removes it outright.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { jsonError } from "@/lib/server/api-auth";
import {
  requireMeetingContext,
  readPasscode,
  resolveSettings,
} from "@/lib/server/greenroom-auth";
import { MEETINGS, PARTICIPANTS, SECRETS } from "@/lib/greenroom/constants";
import { buildAttendanceRows, toMillis } from "@/lib/greenroom/codes";
import { MeetingParticipant, MeetingSettings } from "@/lib/greenroom/types";

export const dynamic = "force-dynamic";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 8 * 60;

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

/** How long the meeting actually ran — the basis for attendance percentages. */
function meetingElapsedMs(meeting: any): number {
  const started = toMillis(meeting.startedAt);
  if (!started) return 0;
  const ended = toMillis(meeting.endedAt) || Date.now();
  return Math.max(0, ended - started);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await requireMeetingContext(req, id);
    if (context instanceof NextResponse) return context;

    const isModerator = context.role === "host" || context.role === "cohost";
    const payload: Record<string, any> = {
      success: true,
      meeting: serialize({ ...context.meeting, settings: context.settings }),
      role: context.role,
    };

    // The passcode and the attendance roster are host-facing data. A student
    // hitting this endpoint for their own meeting gets neither.
    if (isModerator) {
      const db = getAdminDb();
      const [passcode, participantsSnap] = await Promise.all([
        context.role === "host" ? readPasscode(id) : Promise.resolve(null),
        db.collection(PARTICIPANTS).where("meetingId", "==", id).get(),
      ]);

      const participants = participantsSnap.docs.map(
        (d) => ({ ...(d.data() as any), id: d.id }) as MeetingParticipant
      );

      if (passcode) payload.passcode = passcode;
      payload.attendance = serialize(
        buildAttendanceRows(participants, meetingElapsedMs(context.meeting))
      );
      payload.participants = serialize(participants);
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("API /api/greenroom/meetings/[id] GET error:", error);
    return jsonError(error?.message || "Failed to load the meeting.", 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await requireMeetingContext(req, id);
    if (context instanceof NextResponse) return context;

    // Editing the meeting itself (title, time, policy) is the owner's right —
    // a co-host may moderate a live room but not rewrite the class schedule.
    if (context.role !== "host") {
      return jsonError("Only the host can edit this meeting.", 403);
    }
    if (context.meeting.status === "ended") {
      return jsonError("This meeting has already ended and can no longer be edited.", 409);
    }

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid request body.", 400);

    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return jsonError("A class title is required.", 400);
      if (title.length > MAX_TITLE_LENGTH) {
        return jsonError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`, 400);
      }
      updates.title = title;
    }

    if (body.description !== undefined) {
      updates.description = String(body.description).trim().slice(0, MAX_DESCRIPTION_LENGTH);
    }

    if (body.durationMinutes !== undefined) {
      const duration = Number(body.durationMinutes);
      if (!Number.isFinite(duration) || duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
        return jsonError(
          `Duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`,
          400
        );
      }
      updates.durationMinutes = duration;
    }

    if (body.scheduledStart !== undefined) {
      const parsed = new Date(String(body.scheduledStart));
      if (Number.isNaN(parsed.getTime())) {
        return jsonError("A valid start date and time is required.", 400);
      }
      updates.scheduledStart = parsed;
    }

    if (body.courseId !== undefined) updates.courseId = String(body.courseId || "");
    if (body.courseName !== undefined) updates.courseName = String(body.courseName || "");
    if (body.classroomId !== undefined) updates.classroomId = String(body.classroomId || "");

    // Settings are merged key-by-key against the known shape, so an unexpected
    // key in the request body can never reach the document.
    if (body.settings !== undefined) {
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
      updates.settings = next;
    }

    await getAdminDb().collection(MEETINGS).doc(id).update(updates);

    const updated = await getAdminDb().collection(MEETINGS).doc(id).get();
    return NextResponse.json({
      success: true,
      meeting: serialize({ ...(updated.data() as any), id, settings: resolveSettings(updated.data()?.settings) }),
    });
  } catch (error: any) {
    console.error("API /api/greenroom/meetings/[id] PATCH error:", error);
    return jsonError(error?.message || "Failed to update the meeting.", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await requireMeetingContext(req, id);
    if (context instanceof NextResponse) return context;

    if (context.role !== "host") {
      return jsonError("Only the host can cancel this meeting.", 403);
    }

    const db = getAdminDb();
    const purge = req.nextUrl.searchParams.get("purge") === "true";

    if (!purge) {
      // Soft cancel: students keep seeing that the class was called off rather
      // than having it silently vanish from their list.
      await db.collection(MEETINGS).doc(id).update({
        status: "cancelled",
        updatedAt: new Date(),
      });
      return NextResponse.json({ success: true, cancelled: true });
    }

    // Hard delete: remove the meeting, its secret, and its participants.
    // Firestore has no cascade, so this mirrors deleteClassroom()'s approach.
    const participantsSnap = await db.collection(PARTICIPANTS).where("meetingId", "==", id).get();
    const batch = db.batch();
    participantsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection(SECRETS).doc(id));
    batch.delete(db.collection(MEETINGS).doc(id));
    await batch.commit();

    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error("API /api/greenroom/meetings/[id] DELETE error:", error);
    return jsonError(error?.message || "Failed to cancel the meeting.", 500);
  }
}
