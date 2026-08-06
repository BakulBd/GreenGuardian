# GreenGuardian — Dependency Graph

## Runtime dependencies

**Frontend / framework**
- `next` 16, `react`/`react-dom` 18 — App Router, client components throughout (almost everything is `"use client"` — this is a Firestore-client-SDK app, not a server-rendered data app)
- `framer-motion` — page/element transitions
- `tailwindcss` + `tailwind-merge` + `class-variance-authority` — styling
- `@radix-ui/react-*` (dialog, select, tabs, switch, progress, label, scroll-area, toast) — headless UI primitives behind `components/ui/*`
- `lucide-react` — icons

**Firebase**
- `firebase` (client SDK) — Auth, Firestore, Storage; initialized in `lib/firebase/config.ts`
- `firebase-admin` — server-only, used inside `app/api/**` route handlers via `lib/firebase/admin.ts` (never imported from client components)

**AI / OCR**
- `@google/generative-ai` — Gemini, server-side only (`lib/utils/gemini.ts`, called via `/api/ocr`)

**Proctoring**
- `@tensorflow/tfjs`, `@tensorflow-models/blazeface`, `@tensorflow-models/coco-ssd` — client-side face/object detection

**Email**
- `nodemailer` — SMTP, server-side (OTP registration flow, and now classroom notifications via `/api/classroom/notify`)

**Documents (Phase 2)**
- `jspdf`, `jspdf-autotable` — client-side PDF generation (`lib/utils/studentPdf.ts`), no server round-trip

**Dev/test**
- `typescript`, `eslint` + `eslint-config-next`, `vitest`

## Backend dependencies

There is no traditional backend. The "backend" is:
1. **Firestore + security rules** (`firestore.rules`) — the actual authorization layer
2. **Firebase Storage + security rules** (`storage.rules`)
3. **Vercel serverless functions** (`app/api/**`) — only for OTP registration, config diagnostics, and the Gemini OCR proxy (all three require either a signed OTP flow or a verified Firebase ID token)

## Firebase dependency chain (who reads/writes what)

```
users/{uid}
  ├─ read by: everyone authenticated (broad, for names/lookups)
  ├─ self-write: name/avatar (role/approved/rejected/id locked)
  ├─ admin-write: role changes, approval, status (Task 2), assignedTeacherIds (Task 10)
  └─ watched live by: AuthContext (status → force sign-out)

exams/{id} ←→ questions/{id}
  ├─ kept in sync by lib/firebase/exams.ts (createQuestion/updateQuestion/deleteQuestion
  │  write the standalone `questions` collection AND resync exams.questions[])
  ├─ read by: ExamClient (strips correctAnswer client-side only — see KNOWN_LIMITATIONS),
  │  TeacherExamClient/edit clients, ExamAnswerReview, exam listing pages
  └─ attemptsAllowed (Task 4) checked by examSessions create rule

examSessions/{id}
  ├─ created transactionally with examAttemptCounters/{examId}_{studentId} (Task 4)
  ├─ updated by: student (answers/warnings/heartbeat), teacher (locked, Task 3),
  │  ExamClient's live onSnapshot watch (lock state)
  └─ read by: student (own), teacher/admin (monitoring, session-results, review)

answers/{id}
  ├─ written by: ExamClient.handleSubmit (student), teacher grading (answers page)
  ├─ read by: ExamAnswerReview (Tasks 6/7), teacher answers/session-results pages
  └─ linked to examSessions via examSessionId (used by review page's session-scoped lookup)

warningScreenshots/{id} + Storage warningScreenshots/{sessionId}/{file}
  ├─ written by: ExamClient.addWarning → captureAndUploadWarningScreenshot
  ├─ read by: watch-live per-session tab (pre-existing), Snapshots gallery (Task 9, teacher-wide)
  └─ deleted by: Snapshots gallery only (teacher/admin, Task 9)

teacher_assignments, teacher_student_mapping, assignmentHistory
  ├─ written by: admin assignments page → lib/firebase/assignments.ts
  ├─ syncAssignedTeacherIds() derives users.assignedTeacherIds from teacher_student_mapping
  │  on every create/update/remove (Task 10) ...
  └─ ... and backfillAllAssignedTeacherIds() derives it in bulk, for assignments that
     predate that forward-only sync (Phase 2 Feature 5 — the exam-visibility bug fix)

notices/{id}, notifications/{id}
  ├─ written by: teacher (notices), publishNoticeWithNotifications (notifications fan-out)
  ├─ getTargetedStudentIds() intersects candidates with getAssignedStudentIds(teacherId) (Task 10)
  └─ read by: student (getStudentNotices — per-assigned-teacher query loop, Task 10),
     rules mirror the same assignedTeacherIds check

settings/global
  └─ read by: ExamClient (maxWarnings, Task 5); written by: admin settings page

results/{id}, studentWarnings/{id}
  ├─ written by: lib/firebase/results.ts#createResult/createWarning (currently UNUSED —
  │  no page in app/ calls either; confirmed by the Phase 2 Feature 6 audit)
  └─ read by: student (own, if published), teacher (isAssignedToStudent() rule check,
     Phase 2 Feature 6 — previously unscoped despite comments claiming otherwise)

classrooms/{id} ←→ classroomMembers/{classroomId}_{studentId}
  ├─ classrooms created by: teacher (lib/firebase/classrooms.ts#createClassroom)
  ├─ classroomMembers created by: student joining — rule requires
  │  classrooms.teacherId in student's users.assignedTeacherIds (Task 10, reused)
  └─ classroomMembers existence is the read-gate for classroomPosts/classroomClasswork/
     classroomComments (isClassroomMember() rule helper) — independent of, but consistent
     with, the assignment check made at join time

classroomPosts/{id}, classroomClasswork/{id} → classroomEmailLogs/{id}, notifications/{id}
  ├─ created by: teacher, via StreamTab/ClassworkTab
  ├─ triggers: notifyClassroom() (client, fire-and-forget) → POST /api/classroom/notify (server)
  └─ /api/classroom/notify re-derives recipients as classroomMembers ∩ CURRENT
     assignedTeacherIds (not trusted from membership alone), writes one
     classroomEmailLogs doc per recipient (sent/failed/attempts) and one
     notifications doc (type: "classroom")
```

## Shared component dependency graph

```
ExamAnswerReview (components/)
  ├─ used by: app/exam/[id]/review/page.tsx (student, Task 6)
  └─ used by: app/dashboard/teacher/session-results/page.tsx (teacher, Task 7)

AccountStatusControl (components/)
  ├─ used by: app/dashboard/admin/students/page.tsx
  └─ used by: app/dashboard/admin/teachers/page.tsx

ExamSuspendControl (components/)
  └─ used by: app/dashboard/teacher/monitoring/page.tsx

isOptionBasedQuestion (lib/utils/questionTypes.ts)
  ├─ used by: app/exam/[id]/ExamClient.tsx (question renderer)
  ├─ used by: app/dashboard/teacher/exams/[id]/TeacherExamClient.tsx (preview — the bug fix)
  └─ used by: components/ExamAnswerReview.tsx

lib/services/proctoring.ts
  ├─ imports: lib/firebase/exams.ts (getExamsByTeacher, for Snapshots/live-sessions teacher scoping)
  ├─ used by: ExamClient (capture on warning), monitoring/watch-live/live-monitoring pages,
  │  Snapshots gallery (Task 9), ExamSuspendControl (Task 3)
  └─ NOT used by: lib/services/liveVideo.ts (separate, untouched system)

lib/firebase/notices.ts
  └─ imports: lib/firebase/assignments.ts (getAssignedStudentIds) — one-way, no cycle

ClassroomDetailShell (components/classroom/)
  ├─ composes: StreamTab, ClassworkTab, PeopleTab, AboutTab (same 4 components, both roles)
  ├─ used by: app/dashboard/teacher/classrooms/[id]/page.tsx (isTeacher=true)
  └─ used by: app/dashboard/student/classrooms/[id]/page.tsx (isTeacher=false)

lib/firebase/classrooms.ts
  └─ imports: firebase/config only — no dependency on assignments.ts or notices.ts;
     assignment checks happen in firestore.rules (join) and /api/classroom/notify (send)
```

## Data flow: a warning during an exam (ties Tasks 3, 5, 9 together)

```
Student browser detects violation (face/tab/etc.)
  → ExamClient.addWarning()
      → guarded by examLockedRef (no-op if teacher suspended the exam, Task 3)
      → reads maxWarnings from state (fetched from settings/global, Task 5)
      → writes examSessions.warnings, proctoringEvents, examLogs
      → captureAndUploadWarningScreenshot()
          → Storage: warningScreenshots/{sessionId}/{file}.jpg (permanent)
          → Firestore: warningScreenshots/{id} (metadata)
      → if warnings >= maxWarnings → auto-submit
  Teacher later opens Snapshots gallery (Task 9, restructured Phase 2 Feature 3)
      → getWarningScreenshotsByTeacher(teacherId)
          → getExamsByTeacher → examIds
          → chunked `in` query over warningScreenshots.examId
          → grouped client-side into Student → Exam → Snapshots (Feature 3)
```

## Data flow: a teacher publishes a classroom announcement (Phase 2 Feature 1)

```
Teacher writes a post in StreamTab, clicks Post
  → createClassroomPost() → classroomPosts/{id} (rules: isTeacher + owns the classroom)
  → notifyClassroom({classroomId, postId, kind:"post"}) — fire-and-forget, doesn't block the UI
      → gets the teacher's own ID token, POSTs /api/classroom/notify
  Server (Admin SDK, bypasses rules):
      → verifies caller owns the classroom (or is admin)
      → reads classroomMembers where classroomId == X
      → for each member: re-checks their CURRENT users.assignedTeacherIds
          (a student who left the teacher's roster since joining is skipped —
           closes the gap Feature 6 was auditing for)
      → sendEmail() with up to 3 retries → classroomEmailLogs/{id} (sent/failed/attempts)
      → notifications/{id} (type: "classroom") — batched write
  Student's notification bell (subscribeToNotifications, pre-existing) updates in realtime
```

## Feature relationships

- **Task 4 (attempts) ↔ Task 6 (review):** the review page must resolve the
  *specific* attempt (`?session=`), not just "the" answer for an exam, once
  more than one attempt can exist.
- **Task 2 (account status) ↔ everything:** `isActiveUser()` is layered onto
  the write rules touched by Tasks 3/4/9's own rule changes.
- **Task 8 (question types) ↔ Tasks 6/7 (review):** `ExamAnswerReview` and
  `ExamClient` both depend on `isOptionBasedQuestion` — fixed once, correct
  everywhere it's used.
- **Task 9 (snapshots) is intentionally decoupled** from the P2P live-video
  system — no shared code path with `liveVideo.ts`.
- **Task 10 (assignment scoping) ↔ Task 6/7 review, notices:** a student's
  `assignedTeacherIds` gates both notice visibility and (at the query level)
  exam visibility; review pages are unaffected since they operate on a
  specific already-known session/answer, not a scoped listing.
- **Task 10 ↔ Phase 2 Feature 1 (classroom):** the classroom module doesn't
  reinvent assignment scoping — it reuses `assignedTeacherIds` for both the
  join-time rule check and the send-time notification filter. One field,
  three consumers (notices, exams, classrooms).
- **Phase 2 Feature 5 ↔ Task 10:** the exam-visibility bug was a direct
  consequence of Task 10 shipping a forward-only sync — Feature 5's backfill
  is the missing migration step, not a new mechanism.
- **Phase 2 Feature 4 ↔ Tasks 6/7:** `ExamAnswerReview` is extended, not
  replaced — Grade/Percentage/Submission-Time/marks/feedback are additive to
  the component both the student and teacher review pages already shared.
- **Phase 2 Feature 6 ↔ Task 10:** the audit that produced Feature 6 was
  specifically looking for gaps Task 10 *didn't* cover — it found one
  (`results`/`studentWarnings` rules) precisely because those collections
  predate Task 10 and were never revisited when the assignment system was
  introduced.
