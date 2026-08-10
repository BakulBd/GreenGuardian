"use client";

/**
 * Browser-side client for the AI/OCR endpoint.
 *
 * The Gemini SDK must never run in the browser: bundling the API key into the
 * client makes it extractable by anyone who opens devtools, and the bill lands
 * on the project owner. All AI work therefore goes through `/api/ocr`, which
 * holds the key server-side and requires a valid Firebase ID token.
 */

import { auth } from "@/lib/firebase/config";
// Type-only import: erased at compile time, so the Gemini SDK is never bundled
// into the client.
import type { ComprehensiveAnalysis } from "@/lib/utils/gemini";

export interface AIDetectionResult {
  success: boolean;
  isAIGenerated: boolean;
  confidence: number;
  indicators: string[];
  error?: string;
}

async function callAiApi<T>(payload: Record<string, unknown>): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("You must be signed in to use AI analysis.");
  }

  const token = await currentUser.getIdToken();
  const response = await fetch("/api/ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response (proxy error page, timeout, …)
  }

  if (!response.ok) {
    throw new Error(
      data?.error || `AI analysis failed (${response.status}). Please try again.`
    );
  }

  return data as T;
}

/** OCR + AI-detection pass over one or more uploaded answer files. */
export async function analyzeSubmittedAnswer(
  files: Array<string | { url?: string; downloadURL?: string; name?: string }>
): Promise<ComprehensiveAnalysis> {
  const fileUrls = files
    .map((file) => (typeof file === "string" ? file : file?.url || file?.downloadURL))
    .filter((url): url is string => !!url);

  const result = await callAiApi<{ success: boolean; analysis: ComprehensiveAnalysis }>({
    action: "analyze_submission",
    fileUrls,
  });
  return result.analysis;
}

/** Heuristic "was this written by an LLM" check for a block of text. */
export async function detectAIContent(text: string): Promise<AIDetectionResult> {
  return callAiApi<AIDetectionResult>({ action: "detect_ai", text });
}

/** Extract questions from an uploaded question paper. */
export async function extractQuestionsFromPaper(fileUrl: string): Promise<any> {
  return callAiApi<any>({ action: "extract_questions", fileUrl });
}

export interface AnswerQualitySuggestion {
  success: boolean;
  score?: number;
  feedback?: string;
  strengths?: string[];
  improvements?: string[];
  error?: string;
}

/**
 * Asks the model to read an answer against the question and suggest a mark.
 *
 * ADVISORY ONLY. The suggestion is shown to the teacher next to the mark box;
 * what is stored is whatever the teacher submits through
 * `/api/exams/evaluate`. Grading a student by model output alone is not
 * something this system does.
 */
export async function suggestAnswerGrade(
  question: string,
  answer: string
): Promise<AnswerQualitySuggestion> {
  return callAiApi<AnswerQualitySuggestion>({ action: "grade_answer", question, answer });
}
