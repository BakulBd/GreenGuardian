/**
 * Similarity Checking Utility for GreenGuardian
 * 
 * This module provides functions to check similarity between:
 * 1. Student answers vs other students (plagiarism detection)
 * 2. Student answers vs AI-generated content
 * 3. Text extraction from PDFs for comparison
 * 
 * Similarity thresholds (as per requirements):
 * - ≥70% → Plagiarized
 * - 30-69% → Partially similar
 * - <30% → Unique
 */

import { db, storage } from "@/lib/firebase/config";
import { collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";

// Similarity result interface
export interface SimilarityResult {
  score: number; // 0-100
  level: "unique" | "partial" | "plagiarized";
  matches: SimilarityMatch[];
  analyzedAt: Date;
}

export interface SimilarityMatch {
  sourceType: "student" | "ai" | "web";
  sourceId?: string;
  sourceName?: string;
  matchPercentage: number;
  matchedText?: string;
}

// Thresholds
export const SIMILARITY_THRESHOLDS = {
  PLAGIARIZED: 70,
  PARTIAL: 30,
  UNIQUE: 30,
};

// Get similarity level based on score
export function getSimilarityLevel(score: number): "unique" | "partial" | "plagiarized" {
  if (score >= SIMILARITY_THRESHOLDS.PLAGIARIZED) return "plagiarized";
  if (score >= SIMILARITY_THRESHOLDS.PARTIAL) return "partial";
  return "unique";
}

// Get similarity badge color
export function getSimilarityColor(level: "unique" | "partial" | "plagiarized") {
  switch (level) {
    case "unique":
      return { bg: "bg-green-100", text: "text-green-800", border: "border-green-200" };
    case "partial":
      return { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-200" };
    case "plagiarized":
      return { bg: "bg-red-100", text: "text-red-800", border: "border-red-200" };
  }
}

// Text preprocessing for comparison
function preprocessText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

// Simple n-gram tokenizer
function getNgrams(text: string, n: number = 3): Set<string> {
  const words = text.split(" ");
  const ngrams = new Set<string>();
  
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  
  return ngrams;
}

// Calculate Jaccard similarity between two texts
function calculateJaccardSimilarity(text1: string, text2: string): number {
  const ngrams1 = getNgrams(preprocessText(text1));
  const ngrams2 = getNgrams(preprocessText(text2));
  
  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;
  
  let intersection = 0;
  ngrams1.forEach(ngram => {
    if (ngrams2.has(ngram)) intersection++;
  });
  
  const union = ngrams1.size + ngrams2.size - intersection;
  return (intersection / union) * 100;
}

// Cosine similarity using word frequency
function calculateCosineSimilarity(text1: string, text2: string): number {
  const words1 = preprocessText(text1).split(" ");
  const words2 = preprocessText(text2).split(" ");
  
  // Build word frequency maps
  const freq1 = new Map<string, number>();
  const freq2 = new Map<string, number>();
  
  words1.forEach(word => freq1.set(word, (freq1.get(word) || 0) + 1));
  words2.forEach(word => freq2.set(word, (freq2.get(word) || 0) + 1));
  
  // Get all unique words
  const allWords = new Set([...freq1.keys(), ...freq2.keys()]);
  
  // Calculate dot product and magnitudes
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  allWords.forEach(word => {
    const f1 = freq1.get(word) || 0;
    const f2 = freq2.get(word) || 0;
    dotProduct += f1 * f2;
    mag1 += f1 * f1;
    mag2 += f2 * f2;
  });
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  return (dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2))) * 100;
}

// Combined similarity score (average of multiple methods)
export function calculateTextSimilarity(text1: string, text2: string): number {
  const jaccard = calculateJaccardSimilarity(text1, text2);
  const cosine = calculateCosineSimilarity(text1, text2);
  
  // Weighted average (cosine is usually more accurate)
  return Math.round(jaccard * 0.4 + cosine * 0.6);
}

// Check similarity against other student answers for the same exam
export async function checkSimilarityAgainstStudents(
  examId: string,
  studentId: string,
  answerText: string
): Promise<SimilarityMatch[]> {
  const matches: SimilarityMatch[] = [];
  
  try {
    // Get all answers for this exam from other students
    const answersQuery = query(
      collection(db, "answers"),
      where("examId", "==", examId)
    );
    
    const snapshot = await getDocs(answersQuery);
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Skip own answer
      if (data.studentId === studentId) continue;
      
      // Get the answer text (for online mode) or skip (for upload mode - needs OCR)
      let otherAnswerText = "";
      
      if (data.answers && typeof data.answers === "object") {
        // Online mode - concatenate all answers
        otherAnswerText = Object.values(data.answers).join(" ");
      } else if (data.extractedText) {
        // If we have extracted text from PDF
        otherAnswerText = data.extractedText;
      } else {
        continue; // Skip if no text available
      }
      
      if (!otherAnswerText) continue;
      
      const similarity = calculateTextSimilarity(answerText, otherAnswerText);
      
      if (similarity >= 20) { // Only report matches above 20%
        matches.push({
          sourceType: "student",
          sourceId: data.studentId,
          sourceName: data.studentName || "Another Student",
          matchPercentage: similarity,
        });
      }
    }
    
    // Sort by match percentage descending
    matches.sort((a, b) => b.matchPercentage - a.matchPercentage);
    
  } catch (error) {
    console.error("Error checking similarity against students:", error);
  }
  
  return matches;
}

// Check for AI-generated content patterns
export function checkAIGeneratedPatterns(text: string): { score: number; indicators: string[] } {
  const indicators: string[] = [];
  let score = 0;
  
  const processedText = text.toLowerCase();
  
  // Common AI writing patterns
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
  
  // Check sentence structure uniformity (AI tends to be uniform)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim());
  if (sentences.length > 3) {
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - avgLength, 2), 0) / lengths.length;
    
    // Low variance in sentence length can indicate AI
    if (variance < 10 && avgLength > 10) {
      score += 15;
      indicators.push("Uniform sentence structure");
    }
  }
  
  // Check patterns
  aiPatterns.forEach(({ pattern, weight, name }) => {
    const matches = processedText.match(pattern);
    if (matches) {
      score += weight * Math.min(matches.length, 3); // Cap at 3 occurrences
      if (!indicators.includes(name)) {
        indicators.push(name);
      }
    }
  });
  
  return { score: Math.min(score, 100), indicators };
}

// Save similarity report to Firestore
export async function saveSimilarityReport(
  answerId: string,
  examId: string,
  studentId: string,
  result: SimilarityResult
): Promise<string> {
  const reportRef = await addDoc(collection(db, "similarityReports"), {
    answerId,
    examId,
    studentId,
    score: result.score,
    level: result.level,
    matches: result.matches,
    analyzedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  
  // Update the answer document with similarity info
  await updateDoc(doc(db, "answers", answerId), {
    similarityScore: result.score,
    similarityLevel: result.level,
    similarityReportId: reportRef.id,
    similarityCheckedAt: serverTimestamp(),
  });
  
  return reportRef.id;
}

// Comprehensive similarity check
export async function performSimilarityCheck(
  answerId: string,
  examId: string,
  studentId: string,
  answerText: string
): Promise<SimilarityResult> {
  const matches: SimilarityMatch[] = [];
  
  // Check against other students
  const studentMatches = await checkSimilarityAgainstStudents(examId, studentId, answerText);
  matches.push(...studentMatches);
  
  // Check for AI-generated content
  const aiCheck = checkAIGeneratedPatterns(answerText);
  if (aiCheck.score > 30) {
    matches.push({
      sourceType: "ai",
      matchPercentage: aiCheck.score,
      matchedText: aiCheck.indicators.join(", "),
    });
  }
  
  // Calculate overall score (highest match)
  const highestMatch = matches.length > 0 
    ? Math.max(...matches.map(m => m.matchPercentage))
    : 0;
  
  const result: SimilarityResult = {
    score: Math.round(highestMatch),
    level: getSimilarityLevel(highestMatch),
    matches,
    analyzedAt: new Date(),
  };
  
  // Save the report
  await saveSimilarityReport(answerId, examId, studentId, result);
  
  return result;
}

// Extract text from answer for comparison
// Note: For PDFs, you would need a PDF parsing library or cloud service
export function extractAnswerText(answers: Record<string, string>): string {
  return Object.values(answers).join(" ");
}
