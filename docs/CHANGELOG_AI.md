# CHANGELOG_AI

Every modification made in the 2026-08-06/07 session implementing Tasks 1–10
from the production master prompt, plus the production audit that preceded
it in the git history (`86bd198`). Grouped by task; within each task, by
file. All changes verified after every task via `npm run typecheck`,
`npm run lint`, `npm test` (27/27 passing throughout), and `npm run build`
(41→42 routes) — see `KNOWN_LIMITATIONS.md` for what could not be verified
in this environment (no live Firebase project, browser, or Java runtime).

---

## Task 1 — Change password from Profile page — 2026-08-06

| File | Reason | Summary |
|---|---|---|
| `lib/utils/validation.ts` | No strong-password check existed | Added `validateStrongPassword()` (8+ chars, upper/lower/digit/special) |
| `lib/firebase/auth.ts` | No password-change capability existed anywhere | Added `changePassword()` — reauthenticates then calls `updatePassword` |
| `app/profile/page.tsx` | Same | Added Current/New/Confirm Password card, shared by student and teacher (same page) |

## Task 2 — Admin Hold/Suspend/Activate accounts — 2026-08-06

| File | Reason | Summary |
|---|---|---|
| `lib/types/index.ts` | New feature | Added `UserStatus`, `User.status/statusReason/statusUpdatedAt/statusUpdatedBy` |
| `lib/firebase/auth.ts` | New feature | `setUserStatus()`; `loginUser()` now blocks hold/suspended accounts |
| `contexts/AuthContext.tsx` | Must react to a status change during an active session | Live `onSnapshot` on the signed-in user's own doc; force sign-out + toast on hold/suspend |
| `firestore.rules` | Enforce status at the data layer, not just client redirects | Added `isActiveUser()` helper; applied to `exams`, `examSessions`, `answers`, `notices` create/update rules |
| `app/api/ocr/route.ts` | Billable AI endpoint must also respect status | Added Admin-SDK status lookup, 403s hold/suspended callers |
| `components/AccountStatusControl.tsx` | New shared widget | Status badge + Hold/Suspend/Activate buttons with reason modal |
| `app/dashboard/admin/students/page.tsx`, `.../teachers/page.tsx` | Wire up the new control | Added Status column |

## Task 3 — Teacher suspend/resume a student's exam — 2026-08-06

| File | Reason | Summary |
|---|---|---|
| `lib/types/index.ts` | New feature | `ExamSession.locked/lockReason/lockedBy/lockedAt/totalPausedMs` |
| `lib/services/proctoring.ts` | New feature | `suspendExamSession()`, `resumeExamSession()` (credits paused time via `totalPausedMs`); `LiveStudentSession.locked` |
| `app/exam/[id]/ExamClient.tsx` | Student must freeze/unfreeze live | `onSnapshot` watch on own session; timer pause; full-screen "Exam Suspended" overlay; `addWarning()` no-ops while locked; `resolvePriorAttempt()` accounts for `totalPausedMs` on refresh |
| `components/ExamSuspendControl.tsx` | New shared widget | Suspend (with reason)/Resume button |
| `app/dashboard/teacher/monitoring/page.tsx` | Integration point | Added the control to each live session card |

## Task 4 — Exam attempt limits — 2026-08-06/07

| File | Reason | Summary |
|---|---|---|
| `lib/types/index.ts` | New feature | `Exam.attemptsAllowed`, `ExamSession.attemptNumber` |
| `app/dashboard/teacher/exams/[id]/edit/TeacherExamEditClient.tsx` | Field existed on create but not edit | Added "Attempts Allowed" input + load/save wiring |
| `app/exam/[id]/ExamClient.tsx` | Core enforcement | `resolvePriorAttempt()` now counts finished attempts vs. `attemptsAllowed` instead of blocking after one; `startExam()` creates new attempts inside a Firestore transaction with an `examAttemptCounters` doc |
| `firestore.rules` | Prevent a crafted client from exceeding the cap | `attemptCounterId()` helper; `examAttemptCounters` collection rules; `examSessions` create rule now validates `attemptNumber` against the counter and `exams.attemptsAllowed` |
| `app/dashboard/student/page.tsx` | UI must reflect N-attempt reality | `hasAttempted` → `attemptsExhausted`; attempts-used badge |

## Task 5 — Dynamic warning limit — 2026-08-07

| File | Reason | Summary |
|---|---|---|
| `app/exam/[id]/ExamClient.tsx` | `maxWarnings` was `const ... = 5` | Now `useState`, fetched from `settings/global.proctoring.maxWarnings` (a field the admin Settings page already wrote but nothing read) in `loadExam()`; added the fetched value to the toast effect's deps |

## Task 6 — Student result review — 2026-08-07

| File | Reason | Summary |
|---|---|---|
| `app/exam/[id]/review/page.tsx` | Upload-mode exams had no `questions[]`, so review silently fell through to "no questions available"; multi-attempt exams could show the wrong attempt | Rewritten: resolves the specific session via `?session=` param, added upload-mode file/OCR review section, per-question "gradable vs. manually graded" distinction, Time Taken stat; simplified review-gating to `settings.allowReview === false` |
| `components/ExamAnswerReview.tsx` | Extracted for reuse (Task 7) | New shared presentational component |
| `app/dashboard/student/page.tsx` | Review must target the right attempt | "Review Answers" now passes `?session=<id>` |
| `lib/types/index.ts` | Rendering needed it | `Question.explanation?: string` (rendering only, no authoring UI yet) |

## Task 7 — Teacher submission review — 2026-08-07

| File | Reason | Summary |
|---|---|---|
| `app/dashboard/teacher/session-results/page.tsx` | No question-by-question review existed for teachers | Fetches the matching exam + answer, renders `ExamAnswerReview` in a new "Submission Review" section |
| `app/dashboard/teacher/answers/page.tsx` | Broaden reachability | Added a "Full Review" link to session-results |

## Task 8 — Question-type rendering bug — 2026-08-07

| File | Reason | Summary |
|---|---|---|
| `lib/utils/questionTypes.ts` | Bug fixed in 4 places at once | New `isOptionBasedQuestion()` — decides MCQ-vs-free-text from `type` first, falls back to non-blank options only for unrecognized types |
| `app/dashboard/teacher/exams/[id]/TeacherExamClient.tsx` | **The actual reported bug** — decided from `options.length > 0`, and short-answer questions always carried a stale 4-blank `options` array | Both conditionals switched to `isOptionBasedQuestion(q)` |
| `app/dashboard/teacher/exams/create/page.tsx` | Root-cause data bug: type-switch handler left `options` non-empty for short-answer; OCR extraction did the same | Clears `options` on switch to short-answer; OCR-extracted short-answer questions get `options: []` |
| `app/dashboard/teacher/exams/[id]/edit/TeacherExamEditClient.tsx` | Root-cause data bug: save handlers only special-cased `"multiple-choice"`, so **true-false questions were saved with empty options** | `handleAddQuestion`/`handleSaveQuestion` now also set `["True","False"]` for true-false |
| `app/exam/[id]/ExamClient.tsx`, `components/ExamAnswerReview.tsx` | Consistency | Both switched to the shared helper |

## Task 9 — Snapshots gallery — 2026-08-07

| File | Reason | Summary |
|---|---|---|
| `lib/services/proctoring.ts` | Capture already existed (`captureAndUploadWarningScreenshot`, `getWarningScreenshots`, `getExamWarningScreenshots`) but had no teacher-wide fetch or delete | Added `getWarningScreenshotsByTeacher()`, `deleteWarningScreenshot()` |
| `firestore.rules` | No delete rule existed for `warningScreenshots` | Added `allow delete: if isTeacherOrAdmin();` |
| `storage.rules` | `write` rule referenced `request.resource` which is null on delete, silently denying every delete | Split into `create, update` vs. `delete` |
| `app/dashboard/teacher/snapshots/page.tsx` | New page | Gallery: search, exam/warning-type filters, view dialog, delete with confirmation |
| `components/layouts/DashboardLayout.tsx` | New nav entry | Added "Snapshots" link for teacher role, next to (not replacing) Watch Live / Live Monitoring |

**Explicitly not modified:** `lib/services/liveVideo.ts`, `app/dashboard/teacher/watch-live/page.tsx`, `app/dashboard/teacher/live-monitoring/page.tsx` — per explicit user instruction to leave the P2P live-monitoring setup untouched.

## Task 10 — Teacher-student assignment scoping — 2026-08-07

| File | Reason | Summary |
|---|---|---|
| `lib/types/index.ts` | New field | `User.assignedTeacherIds?: string[]` |
| `lib/firebase/assignments.ts` | Assignment management existed but nothing consumed it for scoping | Added `syncAssignedTeacherIds()`, called after create/update/remove assignment |
| `lib/firebase/notices.ts` | `getStudentNotices()`/`getTargetedStudentIds()` matched by batch/section/course only, ignoring assignment | Both rewritten to intersect with `assignedTeacherIds` (per-teacher query loop to respect Firestore's one-`in`-per-query limit) |
| `firestore.rules` | Notice read rule didn't check assignment | Added `resource.data.teacherId in getUserData().get('assignedTeacherIds', [])` |
| `app/dashboard/teacher/notices/create/page.tsx` | UI copy was now inaccurate | Updated target-audience descriptions to say "assigned students" |
| `app/exam/page.tsx`, `app/dashboard/student/page.tsx` | Exam listings must also be scoped | Added `assignedTeacherIds` filter (frontend/query-level; `exams` collection's Firestore read rule intentionally left unchanged — see `KNOWN_LIMITATIONS.md`) |

**Note:** "Posts"/"Messages"/"Announcements" in the master prompt are treated
as the existing Notices feature — there is no separate messaging system in
this codebase.

---

# Phase 2 — Classroom module, PDF export, and bug fixes — 2026-08-07

## Bug fix — permission-denied console errors (reported after Phase 1)

| File | Reason | Summary |
|---|---|---|
| `contexts/AuthContext.tsx`, `app/exam/[id]/ExamClient.tsx` | Both `onSnapshot` calls added in Phase 1 (Tasks 2/3) had no error callback, so Firebase logged any denial as an uncaught console error instead of handling it | Added `(error) => console.warn(...)` handlers to both |
| `firestore.rules` | Real bug: `examAttemptCounters` read rule dereferenced `resource.data.studentId` unconditionally, which throws (→ denied) when the counter doc doesn't exist yet — i.e. **every student's first attempt at any exam** | Added `resource == null ||` short-circuit before the dereference |

## Feature 1 — Classroom module

| File | Reason | Summary |
|---|---|---|
| `lib/types/index.ts` | New feature | `Classroom`, `ClassroomMember`, `ClassroomPost`, `ClassroomComment`, `ClassworkItem`, `ClassroomEmailLog`, `ClassroomAttachment`; extended `NotificationType` with `"classroom"` |
| `firestore.rules` | New feature | `classrooms`, `classroomMembers` (join gated by `assignedTeacherIds`, deterministic id blocks duplicate joins), `classroomPosts`, `classroomComments`, `classroomClasswork` (draft hidden from students), `classroomEmailLogs` |
| `storage.rules` | Materials need broader file types than exams (video/zip/ppt) | New `classrooms/{allPaths=**}` path with `isClassroomFileType()`/`isClassroomFileSize()` (100MB); delete split from create/update from the start (learned from the warningScreenshots bug in Phase 1) |
| `lib/firebase/classrooms.ts` | New feature | Full CRUD: classroom lifecycle (create/edit/archive/restore/delete), join-by-code with assignment validation, membership, posts+comments, classwork, `notifyClassroom()` trigger |
| `lib/firebase/storage.ts` | Support classroom uploads | `CLASSROOM_MATERIAL_ALLOWED_TYPES`, `CLASSROOM_MAX_FILE_SIZE` |
| `components/classroom/StreamTab.tsx`, `ClassworkTab.tsx`, `PeopleTab.tsx`, `AboutTab.tsx`, `ClassroomDetailShell.tsx` | New feature, shared by teacher+student | Post composer with attachments/pin/comments; classwork with due date/marks/draft-publish; roster with search/remove/invite-link copy; stats |
| `app/dashboard/teacher/classrooms/page.tsx`, `.../[id]/page.tsx` | New feature | Classroom list (create/edit/archive/restore/delete) + detail page (owns the classroom) |
| `app/dashboard/student/classrooms/page.tsx`, `.../[id]/page.tsx` | New feature | "My Classrooms" list + join-by-code dialog + detail page (membership-gated) |
| `app/classroom/join/page.tsx` | New feature | Invite-link landing page (outside DashboardLayout, self-guards auth like `/exam`) |
| `components/layouts/DashboardLayout.tsx` | New nav entries | "Classrooms" (teacher) / "My Classrooms" (student) |
| `lib/email/templates/classroomPost.ts` | New feature | HTML email template for classroom notifications |
| `app/api/classroom/notify/route.ts` | New feature | Admin-SDK-verified route: resolves recipients as `classroomMembers` ∩ *current* `assignedTeacherIds`, sends email with up to 3 retries per recipient, logs every attempt to `classroomEmailLogs`, writes in-app `notifications` |

## Feature 2 — Student Information PDF export

| File | Reason | Summary |
|---|---|---|
| `package.json` | New dependency | `jspdf`, `jspdf-autotable` (client-side PDF generation) |
| `lib/types/index.ts` | PDF spec required it, nothing captured it | `User.phone?: string` |
| `app/profile/page.tsx` | Let users self-report the new field | Added Phone input |
| `lib/utils/studentPdf.ts` | New feature | `downloadStudentInfoPdf()` — landscape A4, branded header, footer with page numbers, no logo asset exists in this project (spec says "if available") |
| `app/dashboard/teacher/students/page.tsx`, `app/dashboard/admin/students/page.tsx` | New feature | Row checkboxes + "Download PDF" (selected, or all if none selected); admin resolves "Assigned Teacher" via a bulk `teacher_student_mapping` read |

## Feature 3 — Snapshots hierarchy

| File | Reason | Summary |
|---|---|---|
| `app/dashboard/teacher/snapshots/page.tsx` | Rewritten | Student → Exam → Snapshots nested expand/collapse (was one flat grid mixing every student together); added an explicit Download action per snapshot |

## Feature 4 — Complete result review

| File | Reason | Summary |
|---|---|---|
| `lib/types/index.ts` | New fields | `Question.negativeMarks?: number`; `Answer.teacherFeedback?: string` + `teacherFeedbackAt` |
| `components/ExamAnswerReview.tsx` | Summary lacked Grade/Percentage/Submission-Time; per-question view lacked marks-obtained/negative-marks; no feedback display | Added all of the above, reusing `calculateGrade`/`getGradeColor` from `lib/firebase/results.ts` |
| `app/dashboard/teacher/exams/create/page.tsx` | Authoring UI for the new field | "Negative Marks (optional)" input per question (edit-page/admin-forms not wired — see `KNOWN_LIMITATIONS.md`) |
| `lib/firebase/exams.ts` | New feature | `updateAnswerFeedback()` |
| `app/dashboard/teacher/session-results/page.tsx` | New feature | Feedback editor (Textarea + Save) below the shared review |

## Feature 5 — Exam visibility fix

| File | Reason | Summary |
|---|---|---|
| `lib/firebase/assignments.ts` | Root-cause fix | `backfillAllAssignedTeacherIds()` — recomputes `assignedTeacherIds` for every student with a `teacher_student_mapping` row, fixing pre-Task-10 assignments the forward-only sync never touched |
| `app/dashboard/admin/assignments/page.tsx` | Expose the fix | "Sync Assignment Visibility" button |
| `lib/firebase/exams.ts` | "Visibility should update automatically" | `subscribeToPublishedExams()` — realtime listener, replaces one-time `getAllExams()`/`getDocs` fetches |
| `app/exam/page.tsx`, `app/dashboard/student/page.tsx` | Wire up realtime | Both now subscribe instead of fetching once; student dashboard's session/stats loading (`loadData`) is unchanged, only the exam list is realtime |

## Feature 6 — Teacher-communication audit

| File | Reason | Summary |
|---|---|---|
| `firestore.rules` | Audit found `results`/`studentWarnings` read rules claimed scoping in comments that was never implemented (`allow read: if isTeacher()`, no assignment check) | New `isAssignedToStudent(studentId)` helper; applied to both. `resultNotifications` (confirmed unused by any app code) tightened from any-authenticated-user to staff-only. |

**Audit finding, not a leak today:** `createResult`/`createWarning` (`lib/firebase/results.ts`) have zero callers anywhere in `app/` — no creation or listing UI exists for either, so the rules gap above was unreachable through the app itself, only via direct SDK/console access. Fixed anyway per "no permission bypass."

## Documentation

| File | Reason |
|---|---|
| `docs/PROJECT_MAP.md`, `docs/FEATURE_INDEX.md`, `docs/CHANGELOG_AI.md`, `docs/DEPENDENCY_GRAPH.md`, `docs/KNOWN_LIMITATIONS.md` | Requested AI-context handoff docs |
