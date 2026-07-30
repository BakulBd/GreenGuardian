# Watch Live Feature Implementation

## Steps

- [x] Create TODO.md
- [x] 1. Create Watch Live page (`app/dashboard/teacher/watch-live/page.tsx`)
- [x] 2. Add "Watch Live" button to Teacher Dashboard Quick Actions (`app/dashboard/teacher/page.tsx`)
- [x] 3. Add "Watch Live" menu item to Sidebar Navigation (`components/layouts/DashboardLayout.tsx`)
# Automatic Screenshot on Every Warning - Implementation TODO

## Step 1: Add `captureAndUploadWarningScreenshot()` to `lib/services/proctoring.ts`
- [x] Create high-res screenshot capture function (640x480, 0.8 quality)
- [x] Upload to Firebase Storage at `warningScreenshots/{sessionId}/{timestamp}.jpg`
- [x] Create document in `warningScreenshots` Firestore collection
- [x] Add `getWarningScreenshots()` function to retrieve screenshots by sessionId

## Step 2: Update Firestore Rules
- [x] Add rules for `warningScreenshots` collection in `firestore.rules`

## Step 3: Update Storage Rules
- [x] Add rules for `warningScreenshots` storage path in `storage.rules`

## Step 4: Integrate screenshot capture in `ExamClient.tsx` addWarning()
- [x] Import and call the new screenshot capture function
- [x] Pass warning type, student name, exam metadata

## Step 5: Update Teacher Live Monitoring (`live-monitoring/page.tsx`)
- [x] Add full-size image viewer modal for warning screenshots
- [x] Show warning type, timestamp, student name in detail dialog

## Step 6: Update Session Results (`session-results/page.tsx`)
- [x] Add "Warning Screenshots" tab/section with all screenshots
- [x] Full-size image viewer with metadata
- [x] Persist all screenshots after exam ends
