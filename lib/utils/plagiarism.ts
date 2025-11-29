import stringSimilarity from "string-similarity";

export interface SimilarityResult {
  score: number;
  matches: string[];
}

/**
 * Calculate cosine similarity between two texts
 */
export function calculateCosineSimilarity(text1: string, text2: string): number {
  const rating = stringSimilarity.compareTwoStrings(text1.toLowerCase(), text2.toLowerCase());
  return rating;
}

/**
 * Calculate n-gram similarity between two texts
 */
export function calculateNGramSimilarity(text1: string, text2: string, n: number = 3): number {
  const ngrams1 = getNGrams(text1.toLowerCase(), n);
  const ngrams2 = getNGrams(text2.toLowerCase(), n);

  const intersection = ngrams1.filter((gram) => ngrams2.includes(gram));
  const union = [...new Set([...ngrams1, ...ngrams2])];

  return intersection.length / union.length;
}

/**
 * Get n-grams from text
 */
function getNGrams(text: string, n: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const ngrams: string[] = [];

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(" "));
  }

  return ngrams;
}

/**
 * Find common phrases between two texts
 */
export function findCommonPhrases(text1: string, text2: string, minLength: number = 5): string[] {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  const commonPhrases: string[] = [];

  for (let i = 0; i < words1.length; i++) {
    for (let len = minLength; len <= words1.length - i; len++) {
      const phrase = words1.slice(i, i + len).join(" ");
      const phrase2Text = words2.join(" ");

      if (phrase2Text.includes(phrase)) {
        commonPhrases.push(phrase);
      }
    }
  }

  // Return unique phrases sorted by length (descending)
  return [...new Set(commonPhrases)].sort((a, b) => b.length - a.length);
}

/**
 * Check plagiarism between two texts
 */
export function checkPlagiarism(
  text1: string,
  text2: string,
  threshold: number = 0.7
): SimilarityResult {
  const cosineSim = calculateCosineSimilarity(text1, text2);
  const ngramSim = calculateNGramSimilarity(text1, text2);
  const avgScore = (cosineSim + ngramSim) / 2;

  const matches = avgScore > threshold ? findCommonPhrases(text1, text2) : [];

  return {
    score: avgScore,
    matches: matches.slice(0, 5), // Return top 5 matches
  };
}

/**
 * Extract text from HTML content
 */
export function extractTextFromHTML(html: string): string {
  // Remove HTML tags
  const text = html.replace(/<[^>]*>/g, " ");
  // Replace multiple spaces with single space
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Clean and normalize text for comparison
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}
