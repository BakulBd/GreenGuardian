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

/**
 * Explains why a service-account object was rejected, in terms of what is
 * actually wrong with it.
 *
 * `cert()` reports an unusable key as "Failed to parse private key: Invalid PEM
 * formatted message", which says nothing about WHICH credential source is at
 * fault or what to do. The two failures that account for nearly all of these
 * are a `private_key` still holding the placeholder from a template, and one
 * whose newlines were flattened when it was pasted into an env file — both are
 * recognisable from the value's shape, so name them.
 */
export function describeServiceAccountProblem(source: string, parsed: any, err: unknown): string {
  const detail = (err as any)?.message || String(err);
  const key = typeof parsed?.private_key === "string" ? parsed.private_key : "";

  if (!key) {
    return `${source} has no "private_key" field.`;
  }
  if (!key.includes("-----BEGIN")) {
    return `${source} has a "private_key" that is not a PEM block (it must start with -----BEGIN PRIVATE KEY-----).`;
  }

  const body = key
    .replace(/-----[^-]*-----/g, "")
    .replace(/\s/g, "");

  // A real RSA service-account key is ~1600 base64 characters. Anything this
  // short is a placeholder, not a truncated key.
  if (body.length < 100 || !/^[A-Za-z0-9+/=]*$/.test(body)) {
    return (
      `${source} has a placeholder "private_key", not a real one ` +
      `(${body.length} characters between the PEM header and footer). ` +
      `Download a key from Firebase Console > Project Settings > Service accounts > ` +
      `Generate new private key, and paste the whole JSON as a single line.`
    );
  }
  if (!key.includes("\n")) {
    return (
      `${source} has a "private_key" with no line breaks. When the JSON is stored in ` +
      `an env file the newlines must survive as \\n escapes inside the JSON string.`
    );
  }

  return `${source} holds a service account that could not be loaded: ${detail}`;
}

function resolveCredential(): { projectId?: string; credential: any } {
  const projectId = fallbackProjectId();

  // Why each supplied source was unusable, so the final error can say so.
  // Sources still fall through to the next one (a broken env var alongside a
  // working key file should keep working), but the reason is no longer lost.
  const problems: string[] = [];

  // 1. Inline JSON service account.
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saJson) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(saJson);
    } catch (err: any) {
      problems.push(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err?.message || err}`);
    }

    if (parsed) {
      try {
        return {
          projectId: parsed.project_id || projectId,
          credential: cert(parsed),
        };
      } catch (err) {
        // Separated from the JSON parse above on purpose: the old code caught
        // both here and blamed "Failed to parse ... as JSON", which sent people
        // looking at the wrong thing entirely.
        problems.push(describeServiceAccountProblem("FIREBASE_SERVICE_ACCOUNT", parsed, err));
      }
    }
  }

  // 2. Local service account file.
  if (hasServiceAccountFile()) {
    const filePath = serviceAccountFilePath();
    let parsed: any = null;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err: any) {
      problems.push(`${filePath} could not be read as JSON: ${err?.message || err}`);
    }

    if (parsed) {
      try {
        return {
          projectId: parsed.project_id || projectId,
          credential: cert(parsed),
        };
      } catch (err) {
        problems.push(describeServiceAccountProblem(filePath, parsed, err));
      }
    }
  }

  // 3. Application Default Credentials (ADC).
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { projectId, credential: applicationDefault() };
  }

  // A credential WAS supplied but none of them worked. Saying "no credentials
  // configured" here would be false and is what makes this failure so slow to
  // diagnose — report what was actually wrong with each one.
  if (problems.length > 0) {
    const msg =
      "Firebase Admin SDK could not use any of the credentials it was given:\n" +
      problems.map((p) => `  - ${p}`).join("\n");
    console.error("[firebase-admin] " + msg);
    throw new Error(msg);
  }

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

