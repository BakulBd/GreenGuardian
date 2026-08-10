# GreenGuardian — Known Limitations

Honest record of what wasn't fixed, what's a deliberate tradeoff, and what
this session could not verify. Read this before assuming a feature is
bulletproof.

## Not verified live (environment constraint)

Verification across both sessions (Phase 1: Tasks 1–10; Phase 2: Features
1–6) was **static + toolchain only**: `npm run typecheck`, `npm run lint`,
`npm test` (27/27 passing after every task/feature), `npm run build`
(41 → 48 routes, clean throughout). There was no live Firebase project,
browser, or real user available, and **no Java runtime**, so the Firestore
emulator could not run either — `firestore.rules` and `storage.rules`
changes were verified by careful manual review plus a brace/paren-balance
script, not by executing them.

**Before relying on any of this in production:**
1. `npm run firebase:deploy:rules` — rules changes are not live until deployed.
   Phase 2 added classroom collections, fixed the exam-attempt-counter bug,
   and tightened `results`/`studentWarnings`/`resultNotifications` — all of
   this is inert until deployed.
2. **Click "Sync Assignment Visibility" on Admin → Assignments once** (Phase 2
   Feature 5) — required for exams/notices to reach students whose
   assignment predates Task 10. See below.
3. Test against a staging Firebase project: login/status changes (Task 2),
   exam suspend/resume (Task 3), multi-attempt exams (Task 4), notice/
   classroom delivery (Task 10, Feature 1) all depend on rules that were
   never executed against real data in either session.

## Task 10 fails closed — students need an assignment to see anything

Notices, exam listings, and (Phase 2) classroom joins are all filtered by
`users.assignedTeacherIds`. **A student with no admin-created assignment
sees zero notices, zero exams, and cannot join any classroom.** This is the
literal, correct reading of "teacher communication should only reach
assigned students," but it's a real behavior change: any student who existed
before an admin used `app/dashboard/admin/assignments` would see nothing
until assigned.

**This was reported back as a bug** ("published exams are not visible",
Phase 2 Feature 5) and the root cause turned out to be narrower than "no
assignment exists" — it was **"assignment exists but was created before
Task 10 shipped its sync logic, so `assignedTeacherIds` was never
populated."** Fixed with `backfillAllAssignedTeacherIds()` /
"Sync Assignment Visibility". The fail-closed *design* is unchanged and
intentional — only the staleness bug is fixed. A genuinely unassigned
student still sees nothing, correctly.

> **Superseded (2026-08-09).** The concern below was that a direct
> `/exam/{id}` URL was not rules-blocked and exam documents carried
> `correctAnswer`. The exam document no longer carries answer keys at all
> (`stripAnswerKeys`), and `/api/exams/paper` re-checks `targetStudentIds`
> server-side before serving a paper. The listing-level filtering described
> below is still how the exam list is scoped.

## Exam document reads are not rules-scoped by assignment

Task 10 asked to "update Firebase rules" for exams too. The `exams`
collection's read rule was deliberately left as `isAuthenticated()`
(unchanged) rather than adding an assignment check, because:
- Exam-taking (`ExamClient`) is the single most heavily-used, most fragile
  flow in this app, and a rules mistake here — unverifiable in this
  environment (see above) — could lock every student out of every exam.
- Assignment scoping for exams is instead enforced at the **listing** level
  (`app/exam/page.tsx`, `app/dashboard/student/page.tsx` filter by
  `assignedTeacherIds`) — a student won't be shown or steered toward an
  exam from a non-assigned teacher, but a direct `/exam/{id}` URL for a
  known exam ID is not rules-blocked. This matches a **pre-existing** gap
  (exam docs, including `correctAnswer`, were already broadly readable by
  any authenticated user — see "Grading runs in the browser" below) rather
  than introducing a new one.

## ~~Grading runs in the browser~~ — FIXED (2026-08-09)

**Resolved by the exam-integrity pass.** Grading moved to `/api/exams/grade`
(Admin SDK), papers are served answer-key-free by `/api/exams/paper`, students
lost read access to the `questions` collection, and the `examSessions`/`answers`
rules no longer accept a score written by a student. See
`docs/PRODUCTION_AUDIT.md` §8.1–8.2 for the full account and §9 for the
required migration + rules deploy.

The residual limitation is narrower: **behaviour and proctoring scores are
still client-reported.** They originate in the student's own camera and
tab-visibility sensors, so a crafted client can under-report its own
violations. The grading route clamps and allowlists what it accepts, but
verifying these server-side would need a server-side vision pipeline.

## "Posts" / "Messages" / "Announcements" / "Push Notifications" — mapped to existing features

Task 10 and Phase 2 Feature 6 both list these as communication channels to
scope. This codebase has no chat/messaging feature and no browser push
(FCM) infrastructure — neither exists to scope. "Posts"/"Announcements" are
covered by Notices (Task 10) and, as of Phase 2, Classroom Stream posts
(Feature 1, scoped by classroom membership + `assignedTeacherIds` at join
time). "Push Notifications" is treated as the existing in-app notification
system (`notifications` collection + bell icon, realtime via
`subscribeToNotifications`) — genuine OS-level push was not built; it's a
reasonably large addition (service worker, FCM token storage, permission
UX) that nothing else in the spec's more detailed sections (e.g. Feature 1's
own "Besides Email... Create In-App Notification... Realtime updates")
actually asked for. If a messaging or push feature is added later, it needs
its own assignment-scoping pass modeled on `lib/firebase/notices.ts` /
`/api/classroom/notify`.

## Question `explanation` field — rendering only, no authoring UI

`Question.explanation?: string` was added and is rendered by
`ExamAnswerReview` when present, satisfying Task 6's field list. No teacher
UI was added to *author* an explanation in the exam create/edit forms —
that would be a moderate additional scope (a textarea per question in two
forms) not explicitly required by the review-focused tasks. Safe to add
later; the type and rendering are already in place.

## Attempt-limit and suspend/resume timing use client clocks

- Task 4's transaction reads/writes a counter doc using the student's own
  client as the transaction initiator — correct and race-safe (Firestore
  transactions), but timestamps within it (`serverTimestamp()`) are
  server-authoritative, so this is fine.
- Task 3's `totalPausedMs` credit is computed as
  `Date.now() - lockedAt.toMillis()` on the **teacher's** client when they
  resume. A large clock skew on the teacher's machine would skew the
  credited pause duration. This matches the rigor already used elsewhere in
  this codebase (e.g. presence heartbeats use client `Date.now()`), not a
  new pattern.

## Multi-attempt exams and existing (pre-Task-4) data

Exams created before this session default to `attemptsAllowed: 1` (the
existing `attemptsAllowed` field in the create form's state was already
being saved to Firestore but had no UI input and nothing read it — Task 4
wired it up end-to-end). No migration was needed since the field already
existed with the correct default semantics.

## Snapshots (Task 9) — Storage fallback

`captureAndUploadWarningScreenshot()` (pre-existing) falls back to storing
a base64 data URL inline in the Firestore document if the Storage upload
fails. `deleteWarningScreenshot()` (new, Task 9) handles this by treating a
missing/failed Storage delete as non-fatal and still removing the Firestore
record — but a screenshot that only ever existed as inline base64 has
nothing in Storage to delete in the first place, which is expected, not a
bug.

## react-hooks/exhaustive-deps warnings (pre-existing, unchanged count)

39 warnings remain at the end of Phase 2 (was 41 at the start of Phase 1;
two were incidentally resolved by refactors — Task 6's review-page rewrite
and Phase 2 Feature 5's `/exam/page.tsx` inlining — and one was
newly-introduced-then-fixed during Task 5). All are the same
load-once-on-mount pattern documented in `docs/PRODUCTION_AUDIT.md` §6.3 —
reviewed there as safe to leave. Not re-litigated in either session.

---

# Phase 2 additions (2026-08-07)

## Classroom membership is not auto-revoked when an admin unassigns a student

Joining a classroom checks `assignedTeacherIds` once, at join time. If an
admin later removes that assignment, the student **stays a member** of the
classroom (can still see Stream/Classwork) even though they'd no longer be
able to *join* it fresh. The one place this is actively re-checked is
`/api/classroom/notify`, which re-derives `assignedTeacherIds` per
recipient before sending — so a lapsed student stops getting new email/
in-app notifications immediately, but doesn't lose read access to what's
already there. Closing this fully would mean either a Cloud Function
trigger on assignment removal (this project has none, by design — Spark
plan) or having `removeTeacherAssignment()` also sweep `classroomMembers`
for that teacher+student pair. Not implemented — the spec's stated
requirement ("only assigned students can join") is satisfied; ongoing
revocation on unassignment is a reasonable follow-up, not a request that
was made.

## Negative-marks authoring UI is only wired up on the teacher create form

`Question.negativeMarks` is fully supported end-to-end for *display*
(`ExamAnswerReview` shows "−N marks" per wrong answer) and can be *set* via
`app/dashboard/teacher/exams/create`. It is **not** exposed in
`TeacherExamEditClient.tsx` (edit an existing exam's questions) or either
admin exam form. A teacher who wants negative marking on a question added
after initial creation, or an admin creating an exam, can't set it through
the UI today — only through the create-page flow. Safe to extend later;
the type, rule permissions (no rule changes needed — it's just a number
field on an already-writable document), and rendering are all in place.

## Student Info PDF has no university logo

The spec says "University Logo (if available)". No `public/` directory and
no logo asset exist anywhere in this project, so `lib/utils/studentPdf.ts`
falls back to a text wordmark header. If a logo is added to the project
later, it needs to be threaded into `downloadStudentInfoPdf()` via
`doc.addImage()`.

## Classroom email delivery depends on SMTP being configured

`/api/classroom/notify` reuses `lib/email/send.ts`, which — consistent with
the OTP flow — falls back to **console-logging** the email instead of
sending it when `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` aren't set.
In that mode, `classroomEmailLogs` will show `status: "sent"` for emails
that were only printed to the server log, not actually delivered — this
mirrors the pre-existing OTP dev-mode behavior exactly, not a new gap.

## `results` / `studentWarnings` creation has no UI (confirmed by the Feature 6 audit)

`lib/firebase/results.ts#createResult` and `#createWarning` exist but
nothing in `app/` calls either — there is no page where a teacher or admin
enters a gradebook result or issues an academic warning. The Firestore rules
fix (Feature 6) closes the read-side gap regardless, but the feature itself
is incomplete/unwired. Out of scope for this session (not requested), noted
here so it isn't mistaken for a working feature.

## PDF generation is entirely client-side

`jspdf`/`jspdf-autotable` run in the browser — for very large rosters (many
hundreds of students) this is bounded by the client's memory/CPU, not a
server. Fine for a single class/department; would need a server-side export
if this app ever needs to export the entire student body at once.

---

# Green Room — Phase 1 (2026-08-10)

## Capacity ceiling: ~8 participants (full-mesh WebRTC)

**This is the single most important thing to know about Green Room.**

Green Room carries media over **full-mesh WebRTC**: every participant holds a
peer connection to every other participant, and uploads their camera once per
peer. Connections grow as N x (N-1) / 2, and each browser's encode/upload cost
grows linearly with the room. Past roughly 8 people, ordinary laptops and home
uplinks saturate — video freezes, audio breaks up.

`MAX_MESH_PARTICIPANTS` (default 8, override with
`NEXT_PUBLIC_GREENROOM_MAX_PARTICIPANTS`) is enforced **server-side at join**
(`/api/greenroom/join`), so the 9th person gets a clean "this meeting is full"
rather than everyone's call degrading. `audioOnly` mode doubles the effective
cap, since audio costs a fraction of video.

This was a deliberate, explicit choice: the alternative — an SFU/media server —
cannot run on this deployment (Vercel serverless + Firebase Spark host no
long-lived process) and would require an external paid service. **Green Room
will not host a 40-student lecture until an SFU is added.**

Mitigations already in place, so that swap is cheap when it happens:
- `videoConstraintsForPeerCount()` steps outbound resolution down as the room
  grows, so degradation is gradual rather than a cliff.
- `MAX_VISIBLE_TILES` caps rendered `<video>` elements at 12 regardless of
  roster size.
- All media logic is confined to `lib/greenroom/mesh.ts`. The UI talks to it
  through events only, so replacing it with an SFU client (LiveKit et al.)
  touches that one module, not the components.

## TURN is not configured — 10-20% of connections may fail

Green Room reuses `getIceServers()` from `lib/services/liveVideo.ts`, which is
STUN-only unless `NEXT_PUBLIC_TURN_URLS` / `_USERNAME` / `_CREDENTIAL` are set.
On symmetric NAT, corporate/campus firewalls, and some mobile carriers, a
direct peer connection can never be established. Those participants see
"Connection failed" on the affected tiles. The mesh attempts one ICE restart
before giving up. **Configuring TURN is required for reliable off-campus use.**

Unlike the proctoring live-video feature, Green Room has **no Firestore relay
fallback** — relaying JPEG frames is viable for one proctored student but not
for an N-way call on the Spark plan's write quota.

## Not verified live (no browser or Firebase project in the build environment)

Verified here: `typecheck` (0 errors), `lint` (0 errors, 35 pre-existing
warnings, none in Green Room files), `test` (178 passing, 48 of them new
Green Room tests), `build` (clean, all routes emitted), and
`firebase deploy --only firestore:rules --dry-run`, which **compiled the new
rules successfully against the real project**.

Not verified — these need two browsers and two accounts:
- Actual peer-to-peer audio/video between two machines.
- Screen share, and the browser's own "Stop sharing" bar driving teardown.
- Waiting-room admit/reject round trip.
- Host-forced mute reaching the participant's client.
- Reconnect/attendance banking after a dropped connection.

## Attendance on an unclean exit is best-effort

`/api/greenroom/leave` is called on an explicit leave and via `sendBeacon` on
`pagehide`. A hard crash, a killed tab, or a lost network sends neither. Those
sessions stay `joined` until the participant rejoins (which banks the previous
session) — so a student who crashes and never returns keeps an open session and
their attendance under-counts. The roster hides them from the mesh after
`PRESENCE_TIMEOUT_MS`, and ending the meeting closes every open session, which
covers the common case.

## Deferred to Phase 2 (not built, not stubbed)

Whiteboard, screen annotation, breakout rooms, and recording were explicitly
scoped out of Phase 1 and are **absent**, not half-implemented. Recording, when
built, is planned as client-side `MediaRecorder` uploaded to B2 — which only
captures what the host's browser composites and stops if their tab closes.
