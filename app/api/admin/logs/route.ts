/**
 * Recent server log lines, for admins.
 *
 * Backed by the in-process ring buffer in `lib/server/log-buffer.ts`. See that
 * file for what this is and — importantly — what it is not: per-instance,
 * memory-only, bounded, and redacted. It exists so the person asked to fix
 * "uploads are failing" can read the actual error without a hosting-dashboard
 * login.
 *
 * Admin-only. Server logs routinely name users, exams and file paths, and the
 * stack traces describe the shape of the system.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { readLogs, clearLogs, installLogCapture, type LogLevel } from "@/lib/server/log-buffer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEVELS: Array<LogLevel | "all"> = ["all", "debug", "info", "warn", "error"];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read server logs");
  if (auth instanceof NextResponse) return auth;

  // Capture is installed lazily on first admin read as well as at route load,
  // so a deployment that has not yet served a logging route still works.
  installLogCapture();

  const params = req.nextUrl.searchParams;
  const rawLevel = params.get("level") || "all";
  const level = (LEVELS.includes(rawLevel as LogLevel) ? rawLevel : "all") as LogLevel | "all";

  const limit = Number(params.get("limit") || 100);
  const sinceIdParam = params.get("sinceId");

  const page = readLogs({
    limit: Number.isFinite(limit) ? limit : 100,
    level,
    sinceId: sinceIdParam ? Number(sinceIdParam) : undefined,
    search: params.get("search")?.trim() || undefined,
  });

  return NextResponse.json({
    success: true,
    ...page,
    // Stated so the UI can be honest about the scope of what it is showing.
    instance: {
      deployment: process.env.VERCEL_ENV || "self-hosted",
      region: process.env.VERCEL_REGION || null,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req, "clear server logs");
  if (auth instanceof NextResponse) return auth;

  clearLogs();
  return NextResponse.json({ success: true });
}
