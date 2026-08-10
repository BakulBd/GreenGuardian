/**
 * Server-only Firebase Admin SDK initializer.
 *
 * Used ONLY inside Next.js API route handlers / server components.
 * NEVER import this from client components — it requires a service account
 * (or a running Firebase emulator in development).
 *
 * Credential resolution order:
 *   1. `FIREBASE_SERVICE_ACCOUNT` env var (JSON string)
 *   2. `serviceAccountKey.json` at the project root (gitignored)
 *   3. `GOOGLE_APPLICATION_CREDENTIALS` / Application Default Credentials (ADC)
 *
 * If a local Firebase emulator is running (`USE_FIREBASE_EMULATOR=true` or the
 * emulator host env vars are set), the Admin SDK is initialized against the
 * emulators and NO real service account is required — ideal for local dev.
 *
 * The `getAdmin()` function throws a descriptive error when credentials are
 * missing, so API routes can return a clear JSON error instead of a vague 500.
 */
import { cert, getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

interface AdminServices {
  app: App;
  auth: Auth;
  db: Firestore;
}

let cached: AdminServices | null = null;

function fallbackProjectId(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "greenguardian2026";
}

/** True when a local Firebase emulator is configured. */
function isEmulatorMode(): boolean {
  return (
    process.env.USE_FIREBASE_EMULATOR === "true" ||
    !!process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !!process.env.FIRESTORE_EMULATOR_HOST
  );
}

/**
 * True when the Firebase Admin SDK has *some* credential source to initialize
 * with (service account / emulator). Safe to call without throwing.
 */
export function isAdminSdkConfigured(): boolean {
  if (isEmulatorMode()) return true;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return true;
  try {
    return hasServiceAccountFile() || !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  } catch {
    return false;
  }
}

function serviceAccountFilePath(): string {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "serviceAccountKey.json")
  );
}

function hasServiceAccountFile(): boolean {
  try {
    return fs.existsSync(serviceAccountFilePath());
  } catch {
    return false;
  }
}

/** Returns a human-readable list of credential sources that are absent. */
function missingCredentialSources(): string[] {
  const missing: string[] = [];
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    missing.push("FIREBASE_SERVICE_ACCOUNT (inline JSON env var)");
  }
  if (!hasServiceAccountFile()) {
    missing.push(`serviceAccountKey.json (looked for: ${serviceAccountFilePath()})`);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    missing.push("GOOGLE_APPLICATION_CREDENTIALS (Application Default Credentials)");
  }
  return missing;
}

function resolveCredential(): { projectId?: string; credential: any } {
  const projectId = fallbackProjectId();

  // 1. Inline JSON service account.
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saJson) {
    try {
      const parsed = JSON.parse(saJson);
      return {
        projectId: parsed.project_id || projectId,
        credential: cert(parsed),
      };
    } catch (err) {
      console.warn("[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT as JSON:", err);
    }
  }

  // 2. Local service account file.
  if (hasServiceAccountFile()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(serviceAccountFilePath(), "utf8"));
      return {
        projectId: parsed.project_id || projectId,
        credential: cert(parsed),
      };
    } catch (err) {
      console.warn("[firebase-admin] Failed to read service account file:", err);
    }
  }

  // 3. Application Default Credentials (ADC).
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { projectId, credential: applicationDefault() };
  }

  // At this point no usable source was found — caller is expected to have
  // checked `missingCredentialSources()` first and thrown a clear error.
  throw new Error(
    "Firebase Admin SDK has no usable credentials configured. Configure FIREBASE_SERVICE_ACCOUNT, serviceAccountKey.json, or GOOGLE_APPLICATION_CREDENTIALS, or run the emulator."
  );
}

/**
 * Lazily initializes the Firebase Admin SDK and caches the services.
 * Safe to call multiple times from route handlers. Throws a descriptive
 * error when credentials are missing so failures are easy to diagnose.
 */
export function getAdmin(): AdminServices {
  if (cached) return cached;

  const existing = getApps();

  // Development emulator mode: no real service account required.
  if (isEmulatorMode()) {
    // Explicitly point the Admin SDK at the local emulators so the developer
    // only needs USE_FIREBASE_EMULATOR=true (plus `npm run emulators` running)
    // — no need to manually set the *_EMULATOR_HOST vars.
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    }
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    }
    const app =
      existing.length > 0
        ? existing[0]
        : initializeApp({ projectId: fallbackProjectId() });
    cached = { app, auth: getAuth(app), db: getFirestore(app) };
    return cached;
  }

  const missing = missingCredentialSources();
  const hasAnyCredential = missing.length < 3;
  if (!hasAnyCredential) {
    const msg =
      "Firebase Admin SDK requires credentials. None were found. Configure one of:\n" +
      "  - FIREBASE_SERVICE_ACCOUNT (inline JSON service account string)\n" +
      "  - A serviceAccountKey.json file in the project root\n" +
      "      (Firebase Console > Project Settings > Service accounts > Generate new private key)\n" +
      "  - GOOGLE_APPLICATION_CREDENTIALS pointing to a service account JSON file\n" +
      "For local development you can alternatively run `npm run emulators` and set USE_FIREBASE_EMULATOR=true.";
    console.error("[firebase-admin] " + msg);
    throw new Error(msg);
  }

  const { projectId, credential } = resolveCredential();

  const app =
    existing.length > 0
      ? existing[0]
      : initializeApp({
          credential,
          projectId,
        });

  cached = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
  };

  return cached;
}

/** Server-only auth (Admin SDK). Throws if not initialized. */
export function getAdminAuth(): Auth {
  return getAdmin().auth;
}

/** Server-only Firestore (Admin SDK). Throws if not initialized. */
export function getAdminDb(): Firestore {
  return getAdmin().db;
}

/*
 * NOTE: there is no storage accessor here. File storage is Backblaze B2 —
 * see `lib/storage/b2.ts` — so the Admin SDK is used only for Auth and
 * Firestore.
 */

