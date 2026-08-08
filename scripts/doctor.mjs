#!/usr/bin/env node
/**
 * GreenGuardian data doctor.
 *
 * Diagnoses (and optionally repairs) the account/roster problems that silently
 * break registration, notices and exam visibility.
 *
 *   node scripts/doctor.mjs            # report only — changes nothing
 *   node scripts/doctor.mjs --fix      # apply the safe, unambiguous repairs
 *
 * Checks
 * ------
 *  1. Orphaned Auth accounts — a sign-in account with no `users/{uid}` profile.
 *     These are the wreckage of the `allowMissing` REST bug: the account was
 *     created, the profile write 400'd, and the user was then told "an account
 *     with this email already exists" on every retry. NOT auto-deleted:
 *     /api/auth/verify-otp now adopts them when the person re-registers, which
 *     preserves whatever role they actually pick. Deleting is offered
 *     separately via --delete-orphans.
 *  2. Profiles with no Auth account — a user document nobody can sign in as.
 *  3. Malformed roles — whitespace or casing that makes `role == 'teacher'`
 *     false in the security rules, locking the user out of their own features.
 *     Repaired by --fix: it is unambiguous corruption.
 *  4. Students with no `assignedTeacherIds` — they receive NO notices and NO
 *     exams, not even ones addressed to "all". Reported by batch/section so an
 *     admin knows which assignments to create.
 *  5. Expired pending registrations left in the store.
 */
import { cert, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from "node:fs";
import path from "node:path";

const FIX = process.argv.includes("--fix");
const DELETE_ORPHANS = process.argv.includes("--delete-orphans");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) };
  }
  const file =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "serviceAccountKey.json");
  if (fs.existsSync(file)) {
    const sa = JSON.parse(fs.readFileSync(file, "utf8"));
    return { credential: cert(sa), projectId: sa.project_id };
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { credential: applicationDefault() };
  }
  console.error(
    "No Firebase Admin credentials found. Set FIREBASE_SERVICE_ACCOUNT, add\n" +
      "serviceAccountKey.json to the project root, or set GOOGLE_APPLICATION_CREDENTIALS."
  );
  process.exit(1);
}

const app = initializeApp(credential());
const db = getFirestore(app);
const auth = getAuth(app);

const h = (s) => console.log(`\n${s}\n${"-".repeat(s.length)}`);
let issues = 0;
let repaired = 0;

// ---------------------------------------------------------------- load ----
const [profilesSnap, authList] = await Promise.all([
  db.collection("users").get(),
  (async () => {
    const all = [];
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      all.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken);
    return all;
  })(),
]);

const profilesByUid = new Map(profilesSnap.docs.map((d) => [d.id, d.data()]));
const authByUid = new Map(authList.map((u) => [u.uid, u]));

console.log(
  `Loaded ${authList.length} Auth accounts and ${profilesSnap.size} user profiles.`
);

// -------------------------------------------- 1. orphaned Auth accounts ----
h("1. Orphaned Auth accounts (sign-in exists, no profile)");
const orphans = authList.filter((u) => !profilesByUid.has(u.uid));
if (orphans.length === 0) {
  console.log("None. ✓");
} else {
  issues += orphans.length;
  orphans.forEach((u) =>
    console.log(
      `  ${u.email || "(no email)"}  uid=${u.uid}  created=${u.metadata.creationTime}`
    )
  );
  console.log(
    `\n  ${orphans.length} account(s). These users cannot sign in (no profile) and\n` +
      "  previously could not re-register either. With the verify-otp fix they can\n" +
      "  now simply register again with the same email — the account is adopted and\n" +
      "  repaired, keeping whatever role they choose.\n" +
      "  Pass --delete-orphans to remove them instead (irreversible)."
  );
  if (DELETE_ORPHANS) {
    for (const u of orphans) {
      await auth.deleteUser(u.uid);
      console.log(`  deleted ${u.email}`);
      repaired++;
    }
  }
}

// ------------------------------------------ 2. profiles with no account ----
h("2. Profiles with no Auth account (nobody can sign in as them)");
const ghosts = profilesSnap.docs.filter((d) => !authByUid.has(d.id));
if (ghosts.length === 0) {
  console.log("None. ✓");
} else {
  issues += ghosts.length;
  ghosts.forEach((d) =>
    console.log(`  ${d.data().email || "(no email)"}  id=${d.id}  role=${d.data().role}`)
  );
  console.log(
    "\n  Usually leftover seed/placeholder rows. Review and delete from the admin\n" +
      "  panel; this script will not remove profile data automatically."
  );
}

// ----------------------------------------------------- 3. broken roles ----
h("3. Malformed role values");
const VALID = ["student", "teacher", "admin"];
const badRoles = profilesSnap.docs.filter((d) => {
  const r = d.data().role;
  return typeof r === "string" && !VALID.includes(r) && VALID.includes(r.trim().toLowerCase());
});
const unknownRoles = profilesSnap.docs.filter((d) => {
  const r = d.data().role;
  return typeof r !== "string" || !VALID.includes(String(r).trim().toLowerCase());
});
if (badRoles.length === 0 && unknownRoles.length === 0) {
  console.log("None. ✓");
} else {
  issues += badRoles.length + unknownRoles.length;
  for (const d of badRoles) {
    const raw = d.data().role;
    const clean = raw.trim().toLowerCase();
    console.log(
      `  ${d.data().email}  role=${JSON.stringify(raw)} -> ${JSON.stringify(clean)}` +
        "   (security rules currently treat this account as having NO role)"
    );
    if (FIX) {
      await d.ref.update({ role: clean, updatedAt: new Date() });
      console.log("    fixed");
      repaired++;
    }
  }
  unknownRoles.forEach((d) =>
    console.log(`  ${d.data().email}  role=${JSON.stringify(d.data().role)}  UNRECOGNISED — fix manually`)
  );
}

// ------------------------------------------- 4. students with no teacher ----
h("4. Students with no assigned teacher (receive no notices or exams)");
const students = profilesSnap.docs.filter(
  (d) => String(d.data().role || "").trim() === "student"
);
const uncovered = students.filter(
  (d) => ((d.data().assignedTeacherIds || []).length === 0)
);
if (uncovered.length === 0) {
  console.log("None. ✓");
} else {
  issues += uncovered.length;
  const groups = new Map();
  for (const d of uncovered) {
    const u = d.data();
    const key = `${u.batch || "no-batch"} / ${u.section || u.sections?.[0] || "no-section"}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  console.log(
    `  ${uncovered.length} of ${students.length} students are not covered by any assignment:\n`
  );
  [...groups.entries()]
    .sort()
    .forEach(([g, n]) => console.log(`    Batch/Section ${g.padEnd(22)} ${n} student(s)`));
  console.log(
    "\n  Fix in Admin -> Teacher Assignments: create an assignment for each group,\n" +
      "  then click \"Sync Assignment Visibility\"."
  );
}

// ------------------------------------- 5. stale pending registrations ----
h("5. Expired pending registrations");
const pendingSnap = await db.collection("pendingRegistrations").get();
const now = Date.now();
const stale = pendingSnap.docs.filter((d) => {
  const e = d.data().expiresAt;
  const ms = e?.toMillis ? e.toMillis() : new Date(e).getTime();
  return !ms || ms < now;
});
if (stale.length === 0) {
  console.log(`None (${pendingSnap.size} pending). ✓`);
} else {
  issues += stale.length;
  stale.forEach((d) => console.log(`  ${d.id}  expired`));
  if (FIX) {
    for (const d of stale) {
      await d.ref.delete();
      repaired++;
    }
    console.log(`  deleted ${stale.length} expired record(s)`);
  }
}

// ---------------------------------------------------------------- done ----
console.log(
  `\n${"=".repeat(60)}\n` +
    `${issues} issue(s) found` +
    (FIX || DELETE_ORPHANS ? `, ${repaired} repaired` : " — re-run with --fix to repair") +
    `\n${"=".repeat(60)}`
);
process.exit(0);
