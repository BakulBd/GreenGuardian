/**
 * Object-key normalisation and per-prefix authorisation for the B2 bucket.
 *
 * The bucket is private, so nothing is protected by "who can guess the URL" —
 * every read and write goes through an API route, and this module is the one
 * place that decides whether a given caller may touch a given key. It replaces
 * `storage.rules`, and deliberately mirrors the prefixes that file used so the
 * access model did not change along with the storage provider:
 *
 *   avatars/{uid}/…            — only the owner writes; any signed-in user reads
 *   notices/{uid}/…            — teachers/admins publish; any signed-in user reads
 *   exams/…, answers/…         — any signed-in user (students submit answers)
 *   classrooms/…, submissions/ — any signed-in user
 *   proctoring/…               — any signed-in user writes (their own capture)
 *   warningScreenshots/…       — written by the exam client, NEVER deleted from
 *                                the browser: proctoring evidence must survive
 *                                the student it was raised against. Deletion is
 *                                authorised in /api/proctoring/snapshots, which
 *                                checks exam ownership first.
 *
 * Keys are validated rather than trusted: a caller-supplied path reaches
 * S3 verbatim, so traversal segments, absolute paths and control characters
 * are rejected here before they can escape the prefix their role allows.
 */

export type StorageRole = "student" | "teacher" | "admin" | string;

export type StorageOperation = "upload" | "delete";

/** Longest key we will accept. S3 allows 1024 bytes; leave room for a suffix. */
const MAX_KEY_LENGTH = 900;

export interface KeyValidation {
  ok: boolean;
  key: string;
  error?: string;
}

/**
 * Turns a caller-supplied path into a safe object key, or explains why it is
 * not usable. Never throws — callers turn `ok: false` into a 400.
 */
export function normalizeStorageKey(rawPath: unknown): KeyValidation {
  if (typeof rawPath !== "string") {
    return { ok: false, key: "", error: "A storage path is required." };
  }

  // Callers occasionally pass a full URL or a leading slash; take the path.
  let key = rawPath.trim().replace(/^\/+/, "");

  if (!key) return { ok: false, key: "", error: "A storage path is required." };
  if (key.length > MAX_KEY_LENGTH) {
    return { ok: false, key: "", error: "Storage path is too long." };
  }
  // Control characters and backslashes have no legitimate place in a key,
  // and are how a caller would try to smuggle a second path past the
  // prefix check below.
  const hasUnsafeChar = Array.from(key).some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f || char === "\\";
  });
  if (hasUnsafeChar) {
    return { ok: false, key: "", error: "Storage path contains invalid characters." };
  }

  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { ok: false, key: "", error: "Storage path contains invalid path segments." };
  }
  if (segments.length < 2) {
    return { ok: false, key: "", error: "Storage path must include a folder prefix." };
  }

  return { ok: true, key };
}

export interface AuthorizeInput {
  key: string;
  uid: string;
  role: StorageRole;
  operation: StorageOperation;
}

export interface AuthorizeResult {
  allowed: boolean;
  error?: string;
}

const STAFF: StorageRole[] = ["teacher", "admin"];

/**
 * Decides whether `uid` (with `role`) may upload to / delete the given key.
 * Assumes the key has already been through `normalizeStorageKey`.
 */
export function authorizeStorageKey({ key, uid, role, operation }: AuthorizeInput): AuthorizeResult {
  const segments = key.split("/");
  const prefix = segments[0];
  const owner = segments[1];
  const isStaff = STAFF.includes(role);

  const deny = (error: string): AuthorizeResult => ({ allowed: false, error });

  switch (prefix) {
    case "avatars":
      // Your own picture, nobody else's.
      return owner === uid || isStaff
        ? { allowed: true }
        : deny("You can only change your own profile picture.");

    case "notices":
      if (!isStaff) return deny("Only teachers and admins can attach files to notices.");
      // An admin may post on behalf of the platform; a teacher writes under
      // their own uid so attachments stay attributable.
      return owner === uid || role === "admin"
        ? { allowed: true }
        : deny("Notice attachments must be uploaded under your own account.");

    case "exams":
      // Teachers upload papers; students upload answers under exams/{id}/answers.
      if (operation === "delete" && !isStaff) {
        return deny("Only teachers and admins can delete exam files.");
      }
      return { allowed: true };

    case "answers":
    case "submissions":
    case "classrooms":
    case "assignments":
    case "uploads":
      return { allowed: true };

    case "proctoring":
      // Deleting live-session snapshots is a staff action; students only write.
      return operation === "upload" || isStaff
        ? { allowed: true }
        : deny("Only teachers and admins can delete proctoring snapshots.");

    case "warningScreenshots":
      // Uploads come from the student's own exam client. Deletes are refused
      // here outright — /api/proctoring/snapshots performs them after it has
      // verified the caller owns the exam the evidence belongs to.
      return operation === "upload"
        ? { allowed: true }
        : deny("Proctoring evidence cannot be deleted directly.");

    default:
      return deny(`Uploads to "${prefix}/" are not allowed.`);
  }
}

/**
 * Content-Disposition-safe filename derived from a key. Used so a downloaded
 * attachment keeps a sensible name instead of the timestamped key.
 */
export function filenameFromKey(key: string): string {
  const last = key.split("/").pop() || "download";
  return last.replace(/[^\w.\-]+/g, "_").slice(0, 200) || "download";
}
