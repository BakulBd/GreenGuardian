/**
 * Gemini 2.5 Flash AI Integration for PDF/Image OCR and Content Analysis
 * Uses Google Generative AI (Gemini 2.5 Flash with fallback cascade) for text extraction,
 * plagiarism/AI detection, answer quality scoring, and document question paper extraction.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileReference } from "@/lib/storage/read-object";

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

/**
 * Initialize the Gemini client.
 *
 * SERVER ONLY. The key must never be exposed with a NEXT_PUBLIC_ prefix — that
 * inlines it into the JavaScript sent to every browser, where anyone can read
 * it and spend the project's quota. Browser code calls `/api/ocr` instead
 * (see `lib/utils/ai-client.ts`).
 */
export const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Gemini API key not configured (set GEMINI_API_KEY)");
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
};

/**
 * Execute Gemini content generation with fallback through model versions
 */
async function generateContentWithFallback(contents: any) {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error("Gemini API key not configured. Set GEMINI_API_KEY on the server.");
  }

  let lastError: any = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(contents);
      const response = await result.response;
      return { response, modelName };
    } catch (err: any) {
      console.warn(`Model ${modelName} failed/unavailable: ${err?.message || err}. Trying next model...`);
      lastError = err;
    }
  }
  throw lastError || new Error("All Gemini models failed to process the request.");
}

/**
 * Convert a File to base64 format required by Gemini
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a stored file reference to base64 for the model.
 *
 * Delegates to `readFileReference`, which knows the three shapes an attachment
 * URL can take in this project. A plain `fetch(url)` is NOT sufficient and was
 * the thing that would have silently broken every OCR run after the move to
 * Backblaze B2: attachment links are now app-relative
 * (`/api/storage/download?key=…`) so that they work in `<img src>`, and Node's
 * fetch rejects a relative URL outright. Reading the private bucket directly
 * also removes a whole HTTP round trip per file, which matters when a
 * submission carries ten pages.
 *
 * This module runs only inside `/api/ocr` (it holds the Gemini key), so
 * importing the server-only storage reader here is safe.
 */
export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const { base64, mimeType } = await readFileReference(url);
  return { base64, mimeType };
}

export interface ExtractionResult {
  success: boolean;
  text: string;
  wordCount: number;
  modelUsed?: string;
  error?: string;
}

/**
 * Extract text from a PDF or Document using Gemini 2.5 Flash
 */
export async function extractTextFromPDF(
  file: File | string
): Promise<ExtractionResult> {
  try {
    let base64Data: string;
    let mimeType: string;

    if (typeof file === "string") {
      const result = await urlToBase64(file);
      base64Data = result.base64;
      mimeType = result.mimeType;
    } else {
      base64Data = await fileToBase64(file);
      mimeType = file.type || "application/pdf";
    }

    const prompt = `Extract all text content from this document. 
Return the text exactly as written, preserving paragraphs, mathematical notation, and structure.
Do not add any commentary or extra text - just transcribe the raw content.
If the document contains handwritten text or diagrams, transcribe all handwritten text accurately.`;

    const { response, modelName } = await generateContentWithFallback([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const extractedText = response.text().trim();
    const wordCount = extractedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return {
      success: true,
      text: extractedText,
      wordCount,
      modelUsed: modelName,
    };
  } catch (error: any) {
    console.error("Gemini PDF extraction error:", error);
    return {
      success: false,
      text: "",
      wordCount: 0,
      error: error.message || "Failed to extract text from document",
    };
  }
}

/**
 * Extract text from an image (handwritten answer, screenshot, scan) using Gemini 2.5 Flash
 */
export async function extractTextFromImage(
  file: File | string
): Promise<ExtractionResult> {
  try {
    let base64Data: string;
    let mimeType: string;

    if (typeof file === "string") {
      const result = await urlToBase64(file);
      base64Data = result.base64;
      mimeType = result.mimeType;
    } else {
      base64Data = await fileToBase64(file);
      mimeType = file.type || "image/png";
    }

    const prompt = `Extract all text from this image carefully. 
Transcribe handwritten student answers, printed test questions, and text accurately.
If formulas or math equations exist, format them in standard clear math notation.
Return ONLY the extracted text with no conversational filler.`;

    const { response, modelName } = await generateContentWithFallback([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const extractedText = response.text().trim();
    const wordCount = extractedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return {
      success: true,
      text: extractedText,
      wordCount,
      modelUsed: modelName,
    };
  } catch (error: any) {
    console.error("Gemini Image text extraction error:", error);
    return {
      success: false,
      text: "",
      wordCount: 0,
      error: error.message || "Failed to extract text from image",
    };
  }
}

/**
 * Deep AI-Generated Content & Paraphrasing Detection using Gemini 2.5 Flash
 */
export async function detectAIContent(
  text: string
): Promise<{
  success: boolean;
  isAIGenerated: boolean;
  confidence: number; // 0-100
  indicators: string[];
  error?: string;
}> {
  try {
    if (!text || text.trim().length < 20) {
      return {
        success: true,
        isAIGenerated: false,
        confidence: 0,
        indicators: ["Insufficient text length for AI detection"],
      };
    }

    const prompt = `Analyze the following student exam answer text for signs of AI-generated content (e.g. ChatGPT, Claude, Gemini, Copilot).

Consider:
1. Artificial perfection or rigid essay structures
2. Generic filler phrases ("delve into", "crucial to note", "in conclusion")
3. Lack of natural student voice or typos
4. Typical AI structural formatting (lists, bullet points where paragraph expected)

Return a JSON response in this EXACT format:
{
  "isAIGenerated": true or false,
  "confidence": number between 0 and 100,
  "indicators": ["specific indicator 1", "specific indicator 2"]
}

Text to analyze:
"""
${text.substring(0, 8000)}
"""

Return ONLY the valid JSON object.`;

    const { response } = await generateContentWithFallback(prompt);
    const responseText = response.text().trim();

    const cleanedJson = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const analysis = JSON.parse(cleanedJson);

    return {
      success: true,
      isAIGenerated: Boolean(analysis.isAIGenerated),
      confidence: Math.min(100, Math.max(0, Number(analysis.confidence) || 0)),
      indicators: Array.isArray(analysis.indicators) ? analysis.indicators : [],
    };
  } catch (error: any) {
    console.error("Gemini AI detection error:", error);
    return {
      success: false,
      isAIGenerated: false,
      confidence: 0,
      indicators: [],
      error: error.message || "AI detection analysis failed",
    };
  }
}

/**
 * Analyze Answer Quality against a question and reference rubric
 */
export async function analyzeAnswerQuality(
  question: string,
  answer: string
): Promise<{
  success: boolean;
  score: number; // 0-100
  feedback: string;
  strengths: string[];
  improvements: string[];
  error?: string;
}> {
  try {
    const prompt = `Evaluate this student's exam answer.
    
Question: ${question}
Student Answer: ${answer.substring(0, 4000)}

Provide a fair grade assessment (0-100), constructive feedback, strengths, and areas for improvement.
Return a JSON response in this exact format:
{
  "score": number 0-100,
  "feedback": "Overall feedback summary",
  "strengths": ["Strength 1", "Strength 2"],
  "improvements": ["Improvement area 1", "Improvement area 2"]
}

Return ONLY the JSON object.`;

    const { response } = await generateContentWithFallback(prompt);
    const cleanedJson = response.text().trim()
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const analysis = JSON.parse(cleanedJson);

    return {
      success: true,
      score: Math.min(100, Math.max(0, Number(analysis.score) || 0)),
      feedback: analysis.feedback || "Evaluation complete",
      strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
      improvements: Array.isArray(analysis.improvements) ? analysis.improvements : [],
    };
  } catch (error: any) {
    console.error("Answer quality analysis error:", error);
    return {
      success: false,
      score: 0,
      feedback: "",
      strengths: [],
      improvements: [],
      error: error.message || "Failed to analyze answer quality",
    };
  }
}

/**
 * Comprehensive OCR analysis for multi-page or multi-file student submission scripts
 */
export interface ComprehensiveAnalysis {
  extractedText: string;
  wordCount: number;
  modelUsed?: string;
  aiDetection: {
    isAIGenerated: boolean;
    confidence: number;
    indicators: string[];
  };
  fileAnalyses: Array<{
    fileName: string;
    fileUrl: string;
    extractedText: string;
    wordCount: number;
    error?: string;
  }>;
  errors?: string[];
}

export async function analyzeSubmittedAnswer(
  filesOrUrls: Array<File | string | { url?: string; downloadURL?: string; name?: string }>
): Promise<ComprehensiveAnalysis> {
  const fileAnalyses: ComprehensiveAnalysis["fileAnalyses"] = [];
  const errors: string[] = [];
  let fullExtractedText = "";
  let totalWordCount = 0;
  let primaryModelUsed = "gemini-2.5-flash";

  // Standardize inputs into an array
  const fileList = Array.isArray(filesOrUrls) ? filesOrUrls : [filesOrUrls];

  for (let i = 0; i < fileList.length; i++) {
    const item = fileList[i];
    let fileTarget: File | string;
    let fileName = `Page_${i + 1}`;

    if (typeof item === "string") {
      fileTarget = item;
      fileName = item.split("/").pop()?.split("?")[0] || `File_${i + 1}`;
    } else if (item instanceof File) {
      fileTarget = item;
      fileName = item.name;
    } else if (item && typeof item === "object") {
      fileTarget = item.downloadURL || item.url || "";
      fileName = item.name || `File_${i + 1}`;
    } else {
      continue;
    }

    if (!fileTarget) continue;

    const isPDF =
      (typeof fileTarget === "string" && fileTarget.toLowerCase().includes(".pdf")) ||
      (fileTarget instanceof File && fileTarget.type.includes("pdf"));

    let extraction: ExtractionResult;
    if (isPDF) {
      extraction = await extractTextFromPDF(fileTarget);
    } else {
      extraction = await extractTextFromImage(fileTarget);
    }

    if (extraction.success && extraction.text) {
      if (extraction.modelUsed) primaryModelUsed = extraction.modelUsed;
      fullExtractedText += (fullExtractedText ? "\n\n--- Page Break ---\n\n" : "") + extraction.text;
      totalWordCount += extraction.wordCount;
      fileAnalyses.push({
        fileName,
        fileUrl: typeof fileTarget === "string" ? fileTarget : fileName,
        extractedText: extraction.text,
        wordCount: extraction.wordCount,
      });
    } else {
      const err = extraction.error || `Failed to extract text from file ${fileName}`;
      errors.push(err);
      fileAnalyses.push({
        fileName,
        fileUrl: typeof fileTarget === "string" ? fileTarget : fileName,
        extractedText: "",
        wordCount: 0,
        error: err,
      });
    }
  }

  // Run AI content detection on combined text
  let aiDetection = {
    isAIGenerated: false,
    confidence: 0,
    indicators: [] as string[],
  };

  if (fullExtractedText.trim().length > 30) {
    const detection = await detectAIContent(fullExtractedText);
    if (detection.success) {
      aiDetection = {
        isAIGenerated: detection.isAIGenerated,
        confidence: detection.confidence,
        indicators: detection.indicators,
      };
    } else if (detection.error) {
      errors.push(detection.error);
    }
  }

  return {
    extractedText: fullExtractedText,
    wordCount: totalWordCount,
    modelUsed: primaryModelUsed,
    aiDetection,
    fileAnalyses,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Extract structured questions from an uploaded question paper PDF/Image using Gemini 2.5 Flash
 */
export async function extractQuestionsFromPaper(
  fileOrUrl: File | string
): Promise<{
  success: boolean;
  questions: Array<{
    text: string;
    type: "mcq" | "short_answer" | "essay" | "true_false";
    options?: string[];
    correctAnswer?: string;
    marks: number;
  }>;
  error?: string;
}> {
  try {
    let base64Data: string;
    let mimeType: string;

    if (typeof fileOrUrl === "string") {
      const res = await urlToBase64(fileOrUrl);
      base64Data = res.base64;
      mimeType = res.mimeType;
    } else {
      base64Data = await fileToBase64(fileOrUrl);
      mimeType = fileOrUrl.type || "application/pdf";
    }

    const prompt = `Analyze this exam question paper document and parse all questions into structured JSON.

Return JSON in this format:
{
  "questions": [
    {
      "text": "Question text here",
      "type": "mcq" or "short_answer" or "essay" or "true_false",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Answer key or correct option if present",
      "marks": 5
    }
  ]
}

Return ONLY the raw JSON object.`;

    const { response } = await generateContentWithFallback([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const cleanedJson = response.text().trim()
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(cleanedJson);

    return {
      success: true,
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    };
  } catch (error: any) {
    console.error("Error extracting questions from paper:", error);
    return {
      success: false,
      questions: [],
      error: error.message || "Failed to extract questions from document",
    };
  }
}
