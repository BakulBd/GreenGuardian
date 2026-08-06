# GreenGuardian — Project Map

Primary AI-context document. Read this file (and its four siblings —
`FEATURE_INDEX.md`, `CHANGELOG_AI.md`, `DEPENDENCY_GRAPH.md`,
`KNOWN_LIMITATIONS.md`) before making further changes. Only open source files
directly relevant to the requested feature; avoid rescanning the whole
codebase.

## What this is

GreenGuardian is a proctored online exam system: students take webcam-
monitored exams, teachers create exams and review submissions, admins manage
users/courses/assignments. Next.js 16 (App Router) frontend deployed to
Vercel, Firebase (Auth + Firestore + Storage, Spark/free plan) as the only
backend. **There are no Cloud Functions and no custom server beyond a
handful of Vercel API routes** — almost all business logic lives in the
browser and is enforced by Firestore/Storage security rules.

## Folder structure

```
app/                          Next.js App Router pages
  api/                        Vercel route handlers (auth, OCR proxy)
  dashboard/
    admin/                    Admin pages (users, courses, academics, exams, assignments, settings)
    teacher/                  Teacher pages (exams, notices, monitoring, snapshots, students, answers)
    student/                  Student pages (dashboard, results, notices)
  exam/[id]/                  Exam-taking flow (outside DashboardLayout — self-guards auth)
    review/                   Student's own submission review
  login/, register/, profile/, pending-approval/, verify-email/
components/                   Shared React components
  layouts/DashboardLayout.tsx Role-based sidebar nav + shell
  ui/                         shadcn/Radix primitives (Button, Card, Dialog, Select, ...)
contexts/AuthContext.tsx      Client auth state, cached-user flicker guard, live status watch
hooks/                        useAuth, useCameraPermission, useAcademicCatalog
lib/
  firebase/                   Firestore/Auth/Storage read-write functions, one file per domain
  services/                   proctoring.ts (live video, warnings, snapshots), liveVideo.ts
  utils/                      Pure logic: validation, behavior scoring, question types, helpers
  types/index.ts              All shared TypeScript interfaces
  academics/catalog.ts        Default department/batch/section/course seed data
scripts/                      One-off admin/seed scripts (node, run manually)
docs/                         This file and its siblings, plus prior audit docs
firestore.rules, storage.rules, firestore.indexes.json, firebase.json
```

## Architecture

- **Auth**: Firebase Auth (client SDK) + a `users/{uid}` Firestore profile
  document holding `role`, `approved`, `status`, academic fields. No server
  session/cookie — `contexts/AuthContext.tsx` mirrors `onAuthStateChanged`
  into React state, with a 24h localStorage cache to avoid a loading flash.
- **Authorization**: Firestore/Storage **security rules** are the actual
  enforcement layer (`firestore.rules`, `storage.rules`), not middleware
  (there is none — deleted in a prior pass, see `docs/PRODUCTION_AUDIT.md`).
  Role checks (`isAdmin()`, `isTeacher()`, `isStudent()`) call `get()` on the
  requester's own `users/{uid}` doc.
- **Account status** (`users.status`: `active | hold | suspended`, Task 2):
  blocks login (`lib/firebase/auth.ts#loginUser`), is watched live via
  `onSnapshot` in `AuthContext` for instant sign-out if changed mid-session,
  and gates writes via the `isActiveUser()` rule helper.
- **Exams**: created/edited by teachers (`app/dashboard/teacher/exams/**`),
  taken via `app/exam/[id]/ExamClient.tsx` (a ~2300-line client component —
  timer, face/object detection, warnings, autosave, live video broadcast,
  submission, grading). Grading happens **in the browser** (known
  limitation, see `KNOWN_LIMITATIONS.md`).
- **Multi-attempt** (Task 4): `exams.attemptsAllowed` (default 1) caps
  attempts. Each attempt is an `examSessions` doc with `attemptNumber`,
  created inside a Firestore transaction alongside an
  `examAttemptCounters/{examId}_{studentId}` counter doc — the rules check
  the counter to stop a crafted client from exceeding the cap.
- **Suspend/Resume** (Task 3): a teacher can freeze a student's in-progress
  session (`examSessions.locked`). The student's client watches its own
  session via `onSnapshot` and pauses the countdown; `totalPausedMs` credits
  the frozen time back so resuming doesn't cost the student clock time.
- **Warnings**: proctoring violations detected client-side in `ExamClient`
  call `addWarning()`, which increments `examSessions.warnings`, logs to
  `proctoringEvents`/`examLogs`, and captures a **permanent** screenshot via
  `captureAndUploadWarningScreenshot()` (Storage + `warningScreenshots`
  collection). The warning ceiling is read from
  `settings/global.proctoring.maxWarnings` (Task 5 — previously hardcoded).
- **Snapshots** (Task 9): the capture pipeline above already existed; this
  session added the teacher-facing gallery
  (`app/dashboard/teacher/snapshots`) to view/search/filter/delete them.
  Deliberately **does not touch** the P2P live-video system
  (`lib/services/liveVideo.ts`, `watch-live`/`live-monitoring` pages).
- **Teacher assignments** (Task 10): admin assigns Course+Batch+Section (or
  explicit student list) to a teacher via `lib/firebase/assignments.ts`,
  which maintains `teacher_assignments` + `teacher_student_mapping` and
  denormalizes the result onto each student as `users.assignedTeacherIds`.
  Notices, notifications, and exam listings are filtered against this list
  in both queries and security rules — **fails closed**: an unassigned
  student sees nothing from any teacher (see `KNOWN_LIMITATIONS.md`).
- **Review**: `components/ExamAnswerReview.tsx` is a shared, presentational
  question-by-question renderer used by both the student's own review page
  and the teacher's per-session review — one rendering, two audiences.

## Authentication flow

1. `register` → OTP email verification (`lib/otp.ts`, `app/api/auth/*`) →
   `users/{uid}` doc created (`approved: true` for students, `false` for
   teachers pending admin approval).
2. `login` → `loginUser()` checks `status` (hold/suspended → blocked),
   `rejected`, teacher `approved`.
3. `AuthContext` keeps `user` in sync; a live `onSnapshot` on the signed-in
   user's own doc force-signs-out on `status` change.
4. Route guards: dashboard pages assume `DashboardLayout` checks role;
   `/exam/[id]`, `/exam/[id]/review`, `/exam` self-guard (they render
   outside `DashboardLayout`).

## Firestore collections

| Collection | Purpose |
|---|---|
| `users` | Profile + role + `approved`/`rejected`/`status`/`assignedTeacherIds` |
| `pendingRegistrations` | Server-only, OTP flow staging (rules: `read/write: false` to clients) |
| `exams`, `questions` | Exam metadata + embedded `questions[]` kept in sync with the standalone `questions` collection by `lib/firebase/exams.ts` |
| `examSessions` | One doc per attempt: status, warnings, `locked`/`lockedAt`/`totalPausedMs`, `attemptNumber` |
| `examAttemptCounters` | `{examId}_{studentId}` → `count`, backs the attempt-limit rule |
| `answers` | Submitted answers/files, grading summary, OCR/similarity results |
| `similarityReports` | Plagiarism detection results |
| `liveVideoSignaling`, `liveFrames` | P2P video WebRTC signaling + Firestore frame-relay fallback — **do not modify without explicit instruction** |
| `examLogs`, `proctoringEvents`, `proctoringSnapshots`, `warningScreenshots` | Proctoring telemetry; `warningScreenshots` is the **permanent** evidence store behind the Snapshots gallery |
| `settings` | `settings/global` — admin-configured site/proctoring settings incl. `proctoring.maxWarnings` |
| `courses`, `batches`, `sections` | Academic catalog (admin-managed) |
| `teacherApplications` | Legacy/optional teacher-application flow |
| `results`, `studentWarnings`, `resultNotifications` | Published gradebook results + academic warnings (distinct from proctoring warnings) |
| `notices`, `noticeReads`, `notifications` | Teacher announcements, read receipts, per-user notification fan-out — all scoped by `assignedTeacherIds` |
| `teacher_assignments`, `teacher_student_mapping`, `assignmentHistory` | Admin-managed teacher↔student assignment source of truth |
| `classrooms` | Google-Classroom-style classroom: name/subject/section/semester, unique `code`, `teacherId`, `status` (active/archived) — **Phase 2 Feature 1** |
| `classroomMembers` | Joined students, doc id `{classroomId}_{studentId}` (blocks duplicate joins, cheap `exists()` checks for rules) |
| `classroomPosts`, `classroomComments` | Stream tab: announcements/notices/materials + threaded comments |
| `classroomClasswork` | Classwork tab: assignments/quizzes/materials/resources/links, draft/published |
| `classroomEmailLogs` | Per-recipient email delivery log (sent/failed/attempts) written by `/api/classroom/notify` |

## Storage structure

`avatars/{uid}/`, `answers/{examId}/{sessionId}/`, `proctoring/**`,
`warningScreenshots/{sessionId}/{file}.jpg` (permanent), `exams/**` (papers),
`uploads/{uid}/`, `classrooms/{classroomId}/{posts|classwork}/**` (Phase 2 —
broader file types incl. video/zip/ppt, 100MB ceiling; see
`isClassroomFileType()`/`isClassroomFileSize()` in `storage.rules`).

## Shared components worth knowing about

- `components/layouts/DashboardLayout.tsx` — role-based nav (student/teacher/admin arrays)
- `components/ExamAnswerReview.tsx` — shared answer-review renderer (Tasks 6/7)
- `components/AccountStatusControl.tsx` — admin Hold/Suspend/Activate widget (Task 2)
- `components/ExamSuspendControl.tsx` — teacher exam-suspend/resume widget (Task 3)
- `components/LiveVideoTile.tsx` — P2P live video tile (untouched this session)
- `components/CameraPermission.tsx`, `FileUpload.tsx`, `ErrorBoundary.tsx`, `NetworkStatus.tsx`
- `components/classroom/*` — `ClassroomDetailShell` (tabs shell) + `StreamTab`/`ClassworkTab`/`PeopleTab`/`AboutTab`, shared verbatim by teacher and student classroom pages (Phase 2)

## APIs (Vercel route handlers)

- `POST /api/auth/register`, `/api/auth/verify-otp`, `/api/auth/resend-otp` — OTP registration
- `GET /api/auth/config-check` — diagnostics, token-gated in production
- `POST /api/ocr` — Gemini-backed OCR/grading proxy; requires a Firebase ID token verified server-side via the Admin SDK, and now also rejects hold/suspended accounts (Task 2)
- `POST /api/classroom/notify` — fans a classroom post/classwork item out to email + in-app notifications; Admin-SDK-verified caller must own the classroom; re-checks each recipient's *current* `assignedTeacherIds` (not just classroom membership) before sending (Phase 2 Feature 1/6)

## Services & key utilities

- `lib/services/proctoring.ts` — warning/event logging, live-session subscription, permanent screenshot capture/fetch/delete, exam suspend/resume (Task 3)
- `lib/services/liveVideo.ts` — P2P video broadcast/signaling (do not modify without explicit instruction)
- `lib/firebase/assignments.ts` — teacher assignment CRUD + `assignedTeacherIds` sync + `backfillAllAssignedTeacherIds()` (Phase 2 Feature 5 fix)
- `lib/firebase/notices.ts` — notice CRUD, student-scoped queries, notification fan-out
- `lib/firebase/classrooms.ts` — classroom/membership/post/classwork CRUD, join-by-code, realtime subscriptions (Phase 2 Feature 1)
- `lib/utils/questionTypes.ts` — single source of truth for "is this question option-based?" (Task 8)
- `lib/utils/validation.ts` — form validation incl. `validateStrongPassword` (Task 1)
- `lib/utils/studentPdf.ts` — jsPDF-based student roster export (Phase 2 Feature 2)
- `lib/email/templates/classroomPost.ts` — HTML email template for classroom notifications

## Environment variables

See `.env.local.example`. Notable: `NEXT_PUBLIC_FIREBASE_*` (client config),
`GEMINI_API_KEY` (server-only), `FIREBASE_SERVICE_ACCOUNT` (Admin SDK),
`REGISTRATION_ENC_KEY`, SMTP vars, `NEXT_PUBLIC_TURN_*` (optional TURN for
live video), `CONFIG_CHECK_TOKEN`.

## Important configuration / deploy notes

- **`firestore.rules` and `storage.rules` changed again in Phase 2** (classroom
  collections, exam-attempt-counter fix, warningScreenshots delete). Not
  deployed automatically — run `npm run firebase:deploy:rules`.
- **After deploying, an admin must click "Sync Assignment Visibility" on
  Admin → Assignments once** (Feature 5) — this backfills `assignedTeacherIds`
  for any assignment that existed before Task 10 shipped. Skipping this
  leaves exams/notices invisible for those students.
- No Java runtime was available in this session's environment, so rules
  changes were verified by careful manual review + brace/paren balance
  checks only, not the local emulator. Test against a staging project
  before production.
- Firebase Spark (free) plan compatible — no Cloud Functions introduced.
  `jspdf`/`jspdf-autotable` (Feature 2) run entirely client-side.

## Phase 2 additions (2026-08-07)

- **Classroom module** (Feature 1): a Google-Classroom-style workflow, teacher-owned.
  A student can only **join** a classroom (by code or invite link) if the
  classroom's `teacherId` is in the student's `assignedTeacherIds` — enforced
  both client-side (`joinClassroomByCode`) and in `firestore.rules`
  (`classroomMembers` create rule). Once joined, `classroomMembers` existence
  is the read-gate for that classroom's posts/classwork/comments (see
  `isClassroomMember()` helper in rules) — a second, independent check from
  the join-time assignment check, so revoking membership immediately revokes
  content access too.
- **Email/notification flow**: `notifyClassroom()` (client) calls
  `POST /api/classroom/notify` (server, Admin-SDK-verified) whenever a
  teacher publishes a stream post or classwork item. The route re-derives
  recipients from `classroomMembers` **intersected with each student's
  live `assignedTeacherIds`** (not trusted from membership alone), sends via
  `lib/email/send.ts` with up to 3 retries, and logs every attempt to
  `classroomEmailLogs`. In-app notifications (`notifications` collection,
  `type: "classroom"`) are written in the same pass.
- **Student Info PDF** (Feature 2): `lib/utils/studentPdf.ts` (jsPDF +
  jspdf-autotable, client-side, no server round-trip). Added `users.phone`
  (self-editable on `/profile`) since the PDF spec required it and nothing
  previously captured it.
- **Snapshots hierarchy** (Feature 3): `app/dashboard/teacher/snapshots`
  restructured into Student → Exam → Snapshots (was a flat grid). Pure UI
  change — `warningScreenshots` metadata (`studentId`/`examId`) was already
  correct; the bug was display grouping, not storage.
- **Result review completion** (Feature 4): `ExamAnswerReview` now shows
  Grade (reusing `calculateGrade`/`getGradeColor` from `lib/firebase/results.ts`),
  explicit Percentage, Submission Time, per-question marks obtained
  (incl. negative marking via new `Question.negativeMarks`), and Teacher
  Feedback (new `Answer.teacherFeedback`, editable from the teacher's
  session-results page).
- **Exam visibility fix** (Feature 5): root cause was that `assignedTeacherIds`
  (Task 10) is only kept in sync going forward — assignments that already
  existed before that logic shipped never got the field populated, so the
  fail-closed exam/notice filters hid everything for those students. Fixed
  with `backfillAllAssignedTeacherIds()`, exposed as a "Sync Assignment
  Visibility" button on Admin → Assignments — **run it once after deploying**.
  Also added `subscribeToPublishedExams()` (realtime) so newly published
  exams appear on `/exam` and the student dashboard without a page reload.

## Future extension points

- A `Question.explanation` field now exists in the type and is rendered by
  `ExamAnswerReview`, but there's no authoring UI yet — a natural next step.
- `assignedTeacherIds` fail-closed behavior needs an admin UX nudge (e.g. a
  banner) if a student has none — see `KNOWN_LIMITATIONS.md`.
- Exam document reads are not rules-scoped by assignment (frontend/query
  filtering only) — revisit if this needs to become a hard guarantee.
