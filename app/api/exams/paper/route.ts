/**
 * Student-facing exam paper delivery.
 *
 * `ExamClient` used to load the paper with a direct Firestore read
 * (`getExam()`), which returns the questions **with `correctAnswer`**. The
 * component then deleted that field before rendering — but the answer key had
 * already crossed the wire and sat in the browser's network log, so every
 * student could read the answers to any exam they were allowed to open.
 *
 * The paper now comes from here instead, stripped server-side, and
 * `firestore.rules` no longer lets a student read the `questions` collection
 * at all. The key never leaves the server until the submission is graded.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAuthedUser, jsonError } from "@/lib/server/api-auth";
import { sanitizeQuestionsForStudent, type GradableQuestion } from "@/lib/server/grading";
import { loadExamQuestions, serializeFirestoreData } from "@/lib/server/exam-questions";

export const dynamic = "force-dynamic";

/** Exam states whose paper a targeted student may still open. */
const STUDENT_READABLE_STATUSES = new Set(["published", "active", "completed", "archived"]);

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthedUser(req);
    if (auth instanceof NextResponse) return auth;

    const examId = req.nextUrl.searchParams.get("examId")?.trim();
    if (!examId) return jsonError("examId is required.", 400);

    const db = getAdminDb();
    const examSnap = await db.collection("exams").doc(examId).get();
    if (!examSnap.exists) return jsonError("Exam not found.", 404);

    const exam = examSnap.data() || {};

    // Staff may preview any exam they own (admins, any exam). Students are held
    // to exactly the conditions firestore.rules enforces for the exam document.
    if (auth.role === "student") {
      const targetStudentIds: string[] = Array.isArray(exam.targetStudentIds)
        ? exam.targetStudentIds
        : [];
      if (!STUDENT_READABLE_STATUSES.has(String(exam.status || ""))) {
        return jsonError("This exam is not open.", 403);
      }
      if (!targetStudentIds.includes(auth.uid)) {
        return jsonError("You are not assigned to this exam.", 403);
      }
    } else if (auth.role === "teacher") {
      if (exam.teacherId !== auth.uid && exam.createdBy !== auth.uid) {
        return jsonError("You do not have access to this exam.", 403);
      }
    } else if (auth.role !== "admin") {
      return jsonError("You do not have access to this exam.", 403);
    }

    const questions = await loadExamQuestions(db, examId, exam);

    // `questions` and `targetStudentIds` are removed from the metadata payload:
    // the first is replaced by the sanitized set, and the second is a roster of
    // every classmate's user id that no student needs.
    const { questions: _embedded, targetStudentIds: _targets, ...metadata } = exam as Record<
      string,
      any
    >;

    return NextResponse.json({
      success: true,
      exam: {
        ...serializeFirestoreData(metadata),
        id: examId,
        questions:
          auth.role === "student"
            ? sanitizeQuestionsForStudent(questions as GradableQuestion[])
            : questions,
        questionCount: questions.length,
      },
    });
  } catch (error: any) {
    console.error("API /api/exams/paper error:", error);
    return jsonError(error?.message || "Failed to load the exam paper.", 500);
  }
}
