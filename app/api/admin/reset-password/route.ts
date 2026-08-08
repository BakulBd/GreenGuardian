/**
 * Admin-initiated password reset.
 *
 * Two modes:
 *   - `mode: "link"`   (default) — email the user a reset link. The admin never
 *                      learns the password; the user chooses their own.
 *   - `mode: "set"`    — set a temporary password directly and hand it back to
 *                      the admin once, for users who can't receive email.
 *
 * Unlike the self-serve endpoint this one DOES report "no such user": the
 * caller is already a trusted admin, and silently doing nothing would be worse
 * than useless when they're trying to unblock someone.
 *
 * `POST` accepts either a single `userId`/`email`, or `userIds: string[]` for a
 * bulk reset (e.g. an entire section at the start of a term).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BULK = 200;
const TEMP_PASSWORD_LENGTH = 12;

/** Ambiguity-free alphabet: no O/0, I/l/1 — these get read aloud and retyped. */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;

  const bytes = new Uint32Array(TEMP_PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);

  // Guarantee one of each class so the result always satisfies a strict policy.
  const chars = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
  ];
  for (let i = 4; i < TEMP_PASSWORD_LENGTH; i++) {
    chars.push(all[bytes[i] % all.length]);
  }

  // Fisher-Yates with fresh randomness so the class positions aren't fixed.
  const shuffle = new Uint32Array(chars.length);
  crypto.getRandomValues(shuffle);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface ResetBody {
  userId?: string;
  email?: string;
  userIds?: string[];
  mode?: "link" | "set";
}

interface ResetOutcome {
  userId?: string;
  email: string;
  name?: string;
  success: boolean;
  error?: string;
  /** Only present for mode "set" — shown to the admin once, never stored. */
  temporaryPassword?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "reset passwords");
  if (auth instanceof NextResponse) return auth;

  const rate = checkRateLimit(
    `admin-reset-password:${auth.uid}:${getClientIp(req)}`,
    20,
    60_000
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  let body: ResetBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const mode = body.mode === "set" ? "set" : "link";
  const db = getAdminDb();
  const adminAuth = getAdminAuth();

  // --- Resolve the target list to {uid, email, name} ---
  const targets: { uid?: string; email: string; name?: string }[] = [];

  const ids = body.userIds?.length ? body.userIds : body.userId ? [body.userId] : [];
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { success: false, error: `Please reset at most ${MAX_BULK} accounts at a time.` },
      { status: 400 }
    );
  }

  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      if (!snap.exists) {
        targets.push({ uid: ids[i], email: "", name: undefined });
        continue;
      }
      const d = snap.data() || {};
      targets.push({ uid: snap.id, email: (d.email || "").toLowerCase(), name: d.name });
    }
  } else if (body.email) {
    const email = body.email.trim().toLowerCase();
    // Look the profile up so the email can be personalised, but proceed even
    // if there's no profile — an orphaned Auth account is exactly the case an
    // admin most needs to fix.
    let name: string | undefined;
    let uid: string | undefined;
    try {
      const user = await adminAuth.getUserByEmail(email);
      uid = user.uid;
      const snap = await db.collection("users").doc(user.uid).get();
      name = snap.exists ? snap.data()?.name : user.displayName || undefined;
    } catch {
      /* reported per-target below */
    }
    targets.push({ uid, email, name });
  } else {
    return NextResponse.json(
      { success: false, error: "Provide a userId, userIds array, or an email address." },
      { status: 400 }
    );
  }

  // --- Execute ---
  const results: ResetOutcome[] = [];
  for (const target of targets) {
    if (!target.email) {
      results.push({
        userId: target.uid,
        email: "",
        success: false,
        error: "This account has no email address on file.",
      });
      continue;
    }

    if (mode === "set") {
      try {
        const uid =
          target.uid || (await adminAuth.getUserByEmail(target.email)).uid;
        const temporaryPassword = generateTempPassword();
        await adminAuth.updateUser(uid, { password: temporaryPassword });
        // Flag it so the UI can nag the user to change it after signing in.
        await db
          .collection("users")
          .doc(uid)
          .set(
            {
              mustChangePassword: true,
              passwordResetAt: new Date(),
              passwordResetBy: auth.uid,
              updatedAt: new Date(),
            },
            { merge: true }
          )
          .catch((e) =>
            console.warn("[admin-reset] Could not flag mustChangePassword:", e)
          );
        results.push({
          userId: uid,
          email: target.email,
          name: target.name,
          success: true,
          temporaryPassword,
        });
      } catch (err: any) {
        results.push({
          userId: target.uid,
          email: target.email,
          name: target.name,
          success: false,
          error:
            err?.code === "auth/user-not-found"
              ? "No sign-in account exists for this email."
              : err?.message || "Failed to set a temporary password.",
        });
      }
      continue;
    }

    const sent = await sendPasswordResetEmail({
      email: target.email,
      name: target.name,
      initiatedByAdmin: true,
      adminName: auth.name,
    });

    results.push({
      userId: target.uid,
      email: target.email,
      name: target.name,
      success: sent.ok,
      error: sent.ok
        ? undefined
        : sent.userNotFound
          ? "No sign-in account exists for this email."
          : sent.error || "Failed to send the reset email.",
    });

    // Audit trail on the profile — skipped for orphaned Auth accounts, which
    // have no profile document to annotate.
    if (sent.ok && target.uid) {
      await db
        .collection("users")
        .doc(target.uid)
        .set(
          {
            passwordResetRequestedAt: new Date(),
            passwordResetBy: auth.uid,
            updatedAt: new Date(),
          },
          { merge: true }
        )
        .catch(() => {});
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  return NextResponse.json({
    success: succeeded > 0,
    mode,
    sent: succeeded,
    failed: results.length - succeeded,
    results,
  });
}
