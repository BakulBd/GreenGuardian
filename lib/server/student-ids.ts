/**
 * Batch-wise auto-sequential student IDs (server-only).
 *
 * Replaces `STU-${Date.now().slice(-6)}`, which was neither sequential nor
 * unique: two students created in the same millisecond collided outright, and
 * the resulting codes carried no information — you could not tell which batch
 * a student belonged to, or how many were in it, by looking at one.
 *
 * The format is `{batch}-{NNN}` (e.g. `241-007`), restarting at 1 for each
 * batch. Students with no batch fall back to a shared `GG-{NNNN}` sequence so
 * the function always returns something usable.
 *
 * Allocation runs inside a Firestore transaction against a per-batch counter
 * document. That is what makes it safe: two administrators creating students
 * at the same moment serialise on the counter and get consecutive numbers,
 * where a "read the highest existing code and add one" approach would hand
 * both of them the same number.
 */
import type { Firestore } from "firebase-admin/firestore";

const COUNTERS = "studentCodeCounters";
const FALLBACK_PREFIX = "GG";

/** Firestore document ids may not contain "/" and may not be "." or "..". */
function counterId(batch: string): string {
  const clean = batch.trim().replace(/[/\\]/g, "-").replace(/\s+/g, "-");
  return clean || "__unbatched__";
}

function format(prefix: string, sequence: number, width: number): string {
  return `${prefix}-${String(sequence).padStart(width, "0")}`;
}

/**
 * Reserves and returns the next student ID for `batch`.
 *
 * @param seedFrom Optional highest sequence already in use, for the first
 *   allocation in a batch that already has manually-assigned codes. Passing it
 *   stops a fresh counter from re-issuing numbers that already exist.
 */
export async function allocateStudentCode(
  db: Firestore,
  batch: string,
  seedFrom = 0
): Promise<string> {
  const trimmedBatch = batch.trim();
  const prefix = trimmedBatch || FALLBACK_PREFIX;
  const width = trimmedBatch ? 3 : 4;
  const ref = db.collection(COUNTERS).doc(counterId(trimmedBatch));

  const sequence = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.count) || 0 : 0;
    const next = Math.max(current, seedFrom) + 1;
    tx.set(
      ref,
      { batch: trimmedBatch, prefix, count: next, updatedAt: new Date() },
      { merge: true }
    );
    return next;
  });

  return format(prefix, sequence, width);
}

/**
 * Highest sequence number already issued in a batch, read from the existing
 * student records.
 *
 * Used to seed a counter the first time a batch is allocated from, so
 * introducing this feature to a project that already has hand-entered codes
 * does not start re-issuing `241-001`. Only codes matching this batch's own
 * `{batch}-{NNN}` shape are considered — an unrelated legacy code cannot drag
 * the sequence to an arbitrary number.
 */
export async function highestExistingSequence(db: Firestore, batch: string): Promise<number> {
  const trimmedBatch = batch.trim();
  if (!trimmedBatch) return 0;

  const snap = await db
    .collection("users")
    .where("role", "==", "student")
    .where("batch", "==", trimmedBatch)
    .get();

  const pattern = new RegExp(`^${trimmedBatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);

  let highest = 0;
  for (const doc of snap.docs) {
    const match = pattern.exec(String(doc.data()?.studentCode || ""));
    if (match) highest = Math.max(highest, Number(match[1]) || 0);
  }
  return highest;
}

/**
 * The common path: allocate the next ID for a batch, seeding the counter from
 * existing records the first time that batch is used.
 */
export async function nextStudentCode(db: Firestore, batch: string): Promise<string> {
  const ref = db.collection(COUNTERS).doc(counterId(batch.trim()));
  const existing = await ref.get();

  // Only scan the roster when the counter is brand new — after that the
  // counter is authoritative and the extra query would be pure cost.
  const seedFrom = existing.exists ? 0 : await highestExistingSequence(db, batch);

  return allocateStudentCode(db, batch, seedFrom);
}
