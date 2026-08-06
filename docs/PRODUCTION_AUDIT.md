# GreenGuardian — Production Readiness Audit

Full-stack review before deployment to **Vercel** (frontend) + **Firebase Spark /
free plan** (auth, Firestore, Storage).

**How this was verified.** Everything below was found by reading the code and
confirmed with the toolchain: `npm run typecheck` (0 errors), `npm run lint`
(0 errors), `npm test` (27 passing), and `npm run build` (clean, no warnings,
41/41 routes). What could *not* be executed here is called out in
[§7 Not verified](#7-not-verified-needs-a-live-environment) — there is no
Firebase project, browser, or real user in this environment, so live workflow
runs and cross-browser checks remain yours to do.

---

## 1. Critical bugs fixed

### 1.1 Auto-submit discarded the student's answers

`ExamClient` ran its countdown in an effect keyed on `[examStarted]` and called
`handleSubmit(true)` directly. That closure was captured when the exam started,
so it saw `answers` as they were **at that moment** — empty. When the timer ran
out (or the warning limit tripped), the exam was submitted with no answers and a
zero score. The same staleness hit `addWarning` in the tab-visibility listener.

Fixed by routing both through refs that are refreshed on every render
(`handleSubmitRef`, `addWarningRef`).

### 1.2 The Gemini API key was shipped to every browser

`ExamClient` and the teacher answers page imported `lib/utils/gemini.ts`
directly. It read `NEXT_PUBLIC_GEMINI_API_KEY`, and a `NEXT_PUBLIC_` variable is
inlined into the client bundle — anyone could read the key from devtools and
spend the project's quota.

- Browser code now calls `lib/utils/ai-client.ts`, which posts to `/api/ocr`.
- `getGeminiClient()` reads **`GEMINI_API_KEY`** only (server-side).
- `NEXT_PUBLIC_GEMINI_API_KEY` removed from the code and from `.env.local.example`.

### 1.3 `/api/ocr` was an unauthenticated proxy to paid AI quota

Anyone on the internet could POST to it. It now:

- requires a Firebase ID token (`Authorization: Bearer …`), verified with the
  Admin SDK, and **fails closed** if the Admin SDK is not configured;
- rate-limits to 20 requests/minute per user;
- rejects non-`http(s)` file URLs, more than 10 files, and text over 100 KB.

### 1.4 …and it could not have worked anyway

`urlToBase64()` used `FileReader`, a browser-only API, inside a route handler
that runs in Node. Rewritten with `arrayBuffer()` + `Buffer`, so it works in both
environments.

### 1.5 Teachers could not delete a notice

`deleteNotice()` deleted the notice's `noticeReads` and `notifications` first,
but the rules allowed neither (`noticeReads` had no delete rule at all;
`notifications` was admin-only). The first denial threw and the notice itself was
never deleted — so **any notice a student had read became undeletable**.

- Rules: `noticeReads` and `notifications` are now deletable by teachers/admins.
- Code: cleanup is best-effort per document and can no longer block the delete.

### 1.6 Students could read notices addressed to other students

Every published notice was downloaded and filtered in the browser, and the rules
allowed a student to read any published notice — including `individual` ones
meant for one person.

`getStudentNotices()` now issues narrow, equality-only queries (`all`,
`individual` + `array-contains uid`, batch/semester, section, course) and the
rules mirror those conditions exactly. Side benefits: no composite index is
required, and notices missing `publishedAt` are no longer silently dropped by an
`orderBy` (they are sorted in memory, falling back to `createdAt`).

> ⚠️ The rules and `getStudentNotices()` are a matched pair. If you change the
> targeting conditions in one, change the other, or student notice lists will
> fail with `permission-denied`.

### 1.7 Unprotected exam routes

`/exam` and `/exam/[id]` render outside `DashboardLayout` and had no auth guard.
Logged-out visitors hit a spinner that never resolved (all reads denied) instead
of being redirected. Both now redirect to `/login?next=…`, `/exam/[id]`
additionally rejects non-student roles, and the login page honours `next` —
restricted to same-site paths so it cannot be used as an open redirect.

### 1.8 Oversized uploads would destroy a submission

When Cloud Storage is unavailable (it is not enabled on every Firebase project,
and CORS or a captive network can block it), uploads fall back to a base64 data
URL stored inside the answer document. Firestore caps documents at 1 MiB and
base64 adds ~33%, so a large file produced an `invalid-argument` error at submit
time and the student lost their work. The fallback now refuses files over 600 KB
with a message that says what to do.

### 1.9 Public configuration-diagnostics endpoint

`/api/auth/config-check` reported which credential sources and SMTP settings are
live. No secret values, but useful reconnaissance. In production it now requires
`CONFIG_CHECK_TOKEN` and otherwise returns 404; it stays open in development.

---

## 2. Fixed in the preceding live-video pass

Documented in [`EXAM_SYSTEM_ANALYSIS.md`](EXAM_SYSTEM_ANALYSIS.md): live video
that only worked on one PC, sessions that reset the exam clock on refresh,
ghost students in the monitoring grid, and read amplification that would have
exhausted the Spark quota within minutes of an exam starting.

---

## 3. Cleanup and refactoring

| Change | Why |
|--------|-----|
| Deleted `middleware.ts` | A no-op placeholder that returned `NextResponse.next()`. It also produced the only build warning ("middleware is deprecated, use proxy"). Auth is client-side + rules-enforced; a middleware cannot verify a Firebase session without a session cookie. |
| Deleted `lib/utils/ocr.ts`, `lib/utils/plagiarism.ts` | Imported by nothing. |
| Removed 16 unused dependencies | `tesseract.js`, `@mediapipe/face_mesh`, `@tensorflow-models/face-landmarks-detection`, `natural`, `string-similarity`, `recharts`, `date-fns`, `zod`, `sonner`, `react-hook-form`, `@hookform/resolvers`, `dotenv`, and 4 unused Radix packages — 95 packages gone from the install. |
| Moved `typescript` / `@types/*` to devDependencies | They were in `dependencies`. |
| Rewrote `lib/firebase/config.ts` | The init logic was duplicated across both branches of an `if/else` and could connect the emulators twice. Also: the emulator flag is now `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` (a bare server variable is `undefined` in the browser, so the old check never fired client-side), and Analytics is lazily imported behind `isSupported()` instead of being pulled into the main bundle. |
| Added ESLint config + `lint` / `typecheck` / `test` scripts | `next lint` was removed in Next 16 and no ESLint config existed, so linting silently did nothing. |
| Fixed a11y and entity-escape warnings | Renamed the lucide `Image` icon import that `jsx-a11y` flagged as an `<img>` without `alt`. |

---

## 4. New production hardening

- **`components/ErrorBoundary.tsx`** — wraps the whole app. A throw from a shared
  provider or a listener used to blank the page; during an exam that reads as a
  lost attempt. Now shows a recoverable screen with retry/reload.
- **`components/NetworkStatus.tsx`** — an offline/reconnected banner. Firestore
  queues writes offline and replays them, so work is not lost, but without
  feedback students panic and refresh (which is worse). The banner says so
  explicitly.
- **Test suite** — Vitest with 27 tests over the pure logic that decides grades
  and cheating verdicts: validation, behaviour scoring and its diminishing
  returns, the practical cheating score, and live-video transport/ICE selection.

---

## 5. Firebase Spark (free plan) compatibility

Nothing in the app requires a paid plan.

| Concern | Status |
|---------|--------|
| Cloud Functions | **Not used.** All logic is client-side or in Vercel route handlers. |
| Firestore reads | The teacher live grid used to re-query every student's violations on every snapshot; now cached (20s TTL). |
| Firestore writes | Live-video relay writes only while a teacher is watching, and drops to a 15s heartbeat once WebRTC connects. Answer autosave is one write per 15s per student. |
| Composite indexes | `firestore.indexes.json` covers the remaining ordered queries; the new student-notice queries are equality-only and need none. |
| Cloud Storage | Not enabled on every Firebase project. Uploads degrade to inline data URLs, now with a size guard (§1.8). |
| Outbound email | SMTP via nodemailer from a Vercel route — no Firebase extension needed. |

**Deploy checklist**

1. `npm run firebase:deploy:rules` — **required.** This release changes the
   rules (notices, noticeReads, notifications, liveFrames, liveVideoSignaling).
   Deploying the app without them breaks student notices and live video.
2. Vercel env vars: `GEMINI_API_KEY` (server-only), `FIREBASE_SERVICE_ACCOUNT`,
   `REGISTRATION_ENC_KEY`, SMTP settings, optionally `NEXT_PUBLIC_TURN_*` and
   `CONFIG_CHECK_TOKEN`.
3. Remove any `NEXT_PUBLIC_GEMINI_API_KEY` currently set — a key that has been in
   a client bundle should be considered compromised and rotated.

---

## 6. Known limitations (deliberately not changed)

1. **Grading runs in the browser.** `handleSubmit()` fetches the exam document —
   including `correctAnswer` — to compute the score. A student can read the
   answers from network traffic before submitting. Fixing this properly means
   moving grading to a server route, which changes the submission contract and
   needs its own testing pass. It is the single biggest integrity gap left.
2. **One attempt per exam is enforced in the UI**, not by rules. A crafted client
   could still create a second session document.
3. **41 `react-hooks/exhaustive-deps` warnings remain.** They are all the
   load-once-when-the-user-arrives pattern (`useEffect(… , [user])` calling a
   `loadX` defined in the component). Each was checked: the loaders only read
   values already in the dependency array. Adding them without `useCallback`
   causes render loops, and wrapping ~20 loaders is a mechanical refactor with
   more regression risk than the warnings carry. The rule stays enabled so new
   violations surface.
4. **`liveVideoSignaling/**/viewers` is readable/writable by any signed-in user.**
   SDP/ICE blobs are ephemeral and useless without the peer, but scoping writes
   to the owning student and staff would be tighter.

---

## 7. Not verified (needs a live environment)

This audit is static plus toolchain. The following require a real Firebase
project, browsers, and users, and are **not** claimed as tested:

- End-to-end runs of registration/OTP, login, exam-taking, submission, grading,
  notice delivery, and admin CRUD against live Firestore.
- The rewritten notice rules against real documents — deploy them to a staging
  project and confirm students see exactly their own notices before going live.
- Live video between two devices on different networks (and TURN, if configured).
- Cross-browser and mobile-device testing; responsive layouts were reviewed in
  code (Tailwind breakpoints are used throughout) but not rendered.
- Load behaviour with many concurrent students.
