"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Clock, 
  AlertTriangle, 
  Camera, 
  ChevronLeft, 
  ChevronRight,
  Send,
  Loader2,
  CheckCircle,
  Shield,
  Monitor,
  TrendingDown,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { doc, getDoc, addDoc, collection, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { 
  loadFaceDetectionModel, 
  disposeFaceDetectionModel,
  clearWarningCooldowns,
} from "@/lib/utils/faceDetection";
import {
  ViolationCounts,
  initializeViolationCounts,
  getViolationType,
  calculateBehaviorScore,
  getBehaviorLevel,
} from "@/lib/utils/helpers";
import { analyzeSubmittedAnswer } from "@/lib/utils/gemini";
import CameraPermission from "@/components/CameraPermission";
import FileUpload from "@/components/FileUpload";
import { UploadResult, ANSWER_ALLOWED_TYPES } from "@/lib/firebase/storage";

interface Question {
  id: string;
  text: string;
  type: "multiple-choice" | "true-false" | "short-answer";
  options: string[];
  marks: number;
}

interface ExamPaper {
  url: string;
  name: string;
  type: string;
  size: number;
}

interface Exam {
  id: string;
  title: string;
  description: string;
  duration: number;
  questions?: Question[];
  examPapers?: ExamPaper[];
  examMode?: "online" | "upload";
  shuffleQuestions: boolean;
  showResults: boolean;
  passingScore: number;
  allowAnswerUpload?: boolean;
  totalMarks: number;
}

export default function ExamClient() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const snapshotIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [exam, setExam] = useState<Exam | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerFiles, setAnswerFiles] = useState<UploadResult[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [warnings, setWarnings] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showCameraPermission, setShowCameraPermission] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [examStep, setExamStep] = useState<"info" | "camera" | "ready" | "started">("info");
  const [selectedPaper, setSelectedPaper] = useState(0);
  
  // Behavior score tracking - starts at 100, deducted for violations
  const [behaviorScore, setBehaviorScore] = useState(100);
  const [violationCounts, setViolationCounts] = useState<ViolationCounts>(initializeViolationCounts());

  const maxWarnings = 5;

  // Load exam data
  useEffect(() => {
    if (params.id) {
      loadExam(params.id as string);
    }
  }, [params.id]);

  // Timer
  useEffect(() => {
    if (!examStarted || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [examStarted]);

  // Tab visibility detection
  useEffect(() => {
    if (!examStarted) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        addWarning("Tab switch detected");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [examStarted]);

  // Fullscreen detection - Moved to after addWarning is defined

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
      }
      disposeFaceDetectionModel();
    };
  }, []);

  // Safe play function that handles the AbortError gracefully
  const playVideoRef = useRef<Promise<void> | null>(null);
  const safePlayVideo = useCallback((videoElement: HTMLVideoElement) => {
    // If video is already playing, don't call play again
    if (!videoElement.paused) return;
    
    // Wait for any previous play to complete/fail before starting new one
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
      playVideoRef.current = playPromise;
      playPromise
        .then(() => {
          playVideoRef.current = null;
        })
        .catch((err) => {
          playVideoRef.current = null;
          // Only log non-abort errors
          if (err.name !== 'AbortError') {
            console.error("Error playing video:", err);
          }
        });
    }
  }, []);

  // Callback ref to attach camera stream when video element mounts
  const attachStreamToVideo = useCallback((videoElement: HTMLVideoElement | null) => {
    // Store reference for face detection
    videoRef.current = videoElement;
    
    if (videoElement && cameraStream) {
      // Attach stream if not already attached
      if (videoElement.srcObject !== cameraStream) {
        videoElement.srcObject = cameraStream;
        streamRef.current = cameraStream;
        safePlayVideo(videoElement);
      }
    }
  }, [cameraStream, safePlayVideo]);

  // Re-attach camera stream when examStep or cameraStream changes
  useEffect(() => {
    if (!((examStep === "ready" || examStep === "started") && cameraStream && videoRef.current)) return;
    
    const videoEl = videoRef.current;
    
    // Only attach if not already attached
    if (videoEl.srcObject !== cameraStream) {
      videoEl.srcObject = cameraStream;
      streamRef.current = cameraStream;
    }
    
    // Single delayed play after DOM settles
    const timeoutId = setTimeout(() => {
      if (videoRef.current) {
        safePlayVideo(videoRef.current);
      }
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [examStep, cameraStream, safePlayVideo]);

  // Keep camera stream alive during exam with periodic checks and auto-reconnect
  useEffect(() => {
    if (!cameraStream) return;
    
    // Check stream health and reattach if needed
    const checkStreamHealth = () => {
      const tracks = cameraStream.getVideoTracks();
      const isActive = tracks.length > 0 && tracks[0].readyState === 'live';
      
      if (!isActive) {
        console.warn("Camera stream ended unexpectedly");
        setCameraEnabled(false);
        
        // Only show alert during exam (and only once)
        if (examStarted) {
          toast({
            title: "Camera Disconnected",
            description: "Your camera stream was interrupted. Please refresh the page.",
            variant: "destructive",
          });
        }
        return;
      }
      
      // Re-attach stream if video element exists but stream isn't attached
      if (videoRef.current && videoRef.current.srcObject !== cameraStream) {
        console.log("Re-attaching camera stream to video element");
        videoRef.current.srcObject = cameraStream;
        safePlayVideo(videoRef.current);
      }
      
      setCameraEnabled(true);
    };
    
    // Initial check after a short delay (let DOM settle)
    const initialTimeout = setTimeout(checkStreamHealth, 500);
    
    // Periodic health checks (less frequent to avoid issues)
    const keepAliveInterval = setInterval(checkStreamHealth, 3000);
    
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(keepAliveInterval);
    };
  }, [cameraStream, examStarted, toast, safePlayVideo]);

  const loadExam = async (examId: string) => {
    try {
      const examDoc = await getDoc(doc(db, "exams", examId));
      if (!examDoc.exists()) {
        toast({
          title: "Error",
          description: "Exam not found",
          variant: "destructive",
        });
        router.push("/dashboard/student");
        return;
      }

      const examData = { id: examDoc.id, ...examDoc.data() } as Exam;
      
      // Shuffle questions if enabled
      if (examData.shuffleQuestions && examData.questions) {
        examData.questions = [...examData.questions].sort(() => Math.random() - 0.5);
      }

      // Remove correct answers from questions
      if (examData.questions) {
        examData.questions = examData.questions.map(q => ({
          ...q,
          correctAnswer: undefined,
        })) as Question[];
      }

      setExam(examData);
      setTimeLeft(examData.duration * 60);
    } catch (error) {
      console.error("Error loading exam:", error);
      toast({
        title: "Error",
        description: "Failed to load exam",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Queue for pending warnings to avoid setState during render
  const pendingWarningsRef = useRef<{ count: number; reason: string }[]>([]);
  const submittedRef = useRef(false); // Track if exam already submitted

  const addWarning = useCallback((reason: string) => {
    // Don't add more warnings if exam was already submitted
    if (submittedRef.current) return;
    
    setWarnings((prev) => {
      // Don't exceed max warnings
      if (prev >= maxWarnings) return prev;
      
      const newCount = prev + 1;
      
      // Track the violation type and update counts
      const violationType = getViolationType(reason);
      
      if (violationType) {
        setViolationCounts((prevCounts) => {
          const newCounts = { ...prevCounts, [violationType]: prevCounts[violationType] + 1 };
          // Calculate new behavior score
          const newScore = calculateBehaviorScore(newCounts);
          setBehaviorScore(newScore);
          return newCounts;
        });
      }
      
      // Queue the toast notification to be shown in useEffect
      pendingWarningsRef.current.push({ count: newCount, reason });

      // Log warning to Firestore (this is async, won't cause render issues)
      if (sessionId && user) {
        addDoc(collection(db, "examLogs"), {
          sessionId,
          studentId: user.id, // Required for Firestore rules
          examSessionId: sessionId,
          type: "warning",
          violationType: violationType || "other",
          reason,
          timestamp: serverTimestamp(),
        }).catch(err => console.error("Failed to log warning:", err));
      }

      return newCount;
    });
  }, [sessionId, user, maxWarnings]);

  // Effect to show toast notifications for warnings (avoids setState during render)
  useEffect(() => {
    if (pendingWarningsRef.current.length > 0) {
      const pending = pendingWarningsRef.current.shift();
      if (pending) {
        toast({
          title: `Warning (${pending.count}/${maxWarnings})`,
          description: pending.reason,
          variant: "destructive",
        });

        if (pending.count >= maxWarnings) {
          handleSubmit(true, "Too many warnings");
        }
      }
    }
  }, [warnings, toast]);

  // Track if fullscreen was exited (for showing re-enter prompt)
  const [fullscreenExited, setFullscreenExited] = useState(false);

  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreen(true);
      setFullscreenExited(false);
    } catch (error) {
      console.error("Failed to enter fullscreen:", error);
    }
  };

  // Fullscreen detection (moved after addWarning definition)
  useEffect(() => {
    if (!examStarted) return;

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && examStarted) {
        setFullscreen(false);
        setFullscreenExited(true);
        addWarning("Exited fullscreen mode");
        // Don't auto-enter fullscreen here - it requires user gesture
        // Show a button for user to re-enter fullscreen
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [examStarted, addWarning]);

  // Anti-cheat: Prevent copy/paste and right-click (with cooldowns to avoid spam)
  const antiCheatCooldownRef = useRef<Map<string, number>>(new Map());
  
  useEffect(() => {
    if (!examStarted) return;

    const isInCooldown = (action: string): boolean => {
      const lastTime = antiCheatCooldownRef.current.get(action);
      if (!lastTime) return false;
      return Date.now() - lastTime < 30000; // 30 second cooldown between same warnings
    };

    const setCooldown = (action: string) => {
      antiCheatCooldownRef.current.set(action, Date.now());
    };

    const preventCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      if (!isInCooldown('copy')) {
        addWarning("Copy attempt detected");
        setCooldown('copy');
      }
    };

    const preventPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      if (!isInCooldown('paste')) {
        addWarning("Paste attempt detected");
        setCooldown('paste');
      }
    };

    const preventCut = (e: ClipboardEvent) => {
      e.preventDefault();
      // Cut is same as copy, use same cooldown
      if (!isInCooldown('copy')) {
        addWarning("Cut attempt detected");
        setCooldown('copy');
      }
    };

    // Right-click: just prevent, don't warn (too many false positives)
    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // No warning - just silently block
    };

    document.addEventListener("copy", preventCopy);
    document.addEventListener("paste", preventPaste);
    document.addEventListener("cut", preventCut);
    document.addEventListener("contextmenu", preventContextMenu);

    return () => {
      document.removeEventListener("copy", preventCopy);
      document.removeEventListener("paste", preventPaste);
      document.removeEventListener("cut", preventCut);
      document.removeEventListener("contextmenu", preventContextMenu);
    };
  }, [examStarted, addWarning]);

  // Anti-cheat: Prevent suspicious keyboard shortcuts (with cooldown)
  const keyboardWarningRef = useRef<boolean>(false);
  
  useEffect(() => {
    if (!examStarted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block developer tools shortcuts
      if (
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i")) || // Ctrl+Shift+I
        (e.ctrlKey && e.shiftKey && (e.key === "J" || e.key === "j")) || // Ctrl+Shift+J
        (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) || // Ctrl+Shift+C
        e.key === "F12" || // F12
        (e.ctrlKey && (e.key === "U" || e.key === "u")) || // Ctrl+U (View source)
        (e.ctrlKey && (e.key === "S" || e.key === "s")) || // Ctrl+S (Save page)
        (e.ctrlKey && (e.key === "P" || e.key === "p")) // Ctrl+P (Print)
      ) {
        e.preventDefault();
        // Only warn once per exam session for keyboard shortcuts
        if (!keyboardWarningRef.current) {
          addWarning("Suspicious keyboard shortcut detected");
          keyboardWarningRef.current = true;
        }
        return;
      }

      // Block Alt+Tab and window switching (when possible) - silently
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        // No warning - Alt+Tab is often accidental and browser handles it anyway
      }

      // Block Escape key (trying to exit fullscreen)
      if (e.key === "Escape") {
        e.preventDefault();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [examStarted, addWarning]);

  // Anti-cheat: Detect window blur (unfocus) - with longer delay to reduce false positives
  const lastBlurWarningRef = useRef<number>(0);
  
  useEffect(() => {
    if (!examStarted) return;

    let blurTimeoutId: NodeJS.Timeout | null = null;

    const handleBlur = () => {
      // Longer delay (2 seconds) to avoid false positives from browser UI interactions
      blurTimeoutId = setTimeout(() => {
        // 60 second cooldown between blur warnings
        if (Date.now() - lastBlurWarningRef.current > 60000) {
          addWarning("Window lost focus");
          lastBlurWarningRef.current = Date.now();
        }
      }, 2000);
    };

    const handleFocus = () => {
      if (blurTimeoutId) {
        clearTimeout(blurTimeoutId);
        blurTimeoutId = null;
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      if (blurTimeoutId) clearTimeout(blurTimeoutId);
    };
  }, [examStarted, addWarning]);

  // Anti-cheat: Detect multiple windows/tabs
  useEffect(() => {
    if (!examStarted || !sessionId) return;

    const channel = new BroadcastChannel(`exam_${sessionId}`);
    
    // Announce presence
    channel.postMessage({ type: "presence", sessionId });

    // Listen for other instances
    channel.onmessage = (event) => {
      if (event.data.type === "presence" && event.data.sessionId === sessionId) {
        addWarning("Multiple exam windows detected");
      }
    };

    return () => {
      channel.close();
    };
  }, [examStarted, sessionId, addWarning]);

  // Handle camera permission granted
  const handleCameraPermissionGranted = useCallback(async (stream: MediaStream) => {
    setCameraStream(stream);
    streamRef.current = stream;
    
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    
    setCameraEnabled(true);
    
    // Load face detection model
    try {
      await loadFaceDetectionModel();
      setModelLoaded(true);
    } catch (error) {
      console.error("Failed to load face detection model:", error);
      toast({
        title: "Warning",
        description: "Face detection may not work optimally. You can still continue.",
        variant: "default",
      });
    }
    
    setExamStep("ready");
  }, [toast]);

  // Handle camera permission denied
  const handleCameraPermissionDenied = useCallback(() => {
    toast({
      title: "Camera Required",
      description: "You must allow camera access to take this exam.",
      variant: "destructive",
    });
  }, [toast]);

  const setupCamera = async () => {
    // If we already have a stream from the permission flow, use it
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      streamRef.current = cameraStream;
      setCameraEnabled(true);
      
      // Start face detection
      startFaceDetection();
      return true;
    }
    
    return false;
  };
  
  const startFaceDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }
    if (snapshotIntervalRef.current) {
      clearInterval(snapshotIntervalRef.current);
    }
    
    // Import detection utilities with proper error handling
    const loadModules = async () => {
      try {
        const [faceModule, objectModule, proctoringModule] = await Promise.all([
          import('@/lib/utils/faceDetection').catch(() => null),
          import('@/lib/utils/objectDetection').catch(() => null),
          import('@/lib/services/proctoring').catch(() => null)
        ]);
        
        if (!faceModule) {
          console.error("Failed to load face detection module");
          return;
        }
        
        const { 
          detectFaces, 
          shouldTriggerWarning,
          DETECTION_CONFIG,
          clearWarningCooldowns 
        } = faceModule;
        
        // Object detection is optional - may fail on some devices
        const objectDetectionAvailable = objectModule && objectModule.checkForProhibitedObjects;
        if (objectModule?.clearObjectWarningCooldowns) {
          objectModule.clearObjectWarningCooldowns();
        }
        
        // Proctoring is optional for snapshots
        const proctoringAvailable = proctoringModule && proctoringModule.captureVideoFrame;
        
        // Clear face detection cooldowns
        clearWarningCooldowns();
        
        // Load object detection model in background (don't block, optional)
        if (objectModule?.loadObjectDetectionModel) {
          objectModule.loadObjectDetectionModel().catch(() => {
            console.warn("Object detection not available on this device");
          });
        }
        
        // Detection interval - runs every 6 seconds
        detectionIntervalRef.current = setInterval(async () => {
          if (videoRef.current && modelLoaded) {
            try {
              // Face detection
              const result = await detectFaces(videoRef.current);
              const videoWidth = videoRef.current.videoWidth || 640;
              const videoHeight = videoRef.current.videoHeight || 480;
              
              // Use smart detection with cooldowns to reduce false positives
              if (shouldTriggerWarning(result, videoWidth, videoHeight, "no_face")) {
                addWarning("No face detected");
              } else if (shouldTriggerWarning(result, videoWidth, videoHeight, "multiple_faces")) {
                addWarning("Multiple faces detected");
              } else if (shouldTriggerWarning(result, videoWidth, videoHeight, "looking_away")) {
                addWarning("Looking away from screen");
              }
              
              // Object detection (mobile phone, books, etc.) - only if available
              if (objectDetectionAvailable) {
                try {
                  const objectWarning = await objectModule.checkForProhibitedObjects(videoRef.current);
                  if (objectWarning) {
                    addWarning(objectWarning.message);
                    
                    // Log proctoring event for object detection
                    if (proctoringAvailable && sessionId && user && exam) {
                      proctoringModule.logProctoringEvent({
                        sessionId,
                        studentId: user.id,
                        examId: exam.id,
                        eventType: objectWarning.warningType as any,
                        message: objectWarning.message,
                      }).catch(console.error);
                    }
                  }
                } catch (objErr) {
                  // Object detection failure is not critical
                  console.warn("Object detection error (non-critical):", objErr);
                }
              }
            } catch (error) {
              console.error("Face detection error:", error);
            }
          }
        }, DETECTION_CONFIG.DETECTION_INTERVAL_MS);
        
        // Snapshot interval - send snapshot to Firebase every 30 seconds for teacher live view
        if (proctoringAvailable) {
          snapshotIntervalRef.current = setInterval(async () => {
            if (videoRef.current && sessionId && user && exam) {
              try {
                const thumbnail = proctoringModule.captureVideoFrame(videoRef.current, 160, 120, 0.6);
                
                if (thumbnail) {
                  await proctoringModule.sendProctoringSnapshot({
                    sessionId,
                    studentId: user.id,
                    examId: exam.id,
                    faceDetected: true,
                    faceCount: 1,
                    isLookingAway: false,
                    mobilePhoneDetected: false,
                    bookDetected: false,
                    additionalDeviceDetected: false,
                    secondPersonDetected: false,
                    snapshotUrl: thumbnail,
                    behaviorScore,
                    warningCount: warnings,
                    isOnline: true,
                    lastActivityAt: serverTimestamp(),
                  });
                }
              } catch (error) {
                console.error("Failed to send snapshot:", error);
              }
            }
          }, 30000); // Every 30 seconds
        }
      } catch (error) {
        console.error("Failed to initialize detection modules:", error);
      }
    };
    
    loadModules();
  }, [modelLoaded, addWarning, sessionId, user, exam, behaviorScore, warnings]);

  const proceedToCamera = () => {
    setExamStep("camera");
  };

  const startExam = async () => {
    if (!user || !exam) return;

    setStarting(true);
    try {
      // Create exam session
      const sessionRef = await addDoc(collection(db, "examSessions"), {
        examId: exam.id,
        studentId: user.id,
        studentName: user.name || user.email,
        startTime: serverTimestamp(),
        status: "in-progress",
        submitted: false,
        riskScore: 0,
        flagged: false,
        flagReasons: [],
        proctoring: {
          tabSwitches: 0,
          fullscreenExits: 0,
          noFaceDuration: 0,
          multipleFacesCount: 0,
          attentionAwayDuration: 0,
          suspiciousEvents: 0,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSessionId(sessionRef.id);

      // Setup camera (attach existing stream)
      await setupCamera();
      
      // Start face detection
      startFaceDetection();
      
      // Enter fullscreen
      await enterFullscreen();

      setExamStep("started");
      setExamStarted(true);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start exam",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  const handleSubmit = async (auto = false, reason?: string) => {
    if (!user || !exam || !sessionId) return;

    // Prevent multiple submissions and further warnings
    if (submittedRef.current) return;
    submittedRef.current = true;

    // For upload mode, check if files are uploaded
    if (exam.examMode === "upload" && answerFiles.length === 0 && !auto) {
      submittedRef.current = false; // Reset if validation fails
      toast({
        title: "No Answer Uploaded",
        description: "Please upload your answer file(s) before submitting.",
        variant: "destructive",
      });
      return;
    }

    // Stop detection immediately to prevent more warnings
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }

    setSubmitting(true);
    const MAX_RETRIES = 3;
    let attempt = 0;
    let lastError: any = null;
    // Helper for retrying async Firestore writes
    async function retryAsync(fn: () => Promise<any>, label: string) {
      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          return await fn();
        } catch (err: any) {
          lastError = err;
          console.error(`Attempt ${i + 1} failed for ${label}:`, err);
          if (i < MAX_RETRIES - 1) {
            await new Promise(res => setTimeout(res, 500 * (i + 1)));
          }
        }
      }
      throw lastError;
    }
    try {
      // Save answers with behavior score
      const answerData: any = {
        sessionId,
        examSessionId: sessionId, // Required by Firestore rules
        examId: exam.id,
        studentId: user.id,
        submittedAt: serverTimestamp(),
        autoSubmitted: auto,
        reason,
        behaviorScore, // Include behavior score (0-100)
        violationCounts, // Include detailed violation breakdown
      };

      // For online mode, include answers object
      if (exam.examMode === "online" || !exam.examMode) {
        answerData.answers = answers;
      } else {
        // For upload mode, include answer files and run OCR analysis
        answerData.answerFiles = answerFiles;
        // Run OCR and AI detection on uploaded files (async, don't block submission)
        if (answerFiles.length > 0) {
          try {
            // Analyze the first uploaded file
            const primaryFile = answerFiles[0];
            if (primaryFile.url) {
              const analysis = await analyzeSubmittedAnswer(primaryFile.url);
              // Store OCR results with the answer
              answerData.ocrAnalysis = {
                extractedText: analysis.extractedText.substring(0, 10000), // Limit text size
                wordCount: analysis.wordCount,
                aiDetection: analysis.aiDetection,
                errors: analysis.errors,
                analyzedAt: new Date().toISOString(),
              };
            }
          } catch (ocrError) {
            console.error("OCR analysis error (non-blocking):", ocrError);
            // OCR failure shouldn't block submission
            answerData.ocrAnalysis = {
              error: "Analysis failed - will be processed later",
            };
          }
        }
      }

      // Retry Firestore writes for reliability
      await retryAsync(() => addDoc(collection(db, "answers"), answerData), "addDoc(answers)");
      await retryAsync(() => updateDoc(doc(db, "examSessions", sessionId), {
        status: "completed",
        completedAt: serverTimestamp(),
        warnings,
        behaviorScore,
        violationCounts,
        autoSubmitted: auto,
        flagged: behaviorScore < 50, // Flag if behavior score is poor
        flagReasons: behaviorScore < 50 ? ["Poor behavior score"] : [],
      }), "updateDoc(examSessions)");

      // Stop camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }

      // Exit fullscreen
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      toast({
        title: auto ? "Exam Auto-Submitted" : "Exam Submitted",
        description: auto ? reason : "Your answers have been submitted successfully",
      });

      router.push("/dashboard/student");
    } catch (error: any) {
      let message = error?.message || "Failed to submit exam";
      if (lastError) {
        message += `. Last error: ${lastError.message || lastError}`;
      }
      toast({
        title: "Submission Error",
        description: message +
          " Please check your internet connection and try again. If the problem persists, contact support.",
        variant: "destructive",
      });
      // Allow retry
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const setAnswer = (questionId: string, answer: string) => {
    setAnswers({ ...answers, [questionId]: answer });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500" />
            <h2 className="mt-4 text-xl font-semibold">Exam Not Found</h2>
            <Button className="mt-4" onClick={() => router.push("/dashboard/student")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!examStarted) {
    // Step 1: Show exam info
    if (examStep === "info") {
      return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">{exam.title}</CardTitle>
                <CardDescription>{exam.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-100 rounded-lg">
                    <p className="text-sm text-gray-500">Duration</p>
                    <p className="text-lg font-semibold">{exam.duration} minutes</p>
                  </div>
                  <div className="p-4 bg-gray-100 rounded-lg">
                    <p className="text-sm text-gray-500">Questions</p>
                    <p className="text-lg font-semibold">{exam.questions?.length || 0}</p>
                  </div>
                  <div className="p-4 bg-gray-100 rounded-lg">
                    <p className="text-sm text-gray-500">Passing Score</p>
                    <p className="text-lg font-semibold">{exam.passingScore || 40}%</p>
                  </div>
                  <div className="p-4 bg-gray-100 rounded-lg">
                    <p className="text-sm text-gray-500">Max Warnings</p>
                    <p className="text-lg font-semibold">{maxWarnings}</p>
                  </div>
                </div>

                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertTitle>Proctored Exam</AlertTitle>
                  <AlertDescription>
                    This exam uses AI-powered proctoring to ensure academic integrity. 
                    Your camera will be used throughout the exam.
                  </AlertDescription>
                </Alert>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="font-semibold text-yellow-800 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    Important Instructions
                  </h3>
                  <ul className="mt-2 text-sm text-yellow-700 space-y-1">
                    <li>• Ensure your webcam is working properly</li>
                    <li>• Find a well-lit, quiet environment</li>
                    <li>• Do not switch tabs or minimize the browser</li>
                    <li>• Stay in fullscreen mode throughout the exam</li>
                    <li>• Keep your face visible in the camera at all times</li>
                    <li>• No other person should be visible in the camera</li>
                    <li>• Exceeding {maxWarnings} warnings will auto-submit the exam</li>
                  </ul>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-800 flex items-center gap-2">
                    <Monitor className="h-5 w-5" />
                    System Requirements
                  </h3>
                  <ul className="mt-2 text-sm text-blue-700 space-y-1">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Working webcam (front-facing camera)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Stable internet connection
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Modern browser (Chrome recommended)
                    </li>
                  </ul>
                </div>

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    onClick={() => router.push("/dashboard/student")}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={proceedToCamera}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Continue to Camera Setup
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    // Step 2: Camera permission
    if (examStep === "camera") {
      return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
          <div className="max-w-2xl mx-auto space-y-4">
            <Button
              variant="ghost"
              onClick={() => setExamStep("info")}
              className="mb-4"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back to Instructions
            </Button>
            
            <CameraPermission
              onPermissionGranted={handleCameraPermissionGranted}
              onPermissionDenied={handleCameraPermissionDenied}
              required={true}
              title="Camera Setup"
              description="Allow camera access to enable proctoring for this exam."
            />
          </div>
        </div>
      );
    }

    // Step 3: Ready to start
    if (examStep === "ready") {
      return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-4 bg-green-100 rounded-full">
                    <CheckCircle className="h-12 w-12 text-green-600" />
                  </div>
                </div>
                <CardTitle className="text-2xl">Ready to Start!</CardTitle>
                <CardDescription>
                  Camera is set up and working. You're all set to begin the exam.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Camera Preview */}
                <div className="relative rounded-lg overflow-hidden bg-black aspect-video max-w-md mx-auto">
                  <video
                    ref={attachStreamToVideo}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  <div className="absolute top-2 left-2">
                    <Badge className="bg-green-500/80">
                      <span className="animate-pulse mr-1">●</span> Camera Active
                    </Badge>
                  </div>
                  {modelLoaded && (
                    <div className="absolute top-2 right-2">
                      <Badge className="bg-blue-500/80">
                        AI Ready
                      </Badge>
                    </div>
                  )}
                </div>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Before you begin</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 space-y-1 text-sm">
                      <li>• The exam will enter fullscreen mode</li>
                      <li>• The timer will start immediately</li>
                      <li>• You cannot pause the exam once started</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="grid grid-cols-3 text-center divide-x">
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{exam.duration}</p>
                      <p className="text-sm text-gray-500">Minutes</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{exam.questions?.length || 0}</p>
                      <p className="text-sm text-gray-500">Questions</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{maxWarnings}</p>
                      <p className="text-sm text-gray-500">Max Warnings</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    onClick={() => setExamStep("camera")}
                    className="flex-1"
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    onClick={startExam}
                    disabled={starting}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    size="lg"
                  >
                    {starting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        Start Exam Now
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }
  }

  // Original exam started check moved after the step-based flow
  if (!examStarted) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">{exam.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-gray-600">{exam.description}</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-500">Duration</p>
                  <p className="text-lg font-semibold">{exam.duration} minutes</p>
                </div>
                <div className="p-4 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-500">Questions</p>
                  <p className="text-lg font-semibold">{exam.questions?.length || 0}</p>
                </div>
                <div className="p-4 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-500">Passing Score</p>
                  <p className="text-lg font-semibold">{exam.passingScore || 40}%</p>
                </div>
                <div className="p-4 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-500">Max Warnings</p>
                  <p className="text-lg font-semibold">{maxWarnings}</p>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-800 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Instructions
                </h3>
                <ul className="mt-2 text-sm text-yellow-700 space-y-1">
                  <li>• Ensure your webcam is working properly</li>
                  <li>• Do not switch tabs or minimize the browser</li>
                  <li>• Stay in fullscreen mode throughout the exam</li>
                  <li>• Keep your face visible in the camera at all times</li>
                  <li>• No other person should be visible in the camera</li>
                  <li>• Exceeding {maxWarnings} warnings will auto-submit the exam</li>
                </ul>
              </div>

              <div className="flex gap-4">
                <Button
                  variant="outline"
                  onClick={() => router.push("/dashboard/student")}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={startExam}
                  disabled={starting}
                  className="flex-1"
                >
                  {starting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Camera className="mr-2 h-4 w-4" />
                      Start Exam
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Check for valid exam content
  const isOnlineMode = exam.examMode === "online" || !exam.examMode;
  const isUploadMode = exam.examMode === "upload";

  if (isOnlineMode && (!exam.questions || exam.questions.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500" />
            <h2 className="mt-4 text-xl font-semibold">No Questions</h2>
            <p className="text-gray-600 mt-2">This exam has no questions yet.</p>
            <Button className="mt-4" onClick={() => router.push("/dashboard/student")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isUploadMode && (!exam.examPapers || exam.examPapers.length === 0)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500" />
            <h2 className="mt-4 text-xl font-semibold">No Exam Papers</h2>
            <p className="text-gray-600 mt-2">This exam has no papers uploaded yet.</p>
            <Button className="mt-4" onClick={() => router.push("/dashboard/student")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Upload Mode Exam View
  if (isUploadMode) {
    return (
      <div 
        className="min-h-screen bg-gray-900 text-white select-none"
        style={{ userSelect: "none", WebkitUserSelect: "none" }}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* Header */}
        <header className="bg-gray-800 border-b border-gray-700 px-3 sm:px-4 py-2 sm:py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
            <h1 className="font-semibold text-sm sm:text-base truncate flex-1">{exam.title}</h1>
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              {/* Fullscreen re-enter button */}
              {fullscreenExited && (
                <Button
                  onClick={enterFullscreen}
                  variant="destructive"
                  size="sm"
                  className="animate-pulse text-xs sm:text-sm"
                >
                  <Monitor className="h-3 w-3 sm:mr-1" />
                  <span className="hidden sm:inline">Re-enter Fullscreen</span>
                </Button>
              )}
              {/* Mobile: Compact badges */}
              <div className="flex sm:hidden items-center gap-1">
                <Badge 
                  variant="outline" 
                  className={`text-xs px-1.5 py-0.5 ${
                    behaviorScore >= 75 ? "bg-green-900/50 text-green-300 border-green-700" :
                    behaviorScore >= 50 ? "bg-yellow-900/50 text-yellow-300 border-yellow-700" :
                    "bg-red-900/50 text-red-300 border-red-700"
                  }`}
                >
                  {behaviorScore}
                </Badge>
                <Badge 
                  variant={warnings > 2 ? "destructive" : "secondary"} 
                  className="text-xs px-1.5 py-0.5"
                >
                  {warnings}/{maxWarnings}
                </Badge>
              </div>
              {/* Desktop: Full badges */}
              <Badge 
                variant="outline" 
                className={`hidden sm:flex ${
                  behaviorScore >= 75 ? "bg-green-900/50 text-green-300 border-green-700" :
                  behaviorScore >= 50 ? "bg-yellow-900/50 text-yellow-300 border-yellow-700" :
                  "bg-red-900/50 text-red-300 border-red-700"
                }`}
              >
                <TrendingDown className="h-3 w-3 mr-1" />
                Score: {behaviorScore}
              </Badge>
              <Badge variant={warnings > 2 ? "destructive" : "secondary"} className="hidden sm:flex">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {warnings}/{maxWarnings}
              </Badge>
              <Badge 
                variant={timeLeft < 300 ? "destructive" : "outline"} 
                className={`text-sm sm:text-lg ${timeLeft < 300 ? "animate-pulse" : ""}`}
              >
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                {formatTime(timeLeft)}
              </Badge>
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto p-2 sm:p-4 grid lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Camera Preview and Controls */}
          <div className="lg:col-span-1 order-1 lg:order-2 space-y-3 sm:space-y-4">
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-2">
                <video
                  ref={attachStreamToVideo}
                  autoPlay
                  playsInline
                  muted
                  className="w-full aspect-video rounded-lg bg-black"
                  style={{ transform: "scaleX(-1)" }}
                />
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span className={cameraEnabled ? "text-green-500" : "text-red-500"}>
                    {cameraEnabled ? "Camera Active" : "Camera Off"}
                  </span>
                  <span className={modelLoaded ? "text-green-500" : "text-yellow-500"}>
                    {modelLoaded ? "AI Ready" : "Loading AI..."}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Upload Answer Section */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-white">Upload Your Answer</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <FileUpload
                    basePath={`answers/${sessionId}`}
                    onUploadComplete={(files) => setAnswerFiles(files)}
                    maxFiles={10}
                    allowedTypes={ANSWER_ALLOWED_TYPES}
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="[&_*]:text-gray-300 [&_.border-dashed]:border-gray-600"
                  />
                  {answerFiles.length > 0 && (
                    <p className="text-xs text-green-400">
                      {answerFiles.length} file(s) uploaded
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Submit Button */}
            <Button
              onClick={() => handleSubmit(false)}
              disabled={submitting || answerFiles.length === 0}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Submit Exam
                </>
              )}
            </Button>
          </div>

          {/* Exam Papers Viewer */}
          <div className="lg:col-span-3 order-2 lg:order-1">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-white">Exam Paper</CardTitle>
                  {exam.examPapers && exam.examPapers.length > 1 && (
                    <div className="flex gap-2">
                      {exam.examPapers.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedPaper(idx)}
                          className={`px-3 py-1 text-sm rounded ${
                            selectedPaper === idx
                              ? "bg-green-600 text-white"
                              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                          }`}
                        >
                          Page {idx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {exam.examPapers && exam.examPapers[selectedPaper] && (
                  <div className="w-full min-h-[70vh]">
                    {exam.examPapers[selectedPaper].type === "application/pdf" ? (
                      <iframe
                        src={exam.examPapers[selectedPaper].url}
                        className="w-full h-[70vh] rounded-b-lg"
                        title="Exam Paper"
                      />
                    ) : exam.examPapers[selectedPaper].type.startsWith("image/") ? (
                      <img
                        src={exam.examPapers[selectedPaper].url}
                        alt="Exam Paper"
                        className="w-full max-h-[70vh] object-contain"
                      />
                    ) : (
                      <div className="p-8 text-center text-gray-400">
                        <p>Cannot preview this file type</p>
                        <a
                          href={exam.examPapers[selectedPaper].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:underline mt-2 block"
                        >
                          Download {exam.examPapers[selectedPaper].name}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Online Mode Exam View (existing code)
  const question = exam.questions![currentQuestion];
  const progress = ((currentQuestion + 1) / exam.questions!.length) * 100;
  const answeredCount = Object.keys(answers).length;

  return (
    <div 
      className="min-h-screen bg-gray-900 text-white select-none"
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-3 sm:px-4 py-2 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <h1 className="font-semibold text-sm sm:text-base truncate flex-1">{exam.title}</h1>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {/* Fullscreen re-enter button */}
            {fullscreenExited && (
              <Button
                onClick={enterFullscreen}
                variant="destructive"
                size="sm"
                className="animate-pulse text-xs sm:text-sm"
              >
                <Monitor className="h-3 w-3 sm:mr-1" />
                <span className="hidden sm:inline">Re-enter Fullscreen</span>
              </Button>
            )}
            {/* Mobile: Compact badges */}
            <div className="flex sm:hidden items-center gap-1">
              <Badge 
                variant="outline" 
                className={`text-xs px-1.5 py-0.5 ${
                  behaviorScore >= 75 ? "bg-green-900/50 text-green-300 border-green-700" :
                  behaviorScore >= 50 ? "bg-yellow-900/50 text-yellow-300 border-yellow-700" :
                  "bg-red-900/50 text-red-300 border-red-700"
                }`}
              >
                {behaviorScore}
              </Badge>
              <Badge 
                variant={warnings > 2 ? "destructive" : "secondary"} 
                className="text-xs px-1.5 py-0.5"
              >
                {warnings}/{maxWarnings}
              </Badge>
            </div>
            {/* Desktop: Full badges */}
            <Badge 
              variant="outline" 
              className={`hidden sm:flex ${
                behaviorScore >= 75 ? "bg-green-900/50 text-green-300 border-green-700" :
                behaviorScore >= 50 ? "bg-yellow-900/50 text-yellow-300 border-yellow-700" :
                "bg-red-900/50 text-red-300 border-red-700"
              }`}
            >
              <TrendingDown className="h-3 w-3 mr-1" />
              Score: {behaviorScore}
            </Badge>
            <Badge variant={warnings > 2 ? "destructive" : "secondary"} className="hidden sm:flex">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {warnings}/{maxWarnings}
            </Badge>
            <Badge 
              variant={timeLeft < 300 ? "destructive" : "outline"} 
              className={`text-sm sm:text-lg ${timeLeft < 300 ? "animate-pulse" : ""}`}
            >
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              {formatTime(timeLeft)}
            </Badge>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-2 sm:p-4 grid lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Camera Preview */}
        <div className="lg:col-span-1 order-1 lg:order-2">
          <Card className="bg-gray-800 border-gray-700">
            <CardContent className="p-2">
              <video
                ref={attachStreamToVideo}
                autoPlay
                playsInline
                muted
                className="w-full aspect-video rounded-lg bg-black"
                style={{ transform: "scaleX(-1)" }}
              />
              <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                <span className={cameraEnabled ? "text-green-500" : "text-red-500"}>
                  {cameraEnabled ? "Camera Active" : "Camera Off"}
                </span>
                <span className={modelLoaded ? "text-green-500" : "text-yellow-500"}>
                  {modelLoaded ? "AI Ready" : "Loading AI..."}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Question Navigator */}
          <Card className="bg-gray-800 border-gray-700 mt-4 hidden lg:block">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Questions</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-5 gap-2">
                {exam.questions!.map((q, idx) => (
                  <button
                    key={q.id}
                    onClick={() => setCurrentQuestion(idx)}
                    className={`
                      w-8 h-8 rounded text-sm font-medium transition-colors
                      ${idx === currentQuestion 
                        ? "bg-green-600 text-white" 
                        : answers[q.id] 
                          ? "bg-green-900 text-green-300" 
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"}
                    `}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                {answeredCount}/{exam.questions!.length} answered
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Question */}
        <div className="lg:col-span-3 order-2 lg:order-1">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">
                  Question {currentQuestion + 1} of {exam.questions!.length}
                </span>
                <Badge variant="outline">{question.marks} marks</Badge>
              </div>
              <Progress value={progress} className="h-1 mt-2" />
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-lg">{question.text}</p>

              {question.type === "multiple-choice" || question.type === "true-false" ? (
                <div className="space-y-3">
                  {question.options?.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => setAnswer(question.id, option)}
                      className={`
                        w-full p-4 rounded-lg text-left transition-colors
                        ${answers[question.id] === option 
                          ? "bg-green-600 border-green-500" 
                          : "bg-gray-700 hover:bg-gray-600 border-gray-600"}
                        border
                      `}
                    >
                      <span className="font-medium mr-3">
                        {String.fromCharCode(65 + idx)}.
                      </span>
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  value={answers[question.id] || ""}
                  onChange={(e) => setAnswer(question.id, e.target.value)}
                  placeholder="Type your answer here..."
                  className="w-full h-32 p-4 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
                  disabled={currentQuestion === 0}
                  className="border-gray-600 hover:bg-gray-700"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>

                <div className="flex gap-2">
                  {currentQuestion < exam.questions!.length - 1 ? (
                    <Button
                      onClick={() => setCurrentQuestion(currentQuestion + 1)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleSubmit(false)}
                      disabled={submitting}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Submit Exam
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
