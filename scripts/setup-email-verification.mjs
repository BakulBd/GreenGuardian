/**
 * GreenGuardian — Email Verification (OTP) setup helper.
 *
 * Usage:
 *   node scripts/setup-email-verification.mjs
 *
 * What it does:
 *   1. Ensures `REGISTRATION_ENC_KEY` exists in `.env.local` (generates one if missing).
 *   2. Prints a clear status report for every server-side env var the OTP flow needs
 *      (Admin SDK credentials, SMTP, emulator flag).
 *   3. Explains exactly how to obtain the missing Firebase Admin SDK credentials.
 *
 * It never overwrites existing secrets.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();
const ENV_PATH = path.join(CWD, ".env.local");

function readEnvMap() {
  const map = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const rawLine of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      map[key] = value;
    }
  }
  return map;
}

function writeEnvKey(map, key, value) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    : [];
  let replaced = false;
  const out = [];
  for (const line of lines) {
    if (line.trim().startsWith(`${key}=`)) {
      out.push(`${key}=${value}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }
  if (!replaced) {
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
    out.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_PATH, out.join("\n") + "\n", "utf8");
}

console.log("==========================================================");
console.log(" GreenGuardian — Email Verification (OTP) Setup Helper");
console.log("==========================================================\n");

const env = readEnvMap();

// 1) REGISTRATION_ENC_KEY
let encKey = env.REGISTRATION_ENC_KEY;
if (encKey && encKey.startsWith("[SET")) {
  encKey = "";
}
if (!encKey) {
  encKey = crypto.randomBytes(32).toString("hex");
  writeEnvKey(env, "REGISTRATION_ENC_KEY", encKey);
  console.log("✓ Generated a new REGISTRATION_ENC_KEY and wrote it to .env.local");
} else {
  console.log("✓ REGISTRATION_ENC_KEY is already set");
}

// 2) Admin SDK credentials status
const hasFirestoreRules = true; // always present in repo
const saInline = !!env.FIREBASE_SERVICE_ACCOUNT;
const saFileExists = fs.existsSync(path.join(CWD, "serviceAccountKey.json"));
const saFileEnv = !!env.FIREBASE_SERVICE_ACCOUNT_PATH;
const hasAdc = !!env.GOOGLE_APPLICATION_CREDENTIALS;
const emulatorMode = env.USE_FIREBASE_EMULATOR === "true";

console.log("\n--- Firebase Admin SDK credentials (REQUIRED for account creation) ---");
console.log(`  FIREBASE_SERVICE_ACCOUNT (inline JSON): ${saInline ? "SET" : "missing"}`);
console.log(`  serviceAccountKey.json in project root: ${saFileExists ? "present" : "missing"}`);
console.log(`  FIREBASE_SERVICE_ACCOUNT_PATH env var : ${saFileEnv ? "SET" : "not set"}`);
console.log(`  GOOGLE_APPLICATION_CREDENTIALS        : ${hasAdc ? "SET" : "not set"}`);
console.log(`  USE_FIREBASE_EMULATOR=true            : ${emulatorMode ? "enabled" : "disabled"}`);

const adminReady = saInline || saFileExists || saFileEnv || hasAdc || emulatorMode;

if (!adminReady) {
  console.log("\n❌ NO Admin SDK credential source is configured. The registration API will");
  console.log("   return HTTP 500 with the message about missing Firebase Admin credentials.");
  console.log("\n   Fix (choose ONE):");
  console.log("   1) Download a service account JSON:");
  console.log("        Firebase Console → ⚙ Project Settings → Service accounts →");
  console.log("        'Generate new private key' → save as ./serviceAccountKey.json");
  console.log("      (that file is already gitignored)");
  console.log("   2) OR set an inline JSON:    FIREBASE_SERVICE_ACCOUNT={...}");
  console.log("   3) OR set a path env var:     FIREBASE_SERVICE_ACCOUNT_PATH=...");
  console.log("   4) OR for local emulators only: USE_FIREBASE_EMULATOR=true and run `npm run emulators`");
  console.log("      (note: the Firestore emulator requires Java)");
} else {
  console.log("\n✓ Admin SDK credential source found");
}

// 3) SMTP
console.log("\n--- SMTP (optional for local dev; required for real email) ---");
const smtpReady = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);
console.log(`  SMTP configured: ${smtpReady ? "yes" : "no"}`);
if (!smtpReady) {
  console.log("  Without SMTP, OTPs are printed to the server console (dev mode).");
}

console.log("\n--- Next step ---");
console.log("  Restart the dev server (`npm run dev`), then open /api/auth/config-check");
console.log("  to confirm everything is wired up before testing /register.");
console.log("\n==========================================================\n");

