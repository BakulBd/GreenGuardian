import { Timestamp, FieldValue } from "firebase/firestore";

export type FirestoreDate = Date | Timestamp | FieldValue;

export type UserRole = "student" | "teacher" | "admin";

/** Account status set by an admin. Missing/undefined is treated as "active" everywhere. */
export type UserStatus = "active" | "hold" | "suspended";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
  rejected?: boolean;
  emailVerified?: boolean;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
  avatarUrl?: string;
  phone?: string;
  // Account status (admin-controlled). Undefined == "active".
  status?: UserStatus;
  statusReason?: string;
  statusUpdatedAt?: FirestoreDate;
  statusUpdatedBy?: string;
  // Academic fields
  studentCode?: string; // Student ID e.g. 0182220005101001
  department?: string; // e.g. "CSE"
  batch?: string; // e.g. "241"
  section?: string; // e.g. "D2"
  sections?: string[]; // e.g. ["D1", "D2", "D3", "D4", "D5"]
  courses?: string[]; // Assigned course IDs or names
  // Denormalized from teacher_student_mapping (see lib/firebase/assignments.ts).
  // A student only receives notices/notifications from teachers in this list —
  // this is what "Teacher communication should only reach assigned students"
  // (Task 10) is actually enforced against, both in queries and security rules.
  assignedTeacherIds?: string[];
}

// ============ Course / Batch / Section Management ============

export interface CourseDoc {
  id: string;
  name: string;
  code: string;
  departmentId?: string;
  departmentName?: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export interface BatchDoc {
  id: string;
  courseId: string;
  name: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export interface SectionDoc {
  id: string;
  batchId: string;
  courseId: string;
  name: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
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
  batchId?: string;
  batch?: string;
  sectionId?: string;
  section?: string;
  examMode?: string;
  questions?: Question[];
  // How many times a student may submit this exam. Missing/undefined == 1.
  attemptsAllowed?: number;
  // Exact student IDs allowed to see this exam, resolved at creation time
  // from the teacher's Course+Batch+Section assignment (see
  // computeAssignmentTargetStudentIds). This is what firestore.rules and
  // subscribeToStudentVisibleExams check — the source of truth for "who
  // can see this exam", not the batch/section name strings above (those
  // are display-only / legacy).
  targetStudentIds?: string[];
  /** Admin who created the exam on a teacher's behalf, when applicable. */
  createdBy?: string;
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
  explanation?: string; // optional rationale shown during review
  negativeMarks?: number; // deducted on a wrong answer, if the teacher sets one
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
  // Which attempt this is for the student on this exam (1-based). Together
  // with the exam's `attemptsAllowed`, the set of sessions for a
  // studentId+examId pair IS the attempt history — no separate log needed.
  attemptNumber?: number;
  // Teacher-triggered suspend/resume of an in-progress attempt (Task 3).
  locked?: boolean;
  lockReason?: string;
  lockedBy?: string; // teacherId
  lockedAt?: FirestoreDate;
  totalPausedMs?: number; // cumulative time spent locked, excluded from the countdown
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

export interface FileOCRAnalysis {
  fileName: string;
  fileUrl: string;
  extractedText: string;
  wordCount: number;
  confidence?: number;
  error?: string;
}

export interface OCRAnalysis {
  extractedText: string;
  wordCount: number;
  confidence?: number;
  modelUsed?: string;
  aiDetection?: {
    isAIGenerated: boolean;
    confidence: number;
    indicators: string[];
  };
  qualityAnalysis?: {
    score: number;
    feedback: string;
    strengths: string[];
    improvements: string[];
  };
  fileAnalyses?: FileOCRAnalysis[];
  errors?: string[];
  analyzedAt?: string;
  editedByTeacher?: boolean;
  editedAt?: string;
  error?: string;
}

export interface Answer {
  id: string;
  examSessionId?: string;
  examId?: string;
  questionId?: string;
  studentId: string;
  studentName?: string;
  answer?: string | string[];
  answerFiles?: Array<{
    name?: string;
    url?: string;
    downloadURL?: string;
    type?: string;
    size?: number;
    path?: string;
  }>;
  fileUrls?: string[];
  ocrText?: string;
  ocrAnalysis?: OCRAnalysis;
  similarityScore?: number;
  similarityLevel?: "unique" | "partial" | "plagiarized";
  similarityReportId?: string;
  plagiarismDetected?: boolean;
  score?: number;
  totalMarks?: number;
  accuracy?: number;
  grading?: any;
  flagged?: boolean;
  flagReasons?: string[];
  /** Optional overall feedback a teacher leaves during review (Feature 4). */
  teacherFeedback?: string;
  teacherFeedbackAt?: FirestoreDate;
  submittedAt: FirestoreDate;
  updatedAt?: FirestoreDate;
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

export interface DashboardActivityItem {
  id: string;
  kind: "user" | "exam" | "session";
  message: string;
  detail?: string;
  /** Epoch milliseconds. */
  at: number;
}

export interface DashboardStats {
  totalStudents: number;
  totalTeachers: number;
  totalExams: number;
  activeExams: number;
  pendingApprovals: number;
  flaggedSessions: number;
  totalCourses?: number;
  /** Sessions inside the live heartbeat window right now. */
  liveSessions: number;
  publishedExams: number;
  submittedSessions: number;
  suspendedAccounts: number;
  recentActivity: DashboardActivityItem[];
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
  examId?: string;
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

// ============ Notice Module ============

export type NoticeTargetType = "all" | "course" | "batch" | "section" | "semester" | "individual";

export type NoticeStatus = "draft" | "published";

export interface Notice {
  id: string;
  title: string;
  description: string;
  // Optional attachment
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
  // Optional external link
  externalLink?: string;
  // Teacher metadata
  teacherId: string;
  teacherName: string;
  // Status
  status: NoticeStatus;
  // Targeting
  targetType: NoticeTargetType;
  targetCourseId?: string;
  targetCourseName?: string;
  targetBatch?: string;
  targetSection?: string;
  targetSemester?: string;
  targetStudentIds?: string[];
  // Timestamps
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
  publishedAt?: FirestoreDate;
}

export interface NoticeRead {
  id: string;
  noticeId: string;
  studentId: string;
  readAt: FirestoreDate;
}

export type NotificationType = "notice" | "result" | "warning" | "exam" | "general" | "classroom";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  // Link to related entity
  noticeId?: string;
  resultId?: string;
  examId?: string;
  warningId?: string;
  classroomId?: string;
  classroomPostId?: string;
  // Read status
  read: boolean;
  createdAt: FirestoreDate;
}

export interface NoticeFilters {
  searchQuery?: string;
  status?: NoticeStatus;
  targetType?: NoticeTargetType;
  dateFrom?: string;
  dateTo?: string;
}

// ============ Teacher Assignment Module ============

/**
 * A teacher assignment groups a Course + Batch + Section (optionally individual students)
 * and assigns them to one teacher.
 */
export interface TeacherAssignment {
  id: string;
  teacherId: string;
  teacherName?: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  batchId: string;
  batchName?: string;
  sectionId: string;
  sectionName?: string;
  // Optional individual student override. When empty, ALL students in the
  // course+batch+section group are assigned. When present, only these students
  // are assigned (must be a subset of the group).
  studentIds?: string[];
  createdByAdmin?: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

/**
 * Denormalized student mapping derived from a TeacherAssignment.
 * One record per teacher↔student link so teacher queries are fast and revocable.
 */
export interface TeacherStudentMapping {
  id: string;
  teacherId: string;
  studentId: string;
  studentName?: string;
  studentCode?: string;
  courseId: string;
  courseName?: string;
  batchId: string;
  batchName?: string;
  sectionId: string;
  sectionName?: string;
  assignmentId: string;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export type AssignmentAction = "created" | "updated" | "removed";

/**
 * Immutable audit trail entry for every teacher assignment change.
 */
export interface AssignmentHistory {
  id: string;
  assignmentId?: string; // the affected assignment (may be deleted on remove)
  teacherId: string;
  teacherName?: string;
  courseId: string;
  courseName?: string;
  batchName?: string;
  sectionName?: string;
  action: AssignmentAction;
  studentIds?: string[];
  studentCount?: number;
  changedByAdminId?: string;
  changedByAdminName?: string;
  notes?: string;
  timestamp: FirestoreDate;
}

// ============ Classroom Module ============

export type ClassroomStatus = "active" | "archived";

export interface Classroom {
  id: string;
  name: string;
  subject: string;
  section: string;
  semester?: string;
  description?: string;
  /** Unique, auto-generated join code (e.g. "K7X9QA"). */
  code: string;
  teacherId: string;
  teacherName: string;
  status: ClassroomStatus;
  /** Denormalized count, kept in sync on join/leave/remove. */
  studentCount?: number;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
  archivedAt?: FirestoreDate;
}

/**
 * A joined student. Document id is deterministic — `${classroomId}_${studentId}`
 * — so the Firestore rules can cheaply prevent duplicate joins and check
 * membership from other collections via exists().
 */
export interface ClassroomMember {
  id: string;
  classroomId: string;
  // Denormalized from the classroom at join/add time — lets
  // recomputeAssignedTeacherIds() derive teacher access from membership
  // alone, without an extra lookup per member.
  teacherId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentCode?: string;
  // How this membership was created — self-service code entry vs a
  // teacher-initiated add (manual or Course/Batch/Section bulk-add).
  addedVia?: "code" | "teacher";
  joinedAt: FirestoreDate;
}

export type ClassroomPostType = "announcement" | "notice" | "material";

export interface ClassroomAttachment {
  name: string;
  url: string;
  /** MIME type, or "link" for an external URL attachment. */
  type: string;
  size?: number;
}

export interface ClassroomPost {
  id: string;
  classroomId: string;
  teacherId: string;
  teacherName: string;
  type: ClassroomPostType;
  title?: string;
  content: string;
  attachments?: ClassroomAttachment[];
  pinned?: boolean;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

export interface ClassroomComment {
  id: string;
  postId: string;
  classroomId: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  content: string;
  createdAt: FirestoreDate;
}

export type ClassworkType = "assignment" | "quiz" | "material" | "resource" | "link";
export type ClassworkStatus = "draft" | "published";

export interface ClassworkItem {
  id: string;
  classroomId: string;
  teacherId: string;
  teacherName: string;
  type: ClassworkType;
  title: string;
  instructions?: string;
  attachments?: ClassroomAttachment[];
  externalLink?: string;
  dueDate?: FirestoreDate;
  totalMarks?: number;
  status: ClassworkStatus;
  /** Future-dated publish; a draft with this set is meant to auto-publish later. */
  scheduledAt?: FirestoreDate;
  createdAt: FirestoreDate;
  updatedAt: FirestoreDate;
}

/**
 * Per-recipient delivery record for classroom email notifications — the
 * audit trail behind "log delivery status" / "retry failed emails".
 */
export interface ClassroomEmailLog {
  id: string;
  classroomId: string;
  postId?: string;
  classworkId?: string;
  recipientId: string;
  recipientEmail: string;
  status: "sent" | "failed";
  error?: string;
  attempts: number;
  timestamp: FirestoreDate;
}
