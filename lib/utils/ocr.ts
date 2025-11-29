import { createWorker, Worker } from "tesseract.js";

let worker: Worker | null = null;

export async function initOCR(): Promise<void> {
  if (!worker) {
    worker = await createWorker("eng");
  }
}

export async function extractTextFromImage(imageFile: File | Blob): Promise<string> {
  try {
    if (!worker) {
      await initOCR();
    }

    if (!worker) {
      throw new Error("OCR worker not initialized");
    }

    const { data } = await worker.recognize(imageFile);
    return data.text;
  } catch (error) {
    console.error("OCR extraction error:", error);
    return "";
  }
}

export async function extractTextFromImageURL(imageURL: string): Promise<string> {
  try {
    if (!worker) {
      await initOCR();
    }

    if (!worker) {
      throw new Error("OCR worker not initialized");
    }

    const { data } = await worker.recognize(imageURL);
    return data.text;
  } catch (error) {
    console.error("OCR extraction error:", error);
    return "";
  }
}

export async function terminateOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

export async function extractTextFromMultipleImages(images: File[]): Promise<string[]> {
  const results: string[] = [];

  for (const image of images) {
    const text = await extractTextFromImage(image);
    results.push(text);
  }

  return results;
}
