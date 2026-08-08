/**
 * Public batch -> section list for the registration form.
 *
 * Necessarily public and necessarily server-side: someone signing up has no
 * Firebase session, and `firestore.rules` gates `batches`/`sections` reads
 * behind `isAuthenticated()`. Without this the form would fall back to the
 * hardcoded defaults and could offer a section the institution doesn't have.
 *
 * Exposes nothing sensitive — the names of an institution's intake cohorts are
 * printed on its own timetable.
 */
import { NextRequest, NextResponse } from "next/server";
import { listPlacements } from "@/lib/server/enrollment";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = checkRateLimit(`placements:${getClientIp(req)}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const placements = await listPlacements();
    return NextResponse.json(
      { success: true, placements },
      // Short cache: the catalog changes rarely, but a newly created section
      // should show up for the next person who signs up without a redeploy.
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
    );
  } catch (error: any) {
    console.error("[placements] Failed:", error);
    return NextResponse.json({ success: true, placements: [] });
  }
}
