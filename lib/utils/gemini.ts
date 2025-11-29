/**
 * Gemini AI Integration for PDF OCR and Content Analysis
 * Uses Google Generative AI (Gemini) for text extraction and AI content detection
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini AI with API key
const getGeminiClient = () => {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Gemini API key not configured");
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
};

/**
 * Convert a File to base64 format required by Gemini
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a URL to base64 by fetching it
 */
async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  const blob = await response.blob();
  const mimeType = blob.type || "application/pdf";
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({ base64, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Extract text from a PDF using Gemini Vision
 */
export async function extractTextFromPDF(
  file: File | string
): Promise<{
  success: boolean;
  text: string;
  wordCount: number;
  error?: string;
}> {
  try {
    const genAI = getGeminiClient();
    if (!genAI) {
      return {
        success: false,
        text: "",
        wordCount: 0,
        error: "Gemini API not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in environment.",
      };
    }

    // Use Gemini Pro Vision for document analysis
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let base64Data: string;
    let mimeType: string;

    if (typeof file === "string") {
      // It's a URL
      const result = await urlToBase64(file);
      base64Data = result.base64;
      mimeType = result.mimeType;
    } else {
      // It's a File object
      base64Data = await fileToBase64(file);
      mimeType = file.type || "application/pdf";
    }

    const prompt = `Extract all text content from this document. 
    Return the text exactly as written, preserving paragraphs and structure.
    Do not add any commentary or interpretation - just extract the raw text content.
    If the document contains handwritten text, transcribe it as accurately as possible.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const response = await result.response;
    const extractedText = response.text();

    // Count words
    const wordCount = extractedText
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    return {
      success: true,
      text: extractedText,
      wordCount,
    };
  } catch (error: any) {
    console.error("PDF extraction error:", error);
    return {
      success: false,
      text: "",
      wordCount: 0,
      error: error.message || "Failed to extract text from PDF",
    };
  }
}

/**
 * Analyze text for AI-generated content indicators
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
    const genAI = getGeminiClient();
    if (!genAI) {
      return {
        success: false,
        isAIGenerated: false,
        confidence: 0,
        indicators: [],
        error: "Gemini API not configured",
      };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Analyze the following text for signs of AI-generated content.
    
Consider these factors:
1. Writing style consistency
2. Lack of personal anecdotes or unique perspectives
3. Overly formal or generic phrasing
4. Repetitive sentence structures
5. Perfect grammar with no natural variations
6. Generic transitions between paragraphs
7. Lack of specific examples or personal experiences
8. Unusually consistent tone throughout

Return a JSON response in this exact format:
{
  "isAIGenerated": true/false,
  "confidence": 0-100,
  "indicators": ["list of specific indicators found"]
}

Text to analyze:
"""
${text.substring(0, 5000)}
"""

Return ONLY the JSON object, no other text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text().trim();

    // Parse JSON response
    try {
      // Clean up response - remove markdown code blocks if present
      const cleanedResponse = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const analysis = JSON.parse(cleanedResponse);

      return {
        success: true,
        isAIGenerated: analysis.isAIGenerated || false,
        confidence: Math.min(100, Math.max(0, analysis.confidence || 0)),
        indicators: analysis.indicators || [],
      };
    } catch {
      // If JSON parsing fails, try to extract info from text
      const isAI = responseText.toLowerCase().includes("ai-generated") || 
                   responseText.toLowerCase().includes("likely generated");
      
      return {
        success: true,
        isAIGenerated: isAI,
        confidence: isAI ? 60 : 30,
        indicators: ["Analysis completed but structured response not available"],
      };
    }
  } catch (error: any) {
    console.error("AI detection error:", error);
    return {
      success: false,
      isAIGenerated: false,
      confidence: 0,
      indicators: [],
      error: error.message || "Failed to analyze text",
    };
  }
}

/**
 * Extract text from images (handwritten answers, screenshots, etc.)
 */
export async function extractTextFromImage(
  file: File | string
): Promise<{
  success: boolean;
  text: string;
  wordCount: number;
  error?: string;
}> {
  try {
    const genAI = getGeminiClient();
    if (!genAI) {
      return {
        success: false,
        text: "",
        wordCount: 0,
        error: "Gemini API not configured",
      };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

    const prompt = `Extract all text from this image. 
    If it contains handwritten text, transcribe it as accurately as possible.
    Return ONLY the extracted text, no commentary.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const response = await result.response;
    const extractedText = response.text();

    const wordCount = extractedText
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    return {
      success: true,
      text: extractedText,
      wordCount,
    };
  } catch (error: any) {
    console.error("Image text extraction error:", error);
    return {
      success: false,
      text: "",
      wordCount: 0,
      error: error.message || "Failed to extract text from image",
    };
  }
}

/**
 * Analyze answer quality and provide feedback
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
    const genAI = getGeminiClient();
    if (!genAI) {
      return {
        success: false,
        score: 0,
        feedback: "",
        strengths: [],
        improvements: [],
        error: "Gemini API not configured",
      };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Analyze this exam answer and provide a quality assessment.

Question: ${question}

Answer: ${answer.substring(0, 3000)}

Return a JSON response:
{
  "score": 0-100,
  "feedback": "Brief overall feedback",
  "strengths": ["list of strong points"],
  "improvements": ["list of areas to improve"]
}

Return ONLY the JSON object.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text().trim();

    try {
      const cleanedResponse = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const analysis = JSON.parse(cleanedResponse);

      return {
        success: true,
        score: Math.min(100, Math.max(0, analysis.score || 0)),
        feedback: analysis.feedback || "",
        strengths: analysis.strengths || [],
        improvements: analysis.improvements || [],
      };
    } catch {
      return {
        success: false,
        score: 0,
        feedback: "",
        strengths: [],
        improvements: [],
        error: "Failed to parse analysis response",
      };
    }
  } catch (error: any) {
    console.error("Answer analysis error:", error);
    return {
      success: false,
      score: 0,
      feedback: "",
      strengths: [],
      improvements: [],
      error: error.message || "Failed to analyze answer",
    };
  }
}

/**
 * Comprehensive answer analysis for plagiarism and AI detection
 */
export interface ComprehensiveAnalysis {
  extractedText: string;
  wordCount: number;
  aiDetection: {
    isAIGenerated: boolean;
    confidence: number;
    indicators: string[];
  };
  errors?: string[];
}

export async function analyzeSubmittedAnswer(
  fileOrUrl: File | string
): Promise<ComprehensiveAnalysis> {
  const errors: string[] = [];
  
  // Determine if it's a PDF or image
  let mimeType = "";
  if (typeof fileOrUrl === "string") {
    // URL - try to determine type from extension
    if (fileOrUrl.toLowerCase().includes(".pdf")) {
      mimeType = "application/pdf";
    } else {
      mimeType = "image/png";
    }
  } else {
    mimeType = fileOrUrl.type;
  }

  // Extract text
  let extractedText = "";
  let wordCount = 0;
  
  if (mimeType.includes("pdf")) {
    const extraction = await extractTextFromPDF(fileOrUrl);
    if (extraction.success) {
      extractedText = extraction.text;
      wordCount = extraction.wordCount;
    } else {
      errors.push(extraction.error || "Failed to extract PDF text");
    }
  } else {
    const extraction = await extractTextFromImage(fileOrUrl);
    if (extraction.success) {
      extractedText = extraction.text;
      wordCount = extraction.wordCount;
    } else {
      errors.push(extraction.error || "Failed to extract image text");
    }
  }

  // Run AI detection if we have text
  let aiDetection = {
    isAIGenerated: false,
    confidence: 0,
    indicators: [] as string[],
  };

  if (extractedText.length > 50) {
    const detection = await detectAIContent(extractedText);
    if (detection.success) {
      aiDetection = {
        isAIGenerated: detection.isAIGenerated,
        confidence: detection.confidence,
        indicators: detection.indicators,
      };
    } else {
      errors.push(detection.error || "Failed to run AI detection");
    }
  }

  return {
    extractedText,
    wordCount,
    aiDetection,
    errors: errors.length > 0 ? errors : undefined,
  };
}
