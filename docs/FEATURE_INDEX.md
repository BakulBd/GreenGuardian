# GreenGuardian — Feature Index

Every user-facing feature, where it lives, and what it depends on. New/fixed
features from this session are marked **(Task N)**.

---

### Password change **(Task 1)**
**Purpose:** Students and teachers can change their own password from Profile.
**Location:** `app/profile/page.tsx`
**Files:** `lib/firebase/auth.ts#changePassword`, `lib/utils/validation.ts#validateStrongPassword`
**Depends on:** Firebase Auth `reauthenticateWithCredential`/`updatePassword`

### Account status: Hold / Suspend / Activate **(Task 2)**
**Purpose:** Admin blocks a student/teacher's login and app access.
**Location:** `app/dashboard/admin/students/page.tsx`, `app/dashboard/admin/teachers/page.tsx`
**Files:** `components/AccountStatusControl.tsx`, `lib/firebase/auth.ts#setUserStatus`, `contexts/AuthContext.tsx` (live watch), `firestore.rules` (`isActiveUser()`), `app/api/ocr/route.ts` (API-level block)
**Depends on:** `users.status` field, real-time `onSnapshot`

### Teacher exam suspend/resume **(Task 3)**
**Purpose:** Teacher freezes a student's in-progress exam; timer pauses and resumes exactly.
**Location:** `app/dashboard/teacher/monitoring/page.tsx`
**Files:** `components/ExamSuspendControl.tsx`, `lib/services/proctoring.ts#suspendExamSession/resumeExamSession`, `app/exam/[id]/ExamClient.tsx` (lock overlay + paused-time accounting)
**Depends on:** `examSessions.locked/lockedAt/totalPausedMs`

### Exam attempt limits **(Task 4)**
**Purpose:** Teacher sets how many times a student may attempt an exam; enforced server-side.
**Location:** `app/dashboard/teacher/exams/create`, `.../[id]/edit`
**Files:** `app/exam/[id]/ExamClient.tsx` (`resolvePriorAttempt`, transactional `startExam`), `firestore.rules` (`examAttemptCounters` + `examSessions` create rule), `app/dashboard/student/page.tsx` (attempts-used badge)
**Depends on:** `exams.attemptsAllowed`, `examSessions.attemptNumber`, `examAttemptCounters/{examId}_{studentId}`

### Dynamic warning limit **(Task 5)**
**Purpose:** Admin-configured max-warnings value (was hardcoded to 5) drives auto-submit.
**Location:** `app/dashboard/admin/settings/page.tsx` (existing field, now actually wired up)
**Files:** `app/exam/[id]/ExamClient.tsx` (`maxWarnings` state, fetched from `settings/global`)
**Depends on:** `settings/global.proctoring.maxWarnings`

### Student exam review **(Task 6)**
**Purpose:** "View Details → Review Answers" shows a full question-by-question review, including upload-mode submissions.
**Location:** `app/exam/[id]/review/page.tsx`, entry point in `app/dashboard/student/page.tsx`
**Files:** `components/ExamAnswerReview.tsx` (shared renderer)
**Depends on:** `examSessions`, `answers`, `exams.questions[]`

### Teacher submission review **(Task 7)**
**Purpose:** Teacher opens any student's submission with the same question-by-question detail.
**Location:** `app/dashboard/teacher/session-results/page.tsx` (new "Submission Review" section), linked from `app/dashboard/teacher/answers/page.tsx` and `.../monitoring/page.tsx`
**Files:** `components/ExamAnswerReview.tsx` (shared with Task 6)
**Depends on:** teacher/admin broad read rules on `answers`/`examSessions`

### Question-type rendering fix **(Task 8)**
**Purpose:** Short-answer questions no longer render as MCQ.
**Location:** `app/dashboard/teacher/exams/[id]/TeacherExamClient.tsx` (the actual reported bug), plus data-hygiene fixes in the create/edit forms
**Files:** `lib/utils/questionTypes.ts#isOptionBasedQuestion` (single source of truth, used by `ExamClient`, `ExamAnswerReview`, `TeacherExamClient`)
**Root cause:** rendering decided from `options.length > 0` instead of `question.type`; type-switch handlers left stale option arrays.

### Snapshots gallery **(Task 9)**
**Purpose:** Every proctoring warning already captured a permanent webcam snapshot (pre-existing); this adds the teacher-facing view/search/filter/delete gallery.
**Location:** `app/dashboard/teacher/snapshots/page.tsx` (new nav entry, separate from Watch Live / Live Monitoring)
**Files:** `lib/services/proctoring.ts#getWarningScreenshotsByTeacher/deleteWarningScreenshot`, `firestore.rules`/`storage.rules` (delete permissions)
**Depends on:** `warningScreenshots` collection + Storage path, capture already wired into `ExamClient.addWarning`
**Explicitly does not touch:** `lib/services/liveVideo.ts`, `watch-live`/`live-monitoring` pages (P2P live video)

### Teacher-student assignment scoping **(Task 10)**
**Purpose:** A teacher's notices/notifications/exam listings only reach students an admin assigned to them.
**Location:** existing `app/dashboard/admin/assignments/page.tsx` (management UI, pre-existing)
**Files:** `lib/firebase/assignments.ts#syncAssignedTeacherIds` (new), `lib/firebase/notices.ts` (`getStudentNotices`, `getTargetedStudentIds`, rewritten), `firestore.rules` (`notices` read rule), `app/exam/page.tsx` + `app/dashboard/student/page.tsx` (exam-listing filters)
**Depends on:** `users.assignedTeacherIds` (denormalized from `teacher_student_mapping`)
**Behavior note:** fails closed — see `KNOWN_LIMITATIONS.md`.

---

## Phase 2 (2026-08-07)

### Classroom module **(Feature 1)**
**Purpose:** Google-Classroom-style workflow — teacher-owned classrooms with Stream, Classwork, People, and About tabs.
**Location:** `app/dashboard/teacher/classrooms`, `app/dashboard/student/classrooms`, `app/classroom/join` (invite-link landing)
**Files:** `lib/firebase/classrooms.ts` (all CRUD/join/subscriptions), `components/classroom/*` (shared shell + 4 tabs, used by both roles), `app/api/classroom/notify` (email/notification fan-out)
**Depends on:** `classrooms`, `classroomMembers`, `classroomPosts`, `classroomComments`, `classroomClasswork`, `classroomEmailLogs` collections; `users.assignedTeacherIds` (join-time + send-time validation, reusing Task 10)
**Key behaviors:** unique 6-char join code (collision-checked); join blocked unless the classroom's teacher is in the student's `assignedTeacherIds` (enforced client-side AND in `firestore.rules`); duplicate joins prevented via deterministic `classroomMembers` doc id; deleting a classroom cascades to its posts/classwork/comments/members (best-effort, mirrors `lib/firebase/exams.ts#deleteExam`'s pattern).

### Student Information PDF export **(Feature 2)**
**Purpose:** Downloadable, formatted PDF roster (name, ID, email, department, semester, phone, assigned teacher, registration date, status) — selected students or all.
**Location:** `app/dashboard/teacher/students`, `app/dashboard/admin/students` (both got a "Download PDF" button + row checkboxes)
**Files:** `lib/utils/studentPdf.ts` (jsPDF + jspdf-autotable, client-side, header/footer/page numbers)
**Depends on:** `users.phone` (new field, self-editable on `/profile` — nothing previously captured it)

### Snapshots hierarchy **(Feature 3)**
**Purpose:** Teacher's Snapshots gallery (Task 9) reorganized as Student → Exam → Snapshots instead of one flat mixed grid.
**Location:** `app/dashboard/teacher/snapshots` (rewritten)
**Depends on:** `warningScreenshots` collection (metadata was already correct — `studentId`/`examId`/`examTitle` — this was a display-grouping fix, not a data-model change)
**New in this pass:** expand/collapse per student and per exam, search by student, explicit Download button (fetch→blob, works regardless of Storage CORS headers) alongside the existing view/delete.

### Complete result review **(Feature 4)**
**Purpose:** Finishes what Tasks 6/7 started — Grade, explicit Percentage, Submission Time, per-question Marks Obtained, Negative Marks, and Teacher Feedback.
**Location:** `components/ExamAnswerReview.tsx` (shared by student's own review and teacher's session-results review)
**Files:** reuses `calculateGrade`/`getGradeColor` from `lib/firebase/results.ts`; new `Question.negativeMarks` (authoring UI added to the teacher exam-create form only — see `KNOWN_LIMITATIONS.md`); new `Answer.teacherFeedback` + `lib/firebase/exams.ts#updateAnswerFeedback`, with an editor on `app/dashboard/teacher/session-results/page.tsx`.

### Exam visibility fix **(Feature 5)**
**Purpose:** Fixes "published exams are not visible" and makes visibility update live.
**Root cause:** `assignedTeacherIds` (Task 10) is only kept in sync going forward; assignments that existed before that logic shipped never got the field backfilled, so the fail-closed filter hid every exam/notice for those students.
**Files:** `lib/firebase/assignments.ts#backfillAllAssignedTeacherIds` (new), a "Sync Assignment Visibility" button on `app/dashboard/admin/assignments/page.tsx`, `lib/firebase/exams.ts#subscribeToPublishedExams` (new realtime feed) wired into `app/exam/page.tsx` and `app/dashboard/student/page.tsx`.
**Action required:** an admin must click "Sync Assignment Visibility" once after this deploys — see `KNOWN_LIMITATIONS.md`.

### Teacher-communication audit **(Feature 6)**
**Purpose:** Closes remaining leakage gaps beyond what Task 10 already scoped (notices/notifications/exam listings) and Feature 1 already scoped-by-construction (classroom posts/classwork).
**Finding:** `results` and `studentWarnings` Firestore rules claimed teacher scoping in comments ("via batch/section filtering") that was never actually implemented — `allow read: if isTeacher()` let any teacher read any student's results/warnings. No UI currently exploits this (`createResult`/`createWarning` are unwired dead code — no creation or listing UI calls them), but it was exploitable via direct SDK/console access.
**Files:** `firestore.rules` — new `isAssignedToStudent(studentId)` helper (looks up the target student's own `assignedTeacherIds`), applied to `results` and `studentWarnings` read rules; `resultNotifications` (confirmed unused by any app code) tightened from any-authenticated-user to staff-only.
**Scope note:** "Messages" and "Push Notifications" in the spec have no corresponding feature in this codebase (no chat/messaging system, no FCM/push infra) — "Posts"/"Announcements"/"Notices" map to the existing Notices + Classroom Stream features, both already scoped.

---

## Pre-existing major features (unchanged this session, for context)

- **Live video proctoring** — `lib/services/liveVideo.ts`, `components/LiveVideoTile.tsx`, `watch-live`/`live-monitoring` pages. WebRTC P2P + Firestore frame-relay fallback. **Not touched this session per explicit instruction.**
- **Exam creation/editing** — `app/dashboard/teacher/exams/**`, OCR-assisted question extraction via Gemini.
- **Face/object detection proctoring** — `lib/utils/faceDetection.ts`, `objectDetection.ts` (TensorFlow.js, client-side).
- **Notices & notifications** — `lib/firebase/notices.ts`, now assignment-scoped (Task 10).
- **Results/gradebook** — `lib/firebase/results.ts`, `app/dashboard/student/results`, `studentWarnings` (academic warnings, distinct from proctoring warnings).
- **Registration + OTP email verification** — `app/api/auth/*`, `lib/otp.ts`, `lib/registration-store.ts`.
- **Academic catalog management** — `app/dashboard/admin/academics`, `courses`, `lib/academics/catalog.ts`.
