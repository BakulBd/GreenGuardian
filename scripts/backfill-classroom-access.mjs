/**
 * One-time backfill for the classroom access decoupling.
 *
 * Two things changed:
 *   1. `classroomMembers` docs now carry a denormalized `teacherId`. Members
 *      who joined before that keep working (their access still comes from the
 *      old admin assignment), but they contribute nothing to the new
 *      membership-derived access path — so if an admin later removes the
 *      assignment they'd lose the classroom too.
 *   2. `exams` now carry `targetStudentIds`, which is what students' visibility
 *      queries and security rules check. Exams created before that are
 *      invisible until this runs.
 *
 * Safe to run repeatedly — everything is recomputed from live data.
 *
 * Usage:
 *   node scripts/backfill-classroom-access.mjs
 *   (requires serviceAccountKey.json in the project root, or
 *    GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT)
 */
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

function initAdmin() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    });
  }
  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(credPath)) {
    console.error(
      `Service account not found at ${credPath}. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.`
    );
    process.exit(1);
  }
  return admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(credPath, "utf8"))),
  });
}

initAdmin();
const db = admin.firestore();

async function backfillMemberTeacherIds() {
  const [membersSnap, classroomsSnap] = await Promise.all([
    db.collection("classroomMembers").get(),
    db.collection("classrooms").get(),
  ]);

  const teacherByClassroom = new Map(
    classroomsSnap.docs.map((d) => [d.id, d.data().teacherId])
  );

  let updated = 0;
  let orphaned = 0;
  let batch = db.batch();
  let pending = 0;

  for (const memberDoc of membersSnap.docs) {
    const data = memberDoc.data();
    if (data.teacherId) continue;

    const teacherId = teacherByClassroom.get(data.classroomId);
    if (!teacherId) {
      orphaned++;
      continue;
    }

    batch.update(memberDoc.ref, { teacherId });
    updated++;
    pending++;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(`classroomMembers: added teacherId to ${updated} doc(s); ${orphaned} orphaned (classroom deleted).`);
  return membersSnap;
}


/**
 * Create the `teacher_student_mapping` rows that were never written.
 *
 * Mappings are only produced when an assignment is created or edited, resolving
 * the group as it stood at that moment. A student who registered afterwards —
 * or who was moved into the batch/section later — has no row, so they are
 * missing from their teacher's roster and from every exam's targetStudentIds.
 * This walks every student against every assignment and fills the gaps.
 */
async function backfillAssignmentMappings() {
  const [assignmentsSnap, studentsSnap, mappingsSnap] = await Promise.all([
    db.collection("teacher_assignments").get(),
    db.collection("users").where("role", "==", "student").get(),
    db.collection("teacher_student_mapping").get(),
  ]);

  const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const existing = new Set(
    mappingsSnap.docs
      .map((d) => d.data())
      .filter((m) => m.assignmentId && m.studentId)
      .map((m) => `${m.assignmentId}::${m.studentId}`)
  );

  let created = 0;
  let batch = db.batch();
  let pending = 0;

  for (const a of assignments) {
    for (const s of students) {
      if (s.batch !== a.batchName) continue;
      const sections = s.sections?.length ? s.sections : s.section ? [s.section] : [];
      if (!a.sectionName || !sections.includes(a.sectionName)) continue;
      if (s.courses?.length && !s.courses.includes(a.courseId)) continue;
      if (a.studentIds?.length && !a.studentIds.includes(s.id)) continue;
      if (existing.has(`${a.id}::${s.id}`)) continue;

      batch.set(db.collection("teacher_student_mapping").doc(), {
        teacherId: a.teacherId,
        studentId: s.id,
        studentName: s.name || "",
        studentCode: s.studentCode || "",
        courseId: a.courseId,
        courseName: a.courseName || "",
        batchId: a.batchId,
        batchName: a.batchName || "",
        sectionId: a.sectionId,
        sectionName: a.sectionName || "",
        assignmentId: a.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      created++;
      pending++;

      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }
  if (pending > 0) await batch.commit();

  console.log(
    `teacher_student_mapping: created ${created} missing row(s) across ${assignments.length} assignment(s).`
  );
  return created;
}

async function recomputeAssignedTeacherIds(membersSnap) {
  const studentIds = new Set();
  membersSnap.docs.forEach((d) => d.data().studentId && studentIds.add(d.data().studentId));

  const mappingsSnap = await db.collection("teacher_student_mapping").get();
  mappingsSnap.docs.forEach((d) => d.data().studentId && studentIds.add(d.data().studentId));

  let synced = 0;
  for (const studentId of studentIds) {
    const [mappings, memberships] = await Promise.all([
      db.collection("teacher_student_mapping").where("studentId", "==", studentId).get(),
      db.collection("classroomMembers").where("studentId", "==", studentId).get(),
    ]);
    const teacherIds = Array.from(
      new Set(
        [
          ...mappings.docs.map((d) => d.data().teacherId),
          ...memberships.docs.map((d) => d.data().teacherId),
        ].filter(Boolean)
      )
    );
    try {
      await db.collection("users").doc(studentId).update({
        assignedTeacherIds: teacherIds,
        updatedAt: new Date(),
      });
      synced++;
    } catch (e) {
      console.warn(`  ! could not update user ${studentId}: ${e.message}`);
    }
  }
  console.log(`users: recomputed assignedTeacherIds for ${synced}/${studentIds.size} student(s).`);
}

async function backfillExamTargets() {
  const [examsSnap, assignmentsSnap, usersSnap] = await Promise.all([
    db.collection("exams").get(),
    db.collection("teacher_assignments").get(),
    db.collection("users").where("role", "==", "student").get(),
  ]);

  const students = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let updated = 0;
  let skipped = 0;
  let legacyMatched = 0;
  const untargeted = [];
  const emptyGroup = [];

  for (const examDoc of examsSnap.docs) {
    const exam = examDoc.data();
    if (Array.isArray(exam.targetStudentIds) && exam.targetStudentIds.length > 0) continue;
    if (!exam.teacherId) {
      skipped++;
      continue;
    }

    // Match the same resolution the app uses: the teacher's assignment for
    // this course+batch+section, honouring an explicit studentIds override.
    const assignment = assignmentsSnap.docs
      .map((d) => d.data())
      .find(
        (a) =>
          a.teacherId === exam.teacherId &&
          (exam.courseId ? a.courseId === exam.courseId : true) &&
          (exam.batchId ? a.batchId === exam.batchId : a.batchName === exam.batch) &&
          (exam.sectionId ? a.sectionId === exam.sectionId : a.sectionName === exam.section)
      );

    let allowed;

    if (assignment) {
      const group = students.filter((s) => {
        if (s.batch !== assignment.batchName) return false;
        const sections = s.sections?.length ? s.sections : s.section ? [s.section] : [];
        if (!sections.includes(assignment.sectionName)) return false;
        if (s.courses?.length) return s.courses.includes(assignment.courseId);
        return true;
      });
      allowed = assignment.studentIds?.length
        ? group.filter((s) => assignment.studentIds.includes(s.id))
        : group;
    } else if (exam.batch && exam.section) {
      // LEGACY FALLBACK. Exams created before this migration used the old
      // hardcoded catalog, so their `courseId` (e.g. "cse-301") can never
      // match a real Firestore course document and no assignment will be
      // found. Reproduce exactly what the old client-side filter did —
      // batch + section name match — so pre-existing exams keep the same
      // audience instead of silently vanishing under the new rules.
      allowed = students.filter((s) => {
        if (s.batch !== exam.batch) return false;
        const sections = s.sections?.length ? s.sections : s.section ? [s.section] : [];
        return sections.includes(exam.section);
      });
      legacyMatched++;
    } else {
      // No assignment and no batch/section to fall back on — untargeted.
      untargeted.push(`${examDoc.id} (${exam.title || "untitled"})`);
      skipped++;
      continue;
    }

    if (allowed.length === 0) {
      emptyGroup.push(`${examDoc.id} (${exam.title || "untitled"}) → batch ${exam.batch}/${exam.section}`);
      skipped++;
      continue;
    }

    await examDoc.ref.update({ targetStudentIds: allowed.map((s) => s.id) });
    updated++;
  }

  console.log(
    `exams: set targetStudentIds on ${updated} exam(s) (${legacyMatched} via legacy batch/section fallback); ${skipped} skipped.`
  );
  if (untargeted.length) {
    console.log(`  ! ${untargeted.length} exam(s) have no course/batch/section at all and stay hidden:`);
    untargeted.forEach((e) => console.log(`      - ${e}`));
    console.log("    Edit each in the teacher dashboard to pick a Course/Batch/Section, or delete them.");
  }
  if (emptyGroup.length) {
    console.log(`  ! ${emptyGroup.length} exam(s) matched no enrolled students:`);
    emptyGroup.forEach((e) => console.log(`      - ${e}`));
  }
}

(async () => {
  console.log("Starting classroom/exam access backfill...\n");
  const membersSnap = await backfillMemberTeacherIds();
  await backfillAssignmentMappings();
  await recomputeAssignedTeacherIds(membersSnap);
  await backfillExamTargets();
  console.log("\nBackfill complete.");
  process.exit(0);
})().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
