// Applies cors.json to the project's Cloud Storage bucket.
//
// A cors.json committed to the repo configures nothing on its own — the bucket
// carries its own CORS policy, set through the Storage API. Until this runs,
// every browser request to firebasestorage.googleapis.com that needs a
// preflight (any DELETE, and any upload carrying x-goog-upload-* headers) is
// blocked before it leaves the browser, which surfaces as ERR_FAILED with no
// server-side trace at all.
//
// Uses the same service-account credential as the rest of the server code, so
// it needs neither gcloud nor gsutil installed.
//
// Usage:
//   node scripts/apply-storage-cors.mjs           # apply cors.json
//   node scripts/apply-storage-cors.mjs --show    # print the live policy only

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      console.error("FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON.");
      process.exit(1);
    }
  }

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "serviceAccountKey.json");

  if (!fs.existsSync(credPath)) {
    console.error(
      `No service account found.\n` +
        `  Set FIREBASE_SERVICE_ACCOUNT (inline JSON), or GOOGLE_APPLICATION_CREDENTIALS,\n` +
        `  or place serviceAccountKey.json in the project root.\n` +
        `  Looked for: ${credPath}`
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(credPath, "utf8"));
}

/**
 * Reads NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET out of .env.local when it is not
 * already in the environment — this script is normally run outside Next.js,
 * which is what loads that file for the app.
 */
function bucketNameFromEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return "";
  const match = fs
    .readFileSync(envPath, "utf8")
    .match(/^\s*NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET\s*=\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

async function main() {
  const showOnly = process.argv.includes("--show");
  const serviceAccount = loadServiceAccount();

  const bucketName =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    bucketNameFromEnvFile() ||
    `${serviceAccount.project_id}.firebasestorage.app`;

  const { getApps, initializeApp, cert } = await import("firebase-admin/app");
  const { getStorage } = await import("firebase-admin/storage");

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket: bucketName,
    });
  }

  const bucket = getStorage().bucket(bucketName);

  if (showOnly) {
    const [metadata] = await bucket.getMetadata();
    console.log(`Live CORS policy for gs://${bucketName}:`);
    console.log(JSON.stringify(metadata.cors ?? [], null, 2));
    return;
  }

  const corsPath = path.join(process.cwd(), "cors.json");
  if (!fs.existsSync(corsPath)) {
    console.error(`cors.json not found at ${corsPath}`);
    process.exit(1);
  }
  const cors = JSON.parse(fs.readFileSync(corsPath, "utf8"));

  await bucket.setCorsConfiguration(cors);

  const [metadata] = await bucket.getMetadata();
  console.log(`Applied cors.json to gs://${bucketName}. Live policy is now:`);
  console.log(JSON.stringify(metadata.cors ?? [], null, 2));
  console.log(
    "\nNote: browsers cache preflight responses for maxAgeSeconds (3600). " +
      "Hard-reload, or wait out the cache, before retesting."
  );
}

main().catch((error) => {
  console.error("Failed to apply the CORS configuration:");
  console.error(error?.message || error);
  if (String(error?.message || "").includes("storage.buckets.update")) {
    console.error(
      "\nThe service account needs the 'Storage Admin' (roles/storage.admin) role, " +
        "or at least storage.buckets.update, on this project."
    );
  }
  process.exit(1);
});
