/**
 * Admin roster rebuild.
 *
 * Re-derives `teacher_student_mapping` and `users.assignedTeacherIds` for every
 * student (or a named subset) from live assignment and classroom data.
 *
 * This replaces the client-side backfill, which had to make one round trip per
 * student from the browser and only worked at all while signed in as an admin.
 * Running it server-side with Admin credentials also means it can repair
 * students the client path could never touch.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { syncStudentRoster, syncAllStudentRosters } from "@/lib/server/roster";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// A full rebuild walks every student sequentially; the default 15s serverless
// budget is not enough for a real cohort.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "rebuild the student roster");
  if (auth instanceof NextResponse) return auth;

  const rate = checkRateLimit(`roster-sync:${auth.uid}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "A rebuild was just run. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => ({}) as any);
  const studentIds: string[] | undefined = Array.isArray(body?.studentIds)
    ? body.studentIds.filter((id: unknown) => typeof id === "string" && id)
    : undefined;

  try {
    if (studentIds && studentIds.length > 0) {
      if (studentIds.length > 500) {
        return NextResponse.json(
          { success: false, error: "Please sync at most 500 students at a time." },
          { status: 400 }
        );
      }
      let linksCreated = 0;
      let linksRemoved = 0;
      let studentsCovered = 0;
      for (const id of studentIds) {
        const r = await syncStudentRoster(id);
        linksCreated += r.gained.length;
        linksRemoved += r.lost.length;
        if (r.teacherIds.length > 0) studentsCovered++;
      }
      return NextResponse.json({
        success: true,
        studentsChecked: studentIds.length,
        studentsCovered,
        uncovered: studentIds.length - studentsCovered,
        linksCreated,
        linksRemoved,
      });
    }

    const result = await syncAllStudentRosters();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[roster-sync] Failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Roster rebuild failed." },
      { status: 500 }
    );
  }
}
