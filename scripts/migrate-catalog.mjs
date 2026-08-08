#!/usr/bin/env node
/**
 * Migrate the academic catalog to the global Batch -> Section model.
 *
 *   node scripts/migrate-catalog.mjs          # dry run — reports, changes nothing
 *   node scripts/migrate-catalog.mjs --apply  # perform the migration
 *
 * What it does
 * ------------
 *  1. Builds the canonical catalog from every batch/section name actually in
 *     use — student profiles, teacher assignments, existing catalog documents,
 *     and the built-in defaults — so nothing currently referenced is dropped.
 *  2. Writes `batches/{name}` and `sections/{batch}_{section}` with
 *     deterministic IDs (lib/academics/ids.ts).
 *  3. Deletes legacy per-course batch/section documents, which duplicated every
 *     batch under every course and left a student's single `batch` value unable
 *     to say which document it meant.
 *  4. Normalizes `teacher_assignments`: `batchId`/`sectionId` are rewritten to
 *     the canonical IDs, and `batchName`/`sectionName` are filled in where an
 *     older row only stored one of the pair.
 *  5. Backfills `sections[]` on student profiles from the scalar `section`, so
 *     the array and scalar forms agree.
 *  6. Rebuilds every student's roster (`teacher_student_mapping` +
 *     `assignedTeacherIds`), which is what makes notices and exams reach them.
 *
 * Safe to run more than once — every step derives its result from current data.
 */
import { cert, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------- setup ----
function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) };
  }
  const file =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "serviceAccountKey.json");
  if (fs.existsSync(file)) {
    const sa = JSON.parse(fs.readFileSync(file, "utf8"));
    return { credential: cert(sa), projectId: sa.project_id };
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { credential: applicationDefault() };
  }
  console.error("No Firebase Admin credentials found. See scripts/doctor.mjs for options.");
  process.exit(1);
}

const db = getFirestore(initializeApp(credential()));

// Mirrors lib/academics/ids.ts — kept in sync deliberately; this script must be
// runnable standalone with plain node, without the TypeScript build.
const sanitize = (v) => String(v).trim().replace(/[/\\]/g, "-").replace(/\s+/g, "-").replace(/^\.+$/, "-");
const batchIdFor = (b) => sanitize(b);
const sectionIdFor = (b, s) => `${sanitize(b)}_${sanitize(s)}`;

const DEFAULT_BATCHES = ["231", "232", "241", "242", "250", "251", "252", "260", "261", "262"];
const DEFAULT_SECTIONS = ["D1", "D2", "D3", "D4", "D5"];

const h = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
const norm = (v) => String(v ?? "").trim();

let writes = 0;
const MAX_BATCH = 400;
let pending = db.batch();
let pendingCount = 0;
async function queue(fn) {
  writes++;
  if (!APPLY) return;
  fn(pending);
  if (++pendingCount >= MAX_BATCH) {
    await pending.commit();
    pending = db.batch();
    pendingCount = 0;
  }
}
async function flush() {
  if (APPLY && pendingCount > 0) {
    await pending.commit();
    pending = db.batch();
    pendingCount = 0;
  }
}

console.log(APPLY ? "MODE: APPLY (writing changes)" : "MODE: DRY RUN (no writes)");

// ------------------------------------------------- 1. collect real usage ----
h("1. Discovering batches and sections in use");

const [usersSnap, assignmentsSnap, batchesSnap, sectionsSnap] = await Promise.all([
  db.collection("users").get(),
  db.collection("teacher_assignments").get(),
  db.collection("batches").get(),
  db.collection("sections").get(),
]);

/** batchName -> Set(sectionName) */
const catalog = new Map();
const addPair = (batch, section) => {
  const b = norm(batch);
  if (!b) return;
  if (!catalog.has(b)) catalog.set(b, new Set());
  const s = norm(section);
  if (s) catalog.get(b).add(s);
};

for (const b of DEFAULT_BATCHES) for (const s of DEFAULT_SECTIONS) addPair(b, s);

let studentsWithPlacement = 0;
usersSnap.docs.forEach((d) => {
  const u = d.data();
  if (norm(u.role) !== "student") return;
  if (!norm(u.batch)) return;
  studentsWithPlacement++;
  const sections =
    Array.isArray(u.sections) && u.sections.length > 0 ? u.sections : u.section ? [u.section] : [];
  if (sections.length === 0) addPair(u.batch, "");
  sections.forEach((s) => addPair(u.batch, s));
});

assignmentsSnap.docs.forEach((d) => {
  const a = d.data();
  addPair(a.batchName || a.batchId, a.sectionName || a.sectionId);
});

// Existing catalog documents, including legacy per-course ones.
const batchNameById = new Map();
batchesSnap.docs.forEach((d) => {
  const name = norm(d.data().name);
  if (name) {
    batchNameById.set(d.id, name);
    addPair(name, "");
  }
});
sectionsSnap.docs.forEach((d) => {
  const s = d.data();
  const batchName = norm(s.batchName) || batchNameById.get(norm(s.batchId)) || "";
  if (batchName) addPair(batchName, s.name);
});

const totalSections = Array.from(catalog.values()).reduce((n, set) => n + set.size, 0);
console.log(
  `  ${catalog.size} batches, ${totalSections} sections in use ` +
    `(${studentsWithPlacement} students carry a placement)`
);

// ------------------------------------------------ 2. write canonical docs ----
h("2. Writing canonical batch/section documents");

const canonicalBatchIds = new Set();
const canonicalSectionIds = new Set();
const now = new Date();

for (const [batchName, sections] of Array.from(catalog.entries()).sort()) {
  const bId = batchIdFor(batchName);
  canonicalBatchIds.add(bId);
  await queue((b) =>
    b.set(db.collection("batches").doc(bId), { name: batchName, updatedAt: now, createdAt: now }, { merge: true })
  );

  for (const sectionName of Array.from(sections).sort()) {
    const sId = sectionIdFor(batchName, sectionName);
    canonicalSectionIds.add(sId);
    await queue((b) =>
      b.set(
        db.collection("sections").doc(sId),
        { batchId: bId, batchName, name: sectionName, updatedAt: now, createdAt: now },
        { merge: true }
      )
    );
  }
}
await flush();
console.log(`  ${canonicalBatchIds.size} batch docs, ${canonicalSectionIds.size} section docs`);

// ---------------------------------------------- 3. remove legacy catalog ----
h("3. Removing legacy per-course catalog documents");

let legacyBatches = 0;
let legacySections = 0;
for (const d of batchesSnap.docs) {
  if (!canonicalBatchIds.has(d.id)) {
    legacyBatches++;
    await queue((b) => b.delete(d.ref));
  }
}
for (const d of sectionsSnap.docs) {
  if (!canonicalSectionIds.has(d.id)) {
    legacySections++;
    await queue((b) => b.delete(d.ref));
  }
}
await flush();
console.log(
  legacyBatches + legacySections === 0
    ? "  None. ✓"
    : `  ${legacyBatches} batch + ${legacySections} section documents removed`
);

// -------------------------------------------- 4. normalize assignments ----
h("4. Normalizing teacher_assignments batch/section identifiers");

let fixedAssignments = 0;
for (const d of assignmentsSnap.docs) {
  const a = d.data();
  // Older rows sometimes stored the NAME in the *Id field, and sometimes only
  // one of the id/name pair. Resolve both from whichever is present.
  const batchName = norm(a.batchName) || batchNameById.get(norm(a.batchId)) || norm(a.batchId);
  const sectionName = norm(a.sectionName) || norm(a.sectionId);
  if (!batchName || !sectionName) {
    console.log(`  SKIP ${d.id}: cannot resolve batch/section (${JSON.stringify({ batchId: a.batchId, sectionId: a.sectionId })})`);
    continue;
  }

  const patch = {};
  const bId = batchIdFor(batchName);
  const sId = sectionIdFor(batchName, sectionName);
  if (norm(a.batchId) !== bId) patch.batchId = bId;
  if (norm(a.sectionId) !== sId) patch.sectionId = sId;
  if (norm(a.batchName) !== batchName) patch.batchName = batchName;
  if (norm(a.sectionName) !== sectionName) patch.sectionName = sectionName;

  if (Object.keys(patch).length > 0) {
    fixedAssignments++;
    console.log(`  ${a.teacherName || a.teacherId} ${batchName}/${sectionName}: ${JSON.stringify(patch)}`);
    patch.updatedAt = now;
    await queue((b) => b.update(d.ref, patch));
  }
}
await flush();
console.log(fixedAssignments === 0 ? "  Already canonical. ✓" : `  ${fixedAssignments} assignment(s) normalized`);

// ---------------------------------- 4b. repair invalid studentIds pins ----
h("4b. Repairing invalid individual-student pins");

/**
 * An assignment may be pinned to a subset of its group via `studentIds`. A pin
 * naming students who are NOT in the assignment's own course+batch+section is
 * not a narrower assignment — it is a broken one that matches nobody, and every
 * real student in that section loses their teacher on the next roster sync.
 *
 * These pins were produced by updateTeacherAssignment(), which passed
 * `undefined` to clear the field; because an absent key in a Firestore update
 * means "leave unchanged", a pin survived every later edit, including edits
 * that moved the assignment to a different batch or section.
 */
let repairedPins = 0;
const freshAssignmentsForPins = await db.collection("teacher_assignments").get();
for (const d of freshAssignmentsForPins.docs) {
  const a = d.data();
  const pin = Array.isArray(a.studentIds) ? a.studentIds.filter(Boolean) : [];
  if (pin.length === 0) continue;

  const batchName = norm(a.batchName);
  const sectionName = norm(a.sectionName);
  const inGroup = usersSnap.docs
    .filter((s) => {
      const u = s.data();
      if (norm(u.role) !== "student") return false;
      if (norm(u.batch) !== batchName) return false;
      const secs =
        Array.isArray(u.sections) && u.sections.length > 0 ? u.sections : u.section ? [u.section] : [];
      return secs.map(norm).includes(sectionName);
    })
    .map((s) => s.id);

  const valid = pin.filter((id) => inGroup.includes(id));

  if (valid.length === pin.length) continue; // pin is entirely valid

  repairedPins++;
  if (valid.length === 0) {
    console.log(
      `  ${a.teacherName || a.teacherId} ${batchName}/${sectionName}: pin names ${pin.length} student(s), ` +
        `NONE of them in this section (${inGroup.length} students are). Clearing the pin — ` +
        "the assignment covers the whole section."
    );
    await queue((b) => b.update(d.ref, { studentIds: FieldValue.delete(), updatedAt: now }));
  } else {
    console.log(
      `  ${a.teacherName || a.teacherId} ${batchName}/${sectionName}: dropping ${pin.length - valid.length} ` +
        "pinned student(s) who are not in this section."
    );
    await queue((b) => b.update(d.ref, { studentIds: valid, updatedAt: now }));
  }
}
await flush();
console.log(repairedPins === 0 ? "  No invalid pins. ✓" : `  ${repairedPins} assignment pin(s) repaired`);

// ------------------------------------------ 5. backfill student sections ----
h("5. Backfilling students' sections[] from section");

let fixedStudents = 0;
for (const d of usersSnap.docs) {
  const u = d.data();
  if (norm(u.role) !== "student") continue;
  const section = norm(u.section);
  const sections = Array.isArray(u.sections) ? u.sections.filter(Boolean) : [];
  if (section && !sections.includes(section)) {
    fixedStudents++;
    await queue((b) => b.update(d.ref, { sections: [section], updatedAt: now }));
  }
}
await flush();
console.log(fixedStudents === 0 ? "  Already consistent. ✓" : `  ${fixedStudents} student(s) backfilled`);

// ------------------------------------------------- 6. rebuild the roster ----
h("6. Rebuilding student rosters");

if (!APPLY) {
  console.log("  (dry run — skipped)");
} else {
  // Inlined rather than importing lib/server/roster.ts, which is TypeScript and
  // resolves "@/..." paths only inside Next.js. Same matching rules.
  const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
  const freshAssignments = await db.collection("teacher_assignments").get();
  const students = usersSnap.docs.filter((d) => norm(d.data().role) === "student");

  let created = 0;
  let removed = 0;
  let covered = 0;

  for (const studentDoc of students) {
    const u = studentDoc.data();
    const studentSections =
      Array.isArray(u.sections) && u.sections.length > 0 ? u.sections : u.section ? [u.section] : [];

    const matches = freshAssignments.docs.filter((ad) => {
      const a = ad.data();
      if (!eq(u.batch, a.batchName)) return false;
      if (!a.sectionName || !studentSections.some((s) => eq(s, a.sectionName))) return false;
      if (Array.isArray(u.courses) && u.courses.length > 0) {
        const enrolled = u.courses.some((c) =>
          typeof c === "string" ? eq(c, a.courseId) : eq(c?.courseId, a.courseId) || eq(c?.id, a.courseId) || eq(c?.code, a.courseId)
        );
        if (!enrolled) return false;
      }
      if (Array.isArray(a.studentIds) && a.studentIds.length > 0 && !a.studentIds.includes(studentDoc.id)) {
        return false;
      }
      return true;
    });

    const existing = await db.collection("teacher_student_mapping").where("studentId", "==", studentDoc.id).get();
    const shouldHave = new Set(matches.map((m) => m.id));
    const has = new Set(existing.docs.map((e) => e.data().assignmentId).filter(Boolean));

    const wb = db.batch();
    for (const m of matches.filter((x) => !has.has(x.id))) {
      const a = m.data();
      const row = {
        teacherId: a.teacherId,
        studentId: studentDoc.id,
        studentName: u.name || "",
        courseId: a.courseId,
        courseName: a.courseName || "",
        batchId: a.batchId || "",
        batchName: a.batchName || "",
        sectionId: a.sectionId || "",
        sectionName: a.sectionName || "",
        assignmentId: m.id,
        createdAt: now,
        updatedAt: now,
      };
      if (u.studentCode) row.studentCode = u.studentCode;
      wb.set(db.collection("teacher_student_mapping").doc(), row);
      created++;
    }
    for (const e of existing.docs.filter((x) => !x.data().assignmentId || !shouldHave.has(x.data().assignmentId))) {
      wb.delete(e.ref);
      removed++;
    }
    await wb.commit();

    const [maps, members] = await Promise.all([
      db.collection("teacher_student_mapping").where("studentId", "==", studentDoc.id).get(),
      db.collection("classroomMembers").where("studentId", "==", studentDoc.id).get(),
    ]);
    const teacherIds = Array.from(
      new Set([...maps.docs, ...members.docs].map((x) => x.data().teacherId).filter(Boolean))
    );
    await studentDoc.ref.set({ assignedTeacherIds: teacherIds, updatedAt: now }, { merge: true });
    if (teacherIds.length > 0) covered++;
  }

  console.log(
    `  ${students.length} students: ${created} link(s) created, ${removed} removed, ` +
      `${covered} covered, ${students.length - covered} still uncovered`
  );
}

// ---------------------------------------------------------------- done ----
console.log(
  `\n${"=".repeat(64)}\n` +
    (APPLY
      ? `Migration complete. ${writes} document write(s).`
      : `Dry run complete. ${writes} document write(s) would be made.\nRe-run with --apply to perform them.`) +
    `\n${"=".repeat(64)}`
);
process.exit(0);
