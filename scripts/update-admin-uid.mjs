// Usage:
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "D:\Project\GreenGuardian\serviceAccountKey.json"
//   node scripts/update-admin-uid.mjs --uid <ACTUAL_UID_FROM_AUTH>

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

async function main() {
  const args = parseArgs(process.argv);
  const uid = args.uid;
  if (!uid) {
    console.error("Missing --uid argument. Usage: node scripts/update-admin-uid.mjs --uid <UID>");
    process.exit(1);
  }

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

  // Get placeholder data
  const placeholderRef = db.collection("users").doc("admin-placeholder");
  const placeholderSnap = await placeholderRef.get();
  
  if (!placeholderSnap.exists) {
    console.log("admin-placeholder not found. Checking if admin already exists...");
    const existingAdmin = await db.collection("users").doc(uid).get();
    if (existingAdmin.exists && existingAdmin.data()?.role === "admin") {
      console.log("✅ Admin user already exists with correct UID!");
      return;
    }
    // Create fresh admin doc
    await db.collection("users").doc(uid).set({
      id: uid,
      name: "Bakul",
      email: "bakul@greenguardian.com",
      role: "admin",
      approved: true,
      rejected: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✅ Created admin user document: users/${uid}`);
    return;
  }

  const data = placeholderSnap.data();

  // Create new doc with actual UID
  await db.collection("users").doc(uid).set({
    ...data,
    id: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Created admin user document: users/${uid}`);

  // Delete placeholder
  await placeholderRef.delete();
  console.log("✅ Deleted placeholder document");

  // Update settings.updatedBy if it was "bootstrap"
  const settingsRef = db.collection("settings").doc("app");
  const settingsSnap = await settingsRef.get();
  if (settingsSnap.exists && settingsSnap.data()?.updatedBy === "bootstrap") {
    await settingsRef.update({ updatedBy: uid });
    console.log("✅ Updated settings.updatedBy to admin UID");
  }

  console.log("\n🎉 Admin setup complete! You can now log in as bakul@greenguardian.com");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
