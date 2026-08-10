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
 *   - Object storage (Backblaze B2) unavailable (wrong key, missing bucket,
 *     unset environment): uploads silently degrade to the server proxy and then
 *     to inline base64, and deletes fail. This is invisible from the app
 *     itself, which is precisely why it belongs here.
 *   - B2 bucket CORS not applied: direct browser uploads fail and every upload
 *     quietly takes the 4 MB-capped proxy path, so large classroom material
 *     uploads start failing with no obvious cause.
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
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  getB2Config,
  isB2Configured,
  missingB2EnvVars,
  listObjects,
  createPresignedDownloadUrl,
} from "@/lib/storage/b2";
import { getB2CorsStatus } from "@/lib/storage/b2-native";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      // S3/B2 failures arrive as long serialized error objects; the leading
      // part carries the actionable message.
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
      if (!isB2Configured()) {
        throw new Error(
          `Backblaze B2 is not configured. Missing: ${missingB2EnvVars().join(", ")}. Uploads will fail.`
        );
      }
      const config = getB2Config()!;

      // Listing exercises the credential, the endpoint and the bucket name in
      // one call — a wrong key, a wrong region or a typo'd bucket all fail
      // here rather than later, in front of a student mid-upload.
      const listing = await listObjects("", 1);
      // Presigning is pure signature maths, but it is the operation every
      // upload and download depends on, so it is worth failing loudly here.
      await createPresignedDownloadUrl("healthcheck/probe", { expiresIn: 60 });

      const objects = typeof listing.KeyCount === "number" ? listing.KeyCount : 0;
      return `${config.bucket} @ ${config.region} — reachable${objects === 0 ? " (empty)" : ""}`;
    }),
  ]);

  // Informational rather than a pass/fail dependency: without CORS the app
  // still uploads, just through the slower proxy path with a 4 MB ceiling.
  // Reading it needs the native B2 API and a key with "listBuckets", so an
  // unreadable value is reported as unknown, never as a failure.
  const origin = req.nextUrl.origin;
  const cors = storage.ok
    ? await getB2CorsStatus(origin).catch(() => ({
        ruleCount: null,
        allowsOrigin: null,
        detail: "CORS status could not be determined.",
      }))
    : { ruleCount: null, allowsOrigin: null, detail: "Skipped — object storage is unavailable." };

  // Counts are cheap aggregation queries, but a failure here must not take the
  // whole health page down — it is diagnostics, not a dependency.
  const count = (build: () => FirebaseFirestore.Query | FirebaseFirestore.CollectionReference) =>
    Promise.resolve()
      .then(() => build().count().get())
      .then((snap) => snap.data().count)
      .catch(() => null);

  const counts = await Promise.all([
    count(() => db.collection("users")),
    count(() => db.collection("users").where("role", "==", "student")),
    count(() => db.collection("users").where("role", "==", "teacher")),
    count(() => db.collection("users").where("approved", "==", false).where("role", "==", "teacher")),
    count(() => db.collection("exams").where("status", "==", "active")),
    count(() => db.collection("classrooms").where("status", "==", "active")),
  ]);

  // Per-module figures. Each is the number an admin actually asks for when a
  // module is reported broken ("are submissions arriving at all?"), and each
  // failure is isolated so one missing composite index cannot blank the page.
  const [
    admins,
    suspendedUsers,
    totalExams,
    draftExams,
    completedSessions,
    flaggedSessions,
    totalAnswers,
    answersAwaitingMarking,
    answersWithFiles,
    ocrCompleted,
    warningScreenshots,
    proctoringEvents,
    classworkItems,
    classroomSubmissions,
    classroomMembers,
    notices,
    publishedResults,
  ] = await Promise.all([
    count(() => db.collection("users").where("role", "==", "admin")),
    count(() => db.collection("users").where("status", "in", ["hold", "suspended"])),
    count(() => db.collection("exams")),
    count(() => db.collection("exams").where("status", "==", "draft")),
    count(() => db.collection("examSessions").where("status", "in", ["submitted", "auto-submitted"])),
    count(() => db.collection("examSessions").where("flagged", "==", true)),
    count(() => db.collection("answers")),
    // Written/scanned work that auto-grading could not score. This is the
    // teacher's real marking queue and the number most worth watching.
    count(() => db.collection("answers").where("gradedBy", "==", "server").where("ocrStatus", "==", "pending_background")),
    count(() => db.collection("answers").where("ocrStatus", "in", ["pending_background", "completed"])),
    count(() => db.collection("answers").where("ocrStatus", "==", "completed")),
    count(() => db.collection("warningScreenshots")),
    count(() => db.collection("proctoringEvents")),
    count(() => db.collection("classroomClasswork")),
    count(() => db.collection("classroomSubmissions")),
    count(() => db.collection("classroomMembers")),
    count(() => db.collection("notices")),
    count(() => db.collection("results").where("isPublished", "==", true)),
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
      // Identifies the exact build an admin is looking at, which is the first
      // question in any "is the fix deployed yet?" conversation.
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      deployedAt: process.env.VERCEL_DEPLOYMENT_ID ? null : undefined,
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    },
    // `configured: true` is a statement of fact here: requireAdmin cannot have
    // succeeded without working credentials.
    adminSdk: { configured: true, firestoreOk: firestore.ok, authOk: adminAuth.ok },
    checks: {
      firestore,
      auth: adminAuth,
      storage,
      // `ok` is true when CORS is applied OR when it could not be read — an
      // unverifiable value is not a fault, and flagging it red would train
      // operators to ignore this row.
      storageCors: {
        ok: cors.allowsOrigin !== false && cors.ruleCount !== 0,
        latencyMs: null,
        detail: cors.detail,
      },
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
    storage: {
      provider: "backblaze-b2",
      configured: isB2Configured(),
      bucket: getB2Config()?.bucket || null,
      region: getB2Config()?.region || null,
      endpoint: getB2Config()?.endpoint || null,
      // The bucket is private; every read goes through a presigned URL minted
      // by /api/storage/download. Stated explicitly because "is the bucket
      // public?" is the first question in any storage incident review.
      publicBucket: false,
      corsRules: cors.ruleCount,
      directUploads: cors.ruleCount === null ? "unknown" : cors.ruleCount > 0 ? "enabled" : "proxy-only",
      missingEnv: missingB2EnvVars(),
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
    // Per-module detail — what each subsystem has actually produced, so a
    // report of "the classroom module is broken" can be checked against
    // whether anything is arriving in it at all.
    modules: {
      accounts: {
        total: counts[0],
        students: counts[1],
        teachers: counts[2],
        admins,
        pendingTeacherApprovals: counts[3],
        restricted: suspendedUsers,
      },
      exams: {
        total: totalExams,
        active: counts[4],
        drafts: draftExams,
        sessionsCompleted: completedSessions,
        sessionsInProgress: sessions.inProgress,
        flaggedSessions,
        submissions: totalAnswers,
        awaitingManualMarking: answersAwaitingMarking,
        publishedResults,
      },
      proctoring: {
        warningScreenshots,
        events: proctoringEvents,
        snapshotsLastFiveMinutes: sessions.snapshotsLastFiveMinutes,
      },
      ai: {
        submissionsWithFiles: answersWithFiles,
        ocrCompleted,
        // The gap between the two is work the background OCR pass has not
        // finished (or never started, if the key is missing).
        ocrPending:
          answersWithFiles !== null && ocrCompleted !== null
            ? Math.max(0, answersWithFiles - ocrCompleted)
            : null,
      },
      classroom: {
        activeClassrooms: counts[5],
        memberships: classroomMembers,
        classworkItems,
        submissions: classroomSubmissions,
      },
      notices: { total: notices },
    },
    // What this deployment can actually do, as opposed to what the code
    // supports. Every one of these is a silent degradation when off.
    features: {
      objectStorage: isB2Configured(),
      directBrowserUploads: cors.ruleCount === null ? null : cors.ruleCount > 0,
      aiOcrAndGrading: !!process.env.GEMINI_API_KEY,
      emailDelivery: smtpConfigured,
      registrationEncryption: !!process.env.REGISTRATION_ENC_KEY,
      liveVideoTurn: !!process.env.NEXT_PUBLIC_TURN_URLS,
      firebaseEmulator: process.env.USE_FIREBASE_EMULATOR === "true",
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
