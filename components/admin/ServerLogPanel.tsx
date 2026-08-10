"use client";

/**
 * Live view of recent server log lines, for admins.
 *
 * Reads `/api/admin/logs`, which is backed by an in-process ring buffer. It is
 * honest about its limits — per-instance, memory-only, bounded — because a log
 * view that quietly shows a fraction of the traffic is worse than none: an
 * operator would conclude "no errors" from an empty list that simply belongs
 * to a different instance.
 *
 * Follow mode polls rather than streams. A log tail is not worth an open
 * connection per admin on a serverless deployment, and the polling interval is
 * generous enough that a forgotten open tab is not a cost problem.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollText, RefreshCw, Trash2, Play, Pause, AlertTriangle, Search } from "lucide-react";
import { authedFetch } from "@/lib/utils/api-client";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  id: number;
  at: string;
  level: LogLevel;
  scope: string;
  message: string;
}

interface LogPayload {
  success: boolean;
  entries: LogEntry[];
  totalBuffered: number;
  capacity: number;
  bufferStartedAt: string;
  counts: Record<LogLevel, number>;
  latestId: number;
  instance: { deployment: string; region: string | null; uptimeSeconds: number };
}

const POLL_MS = 10_000;

const LEVEL_STYLES: Record<LogLevel, string> = {
  error: "text-red-700 bg-red-50 border-red-200",
  warn: "text-amber-700 bg-amber-50 border-amber-200",
  info: "text-sky-700 bg-sky-50 border-sky-200",
  debug: "text-gray-600 bg-gray-50 border-gray-200",
};

const FILTERS: Array<{ value: LogLevel | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

export default function ServerLogPanel() {
  const [data, setData] = useState<LogPayload | null>(null);
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const [following, setFollowing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "200", level });
      if (search.trim()) params.set("search", search.trim());

      const payload = await authedFetch<LogPayload>(`/api/admin/logs?${params.toString()}`, {
        fallbackError: "Could not read the server logs.",
      });
      if (!mounted.current) return;
      setData(payload);
      setError(null);
    } catch (err: any) {
      if (mounted.current) setError(err?.message || "Could not read the server logs.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [level, search]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!following) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [following, load]);

  const handleClear = async () => {
    if (!confirm("Clear the buffered log lines on this server instance?")) return;
    try {
      await authedFetch("/api/admin/logs", { method: "DELETE", fallbackError: "Could not clear the logs." });
      load();
    } catch (err: any) {
      setError(err?.message || "Could not clear the logs.");
    }
  };

  const counts = data?.counts;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-violet-600" />
              Server logs
            </CardTitle>
            <CardDescription>
              Warnings and errors raised by this server instance, newest first.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFollowing((value) => !value)}>
              {following ? <Pause className="h-4 w-4 mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
              {following ? "Following" : "Paused"}
            </Button>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              variant={level === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setLevel(filter.value)}
            >
              {filter.label}
              {filter.value !== "all" && counts ? (
                <span className="ml-1.5 opacity-70">{counts[filter.value as LogLevel] ?? 0}</span>
              ) : null}
            </Button>
          ))}

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by text or scope (e.g. /api/storage)"
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
            <p>{error}</p>
          </div>
        )}

        <div className="rounded-lg border bg-gray-950 max-h-[420px] overflow-y-auto">
          {data && data.entries.length > 0 ? (
            <ul className="divide-y divide-gray-800">
              {data.entries.map((entry) => (
                <li key={entry.id} className="px-3 py-2 font-mono text-[11px] leading-relaxed">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-500">{formatTime(entry.at)}</span>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${LEVEL_STYLES[entry.level]}`}>
                      {entry.level}
                    </Badge>
                    <span className="text-violet-300">{entry.scope}</span>
                  </div>
                  <p className="mt-0.5 text-gray-200 break-words whitespace-pre-wrap">{entry.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-8 text-center text-xs text-gray-400">
              {loading ? "Reading logs…" : "Nothing buffered yet on this instance."}
            </p>
          )}
        </div>

        {data && (
          <p className="text-[11px] leading-relaxed text-gray-500">
            {data.totalBuffered} of {data.capacity} lines buffered since{" "}
            {formatTime(data.bufferStartedAt)} · {data.instance.deployment}
            {data.instance.region ? ` · ${data.instance.region}` : ""} · in-memory and
            per-instance, so a deployment running several instances shows only what this one
            handled. Use the hosting provider&apos;s log drain for a complete, durable record.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
