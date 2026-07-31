# Teacher Assignment Management System

## Completed Steps

- [x] Explored codebase & understood current architecture
- [x] Read all relevant files (types, firebase services, catalog, pages)
- [x] Added `TeacherAssignment`, `TeacherStudentMapping`, `AssignmentHistory` types to `lib/types/index.ts`
- [x] Created `lib/firebase/assignments.ts` (full CRUD + duplicate validation + batch mapping sync + history logging + real-time subscribers)
- [x] Created `app/dashboard/admin/assignments/page.tsx` (full admin UI with modal form, filters, teacher grouping, expanded student view, history log)
- [x] Created plan and got user approval

## Implementation Steps

### Phase 2b: Navigation
- [ ] Add "Assignments" menu item in `components/layouts/DashboardLayout.tsx`

### Phase 3a: Teacher Students Page
- [ ] Rewrite `app/dashboard/teacher/students/page.tsx` to load students from `teacher_student_mapping` collection

### Phase 3b: Teacher Courses Page
- [ ] Update `app/dashboard/teacher/courses/page.tsx` to use `getAssignmentsByTeacher()` instead of catalog defaults

### Phase 3c: Teacher Dashboard
- [ ] Update `app/dashboard/teacher/page.tsx` to show assignment-scoped stats

### Phase 4a: Firestore Security Rules
- [ ] Update `firestore.rules` with `teacher_assignments`, `teacher_student_mapping`, `assignmentHistory` rules

### Phase 4b: Firestore Indexes
- [ ] Update `firestore.indexes.json` with composite indexes for assignments

### Phase 5: Verify
- [ ] Run `npm run build` to verify no compilation errors

