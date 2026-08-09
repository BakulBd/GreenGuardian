/**
 * Pure text-similarity scoring — no Firebase, no DOM, runs anywhere.
 *
 * Split out of `lib/utils/similarity.ts` so the plagiarism check can run
 * server-side. The old module imported the browser Firebase SDK at the top
 * level, which meant the comparison could only ever run in the student's or
 * teacher's browser — and a student's browser is not allowed to read other
 * students' answers, so cross-student comparison silently found nothing.
 * See `app/api/plagiarism/check/route.ts`.
 *
 * Thresholds (unchanged):
 *   ≥70% → plagiarized · 30–69% → partially similar · <30% → unique
 */

export type SimilarityLevel = "unique" | "partial" | "plagiarized";

export interface SimilarityMatch {
  sourceType: "student" | "ai" | "web";
  sourceId?: string;
  sourceName?: string;
  matchPercentage: number;
  matchedText?: string;
}

export const SIMILARITY_THRESHOLDS = {
  PLAGIARIZED: 70,
  PARTIAL: 30,
  UNIQUE: 30,
};

/** Minimum score before a cross-student match is worth reporting at all. */
export const MATCH_REPORTING_FLOOR = 20;

export function getSimilarityLevel(score: number): SimilarityLevel {
  if (score >= SIMILARITY_THRESHOLDS.PLAGIARIZED) return "plagiarized";
  if (score >= SIMILARITY_THRESHOLDS.PARTIAL) return "partial";
  return "unique";
}

function preprocessText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-level n-grams; the shared-phrase signal behind the Jaccard score. */
function getNgrams(text: string, n: number = 3): Set<string> {
  const words = text.split(" ");
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function calculateJaccardSimilarity(text1: string, text2: string): number {
  const ngrams1 = getNgrams(preprocessText(text1));
  const ngrams2 = getNgrams(preprocessText(text2));
  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

  let intersection = 0;
  ngrams1.forEach((ngram) => {
    if (ngrams2.has(ngram)) intersection++;
  });

  const union = ngrams1.size + ngrams2.size - intersection;
  return (intersection / union) * 100;
}

function calculateCosineSimilarity(text1: string, text2: string): number {
  const clean1 = preprocessText(text1);
  const clean2 = preprocessText(text2);

  // Two texts with no words are not "similar" — they are empty. Without this
  // guard `"".split(" ")` yields `[""]`, so both sides got a single shared
  // empty-string token and scored a perfect cosine match: two blank answers
  // (or two made only of punctuation) came out 60% similar and were reported
  // as partially plagiarised.
  if (!clean1 || !clean2) return 0;

  const words1 = clean1.split(" ");
  const words2 = clean2.split(" ");

  const freq1 = new Map<string, number>();
  const freq2 = new Map<string, number>();
  words1.forEach((word) => freq1.set(word, (freq1.get(word) || 0) + 1));
  words2.forEach((word) => freq2.set(word, (freq2.get(word) || 0) + 1));

  const allWords = new Set([...Array.from(freq1.keys()), ...Array.from(freq2.keys())]);

  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  allWords.forEach((word) => {
    const f1 = freq1.get(word) || 0;
    const f2 = freq2.get(word) || 0;
    dotProduct += f1 * f2;
    mag1 += f1 * f1;
    mag2 += f2 * f2;
  });

  if (mag1 === 0 || mag2 === 0) return 0;
  return (dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2))) * 100;
}

/**
 * Combined score. Cosine carries more weight because it tolerates reordering,
 * which is the most common way a copied answer is lightly disguised; Jaccard
 * contributes the verbatim-phrase evidence.
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  const jaccard = calculateJaccardSimilarity(text1, text2);
  const cosine = calculateCosineSimilarity(text1, text2);
  return Math.round(jaccard * 0.4 + cosine * 0.6);
}

/**
 * Heuristic AI-authorship signal from stock phrasing and unusually uniform
 * sentence lengths. Advisory only — it is reported next to the Gemini-based
 * detector, not used on its own to accuse anyone.
 */
export function checkAIGeneratedPatterns(text: string): { score: number; indicators: string[] } {
  const indicators: string[] = [];
  let score = 0;

  const processedText = text.toLowerCase();

  const aiPatterns = [
    { pattern: /in conclusion/gi, weight: 5, name: "Formulaic conclusion" },
    { pattern: /it is worth noting/gi, weight: 8, name: "AI phrase detected" },
    { pattern: /it's important to note/gi, weight: 8, name: "AI phrase detected" },
    { pattern: /additionally,/gi, weight: 3, name: "Transition word pattern" },
    { pattern: /furthermore,/gi, weight: 3, name: "Transition word pattern" },
    { pattern: /moreover,/gi, weight: 3, name: "Transition word pattern" },
    { pattern: /delve into/gi, weight: 10, name: "Common AI phrase" },
    { pattern: /it's crucial to/gi, weight: 7, name: "AI phrase detected" },
    { pattern: /let me explain/gi, weight: 6, name: "AI phrase detected" },
    { pattern: /as an ai/gi, weight: 50, name: "Direct AI reference" },
    { pattern: /language model/gi, weight: 40, name: "AI terminology" },
  ];

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  if (sentences.length > 3) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance =
      lengths.reduce((a, b) => a + Math.pow(b - avgLength, 2), 0) / lengths.length;

    if (variance < 10 && avgLength > 10) {
      score += 15;
      indicators.push("Uniform sentence structure");
    }
  }

  aiPatterns.forEach(({ pattern, weight, name }) => {
    const matches = processedText.match(pattern);
    if (matches) {
      score += weight * Math.min(matches.length, 3);
      if (!indicators.includes(name)) indicators.push(name);
    }
  });

  return { score: Math.min(score, 100), indicators };
}

/**
 * Best text available on a stored answer document, in preference order:
 * OCR output first (upload-mode exams), then the typed answers.
 */
export function extractComparableText(data: Record<string, any>): string {
  if (data?.ocrAnalysis?.extractedText) return String(data.ocrAnalysis.extractedText);
  if (data?.ocrText) return String(data.ocrText);
  if (data?.extractedText) return String(data.extractedText);
  if (data?.answers && typeof data.answers === "object") {
    return Object.values(data.answers as Record<string, unknown>)
      .map((v) => String(v ?? ""))
      .join(" ");
  }
  return "";
}
