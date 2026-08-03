import { NextRequest, NextResponse } from "next/server";
import {
  analyzeSubmittedAnswer,
  extractTextFromPDF,
  extractTextFromImage,
  detectAIContent,
  analyzeAnswerQuality,
  extractQuestionsFromPaper,
} from "@/lib/utils/gemini";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, fileUrls, fileUrl, question, answer, text } = body;

    if (action === "analyze_submission") {
      const urls = fileUrls || (fileUrl ? [fileUrl] : []);
      if (!urls || urls.length === 0) {
        return NextResponse.json(
          { success: false, error: "No file URLs provided for analysis" },
          { status: 400 }
        );
      }
      const result = await analyzeSubmittedAnswer(urls);
      return NextResponse.json({ success: true, analysis: result });
    }

    if (action === "extract_text") {
      if (!fileUrl) {
        return NextResponse.json(
          { success: false, error: "Missing fileUrl" },
          { status: 400 }
        );
      }
      const isPDF = fileUrl.toLowerCase().includes(".pdf");
      const extraction = isPDF
        ? await extractTextFromPDF(fileUrl)
        : await extractTextFromImage(fileUrl);

      return NextResponse.json(extraction);
    }

    if (action === "detect_ai") {
      if (!text) {
        return NextResponse.json(
          { success: false, error: "Missing text to analyze" },
          { status: 400 }
        );
      }
      const aiResult = await detectAIContent(text);
      return NextResponse.json(aiResult);
    }

    if (action === "grade_answer") {
      if (!question || !answer) {
        return NextResponse.json(
          { success: false, error: "Missing question or answer" },
          { status: 400 }
        );
      }
      const qualityResult = await analyzeAnswerQuality(question, answer);
      return NextResponse.json(qualityResult);
    }

    if (action === "extract_questions") {
      if (!fileUrl) {
        return NextResponse.json(
          { success: false, error: "Missing fileUrl for question extraction" },
          { status: 400 }
        );
      }
      const questionsResult = await extractQuestionsFromPaper(fileUrl);
      return NextResponse.json(questionsResult);
    }

    return NextResponse.json(
      { success: false, error: "Invalid action specified" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("API /api/ocr error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error during OCR processing" },
      { status: 500 }
    );
  }
}
