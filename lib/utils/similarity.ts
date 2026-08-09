"use client";

/**
 * Browser-side plagiarism/similarity client and presentation helpers.
 *
 * The scoring itself moved to the server (`/api/plagiarism/check`). It cannot
 * work in the browser: comparing a submission against its classmates requires
 * reading every answer for the exam, and `firestore.rules` only lets a student
 * read their own. The old in-browser implementation swallowed that
 * `permission-denied` and reported zero matches, so every student submission
 * was recorded as "unique" without any comparison having happened.
 *
 * The pure scoring functions live in `lib/utils/text-similarity.ts` and are
 * shared with the route; this module is the thin client plus the badge
 * styling used by the teacher UI.
 */

import { authedFetch } from "@/lib/utils/api-client";
import {
  getSimilarityLevel,
  SIMILARITY_THRESHOLDS,
  type SimilarityLevel,
  type SimilarityMatch,
} from "@/lib/utils/text-similarity";

export type { SimilarityLevel, SimilarityMatch };
export { getSimilarityLevel, SIMILARITY_THRESHOLDS };

export interface SimilarityResult {
  score: number; // 0-100
  level: SimilarityLevel;
  matches: SimilarityMatch[];
  /** How many submissions for this exam the answer was compared against. */
  comparedAgainst?: number;
  analyzedAt: Date;
}

export function getSimilarityColor(level: SimilarityLevel) {
  switch (level) {
    case "unique":
      return { bg: "bg-green-100", text: "text-green-800", border: "border-green-200" };
    case "partial":
      return { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-200" };
    case "plagiarized":
      return { bg: "bg-red-100", text: "text-red-800", border: "border-red-200" };
  }
}

/**
 * Run the cross-student + AI-authorship check on a stored submission.
 *
 * The server re-reads the answer document, so only `answerId` is load-bearing;
 * `text` is a hint used when the document has no OCR text yet. The server
 * writes the report and updates the answer — the caller only needs the result
 * for display.
 */
export async function performSimilarityCheck(
  answerId: string,
  _examId: string,
  _studentId: string,
  text?: string
): Promise<SimilarityResult> {
  const response = await authedFetch<{
    success: boolean;
    report: {
      score: number;
      level: SimilarityLevel;
      matches: SimilarityMatch[];
      comparedAgainst: number;
    };
  }>("/api/plagiarism/check", {
    method: "POST",
    body: { answerId, text },
    fallbackError: "Similarity check failed. Please try again.",
  });

  return {
    score: response.report.score,
    level: response.report.level,
    matches: response.report.matches,
    comparedAgainst: response.report.comparedAgainst,
    analyzedAt: new Date(),
  };
}

/** Flatten a typed-answers map into one comparable string. */
export function extractAnswerText(answers: Record<string, string>): string {
  return Object.values(answers).join(" ");
}
