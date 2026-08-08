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
function parseTimestamp(val: any): number {
  if (!val) return 0;
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val?.getTime === "function") return val.getTime();
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

function toAdminRecord(doc: FirebaseFirestore.DocumentSnapshot<any>): PendingRegistration | null {
  if (!doc.exists) return null;
  const d = doc.data();
  if (!d) return null;
  return {
    email: d.email,
    name: d.name,
    password: d.password,
    role: d.role,
    otpHash: d.otpHash,
    verificationToken: d.verificationToken,
    expiresAt: parseTimestamp(d.expiresAt),
    sendCount: d.sendCount || 0,
    attempts: d.attempts || 0,
    lastSentAt: parseTimestamp(d.lastSentAt),
    createdAt: parseTimestamp(d.createdAt) || Date.now(),
    updatedAt: parseTimestamp(d.updatedAt) || Date.now(),
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
// In-Memory fallback store for read-only serverless filesystems & local dev
// ---------------------------------------------------------------------------
const memoryStore = new Map<string, PendingRegistration>();

export function registrationStoreEnabled(): boolean {
  return true;
}

export async function getPending(email: string): Promise<PendingRegistration | null> {
  const cleanEmail = email.toLowerCase().trim();
  if (isAdminSdkConfigured()) {
    try {
      const db = getAdminDb();
      const doc = await db.collection("pendingRegistrations").doc(cleanEmail).get();
      const rec = toAdminRecord(doc);
      if (rec) return rec;
    } catch (e) {
      console.warn("[registration-store] Admin read failed, trying fallbacks:", e);
    }
  }

  const fileRec = readFileRecord(cleanEmail);
  if (fileRec) return fileRec;

  const memRec = memoryStore.get(cleanEmail);
  if (memRec && Date.now() < memRec.expiresAt) {
    return memRec;
  }
  return null;
}

export async function upsertPending(rec: PendingRegistration): Promise<void> {
  const email = rec.email.toLowerCase().trim();
  memoryStore.set(email, { ...rec, email });

  if (isAdminSdkConfigured()) {
    try {
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
    } catch (e) {
      console.warn("[registration-store] Admin upsert failed, stored in memory & file:", e);
    }
  }

  try {
    writeFileRecord({ ...rec, email });
  } catch (e) {
    console.warn("[registration-store] File write failed, saved in memory:", e);
  }
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
  const cleanEmail = email.toLowerCase().trim();
  memoryStore.delete(cleanEmail);
  if (isAdminSdkConfigured()) {
    try {
      const db = getAdminDb();
      await db.collection("pendingRegistrations").doc(cleanEmail).delete();
    } catch (e) {
      console.warn("[registration-store] Admin delete failed:", e);
    }
  }
  deleteFileRecord(cleanEmail);
}

