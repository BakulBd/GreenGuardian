// Face Detection utility using TensorFlow.js BlazeFace model
// Dynamic imports to handle SSR and avoid bundling issues

interface FacePrediction {
  topLeft: [number, number];
  bottomRight: [number, number];
  landmarks?: number[][];
  probability?: number[];
}

interface FaceDetectionResult {
  numFaces: number;
  predictions: FacePrediction[];
  isValid: boolean;
  message: string;
}

interface FacePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface EyeGazeResult {
  isLookingAway: boolean;
  direction: "center" | "left" | "right" | "up" | "down" | "unknown";
  confidence: number;
  details: {
    horizontalOffset: number; // -1 to 1, where 0 is center
    verticalOffset: number;   // -1 to 1, where 0 is center
    faceRotation: number;     // estimated face rotation
  };
}

// Detection configuration - Optimized for practical real-world usage
export const DETECTION_CONFIG = {
  // Timing configuration - Longer intervals reduce CPU usage and false positives
  DETECTION_INTERVAL_MS: 8000,          // 8 seconds between checks (very relaxed)
  DETECTION_COOLDOWN_MS: 30000,         // 30 seconds min between same warning type
  
  // Face position thresholds - More lenient to allow natural movement
  LOOKING_AWAY_THRESHOLD: 0.40,         // 40% from center (allow head movement)
  LOOKING_AWAY_MOBILE_THRESHOLD: 0.50,  // 50% for mobile (very lenient for small screens)
  
  // Face size thresholds (percentage of video frame) - Practical ranges
  MIN_FACE_SIZE: 1.5,                   // Face too small (allow more distance)
  MAX_FACE_SIZE: 80,                    // Face too close (more forgiving)
  IDEAL_MIN_FACE_SIZE: 4,               // Ideal minimum
  IDEAL_MAX_FACE_SIZE: 55,              // Ideal maximum
  
  // Detection confidence - Lower to reduce false "no face" warnings
  MIN_FACE_CONFIDENCE: 0.45,            // 45% confidence (more lenient)
  
  // Eye gaze (using landmarks) - More tolerant of natural eye movement
  EYE_CENTER_TOLERANCE: 0.30,           // 30% tolerance for eye offset
  
  // Consecutive detection required before warning (prevents single-frame false positives)
  CONSECUTIVE_DETECTIONS_REQUIRED: 3,   // Must detect issue 3 times in a row
  
  // Grace count for no face - allow brief absences before warning
  NO_FACE_GRACE_COUNT: 3,               // Allow 3 additional misses (total 4 cycles = 32 secs)
  
  // Mobile detection
  IS_MOBILE: typeof window !== 'undefined' && 
    (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator?.userAgent || '') ||
    (typeof window !== 'undefined' && window.innerWidth < 768)),
};

// Track consecutive detection issues for reducing false positives
let consecutiveNoFace = 0;
let consecutiveMultipleFaces = 0;
let consecutiveLookingAway = 0;

// Model instance (lazy loaded)
let model: any = null;
let isModelLoading = false;
let modelLoadError: string | null = null;

// Cooldown tracking for warnings (prevents spam)
const warningCooldowns: Map<string, number> = new Map();

/**
 * Check if a warning type is in cooldown
 */
export function isWarningInCooldown(warningType: string): boolean {
  const lastWarning = warningCooldowns.get(warningType);
  if (!lastWarning) return false;
  return Date.now() - lastWarning < DETECTION_CONFIG.DETECTION_COOLDOWN_MS;
}

/**
 * Mark a warning type as triggered (starts cooldown)
 */
export function markWarningTriggered(warningType: string): void {
  warningCooldowns.set(warningType, Date.now());
}

/**
 * Clear all warning cooldowns
 */
export function clearWarningCooldowns(): void {
  warningCooldowns.clear();
}

/**
 * Load the BlazeFace model for face detection
 * Uses dynamic imports to avoid SSR issues
 */
export async function loadFaceDetectionModel(): Promise<{ success: boolean; error?: string }> {
  // Return early if model is already loaded
  if (model) {
    return { success: true };
  }

  // Prevent multiple simultaneous loading attempts
  if (isModelLoading) {
    // Wait for current loading to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    return loadFaceDetectionModel();
  }

  // Return cached error if previous load failed
  if (modelLoadError) {
    return { success: false, error: modelLoadError };
  }

  isModelLoading = true;

  try {
    // Dynamic imports to avoid bundling issues
    const tf = await import("@tensorflow/tfjs");
    const blazeface = await import("@tensorflow-models/blazeface");

    // Set backend (prefer WebGL for performance)
    await tf.ready();
    
    // Try WebGL first, fall back to CPU
    try {
      await tf.setBackend("webgl");
    } catch {
      console.warn("WebGL not available, falling back to CPU");
      await tf.setBackend("cpu");
    }

    // Load the BlazeFace model
    model = await blazeface.load();
    
    isModelLoading = false;
    return { success: true };
  } catch (error: any) {
    isModelLoading = false;
    modelLoadError = error?.message || "Failed to load face detection model";
    console.error("Face detection model load error:", error);
    return { success: false, error: modelLoadError || undefined };
  }
}

/**
 * Detect faces in a video element
 */
export async function detectFaces(
  videoElement: HTMLVideoElement
): Promise<FaceDetectionResult> {
  // Validate video element
  if (!videoElement) {
    return {
      numFaces: 0,
      predictions: [],
      isValid: false,
      message: "No video element provided",
    };
  }

  // Check if video is ready
  if (videoElement.readyState < 2) {
    return {
      numFaces: 0,
      predictions: [],
      isValid: false,
      message: "Video not ready",
    };
  }

  // Ensure model is loaded
  if (!model) {
    const loadResult = await loadFaceDetectionModel();
    if (!loadResult.success) {
      return {
        numFaces: 0,
        predictions: [],
        isValid: false,
        message: loadResult.error || "Model not loaded",
      };
    }
  }

  try {
    // Estimate faces - returnTensors: false for performance
    const predictions = await model.estimateFaces(videoElement, false);

    return {
      numFaces: predictions.length,
      predictions: predictions as FacePrediction[],
      isValid: true,
      message: predictions.length === 0 
        ? "No face detected" 
        : predictions.length === 1 
          ? "Face detected" 
          : "Multiple faces detected",
    };
  } catch (error: any) {
    console.error("Face detection error:", error);
    return {
      numFaces: 0,
      predictions: [],
      isValid: false,
      message: error?.message || "Face detection failed",
    };
  }
}

/**
 * Check if the person is looking away from the screen
 * Uses face position and landmarks for better accuracy
 * Supports both desktop and mobile with different thresholds
 */
export function isLookingAway(
  prediction: FacePrediction | null,
  videoWidth: number = 640,
  videoHeight: number = 480,
  threshold?: number
): boolean {
  if (!prediction?.topLeft || !prediction?.bottomRight) {
    return true; // No face = looking away
  }

  // Check face probability/confidence if available
  if (prediction.probability && prediction.probability[0] < DETECTION_CONFIG.MIN_FACE_CONFIDENCE) {
    return true; // Low confidence = unreliable detection
  }

  // Use mobile-friendly threshold if on mobile device
  const effectiveThreshold = threshold ?? 
    (DETECTION_CONFIG.IS_MOBILE 
      ? DETECTION_CONFIG.LOOKING_AWAY_MOBILE_THRESHOLD 
      : DETECTION_CONFIG.LOOKING_AWAY_THRESHOLD);

  const position = calculateFacePosition(prediction);
  
  // Calculate video center
  const videoCenterX = videoWidth / 2;
  const videoCenterY = videoHeight / 2;

  // Calculate distance from center (normalized)
  const xDiff = Math.abs(position.centerX - videoCenterX) / videoWidth;
  const yDiff = Math.abs(position.centerY - videoCenterY) / videoHeight;

  // Check if face is beyond threshold from center
  const isPositionAway = xDiff > effectiveThreshold || yDiff > effectiveThreshold;

  // If landmarks available, use them for eye gaze estimation
  if (prediction.landmarks && prediction.landmarks.length >= 4) {
    const eyeGaze = estimateEyeGaze(prediction, videoWidth, videoHeight);
    // Combine position and eye gaze (both must indicate looking away)
    return isPositionAway || eyeGaze.isLookingAway;
  }

  return isPositionAway;
}

/**
 * Estimate eye gaze direction using facial landmarks
 * BlazeFace landmarks: [rightEye, leftEye, nose, mouth, rightEar, leftEar]
 */
export function estimateEyeGaze(
  prediction: FacePrediction,
  videoWidth: number = 640,
  videoHeight: number = 480
): EyeGazeResult {
  const defaultResult: EyeGazeResult = {
    isLookingAway: false,
    direction: "center",
    confidence: 0,
    details: { horizontalOffset: 0, verticalOffset: 0, faceRotation: 0 },
  };

  if (!prediction.landmarks || prediction.landmarks.length < 4) {
    return { ...defaultResult, direction: "unknown" };
  }

  try {
    const [rightEye, leftEye, nose] = prediction.landmarks;
    
    // Calculate face bounding box
    const faceWidth = prediction.bottomRight[0] - prediction.topLeft[0];
    const faceHeight = prediction.bottomRight[1] - prediction.topLeft[1];
    const faceCenterX = prediction.topLeft[0] + faceWidth / 2;
    
    // Calculate eye center
    const eyeCenterX = (rightEye[0] + leftEye[0]) / 2;
    const eyeCenterY = (rightEye[1] + leftEye[1]) / 2;
    
    // Calculate eye distance (for face rotation estimation)
    const eyeDistance = Math.sqrt(
      Math.pow(rightEye[0] - leftEye[0], 2) + 
      Math.pow(rightEye[1] - leftEye[1], 2)
    );
    
    // Estimate face rotation based on eye positions
    const eyeAngle = Math.atan2(rightEye[1] - leftEye[1], rightEye[0] - leftEye[0]);
    const faceRotation = eyeAngle * (180 / Math.PI); // Convert to degrees
    
    // Nose position relative to face center indicates looking direction
    const noseOffsetX = (nose[0] - faceCenterX) / faceWidth;
    
    // Eye center relative to face center
    const eyeOffsetX = (eyeCenterX - faceCenterX) / faceWidth;
    
    // Vertical offset (looking up/down)
    const expectedNoseY = prediction.topLeft[1] + faceHeight * 0.6;
    const noseOffsetY = (nose[1] - expectedNoseY) / faceHeight;
    
    // Determine gaze direction
    let direction: EyeGazeResult["direction"] = "center";
    const tolerance = DETECTION_CONFIG.EYE_CENTER_TOLERANCE;
    
    if (Math.abs(noseOffsetX) > tolerance * 2) {
      direction = noseOffsetX > 0 ? "right" : "left";
    } else if (Math.abs(noseOffsetY) > tolerance * 2) {
      direction = noseOffsetY > 0 ? "down" : "up";
    }
    
    // Face is looking away if:
    // 1. Nose is significantly off-center
    // 2. Face is rotated beyond threshold
    // 3. Eyes are not in expected position
    const horizontalOffset = noseOffsetX;
    const verticalOffset = noseOffsetY;
    
    const isLookingAway = 
      Math.abs(horizontalOffset) > tolerance * 2 ||
      Math.abs(verticalOffset) > tolerance * 2 ||
      Math.abs(faceRotation) > 25; // More than 25 degrees rotation
    
    // Calculate confidence based on prediction probability
    const confidence = prediction.probability?.[0] ?? 0.5;
    
    return {
      isLookingAway,
      direction,
      confidence,
      details: {
        horizontalOffset,
        verticalOffset,
        faceRotation,
      },
    };
  } catch (error) {
    console.error("Eye gaze estimation error:", error);
    return defaultResult;
  }
}

/**
 * Calculate face bounding box and center position
 */
export function calculateFacePosition(prediction: FacePrediction | null): FacePosition {
  if (!prediction?.topLeft || !prediction?.bottomRight) {
    return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  const [x1, y1] = prediction.topLeft;
  const [x2, y2] = prediction.bottomRight;

  const width = x2 - x1;
  const height = y2 - y1;

  return {
    x: x1,
    y: y1,
    width,
    height,
    centerX: x1 + width / 2,
    centerY: y1 + height / 2,
  };
}

/**
 * Calculate face size relative to video frame
 * Returns percentage of frame covered by face
 */
export function calculateFaceSize(
  prediction: FacePrediction | null,
  videoWidth: number = 640,
  videoHeight: number = 480
): number {
  if (!prediction?.topLeft || !prediction?.bottomRight) {
    return 0;
  }

  const position = calculateFacePosition(prediction);
  const faceArea = position.width * position.height;
  const videoArea = videoWidth * videoHeight;

  return (faceArea / videoArea) * 100;
}

/**
 * Validate if face detection setup is proper for exam
 * Returns detailed validation with issues and suggestions
 */
export function validateFaceForExam(
  prediction: FacePrediction | null,
  videoWidth: number = 640,
  videoHeight: number = 480
): { valid: boolean; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!prediction) {
    return { 
      valid: false, 
      issues: ["No face detected"],
      suggestions: ["Make sure your face is visible to the camera", "Check lighting conditions"]
    };
  }

  // Check confidence level
  if (prediction.probability && prediction.probability[0] < DETECTION_CONFIG.MIN_FACE_CONFIDENCE) {
    issues.push("Face detection is uncertain");
    suggestions.push("Improve lighting", "Face the camera directly");
  }

  // Check if looking at screen
  const eyeGaze = estimateEyeGaze(prediction, videoWidth, videoHeight);
  if (eyeGaze.isLookingAway) {
    issues.push("Please look at the screen");
    if (eyeGaze.direction === "left" || eyeGaze.direction === "right") {
      suggestions.push(`You appear to be looking ${eyeGaze.direction}`);
    } else if (eyeGaze.direction === "up" || eyeGaze.direction === "down") {
      suggestions.push(`Adjust your camera angle - you appear to be looking ${eyeGaze.direction}`);
    }
    if (Math.abs(eyeGaze.details.faceRotation) > 15) {
      suggestions.push("Turn your head to face the camera directly");
    }
  }

  // Check face size
  const faceSize = calculateFaceSize(prediction, videoWidth, videoHeight);
  if (faceSize < DETECTION_CONFIG.MIN_FACE_SIZE) {
    issues.push("Face is too small in frame");
    suggestions.push("Move closer to the camera");
  } else if (faceSize > DETECTION_CONFIG.MAX_FACE_SIZE) {
    issues.push("Face is too close to camera");
    suggestions.push("Move back from the camera");
  } else if (faceSize < DETECTION_CONFIG.IDEAL_MIN_FACE_SIZE) {
    suggestions.push("For best results, move slightly closer");
  } else if (faceSize > DETECTION_CONFIG.IDEAL_MAX_FACE_SIZE) {
    suggestions.push("For best results, move slightly back");
  }

  // Check face position in frame
  const position = calculateFacePosition(prediction);
  const videoCenterX = videoWidth / 2;
  const videoCenterY = videoHeight / 2;
  const xOffset = (position.centerX - videoCenterX) / videoWidth;
  const yOffset = (position.centerY - videoCenterY) / videoHeight;

  if (Math.abs(xOffset) > 0.3) {
    suggestions.push(xOffset > 0 ? "Move your camera or position to the left" : "Move your camera or position to the right");
  }
  if (Math.abs(yOffset) > 0.3) {
    suggestions.push(yOffset > 0 ? "Raise your camera or sit lower" : "Lower your camera or sit higher");
  }

  return {
    valid: issues.length === 0,
    issues,
    suggestions: suggestions.slice(0, 3), // Limit to top 3 suggestions
  };
}

/**
 * Smart detection that considers context and reduces false positives
 * Uses consecutive detection to avoid single-frame errors
 * Returns whether to trigger a warning
 */
export function shouldTriggerWarning(
  result: FaceDetectionResult,
  videoWidth: number,
  videoHeight: number,
  warningType: "no_face" | "multiple_faces" | "looking_away"
): boolean {
  // Check cooldown first
  if (isWarningInCooldown(warningType)) {
    return false;
  }

  const requiredConsecutive = DETECTION_CONFIG.CONSECUTIVE_DETECTIONS_REQUIRED;

  switch (warningType) {
    case "no_face":
      // Only warn if truly no faces detected for consecutive checks
      // Use grace count to allow brief moments of no face (adjusting position, etc.)
      if (result.numFaces === 0 && result.isValid) {
        consecutiveNoFace++;
        // Add grace period: require more consecutive misses before warning
        const graceAdjusted = requiredConsecutive + DETECTION_CONFIG.NO_FACE_GRACE_COUNT;
        if (consecutiveNoFace >= graceAdjusted) {
          consecutiveNoFace = 0; // Reset counter
          markWarningTriggered(warningType);
          return true;
        }
      } else {
        consecutiveNoFace = 0; // Reset if face found
      }
      break;

    case "multiple_faces":
      // Only warn if multiple faces with good confidence for consecutive checks
      if (result.numFaces > 1) {
        const confidentFaces = result.predictions.filter(
          p => !p.probability || p.probability[0] >= DETECTION_CONFIG.MIN_FACE_CONFIDENCE
        );
        if (confidentFaces.length > 1) {
          consecutiveMultipleFaces++;
          if (consecutiveMultipleFaces >= requiredConsecutive) {
            consecutiveMultipleFaces = 0;
            markWarningTriggered(warningType);
            return true;
          }
        } else {
          consecutiveMultipleFaces = 0;
        }
      } else {
        consecutiveMultipleFaces = 0;
      }
      break;

    case "looking_away":
      // Only warn if looking away with confidence for consecutive checks
      if (result.numFaces === 1 && result.predictions[0]) {
        const eyeGaze = estimateEyeGaze(result.predictions[0], videoWidth, videoHeight);
        // On mobile, require higher confidence and more rotation before warning
        const isMobile = DETECTION_CONFIG.IS_MOBILE;
        const rotationThreshold = isMobile ? 35 : 25; // degrees
        
        const isDefinitelyLookingAway = 
          eyeGaze.isLookingAway && 
          eyeGaze.confidence >= DETECTION_CONFIG.MIN_FACE_CONFIDENCE &&
          Math.abs(eyeGaze.details.faceRotation) > rotationThreshold;
          
        if (isDefinitelyLookingAway) {
          consecutiveLookingAway++;
          if (consecutiveLookingAway >= requiredConsecutive) {
            consecutiveLookingAway = 0;
            markWarningTriggered(warningType);
            return true;
          }
        } else {
          consecutiveLookingAway = 0;
        }
      } else {
        consecutiveLookingAway = 0;
      }
      break;
  }

  return false;
}

/**
 * Reset all consecutive detection counters
 */
export function resetConsecutiveCounters(): void {
  consecutiveNoFace = 0;
  consecutiveMultipleFaces = 0;
  consecutiveLookingAway = 0;
}

/**
 * Cleanup function to release model resources
 */
export async function disposeFaceDetectionModel(): Promise<void> {
  if (model) {
    try {
      // BlazeFace doesn't have a dispose method, but we can clear the reference
      model = null;
    } catch (error) {
      console.error("Error disposing face detection model:", error);
    }
  }
  modelLoadError = null;
  clearWarningCooldowns();
}
