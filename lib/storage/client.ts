"use client";

/**
 * Browser file-upload client, backed by Backblaze B2.
 *
 * Deliberately API-compatible with the Firebase Storage helper it replaces —
 * `uploadFile(file, path, onProgress)` still resolves to `{ url, path, name,
 * type, size }` — so every call site and the Firestore documents they write
 * keep their existing shape. What changed is underneath: the bucket is private
 * and this module never holds a credential. It asks the server for permission,
 * receives a presigned URL scoped to one key, and uploads to that.
 *
 * Three upload paths, tried in order, because "the upload silently did nothing"
 * is the failure that costs a student their work:
 *
 *   1. Presigned PUT straight to B2. No size limit, no server in the data path.
 *      Requires a CORS rule on the bucket for this origin
 *      (`npm run storage:cors` applies it).
 *   2. Same-origin proxy through `/api/storage/upload` for files up to 4 MB.
 *      No preflight and no bucket configuration involved, so it still works on
 *      a deployment whose CORS was never applied, or behind a network that
 *      blocks the B2 host.
 *   3. An inline base64 data URL for very small files, stored directly in the
 *      Firestore document. Last resort, and capped well under Firestore's 1 MiB
 *      document limit — it is what keeps a submission from being lost when
 *      object storage is unreachable entirely.
 */

import { authedFetch } from "@/lib/utils/api-client";
import {
  MAX_PROXY_UPLOAD_BYTES,
  formatFileSize as formatBytes,
  type UploadProgress,
  type UploadResult,
} from "./constants";

export type { UploadProgress, UploadResult };
export {
  EXAM_PAPER_ALLOWED_TYPES,
  ANSWER_ALLOWED_TYPES,
  MAX_FILE_SIZE,
  CLASSROOM_MATERIAL_ALLOWED_TYPES,
  CLASSROOM_MAX_FILE_SIZE,
  MAX_UPLOAD_BYTES,
  MAX_PROXY_UPLOAD_BYTES,
  ALL_ALLOWED_UPLOAD_TYPES,
  validateFile,
  formatFileSize,
} from "./constants";

const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Ceiling for the inline (data-URL) fallback.
 *
 * The fallback stores a base64 payload inside a Firestore document. Firestore
 * rejects documents over 1 MiB and base64 inflates a file by ~33%, so anything
 * above this would fail with "invalid-argument" at submit time and lose the
 * student's work. Failing here instead gives a message they can act on.
 */
const MAX_INLINE_FALLBACK_BYTES = 600 * 1024;

interface UploadTicket {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
  url: string;
}

const fileToDataUrl = async (file: Blob): Promise<string> => {
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

  try {
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

    if (!blob) return file;

    return new File([blob], file.name, {
      type: file.type === "image/png" ? "image/png" : "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    // A corrupt or unsupported image must not block the upload — send the
    // original bytes instead.
    return file;
  }
};

/**
 * PUTs the file to the presigned URL with real progress reporting.
 *
 * `XMLHttpRequest` rather than `fetch` purely for `upload.onprogress`: fetch
 * still has no upload-progress event in any shipping browser, and a progress
 * bar that jumps 0→100 is what makes a large classroom video look frozen.
 */
const putToPresignedUrl = (
  ticket: UploadTicket,
  body: Blob,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.uploadUrl, true);

    Object.entries(ticket.headers || {}).forEach(([name, value]) => {
      request.setRequestHeader(name, value);
    });

    request.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress({
        progress: (event.loaded / event.total) * 100,
        bytesTransferred: event.loaded,
        totalBytes: event.total,
      });
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage rejected the upload (HTTP ${request.status}).`));
      }
    };
    // Both of these are what a missing CORS rule looks like from JS: no status,
    // no body, just "network error".
    request.onerror = () => reject(new Error("Network error while uploading to storage."));
    request.onabort = () => reject(new Error("Upload was aborted."));

    request.send(body);
  });
};

/** Uploads through the app's own origin — no CORS, no bucket config needed. */
const uploadViaProxy = async (
  body: Blob,
  fileName: string,
  path: string,
  contentType: string
): Promise<{ key: string; url: string }> => {
  const form = new FormData();
  form.append("file", new File([body], fileName, { type: contentType }));
  form.append("path", path);
  form.append("contentType", contentType);

  return authedFetch<{ key: string; url: string }>("/api/storage/upload", {
    method: "POST",
    body: form,
    fallbackError: "Upload failed.",
  });
};

/**
 * Upload a blob to object storage.
 *
 * @param body Bytes to store.
 * @param path Object key, e.g. "exams/exam123/paper.pdf".
 * @param meta Display name and content type recorded on the result.
 * @param onProgress Optional progress callback.
 */
export const uploadBlob = async (
  body: Blob,
  path: string,
  meta: { name: string; type: string },
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
  const contentType = meta.type || body.type || "application/octet-stream";
  const size = body.size;

  const inlineFallback = async (reason: unknown): Promise<UploadResult> => {
    console.warn("[storage] Falling back to inline storage:", reason);

    if (size > MAX_INLINE_FALLBACK_BYTES) {
      // Name the likely cause: for a file this size the direct upload is the
      // only path that could have worked, and a bucket without a CORS rule for
      // this origin is by far the most common reason it did not.
      throw new Error(
        `Could not upload "${meta.name}" (${formatBytes(size)}). ` +
          `The file is too large for the fallback upload path, so it needs a direct upload to object storage — ` +
          `ask an administrator to check Admin → System Health (a missing bucket CORS rule is the usual cause).`
      );
    }

    return {
      url: await fileToDataUrl(body),
      path: `inline:${path}`,
      name: meta.name,
      type: contentType,
      size,
    };
  };

  let ticket: UploadTicket | null = null;
  try {
    ticket = await authedFetch<UploadTicket>("/api/storage/upload-url", {
      method: "POST",
      body: { path, contentType, size },
      fallbackError: "Could not prepare the upload.",
    });
  } catch (error: any) {
    // A refusal here is a decision, not a transport failure — a file type the
    // server rejects or a path this account may not write to will fail exactly
    // the same way on every retry, so surface it instead of silently storing
    // the file inline where nobody expects to find it.
    throw new Error(error?.message || "Could not prepare the upload.");
  }

  try {
    await putToPresignedUrl(ticket, body, onProgress);
    return { url: ticket.url, path: ticket.key, name: meta.name, type: contentType, size };
  } catch (directError) {
    console.warn("[storage] Direct upload failed, trying the server proxy:", directError);

    if (size <= MAX_PROXY_UPLOAD_BYTES) {
      try {
        const proxied = await uploadViaProxy(body, meta.name, path, contentType);
        onProgress?.({ progress: 100, bytesTransferred: size, totalBytes: size });
        return { url: proxied.url, path: proxied.key, name: meta.name, type: contentType, size };
      } catch (proxyError) {
        return inlineFallback(proxyError);
      }
    }

    return inlineFallback(directError);
  }
};

/**
 * Upload a file to object storage.
 * @param file The file to upload
 * @param path The storage path (e.g., "exams/exam123/paper.pdf")
 * @param onProgress Optional callback for upload progress
 * @returns Promise with the stored URL and file info
 */
export const uploadFile = async (
  file: File,
  path: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
  const candidate = await compressImageFile(file);
  return uploadBlob(candidate, path, { name: file.name, type: candidate.type }, onProgress);
};

/**
 * Upload a `data:` URL (canvas capture, proctoring frame) to object storage.
 * Returns `null` rather than throwing: every caller treats a failed capture as
 * "no screenshot this time", never as a reason to interrupt an exam.
 */
export const uploadDataUrl = async (
  dataUrl: string,
  path: string,
  fileName?: string
): Promise<UploadResult | null> => {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return await uploadBlob(blob, path, {
      name: fileName || path.split("/").pop() || "capture.jpg",
      type: blob.type || "image/jpeg",
    });
  } catch (error) {
    console.warn("[storage] Data URL upload failed:", error);
    return null;
  }
};

/**
 * Upload multiple files to object storage
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
 * Delete a file from object storage.
 *
 * Deletion happens server-side (`/api/storage/object`), where the caller's
 * role is checked against the key's prefix — the browser holds no bucket
 * credential of its own. `inline:` paths never reached the bucket, so there is
 * nothing to delete for them.
 *
 * @param path The object key of the file to delete
 */
export const deleteFile = async (path: string): Promise<void> => {
  if (!path || path.startsWith("inline:")) return;

  await authedFetch(`/api/storage/object?key=${encodeURIComponent(path)}`, {
    method: "DELETE",
    fallbackError: "Failed to delete the file.",
  });
};
