/**
 * Dual-mode pending registration store.
 *
 * Mode A: Firebase Admin SDK is configured → uses Firestore `pendingRegistrations`
 *         collection (shared, transactional, survives restarts).
 * Mode B: No Admin SDK credentials (local dev / edge without a service account)
 *         → uses an encrypted JSON file scoped to the server process.
 *
 * Both modes expose the same minimal API so the OTP route handlers don't need
 * to know which backend is in use.
 *
 * The file store encrypts each record with the same AES-256-GCM helper used for
 * passwords, so at-rest data is not readable by casual inspection.
 */
import fs from "node:fs";
import path from "node:path";
import { isAdminSdkConfigured, getAdminDb } from "./firebase/admin";
import { encryptSecret, decryptSecret } from "./otp";

// ---------------------------------------------------------------------------
// Shared record shape
// ---------------------------------------------------------------------------
export interface PendingRegistration {
  email: string;
  name: string;
  password: string; // encrypted at rest
  role: "student" | "teacher";
  otpHash: string;
  verificationToken: string;
  expiresAt: number; // epoch ms
  sendCount: number;
  attempts: number;
  lastSentAt: number; // epoch ms
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Admin SDK (Firestore) mode
// ---------------------------------------------------------------------------
function toAdminRecord(doc: FirebaseFirestore.DocumentSnapshot<any>): PendingRegistration | null {
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    email: d.email,
    name: d.name,
    password: d.password,
    role: d.role,
    otpHash: d.otpHash,
    verificationToken: d.verificationToken,
    expiresAt: d.expiresAt?.toMillis?.() || 0,
    sendCount: d.sendCount || 0,
    attempts: d.attempts || 0,
    lastSentAt: d.lastSentAt?.toMillis?.() || 0,
    createdAt: d.createdAt?.toMillis?.() || Date.now(),
    updatedAt: d.updatedAt?.toMillis?.() || Date.now(),
  };
}

// ---------------------------------------------------------------------------
// File mode
// ---------------------------------------------------------------------------
const FILE_STORE_DIR =
  process.env.PENDING_REGISTRATIONS_DIR || path.join(process.cwd(), ".data");

function filePath(email: string): string {
  const safe = Buffer.from(email.toLowerCase()).toString("base64url");
  return path.join(FILE_STORE_DIR, `${safe}.json`);
}

function ensureDir() {
  fs.mkdirSync(FILE_STORE_DIR, { recursive: true });
}

function readFileRecord(email: string): PendingRegistration | null {
  try {
    ensureDir();
    const p = filePath(email);
    if (!fs.existsSync(p)) return null;
    const raw = decryptSecret(JSON.parse(fs.readFileSync(p, "utf8")).cipher);
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    return null;
  }
}

function writeFileRecord(rec: PendingRegistration) {
  ensureDir();
  const p = filePath(rec.email);
  const cipher = encryptSecret(JSON.stringify(rec));
  fs.writeFileSync(p, JSON.stringify({ cipher, updatedAt: Date.now() }), "utf8");
}

function deleteFileRecord(email: string) {
  try {
    ensureDir();
    const p = filePath(email);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Public API (route handlers use only these)
// ---------------------------------------------------------------------------
export function registrationStoreEnabled(): boolean {
  return true;
}

export async function getPending(email: string): Promise<PendingRegistration | null> {
  if (isAdminSdkConfigured()) {
    try {
      const db = getAdminDb();
      const doc = await db.collection("pendingRegistrations").doc(email.toLowerCase()).get();
      return toAdminRecord(doc);
    } catch (e) {
      console.warn("[registration-store] Admin read failed:", e);
      return null;
    }
  }
  return readFileRecord(email.toLowerCase());
}

export async function upsertPending(rec: PendingRegistration): Promise<void> {
  const email = rec.email.toLowerCase();
  if (isAdminSdkConfigured()) {
    const db = getAdminDb();
    await db.collection("pendingRegistrations").doc(email).set({
      email: rec.email,
      name: rec.name,
      password: rec.password,
      role: rec.role,
      otpHash: rec.otpHash,
      verificationToken: rec.verificationToken,
      expiresAt: new Date(rec.expiresAt),
      sendCount: rec.sendCount,
      attempts: rec.attempts,
      lastSentAt: new Date(rec.lastSentAt),
      createdAt: rec.createdAt ? new Date(rec.createdAt) : new Date(),
      updatedAt: new Date(rec.updatedAt),
    });
    return;
  }
  writeFileRecord({ ...rec, email });
}

export async function updatePending(
  email: string,
  patch: Partial<Omit<PendingRegistration, "email">>
): Promise<void> {
  const existing = await getPending(email);
  if (!existing) throw new Error("PENDING_NOT_FOUND");
  await upsertPending({ ...existing, ...patch, email: existing.email, updatedAt: Date.now() });
}

export async function consumePending(email: string, expectedOtpHash: string): Promise<PendingRegistration | null> {
  const existing = await getPending(email);
  if (!existing || existing.otpHash !== expectedOtpHash) return null;
  if (Date.now() > existing.expiresAt) return null;
  await deletePending(email);
  return existing;
}

export async function deletePending(email: string): Promise<void> {
  if (isAdminSdkConfigured()) {
    try {
      const db = getAdminDb();
      await db.collection("pendingRegistrations").doc(email.toLowerCase()).delete();
    } catch (e) {
      console.warn("[registration-store] Admin delete failed:", e);
    }
    return;
  }
  deleteFileRecord(email.toLowerCase());
}

