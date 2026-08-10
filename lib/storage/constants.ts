/**
 * File-upload constants, types and validation shared by the browser upload
 * client and the server-side `/api/storage/*` routes.
 *
 * Isomorphic on purpose: the browser uses these to reject a bad file before
 * spending an upload, and the server re-checks the SAME values before it will
 * hand out a presigned URL. A client-side-only check is a hint, not a control.
 */

export interface UploadProgress {
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface UploadResult {
  /**
   * A stable, in-app URL that resolves to the object. It is NOT a direct
   * bucket link — the B2 bucket is private — but a signed capability URL
   * handled by `/api/storage/download`, which redirects to a short-lived
   * presigned URL. Safe to persist in Firestore and to use in `<img src>` /
   * `<a href>` exactly like the old Firebase download URL.
   */
  url: string;
  /** Object key inside the bucket (`inline:<path>` for the base64 fallback). */
  path: string;
  name: string;
  type: string;
  size: number;
}

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
 * Allowed file types for Classroom stream/classwork attachments. Broader than
 * exam uploads since teachers attach slides, zipped resources, and short video
 * clips.
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
 * Max file size for classroom materials (100MB).
 */
export const CLASSROOM_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Absolute server-side ceiling, independent of which UI asked for the upload.
 * Matches the largest per-feature limit above.
 */
export const MAX_UPLOAD_BYTES = CLASSROOM_MAX_FILE_SIZE;

/**
 * Ceiling for the server-proxied upload fallback (`/api/storage/upload`).
 *
 * That route buffers the whole body in the serverless function before writing
 * it to B2, and Vercel rejects a request body over ~4.5 MB outright, so a
 * larger file has to go direct-to-B2 with a presigned URL. Kept just under the
 * platform limit so the failure is a clear message from us rather than an
 * opaque 413 from the edge.
 */
export const MAX_PROXY_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Every content type the server will ever issue an upload URL for — the union
 * of the per-feature lists plus the JPEG the proctor captures. A type absent
 * from this list is refused before a presigned URL exists.
 */
export const ALL_ALLOWED_UPLOAD_TYPES = Array.from(
  new Set([
    ...EXAM_PAPER_ALLOWED_TYPES,
    ...ANSWER_ALLOWED_TYPES,
    ...CLASSROOM_MATERIAL_ALLOWED_TYPES,
    "text/plain",
    "text/csv",
  ])
);

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
