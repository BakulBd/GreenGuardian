/**
 * Admin-visible deployment health check.
 *
 * Reports whether the server-side capabilities the platform depends on are
 * actually wired up in THIS deployment, and whether they still work. Worth
 * having because the damaging misconfigurations are all silent:
 *
 *   - No Firebase Admin credentials: registration falls back to the REST path
 *     and every admin-only server action (create student, reset password)
 *     returns 503. Nothing on-screen would otherwise say why.
 *   - No SMTP: OTP and password-reset emails are written to the server console
 *     instead of being delivered, so users simply never receive a code.
 *   - Cloud Storage unavailable (disabled billing, missing bucket, absent CORS
 *     policy): uploads silently degrade to inline base64 and every delete
 *     fails in the browser as an opaque CORS/ERR_FAILED. This is invisible from
 *     the app itself, which is precisely why it belongs here.
 *
 * Every probe EXERCISES the dependency rather than only checking that a
 * variable is set — an expired or wrong-project key looks identical to a
 * working one until the moment it fails.
 *
 * Gated by `requireAdmin`, which itself returns 503 when the Admin SDK is
 * missing — the client treats that specific status as the "not configured"
 * answer rather than an error.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getAdminAuth, getAdminDb, getAdminBucket } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

/** A single dependency probe: did it work, how slow was it, and why not. */
interface Probe {
  ok: boolean;
  latencyMs: number | null;
  detail?: string;
}

async function probe(run: () => Promise<string | void>): Promise<Probe> {
  const started = Date.now();
  try {
    const detail = await run();
    return { ok: true, latencyMs: Date.now() - started, detail: detail || undefined };
  } catch (error: any) {
    const message = String(error?.message || error);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      // Storage failures are reported verbatim by GCS as a JSON blob; the
      // first line carries the actionable part.
      detail: message.length > 300 ? `${message.slice(0, 300)}…` : message,
    };
  }
}

/** Exam sessions still in progress right now — the platform's real live load. */
async function countActiveSessions(db: FirebaseFirestore.Firestore) {
  const [inProgress, recentSnapshots] = await Promise.all([
    db.collection("examSessions").where("status", "==", "in-progress").count().get(),
    // Proctoring snapshots in the last five minutes are the best available
    // proxy for "sessions actually streaming", as opposed to sessions left
    // open in an abandoned tab.
    db
      .collection("proctoringSnapshots")
      .where("timestamp", ">=", new Date(Date.now() - 5 * 60_000))
      .count()
      .get()
      .catch(() => null),
  ]);

  return {
    inProgress: inProgress.data().count,
    snapshotsLastFiveMinutes: recentSnapshots ? recentSnapshots.data().count : null,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "view system health");
  if (auth instanceof NextResponse) return auth;

  const smtpConfigured = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.MAIL_FROM
  );

  const db = getAdminDb();

  const [firestore, adminAuth, storage] = await Promise.all([
    probe(async () => {
      await db.collection("settings").doc("global").get();
    }),
    probe(async () => {
      const page = await getAdminAuth().listUsers(1);
      return `${page.users.length ? "accounts present" : "no accounts yet"}`;
    }),
    probe(async () => {
      const bucket = getAdminBucket();
      const [metadata] = await bucket.getMetadata();
      const corsRules = Array.isArray(metadata.cors) ? metadata.cors.length : 0;
      if (corsRules === 0) {
        throw new Error(
          `Bucket ${bucket.name} has no CORS policy. Browser uploads and deletes will be blocked by preflight. Run "npm run storage:cors".`
        );
      }
      return `${bucket.name} — ${corsRules} CORS rule${corsRules === 1 ? "" : "s"}`;
    }),
  ]);

  // Counts are cheap aggregation queries, but a failure here must not take the
  // whole health page down — it is diagnostics, not a dependency.
  const counts = await Promise.all([
    db.collection("users").count().get().then((s) => s.data().count).catch(() => null),
    db.collection("users").where("role", "==", "student").count().get().then((s) => s.data().count).catch(() => null),
    db.collection("users").where("role", "==", "teacher").count().get().then((s) => s.data().count).catch(() => null),
    db.collection("users").where("approved", "==", false).where("role", "==", "teacher").count().get().then((s) => s.data().count).catch(() => null),
    db.collection("exams").where("status", "==", "active").count().get().then((s) => s.data().count).catch(() => null),
    db.collection("classrooms").where("status", "==", "active").count().get().then((s) => s.data().count).catch(() => null),
  ]);

  const sessions = await countActiveSessions(db).catch(() => ({
    inProgress: null,
    snapshotsLastFiveMinutes: null,
  }));

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    runtime: {
      environment: process.env.NODE_ENV || "unknown",
      // Set by Vercel; absent elsewhere. Useful when an admin reports a bug
      // against a preview deployment without realising it.
      deployment: process.env.VERCEL_ENV || "self-hosted",
      region: process.env.VERCEL_REGION || null,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
    },
    // `configured: true` is a statement of fact here: requireAdmin cannot have
    // succeeded without working credentials.
    adminSdk: { configured: true, firestoreOk: firestore.ok, authOk: adminAuth.ok },
    checks: {
      firestore,
      auth: adminAuth,
      storage,
      email: {
        ok: smtpConfigured,
        latencyMs: null,
        detail: smtpConfigured
          ? `Sending as ${process.env.MAIL_FROM}`
          : "SMTP is unset — verification and reset emails are written to the server log instead of being delivered.",
      },
      encryption: {
        ok: !!process.env.REGISTRATION_ENC_KEY,
        latencyMs: null,
        detail: process.env.REGISTRATION_ENC_KEY
          ? undefined
          : "REGISTRATION_ENC_KEY is unset — a fallback key is derived, which invalidates in-flight registrations if the project id changes.",
      },
    },
    email: { configured: smtpConfigured, mode: smtpConfigured ? "smtp" : "console-only" },
    encryption: { configured: !!process.env.REGISTRATION_ENC_KEY },
    database: {
      users: counts[0],
      students: counts[1],
      teachers: counts[2],
      pendingTeachers: counts[3],
      activeExams: counts[4],
      activeClassrooms: counts[5],
    },
    sessions,
    passwordReset: {
      // Self-serve reset works either way (Firebase can send its own mail);
      // admin-initiated reset needs the Admin SDK, which we have here.
      selfServe: true,
      adminInitiated: true,
      branded: smtpConfigured,
    },
  });
}
