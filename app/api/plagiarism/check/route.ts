/**
 * Cross-student plagiarism / AI-authorship check.
 *
 * This used to run in the browser (`performSimilarityCheck` in
 * lib/utils/similarity.ts) and was **silently broken for every student
 * submission**. The comparison needs to read all answers for an exam:
 *
 *     query(collection(db, "answers"), where("examId", "==", examId))
 *
 * Firestore rejects that query outright for a student, because the `answers`
 * read rule is `isUser(resource.data.studentId)` and the query is not
 * constrained to their own id. The rejection landed in a `try/catch` that
 * returned an empty match list, so the check completed "successfully" with
 * zero matches and stamped every submission `similarityLevel: "unique"` —
 * a clean bill of health that was never actually computed. Teacher-initiated
 * runs did work (teachers may read all answers), which is why the gap was
 * easy to miss.
 *
 * Running it here with the Admin SDK is what makes the comparison real. It
 * also means students can no longer write their own similarity verdict:
 * `similarityReports` is server-written only in the tightened rules.
 */
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  calculateTextSimilarity,
  checkAIGeneratedPatterns,
  extractComparableText,
  getSimilarityLevel,
  MATCH_REPORTING_FLOOR,
  type SimilarityMatch,
} from "@/lib/utils/text-similarity";

export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Shorter than this and a similarity score is noise, not evidence. */
const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 200_000;
/** Upper bound on peers compared against, to keep one request bounded. */
const MAX_PEER_ANSWERS = 500;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const rate = checkRateLimit(
      `plagiarism:${auth.uid}:${getClientIp(req)}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many similarity checks. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return jsonError("Invalid request body.", 400);

    const { answerId, text: providedText } = body as Record<string, any>;
    if (!answerId || typeof answerId !== "string") {
      return jsonError("answerId is required.", 400);
    }

    const db = getAdminDb();
    const answerRef = db.collection("answers").doc(answerId);
    const answerSnap = await answerRef.get();
    if (!answerSnap.exists) return jsonError("Answer not found.", 404);

    const answer = answerSnap.data() || {};
    const examId = String(answer.examId || "");
    const studentId = String(answer.studentId || "");
    if (!examId) return jsonError("This answer has no exam attached.", 422);

    // A student may only trigger a check on their own submission; teachers on
    // submissions for exams they own; admins on anything.
    if (auth.role === "student") {
      if (studentId !== auth.uid) {
        return jsonError("You can only check your own submission.", 403);
      }
    } else if (auth.role === "teacher") {
      const examSnap = await db.collection("exams").doc(examId).get();
      const exam = examSnap.data() || {};
      if (exam.teacherId !== auth.uid && exam.createdBy !== auth.uid) {
        return jsonError("You do not have access to this exam.", 403);
      }
    } else if (auth.role !== "admin") {
      return jsonError("You do not have permission to perform this action.", 403);
    }

    // Trust the stored document over the caller's text — a client-supplied
    // string would let a student have an innocuous passage scored in place of
    // what they actually submitted.
    const storedText = extractComparableText(answer);
    const text = (storedText || (typeof providedText === "string" ? providedText : "")).slice(
      0,
      MAX_TEXT_LENGTH
    );

    if (text.trim().length < MIN_TEXT_LENGTH) {
      return jsonError("There is not enough text in this submission to compare.", 422);
    }

    const peers = await db
      .collection("answers")
      .where("examId", "==", examId)
      .limit(MAX_PEER_ANSWERS)
      .get();

    const matches: SimilarityMatch[] = [];
    for (const peer of peers.docs) {
      if (peer.id === answerId) continue;
      const peerData = peer.data();
      if (peerData.studentId === studentId) continue;

      const peerText = extractComparableText(peerData);
      if (!peerText) continue;

      const score = calculateTextSimilarity(text, peerText);
      if (score >= MATCH_REPORTING_FLOOR) {
        matches.push({
          sourceType: "student",
          sourceId: peerData.studentId,
          sourceName: peerData.studentName || "Another Student",
          matchPercentage: score,
        });
      }
    }

    matches.sort((a, b) => b.matchPercentage - a.matchPercentage);

    const aiCheck = checkAIGeneratedPatterns(text);
    if (aiCheck.score > 30) {
      matches.push({
        sourceType: "ai",
        matchPercentage: aiCheck.score,
        matchedText: aiCheck.indicators.join(", "),
      });
    }

    const highestMatch = matches.length > 0
      ? Math.max(...matches.map((m) => m.matchPercentage))
      : 0;
    const score = Math.round(highestMatch);
    const level = getSimilarityLevel(score);

    // Deterministic report id keeps re-runs from piling up one report per click.
    const reportRef = db.collection("similarityReports").doc(answerId);
    const batch = db.batch();
    batch.set(
      reportRef,
      {
        answerId,
        examId,
        studentId,
        score,
        level,
        matches,
        comparedAgainst: peers.size,
        analyzedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    // Only the verdict goes on the answer document — a student may read their
    // own answer, and the match list names the classmates they matched against
    // and by how much. The detail lives in `similarityReports`, which is
    // staff-read-only.
    batch.update(answerRef, {
      similarityScore: score,
      similarityLevel: level,
      similarityReportId: reportRef.id,
      similarityCheckedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    // A student may trigger the check on their own submission, but must not
    // learn WHO they matched — the match list names classmates and how closely
    // their answers align. Staff get the full report; the student gets only
    // the verdict on their own work.
    const isStaff = auth.role === "teacher" || auth.role === "admin";

    return NextResponse.json({
      success: true,
      report: {
        score,
        level,
        matches: isStaff ? matches : matches.filter((m) => m.sourceType === "ai"),
        comparedAgainst: peers.size,
      },
    });
  } catch (error: any) {
    console.error("API /api/plagiarism/check error:", error);
    return jsonError(error?.message || "Failed to run the similarity check.", 500);
  }
}
