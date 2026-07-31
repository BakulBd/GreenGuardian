import { Timestamp, FieldValue } from "firebase/firestore";

export type FirestoreDate = Date | Timestamp | FieldValue;

export type UserRole = "student" | "teacher" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
  rejected?: boolean;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
  avatarUrl?: string;
  // Academic fields
  studentCode?: string; // Student ID e.g. 0182220005101001
  department?: string; // e.g. "CSE"
  batch?: string; // e.g. "241"
  section?: string; // e.g. "D2"
  sections?: string[]; // e.g. ["D1", "D2", "D3", "D4", "D5"]
  courses?: string[]; // Assigned course IDs or names
}

export interface ExamSettings {
  requireWebcam: boolean;
  allowedTabSwitches: number;
  faceMissingTolerance: number; // in seconds
  attentionTimeout: number; // in seconds
  fileUploadsAllowed: boolean;
  shuffleQuestions: boolean;
  autoSubmitOnTimeout: boolean;
  allowedLateSubmission: boolean;
  lateSubmissionMinutes?: number;
  showResults?: boolean;
  allowReview?: boolean;
  proctoring?: {
    faceDetection: boolean;
    tabSwitchDetection: boolean;
    fullscreenRequired: boolean;
  };
}

export interface Exam {
  id: string;
  title: string;
  description: string;
  teacherId: string;
  teacherName?: string;
  duration: number; // in minutes
  totalMarks: number;
  passingMarks?: number;
  instructions?: string;
  questionCount?: number;
  startTime?: FirestoreDate;
  endTime?: FirestoreDate;
  startDate?: any;
  endDate?: any;
  settings: ExamSettings;
  status: "draft" | "published" | "active" | "completed" | "archived";
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
  // Academic & Mode fields
  courseId?: string;
  courseName?: string;
  batch?: string;
  section?: string;
  examMode?: string;
  questions?: Question[];
}

export type QuestionType = "mcq" | "short" | "long" | "code" | "multiple-choice" | "short-answer" | "essay" | "true-false";

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  text: string;
  marks: number;
  order: number;
  options?: string[]; // for MCQ
  correctAnswer?: string | string[]; // for MCQ
  codeLanguage?: string; // for code type
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
  // Academic fields
  courseId?: string;
  batch?: string;
  section?: string;
}

export interface ExamSession {
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  startTime: FirestoreDate;
  endTime?: FirestoreDate;
  submitted: boolean;
  score?: number;
  riskScore: number;
  flagged: boolean;
  flagReasons: string[];
  status: "in-progress" | "submitted" | "auto-submitted" | "cancelled";
  proctoring: ProctoringData;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export interface ProctoringData {
  tabSwitches: number;
  fullscreenExits: number;
  noFaceDuration: number; // in seconds
  multipleFacesCount: number;
  attentionAwayDuration: number; // in seconds
  suspiciousEvents: number;
}

export interface Answer {
  id: string;
  examSessionId: string;
  questionId: string;
  studentId: string;
  answer: string | string[];
  fileUrls?: string[];
  ocrText?: string;
  similarityScore?: number;
  plagiarismDetected?: boolean;
  submittedAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export type ExamLogType =
  | "tab_switch"
  | "fullscreen_exit"
  | "fullscreen_enter"
  | "no_face"
  | "face_detected"
  | "multiple_faces"
  | "attention_away"
  | "attention_return"
  | "answer_saved"
  | "file_uploaded"
  | "exam_started"
  | "exam_submitted";

export interface ExamLog {
  id: string;
  examSessionId: string;
  studentId: string;
  type: ExamLogType;
  message: string;
  metadata?: Record<string, any>;
  timestamp: FirestoreDate;
}

export interface TeacherApplication {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: "pending" | "approved" | "rejected";
  appliedAt: FirestoreDate;
  reviewedAt?: FirestoreDate;
  reviewedBy?: string; // admin ID
  reviewerName?: string;
  notes?: string;
}

export interface AppSettings {
  id: string;
  riskThresholds: {
    low: number;
    medium: number;
    high: number;
  };
  defaultExamSettings: ExamSettings;
  plagiarismThreshold: number;
  allowTeacherRegistration: boolean;
  updatedAt: FirestoreDate;
  updatedBy: string;
}

export interface DashboardStats {
  totalStudents: number;
  totalTeachers: number;
  totalExams: number;
  activeExams: number;
  pendingApprovals: number;
  flaggedSessions: number;
  totalCourses?: number;
}

export interface PlagiarismMatch {
  student1Id: string;
  student1Name: string;
  student2Id: string;
  student2Name: string;
  questionId: string;
  similarityScore: number;
  matchedText: string;
}

// ============ Results Module ============

export interface ResultSubject {
  id?: string;
  subjectName: string;
  subjectCode?: string;
  totalMarks: number;
  obtainedMarks: number;
  passMarks?: number;
  isPassed: boolean;
  grade?: string;
  gradePoint?: number;
}

export interface Result {
  id: string;
  studentId: string;
  studentName?: string;
  studentCode?: string;
  // Academic Information
  courseId?: string;
  courseName: string;
  courseCode?: string;
  batchName: string;
  sectionName: string;
  semester?: string;
  academicYear: string;
  examName: string; // Mid, Final, Quiz, Assignment, etc.
  examDate: FirestoreDate;
  resultPublishedDate: FirestoreDate;
  // Result Information
  subjects: ResultSubject[];
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string;
  gpa?: number;
  isPassed: boolean;
  isPublished: boolean;
  position?: number; // optional rank
  passFailStatus: "Pass" | "Fail";
  // Metadata
  createdBy?: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export type WarningType =
  | "attendance"
  | "academic"
  | "low_gpa"
  | "failed_subject"
  | "due_payment"
  | "custom";

export type WarningStatus = "active" | "resolved";

export interface StudentWarning {
  id: string;
  studentId: string;
  studentName?: string;
  warningType: WarningType;
  title: string;
  description: string;
  dateIssued: FirestoreDate;
  issuedBy: string;
  issuedByName?: string;
  status: WarningStatus;
  relatedResultId?: string;
  relatedExamId?: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export interface ResultFilters {
  courseId?: string;
  courseName?: string;
  batchName?: string;
  sectionName?: string;
  semester?: string;
  academicYear?: string;
  examName?: string;
  searchQuery?: string;
}
