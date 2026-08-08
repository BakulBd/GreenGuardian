/**
 * Server-side validation of a student's academic placement (batch + section).
 *
 * Registration accepts a batch and section from an untrusted form, and those
 * two values decide which teacher's exams and notices the account will receive.
 * They therefore have to be checked against the real catalog on the server —
 * a client-side dropdown is a convenience, not a constraint.
 *
 * When the catalog has not been seeded into Firestore yet, the static defaults
 * are used instead, so a fresh deployment can still register students. This
 * mirrors what `useAcademicCatalog` shows the user in that state.
 */
import { getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";
import { DEFAULT_BATCHES, DEFAULT_SECTIONS } from "@/lib/academics/catalog";

export interface Placement {
  batch: string;
  section: string;
}

export type PlacementCheck =
  | { ok: true; placement: Placement }
  | { ok: false; error: string };

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Batch name (lowercased key) -> its display name and section display names,
 * also keyed lowercase. Lookups are case-insensitive; the stored value keeps
 * the catalog's own casing so every profile agrees on "D1" vs "d1".
 */
type PlacementIndex = Map<string, { display: string; sections: Map<string, string> }>;

function fallbackIndex(): PlacementIndex {
  const map: PlacementIndex = new Map();
  for (const b of DEFAULT_BATCHES) {
    map.set(b.name.toLowerCase(), {
      display: b.name,
      sections: new Map(DEFAULT_SECTIONS.map((s) => [s.name.toLowerCase(), s.name])),
    });
  }
  return map;
}

/**
 * The set of valid (batch, section) pairs.
 *
 * Returns `null` when the catalog can't be read at all, so the caller can tell
 * "no such section" apart from "we couldn't check" and avoid rejecting a valid
 * signup because Firestore hiccuped.
 */
async function loadValidPlacements(): Promise<PlacementIndex | null> {
  if (!isAdminSdkConfigured()) return fallbackIndex();

  try {
    const db = getAdminDb();
    const [batchesSnap, sectionsSnap] = await Promise.all([
      db.collection("batches").get(),
      db.collection("sections").get(),
    ]);

    // Unseeded catalog — every deployment starts here.
    if (batchesSnap.empty || sectionsSnap.empty) return fallbackIndex();

    const batchNameById = new Map<string, string>();
    batchesSnap.docs.forEach((d) => batchNameById.set(d.id, norm(d.data().name)));

    const map: PlacementIndex = new Map();
    batchesSnap.docs.forEach((d) => {
      const name = norm(d.data().name);
      if (name) map.set(name.toLowerCase(), { display: name, sections: new Map() });
    });

    sectionsSnap.docs.forEach((d) => {
      const data = d.data();
      const batchName = norm(data.batchName) || batchNameById.get(norm(data.batchId)) || "";
      const sectionName = norm(data.name);
      if (!batchName || !sectionName) return;
      const key = batchName.toLowerCase();
      if (!map.has(key)) map.set(key, { display: batchName, sections: new Map() });
      map.get(key)!.sections.set(sectionName.toLowerCase(), sectionName);
    });

    // A batch with no sections can't be registered into; drop it so the form
    // never offers a dead end.
    for (const [key, entry] of map) {
      if (entry.sections.size === 0) map.delete(key);
    }

    return map.size > 0 ? map : fallbackIndex();
  } catch (error) {
    console.warn("[enrollment] Could not read the catalog:", error);
    return null;
  }
}

/**
 * Validates a submitted batch/section pair and returns it in its canonical
 * catalog casing, so profiles don't end up with "d1" in one row and "D1" in
 * another — every downstream match is by name.
 */
export async function validatePlacement(input: {
  batch?: unknown;
  section?: unknown;
}): Promise<PlacementCheck> {
  const batch = norm(input.batch);
  const section = norm(input.section);

  if (!batch) return { ok: false, error: "Please select your batch." };
  if (!section) return { ok: false, error: "Please select your section." };

  const valid = await loadValidPlacements();
  if (!valid) {
    // Couldn't verify. Accept the values rather than block signup — an admin
    // can correct a placement, but a rejected registration is a dead end.
    console.warn("[enrollment] Skipping placement validation (catalog unreadable).");
    return { ok: true, placement: { batch, section } };
  }

  const entry = valid.get(batch.toLowerCase());
  if (!entry) {
    return { ok: false, error: `"${batch}" is not a recognised batch. Please pick one from the list.` };
  }
  const sectionDisplay = entry.sections.get(section.toLowerCase());
  if (!sectionDisplay) {
    return {
      ok: false,
      error: `Section "${section}" does not exist in batch ${entry.display}. Please pick one from the list.`,
    };
  }

  // Canonical casing, so every downstream name comparison agrees.
  return { ok: true, placement: { batch: entry.display, section: sectionDisplay } };
}

/**
 * Batch -> sections, for the public registration form.
 *
 * The form needs this from the server: `batches`/`sections` are readable only
 * by authenticated users under firestore.rules, and someone signing up is by
 * definition not authenticated yet.
 */
export async function listPlacements(): Promise<{ batch: string; sections: string[] }[]> {
  const valid = await loadValidPlacements();
  if (!valid) return [];
  return Array.from(valid.values())
    .map((entry) => ({
      batch: entry.display,
      sections: Array.from(entry.sections.values()).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.batch.localeCompare(b.batch, undefined, { numeric: true }));
}
