import { createWorker, Worker } from "tesseract.js";
import { extractTextFromImage as extractWithGeminiImage, extractTextFromPDF as extractWithGeminiPDF } from "./gemini";

let workerPromise: Promise<Worker> | null = null;

export async function getTesseractWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker("eng");
      return w;
    })();
  }
  return workerPromise;
}

/**
 * Extract text from image file/blob using Tesseract.js engine
 */
export async function extractTextWithTesseract(imageFile: File | Blob | string): Promise<string> {
  try {
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(imageFile);
    return data.text || "";
  } catch (error) {
    console.error("Tesseract OCR extraction error:", error);
    return "";
  }
}

/**
 * Hybrid OCR Extractor:
 * Attempts Gemini 2.5 Flash API first for state-of-the-art accuracy;
 * Falls back to Tesseract.js client-side OCR if Gemini fails or is unconfigured.
 */
export async function hybridExtractText(
  fileOrUrl: File | string
): Promise<{ text: string; engine: "gemini" | "tesseract"; confidence?: number; error?: string }> {
  // 1. Try Gemini 2.5 Flash
  try {
    const isPDF =
      (typeof fileOrUrl === "string" && fileOrUrl.toLowerCase().includes(".pdf")) ||
      (fileOrUrl instanceof File && fileOrUrl.type.includes("pdf"));

    const geminiResult = isPDF
      ? await extractWithGeminiPDF(fileOrUrl)
      : await extractWithGeminiImage(fileOrUrl);

    if (geminiResult.success && geminiResult.text.trim().length > 0) {
      return {
        text: geminiResult.text,
        engine: "gemini",
      };
    }
  } catch (geminiErr) {
    console.warn("Gemini Vision OCR failed, dropping down to Tesseract.js fallback:", geminiErr);
  }

  // 2. Fallback to Tesseract.js
  try {
    const fallbackText = await extractTextWithTesseract(fileOrUrl);
    if (fallbackText.trim().length > 0) {
      return {
        text: fallbackText,
        engine: "tesseract",
      };
    }
  } catch (tesseractErr: any) {
    console.error("Tesseract.js fallback also failed:", tesseractErr);
  }

  return {
    text: "",
    engine: "tesseract",
    error: "Failed to extract text using both Gemini AI and Tesseract.js engines.",
  };
}

export async function terminateOCR(): Promise<void> {
  if (workerPromise) {
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch {
      // Ignore termination errors
    } finally {
      workerPromise = null;
    }
  }
}
