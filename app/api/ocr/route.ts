import { NextRequest, NextResponse } from "next/server";
import {
  analyzeSubmittedAnswer,
  extractTextFromPDF,
  extractTextFromImage,
  detectAIContent,
  analyzeAnswerQuality,
  extractQuestionsFromPaper,
} from "@/lib/utils/gemini";
import { getAdminAuth, getAdminDb, isAdminSdkConfigured } from "@/lib/firebase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/** Longest text we will forward to the model (protects quota and latency). */
const MAX_TEXT_LENGTH = 100_000;
/** Most files a single analysis request may reference. */
const MAX_FILES = 10;
/** Per-user burst limit: AI calls are billable, so they are capped. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Authenticate the caller with their Firebase ID token.
 *
 * Without this the endpoint is an open proxy to the project's paid Gemini
 * quota — anyone could POST to it and spend the owner's credits.
 */
async function requireUser(
  req: NextRequest
): Promise<{ uid: string } | NextResponse> {
  const header = req.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }

  if (!isAdminSdkConfigured()) {
    // Fail closed: without the Admin SDK we cannot verify who is calling.
    return NextResponse.json(
      {
        success: false,
        error:
          "Server auth is not configured. Set FIREBASE_SERVICE_ACCOUNT so AI requests can be verified.",
      },
      { status: 503 }
    );
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);

    // Accounts an admin has put on hold or suspended may not call billable
    // AI endpoints even with an otherwise-valid session token.
    const userSnap = await getAdminDb().collection("users").doc(decoded.uid).get();
    const status = userSnap.exists ? userSnap.data()?.status : undefined;
    if (status === "hold" || status === "suspended") {
      return NextResponse.json(
        { success: false, error: "Your account access has been restricted. Please contact an administrator." },
        { status: 403 }
      );
    }

    return { uid: decoded.uid };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid or expired session. Please sign in again." },
      { status: 401 }
    );
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser(req);
    if (authResult instanceof NextResponse) return authResult;

    const rate = checkRateLimit(
      `ocr:${authResult.uid}:${getClientIp(req)}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many AI requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const { action, fileUrls, fileUrl, question, answer, text } = body as Record<
      string,
      any
    >;

    // Only fetch remote documents from real http(s) URLs — never file:// or
    // arbitrary strings that could be coerced into a local read.
    const requestedUrls: string[] = Array.isArray(fileUrls)
      ? fileUrls
      : fileUrl
      ? [fileUrl]
      : [];
    if (requestedUrls.length > 0 && !requestedUrls.every(isHttpUrl)) {
      return NextResponse.json(
        { success: false, error: "File URLs must be valid http(s) URLs." },
        { status: 400 }
      );
    }
    if (requestedUrls.length > MAX_FILES) {
      return NextResponse.json(
        { success: false, error: `At most ${MAX_FILES} files can be analyzed at once.` },
        { status: 400 }
      );
    }
    if (typeof text === "string" && text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { success: false, error: "Text is too long to analyze." },
        { status: 413 }
      );
    }

    if (action === "analyze_submission") {
      const urls = requestedUrls;
      if (urls.length === 0) {
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
