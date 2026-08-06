"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Shield,
  Monitor,
  FileText,
  Download,
  Lightbulb,
  Timer,
  Award,
  Percent,
  MessageSquare,
} from "lucide-react";
import { isOptionBasedQuestion } from "@/lib/utils/questionTypes";
import { calculateGrade, getGradeColor } from "@/lib/firebase/results";

export interface ReviewQuestion {
  id: string;
  text: string;
  type: string;
  options?: string[];
  correctAnswer?: string | string[];
  explanation?: string;
  marks: number;
  negativeMarks?: number;
}

export interface ReviewExam {
  id: string;
  title: string;
  questions?: ReviewQuestion[];
  examMode?: "online" | "upload";
}

/** Firestore Timestamp | Date | ISO string -> epoch millis (0 when unknown). */
const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDuration = (ms: number): string => {
  if (ms <= 0) return "N/A";
  const totalSeconds = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

interface ExamAnswerReviewProps {
  exam: ReviewExam;
  session?: any | null;
  answerData: any;
}

/**
 * Question-by-question submission review: score summary, per-question
 * correct/wrong/manually-graded breakdown, and the upload-mode fallback for
 * file-based submissions. Shared by the student's own review page
 * (app/exam/[id]/review) and the teacher's per-student review (Task 7) so
 * both audiences see exactly the same rendering of the same data.
 */
export default function ExamAnswerReview({ exam, session, answerData }: ExamAnswerReviewProps) {
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const isUploadSubmission = Boolean(
    (exam.examMode === "upload" || answerData.answerFiles?.length) && !answerData.answers
  );

  const startedAt = toMillis(session?.startTime);
  const completedAt = toMillis(session?.completedAt) || toMillis(answerData.submittedAt);
  const pausedMs = typeof session?.totalPausedMs === "number" ? session.totalPausedMs : 0;
  const timeTakenMs = startedAt && completedAt ? Math.max(0, completedAt - startedAt - pausedMs) : 0;

  const totalMarks = answerData.totalMarks ?? 0;
  const obtainedMarks = answerData.score ?? 0;
  const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 1000) / 10 : 0;
  const { grade } = calculateGrade(percentage);
  const submittedDate = answerData.submittedAt?.toDate?.();

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card className="border-t-4 border-t-blue-500 shadow-md">
        <CardHeader className="bg-blue-50/50 pb-4">
          <div className="flex justify-between items-start flex-wrap gap-2">
            <div>
              <CardTitle className="text-xl text-blue-900">Performance Summary</CardTitle>
              <CardDescription>
                Submitted on {answerData.submittedAt?.toDate?.()?.toLocaleString() || "Unknown"}
                {typeof session?.attemptNumber === "number" && (
                  <> &middot; Attempt {session.attemptNumber}</>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`${getGradeColor(grade)} px-3 py-1 text-base font-bold`} variant="outline">
                Grade: {grade}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 px-3 py-1">
                Score: {obtainedMarks} / {totalMarks || 100}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center mb-4">
            <div className="p-4 bg-gray-50 rounded-lg border">
              <p className="text-sm text-gray-500 mb-1">Total Marks</p>
              <p className="text-2xl font-bold text-gray-900">{totalMarks || "N/A"}</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-blue-600 mb-1 flex items-center justify-center gap-1">
                <Award className="w-4 h-4" /> Obtained Marks
              </p>
              <p className="text-2xl font-bold text-blue-700">{obtainedMarks}</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
              <p className="text-sm text-purple-600 mb-1 flex items-center justify-center gap-1">
                <Percent className="w-4 h-4" /> Percentage
              </p>
              <p className="text-2xl font-bold text-purple-700">{percentage}%</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg border">
              <p className="text-sm text-gray-500 mb-1">Accuracy</p>
              <p className="text-2xl font-bold text-gray-900">{answerData.accuracy ?? 0}%</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
              <p className="text-sm text-emerald-600 mb-1 flex items-center justify-center gap-1">
                <CheckCircle className="w-4 h-4" /> Correct
              </p>
              <p className="text-2xl font-bold text-emerald-700">{answerData.grading?.correctAnswers ?? 0}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg border border-red-100">
              <p className="text-sm text-red-600 mb-1 flex items-center justify-center gap-1">
                <XCircle className="w-4 h-4" /> Wrong
              </p>
              <p className="text-2xl font-bold text-red-700">{answerData.grading?.wrongAnswers ?? 0}</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
              <p className="text-sm text-amber-600 mb-1 flex items-center justify-center gap-1">
                <Shield className="w-4 h-4" /> Behavior
              </p>
              <p className="text-2xl font-bold text-amber-700">{answerData.behaviorScore ?? 100}</p>
            </div>
            <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
              <p className="text-sm text-indigo-600 mb-1 flex items-center justify-center gap-1">
                <Timer className="w-4 h-4" /> Time Taken
              </p>
              <p className="text-2xl font-bold text-indigo-700">{formatDuration(timeTakenMs)}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border">
              <p className="text-sm text-slate-500 mb-1 flex items-center justify-center gap-1">
                <Clock className="w-4 h-4" /> Submitted At
              </p>
              <p className="text-sm font-bold text-slate-700 mt-1.5">
                {submittedDate ? submittedDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "Unknown"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Teacher Feedback (if available) */}
      {answerData.teacherFeedback && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <MessageSquare className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-blue-900">Teacher Feedback</h3>
            <p className="text-sm text-blue-800 mt-1 whitespace-pre-wrap">{answerData.teacherFeedback}</p>
          </div>
        </div>
      )}

      {/* Proctoring Warnings Summary if any */}
      {answerData.warningCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-amber-900">Proctoring Alerts Logged</h3>
            <p className="text-sm text-amber-700 mt-1">
              {answerData.warningCount} warning(s) were recorded during this exam, resulting in a behavior score of {answerData.behaviorScore}.
              {answerData.flagged && " This submission was flagged for review."}
            </p>
          </div>
        </div>
      )}

      {/* Upload-mode submission: file-based / descriptive answers have no
          per-question array, so they get their own review section instead
          of falling through to "no questions available". */}
      {isUploadSubmission ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Submitted Answer File(s)
            </CardTitle>
            <CardDescription>
              This exam was answered by file upload. Grading and any AI-assisted analysis are shown below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {answerData.answerFiles?.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {answerData.answerFiles.map((file: any, idx: number) => (
                  <a
                    key={idx}
                    href={file.url || file.downloadURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 p-3 rounded-lg border bg-gray-50 hover:bg-gray-100 transition-colors text-sm"
                  >
                    <span className="truncate text-gray-800">{file.name || `File ${idx + 1}`}</span>
                    <Download className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No files were recorded for this submission.</p>
            )}

            {answerData.ocrAnalysis?.extractedText && (
              <div className="p-4 rounded-lg border bg-slate-50">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Extracted Text (AI-assisted)
                </p>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">
                  {answerData.ocrAnalysis.extractedText}
                </p>
              </div>
            )}

            <div className="p-4 rounded-lg border bg-blue-50 border-blue-200 flex items-center justify-between">
              <span className="text-sm font-medium text-blue-900">Marks Awarded</span>
              <span className="text-lg font-bold text-blue-900">
                {answerData.score ?? "Not graded yet"} {answerData.totalMarks ? `/ ${answerData.totalMarks}` : ""}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Questions and Answers */
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Detailed Review
          </h2>

          {exam.questions && exam.questions.length > 0 ? (
            exam.questions.map((q, idx) => {
              const studentAnswer = answerData.answers?.[q.id] || "";
              const optionBased = isOptionBasedQuestion(q);
              const isUnanswered = !studentAnswer || String(studentAnswer).trim() === "";
              // Exact-match grading only applies to option-based / single-value
              // answers — free-text (short/long/essay) answers are graded as a
              // whole exam, not per question, so "correct/wrong" there would be
              // fabricated. We only claim correctness where it's actually known.
              const isGradable = optionBased || (Array.isArray(q.correctAnswer) === false && !!q.correctAnswer);
              const isCorrect = isGradable && normalize(studentAnswer) === normalize(q.correctAnswer as string);
              // Marks obtained per question: only meaningful where correctness
              // is actually known (isGradable) — an unanswered question earns
              // nothing, a wrong one loses q.negativeMarks if the teacher set one.
              const marksObtained = !isGradable
                ? null
                : isCorrect
                ? q.marks
                : isUnanswered
                ? 0
                : -(q.negativeMarks || 0);

              return (
                <Card
                  key={q.id}
                  className={`overflow-hidden border-l-4 ${
                    !isGradable ? "border-l-blue-400" : isCorrect ? "border-l-emerald-500" : isUnanswered ? "border-l-gray-300" : "border-l-red-500"
                  }`}
                >
                  <CardHeader className="bg-gray-50/50 pb-3">
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="outline" className="font-semibold">Question {idx + 1}</Badge>
                          <Badge className="bg-slate-100 text-slate-600 border-slate-200 capitalize">{q.type}</Badge>
                          <span className="text-xs font-medium text-gray-500">
                            {q.marks} Marks{q.negativeMarks ? ` (−${q.negativeMarks} if wrong)` : ""}
                          </span>
                        </div>
                        <p className="text-gray-900 font-medium text-lg leading-relaxed">{q.text}</p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {!isGradable ? (
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 flex items-center gap-1">
                            <FileText className="w-3 h-3" /> Manually Graded
                          </Badge>
                        ) : isCorrect ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Correct
                          </Badge>
                        ) : isUnanswered ? (
                          <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Unanswered
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-200 border-red-200 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Incorrect
                          </Badge>
                        )}
                        {marksObtained !== null && (
                          <span className={`text-xs font-bold ${marksObtained > 0 ? "text-emerald-700" : marksObtained < 0 ? "text-red-700" : "text-gray-500"}`}>
                            {marksObtained > 0 ? "+" : ""}
                            {marksObtained} marks
                          </span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">

                    {/* Option-based (MCQ / true-false / any future options type) */}
                    {optionBased && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        {q.options!.map((opt, i) => {
                          const isSelected = normalize(studentAnswer) === normalize(opt);
                          const isActualCorrect = normalize(q.correctAnswer as string) === normalize(opt);

                          let bgClass = "bg-gray-50 border-gray-200 text-gray-700";
                          let icon = null;

                          if (isSelected && isActualCorrect) {
                            bgClass = "bg-emerald-50 border-emerald-500 text-emerald-900 font-medium shadow-sm";
                            icon = <CheckCircle className="w-4 h-4 text-emerald-600" />;
                          } else if (isSelected && !isActualCorrect) {
                            bgClass = "bg-red-50 border-red-300 text-red-900 font-medium";
                            icon = <XCircle className="w-4 h-4 text-red-500" />;
                          } else if (!isSelected && isActualCorrect) {
                            bgClass = "bg-emerald-50/50 border-emerald-300 border-dashed text-emerald-800";
                            icon = <CheckCircle className="w-4 h-4 text-emerald-500 opacity-60" />;
                          }

                          return (
                            <div key={i} className={`p-3 rounded-lg border flex items-center justify-between ${bgClass} transition-colors`}>
                              <span className="text-sm">{opt}</span>
                              {icon}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Free-text: short answer / long answer / essay / descriptive / code */}
                    {!optionBased && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                        <div className={`p-4 rounded-lg border ${!isGradable ? "bg-gray-50 border-gray-200" : isCorrect ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Student&apos;s Answer</p>
                          <p className={`font-medium whitespace-pre-wrap ${!studentAnswer ? "text-gray-400 italic" : "text-gray-900"}`}>
                            {studentAnswer || "No answer provided"}
                          </p>
                        </div>

                        <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">
                            {isGradable ? "Correct Answer" : "Model Answer"}
                          </p>
                          <p className="font-medium text-blue-900 whitespace-pre-wrap">
                            {q.correctAnswer || "Not provided by teacher"}
                          </p>
                        </div>
                      </div>
                    )}

                    {q.explanation && (
                      <div className="p-3 rounded-lg border bg-amber-50 border-amber-200 flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Explanation</p>
                          <p className="text-sm text-amber-900 whitespace-pre-wrap">{q.explanation}</p>
                        </div>
                      </div>
                    )}

                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="text-center py-12 text-gray-500">
                <Monitor className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                <p>No question details available for this exam.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
