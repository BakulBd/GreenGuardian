// Object Detection utility for detecting mobile phones and other prohibited objects
// Uses TensorFlow.js COCO-SSD model for object detection

interface DetectedObject {
  class: string;
  score: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
}

interface ObjectDetectionResult {
  objects: DetectedObject[];
  hasMobilePhone: boolean;
  hasBook: boolean;
  hasLaptop: boolean;
  hasSecondPerson: boolean;
  prohibitedItems: string[];
  confidence: number;
}

// Prohibited object classes from COCO dataset
const PROHIBITED_OBJECTS = {
  mobilePhone: ['cell phone', 'remote'], // 'remote' often misclassified as phone
  book: ['book'],
  laptop: ['laptop'],
  person: ['person'],
};

// Minimum confidence threshold for detection
const MIN_CONFIDENCE = 0.5;
const PHONE_MIN_CONFIDENCE = 0.4; // Lower threshold for phones (harder to detect)

// Model instance (lazy loaded)
let objectModel: any = null;
let isObjectModelLoading = false;
let objectModelLoadError: string | null = null;

// Cooldown tracking for object detection warnings
const objectWarningCooldowns: Map<string, number> = new Map();
const OBJECT_DETECTION_COOLDOWN_MS = 15000; // 15 seconds between same object warnings

/**
 * Check if an object warning is in cooldown
 */
export function isObjectWarningInCooldown(objectType: string): boolean {
  const lastWarning = objectWarningCooldowns.get(objectType);
  if (!lastWarning) return false;
  return Date.now() - lastWarning < OBJECT_DETECTION_COOLDOWN_MS;
}

/**
 * Mark an object warning as triggered
 */
export function markObjectWarningTriggered(objectType: string): void {
  objectWarningCooldowns.set(objectType, Date.now());
}

/**
 * Clear all object warning cooldowns
 */
export function clearObjectWarningCooldowns(): void {
  objectWarningCooldowns.clear();
}

/**
 * Load the COCO-SSD model for object detection
 */
export async function loadObjectDetectionModel(): Promise<{ success: boolean; error?: string }> {
  if (objectModel) {
    return { success: true };
  }

  if (isObjectModelLoading) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return loadObjectDetectionModel();
  }

  if (objectModelLoadError) {
    return { success: false, error: objectModelLoadError };
  }

  isObjectModelLoading = true;

  try {
    const tf = await import("@tensorflow/tfjs");
    const cocoSsd = await import("@tensorflow-models/coco-ssd");

    await tf.ready();

    // Try WebGL first, fall back to CPU
    try {
      await tf.setBackend("webgl");
    } catch {
      console.warn("WebGL not available for object detection, falling back to CPU");
      await tf.setBackend("cpu");
    }

    // Load COCO-SSD model (lightweight version for real-time detection)
    objectModel = await cocoSsd.load({
      base: 'lite_mobilenet_v2', // Lighter model for better performance
    });

    isObjectModelLoading = false;
    return { success: true };
  } catch (error: any) {
    isObjectModelLoading = false;
    objectModelLoadError = error?.message || "Failed to load object detection model";
    console.error("Object detection model load error:", error);
    return { success: false, error: objectModelLoadError || undefined };
  }
}

/**
 * Detect objects in a video element
 */
export async function detectObjects(
  videoElement: HTMLVideoElement
): Promise<ObjectDetectionResult> {
  const defaultResult: ObjectDetectionResult = {
    objects: [],
    hasMobilePhone: false,
    hasBook: false,
    hasLaptop: false,
    hasSecondPerson: false,
    prohibitedItems: [],
    confidence: 0,
  };

  if (!videoElement || videoElement.readyState < 2) {
    return defaultResult;
  }

  if (!objectModel) {
    const loadResult = await loadObjectDetectionModel();
    if (!loadResult.success) {
      return defaultResult;
    }
  }

  try {
    const predictions = await objectModel.detect(videoElement);
    const objects: DetectedObject[] = predictions.map((p: any) => ({
      class: p.class,
      score: p.score,
      bbox: p.bbox,
    }));

    // Analyze detected objects
    let personCount = 0;
    let hasMobilePhone = false;
    let hasBook = false;
    let hasLaptop = false;
    const prohibitedItems: string[] = [];
    let maxConfidence = 0;

    for (const obj of objects) {
      maxConfidence = Math.max(maxConfidence, obj.score);

      // Check for mobile phone
      if (PROHIBITED_OBJECTS.mobilePhone.includes(obj.class) && obj.score >= PHONE_MIN_CONFIDENCE) {
        hasMobilePhone = true;
        if (!prohibitedItems.includes('Mobile Phone')) {
          prohibitedItems.push('Mobile Phone');
        }
      }

      // Check for book
      if (PROHIBITED_OBJECTS.book.includes(obj.class) && obj.score >= MIN_CONFIDENCE) {
        hasBook = true;
        if (!prohibitedItems.includes('Book')) {
          prohibitedItems.push('Book');
        }
      }

      // Check for laptop (additional device)
      if (PROHIBITED_OBJECTS.laptop.includes(obj.class) && obj.score >= MIN_CONFIDENCE) {
        hasLaptop = true;
        if (!prohibitedItems.includes('Additional Laptop')) {
          prohibitedItems.push('Additional Laptop');
        }
      }

      // Count persons
      if (obj.class === 'person' && obj.score >= MIN_CONFIDENCE) {
        personCount++;
      }
    }

    // More than 1 person detected
    const hasSecondPerson = personCount > 1;
    if (hasSecondPerson && !prohibitedItems.includes('Additional Person')) {
      prohibitedItems.push('Additional Person');
    }

    return {
      objects,
      hasMobilePhone,
      hasBook,
      hasLaptop,
      hasSecondPerson,
      prohibitedItems,
      confidence: maxConfidence,
    };
  } catch (error) {
    console.error("Object detection error:", error);
    return defaultResult;
  }
}

/**
 * Smart object detection with cooldowns
 * Returns warning message if prohibited item detected
 */
export async function checkForProhibitedObjects(
  videoElement: HTMLVideoElement
): Promise<{ shouldWarn: boolean; warningType: string; message: string } | null> {
  const result = await detectObjects(videoElement);

  // Check for mobile phone (highest priority)
  if (result.hasMobilePhone && !isObjectWarningInCooldown('mobile_phone')) {
    markObjectWarningTriggered('mobile_phone');
    return {
      shouldWarn: true,
      warningType: 'mobile_phone_detected',
      message: 'Mobile phone detected in camera view',
    };
  }

  // Check for additional person
  if (result.hasSecondPerson && !isObjectWarningInCooldown('second_person')) {
    markObjectWarningTriggered('second_person');
    return {
      shouldWarn: true,
      warningType: 'second_person_detected',
      message: 'Additional person detected in camera view',
    };
  }

  // Check for book (study materials)
  if (result.hasBook && !isObjectWarningInCooldown('book')) {
    markObjectWarningTriggered('book');
    return {
      shouldWarn: true,
      warningType: 'book_detected',
      message: 'Book or study material detected in camera view',
    };
  }

  // Check for additional laptop
  if (result.hasLaptop && !isObjectWarningInCooldown('laptop')) {
    markObjectWarningTriggered('laptop');
    return {
      shouldWarn: true,
      warningType: 'laptop_detected',
      message: 'Additional laptop/device detected in camera view',
    };
  }

  return null;
}

/**
 * Cleanup function
 */
export async function disposeObjectDetectionModel(): Promise<void> {
  if (objectModel) {
    objectModel = null;
  }
  objectModelLoadError = null;
  clearObjectWarningCooldowns();
}
