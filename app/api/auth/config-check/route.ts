import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Diagnostics endpoint: reports which server-side config is present/missing so
 * registration failures can be diagnosed quickly. Safe to call from the browser
 * (it only reveals boolean presence + projectId, never secrets).
 */
export async function GET() {
  const hasServiceAccountFile = (() => {
    try {
      const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), "serviceAccountKey.json");
      return fs.existsSync(p);
    } catch {
      return false;
    }
  })();

  const hasAdc = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const status = {
    environment: process.env.NODE_ENV || "development",
    adminSdk: {
      // true when at least one credential source is configured
      configured: !!(
        process.env.FIREBASE_SERVICE_ACCOUNT ||
        hasServiceAccountFile ||
        hasAdc ||
        process.env.USE_FIREBASE_EMULATOR === "true"
      ),
      hasInlineServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      hasServiceAccountFile,
      hasAdc,
      emulatorMode: process.env.USE_FIREBASE_EMULATOR === "true",
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "greenguardian2026",
    },
    email: {
      smtpConfigured: !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.MAIL_FROM
      ),
      mode: (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM) ? "smtp" : "dev-console-fallback",
    },
    encryption: {
      encKeyConfigured: !!process.env.REGISTRATION_ENC_KEY,
    },
  };

  return NextResponse.json(status);
}

