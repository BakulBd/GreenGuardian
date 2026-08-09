import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser } from "@/lib/server/api-auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_STUDENTS_PER_CALL = 500;

/**
 * Recomputes `users/{studentId}.assignedTeacherIds` — the field every notice
 * and exam visibility rule trusts — from ALL live sources of teacher access:
 *
 *   1. `teacher_student_mapping` rows (admin Course/Batch/Section assignment)
 *   2. `classroomMembers` rows (classroom join-by-code or teacher-added)
 *
 * This MUST run server-side. The client cannot do it:
 *   - a student may not read `teacher_student_mapping` (rules scope reads to
 *     the owning teacher/admin), so a client-side union would silently drop
 *     every admin assignment and REVOKE access on join;
 *   - a teacher may not write another user's `users/{id}` doc at all;
 *   - `assignedTeacherIds` is deliberately not self-writable by students,
 *     since a student who could set it would grant themselves any teacher's
 *     communications.
 *
 * Deriving the full set fresh each time (rather than incrementing) is what
 * makes leaving one classroom safe when the student still has an admin
 * assignment or another classroom with the same teacher.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuthedUser(req);
    if (authResult instanceof NextResponse) return authResult;

    const rate = checkRateLimit(`classroom-sync:${authResult.uid}:${getClientIp(req)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many sync requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    const studentIds: string[] = Array.isArray(body?.studentIds) ? body.studentIds.filter(Boolean) : [];
    if (studentIds.length === 0) {
      return NextResponse.json({ success: false, error: "studentIds is required." }, { status: 400 });
    }
    if (studentIds.length > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json({ success: false, error: `At most ${MAX_STUDENTS_PER_CALL} students per request.` }, { status: 400 });
    }

    const db = getAdminDb();

    // Authorize: the caller may sync only themselves (self-join), or — if
    // they are a teacher/admin — students in a classroom they actually own.
    const callerRole = authResult.role;
    const isSelfOnly = studentIds.length === 1 && studentIds[0] === authResult.uid;

    if (!isSelfOnly && callerRole !== "teacher" && callerRole !== "admin") {
      return NextResponse.json({ success: false, error: "You may only sync your own classroom access." }, { status: 403 });
    }

    const unique = Array.from(new Set(studentIds));
    let synced = 0;
    let skipped = 0;

    for (const studentId of unique) {
      const [mappingsSnap, membershipsSnap] = await Promise.all([
        db.collection("teacher_student_mapping").where("studentId", "==", studentId).get(),
        db.collection("classroomMembers").where("studentId", "==", studentId).get(),
      ]);

      const teacherIds = Array.from(
        new Set(
          [
            ...mappingsSnap.docs.map((d) => d.data().teacherId),
            ...membershipsSnap.docs.map((d) => d.data().teacherId),
          ].filter(Boolean)
        )
      );

      // A teacher may only sync students who share a classroom with them —
      // stops one teacher from touching another teacher's roster.
      if (!isSelfOnly && callerRole === "teacher" && !teacherIds.includes(authResult.uid)) {
        skipped++;
        continue;
      }

      try {
        // `set(..., { merge: true })` rather than `update()`: a bulk enrolment
        // can name a student whose profile document was deleted (or was never
        // created, for an Auth-only account). `update()` throws NOT_FOUND on
        // the first such id and abandoned the whole batch, so one stale roster
        // row could block access for every other student in the request.
        await db.collection("users").doc(studentId).set(
          { assignedTeacherIds: teacherIds, updatedAt: new Date() },
          { merge: true }
        );
        synced++;
      } catch (writeError) {
        console.warn(`[classroom/sync-access] Could not sync ${studentId}:`, writeError);
        skipped++;
      }
    }

    return NextResponse.json({ success: true, synced, skipped, total: unique.length });
  } catch (error: any) {
    console.error("API /api/classroom/sync-access error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error." }, { status: 500 });
  }
}
