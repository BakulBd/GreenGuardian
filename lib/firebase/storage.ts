import { ref, uploadBytesResumable, getDownloadURL, deleteObject, UploadTaskSnapshot } from "firebase/storage";
import { storage } from "./config";

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

/**
 * Upload a file to Firebase Storage
 * @param file The file to upload
 * @param path The storage path (e.g., "exams/exam123/paper.pdf")
 * @param onProgress Optional callback for upload progress
 * @returns Promise with the download URL and file info
 */
export const uploadFile = (
  file: File,
  path: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot: UploadTaskSnapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (onProgress) {
          onProgress({
            progress,
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
          });
        }
      },
      (error) => {
        console.error("Upload error:", error);
        reject(error);
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({
            url: downloadURL,
            path,
            name: file.name,
            type: file.type,
            size: file.size,
          });
        } catch (error) {
          reject(error);
        }
      }
    );
  });
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
