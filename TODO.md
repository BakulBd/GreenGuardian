# TODO - Course, Batch & Section Management Module

## Completed Steps

- [x] Explored codebase & understood current architecture
- [x] Read all files importing catalog defaults

## Implementation Steps

### Phase 1: Firestore Service Layer
- [x] Add `CourseDoc`, `BatchDoc`, `SectionDoc` types to `lib/types/index.ts`
- [x] Create `lib/academics/courseManagement.ts` (CRUD + real-time subscribers + duplicate validation + cascade delete)

### Phase 2: Dynamic Catalog
- [x] Update `lib/academics/catalog.ts` to load dynamic data from Firestore with static fallback
- [x] Create `hooks/useAcademicCatalog.ts` (real-time catalog hook with fallback)

### Phase 3: Admin UI
- [x] Create `app/dashboard/admin/courses/page.tsx` (Courses / Batches / Sections tabs with CRUD modals)
- [x] Add "Courses" menu item in `components/layouts/DashboardLayout.tsx`

### Phase 4: Firestore Rules
- [x] Update `firestore.rules` with courses/batches/sections rules (admin-only write)

### Phase 5: Migrate Pages to Dynamic Data
- [ ] `app/dashboard/admin/students/page.tsx` (student add/edit dropdowns)
- [ ] `app/dashboard/teacher/exams/create/page.tsx` (exam create dropdowns)
- [ ] `app/dashboard/teacher/exams/[id]/edit/TeacherExamEditClient.tsx` (exam edit dropdowns)
- [ ] `app/dashboard/teacher/exams/page.tsx` (exam filters)
- [ ] `app/dashboard/teacher/answers/page.tsx` (answer filters)
- [ ] `app/dashboard/teacher/notices/create/page.tsx` (notice create)
- [ ] `app/dashboard/teacher/notices/[id]/edit/page.tsx` (notice edit)
- [ ] `app/dashboard/teacher/courses/page.tsx` (teacher courses)
- [ ] `app/dashboard/teacher/page.tsx` (teacher dashboard)

### Phase 6: Verify
- [x] Run `npm run build` to verify no compilation errors — **BUILD PASSES ✅**
- [ ] Review changes for consistency

## Notes
- Phase 5 (consumer pages migration) is deferred — existing pages still use `DEFAULT_COURSES`/`DEFAULT_BATCHES`/`DEFAULT_SECTIONS` from `lib/academics/catalog.ts` (which is fine since those are still exported as fallback).
- A new standalone admin "Courses" page is available at `/dashboard/admin/courses` for CRUD operations on courses/batches/sections with Firestore persistence.
- To seed the default catalog into Firestore, call `seedDefaultCatalog()` from the management service.

