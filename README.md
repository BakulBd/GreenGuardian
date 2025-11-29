# 🌿 Green Guardian – AI Examination Monitoring & University Automation System  
_A fully AI-powered smart exam proctoring, plagiarism detection, analytics, and university notice automation platform._

---

## 📌 Overview
**Green Guardian** is an advanced, AI-driven online examination monitoring system designed to ensure fairness, prevent cheating, and automate academic workflows. It includes:

- Secure authentication  
- AI exam monitoring with camera + tab-change detection  
- PDF-based answer submission with strict timer locking  
- AI similarity checking  
- AI auto-marking support  
- Student analytics dashboard  
- University notice automation  
- Facebook + Web chatbot support  

This project is ideal for universities, colleges, and online learning platforms.

---

## 🚀 Key Features

---

## 🧑‍🎓 1. Authentication + Student Dashboard
- Login using **Student ID + Password**
- Incorrect attempt limit  
- Auto session expiration  
- Global profile dropdown  
- Student profile includes:
  - Personal details  
  - Exam history  
  - Similarity reports  
  - Behavior scores  
  - Marks  

---

## 📊 2. Performance Dashboard & Analytics
Build beautiful, interactive analytics including:
- Exam improvement graph  
- AI behavior score history  
- Plagiarism trend  
- Marks trend  
- Class comparison  
- Clean vs suspicious exam ratio  

Charts are modern, responsive, and colorful.

---

## 📝 3. AI Exam Monitoring System
### **Pre-Exam**
- Countdown timer  
- Auto question reveal at 0:00  

### **During Exam**
- Exam duration timer  
- Auto-hide question after timer  
- **Tab-change detection** with real-time alert  

### **AI Camera Monitoring**
- Face movement tracking  
- Eye movement tracking  
- Multi-face detection  
- Screenshot capture  
- Suspicious behavior score  

### **Answer Submission System**
- Submission allowed only during exam  
- Submission grace period (default 5 min)  
- Auto-disable submit button  
- No late submissions  

---

## 🔍 4. AI-Based Answer Verification
- PDF upload disabled after deadline  
- Similarity check with:
  - Other students (cross-comparison)
  - AI-generated content detection (via Gemini AI)
  - OCR text extraction from uploaded PDFs/images

### OCR & AI Detection (Gemini AI Integration)
- Automatic text extraction from PDFs and images
- AI-generated content detection with confidence score
- Word count and content analysis
- Teacher dashboard for reviewing:
  - Extracted text
  - AI detection results
  - Cross-student similarity scores

### Similarity Thresholds
- **≥70%** → Plagiarized  
- **30–69%** → Partially similar  
- **<30%** → Unique  

Tab-change history included in plagiarism score.

---

## 🧠 5. AI Auto-Marking System
AI analyzes:
- Keywords  
- Logic  
- Structure  
- Explanation depth  
- Presentation  

AI suggests marks → teacher finalizes them.

---

## 📢 6. University Notice Automation
- Auto fetch notices from university site  
- PDF → PNG conversion  
- Auto-post on Facebook page  
- Auto-generated caption  
- Notice archive with search  

---

## 💬 7. AI Chatbots
### Facebook Chatbot
Responds to:
- “Today’s notice”
- “Last 3 notices”
- “Admission notice”

Returns:
- PNG  
- PDF  
- Extracted text  

### Website Chatbot
- Same features  
- ❌ No exam-related help  
- ❌ Disabled during exam hours  

---

## 🎨 UI/UX Highlights
- Responsive modern design  
- Clean, minimalistic interface  
- Light/Dark mode  
- Colorful charts  
- Smooth animations  
- Large digital timers  

---

# 🏗 Tech Stack
| Layer | Technologies |
|-------|--------------|
| **Frontend** | Next.js 15.5.6, React, TailwindCSS, Framer Motion |
| **Backend** | Firebase (Auth, Firestore, Storage), Serverless |
| **AI Models** | TensorFlow.js BlazeFace, Google Gemini AI |
| **OCR** | Gemini Vision API (PDF/Image text extraction) |
| **Database** | Firebase Firestore |
| **Chatbot** | Facebook Graph API, NLP model |
| **Deployment** | Docker, Nginx, Linux VPS |

---

# 📁 Project Structure

```bash
Green-Guardian/
│
├── backend/
│ ├── api/
│ ├── ai_models/
│ ├── exam/
│ ├── similarity/
│ ├── notice_bot/
│ ├── auth/
│ └── database/
│
├── frontend/
│ ├── src/
│ │ ├── components/
│ │ ├── pages/
│ │ ├── charts/
│ │ ├── exam/
│ │ └── dashboard/
│ └── public/
│
├── docs/
│ ├── SRS.pdf
│ ├── SDS.pdf
│ ├── UML/
│ └── API_Documentation.md
│
└── # GreenGuardian - Smart Online Exam Proctoring System

A production-grade web application for online exam proctoring with AI-powered face detection, gaze tracking, and advanced plagiarism detection.

## 🚀 Features

### Core Functionality
- **Multi-Role System**: Student, Teacher (approval required), and Admin roles
- **AI Proctoring**: Real-time face detection and gaze tracking using TensorFlow.js
- **Plagiarism Detection**: OCR with Tesseract.js and text similarity analysis
- **Comprehensive Monitoring**: Tab switching, fullscreen exits, attention tracking
- **Analytics Dashboard**: Risk scores, event timelines, and detailed reports

### Role-Specific Features

#### Student
- Browse and take available exams
- Proctored exam environment with webcam monitoring
- Real-time event logging
- File upload with OCR scanning

#### Teacher (Requires Admin Approval)
- Create and manage exams
- Add multiple question types (MCQ, Short, Long, Code)
- Configure exam security settings
- Monitor student sessions in real-time
- View plagiarism reports
- Manage students

#### Admin
- Full system control
- Approve/reject teacher applications
- Manage all users (students, teachers)
- View system-wide analytics
- Configure global settings
- Monitor all exams and sessions

## 🛠️ Technology Stack

- **Framework**: Next.js 14 (App Router) with TypeScript
- **Styling**: Tailwind CSS with custom green theme
- **UI Components**: shadcn/ui + Radix UI
- **Animations**: Framer Motion
- **Backend**: Firebase (Auth, Firestore, Storage)
- **AI/ML**: TensorFlow.js, Blazeface model
- **OCR**: Tesseract.js
- **Analytics**: Recharts
- **Text Similarity**: string-similarity, natural

## 📋 Prerequisites

- **Bun** 1.0+ (recommended) or Node.js 18+
- Firebase project with Firestore, Authentication, and Storage enabled
- Modern web browser with webcam support

## 🔧 Installation

### 1. Clone the repository

```bash
git clone https://github.com/BakulBd/GreenGuardian.git
cd GreenGuardian
```

### 2. Install dependencies

Using Bun (recommended):
```bash
bun install
```

Or using npm:
```bash
npm install
```

### 3. Configure Firebase

The Firebase configuration is already set up in `.env.local`:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCDeNhPVZpuRd7I28Oh_Csc_XshcuXrKgk
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=greenguardian2026.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=greenguardian2026
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=greenguardian2026.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1066634347018
NEXT_PUBLIC_FIREBASE_APP_ID=1:1066634347018:web:df7fc3be32bb1b18d195f3
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-1EVBQX5J7V
```

### 4. Set up Firestore Security Rules

In your Firebase Console, add these security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId || 
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    match /exams/{examId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                     (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'teacher' ||
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }
    
    match /questions/{questionId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                     (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'teacher' ||
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }
    
    match /examSessions/{sessionId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    match /answers/{answerId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    match /examLogs/{logId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

### 5. Create an Admin Account

Since there's no public admin registration, you need to manually create an admin user in Firestore:

1. Register a regular account through the app
2. Go to Firebase Console > Firestore
3. Find your user document in the `users` collection
4. Edit the document and set:
   - `role`: `"admin"`
   - `approved`: `true`

## 🚦 Running the Application

### Development Mode

Using Bun:
```bash
bun dev
```

Or using npm:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Production Build

Using Bun:
```bash
bun run build
bun start
```

Or using npm:
```bash
npm run build
npm start
```

## 📱 Application Routes

### Public Routes
- `/` - Landing page
- `/login` - Login page
- `/register` - Registration page (Student/Teacher)

### Student Routes
- `/exam` - Available exams list
- `/exam/[examId]` - Take exam (proctored)

### Teacher Routes (Requires Approval)
- `/dashboard/teacher` - Teacher dashboard
- `/dashboard/teacher/exams` - Manage exams
- `/dashboard/teacher/exams/create` - Create new exam
- `/dashboard/teacher/students` - View students
- `/dashboard/teacher/monitoring` - Monitor active sessions

### Admin Routes
- `/dashboard/admin` - Admin dashboard
- `/dashboard/admin/teachers` - Teacher approval management
- `/dashboard/admin/students` - Student management
- `/dashboard/admin/exams` - All exams
- `/dashboard/admin/settings` - System settings

### Special Routes
- `/pending-approval` - Shown to teachers awaiting approval

## 🔐 Authentication Flow

### Student Registration
1. Register with email, password, name
2. Select "Student" role
3. Immediate access to exam list

### Teacher Registration
1. Register with email, password, name
2. Select "Teacher" role
3. Account created with `approved: false`
4. Redirected to `/pending-approval`
5. Admin must approve in `/dashboard/admin/teachers`
6. Once approved, teacher gets full dashboard access

### Admin Access
1. Manually created in Firestore
2. Full system access upon login

## 📊 Data Structure

### Collections

#### users
```typescript
{
  id: string;
  name: string;
  email: string;
  role: "student" | "teacher" | "admin";
  approved: boolean;
  rejected?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  avatarUrl?: string;
}
```

#### exams
```typescript
{
  id: string;
  title: string;
  description: string;
  teacherId: string;
  teacherName: string;
  duration: number; // minutes
  totalMarks: number;
  startTime: Timestamp;
  endTime: Timestamp;
  settings: ExamSettings;
  status: "draft" | "published" | "active" | "completed" | "archived";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### examSessions
```typescript
{
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  submitted: boolean;
  score?: number;
  riskScore: number;
  flagged: boolean;
  flagReasons: string[];
  status: "in-progress" | "submitted" | "auto-submitted" | "cancelled";
  proctoring: ProctoringData;
}
```

## 🎯 Key Features Implementation

### 1. Face Detection
- Uses TensorFlow.js with Blazeface model
- Real-time detection during exam
- Logs when face is missing or multiple faces detected

### 2. Gaze Tracking
- Monitors if student is looking away
- Calculates attention-away duration
- Contributes to risk score

### 3. Tab Switching Detection
- Monitors visibility change events
- Logs each tab switch
- Configurable tolerance by teacher

### 4. Fullscreen Monitoring
- Requires fullscreen mode during exam
- Logs fullscreen exits
- Can auto-submit if exceeded

### 5. Plagiarism Detection
- OCR extracts text from uploaded images/PDFs
- Cosine similarity and n-gram analysis
- Compares answers across students
- Highlights matching text

### 6. Risk Score Calculation
```typescript
- Tab switch: +10 points
- Fullscreen exit: +15 points
- No face detected: +20 points
- Multiple faces: +25 points
- Attention away: +5 points
Maximum: 100 points
```

## 🎨 UI Theme

The application uses a custom green theme:
- Primary: Green-600 (#16a34a)
- Secondary: Gray shades
- Accent: Green-500 (#22c55e)
- Responsive design for all devices
- Dark mode support (optional)

## 📦 Project Structure

```
GreenGuardian/
├── app/
│   ├── dashboard/
│   │   ├── admin/
│   │   │   ├── page.tsx
│   │   │   ├── teachers/
│   │   │   ├── students/
│   │   │   ├── exams/
│   │   │   └── settings/
│   │   └── teacher/
│   │       ├── page.tsx
│   │       ├── exams/
│   │       ├── students/
│   │       └── monitoring/
│   ├── exam/
│   │   ├── page.tsx
│   │   └── [examId]/
│   ├── login/
│   ├── register/
│   ├── pending-approval/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   └── ...
│   └── layouts/
│       └── DashboardLayout.tsx
├── lib/
│   ├── firebase/
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── firestore.ts
│   │   └── exams.ts
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── helpers.ts
│       ├── faceDetection.ts
│       ├── ocr.ts
│       └── plagiarism.ts
├── hooks/
│   └── useAuth.ts
├── middleware.ts
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## 🧪 Testing

To test the application:

1. **Create Admin Account** (manual in Firestore)
2. **Register as Teacher** → Check pending approval page
3. **Login as Admin** → Approve teacher
4. **Login as Teacher** → Create exam with questions
5. **Register as Student** → Take exam
6. **Monitor** → View session logs and risk scores

## 🐛 Troubleshooting

### Webcam not working
- Check browser permissions
- Ensure HTTPS in production
- Test webcam with browser settings

### Firebase errors
- Verify API keys in `.env.local`
- Check Firestore security rules
- Ensure Firebase project is properly configured

### Build errors
- Clear `.next` folder: `rm -rf .next`
- Reinstall dependencies: `bun install` or `npm install`
- Check Node.js/Bun version

## 📄 License

MIT License - feel free to use this project for learning or commercial purposes.

## 👥 Contributors

- BakulBd - Initial work

## 🙏 Acknowledgments

- Next.js team for the amazing framework
- Firebase for backend services
- TensorFlow.js for ML capabilities
- shadcn/ui for beautiful components

## 📞 Support

For issues or questions:
- Create an issue on GitHub
- Email: support@greenguardian.com (placeholder)

---

**Built with ❤️ using Next.js, TypeScript, and Firebase**
```

---

# 👥 **Contributors**

| Name |
|------|
| **Md. Sajjad Mahmud Suton** | 
| **Mst. Esha Akter** | 
| **Bakul Ahmed** |

---

<div align="center">

## ⭐ If you like this project, give it a star!

</div>

---
