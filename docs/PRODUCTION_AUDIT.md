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

> Items 1 and 2 were **fixed in the exam-integrity pass** — see
> [§8](#8-exam-integrity-pass-2026-08-09). They are kept here for the history.

1. ~~**Grading runs in the browser.**~~ **Fixed.** Grading moved to
   `/api/exams/grade`; the answer key no longer reaches the browser.
2. ~~**One attempt per exam is enforced in the UI**, not by rules.~~ **Fixed**
   earlier, by the `examAttemptCounters` transaction + rules (Task 4).
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

---

## 8. Exam-integrity pass (2026-08-09)

A full-project review before production deploy. Everything below was found by
reading the code; the toolchain confirms the result (`typecheck` 0 errors,
`lint` 0 errors / 34 pre-existing warnings, `test` 96 passing — up from 59 —
`build` clean, 51 routes).

Most modules came through clean. **Registration/OTP, login, email verification,
the approval flow, profile permissions, classroom join, the Course/Batch/Section
assignment and roster sync, and the notice targeting rules were all reviewed and
no correctness defects were found** — they had already been hardened by earlier
passes. Three real defects were found in the exam and plagiarism modules, and
they were serious.

### 8.1 A student could set their own exam score

`ExamClient.handleSubmit()` computed the score in the browser and wrote it into
`answers` and `examSessions`. Firestore rules cannot validate a score — checking
one requires the answer key, which the rules must not expose — so both
collections simply accepted whatever number arrived. The `examSessions` update
rule was `allow update: if isUser(resource.data.studentId)` with **no field
restriction**: a student could `PATCH` their own session with `score: 100`, and
nothing anywhere would notice.

Grading now happens in **`/api/exams/grade`** (Admin SDK), which re-reads the
session, the exam and the answer key server-side, grades with
`lib/server/grading.ts`, and writes the answer document and the session in one
batch. The route is idempotent — the answer document id *is* the session id — so
a retried submission after a dropped response updates the same document instead
of creating a second one.

The matching rules change replaces the open student update with a field
allowlist (`savedAnswers`, `updatedAt`, `status`, `submitted`, `completedAt`,
`reason`, `resumedAt`, `warnings`, `behaviorScore`, `violationCounts`,
`proctoring`). Every scoring field is now server-only. Student `create` on
`answers` is gone entirely; students may only write back the OCR result of their
own upload.

### 8.2 The answer key was readable by every student

Two paths delivered it:

- `getExam()` fetched the questions from the `questions` collection, which a
  targeted student was allowed to read — `correctAnswer` included. `ExamClient`
  deleted the field before rendering, but the key had already crossed the wire
  and sat in the browser's network log.
- `exams/{id}` carries a denormalized copy of the question array and is readable
  by every student the exam targets, so the key was also one `getDoc` away
  regardless of how the `questions` collection was locked down.

Now: students get their paper from **`/api/exams/paper`**, which strips
`correctAnswer` and `explanation` server-side; students have **no read access to
`questions` at all**; and the embedded copy on the exam document is stripped on
every write path (`stripAnswerKeys` in `lib/firebase/exams.ts`). The key reaches
the student only after submitting, via `answers/{id}.questionSnapshot`, which
the grading route writes once the attempt is over.

**`npm run migrate:answer-keys` must be run for existing exams** — see §9.

### 8.3 Plagiarism detection never actually ran for student submissions

`performSimilarityCheck()` ran in the browser and needed to read every answer
for the exam:

```js
query(collection(db, "answers"), where("examId", "==", examId))
```

Firestore rejects that query outright for a student — the `answers` read rule is
`isUser(resource.data.studentId)` and the query is not constrained to their own
id. The rejection landed in a `try/catch` that returned an empty match list, so
the check "succeeded" with zero matches and stamped **every student submission
`similarityLevel: "unique"`** — a clean bill of health that had never been
computed. Teacher-initiated runs did work (teachers may read all answers), which
is why this was easy to miss.

The comparison moved to **`/api/plagiarism/check`** (Admin SDK), where it can
actually see peer submissions. `similarityReports` is now server-written only —
previously `allow create, update: if isAuthenticated()` let the accused student
overwrite their own verdict.

Making the check work surfaced a privacy question the broken version never had
to answer: the match list names the classmates a student's answer resembled and
by how much. So the split is now explicit — the **verdict**
(`similarityScore` / `similarityLevel`) goes on the answer document, which the
student may read about their own work; the **match detail** goes only into
`similarityReports`, which is staff-read-only. The teacher Answers page loads
the breakdown from there.

### 8.4 Two smaller defects found on the way

- **Two blank answers scored 60% similar.** `"".split(" ")` yields one empty
  token, so two wordless submissions shared it and scored a perfect cosine
  match — reported as "partially similar". Fixed in
  `lib/utils/text-similarity.ts`, with a regression test.
- **Upload-mode files are `UploadResult` objects, not URL strings.** Caught
  while wiring the grading route; a string-only filter there would have silently
  dropped every uploaded file and lost the submission. `sanitizeAnswerFiles()`
  handles both shapes and is covered by tests.

### 8.5 What did not change

- **Behaviour/proctoring scores are still client-reported.** They come from the
  student's own camera and tab-visibility sensors; no server can independently
  verify them without a server-side vision pipeline. The grading route clamps
  and allowlists what it accepts, but a crafted client can still under-report
  its own violations. This is inherent to browser-based proctoring.
- **Similarity scoring does not remove stopwords**, so any two English prose
  answers score around 20% and are listed as low-percentage matches. The
  70/30 verdict bands appear to have been tuned around that, so the thresholds
  and the algorithm were left alone rather than silently re-tuned — changing
  them would move every historical score's meaning.
- The `results` / `studentWarnings` gradebook still has no authoring UI
  (unchanged, see `KNOWN_LIMITATIONS.md`).

---

## 9. Deployment runbook

Order matters — steps 1 and 2 must both happen before students take an exam.

1. **Migrate the answer keys** (once, before deploying the rules):
   ```
   npm run migrate:answer-keys -- --dry-run   # review
   npm run migrate:answer-keys                # apply
   ```
   This promotes any exam whose questions live only on the exam document into
   the `questions` collection, then strips `correctAnswer`/`explanation` from
   the student-readable copy. Running it **before** the rules deploy matters:
   afterwards students cannot read `questions`, so an exam whose key exists
   nowhere else would be ungradable. It is idempotent.

2. **Deploy the rules** — required, not optional:
   ```
   npm run firebase:deploy:rules
   ```
   This release changes `questions` (student read removed), `examSessions`
   (student field allowlist), `answers` (no student create; OCR-only update)
   and `similarityReports` (server-written only). Deploying the app without
   the rules leaves the score-writing hole open.

3. **Vercel environment.** `FIREBASE_SERVICE_ACCOUNT` is now **load-bearing for
   exams**, not just for email and OCR: `/api/exams/paper` and
   `/api/exams/grade` fail closed without it, so students cannot open or submit
   an exam. Also required: `GEMINI_API_KEY` (server-only),
   `REGISTRATION_ENC_KEY`, SMTP settings. Optional: `NEXT_PUBLIC_TURN_*`,
   `CONFIG_CHECK_TOKEN`.

4. **Verify on staging before going live**, in this order: open an exam as a
   targeted student (paper renders, and the network tab shows **no**
   `correctAnswer`), submit it (score appears and matches), try to `PATCH` the
   session's `score` from the console (must be denied), and re-run a similarity
   check from the teacher Answers page (must report a real comparison count).
