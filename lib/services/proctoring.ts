// Live Proctoring Service
// Handles real-time video streaming and proctoring data synchronization

import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  serverTimestamp,
  addDoc,
  getDocs,
  deleteDoc,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { uploadDataUrl } from "@/lib/storage/client";
import { getExamsByTeacher } from "@/lib/firebase/exams";
import { authedFetch } from "@/lib/utils/api-client";

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
  | 'suspicious_keyboard'
  | 'low_light_detected'
  | 'sunglasses_detected';

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
  'low_light_detected': 'medium',
  'sunglasses_detected': 'high',
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
  'low_light_detected': 3,  // Environmental issue
  'sunglasses_detected': 6, // Intentional face/eye obstruction
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

  // Teacher-triggered suspend/resume (Task 3)
  locked: boolean;
  lockReason?: string;
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
    // Update session document with latest proctoring snapshot data (single updateDoc to save Spark quota)
    await updateDoc(doc(db, "examSessions", snapshot.sessionId), {
      "proctoring.lastSnapshot": {
        ...snapshot,
        timestamp: serverTimestamp(),
      },
      "proctoring.isOnline": snapshot.isOnline,
      "proctoring.behaviorScore": snapshot.behaviorScore,
      updatedAt: serverTimestamp(),
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

    // Bump the per-type counter atomically. (Re-counting the whole collection
    // on every event used to cost one query per violation per student.)
    const sessionRef = doc(db, "examSessions", event.sessionId);
    await updateDoc(sessionRef, {
      [`proctoring.eventCounts.${event.eventType}`]: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to log proctoring event:", error);
  }
}

/**
 * Suspend a student's in-progress exam session. The student's client watches
 * `locked` in real time and freezes the exam (timer stops, inputs disabled)
 * until a teacher resumes it. See resumeExamSession() for how the paused
 * duration is credited back to the student.
 */
export async function suspendExamSession(
  sessionId: string,
  teacherId: string,
  reason?: string
): Promise<void> {
  await updateDoc(doc(db, "examSessions", sessionId), {
    locked: true,
    lockReason: reason || "",
    lockedBy: teacherId,
    lockedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Resume a suspended exam session. The time spent locked is added to
 * `totalPausedMs` so neither the live countdown nor a resume-after-refresh
 * calculation (see ExamClient's resolvePriorAttempt) counts it against the
 * student.
 */
export async function resumeExamSession(sessionId: string): Promise<void> {
  const sessionRef = doc(db, "examSessions", sessionId);
  const snap = await getDoc(sessionRef);
  const data = snap.data();
  const lockedAtMs = data?.lockedAt ? toDateSafe(data.lockedAt).getTime() : Date.now();
  const pausedDeltaMs = Math.max(0, Date.now() - lockedAtMs);

  await updateDoc(sessionRef, {
    locked: false,
    lockReason: "",
    lockedAt: null,
    totalPausedMs: increment(pausedDeltaMs),
    updatedAt: serverTimestamp(),
  });
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

export interface FrameAnalysisResult {
  lowLight: boolean;
  averageBrightness: number;
  sunglassesDetected: boolean;
}

/**
 * Real-time webcam frame analysis for lighting conditions and face/eye obstructions (sunglasses)
 */
export function analyzeFrameLightingAndCoverage(
  videoElement: HTMLVideoElement
): FrameAnalysisResult | null {
  if (!videoElement || videoElement.readyState < 2) return null;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    canvas.width = 120;
    canvas.height = 90;
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let totalLuminance = 0;
    const pixelCount = data.length / 4;

    let eyeRegionLuminance = 0;
    let eyeRegionPixels = 0;
    let faceRegionLuminance = 0;
    let faceRegionPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // ITU-R BT.601 perceived luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLuminance += lum;

      const pixelIdx = i / 4;
      const x = pixelIdx % canvas.width;
      const y = Math.floor(pixelIdx / canvas.width);

      // Eye region approximation: upper-center box
      if (x >= 35 && x <= 85 && y >= 25 && y <= 50) {
        eyeRegionLuminance += lum;
        eyeRegionPixels++;
      }
      // Lower face region approximation: center box
      if (x >= 35 && x <= 85 && y >= 50 && y <= 75) {
        faceRegionLuminance += lum;
        faceRegionPixels++;
      }
    }

    const avgLuminance = totalLuminance / pixelCount;
    // Under 35 / 255 luminance indicates severely dim / dark room lighting
    const lowLight = avgLuminance < 35;

    const avgEyeLum = eyeRegionPixels > 0 ? eyeRegionLuminance / eyeRegionPixels : avgLuminance;
    const avgFaceLum = faceRegionPixels > 0 ? faceRegionLuminance / faceRegionPixels : avgLuminance;

    // Sunglasses / Dark Eye Cover: Eye area significantly darker than face (<0.52 ratio) while face is lit
    const sunglassesDetected = !lowLight && avgFaceLum > 45 && (avgEyeLum / Math.max(avgFaceLum, 1)) < 0.52 && avgEyeLum < 35;

    return {
      lowLight,
      averageBrightness: Math.round(avgLuminance),
      sunglassesDetected,
    };
  } catch (error) {
    console.error("Frame lighting analysis failed:", error);
    return null;
  }
}

/**
 * Upload snapshot to object storage and get a URL for it.
 */
export async function uploadSnapshot(
  sessionId: string,
  base64Data: string
): Promise<string | null> {
  const timestamp = Date.now();
  const result = await uploadDataUrl(
    base64Data,
    `proctoring/${sessionId}/${timestamp}.jpg`,
    `${timestamp}.jpg`
  );
  return result?.url ?? null;
}

/** A session is treated as "online" while it has reported activity recently. */
export const SESSION_ONLINE_WINDOW_MS = 90_000;
/** Sessions with no activity for this long are abandoned and leave the grid. */
export const SESSION_ABANDONED_WINDOW_MS = 30 * 60_000;
/** How often the per-session event list may be re-fetched (read throttling). */
const EVENTS_CACHE_TTL_MS = 20_000;

function toDateSafe(value: any): Date {
  if (!value) return new Date(0);
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * Subscribe to live sessions for an exam (teacher view).
 *
 * Two behaviours matter here and both used to be wrong:
 *  • Ghost students — every never-submitted session, however old, was shown as
 *    "live" forever. Sessions are now filtered by real activity.
 *  • Read amplification — the violation list was re-queried for every student on
 *    every single snapshot (a session writes every ~5s, so a 30-student exam
 *    burned through the Firestore quota in minutes). Results are now cached.
 */
export function subscribeToLiveSessions(
  examId: string,
  onUpdate: (sessions: LiveStudentSession[]) => void,
  onError?: (error: Error) => void
): () => void {
  const sessionsQuery = (examId && examId !== "all")
    ? query(collection(db, "examSessions"), where("examId", "==", examId))
    : query(collection(db, "examSessions"));

  const eventsCache = new Map<string, { fetchedAt: number; events: ProctoringEvent[] }>();
  let cancelled = false;

  async function loadEvents(sessionId: string): Promise<ProctoringEvent[]> {
    const cached = eventsCache.get(sessionId);
    if (cached && Date.now() - cached.fetchedAt < EVENTS_CACHE_TTL_MS) {
      return cached.events;
    }

    try {
      const eventsSnapshot = await getDocs(
        query(collection(db, "proctoringEvents"), where("sessionId", "==", sessionId))
      );
      const events = eventsSnapshot.docs
        .map((e) => ({
          ...e.data(),
          timestamp: toDateSafe(e.data().timestamp),
        }) as ProctoringEvent)
        .sort(
          (a, b) => new Date(b.timestamp as any).getTime() - new Date(a.timestamp as any).getTime()
        )
        .slice(0, 10);

      eventsCache.set(sessionId, { fetchedAt: Date.now(), events });
      return events;
    } catch {
      // Missing index / permission hiccup — keep whatever we had.
      return cached?.events ?? [];
    }
  }

  const unsubscribe = onSnapshot(sessionsQuery, async (snapshot) => {
    const now = Date.now();

    const activeDocs = snapshot.docs.filter((docSnapshot) => {
      const data = docSnapshot.data();
      if (data.submitted === true) return false;

      const status = data.status;
      if (status && status !== "in-progress" && status !== "started") return false;

      // Drop long-abandoned sessions so the grid only shows real attendees.
      const lastActivity = toDateSafe(data.updatedAt || data.startTime).getTime();
      return lastActivity === 0 || now - lastActivity < SESSION_ABANDONED_WINDOW_MS;
    });

    const sessions = await Promise.all(
      activeDocs.map(async (docSnapshot) => {
        const data = docSnapshot.data();
        const recentEvents = await loadEvents(docSnapshot.id);

        const hasAlert = recentEvents.some(
          (e) => e.severity === "critical" || e.severity === "high"
        );
        const alertReasons = recentEvents
          .filter((e) => e.severity === "critical" || e.severity === "high")
          .map((e) => e.message)
          .slice(0, 3);

        const proctoring = data.proctoring || {};
        const behaviorScore = data.behaviorScore ?? proctoring.behaviorScore ?? 100;
        const warningCount = data.warnings ?? proctoring.suspiciousEvents ?? 0;

        let riskLevel: "low" | "medium" | "high" | "critical";
        if (behaviorScore >= 85) riskLevel = "low";
        else if (behaviorScore >= 65) riskLevel = "medium";
        else if (behaviorScore >= 40) riskLevel = "high";
        else riskLevel = "critical";

        // Online is derived from the heartbeat, not from a flag the student's
        // browser has no chance to clear when the tab is closed.
        const lastActivityAt = toDateSafe(data.updatedAt || data.startTime);
        const isOnline =
          lastActivityAt.getTime() > 0
            ? now - lastActivityAt.getTime() < SESSION_ONLINE_WINDOW_MS
            : proctoring.isOnline ?? true;

        return {
          sessionId: docSnapshot.id,
          studentId: data.studentId,
          studentName: data.studentName || "Unknown Student",
          examId: data.examId,
          isOnline,
          startTime: toDateSafe(data.startTime) || new Date(),
          lastActivityAt,
          behaviorScore,
          warningCount,
          riskLevel,
          latestSnapshot: proctoring.lastSnapshot,
          recentEvents,
          hasAlert,
          alertReasons,
          locked: !!data.locked,
          lockReason: data.lockReason || undefined,
        } as LiveStudentSession;
      })
    );

    if (cancelled) return;

    // Online students first, then by risk (critical first).
    const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    sessions.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });

    onUpdate(sessions);
  }, (error) => {
    // Without this the listener dies silently on a permission or index error
    // and the monitoring grid sits on stale data with no indication it is
    // no longer live.
    if (cancelled) return;
    console.error("subscribeToLiveSessions failed:", error);
    onError?.(error);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Get session events history
 */
export async function getSessionEvents(
  sessionId: string
): Promise<ProctoringEvent[]> {
  const eventsQuery = query(
    collection(db, "proctoringEvents"),
    where("sessionId", "==", sessionId)
  );
  
  const snapshot = await getDocs(eventsQuery);
  const events = snapshot.docs.map(doc => ({
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.() || new Date(),
  })) as ProctoringEvent[];
  return events.sort((a, b) => {
    const aMs = new Date(a.timestamp as any).getTime();
    const bMs = new Date(b.timestamp as any).getTime();
    return bMs - aMs;
  });
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
    where("sessionId", "==", sessionId)
  );
  
  const snapshot = await getDocs(snapshotsQuery);
  const snapshots = snapshot.docs.map(doc => ({
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.() || new Date(),
  })) as ProctoringSnapshot[];
  return snapshots
    .sort((a, b) => {
      const aMs = new Date(a.timestamp as any).getTime();
      const bMs = new Date(b.timestamp as any).getTime();
      return bMs - aMs;
    })
    .slice(0, limitCount);
}

// ============================================================
// WARNING SCREENSHOT SERVICE
// ============================================================

// Interface for warning screenshot documents stored in Firestore
export interface WarningScreenshot {
  id?: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  examId: string;
  examTitle?: string;
  warningType: string;
  warningMessage: string;
  screenshotUrl: string;
  storagePath: string;
  timestamp: any;
}

/**
 * Capture a high-resolution screenshot from the video element,
 * upload it to Firebase Storage, and save metadata in Firestore.
 * Returns the WarningScreenshot document data or null on failure.
 * 
 * Each warning gets its own unique screenshot (never overwritten)
 * because the filename uses a unique timestamp.
 */
export async function captureAndUploadWarningScreenshot(
  videoElement: HTMLVideoElement | null,
  sessionId: string,
  studentId: string,
  studentName: string,
  examId: string,
  examTitle: string,
  warningType: string,
  warningMessage: string
): Promise<WarningScreenshot | null> {
  try {
    if (!videoElement || (videoElement.readyState < 1 && !videoElement.videoWidth)) {
      console.warn("Video element not ready for screenshot capture");
      return null;
    }

    // Capture high-resolution frame (640x480 for better quality)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn("Failed to get canvas context");
      return null;
    }

    // Use higher resolution for permanent screenshot storage
    const targetWidth = 640;
    const targetHeight = 480;
    const aspectRatio = (videoElement.videoWidth && videoElement.videoHeight) 
      ? (videoElement.videoWidth / videoElement.videoHeight)
      : (4 / 3);
    
    let width = targetWidth;
    let height = targetWidth / aspectRatio;
    
    if (height > targetHeight) {
      height = targetHeight;
      width = targetHeight * aspectRatio;
    }
    
    canvas.width = width;
    canvas.height = height;
    
    ctx.drawImage(videoElement, 0, 0, width, height);
    
    // Convert to JPEG with good quality
    const base64Data = canvas.toDataURL('image/jpeg', 0.8);
    
    // Generate unique filename using timestamp and random suffix
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const fileName = `${timestamp}_${randomSuffix}.jpg`;
    const requestedPath = `warningScreenshots/${sessionId}/${fileName}`;

    // A failed upload keeps the inline base64 as the image and records the
    // path as `inline:…`, which is what tells /api/proctoring/snapshots there
    // is no stored object to delete later. Evidence is never dropped just
    // because storage was briefly unreachable.
    const uploaded = await uploadDataUrl(base64Data, requestedPath, fileName);
    const screenshotUrl = uploaded?.url ?? base64Data;
    const storagePath = uploaded?.path ?? `inline:${requestedPath}`;

    // Create document in Firestore warningScreenshots collection
    const docRef = await addDoc(collection(db, "warningScreenshots"), {
      sessionId,
      studentId,
      studentName,
      examId,
      examTitle,
      warningType,
      warningMessage,
      screenshotUrl,
      storagePath,
      timestamp: serverTimestamp(),
    });
    
    const result: WarningScreenshot = {
      id: docRef.id,
      sessionId,
      studentId,
      studentName,
      examId,
      examTitle,
      warningType,
      warningMessage,
      screenshotUrl,
      storagePath,
      timestamp,
    };
    
    console.log(`Warning screenshot captured and saved: ${fileName}`);
    return result;
  } catch (error) {
    console.error("Failed to capture and upload warning screenshot:", error);
    return null;
  }
}

/**
 * Get all warning screenshots for a given session, ordered by most recent first.
 * Used by teachers to view screenshot history after exams.
 */
export async function getWarningScreenshots(
  sessionId: string
): Promise<WarningScreenshot[]> {
  try {
    let snapshot;
    try {
      const screenshotsQuery = query(
        collection(db, "warningScreenshots"),
        where("sessionId", "==", sessionId),
        orderBy("timestamp", "desc")
      );
      snapshot = await getDocs(screenshotsQuery);
    } catch (indexError) {
      const simpleQuery = query(
        collection(db, "warningScreenshots"),
        where("sessionId", "==", sessionId)
      );
      snapshot = await getDocs(simpleQuery);
    }

    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.() || new Date(),
    })) as WarningScreenshot[];

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  } catch (error) {
    console.warn("Failed to get warning screenshots:", error);
    return [];
  }
}

/**
 * Get all warning screenshots for a given exam (for teacher overview).
 */
export async function getExamWarningScreenshots(
  examId: string
): Promise<WarningScreenshot[]> {
  try {
    const screenshotsQuery = query(
      collection(db, "warningScreenshots"),
      where("examId", "==", examId),
      orderBy("timestamp", "desc")
    );
    
    const snapshot = await getDocs(screenshotsQuery);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.() || new Date(),
    })) as WarningScreenshot[];
  } catch (error) {
    console.error("Failed to get exam warning screenshots:", error);
    return [];
  }
}

/**
 * Get every warning screenshot captured across all of a teacher's exams —
 * powers the standalone Snapshots gallery (Task 9). Admins pass no teacherId
 * to get every screenshot in the system.
 */
export async function getWarningScreenshotsByTeacher(teacherId?: string): Promise<WarningScreenshot[]> {
  try {
    let examIds: string[] | null = null;
    if (teacherId) {
      const exams = await getExamsByTeacher(teacherId);
      if (exams.length === 0) return [];
      examIds = exams.map((e) => e.id);
    }

    const items: WarningScreenshot[] = [];

    if (examIds) {
      // Firestore `in` queries allow at most 30 values per batch.
      for (let i = 0; i < examIds.length; i += 30) {
        const chunk = examIds.slice(i, i + 30);
        const snapshot = await getDocs(
          query(collection(db, "warningScreenshots"), where("examId", "in", chunk))
        );
        snapshot.docs.forEach((d) => {
          items.push({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate?.() || new Date() } as WarningScreenshot);
        });
      }
    } else {
      const snapshot = await getDocs(collection(db, "warningScreenshots"));
      snapshot.docs.forEach((d) => {
        items.push({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate?.() || new Date() } as WarningScreenshot);
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  } catch (error) {
    console.error("Failed to get teacher warning screenshots:", error);
    return [];
  }
}

/**
 * Permanently delete a warning screenshot — the Storage object (if it was
 * actually uploaded there rather than falling back to inline base64) and the
 * Firestore record.
 *
 * This goes through `/api/proctoring/snapshots` (Admin SDK) rather than
 * deleting from the browser: `storage.rules` denies client-side deletes on
 * `warningScreenshots/*` outright (a student must not be able to destroy
 * proctoring evidence raised against them), and a direct browser DELETE also
 * depends on the live bucket's CORS configuration, which is a separate
 * failure mode this route sidesteps entirely. The API enforces that only the
 * exam's owning teacher (or an admin) may delete.
 */
export async function deleteWarningScreenshot(screenshot: WarningScreenshot): Promise<void> {
  if (!screenshot.id) throw new Error("Screenshot has no id");

  await authedFetch(`/api/proctoring/snapshots?id=${encodeURIComponent(screenshot.id)}`, {
    method: "DELETE",
    fallbackError: "Failed to delete the snapshot.",
  });
}
