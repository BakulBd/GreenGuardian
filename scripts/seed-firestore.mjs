// Usage:
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "D:\Project\GreenGuardian\serviceAccountKey.json"
//   node scripts/seed-firestore.mjs

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

async function main() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(credPath)) {
    console.error(`Service account JSON not found at ${credPath}`);
    process.exit(1);
  }

  const admin = (await import("firebase-admin")).default;
  const sa = JSON.parse(fs.readFileSync(credPath, "utf8"));
  if (!admin.apps?.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  }
  const db = admin.firestore();

  console.log("Seeding Firestore collections...");

  // 1. Settings
  const settingsRef = db.collection("settings").doc("app");
  await settingsRef.set({
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
  }, { merge: true });
  console.log("✓ settings/app created");

  // 2. Sample admin user document (you'll create auth user in Console)
  const adminUid = "admin-placeholder";
  await db.collection("users").doc(adminUid).set({
    id: adminUid,
    name: "Bakul",
    email: "bakul@greenguardian.com",
    role: "admin",
    approved: true,
    rejected: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log("✓ users/admin-placeholder created (update ID after creating auth user)");

  // 3. Sample teacher user document
  const teacherUid = "teacher-placeholder";
  await db.collection("users").doc(teacherUid).set({
    id: teacherUid,
    name: "Teacher One",
    email: "teacher@greenguardian.com",
    role: "teacher",
    approved: true,
    rejected: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log("✓ users/teacher-placeholder created");

  // 4. Sample student user document
  const studentUid = "student-placeholder";
  await db.collection("users").doc(studentUid).set({
    id: studentUid,
    name: "Student One",
    email: "student@greenguardian.com",
    role: "student",
    approved: true,
    rejected: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log("✓ users/student-placeholder created");

  // 5. Sample exam
  const now = new Date();
  const start = new Date(now.getTime() + 10 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const examRef = db.collection("exams").doc();
  await examRef.set({
    id: examRef.id,
    title: "Sample Exam",
    description: "Introductory sample exam for testing",
    teacherId: teacherUid,
    teacherName: "Teacher One",
    duration: 60,
    totalMarks: 100,
    startTime: start,
    endTime: end,
    settings: {
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
    status: "published",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ exams/${examRef.id} created`);

  // 6. Sample questions
  const q1Ref = db.collection("questions").doc();
  await q1Ref.set({
    id: q1Ref.id,
    examId: examRef.id,
    type: "mcq",
    text: "Which color represents GreenGuardian?",
    marks: 10,
    order: 1,
    options: ["Red", "Green", "Blue", "Yellow"],
    correctAnswer: "Green",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ questions/${q1Ref.id} created`);

  const q2Ref = db.collection("questions").doc();
  await q2Ref.set({
    id: q2Ref.id,
    examId: examRef.id,
    type: "short",
    text: "Name one proctoring capability of the app.",
    marks: 10,
    order: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ questions/${q2Ref.id} created`);

  // 7. Sample exam session
  const sessionRef = db.collection("examSessions").doc();
  await sessionRef.set({
    id: sessionRef.id,
    examId: examRef.id,
    studentId: studentUid,
    studentName: "Student One",
    startTime: admin.firestore.FieldValue.serverTimestamp(),
    submitted: false,
    score: 0,
    riskScore: 0,
    flagged: false,
    flagReasons: [],
    status: "in-progress",
    proctoring: {
      tabSwitches: 0,
      fullscreenExits: 0,
      noFaceDuration: 0,
      multipleFacesCount: 0,
      attentionAwayDuration: 0,
      suspiciousEvents: 0,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ examSessions/${sessionRef.id} created`);

  // 8. Sample answer
  const ansRef = db.collection("answers").doc();
  await ansRef.set({
    id: ansRef.id,
    examSessionId: sessionRef.id,
    questionId: q2Ref.id,
    studentId: studentUid,
    answer: "Face detection",
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ answers/${ansRef.id} created`);

  // 9. Sample exam log
  const logRef = db.collection("examLogs").doc();
  await logRef.set({
    id: logRef.id,
    examSessionId: sessionRef.id,
    studentId: studentUid,
    type: "exam_started",
    message: "Student started the exam.",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ examLogs/${logRef.id} created`);

  // 10. Sample teacher application
  const appRef = db.collection("teacherApplications").doc();
  await appRef.set({
    id: appRef.id,
    userId: teacherUid,
    userName: "Teacher One",
    userEmail: "teacher@greenguardian.com",
    status: "approved",
    appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: adminUid,
    reviewerName: "Bakul",
    notes: "Auto-approved during seeding.",
  });
  console.log(`✓ teacherApplications/${appRef.id} created`);

  console.log("\n✅ All Firestore collections seeded successfully!");
  console.log("\n⚠️  NEXT STEPS:");
  console.log("1. Go to Firebase Console → Authentication → Add user");
  console.log("   Email: bakul@greenguardian.com, Password: Bakul@123");
  console.log("2. Copy the new user's UID");
  console.log("3. Go to Firestore → users → delete 'admin-placeholder'");
  console.log("4. Create new doc with ID = the UID, copy all fields from placeholder");
  console.log("   (or run: node scripts/update-admin-uid.mjs --uid <THE_UID>)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
