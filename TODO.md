# TODO — Email Verification for Registration

## Steps

- [x] Explore repo & build plan (approved)
- [x] Install dependencies (`nodemailer`, `@types/nodemailer`)
- [x] Create `lib/firebase/admin.ts` (Firebase Admin SDK init)
- [x] Create `lib/otp.ts` (secure OTP generation/hashing, password encryption, expiry)
- [x] Create `lib/email/templates/otp.ts` (branded OTP email HTML)
- [x] Create `lib/email/send.ts` (nodemailer sender + dev console fallback)
- [x] Create `app/api/auth/register/route.ts` (validate → store pending → send OTP)
- [x] Create `app/api/auth/resend-otp/route.ts` (60s cooldown, invalidate previous OTP)
- [x] Create `app/api/auth/verify-otp/route.ts` (single-use, expire, attempts, create account)
- [x] Create `components/ui/otp-input.tsx` (6-box OTP input)
- [x] Create `app/verify-email/page.tsx` (verification UI)
- [x] Modify `app/register/page.tsx` (new flow: send OTP, redirect to verify)
- [x] Update `next.config.js` (`serverExternalPackages`)
- [x] Update `lib/types/index.ts` (add `emailVerified`)
- [x] Update `firestore.rules` (deny client access to `pendingRegistrations`)
- [x] Create `.env.example` (document SMTP / enc key / service account)
- [x] Update `README.md`
- [x] Run `npm run build` — passed (compiled, TS check passed, all routes generated)

## Full Build Verified
- `next build` ✅ — Compiled successfully (2.5 min), TypeScript passed (50s), 40/40 static pages generated
- Acknowledged warnings (pre-existing): `images.domains` deprecation, `middleware` → `proxy` convention

## Debugging: "Registration failed" fix (root cause)
**Root cause:** `app/api/auth/register` called `getAdminAuth()`/`getAdminDb()` at the top level, OUTSIDE try/catch. When the Firebase Admin SDK credentials were missing, it threw an unhandled error → Next.js returned an HTML 500 → the frontend couldn't parse JSON → generic "Registration failed".

**Verified with `/api/auth/config-check`:** `adminSdk.configured: false`, `encKeyConfigured: false` before fix.

**Fix applied:**
- All 3 API routes now wrap Admin SDK init + DB + email ops in try/catch → always return structured JSON with a precise `error` (+ dev `detail`).
- `lib/firebase/admin.ts` rewritten: lazy init cache, credential resolution (FIREBASE_SERVICE_ACCOUNT → serviceAccountKey.json → ADC → emulator), and a clear thrown error with setup instructions.
- New `app/api/auth/config-check/route.ts` diagnostics endpoint: reports which config is present/missing.
- Frontend `app/register/page.tsx` now surfaces the server's exact `error`/`detail` message.
- `.env.local` updated with a generated `REGISTRATION_ENC_KEY` (64 hex chars).
- `.env.local.example` documents all required server-side env vars.

**Remaining requirement for the user to complete:** provide Firebase Admin SDK credentials via `FIREBASE_SERVICE_ACCOUNT` env var or a `serviceAccountKey.json` in the project root (Firebase Console → Project Settings → Service accounts → Generate new private key). Without these, the server cannot look up existing users or create accounts post-OTP.

## Added developer setup tooling (helps finish the credential step)
- `scripts/setup-email-verification.mjs` — prints a live status report of every server-side env var the OTP flow needs, auto-generates `REGISTRATION_ENC_KEY` if missing, and gives the exact steps to obtain the missing Firebase Admin credentials. Run with `npm run setup:email`.
- `firebase.json` — added `emulators` block (auth 9099, firestore 8080, storage 9199, UI 4000) so local dev can run fully credential-less with `npm run emulators` + `USE_FIREBASE_EMULATOR=true`. Note: Firestore emulator requires Java.
- `lib/firebase/admin.ts` — emulator mode now sets the `*_EMULATOR_HOST` vars automatically (only `USE_FIREBASE_EMULATOR=true` needed).
- `package.json` — added `"setup:email"` script.
- Verified: `npx tsc --noEmit` exits 0; `npm run build` passes with all routes compiled.

## Final state
The console error the user saw is working as designed: the API now surfaces the exact blocker (missing Admin SDK credentials) as a structured JSON error instead of a vague "Registration failed". The flow is fully implemented and build-verified. The only remaining step to run the flow end-to-end is supplying the Admin SDK credentials (or enabling emulator mode).

## Zero-credential fallback added (local dev / no service account)
- New `lib/firebase/rest-client.ts` — Firebase Auth `accounts:signUp` + Firestore REST commit using a freshly-minted idToken, so account creation works with only the public web API key (no service account needed).
- New `lib/firebase/user-lookup.ts` — email-exists check via Admin SDK OR REST `accounts:lookup`.
- New `lib/registration-store.ts` — dual-mode pending-store abstraction (Firestore via Admin SDK OR encrypted local file store under `.data/`).
- All three API routes (`register`, `resend-otp`, `verify-otp`) now transparently support both modes.
- Verified live in dev:
  - `POST /api/auth/register` → success (emailMode `dev`, verificationToken returned) ✅
  - `POST /api/auth/resend-otp` → success, new token each time (previous OTP invalidated) ✅
  - `POST /api/auth/verify-otp` with bad token → clean JSON error (400) ✅
  - `GET /api/auth/config-check` → accurate status ✅
- `npx tsc --noEmit` passes (exit 0). `npm run build` passes (compiled, TS OK, 40/40 pages).

