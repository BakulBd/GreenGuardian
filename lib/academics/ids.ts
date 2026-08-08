/**
 * Deterministic identifiers for the academic catalog.
 *
 * Batches and sections use IDs derived from their names rather than random
 * Firestore IDs. Three reasons this matters here:
 *
 *   1. Student profiles store `batch` and `section` as NAMES ("241", "D1").
 *      Teacher assignments store both ids and names. With random ids those two
 *      representations drift apart the moment an admin creates a catalog entry,
 *      and every id-based lookup silently stops matching. Deriving the id from
 *      the name keeps them permanently in sync.
 *   2. Seeding and migration become idempotent for free — writing the same
 *      catalog twice overwrites the same documents instead of duplicating them.
 *   3. The existing production data already behaves this way (it falls back to
 *      the static defaults, where id === name), so this codifies reality rather
 *      than changing it.
 *
 * Section names repeat across batches, so a section's identity must include its
 * batch: `241_D1`.
 */

/** Firestore document IDs may not contain "/" and may not be "." or "..". */
function sanitize(value: string): string {
  return value
    .trim()
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+$/, "-");
}

/** Canonical document ID for a batch, derived from its name. */
export function batchIdFor(batchName: string): string {
  return sanitize(batchName);
}

/** Canonical document ID for a section within a batch. */
export function sectionIdFor(batchName: string, sectionName: string): string {
  return `${sanitize(batchName)}_${sanitize(sectionName)}`;
}

/**
 * Normalizes a batch/section value that may be either an id or a name.
 *
 * Legacy documents (and the static defaults) used the name as the id, and some
 * older `teacher_assignments` rows stored a raw section name in `sectionId`.
 * Callers comparing against catalog data should run both sides through this.
 */
export function normalizeName(value: string | undefined | null): string {
  return (value || "").trim();
}

/** True when two batch/section names refer to the same thing. */
export function sameName(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return left !== "" && left.toLowerCase() === right.toLowerCase();
}
