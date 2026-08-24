import { NextRequest, NextResponse } from "next/server";
import {
  analyzeSubmittedAnswer,
  extractTextFromPDF,
  extractTextFromImage,
  detectAIContent,
  analyzeAnswerQuality,
  extractQuestionsFromPaper,
} from "@/lib/utils/gemini";
import { requireAuthedUser } from "@/lib/server/api-auth";
import { checkClientFileReference } from "@/lib/storage/read-object";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/** Longest text we will forward to the model (protects quota and latency). */
const MAX_TEXT_LENGTH = 100_000;
/** Most files a single analysis request may reference. */
const MAX_FILES = 10;
/** Per-user burst limit: AI calls are billable, so they are capped. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  try {
    // Authentication is delegated to the shared helper every other privileged
    // route uses, rather than the hand-rolled copy that used to live here.
    //
    // That copy wrapped BOTH `verifyIdToken` and the `users/{uid}` lookup in a
    // bare `catch {}` and answered every failure with
    // "Invalid or expired session. Please sign in again." (401). So a server-side
    // fault — an unusable FIREBASE_SERVICE_ACCOUNT, Firestore being unreachable —
    // was reported as the caller's session being bad, with the real error
    // swallowed and never logged. `requireAuthedUser` separates the two: a bad
    // token is still 401, anything else is 503 with the cause logged
    // server-side (see `tokenVerificationErrorResponse`).
    //
    // It also keeps the checks this endpoint needs: it is an open proxy to the
    // project's paid Gemini quota without them, and accounts on hold/suspended
    // are refused. No role filter — students trigger the OCR pass on their own
    // submission at submit time, teachers from the answers dashboard.
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const rate = checkRateLimit(
      `ocr:${auth.uid}:${getClientIp(req)}`,
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

    // Validate every reference against the shapes the upload layer actually
    // persists. This must NOT be an "absolute http(s) only" test: since the
    // move to Backblaze B2 an attachment is stored as the relative signed link
    // `/api/storage/download?key=…&exp=…&sig=…` (see `createSignedStorageUrl`),
    // which is what `readFileReference` — and therefore the whole OCR/Gemini
    // path — is built to read. Rejecting it here was what turned every
    // "Run OCR" and "Extract Questions" click into a 400.
    const requestedUrls: string[] = Array.isArray(fileUrls)
      ? fileUrls
      : fileUrl
      ? [fileUrl]
      : [];
    for (const reference of requestedUrls) {
      const check = checkClientFileReference(reference);
      if (!check.ok) {
        return NextResponse.json({ success: false, error: check.error }, { status: 400 });
      }
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
