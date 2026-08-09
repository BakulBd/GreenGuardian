/**
 * One-time migration: get answer keys out of student-readable documents.
 *
 * `exams/{id}` is readable by every student the exam targets, and it carried a
 * denormalized copy of the question array — `correctAnswer` included. So the
 * answer key to any exam a student could open was one `getDoc` away, whatever
 * the `questions` collection rules said.
 *
 * For each exam this script:
 *   1. ensures the full questions (keys included) exist in the `questions`
 *      collection, creating them from the embedded copy if the exam was never
 *      split out — the key must have a home BEFORE it is removed from the
 *      exam document, or it is destroyed;
 *   2. rewrites the embedded array without `correctAnswer` / `explanation`.
 *
 * Idempotent and safe to re-run: step 1 is skipped when the collection already
 * has the questions, and step 2 is a no-op once no keys remain.
 *
 * Run this BEFORE deploying the new rules, so that no exam is left with its
 * key only in a place students can no longer read.
 *
 * Usage:
 *   node scripts/migrate-answer-keys.mjs            # apply
 *   node scripts/migrate-answer-keys.mjs --dry-run  # report only
 *   (requires serviceAccountKey.json in the project root, or
 *    GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT)
 */
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");

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

const hasKey = (q) =>
  q && (q.correctAnswer !== undefined || q.explanation !== undefined);

function stripKey(q) {
  const { correctAnswer, explanation, ...rest } = q;
  return rest;
}

async function main() {
  const exams = await db.collection("exams").get();
  console.log(`Scanning ${exams.size} exam(s)${DRY_RUN ? " (dry run)" : ""}…\n`);

  let examsStripped = 0;
  let questionsCreated = 0;
  let alreadyClean = 0;

  for (const examDoc of exams.docs) {
    const exam = examDoc.data();
    const embedded = Array.isArray(exam.questions) ? exam.questions : [];

    if (embedded.length === 0) continue;

    if (!embedded.some(hasKey)) {
      alreadyClean++;
      continue;
    }

    const existing = await db.collection("questions").where("examId", "==", examDoc.id).get();

    // Preserve the key by promoting the embedded questions into the
    // `questions` collection first. Only exams that never had their questions
    // split out reach this branch.
    if (existing.empty) {
      console.log(
        `  ${examDoc.id} "${exam.title || "(untitled)"}" — no questions collection rows; ` +
          `promoting ${embedded.length} embedded question(s) first`
      );
      if (!DRY_RUN) {
        const batch = db.batch();
        embedded.forEach((q, index) => {
          const ref = db.collection("questions").doc();
          batch.set(ref, {
            ...q,
            examId: examDoc.id,
            order: q.order ?? index,
            courseId: q.courseId || exam.courseId || "",
            batch: q.batch || exam.batch || "",
            section: q.section || exam.section || "",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      }
      questionsCreated += embedded.length;
    }

    const keyCount = embedded.filter(hasKey).length;
    console.log(
      `  ${examDoc.id} "${exam.title || "(untitled)"}" — stripping ${keyCount} answer key(s) ` +
        `from the exam document`
    );

    if (!DRY_RUN) {
      await examDoc.ref.update({ questions: embedded.map(stripKey) });
    }
    examsStripped++;
  }

  console.log(
    `\n${DRY_RUN ? "Would strip" : "Stripped"} answer keys from ${examsStripped} exam document(s).`
  );
  if (questionsCreated > 0) {
    console.log(
      `${DRY_RUN ? "Would create" : "Created"} ${questionsCreated} question document(s) to preserve keys.`
    );
  }
  console.log(`${alreadyClean} exam(s) were already clean.`);
  if (DRY_RUN) console.log("\nDry run — nothing was written. Re-run without --dry-run to apply.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
