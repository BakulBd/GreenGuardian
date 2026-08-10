"use client";

/**
 * Standalone System Health module.
 *
 * This used to be one card buried in Admin → Settings, which is the wrong
 * place for it twice over: Settings is where you go to *change* configuration,
 * and a health panel nested inside it is only ever seen by accident. It is now
 * a first-class destination in the admin navigation, and it answers the
 * question an operator actually has during an incident — "is anything down,
 * and who is affected right now" — rather than only "is SMTP set".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Database,
  HardDrive,
  Cloud,
  Lock,
  Mail,
  KeyRound,
  ShieldCheck,
  Server,
  Users,
  Radio,
  AlertTriangle,
} from "lucide-react";
import { authedFetch } from "@/lib/utils/api-client";

interface Check {
  ok: boolean;
  latencyMs: number | null;
  detail?: string;
}

interface HealthPayload {
  success: boolean;
  checkedAt: string;
  runtime: {
    environment: string;
    deployment: string;
    region: string | null;
    nodeVersion: string;
    uptimeSeconds: number;
    projectId: string | null;
  };
  checks: {
    firestore: Check;
    auth: Check;
    storage: Check;
    storageCors: Check;
    email: Check;
    encryption: Check;
  };
  storage?: {
    provider: string;
    configured: boolean;
    bucket: string | null;
    region: string | null;
    endpoint: string | null;
    publicBucket: boolean;
    corsRules: number | null;
    directUploads: "enabled" | "proxy-only" | "unknown";
    missingEnv: string[];
  };
  database: {
    users: number | null;
    students: number | null;
    teachers: number | null;
    pendingTeachers: number | null;
    activeExams: number | null;
    activeClassrooms: number | null;
  };
  sessions: {
    inProgress: number | null;
    snapshotsLastFiveMinutes: number | null;
  };
}

/** Shown when the Admin SDK itself is unavailable — the route 503s in that case. */
const ADMIN_SDK_DOWN =
  "The server could not verify this request with Firebase Admin credentials. " +
  "Set FIREBASE_SERVICE_ACCOUNT in the hosting environment (or provide serviceAccountKey.json locally) and redeploy.";

const REFRESH_MS = 30_000;

function CheckRow({
  icon: Icon,
  label,
  check,
  okText,
}: {
  icon: any;
  label: string;
  check: Check;
  okText: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        check.ok ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${check.ok ? "text-green-600" : "text-red-600"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          {check.ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" />
          )}
          {check.latencyMs !== null && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {check.latencyMs} ms
            </Badge>
          )}
        </div>
        <p
          className={`text-xs mt-0.5 leading-relaxed break-words ${
            check.ok ? "text-green-800" : "text-red-800"
          }`}
        >
          {check.detail || (check.ok ? okText : "Unavailable.")}
        </p>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | null; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center gap-2 text-gray-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">
        {value === null ? "—" : value.toLocaleString()}
      </p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Survives across refreshes so an auto-refresh never blanks the page.
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await authedFetch<HealthPayload>("/api/admin/health", {
        fallbackError: "Could not reach the health endpoint.",
      });
      if (!mounted.current) return;
      setHealth(data);
      setError(null);
    } catch (err: any) {
      if (!mounted.current) return;
      // A 503 from this route means the Admin SDK has no credentials, which is
      // itself the answer to the first health question rather than an error
      // the operator should retry past.
      setError(/not configured|temporarily unavailable/i.test(err?.message || "") ? ADMIN_SDK_DOWN : err?.message);
    } finally {
      if (mounted.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const checks = health?.checks;
  const allOk = checks
    ? checks.firestore.ok &&
      checks.auth.ok &&
      checks.storage.ok &&
      // Missing bucket CORS is degraded, not down: uploads still complete
      // through the server proxy, but only up to 4 MB.
      (checks.storageCors?.ok ?? true) &&
      checks.email.ok &&
      checks.encryption.ok
    : false;

  return (
    <DashboardLayout role="admin">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="h-7 w-7 text-indigo-600" />
              System Health
            </h1>
            <p className="text-gray-600 mt-1">
              Live diagnostics for this deployment. Refreshes every 30 seconds.
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-red-600" />
            <div>
              <p className="font-medium">Health check unavailable</p>
              <p className="mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {loading && !health ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Running diagnostics…
          </div>
        ) : health ? (
          <>
            {/* Overall verdict — the one line an operator reads first. */}
            <Card className={allOk ? "border-green-300" : "border-amber-300"}>
              <CardContent className="pt-6 flex items-center gap-4">
                {allOk ? (
                  <CheckCircle2 className="h-10 w-10 text-green-600 shrink-0" />
                ) : (
                  <AlertTriangle className="h-10 w-10 text-amber-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-gray-900">
                    {allOk ? "All systems operational" : "Degraded — some dependencies are unavailable"}
                  </p>
                  <p className="text-sm text-gray-500">
                    Checked {new Date(health.checkedAt).toLocaleTimeString()} · project{" "}
                    <span className="font-mono">{health.runtime.projectId || "unknown"}</span> ·{" "}
                    {health.runtime.deployment} · Node {health.runtime.nodeVersion} · up{" "}
                    {formatUptime(health.runtime.uptimeSeconds)}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Dependency probes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-indigo-600" />
                  Dependencies
                </CardTitle>
                <CardDescription>
                  Each of these is exercised on every check, not just read from configuration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <CheckRow
                  icon={Database}
                  label="Firestore (database connectivity)"
                  check={checks!.firestore}
                  okText="Reachable and responding."
                />
                <CheckRow
                  icon={KeyRound}
                  label="Firebase Auth (Admin SDK)"
                  check={checks!.auth}
                  okText="Credentials valid; user administration available."
                />
                <CheckRow
                  icon={HardDrive}
                  label="Object storage — Backblaze B2 (uploads, proctoring evidence)"
                  check={checks!.storage}
                  okText="Private bucket reachable; presigned URLs can be issued."
                />
                {checks!.storageCors && (
                  <CheckRow
                    icon={Cloud}
                    label="Direct browser uploads (bucket CORS)"
                    check={checks!.storageCors}
                    okText="Uploads go straight to B2."
                  />
                )}
                <CheckRow
                  icon={Mail}
                  label="Email delivery (SMTP)"
                  check={checks!.email}
                  okText="Verification and reset emails are being sent."
                />
                <CheckRow
                  icon={KeyRound}
                  label="Registration encryption key"
                  check={checks!.encryption}
                  okText="Configured."
                />
              </CardContent>
            </Card>

            {/* Object storage — where every uploaded file actually lives */}
            {health.storage && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <HardDrive className="h-5 w-5 text-cyan-600" />
                    Object storage
                  </CardTitle>
                  <CardDescription>
                    Exam papers, answers, classroom materials, avatars and proctoring evidence.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
                    <div className="flex justify-between gap-3 border-b border-dashed pb-1.5">
                      <dt className="text-gray-500">Provider</dt>
                      <dd className="font-medium text-gray-900">Backblaze B2 (S3 API)</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-dashed pb-1.5">
                      <dt className="text-gray-500">Bucket</dt>
                      <dd className="font-mono text-xs text-gray-900 truncate">
                        {health.storage.bucket || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-dashed pb-1.5">
                      <dt className="text-gray-500">Region</dt>
                      <dd className="font-mono text-xs text-gray-900">{health.storage.region || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-dashed pb-1.5">
                      <dt className="text-gray-500">Upload path</dt>
                      <dd className="font-medium text-gray-900">
                        {health.storage.directUploads === "enabled"
                          ? "Direct (presigned)"
                          : health.storage.directUploads === "proxy-only"
                            ? "Server proxy (4 MB cap)"
                            : "Unknown"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5 text-cyan-700" />
                    <p className="text-xs leading-relaxed text-cyan-900">
                      The bucket is private. Files are never served from a public URL — every link goes
                      through <span className="font-mono">/api/storage/download</span>, which mints a
                      short-lived presigned URL. B2 credentials stay on the server and are never sent to
                      the browser.
                    </p>
                  </div>

                  {health.storage.missingEnv.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
                      <p className="text-xs leading-relaxed text-red-900">
                        Missing environment variables:{" "}
                        <span className="font-mono">{health.storage.missingEnv.join(", ")}</span>. Set
                        them in the hosting environment and redeploy — uploads cannot work without them.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Live activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-5 w-5 text-rose-600" />
                  Active sessions
                </CardTitle>
                <CardDescription>Exams in progress across the platform right now.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Stat
                  icon={Radio}
                  label="Exams in progress"
                  value={health.sessions.inProgress}
                  hint="Sessions not yet submitted or cancelled"
                />
                <Stat
                  icon={Activity}
                  label="Streaming now"
                  value={health.sessions.snapshotsLastFiveMinutes}
                  hint="Proctoring snapshots in the last 5 minutes"
                />
              </CardContent>
            </Card>

            {/* Database contents */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-5 w-5 text-slate-600" />
                  Database
                </CardTitle>
                <CardDescription>Record counts, read live from Firestore.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <Stat icon={Users} label="Total users" value={health.database.users} />
                <Stat icon={Users} label="Students" value={health.database.students} />
                <Stat
                  icon={Users}
                  label="Teachers"
                  value={health.database.teachers}
                  hint={
                    health.database.pendingTeachers
                      ? `${health.database.pendingTeachers} awaiting approval`
                      : undefined
                  }
                />
                <Stat icon={Activity} label="Active exams" value={health.database.activeExams} />
                <Stat icon={Database} label="Active classrooms" value={health.database.activeClassrooms} />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
