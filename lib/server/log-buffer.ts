/**
 * In-process ring buffer of recent server log lines, surfaced to admins in
 * System Health (server-only).
 *
 * The problem it solves: on Vercel, `console.error` from an API route goes to a
 * log stream an admin cannot see without a Vercel account and access to the
 * project. When a teacher reports "uploads fail" or "the OCR button does
 * nothing", the actual cause is already in the logs — and completely
 * unreachable by the person being asked to fix it. This keeps the last few
 * hundred lines addressable from inside the app.
 *
 * Deliberate limits, because this is a diagnostic aid and not a logging
 * product:
 *
 *   - Memory only, bounded to MAX_ENTRIES. Nothing is persisted, so it costs
 *     no storage and cannot grow without bound.
 *   - Per-instance. A serverless deployment runs many instances and each has
 *     its own buffer, so this shows "what this instance saw", which the UI
 *     states plainly rather than implying it is the whole picture.
 *   - Redacted on the way in (see `redact`), so a token or key that ends up in
 *     an error message is not re-exposed through an admin screen.
 *
 * For durable, cross-instance logs, the platform's own log drain remains the
 * right tool; this is the on-call view when that is not to hand.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  at: string;
  level: LogLevel;
  scope: string;
  message: string;
}

const MAX_ENTRIES = 400;
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Patterns whose VALUE must never reach an admin screen. Applied to every
 * message before it is stored: an error thrown by a fetch or an SDK routinely
 * carries the URL that failed, and a presigned URL carries a signature.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/(X-Amz-Signature=)[^&\s"']+/gi, "$1[redacted]"],
  [/(X-Amz-Credential=)[^&\s"']+/gi, "$1[redacted]"],
  [/([?&]sig=)[^&\s"']+/gi, "$1[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]"],
  [/("?private_key"?\s*:\s*")[^"]+/gi, "$1[redacted]"],
  [/(K00[0-9A-Za-z+/=]{10,})/g, "[redacted-b2-key]"],
  [/(AIza[0-9A-Za-z_-]{10,})/g, "[redacted-api-key]"],
];

function redact(value: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/**
 * Buffer state hangs off `globalThis` rather than a module-level array.
 *
 * Next.js dev reloads a route's module graph on edit, and each reload would
 * otherwise create a fresh buffer — so the log view would go blank exactly
 * when someone is iterating on the code they are trying to debug.
 */
interface BufferState {
  entries: LogEntry[];
  nextId: number;
  installed: boolean;
  startedAt: string;
  counts: Record<LogLevel, number>;
}

const globalScope = globalThis as typeof globalThis & { __ggLogBuffer?: BufferState };

function state(): BufferState {
  if (!globalScope.__ggLogBuffer) {
    globalScope.__ggLogBuffer = {
      entries: [],
      nextId: 1,
      installed: false,
      startedAt: new Date().toISOString(),
      counts: { debug: 0, info: 0, warn: 0, error: 0 },
    };
  }
  return globalScope.__ggLogBuffer;
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Derives a scope from a message that already starts with a bracketed or
 * slash-prefixed prefix — `[firebase-admin] …`, `API /api/storage/upload …` —
 * which most call sites in this project already use.
 */
function deriveScope(message: string): string {
  const bracketed = /^\[([^\]]{1,40})\]/.exec(message);
  if (bracketed) return bracketed[1];

  const route = /^(?:API\s+)?(\/api\/[\w/[\]-]{1,60})/.exec(message);
  if (route) return route[1];

  return "server";
}

/** Records one line. Safe to call from anywhere on the server. */
export function recordLog(level: LogLevel, args: unknown[]): void {
  const buffer = state();
  const raw = args.map(formatArg).join(" ").trim();
  if (!raw) return;

  const message = redact(raw).slice(0, MAX_MESSAGE_LENGTH);

  buffer.entries.push({
    id: buffer.nextId++,
    at: new Date().toISOString(),
    level,
    scope: deriveScope(message),
    message,
  });
  buffer.counts[level] += 1;

  if (buffer.entries.length > MAX_ENTRIES) {
    buffer.entries.splice(0, buffer.entries.length - MAX_ENTRIES);
  }
}

/**
 * Wraps `console.warn` / `console.error` / `console.info` so existing call
 * sites are captured without touching them, then still forwards to the real
 * console so platform log drains keep working. Idempotent.
 */
export function installLogCapture(): void {
  const buffer = state();
  if (buffer.installed) return;
  buffer.installed = true;

  const levels: Array<[LogLevel, "info" | "warn" | "error"]> = [
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];

  for (const [level, method] of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      try {
        recordLog(level, args);
      } catch {
        // Capturing a log must never be able to break the request that
        // produced it.
      }
      original(...args);
    };
  }
}

export interface LogQuery {
  limit?: number;
  level?: LogLevel | "all";
  /** Only entries newer than this id — lets the UI poll without refetching. */
  sinceId?: number;
  search?: string;
}

export interface LogPage {
  entries: LogEntry[];
  totalBuffered: number;
  capacity: number;
  bufferStartedAt: string;
  counts: Record<LogLevel, number>;
  /** Highest id currently buffered; pass back as `sinceId` to poll. */
  latestId: number;
}

export function readLogs({ limit = 100, level = "all", sinceId, search }: LogQuery = {}): LogPage {
  const buffer = state();
  let entries = buffer.entries;

  if (level !== "all") entries = entries.filter((entry) => entry.level === level);
  if (typeof sinceId === "number") entries = entries.filter((entry) => entry.id > sinceId);
  if (search) {
    const needle = search.toLowerCase();
    entries = entries.filter(
      (entry) =>
        entry.message.toLowerCase().includes(needle) || entry.scope.toLowerCase().includes(needle)
    );
  }

  return {
    // Newest first: an operator reads the top of this list, not the bottom.
    entries: entries.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES))).reverse(),
    totalBuffered: buffer.entries.length,
    capacity: MAX_ENTRIES,
    bufferStartedAt: buffer.startedAt,
    counts: { ...buffer.counts },
    latestId: buffer.nextId - 1,
  };
}

/** Clears the buffer. Exposed so an admin can start a clean reproduction. */
export function clearLogs(): void {
  const buffer = state();
  buffer.entries = [];
  buffer.counts = { debug: 0, info: 0, warn: 0, error: 0 };
  buffer.startedAt = new Date().toISOString();
}
