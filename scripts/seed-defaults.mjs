// Usage:
//   set GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json (Windows)
//   node scripts/seed-defaults.mjs

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import process from "node:process";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function main() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(credPath)) {
    console.error(`Service account JSON not found at ${credPath}. Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in project root.`);
    process.exit(1);
  }

  const admin = await import("firebase-admin");
  const sa = JSON.parse(fs.readFileSync(credPath, "utf8"));
  if (!admin.apps?.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  }
  const db = admin.firestore();

  const settingsRef = db.collection("settings").doc("app");
  const snap = await settingsRef.get();
  if (snap.exists) {
    console.log("Settings already exist. No changes made.");
    return;
  }

  const defaults = {
    id: "app",
    riskThresholds: { low: 20, medium: 50, high: 80 },
    defaultExamSettings: {
      requireWebcam: true,
      allowedTabSwitches: 2,
      faceMissingTolerance: 10,
      attentionTimeout: 20,
      fileUploadsAllowed: true,
      shuffleQuestions: true,
      autoSubmitOnTimeout: true,
      allowedLateSubmission: false,
      lateSubmissionMinutes: 0,
    },
    plagiarismThreshold: 0.8,
    allowTeacherRegistration: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "bootstrap",
  };

  await settingsRef.set(defaults, { merge: true });
  console.log("Default settings created at settings/app");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
