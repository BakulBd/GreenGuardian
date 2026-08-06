import { ref, uploadBytesResumable, getDownloadURL, deleteObject, UploadTaskSnapshot } from "firebase/storage";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth, storage } from "./config";

export interface UploadProgress {
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface UploadResult {
  url: string;
  path: string;
  name: string;
  type: string;
  size: number;
}

const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Ceiling for the inline (data-URL) fallback.
 *
 * When Cloud Storage is unavailable — it is not enabled on every Firebase
 * project, and CORS or a captive network can block it — uploads fall back to a
 * base64 data URL that ends up inside a Firestore document. Firestore rejects
 * documents over 1 MiB, and base64 inflates a file by ~33%, so anything above
 * this would produce an "invalid-argument" error at submit time and lose the
 * student's work. Failing here instead gives a message they can act on.
 */
const MAX_INLINE_FALLBACK_BYTES = 600 * 1024;

const fileToDataUrl = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert file to data URL"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to convert file to data URL"));
    reader.readAsDataURL(file);
  });
};

const compressImageFile = async (file: File): Promise<File> => {
  if (typeof window === "undefined" || !COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));

  if (scale >= 1) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  });

  if (!blob) {
    return file;
  }

  return new File([blob], file.name, {
    type: file.type === "image/png" ? "image/png" : "image/jpeg",
    lastModified: file.lastModified,
  });
};

const waitForAuthenticatedUser = async (): Promise<FirebaseUser> => {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error("Authentication is still loading. Please wait a moment and try again."));
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(user);
      }
    });
  });
};

/**
 * Upload a file to Firebase Storage
 * @param file The file to upload
 * @param path The storage path (e.g., "exams/exam123/paper.pdf")
 * @param onProgress Optional callback for upload progress
 * @returns Promise with the download URL and file info
 */
export const uploadFile = async (
  file: File,
  path: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
  await waitForAuthenticatedUser().catch(() => {});
  const uploadFileCandidate = await compressImageFile(file);

  const resolveInlineFallback = async (reason?: any) => {
    console.warn("Storage upload failed or CORS/Network blocked, activating resilient inline storage fallback:", reason);

    if (uploadFileCandidate.size > MAX_INLINE_FALLBACK_BYTES) {
      throw new Error(
        `Upload failed and "${file.name}" (${Math.round(
          uploadFileCandidate.size / 1024
        )} KB) is too large to store inline. Enable Firebase Storage for this project, or upload a file under ${Math.round(
          MAX_INLINE_FALLBACK_BYTES / 1024
        )} KB.`
      );
    }

    const dataUrl = await fileToDataUrl(uploadFileCandidate);
    return {
      url: dataUrl,
      path: `inline:${path}`,
      name: file.name,
      type: uploadFileCandidate.type,
      size: uploadFileCandidate.size,
    };
  };

  try {
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, uploadFileCandidate);

    return await new Promise<UploadResult>((resolve, reject) => {
      let isDone = false;
      let lastBytesTransferred = 0;

      const doFallback = async (reason?: any) => {
        if (isDone) return;
        isDone = true;
        try {
          uploadTask.cancel(); // Abort Firebase retries to stop console error spam
        } catch (e) {
          // Ignore
        }
        try {
          const fallbackResult = await resolveInlineFallback(reason);
          resolve(fallbackResult);
        } catch (e) {
          reject(e);
        }
      };

      // If absolutely no bytes are transferred in 6 seconds, assume CORS or Network failure
      const timeoutId = setTimeout(() => {
        if (lastBytesTransferred === 0) {
          console.warn("Upload stalled (likely CORS or network block). Forcing fallback...");
          doFallback(new Error("Upload timed out or blocked by CORS"));
        }
      }, 6000);

      uploadTask.on(
        "state_changed",
        (snapshot: UploadTaskSnapshot) => {
          if (isDone) return;
          lastBytesTransferred = snapshot.bytesTransferred;
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          if (onProgress) {
            onProgress({
              progress,
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes,
            });
          }
        },
        async (error) => {
          clearTimeout(timeoutId);
          doFallback(error);
        },
        async () => {
          clearTimeout(timeoutId);
          if (isDone) return;
          isDone = true;
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve({
              url: downloadURL,
              path,
              name: file.name,
              type: uploadFileCandidate.type,
              size: uploadFileCandidate.size,
            });
          } catch (error) {
            try {
              const fallbackResult = await resolveInlineFallback(error);
              resolve(fallbackResult);
            } catch (e) {
              reject(e);
            }
          }
        }
      );
    });
  } catch (err) {
    return await resolveInlineFallback(err);
  }
};

/**
 * Upload multiple files to Firebase Storage
 * @param files Array of files to upload
 * @param basePath Base path for storage (e.g., "exams/exam123")
 * @param onProgress Optional callback for overall progress
 * @returns Promise with array of upload results
 */
export const uploadMultipleFiles = async (
  files: File[],
  basePath: string,
  onProgress?: (fileIndex: number, progress: UploadProgress) => void
): Promise<UploadResult[]> => {
  const results: UploadResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = `${basePath}/${timestamp}_${sanitizedName}`;

    const result = await uploadFile(file, path, (progress) => {
      if (onProgress) {
        onProgress(i, progress);
      }
    });

    results.push(result);
  }

  return results;
};

/**
 * Delete a file from Firebase Storage
 * @param path The storage path of the file to delete
 */
export const deleteFile = async (path: string): Promise<void> => {
  const storageRef = ref(storage, path);
  await deleteObject(storageRef);
};

/**
 * Get allowed file types for exam papers
 */
export const EXAM_PAPER_ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Get allowed file types for student answers
 */
export const ANSWER_ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Max file size in bytes (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Allowed file types for Classroom stream/classwork attachments — mirrors
 * isClassroomFileType() in storage.rules. Broader than exam uploads since
 * teachers attach slides, zipped resources, and short video clips.
 */
export const CLASSROOM_MATERIAL_ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

/**
 * Max file size for classroom materials (100MB) — mirrors
 * isClassroomFileSize() in storage.rules.
 */
export const CLASSROOM_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Validate file before upload
 * @param file File to validate
 * @param allowedTypes Array of allowed MIME types
 * @param maxSize Maximum file size in bytes
 * @returns Object with isValid and error message
 */
export const validateFile = (
  file: File,
  allowedTypes: string[] = EXAM_PAPER_ALLOWED_TYPES,
  maxSize: number = MAX_FILE_SIZE
): { isValid: boolean; error?: string } => {
  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `File type "${file.type}" is not allowed. Allowed types: PDF, Word, JPEG, PNG`,
    };
  }

  if (file.size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
    return {
      isValid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum allowed size (${maxSizeMB}MB)`,
    };
  }

  return { isValid: true };
};

/**
 * Get human-readable file size
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};
