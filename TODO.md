# Teacher Notice Module - Implementation TODO

## Steps

- [x] Step 1: Update `lib/types/index.ts` - Add Notice, NoticeRead, Notification types
- [x] Step 2: Create `lib/firebase/notices.ts` - Service layer with all CRUD and query functions
- [x] Step 3: Update `firestore.rules` - Add security rules for notices, noticeReads, notifications
- [x] Step 4: Update `firestore.indexes.json` - Add composite indexes for notices queries
- [x] Step 5: Create `app/dashboard/teacher/notices/page.tsx` - Teacher notices list page
- [x] Step 6: Create `app/dashboard/teacher/notices/create/page.tsx` - Create notice form
- [x] Step 7: Create `app/dashboard/teacher/notices/[id]/page.tsx` - View notice detail (teacher)
- [x] Step 8: Create `app/dashboard/teacher/notices/[id]/edit/page.tsx` - Edit notice form
- [x] Step 9: Create `app/dashboard/student/notices/page.tsx` - Student notices list with search/filter
- [x] Step 10: Create `app/dashboard/student/notices/[id]/page.tsx` - View notice detail (student)
- [x] Step 11: Update `components/layouts/DashboardLayout.tsx` - Add notices menu items + notification badge
- [x] Step 12: Update `app/dashboard/student/page.tsx` - Add notices quick link + notification count
- [x] Step 13: Update `app/dashboard/teacher/page.tsx` - Add notices quick link

## ✅ All Steps Complete!
