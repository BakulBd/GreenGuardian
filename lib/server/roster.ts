/**
 * Server-side roster resolution — the single authority on which teachers a
 * student is attached to.
 *
 * WHY THIS EXISTS ON THE SERVER
 * -----------------------------
 * `users.assignedTeacherIds` is the field every notice, exam and notification
 * check reads, in both the queries and the Firestore rules. It is derived, not
 * authored, from two sources:
 *
 *   1. `teacher_student_mapping` — the admin's Course+Batch+Section assignment
 *   2. `classroomMembers`        — classroom join-by-code / teacher-added
 *
 * The client-side twin of this logic (lib/firebase/assignments.ts) can only run
 * as an admin, because writing `teacher_student_mapping` and another user's
 * `users` document are both admin-only by rule. That was fine while an admin
 * was the only one who ever changed a student's section — but it silently did
 * nothing for the two cases that matter most:
 *
 *   - a student finishing registration (nobody is signed in as an admin), and
 *   - any server-initiated placement change.
 *
 * Both used to leave the new student with `assignedTeacherIds: []`, which
 * presents as "the app is empty" and "notices don't circulate". Running the
 * resolution with Admin credentials is what makes those paths work.
 *
 * MATCHING RULES (kept identical to the client twin and to firestore.rules)
 * ------------------------------------------------------------------------
 * A student matches an assignment when:
 *   - the batch NAMES match, and
 *   - the assignment's section name is one of the student's sections, and
 *   - the student is enrolled in the course — where an empty course list means
 *     "enrolled in everything for my batch/section", and
 *   - if the assignment pins specific students, the student is one of them.
 *
 * Names, not IDs, are compared: a student profile only ever stores names, and
 * catalog IDs are derived from those names (see lib/academics/ids.ts).
 */
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

const MAPPINGS = "teacher_student_mapping";
const ASSIGNMENTS = "teacher_assignments";
const MEMBERS = "classroomMembers";

export interface RosterSyncResult {
  studentId: string;
  gained: string[];
  lost: string[];
  teacherIds: string[];
}

function sectionsOf(student: any): string[] {
  if (Array.isArray(student?.sections) && student.sections.length > 0) {
    return student.sections.filter(Boolean);
  }
  return student?.section ? [student.section] : [];
}

function eq(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

function isEnrolledInCourse(student: any, courseId: string): boolean {
  const courses = student?.courses;
  if (!Array.isArray(courses) || courses.length === 0) return true;
  return courses.some((c: any) =>
    typeof c === "string"
      ? eq(c, courseId)
      : eq(c?.courseId, courseId) || eq(c?.id, courseId) || eq(c?.code, courseId)
  );
}

/** Does `student` belong to `assignment`'s group? */
export function studentMatchesAssignment(student: any, assignment: any): boolean {
  // Checked here as well as by the caller: this predicate decides who gets a
  // teacher's exams and notices, so it should not depend on every call site
  // having filtered by role first.
  if (String(student?.role ?? "").trim().toLowerCase() !== "student") return false;

  if (!eq(student?.batch, assignment?.batchName)) return false;

  const studentSections = sectionsOf(student);
  if (!assignment?.sectionName) return false;
  if (!studentSections.some((s) => eq(s, assignment.sectionName))) return false;

  if (!isEnrolledInCourse(student, assignment?.courseId)) return false;

  // An assignment pinned to specific students only covers those students.
  const pinned: string[] | undefined = assignment?.studentIds;
  if (Array.isArray(pinned) && pinned.length > 0 && !pinned.includes(student.id)) {
    return false;
  }
  return true;
}

/**
 * Recompute `assignedTeacherIds` for one student from both live sources.
 *
 * Always derives the full set rather than incrementing, so losing one source
 * (leaving a classroom) is safe while another still grants the same teacher.
 */
async function recomputeTeacherIds(db: Firestore, studentId: string): Promise<string[]> {
  const [mappingsSnap, membersSnap] = await Promise.all([
    db.collection(MAPPINGS).where("studentId", "==", studentId).get(),
    db.collection(MEMBERS).where("studentId", "==", studentId).get(),
  ]);

  return Array.from(
    new Set(
      [
        ...mappingsSnap.docs.map((d) => d.data().teacherId),
        ...membersSnap.docs.map((d) => d.data().teacherId),
      ].filter(Boolean)
    )
  ) as string[];
}

/**
 * Re-derive one student's entire roster position: mapping rows, denormalized
 * `assignedTeacherIds`, and membership of already-published exams.
 *
 * Idempotent — everything is computed from current data, so running it twice
 * changes nothing the second time.
 */
export async function syncStudentRoster(studentId: string): Promise<RosterSyncResult> {
  const db = getAdminDb();

  const studentSnap = await db.collection("users").doc(studentId).get();
  if (!studentSnap.exists) {
    return { studentId, gained: [], lost: [], teacherIds: [] };
  }
  const student = { id: studentId, ...studentSnap.data() };
  if (String((student as any).role || "").trim() !== "student") {
    return { studentId, gained: [], lost: [], teacherIds: [] };
  }

  const [assignmentsSnap, existingSnap] = await Promise.all([
    db.collection(ASSIGNMENTS).get(),
    db.collection(MAPPINGS).where("studentId", "==", studentId).get(),
  ]);

  const matches = assignmentsSnap.docs.filter((d) =>
    studentMatchesAssignment(student, d.data())
  );
  const shouldHave = new Set(matches.map((d) => d.id));
  const currentlyHas = new Set(
    existingSnap.docs.map((d) => d.data().assignmentId as string).filter(Boolean)
  );

  const gained = matches.filter((d) => !currentlyHas.has(d.id));
  const lost = existingSnap.docs.filter(
    (d) => !d.data().assignmentId || !shouldHave.has(d.data().assignmentId)
  );

  if (gained.length > 0 || lost.length > 0) {
    const batch = db.batch();
    const now = new Date();

    for (const assignmentDoc of gained) {
      const a = assignmentDoc.data();
      const row: Record<string, any> = {
        teacherId: a.teacherId,
        studentId,
        studentName: (student as any).name || "",
        courseId: a.courseId,
        courseName: a.courseName || "",
        batchId: a.batchId || "",
        batchName: a.batchName || "",
        sectionId: a.sectionId || "",
        sectionName: a.sectionName || "",
        assignmentId: assignmentDoc.id,
        createdAt: now,
        updatedAt: now,
      };
      // Firestore rejects undefined; a missing studentCode is common.
      if ((student as any).studentCode) row.studentCode = (student as any).studentCode;
      batch.set(db.collection(MAPPINGS).doc(), row);
    }

    for (const mappingDoc of lost) batch.delete(mappingDoc.ref);

    await batch.commit();
  }

  const teacherIds = await recomputeTeacherIds(db, studentId);
  await db.collection("users").doc(studentId).set(
    { assignedTeacherIds: teacherIds, updatedAt: new Date() },
    { merge: true }
  );

  await syncExamTargets(
    db,
    studentId,
    gained.map((d) => d.data()),
    lost.map((d) => d.data())
  );

  return {
    studentId,
    gained: gained.map((d) => d.id),
    lost: lost.map((d) => d.id),
    teacherIds,
  };
}

/**
 * Add/remove the student from `targetStudentIds` on exams belonging to the
 * groups they just joined or left, so exams published before the change follow
 * the student instead of going stale.
 */
async function syncExamTargets(
  db: Firestore,
  studentId: string,
  gained: any[],
  lost: any[]
): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");

  const apply = async (group: any, action: "add" | "remove") => {
    if (!group?.teacherId || !group?.courseId) return;
    try {
      const examsSnap = await db
        .collection("exams")
        .where("teacherId", "==", group.teacherId)
        .where("courseId", "==", group.courseId)
        .get();

      const targets = examsSnap.docs.filter((d) => {
        const e = d.data();
        // Compare on names as well as ids: older exams and assignments do not
        // agree on which of the two they stored.
        return (
          (eq(e.batchId, group.batchId) || eq(e.batch, group.batchName)) &&
          (eq(e.sectionId, group.sectionId) || eq(e.section, group.sectionName))
        );
      });

      await Promise.all(
        targets.map((d) =>
          d.ref.update({
            targetStudentIds:
              action === "add"
                ? FieldValue.arrayUnion(studentId)
                : FieldValue.arrayRemove(studentId),
            updatedAt: new Date(),
          })
        )
      );
    } catch (error) {
      // Never block the roster update on this — exam edits recompute targets
      // from scratch anyway.
      console.warn("[roster] Failed to sync exam targets:", error);
    }
  };

  await Promise.all([
    ...gained.map((a) => apply(a, "add")),
    ...lost.map((m) => apply(m, "remove")),
  ]);
}

/**
 * Rebuild the roster for every student.
 *
 * Deliberately iterates ALL students rather than only those that already have a
 * mapping row: a student who registered after their teacher's assignment was
 * created has no row at all, so a mapping-driven pass skips exactly the people
 * who are broken.
 */
export async function syncAllStudentRosters(): Promise<{
  studentsChecked: number;
  studentsCovered: number;
  uncovered: number;
  linksCreated: number;
  linksRemoved: number;
}> {
  const db = getAdminDb();
  const studentsSnap = await db.collection("users").where("role", "==", "student").get();

  let linksCreated = 0;
  let linksRemoved = 0;
  let studentsCovered = 0;

  // Sequential: each sync issues several reads plus a batched write, and firing
  // hundreds concurrently exhausts the Admin SDK's connection pool.
  for (const doc of studentsSnap.docs) {
    try {
      const result = await syncStudentRoster(doc.id);
      linksCreated += result.gained.length;
      linksRemoved += result.lost.length;
      if (result.teacherIds.length > 0) studentsCovered++;
    } catch (error) {
      console.warn(`[roster] Sync failed for student ${doc.id}:`, error);
    }
  }

  return {
    studentsChecked: studentsSnap.size,
    studentsCovered,
    uncovered: studentsSnap.size - studentsCovered,
    linksCreated,
    linksRemoved,
  };
}
