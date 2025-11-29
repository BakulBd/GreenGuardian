// Live Proctoring Service
// Handles real-time video streaming and proctoring data synchronization

import { 
  doc, 
  updateDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  serverTimestamp,
  Timestamp,
  addDoc,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";

// Proctoring event types
export type ProctoringEventType = 
  | 'no_face'
  | 'multiple_faces'
  | 'looking_away'
  | 'mobile_phone_detected'
  | 'book_detected'
  | 'laptop_detected'
  | 'second_person_detected'
  | 'tab_switch'
  | 'fullscreen_exit'
  | 'window_blur'
  | 'copy_attempt'
  | 'paste_attempt'
  | 'suspicious_keyboard';

// Proctoring event severity
export const EVENT_SEVERITY: Record<ProctoringEventType, 'low' | 'medium' | 'high' | 'critical'> = {
  'no_face': 'medium',
  'multiple_faces': 'high',
  'looking_away': 'low',
  'mobile_phone_detected': 'critical',
  'book_detected': 'high',
  'laptop_detected': 'high',
  'second_person_detected': 'critical',
  'tab_switch': 'medium',
  'fullscreen_exit': 'medium',
  'window_blur': 'low',
  'copy_attempt': 'medium',
  'paste_attempt': 'medium',
  'suspicious_keyboard': 'medium',
};

// Score penalties for each event type (more practical real-world values)
export const EVENT_PENALTIES: Record<ProctoringEventType, number> = {
  'no_face': 2,           // Might be technical issue
  'multiple_faces': 8,    // Serious concern
  'looking_away': 1,      // Could be thinking
  'mobile_phone_detected': 15, // Very serious
  'book_detected': 10,    // Cheating attempt
  'laptop_detected': 12,  // Using secondary device
  'second_person_detected': 15, // Getting help
  'tab_switch': 4,        // Might be accidental
  'fullscreen_exit': 3,   // Often accidental
  'window_blur': 2,       // Could be notification
  'copy_attempt': 5,      // Deliberate action
  'paste_attempt': 6,     // More serious
  'suspicious_keyboard': 3, // Might be habit
};

// Interface for proctoring snapshot (sent periodically)
export interface ProctoringSnapshot {
  sessionId: string;
  studentId: string;
  examId: string;
  timestamp: any;
  
  // Face detection data
  faceDetected: boolean;
  faceCount: number;
  facePosition?: { x: number; y: number };
  isLookingAway: boolean;
  eyeGazeDirection?: string;
  
  // Object detection data
  mobilePhoneDetected: boolean;
  bookDetected: boolean;
  additionalDeviceDetected: boolean;
  secondPersonDetected: boolean;
  
  // Snapshot image (base64 thumbnail)
  snapshotUrl?: string;
  
  // Current scores
  behaviorScore: number;
  warningCount: number;
  
  // Status
  isOnline: boolean;
  lastActivityAt: any;
}

// Interface for proctoring event (violations)
export interface ProctoringEvent {
  sessionId: string;
  studentId: string;
  examId: string;
  eventType: ProctoringEventType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: any;
  penalty: number;
  snapshotUrl?: string;
}

// Live session data for teacher view
export interface LiveStudentSession {
  sessionId: string;
  studentId: string;
  studentName: string;
  examId: string;
  examTitle?: string;
  
  // Status
  isOnline: boolean;
  startTime: Date;
  lastActivityAt: Date;
  
  // Proctoring data
  behaviorScore: number;
  warningCount: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  // Latest snapshot
  latestSnapshot?: ProctoringSnapshot;
  
  // Recent events
  recentEvents: ProctoringEvent[];
  
  // Flags
  hasAlert: boolean;
  alertReasons: string[];
}

/**
 * Calculate practical cheating score (0-100, 100 = trustworthy)
 * Uses weighted penalties and considers context
 */
export function calculatePracticalCheatingScore(
  events: ProctoringEvent[],
  examDurationMinutes: number = 60
): { 
  score: number; 
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  breakdown: Record<string, { count: number; penalty: number }>;
  summary: string;
} {
  // Start with perfect score
  let totalPenalty = 0;
  const breakdown: Record<string, { count: number; penalty: number }> = {};
  
  // Group events by type and calculate penalties
  for (const event of events) {
    const type = event.eventType;
    if (!breakdown[type]) {
      breakdown[type] = { count: 0, penalty: 0 };
    }
    breakdown[type].count++;
    
    // Apply diminishing returns for repeated violations (first occurrence is worst)
    const occurrenceMultiplier = Math.max(0.5, 1 - (breakdown[type].count - 1) * 0.15);
    const adjustedPenalty = EVENT_PENALTIES[type] * occurrenceMultiplier;
    breakdown[type].penalty += adjustedPenalty;
    totalPenalty += adjustedPenalty;
  }
  
  // Normalize penalty based on exam duration (longer exams = more tolerance)
  const durationMultiplier = Math.max(0.7, Math.min(1.5, 60 / examDurationMinutes));
  totalPenalty *= durationMultiplier;
  
  // Calculate final score
  const score = Math.max(0, Math.round(100 - totalPenalty));
  
  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 85) riskLevel = 'low';
  else if (score >= 65) riskLevel = 'medium';
  else if (score >= 40) riskLevel = 'high';
  else riskLevel = 'critical';
  
  // Generate summary
  let summary = '';
  if (score >= 90) summary = 'Excellent exam behavior, no significant concerns';
  else if (score >= 75) summary = 'Good behavior with minor concerns';
  else if (score >= 50) summary = 'Several suspicious activities detected, review recommended';
  else if (score >= 25) summary = 'Multiple serious violations, manual review required';
  else summary = 'Critical violations detected, possible cheating attempt';
  
  return { score, riskLevel, breakdown, summary };
}

/**
 * Send proctoring snapshot (called periodically during exam)
 */
export async function sendProctoringSnapshot(
  snapshot: Omit<ProctoringSnapshot, 'timestamp'>
): Promise<void> {
  try {
    // Update session document with latest proctoring data
    await updateDoc(doc(db, "examSessions", snapshot.sessionId), {
      "proctoring.lastSnapshot": {
        ...snapshot,
        timestamp: serverTimestamp(),
      },
      "proctoring.isOnline": snapshot.isOnline,
      "proctoring.behaviorScore": snapshot.behaviorScore,
      updatedAt: serverTimestamp(),
    });
    
    // Store snapshot in snapshots collection for history
    await addDoc(collection(db, "proctoringSnapshots"), {
      ...snapshot,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to send proctoring snapshot:", error);
  }
}

/**
 * Log proctoring event (violation)
 */
export async function logProctoringEvent(
  event: Omit<ProctoringEvent, 'timestamp' | 'severity' | 'penalty'>
): Promise<void> {
  try {
    const severity = EVENT_SEVERITY[event.eventType];
    const penalty = EVENT_PENALTIES[event.eventType];
    
    await addDoc(collection(db, "proctoringEvents"), {
      ...event,
      severity,
      penalty,
      timestamp: serverTimestamp(),
    });
    
    // Update session with event count
    const sessionRef = doc(db, "examSessions", event.sessionId);
    await updateDoc(sessionRef, {
      [`proctoring.eventCounts.${event.eventType}`]: (await getDocs(
        query(
          collection(db, "proctoringEvents"),
          where("sessionId", "==", event.sessionId),
          where("eventType", "==", event.eventType)
        )
      )).size,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to log proctoring event:", error);
  }
}

/**
 * Capture video frame as base64 thumbnail
 */
export function captureVideoFrame(
  videoElement: HTMLVideoElement,
  maxWidth: number = 160,
  maxHeight: number = 120,
  quality: number = 0.6
): string | null {
  if (!videoElement || videoElement.readyState < 2) {
    return null;
  }
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Calculate aspect ratio preserving dimensions
    const aspectRatio = videoElement.videoWidth / videoElement.videoHeight;
    let width = maxWidth;
    let height = maxHeight;
    
    if (aspectRatio > maxWidth / maxHeight) {
      height = maxWidth / aspectRatio;
    } else {
      width = maxHeight * aspectRatio;
    }
    
    canvas.width = width;
    canvas.height = height;
    
    ctx.drawImage(videoElement, 0, 0, width, height);
    
    return canvas.toDataURL('image/jpeg', quality);
  } catch (error) {
    console.error("Failed to capture video frame:", error);
    return null;
  }
}

/**
 * Upload snapshot to Firebase Storage and get URL
 */
export async function uploadSnapshot(
  sessionId: string,
  base64Data: string
): Promise<string | null> {
  try {
    const timestamp = Date.now();
    const storageRef = ref(storage, `proctoring/${sessionId}/${timestamp}.jpg`);
    await uploadString(storageRef, base64Data, 'data_url');
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error("Failed to upload snapshot:", error);
    return null;
  }
}

/**
 * Subscribe to live sessions for an exam (teacher view)
 */
export function subscribeToLiveSessions(
  examId: string,
  onUpdate: (sessions: LiveStudentSession[]) => void
): () => void {
  const sessionsQuery = query(
    collection(db, "examSessions"),
    where("examId", "==", examId),
    where("status", "==", "in-progress")
  );
  
  const unsubscribe = onSnapshot(sessionsQuery, async (snapshot) => {
    const sessions: LiveStudentSession[] = [];
    
    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data();
      
      // Get recent events for this session
      const eventsQuery = query(
        collection(db, "proctoringEvents"),
        where("sessionId", "==", docSnapshot.id),
        orderBy("timestamp", "desc"),
        limit(10)
      );
      
      const eventsSnapshot = await getDocs(eventsQuery);
      const recentEvents: ProctoringEvent[] = eventsSnapshot.docs.map(e => ({
        ...e.data(),
        timestamp: e.data().timestamp?.toDate?.() || new Date(),
      })) as ProctoringEvent[];
      
      // Determine alert status
      const hasAlert = recentEvents.some(
        e => e.severity === 'critical' || e.severity === 'high'
      );
      const alertReasons = recentEvents
        .filter(e => e.severity === 'critical' || e.severity === 'high')
        .map(e => e.message)
        .slice(0, 3);
      
      // Get latest proctoring data
      const proctoring = data.proctoring || {};
      const behaviorScore = proctoring.behaviorScore ?? 100;
      const warningCount = proctoring.suspiciousEvents ?? 0;
      
      // Calculate risk level
      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      if (behaviorScore >= 85) riskLevel = 'low';
      else if (behaviorScore >= 65) riskLevel = 'medium';
      else if (behaviorScore >= 40) riskLevel = 'high';
      else riskLevel = 'critical';
      
      sessions.push({
        sessionId: docSnapshot.id,
        studentId: data.studentId,
        studentName: data.studentName || 'Unknown Student',
        examId: data.examId,
        isOnline: proctoring.isOnline ?? true,
        startTime: data.startTime?.toDate?.() || new Date(),
        lastActivityAt: data.updatedAt?.toDate?.() || new Date(),
        behaviorScore,
        warningCount,
        riskLevel,
        latestSnapshot: proctoring.lastSnapshot,
        recentEvents,
        hasAlert,
        alertReasons,
      });
    }
    
    // Sort by risk level (critical first)
    sessions.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });
    
    onUpdate(sessions);
  });
  
  return unsubscribe;
}

/**
 * Get session events history
 */
export async function getSessionEvents(
  sessionId: string
): Promise<ProctoringEvent[]> {
  const eventsQuery = query(
    collection(db, "proctoringEvents"),
    where("sessionId", "==", sessionId),
    orderBy("timestamp", "desc")
  );
  
  const snapshot = await getDocs(eventsQuery);
  return snapshot.docs.map(doc => ({
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.() || new Date(),
  })) as ProctoringEvent[];
}

/**
 * Get session snapshots history
 */
export async function getSessionSnapshots(
  sessionId: string,
  limitCount: number = 20
): Promise<ProctoringSnapshot[]> {
  const snapshotsQuery = query(
    collection(db, "proctoringSnapshots"),
    where("sessionId", "==", sessionId),
    orderBy("timestamp", "desc"),
    limit(limitCount)
  );
  
  const snapshot = await getDocs(snapshotsQuery);
  return snapshot.docs.map(doc => ({
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.() || new Date(),
  })) as ProctoringSnapshot[];
}
