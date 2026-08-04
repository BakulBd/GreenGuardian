/**
 * Secure OTP + registration utility helpers.
 *
 * - OTP generation uses Node's `crypto.randomInt` (CSPRNG)
 * - OTPs are stored as SHA-256 hashes (never in plaintext)
 * - Password is encrypted at rest with AES-256-GCM
 * - Verification tokens use `crypto.randomBytes`
 *
 * This module is server-only (uses `node:crypto`). It is imported by the
 * registration API routes. Never import from client components.
 */
import crypto from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const OTP_MAX_SENDS = 5; // max sends per registration (initial + resends)
export const OTP_MAX_ATTEMPTS = 5; // max verify attempts per registration
export const OTP_LENGTH = 6;

const ENC_ALGO = "aes-256-gcm";
const KEY_BYTE_LEN = 32;

/**
 * Generate a cryptographically-secure random 6-digit OTP.
 */
export function generateOtp(): string {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH - 1;
  return crypto.randomInt(min, max).toString();
}

/**
 * SHA-256 hash a plaintext OTP so we never store the raw value.
 */
export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

/**
 * Constant-time comparison for OTP hashes (prevents timing attacks).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a random verification token for a registration session.
 */
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Resolve the AES-256-GCM encryption key from env, deriving a deterministic
 * key from `REGISTRATION_ENC_KEY` if it is shorter than 32 bytes.
 */
function getEncryptionKey(): Buffer {
  const raw =
    process.env.REGISTRATION_ENC_KEY ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "greenguardian2026_default_registration_encryption_key_secret";

  // If a 32-byte hex key is provided use it directly, otherwise derive via SHA-256.
  if (Buffer.from(raw, "hex").length === KEY_BYTE_LEN) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns `iv:authTag:ciphertext` (hex) so no extra storage is needed.
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted]
    .map((buf) => buf.toString("hex"))
    .join(":");
}

/**
 * Decrypt a string previously produced by `encryptSecret`.
 */
export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted payload");
  }
  const decipher = crypto.createDecipheriv(
    ENC_ALGO,
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Generate a masked preview of the user's email for display. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(0, local.length - 2))}@${domain}`;
}

