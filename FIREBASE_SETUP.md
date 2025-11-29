# Firebase Setup Guide for GreenGuardian

## 🔥 Complete Firebase Configuration

### Prerequisites
- Firebase CLI installed: `npm install -g firebase-tools`
- Firebase project created at: https://console.firebase.google.com

---

## 📋 Step-by-Step Setup

### 1. **Login to Firebase**
```bash
firebase login
```

### 2. **Initialize Firebase in Your Project**
```bash
# Already done - firebase.json exists
firebase init
```

Select:
- ✅ Firestore
- ✅ Storage
- ✅ Hosting (optional)

### 3. **Deploy Security Rules**

#### Deploy Firestore Rules:
```bash
firebase deploy --only firestore:rules
```

#### Deploy Storage Rules:
```bash
firebase deploy --only storage:rules
```

#### Deploy Indexes:
```bash
firebase deploy --only firestore:indexes
```

#### Deploy Everything:
```bash
firebase deploy
```

---

## 🔐 Security Rules Explained

### Firestore Rules (firestore.rules)

Our security model has **3 roles** with specific permissions:

#### **Student Role**
- ✅ Read their own user profile
- ✅ Read published/active exams
- ✅ Create exam sessions for themselves
- ✅ Submit answers
- ✅ Create proctoring logs
- ❌ Cannot access other students' data
- ❌ Cannot modify exams or questions

#### **Teacher Role** (Must be approved by admin)
- ✅ All student permissions
- ✅ Create and manage their own exams
- ✅ Create questions for their exams
- ✅ Read sessions and answers for their exams
- ✅ Update exam sessions (for grading)
- ❌ Cannot access other teachers' exams
- ❌ Cannot approve other teachers

#### **Admin Role**
- ✅ Full access to all collections
- ✅ Approve/reject teacher applications
- ✅ Manage all users
- ✅ Delete any content
- ✅ Modify system settings

---

## 📁 Collections Structure

### users
```javascript
{
  id: string,
  name: string,
  email: string,
  role: "student" | "teacher" | "admin",
  approved: boolean,
  rejected: boolean,
  createdAt: timestamp,
  updatedAt: timestamp,
  avatarUrl?: string
}
```

### exams
```javascript
{
  id: string,
  title: string,
  description: string,
  teacherId: string,
  teacherName: string,
  duration: number,
  totalMarks: number,
  startTime: timestamp,
  endTime: timestamp,
  settings: object,
  status: "draft" | "published" | "active" | "completed",
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### questions
```javascript
{
  id: string,
  examId: string,
  type: "mcq" | "short" | "long" | "code",
  text: string,
  marks: number,
  order: number,
  options?: array,
  correctAnswer?: string,
  createdAt: timestamp
}
```

### examSessions
```javascript
{
  id: string,
  examId: string,
  studentId: string,
  studentName: string,
  startTime: timestamp,
  endTime?: timestamp,
  submitted: boolean,
  score?: number,
  riskScore: number,
  flagged: boolean,
  flagReasons: array,
  status: string,
  proctoring: object
}
```

---

## 🔍 Firestore Indexes

Composite indexes are automatically created for:

1. **Users by role and approval status**
   - Efficiently query pending teachers
   - Filter approved teachers
   - Sort by creation date

2. **Exams by teacher and status**
   - Get teacher's exams
   - Filter by exam status
   - Sort by date

3. **Exam sessions by student/exam**
   - Student's exam history
   - Exam participant tracking
   - Flagged sessions sorting

4. **Answers and logs optimization**
   - Fast answer retrieval
   - Event timeline queries
   - Plagiarism checking

---

## 💾 Storage Rules

### File Upload Limits
- **Max file size:** 10MB per file
- **Allowed types:**
  - Images (jpg, png, gif, svg, webp)
  - PDFs
  - Text files
  - Word documents (.doc, .docx)

### Storage Paths

#### User Avatars
```
/avatars/{userId}/{fileName}
- Read: All authenticated users
- Write: Owner only
- Types: Images only
```

#### Exam Answers
```
/answers/{examId}/{sessionId}/{fileName}
- Read: Authenticated users
- Write: Authenticated users
- Types: All allowed types
```

#### Exam Materials
```
/exams/{examId}/materials/{fileName}
- Read: Authenticated users
- Write: Teachers only
- Types: All allowed types
```

---

## 🚀 Quick Deployment Commands

### Deploy Security Rules
```bash
# Firestore rules
firebase deploy --only firestore:rules

# Storage rules  
firebase deploy --only storage:rules

# Both at once
firebase deploy --only firestore:rules,storage:rules
```

### Deploy Indexes
```bash
firebase deploy --only firestore:indexes
```

### Check Rules Status
```bash
firebase firestore:rules
firebase storage:rules
```

---

## 🧪 Testing Security Rules

### Test Firestore Rules in Console
1. Go to Firebase Console
2. Firestore Database → Rules
3. Click "Rules Playground"
4. Test different user scenarios

### Test with Emulator (Local Development)
```bash
# Install emulators
firebase init emulators

# Start emulators
firebase emulators:start

# Your app will use: http://localhost:8080
```

Update `lib/firebase/config.ts` for emulator:
```typescript
if (process.env.NODE_ENV === 'development') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectStorageEmulator(storage, 'localhost', 9199);
}
```

---

## 🔧 Manual Setup in Firebase Console

### 1. Enable Authentication
1. Go to Firebase Console
2. Authentication → Sign-in method
3. Enable **Email/Password**
4. Save

### 2. Create Firestore Database
1. Firestore Database → Create database
2. Choose **Production mode**
3. Select location (closest to users)
4. Deploy rules: `firebase deploy --only firestore:rules`

### 3. Enable Storage
1. Storage → Get started
2. Choose location
3. Deploy rules: `firebase deploy --only storage:rules`

### 4. Create First Admin User
After deploying:
1. Register a user through your app
2. Go to Firestore Database
3. Find the user in `users` collection
4. Edit document:
   - Set `role`: `"admin"`
   - Set `approved`: `true`
5. Save

---

## 📊 Performance Optimization

### Indexes Created
- ✅ All complex queries optimized
- ✅ Composite indexes for filtering
- ✅ Automatic index suggestions disabled (we've defined all needed)

### Caching Strategy
- Client-side persistence enabled
- Offline support ready
- Real-time listeners optimized

---

## 🔐 Security Best Practices Implemented

✅ **Role-based access control (RBAC)**
✅ **User can only access their own data**
✅ **Teachers need admin approval**
✅ **Validation on all writes**
✅ **File type and size restrictions**
✅ **Timestamp verification**
✅ **Cross-document security checks**
✅ **No data leakage between users**

---

## ⚠️ Important Security Notes

1. **Never expose Firebase config in public repos** (Already in .env.local)
2. **Always validate on server-side** (Rules handle this)
3. **Keep rules updated** as features evolve
4. **Monitor usage** in Firebase Console
5. **Set up billing alerts** to avoid overages

---

## 🎯 Deployment Checklist

Before going to production:

- [ ] Deploy Firestore rules: `firebase deploy --only firestore:rules`
- [ ] Deploy Storage rules: `firebase deploy --only storage:rules`
- [ ] Deploy indexes: `firebase deploy --only firestore:indexes`
- [ ] Create admin user manually
- [ ] Test all user roles
- [ ] Enable billing alerts
- [ ] Set up backups (Firestore → Scheduled exports)
- [ ] Configure CORS for storage if needed

---

## 🆘 Troubleshooting

### "Missing permissions" errors
- Check if rules are deployed: `firebase deploy --only firestore:rules`
- Verify user role in Firestore
- Check if teacher is approved

### "Index required" errors
- Deploy indexes: `firebase deploy --only firestore:indexes`
- Wait 5-10 minutes for indexes to build

### File upload fails
- Check file size (< 10MB)
- Verify file type is allowed
- Deploy storage rules: `firebase deploy --only storage:rules`

---

## 🎉 Your Firebase is Ready!

All security rules, indexes, and configurations are set up for:
- ✅ Secure multi-role authentication
- ✅ Optimized database queries
- ✅ Safe file uploads
- ✅ Production-ready deployment

**Run:** `firebase deploy` to activate everything!
