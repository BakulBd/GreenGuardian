// Usage (Windows PowerShell):
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\serviceAccountKey.json)
//   node scripts/seed-all.mjs --adminEmail bakul@example.com --adminPassword "Bakul@123" --teacherEmail teacher@example.com --teacherPassword "Teacher@123" --studentEmail student@example.com --studentPassword "Student@123"

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.split("=");
      const key = k.replace(/^--/, "");
      if (v !== undefined) args[key] = v; else args[key] = argv[++i];
    }
  }
  return args;
}

async function ensureUser(auth, db, { email, password, name, role, approved }) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    if (!password || password.length < 6) throw new Error(`Password for ${email} must be >= 6 chars`);
    user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  }
  const uid = user.uid;
  await db.collection("users").doc(uid).set({
    id: uid,
    name,
    email,
    role,
    approved: !!approved,
    rejected: false,
    createdAt: (await import("firebase-admin")).default.firestore.FieldValue.serverTimestamp(),
    updatedAt: (await import("firebase-admin")).default.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { uid, email, name };
}

async function main() {
  const args = parseArgs(process.argv);
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(credPath)) {
    console.error(`Service account JSON not found at ${credPath}. Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in project root.`);
    process.exit(1);
  }

  const admin = (await import("firebase-admin")).default;
  const sa = JSON.parse(fs.readFileSync(credPath, "utf8"));
  if (!admin.apps?.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  }
  const auth = admin.auth();
  const db = admin.firestore();

  // Ensure users: admin, teacher, student
  const adminUser = await ensureUser(auth, db, {
    email: args.adminEmail || "bakul@example.com",
    password: args.adminPassword || "Bakul@123",
    name: args.adminName || "Bakul",
    role: "admin",
    approved: true,
  });
  const teacherUser = await ensureUser(auth, db, {
    email: args.teacherEmail || "teacher@example.com",
    password: args.teacherPassword || "Teacher@123",
    name: args.teacherName || "Teacher One",
    role: "teacher",
    approved: true,
  });
  const studentUser = await ensureUser(auth, db, {
    email: args.studentEmail || "student@example.com",
    password: args.studentPassword || "Student@123",
    name: args.studentName || "Student One",
    role: "student",
    approved: true,
  });

  // Ensure default settings
  const settingsRef = db.collection("settings").doc("app");
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
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
      updatedBy: adminUser.uid,
    });
  }

  // Create sample exam by teacher
  const now = new Date();
  const start = new Date(now.getTime() + 10 * 60 * 1000); // +10 min
  const end = new Date(start.getTime() + 60 * 60 * 1000); // +60 min

  const examRef = db.collection("exams").doc();
  await examRef.set({
    id: examRef.id,
    title: "Sample Exam",
    description: "Introductory sample exam",
    teacherId: teacherUser.uid,
    teacherName: teacherUser.name,
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

  // Create sample questions
  const qCol = db.collection("questions");
  const q1 = qCol.doc();
  await q1.set({
    id: q1.id,
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
  const q2 = qCol.doc();
  await q2.set({
    id: q2.id,
    examId: examRef.id,
    type: "short",
    text: "Name one proctoring capability of the app.",
    marks: 10,
    order: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Create sample exam session for student
  const sessionRef = db.collection("examSessions").doc();
  await sessionRef.set({
    id: sessionRef.id,
    examId: examRef.id,
    studentId: studentUser.uid,
    studentName: studentUser.name,
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

  // Create sample answer for question 2
  const ansRef = db.collection("answers").doc();
  await ansRef.set({
    id: ansRef.id,
    examSessionId: sessionRef.id,
    questionId: q2.id,
    studentId: studentUser.uid,
    answer: "Face detection",
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Create sample exam log
  const logRef = db.collection("examLogs").doc();
  await logRef.set({
    id: logRef.id,
    examSessionId: sessionRef.id,
    studentId: studentUser.uid,
    type: "exam_started",
    message: "Student started the exam.",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Optional: a sample teacher application (already approved teacher exists)
  const appRef = db.collection("teacherApplications").doc();
  await appRef.set({
    id: appRef.id,
    userId: teacherUser.uid,
    userName: teacherUser.name,
    userEmail: teacherUser.email,
    status: "approved",
    appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: adminUser.uid,
    reviewerName: adminUser.name,
    notes: "Auto-approved during seeding.",
  });

  console.log("Seeding completed: users, settings, exam, questions, session, answer, log, teacher application.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
