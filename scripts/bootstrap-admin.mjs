// Usage:
//   set GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json (Windows)
//   node scripts/bootstrap-admin.mjs --email bakul@example.com --password "Bakul@123" --name "Bakul"

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import process from "node:process";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.split("=");
      const key = k.replace(/^--/, "");
      if (v !== undefined) args[key] = v;
      else args[key] = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const email = args.email || args.e;
  const password = args.password || args.p;
  const name = args.name || args.n || "Admin";
  const projectId = args.project || process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG?.projectId || "greenguardian2026";

  if (!email || !password) {
    console.error("Missing --email and/or --password arguments.");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(credPath)) {
    console.error(`Service account JSON not found at ${credPath}. Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in project root.`);
    process.exit(1);
  }

  const admin = await import("firebase-admin");
  const sa = JSON.parse(fs.readFileSync(credPath, "utf8"));

  if (!admin.apps?.length) {
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || projectId,
    });
  }

  const auth = admin.auth();
  const db = admin.firestore();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Auth user exists: ${user.uid}`);
  } catch {
    user = await auth.createUser({ email, password, displayName: name, emailVerified: true, disabled: false });
    console.log(`Created auth user: ${user.uid}`);
  }

  const uid = user.uid;
  const userDocRef = db.collection("users").doc(uid);
  await userDocRef.set({
    id: uid,
    name,
    email,
    role: "admin",
    approved: true,
    rejected: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log("Admin Firestore profile upserted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
