"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Bot,
  Copy,
  Eye,
  BarChart,
  Loader2,
  Download,
  RefreshCcw,
  Clock,
  Filter,
  Search,
  Sparkles
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getSimilarityLevel, getSimilarityColor, performSimilarityCheck } from "@/lib/utils/similarity";
import { analyzeSubmittedAnswer, requestAiEvaluation } from "@/lib/utils/ai-client";
import { authedFetch } from "@/lib/utils/api-client";
import AiEvaluationPanel from "@/components/AiEvaluationPanel";
import { authorshipLabel } from "@/lib/server/ai-evaluation";
import { formatDate } from "@/lib/utils/helpers";
import { getQuestionsByExam, getExamsByTeacher, getAnswersByTeacher } from "@/lib/firebase/exams";
import ManualEvaluationPanel from "@/components/ManualEvaluationPanel";
import type { AiEvaluation, AuthorshipEstimate, Exam, TeacherOverride } from "@/lib/types";

interface Answer {
  id: string;
  examId: string;
  sessionId: string;
  studentId: string;
  studentName?: string;
  studentCode?: string;
  studentEmail?: string;
  courseId?: string;
  courseName?: string;
  batch?: string;
  section?: string;
  examTitle?: string;
  submittedAt: any;
  autoSubmitted: boolean;
  behaviorScore?: number;
  warningCount?: number;
  flagged?: boolean;
  flagReasons?: string[];
  reason?: string;
  answerFiles?: Array<{
    name: string;
    url?: string;
    downloadURL: string;
    type: string;
  }>;
  grading?: {
    correctAnswers: number;
    wrongAnswers: number;
    attemptedAnswers: number;
    totalQuestions: number;
    accuracy: number;
    obtainedMarks: number;
    totalMarks: number;
  };
  accuracy?: number;
  score?: number;
  totalMarks?: number;
  ocrAnalysis?: {
    extractedText?: string;
    wordCount?: number;
    aiDetection?: {
      isAIGenerated: boolean;
      confidence: number;
      indicators: string[];
    };
    error?: string;
    analyzedAt?: string;
  };
  ocrText?: string;
  ocrStatus?: string;
  /** The AI's own marking. Never modified by a teacher override. */
  aiEvaluation?: AiEvaluation;
  aiEvaluationStatus?: string;
  /**
   * Human/AI authorship estimate. Kept entirely separate from `ocrAnalysis` —
   * a successful text extraction says nothing about who wrote the text.
   */
  authorship?: AuthorshipEstimate & { analyzedAt?: string };
  teacherOverride?: TeacherOverride;
  finalMarks?: number;
  finalTotalMarks?: number;
  finalPercentage?: number;
  finalMarksSource?: "teacher" | "ai" | "auto";
  answers?: Record<string, string>;
  similarityScore?: number;
  similarityMatches?: Array<{
    studentId: string;
    studentName?: string;
    score: number;
  }>;
}

interface StudentInfo {
  id: string;
  name: string;
  email: string;
  studentCode?: string;
  department?: string;
  batch?: string;
  section?: string;
}

/** A submission the AI has not successfully marked yet. */
function needsAiEvaluation(answer: Answer): boolean {
  const hasScript = Boolean(answer.answerFiles && answer.answerFiles.length > 0);
  const hasTypedAnswers = Boolean(answer.answers && Object.keys(answer.answers).length > 0);
  if (!hasScript && !hasTypedAnswers) return false;
  const status = answer.aiEvaluation?.status ?? answer.aiEvaluationStatus;
  return status !== "completed" && status !== "needs_review" && status !== "processing";
}

function AnswerReviewContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const examIdParam = searchParams.get("examId");

  const [exam, setExam] = useState<Exam | null>(null);
  const [examsList, setExamsList] = useState<Exam[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [evalBatchProgress, setEvalBatchProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [savingQuestionMarks, setSavingQuestionMarks] = useState(false);

  /**
   * Open an answer's detail panel, pulling its similarity match list from
   * `similarityReports`.
   *
   * The matches are deliberately NOT stored on the answer document: a student
   * can read their own answer, and the list names the classmates their work
   * resembled. The report is staff-read-only, so it is fetched here instead.
   */
  const selectAnswer = async (answer: Answer) => {
    setSelectedAnswer(answer);
    if (!answer.id) return;
    try {
      const reportSnap = await getDoc(doc(db, "similarityReports", answer.id));
      if (!reportSnap.exists()) return;
      const report = reportSnap.data() as any;
      const matches = Array.isArray(report.matches) ? report.matches : [];
      setSelectedAnswer((prev) =>
        prev && prev.id === answer.id
          ? {
              ...prev,
              similarityScore: report.score ?? prev.similarityScore,
              similarityMatches: matches
                .filter((m: any) => m.sourceType === "student")
                .map((m: any) => ({
                  studentId: m.sourceId || "",
                  studentName: m.sourceName || "",
                  score: m.matchPercentage,
                })),
            }
          : prev
      );
    } catch (e) {
      // A missing or unreadable report just means "no breakdown to show".
      console.warn("Could not load similarity report:", e);
    }
  };

  // Filters
  const [selectedCourse, setSelectedCourse] = useState<string>("all");
  const [selectedBatch, setSelectedBatch] = useState<string>("all");
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [selectedExamId, setSelectedExamId] = useState<string>(examIdParam || "all");
  const [selectedDateRange, setSelectedDateRange] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  useEffect(() => {
    if (user) {
      loadSubmissionsData();
    }
  }, [user, examIdParam]);

  const loadSubmissionsData = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch teacher exams
      const teacherExams = await getExamsByTeacher(user.id);
      setExamsList(teacherExams);

      const examsMap = new Map<string, Exam>();
      teacherExams.forEach((e) => examsMap.set(e.id, e));

      // 2. Fetch specific exam if examIdParam provided
      if (examIdParam) {
        const singleExam = teacherExams.find((e) => e.id === examIdParam);
        if (singleExam) {
          if ((!singleExam.questions || singleExam.questions.length === 0) && singleExam.examMode === "online") {
            try {
              const qData = await getQuestionsByExam(singleExam.id);
              singleExam.questions = qData;
            } catch (err) {
              console.warn("Failed to load questions for exam:", err);
            }
          }
          setExam(singleExam);
          setSelectedExamId(singleExam.id);
        }
      }

      // 3. Fetch Answers
      let fetchedAnswers: Answer[] = [];
      if (examIdParam) {
        const answersQuery = query(collection(db, "answers"), where("examId", "==", examIdParam));
        const snapshot = await getDocs(answersQuery);
        fetchedAnswers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Answer[];
      } else {
        fetchedAnswers = (await getAnswersByTeacher(user.id)) as Answer[];
        // Fallback: If no answers documents found, load from examSessions for teacher's exams
        if (fetchedAnswers.length === 0 && teacherExams.length > 0) {
          const examIds = teacherExams.map((e) => e.id);
          for (let i = 0; i < examIds.length; i += 30) {
            const chunk = examIds.slice(i, i + 30);
            const q = query(
              collection(db, "examSessions"),
              where("examId", "in", chunk)
            );
            const sSnapshot = await getDocs(q);
            sSnapshot.docs.forEach((docSnap) => {
              const sData = docSnap.data();
              const isSubmitted =
                sData.submitted === true ||
                sData.status === "submitted" ||
                sData.status === "auto-submitted" ||
                sData.status === "completed";

              if (!isSubmitted) return;
              fetchedAnswers.push({
                id: docSnap.id,
                sessionId: docSnap.id,
                examId: sData.examId,
                studentId: sData.studentId,
                studentName: sData.studentName,
                studentCode: sData.studentCode,
                courseId: sData.courseId,
                courseName: sData.courseName,
                batch: sData.batch,
                section: sData.section,
                examTitle: sData.examTitle,
                submittedAt: sData.completedAt || sData.createdAt,
                autoSubmitted: !!sData.autoSubmitted,
                behaviorScore: sData.behaviorScore,
                warningCount: sData.warnings,
                score: sData.score,
                totalMarks: sData.totalMarks,
                accuracy: sData.accuracy,
                grading: sData.grading || (sData.score !== undefined ? {
                  obtainedMarks: sData.score,
                  totalMarks: sData.totalMarks || 100,
                  accuracy: sData.accuracy || 0,
                  correctAnswers: sData.correctAnswers || 0,
                  wrongAnswers: sData.wrongAnswers || 0,
                  attemptedAnswers: sData.attemptedAnswers || 0,
                  totalQuestions: sData.totalQuestions || 0,
                } : undefined),
              } as Answer);
            });
          }
        }
      }

      // 4. Resolve Student details for student IDs
      const studentIds = [...new Set(fetchedAnswers.map((a) => a.studentId).filter(Boolean))];
      const sMap = new Map<string, StudentInfo>();

      // One round trip per student, but issued together — sequentially awaiting
      // these made the page take seconds to open on a real class.
      await Promise.all(
        studentIds.map(async (sId) => {
          try {
            const sDoc = await getDoc(doc(db, "users", sId));
            if (sDoc.exists()) {
              const data = sDoc.data();
              sMap.set(sId, {
                id: sId,
                name: data.name || "Unknown Student",
                email: data.email || "",
                studentCode: data.studentCode || sId.substring(0, 8),
                department: data.department || "",
                batch: data.batch || "",
                section: data.section || (data.sections?.[0] ?? ""),
              });
            }
          } catch (e) {
            console.error("Error fetching student record:", e);
          }
        })
      );

      // Enriched answers with exam & student info fallback
      const enrichedAnswers = fetchedAnswers.map((a) => {
        const studentInfo = sMap.get(a.studentId);
        const examInfo = examsMap.get(a.examId);

        return {
          ...a,
          studentName: a.studentName || studentInfo?.name || "Student",
          studentCode: a.studentCode || studentInfo?.studentCode || a.studentId.substring(0, 8),
          courseId: a.courseId || examInfo?.courseId || "",
          courseName: a.courseName || examInfo?.courseName || "",
          batch: a.batch || studentInfo?.batch || examInfo?.batch || "",
          section: a.section || studentInfo?.section || examInfo?.section || "",
          examTitle: a.examTitle || examInfo?.title || "Exam",
        };
      });

      // Sort by submittedAt desc
      enrichedAnswers.sort((a, b) => {
        const timeA = a.submittedAt?.toDate?.()?.getTime?.() || new Date(a.submittedAt || 0).getTime();
        const timeB = b.submittedAt?.toDate?.()?.getTime?.() || new Date(b.submittedAt || 0).getTime();
        return timeB - timeA;
      });

      setAnswers(enrichedAnswers);
    } catch (err) {
      console.error("Error loading submissions data:", err);
      setError("Could not load submissions. Check your connection and try again.");
      toast({ title: "Error", description: "Failed to load submissions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const runOCRAnalysis = async (
    answer: Answer,
    options: { silent?: boolean } = {}
  ): Promise<boolean> => {
    if (!answer.answerFiles || answer.answerFiles.length === 0) {
      toast({ title: "Error", description: "No files to analyze", variant: "destructive" });
      return false;
    }

    setAnalyzing(answer.id);
    try {
      // Analyze all uploaded files using Gemini 2.5 Flash
      const analysis = await analyzeSubmittedAnswer(answer.answerFiles);

      const ocrAnalysisData = {
        extractedText: analysis.extractedText,
        wordCount: analysis.wordCount,
        modelUsed: analysis.modelUsed || "gemini-2.5-flash",
        aiDetection: analysis.aiDetection,
        fileAnalyses: analysis.fileAnalyses,
        errors: analysis.errors,
        analyzedAt: new Date().toISOString(),
      };

      // Update answer document in Firestore
      await updateDoc(doc(db, "answers", answer.id), {
        ocrAnalysis: ocrAnalysisData,
        ocrText: analysis.extractedText,
      });

      // Run cross-student similarity check automatically
      if (answer.examId && answer.studentId && analysis.extractedText.trim().length > 20) {
        await performSimilarityCheck(answer.id, answer.examId, answer.studentId, analysis.extractedText);
      }

      // Update local state
      setAnswers((prev) =>
        prev.map((a) =>
          a.id === answer.id
            ? { ...a, ocrAnalysis: ocrAnalysisData, ocrText: analysis.extractedText }
            : a
        )
      );

      if (selectedAnswer?.id === answer.id) {
        setSelectedAnswer((prev) =>
          prev ? { ...prev, ocrAnalysis: ocrAnalysisData, ocrText: analysis.extractedText } : null
        );
      }

      if (!options.silent) {
        toast({ title: "Analysis Complete", description: "OCR and similarity check finished." });
      }
      return true;
    } catch (error: any) {
      console.error("OCR analysis error:", error);
      if (!options.silent) {
        toast({
          title: "Analysis Failed",
          description: error.message || "Analysis failed",
          variant: "destructive",
        });
      }
      return false;
    } finally {
      setAnalyzing(null);
    }
  };

  const runBatchOCRAnalysis = async () => {
    // Re-entrancy guard: the button used to stay live during a run, so a second
    // click started a parallel pass over the same submissions — doubling the
    // billable Gemini calls and racing two writes onto the same document.
    if (batchProgress || analyzing) return;

    const unanalyzed = filteredAnswers.filter(
      (a) => a.answerFiles && a.answerFiles.length > 0 && !a.ocrAnalysis?.extractedText
    );
    if (unanalyzed.length === 0) {
      toast({
        title: "Nothing to process",
        description: "Every uploaded submission in view has already been analyzed.",
      });
      return;
    }

    setBatchProgress({ done: 0, total: unanalyzed.length });
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < unanalyzed.length; i++) {
      const ok = await runOCRAnalysis(unanalyzed[i], { silent: true });
      if (ok) succeeded++;
      else failed++;
      setBatchProgress({ done: i + 1, total: unanalyzed.length });
    }

    setBatchProgress(null);
    toast({
      title: failed === 0 ? "Batch Completed" : "Batch Finished With Errors",
      description:
        failed === 0
          ? `Analyzed ${succeeded} submission${succeeded !== 1 ? "s" : ""}.`
          : `Analyzed ${succeeded}, failed ${failed}. Re-run OCR on the failed rows individually to see why.`,
      variant: failed === 0 ? undefined : "destructive",
    });
  };

  /** Merge a patch into both the list and the open detail modal. */
  const patchAnswer = (answerId: string, patch: Partial<Answer>) => {
    setAnswers((prev) =>
      prev.map((item) => (item.id === answerId ? ({ ...item, ...patch } as Answer) : item))
    );
    setSelectedAnswer((prev) =>
      prev && prev.id === answerId ? ({ ...prev, ...patch } as Answer) : prev
    );
  };

  /**
   * Re-read the submission after the server has written an evaluation.
   *
   * The evaluation is written by the Admin SDK, so nothing in this page's state
   * knows about it. Reading the document back is simpler — and less likely to
   * drift from what is stored — than trying to reconstruct the write locally.
   */
  const refreshAnswer = async (answerId: string) => {
    try {
      const snap = await getDoc(doc(db, "answers", answerId));
      if (!snap.exists()) return;
      patchAnswer(answerId, { id: snap.id, ...snap.data() } as Answer);
    } catch (error) {
      console.warn("Could not refresh the submission after evaluation:", error);
    }
  };

  /**
   * Run (or re-run) the AI evaluation for one submission.
   *
   * Evaluation normally starts automatically at submit time; this covers the
   * failed/needs-review retry and any submission that predates the feature.
   */
  const runAiEvaluationFor = async (
    answer: Answer,
    options: { silent?: boolean; force?: boolean } = {}
  ): Promise<boolean> => {
    setEvaluating(answer.id);
    try {
      const result = await requestAiEvaluation(answer.id, { force: options.force ?? true });
      await refreshAnswer(answer.id);

      if (!options.silent) {
        if (result.status === "completed") {
          toast({ title: "AI evaluation complete", description: "Marks and feedback are ready." });
        } else if (result.status === "needs_review") {
          toast({
            title: "Needs review",
            description: result.reason || "The evaluation finished but flagged something for you.",
          });
        } else if (result.status === "skipped") {
          toast({ title: "Nothing to do", description: result.reason || "Already evaluated." });
        } else {
          toast({
            title: "Evaluation failed",
            description: result.reason || "No marks were recorded.",
            variant: "destructive",
          });
        }
      }
      return result.status === "completed" || result.status === "needs_review";
    } catch (error: any) {
      if (!options.silent) {
        toast({
          title: "Evaluation failed",
          description: error?.message || "The AI evaluation could not be run.",
          variant: "destructive",
        });
      }
      return false;
    } finally {
      setEvaluating(null);
    }
  };

  const runBatchAiEvaluation = async () => {
    if (evalBatchProgress || evaluating) return;

    const pending = filteredAnswers.filter((a) => needsAiEvaluation(a));
    if (pending.length === 0) {
      toast({
        title: "Nothing to evaluate",
        description: "Every submission in view has already been evaluated.",
      });
      return;
    }

    setEvalBatchProgress({ done: 0, total: pending.length });
    let succeeded = 0;
    for (let i = 0; i < pending.length; i++) {
      // Sequential on purpose: each evaluation is a multi-page vision call, and
      // firing a class of them at once would trip the per-user rate limit.
      const ok = await runAiEvaluationFor(pending[i], { silent: true, force: true });
      if (ok) succeeded++;
      setEvalBatchProgress({ done: i + 1, total: pending.length });
    }
    setEvalBatchProgress(null);

    toast({
      title: succeeded === pending.length ? "Batch evaluation complete" : "Batch finished with errors",
      description: `Evaluated ${succeeded} of ${pending.length}. Failed ones keep a Failed status — nothing was marked by guesswork.`,
      variant: succeeded === pending.length ? undefined : "destructive",
    });
  };

  /** Teacher override of individual question marks, saved as one override. */
  const saveQuestionMarks = async (
    answer: Answer,
    marks: Array<{ questionId: string; marks: number }>
  ) => {
    setSavingQuestionMarks(true);
    try {
      await authedFetch("/api/exams/evaluate", {
        method: "POST",
        body: { answerId: answer.id, questionMarks: marks },
        fallbackError: "Could not save the question marks.",
      });
      await refreshAnswer(answer.id);
      toast({
        title: "Question marks saved",
        description: "The student's final mark has been updated. The AI evaluation is unchanged.",
      });
    } catch (error: any) {
      toast({
        title: "Could not save",
        description: error?.message || "The question marks were not saved.",
        variant: "destructive",
      });
    } finally {
      setSavingQuestionMarks(false);
    }
  };

  /**
   * Text-extraction status ONLY.
   *
   * This badge used to read "Human Verified" whenever OCR succeeded and the
   * detector did not raise a flag, which conflated three unrelated things: that
   * the file could be read, that the text was checked, and that a person wrote
   * it. A successful OCR pass is evidence of none of those beyond the first.
   * Authorship now has its own badge, from its own analysis.
   */
  const getOCRBadge = (answer: Answer) => {
    if (!answer.answerFiles || answer.answerFiles.length === 0) {
      return <Badge variant="outline" className="bg-gray-50 text-gray-600">Online Mode</Badge>;
    }
    if (answer.ocrAnalysis?.error || answer.ocrStatus === "failed") {
      return <Badge variant="destructive">Text Extraction Failed</Badge>;
    }
    if (answer.ocrAnalysis?.extractedText) {
      return (
        <Badge variant="secondary" className="bg-blue-50 text-blue-700">
          Text Extracted ({answer.ocrAnalysis.wordCount ?? 0} words)
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
        Text Not Extracted
      </Badge>
    );
  };

  /** AI marking status — independent of OCR and of authorship. */
  const getEvaluationBadge = (answer: Answer) => {
    const status = answer.aiEvaluation?.status ?? answer.aiEvaluationStatus;
    switch (status) {
      case "queued":
      case "processing":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            AI Evaluating
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
            <CheckCircle className="h-3 w-3" />
            AI Evaluated
          </Badge>
        );
      case "needs_review":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 gap-1">
            <AlertTriangle className="h-3 w-3" />
            Needs Review
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Evaluation Failed
          </Badge>
        );
      default:
        return null;
    }
  };

  /**
   * Authorship estimate — a probabilistic signal about who wrote the script,
   * shown next to the marks but never part of them.
   */
  const getAuthorshipBadge = (answer: Answer) => {
    const authorship = answer.authorship;
    if (!authorship) return null;
    const className =
      authorship.status === "likely_ai"
        ? "bg-red-50 text-red-700 border-red-200"
        : authorship.status === "likely_human"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-amber-50 text-amber-800 border-amber-200";
    return (
      <Badge variant="outline" className={`${className} gap-1`}>
        <Bot className="h-3 w-3" />
        {authorshipLabel(authorship.status)} · {authorship.humanPercent}% human /{" "}
        {authorship.aiPercent}% AI
      </Badge>
    );
  };

  // Filter options are derived from the submissions themselves. They used to
  // come from the hardcoded DEFAULT_* catalog, whose course ids never match the
  // Firestore course documents these records reference — selecting any course
  // silently emptied the list.
  const courseOptions = useMemo(() => {
    const byId = new Map<string, string>();
    answers.forEach((a) => {
      if (a.courseId) byId.set(a.courseId, a.courseName || a.courseId);
    });
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [answers]);

  const batchOptions = useMemo(
    () => Array.from(new Set(answers.map((a) => a.batch).filter(Boolean) as string[])).sort(),
    [answers]
  );

  const sectionOptions = useMemo(
    () => Array.from(new Set(answers.map((a) => a.section).filter(Boolean) as string[])).sort(),
    [answers]
  );

  // Dynamic Filtering Logic
  const filteredAnswers = answers.filter((a) => {
    // Course Filter
    if (selectedCourse !== "all" && a.courseId !== selectedCourse) {
      return false;
    }
    // Batch Filter
    if (selectedBatch !== "all" && a.batch !== selectedBatch) {
      return false;
    }
    // Section Filter
    if (selectedSection !== "all" && a.section !== selectedSection) {
      return false;
    }
    // Exam Filter
    if (selectedExamId !== "all" && a.examId !== selectedExamId) {
      return false;
    }
    // Date Range Filter
    if (selectedDateRange !== "all") {
      const subTime = a.submittedAt?.toDate?.()?.getTime?.() || new Date(a.submittedAt || 0).getTime();
      const now = Date.now();
      if (selectedDateRange === "today") {
        const todayStart = new Date().setHours(0, 0, 0, 0);
        if (subTime < todayStart) return false;
      } else if (selectedDateRange === "7days") {
        if (subTime < now - 7 * 24 * 60 * 60 * 1000) return false;
      } else if (selectedDateRange === "30days") {
        if (subTime < now - 30 * 24 * 60 * 60 * 1000) return false;
      }
    }
    // Search Term (Student Name, Student Code, Exam Title)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const name = (a.studentName || "").toLowerCase();
      const code = (a.studentCode || "").toLowerCase();
      const title = (a.examTitle || "").toLowerCase();
      if (!name.includes(term) && !code.includes(term) && !title.includes(term)) {
        return false;
      }
    }
    return true;
  });

  const pendingOcrCount = filteredAnswers.filter(
    (a) => a.answerFiles && a.answerFiles.length > 0 && !a.ocrAnalysis?.extractedText
  ).length;

  const pendingEvalCount = filteredAnswers.filter((a) => needsAiEvaluation(a)).length;

  /**
   * Refresh while an evaluation is in flight.
   *
   * Evaluations start server-side at submit time, so a teacher watching this
   * page has no local signal when one lands. Polling only while something is
   * actually running keeps it to the moments it is useful.
   */
  const runningEvaluationIds = useMemo(
    () =>
      answers
        .filter(
          (a) => a.aiEvaluation?.status === "processing" || a.aiEvaluation?.status === "queued"
        )
        .map((a) => a.id),
    [answers]
  );

  useEffect(() => {
    if (runningEvaluationIds.length === 0 || batchProgress || evalBatchProgress) return;

    // Poll ONLY the submissions actually being evaluated.
    //
    // This used to call `loadSubmissionsData()`, which re-reads every exam the
    // teacher owns, every submission, and one user document per student — a
    // few hundred reads every 20 seconds, on a class where the answer was
    // "has one field on one document changed yet?". Refreshing just the
    // running rows keeps the cost proportional to what is actually in flight,
    // and `refreshAnswer` patches them in place so the table does not flicker.
    const timer = setInterval(() => {
      runningEvaluationIds.forEach((id) => {
        refreshAnswer(id).catch(() => {
          // A transient read failure just means we look again next tick.
        });
      });
    }, 20_000);
    return () => clearInterval(timer);
    // Joined rather than passed as an array: a new array identity every render
    // would tear down and restart the interval on each poll.
  }, [runningEvaluationIds.join(","), batchProgress, evalBatchProgress]);

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 text-emerald-600 animate-spin mb-4" />
          <p className="text-gray-600 font-medium">Loading Exam Submissions & OCR Data...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              {examIdParam && (
                <Link href="/dashboard/teacher/exams">
                  <Button variant="outline" size="sm">
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back to Exams
                  </Button>
                </Link>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Submissions & OCR Management
              </h1>
            </div>
            <p className="text-gray-600 mt-1">
              Review completed student exams, marks breakdown, and automated OCR analysis
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={runBatchOCRAnalysis}
              disabled={!!batchProgress || !!analyzing || pendingOcrCount === 0}
              className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
            >
              {batchProgress ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing {batchProgress.done}/{batchProgress.total}
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4 text-purple-600" />
                  Run OCR on {pendingOcrCount} Pending
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={runBatchAiEvaluation}
              disabled={!!evalBatchProgress || !!evaluating || pendingEvalCount === 0}
              className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              {evalBatchProgress ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Evaluating {evalBatchProgress.done}/{evalBatchProgress.total}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  AI Evaluate {pendingEvalCount} Pending
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={loadSubmissionsData}
              disabled={loading || !!batchProgress}
              className="gap-2"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh Results
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadSubmissionsData}>
              Retry
            </Button>
          </div>
        )}

        {/* Overview Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-emerald-600" />
                <div>
                  <p className="text-2xl font-bold">{filteredAnswers.length}</p>
                  <p className="text-sm text-gray-500">Submissions</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <BarChart className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold">
                    {filteredAnswers.length > 0
                      ? Math.round(
                          filteredAnswers.reduce(
                            (acc, a) => acc + (a.grading?.accuracy || a.accuracy || 0),
                            0
                          ) / filteredAnswers.length
                        )
                      : 0}
                    %
                  </p>
                  <p className="text-sm text-gray-500">Avg Accuracy</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Sparkles className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold">
                    {
                      filteredAnswers.filter(
                        (a) =>
                          a.aiEvaluation?.status === "completed" ||
                          a.aiEvaluation?.status === "needs_review"
                      ).length
                    }
                  </p>
                  <p className="text-sm text-gray-500">AI Evaluated</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-amber-600" />
                <div>
                  <p className="text-2xl font-bold">
                    {
                      filteredAnswers.filter(
                        (a) =>
                          a.flagged ||
                          a.authorship?.status === "likely_ai" ||
                          a.aiEvaluation?.status === "failed" ||
                          a.aiEvaluation?.status === "needs_review"
                      ).length
                    }
                  </p>
                  <p className="text-sm text-gray-500">Flagged Items</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Controls Card */}
        <Card className="bg-emerald-50/30 border-emerald-100 p-4">
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Filter className="h-4 w-4 text-emerald-700" />
                <span>Filter Submissions:</span>
                {(selectedCourse !== "all" ||
                  selectedBatch !== "all" ||
                  selectedSection !== "all" ||
                  selectedExamId !== "all" ||
                  selectedDateRange !== "all" ||
                  searchTerm) && (
                  <button
                    onClick={() => {
                      setSelectedCourse("all");
                      setSelectedBatch("all");
                      setSelectedSection("all");
                      setSelectedExamId("all");
                      setSelectedDateRange("all");
                      setSearchTerm("");
                    }}
                    className="text-xs text-emerald-700 underline font-medium hover:text-emerald-900"
                  >
                    Reset All Filters
                  </button>
                )}
              </div>

              {/* Search Bar */}
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search student or exam..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-md border border-gray-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Course Filter */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Course</label>
                <select
                  className="w-full h-9 px-2 rounded-md border border-gray-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value)}
                >
                  <option value="all">All Courses</option>
                  {courseOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Batch Filter */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Batch</label>
                <select
                  className="w-full h-9 px-2 rounded-md border border-gray-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedBatch}
                  onChange={(e) => setSelectedBatch(e.target.value)}
                >
                  <option value="all">All Batches</option>
                  {batchOptions.map((b) => (
                    <option key={b} value={b}>
                      Batch {b}
                    </option>
                  ))}
                </select>
              </div>

              {/* Section Filter */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Section</label>
                <select
                  className="w-full h-9 px-2 rounded-md border border-gray-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedSection}
                  onChange={(e) => setSelectedSection(e.target.value)}
                >
                  <option value="all">All Sections</option>
                  {sectionOptions.map((sec) => (
                    <option key={sec} value={sec}>
                      Section {sec}
                    </option>
                  ))}
                </select>
              </div>

              {/* Exam Filter */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Exam</label>
                <select
                  className="w-full h-9 px-2 rounded-md border border-gray-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                >
                  <option value="all">All Exams</option>
                  {examsList.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Filter */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Date</label>
                <select
                  className="w-full h-9 px-2 rounded-md border border-gray-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedDateRange}
                  onChange={(e) => setSelectedDateRange(e.target.value)}
                >
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="7days">Last 7 Days</option>
                  <option value="30days">Last 30 Days</option>
                </select>
              </div>
            </div>
          </div>
        </Card>

        {/* Submissions List */}
        {filteredAnswers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-gray-400 mb-3" />
              <h3 className="text-lg font-medium text-gray-900">No Submissions Found</h3>
              <p className="text-sm text-gray-500 mt-1">
                No exam submissions match your selected Course, Batch, Section, or Date filters.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredAnswers.map((answer) => {
              // The FINAL mark (teacher override -> AI -> answer key), not the
              // auto-grader's raw figure — that would show 0 for every
              // upload-mode script no matter what the AI or the teacher decided.
              const obtainedMarks =
                answer.finalMarks ?? answer.score ?? answer.grading?.obtainedMarks ?? 0;
              const totalMarks =
                answer.finalTotalMarks ?? answer.totalMarks ?? answer.grading?.totalMarks ?? 100;
              const accuracy = answer.finalPercentage ?? answer.accuracy ?? answer.grading?.accuracy ?? 0;
              const evaluationPending =
                answer.aiEvaluation?.status === "queued" ||
                answer.aiEvaluation?.status === "processing";

              return (
                <Card key={answer.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Student & Exam Metadata */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-900 text-lg">
                            {answer.studentName}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">
                            ID: {answer.studentCode}
                          </span>
                          {getOCRBadge(answer)}
                          {getEvaluationBadge(answer)}
                          {getAuthorshipBadge(answer)}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded">
                            {answer.examTitle}
                          </span>
                          {answer.courseName && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {answer.courseName}
                            </Badge>
                          )}
                          {answer.batch && (
                            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                              Batch {answer.batch}
                            </Badge>
                          )}
                          {answer.section && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                              Section {answer.section}
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Submitted: {answer.submittedAt ? formatDate(answer.submittedAt) : "N/A"}
                          </div>
                          {answer.autoSubmitted && (
                            <span className="text-amber-600 font-medium">Auto-Submitted</span>
                          )}
                        </div>
                      </div>

                      {/* Right: Marks & Action Controls */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-gray-50/80 p-3 rounded-lg border border-gray-100">
                        {/* Marks & Accuracy Block */}
                        <div className="text-left sm:text-right min-w-[120px]">
                          <p className="text-xs text-gray-500 font-medium">Final Marks</p>
                          {evaluationPending ? (
                            <p className="text-sm font-semibold text-blue-700 flex items-center gap-1.5 sm:justify-end">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Evaluating…
                            </p>
                          ) : (
                            <>
                              <p className="text-xl font-bold text-emerald-700">
                                {obtainedMarks} <span className="text-xs text-gray-400 font-normal">/ {totalMarks}</span>
                              </p>
                              <p className="text-xs text-gray-500">
                                {accuracy}%
                                {answer.finalMarksSource === "teacher"
                                  ? " · teacher override"
                                  : answer.finalMarksSource === "ai"
                                  ? " · AI evaluated"
                                  : ""}
                              </p>
                            </>
                          )}
                          {answer.aiEvaluation?.status === "completed" ||
                          answer.aiEvaluation?.status === "needs_review" ? (
                            <p className="text-[11px] text-gray-400">
                              AI: {answer.aiEvaluation.totalMarks} / {answer.aiEvaluation.maxMarks}
                            </p>
                          ) : null}
                        </div>

                        {/* OCR / Answer Actions */}
                        <div className="flex gap-2 w-full sm:w-auto">
                          {(answer.answerFiles?.length || answer.answers) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => runAiEvaluationFor(answer)}
                              disabled={!!evaluating || !!evalBatchProgress}
                              className="text-xs border-emerald-300 text-emerald-700"
                            >
                              {evaluating === answer.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                              )}
                              {answer.aiEvaluation?.status === "completed" ||
                              answer.aiEvaluation?.status === "needs_review"
                                ? "Re-Evaluate"
                                : "AI Evaluate"}
                            </Button>
                          )}

                          {answer.answerFiles && answer.answerFiles.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => runOCRAnalysis(answer)}
                              disabled={!!analyzing || !!batchProgress}
                              className="text-xs"
                            >
                              {analyzing === answer.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <Bot className="h-3.5 w-3.5 mr-1 text-purple-600" />
                              )}
                              {answer.ocrAnalysis?.extractedText ? "Re-Run OCR" : "Run OCR"}
                            </Button>
                          )}

                          <Button
                            size="sm"
                            onClick={() => selectAnswer(answer)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View Details
                          </Button>

                          {answer.sessionId && (
                            <Link href={`/dashboard/teacher/session-results?sessionId=${answer.sessionId}`}>
                              <Button size="sm" variant="outline" className="text-xs">
                                <FileText className="h-3.5 w-3.5 mr-1" />
                                Full Review
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Detailed Submission & OCR Inspection Modal */}
        {selectedAnswer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    Submission Details: {selectedAnswer.studentName}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {selectedAnswer.examTitle} | Student ID: {selectedAnswer.studentCode}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedAnswer(null)}>
                  ✕
                </Button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-6 overflow-y-auto flex-1">
                {/* Academic Metadata Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg bg-emerald-50/50 border border-emerald-100 text-xs">
                  <div>
                    <span className="text-gray-500">Course:</span>
                    <p className="font-semibold text-gray-900">{selectedAnswer.courseName || "—"}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Batch & Section:</span>
                    <p className="font-semibold text-gray-900">
                      Batch {selectedAnswer.batch || "—"} / Sec {selectedAnswer.section || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Final Marks:</span>
                    <p className="font-bold text-emerald-700 text-sm">
                      {selectedAnswer.finalMarks ?? selectedAnswer.score ?? 0} /{" "}
                      {selectedAnswer.finalTotalMarks ?? selectedAnswer.totalMarks ?? 100}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Submission Date:</span>
                    <p className="font-semibold text-gray-900">
                      {selectedAnswer.submittedAt ? formatDate(selectedAnswer.submittedAt) : "—"}
                    </p>
                  </div>
                </div>

                {/* AI evaluation: marks, question-wise reasoning, authorship.
                    Placed first because it is what produced the mark; the
                    manual panel below is the override on top of it. */}
                <AiEvaluationPanel
                  variant="teacher"
                  evaluation={selectedAnswer.aiEvaluation}
                  authorship={selectedAnswer.authorship}
                  teacherOverride={selectedAnswer.teacherOverride}
                  finalMarks={selectedAnswer.finalMarks ?? selectedAnswer.score ?? null}
                  finalTotalMarks={selectedAnswer.finalTotalMarks ?? selectedAnswer.totalMarks ?? null}
                  finalPercentage={selectedAnswer.finalPercentage ?? selectedAnswer.accuracy ?? null}
                  finalMarksSource={selectedAnswer.finalMarksSource ?? null}
                  rerunning={evaluating === selectedAnswer.id}
                  onRerun={async () => {
                    await runAiEvaluationFor(selectedAnswer, { force: true });
                  }}
                  savingQuestionMarks={savingQuestionMarks}
                  onSaveQuestionMarks={(marks) => saveQuestionMarks(selectedAnswer, marks)}
                />

                {/* Manual evaluation.
                    Placed above the tabs because for an upload-mode script it
                    is the ONLY thing that produces a mark — auto-grading has
                    no answer key to work from there, so without this the
                    student stays at 0 forever. */}
                <ManualEvaluationPanel
                  answer={selectedAnswer as any}
                  key={`${selectedAnswer.id}-${selectedAnswer.finalMarks ?? ""}-${
                    selectedAnswer.aiEvaluation?.totalMarks ?? ""
                  }`}
                  questionContext={
                    exam
                      ? `Exam: ${exam.title}. ${exam.description || ""} Total marks: ${
                          selectedAnswer.grading?.totalMarks ?? selectedAnswer.totalMarks ?? exam.totalMarks ?? 100
                        }.`
                      : undefined
                  }
                  onEvaluated={(result) => {
                    // Reflect the new mark immediately in both the open modal
                    // and the list behind it, rather than making the teacher
                    // reload to see the mark they just entered.
                    const patch = {
                      score: result.marks,
                      totalMarks: result.totalMarks,
                      accuracy: result.accuracy,
                      teacherFeedback: result.feedback,
                      grading: {
                        ...(selectedAnswer.grading || ({} as any)),
                        obtainedMarks: result.marks,
                        totalMarks: result.totalMarks,
                        accuracy: result.accuracy,
                      },
                      evaluation: {
                        marks: result.marks,
                        feedback: result.feedback,
                        evaluatedByName: result.evaluatedByName,
                        method: "manual",
                      },
                    };
                    setSelectedAnswer((prev) => (prev ? ({ ...prev, ...patch } as any) : prev));
                    setAnswers((prev) =>
                      prev.map((item) => (item.id === selectedAnswer.id ? ({ ...item, ...patch } as any) : item))
                    );
                  }}
                />

                {/* Tabs for Overview, Answers, OCR Analysis, and Plagiarism Check */}
                <Tabs defaultValue="ocr" className="w-full">
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="ocr">OCR & File Evaluation</TabsTrigger>
                    <TabsTrigger value="plagiarism">Plagiarism & Cross-Student Match</TabsTrigger>
                    <TabsTrigger value="answers">Submitted Online Answers</TabsTrigger>
                  </TabsList>

                  {/* OCR Content Tab */}
                  <TabsContent value="ocr" className="mt-4 space-y-4">
                    {selectedAnswer.answerFiles && selectedAnswer.answerFiles.length > 0 ? (
                      <div className="space-y-4">
                        {/* Files Download */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-800 mb-2">Uploaded Answer Files</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedAnswer.answerFiles.map((file, idx) => (
                              <a
                                key={idx}
                                href={file.downloadURL || file.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 px-3 py-2 rounded border bg-white hover:bg-gray-50 text-xs font-medium text-blue-600"
                              >
                                <FileText className="h-4 w-4 text-blue-500" />
                                {file.name || `File ${idx + 1}`}
                                <Download className="h-3.5 w-3.5 text-gray-400" />
                              </a>
                            ))}
                          </div>
                        </div>

                        {/* OCR Analysis Details */}
                        {selectedAnswer.ocrAnalysis ? (
                          <div className="space-y-4 pt-2">
                            {/*
                              The old "AI Content Analysis / Human Written"
                              card lived here, drawing a verdict on authorship
                              out of the OCR pass. The two are now separate:
                              this tab reports what was READ from the files,
                              and the authorship estimate has its own panel
                              above, produced by its own analysis.
                            */}
                            <div className="rounded-lg border bg-gray-50 p-3 text-xs text-gray-600">
                              Text extraction only. Whether a person or an AI wrote this script is
                              estimated separately in the AI Evaluation panel above — a successful
                              extraction is not evidence either way.
                            </div>

                            {/* Extracted Text */}
                            <div>
                              <h4 className="text-sm font-semibold text-gray-800 mb-2">OCR Extracted Text</h4>
                              <div className="p-4 rounded-lg bg-gray-900 text-gray-100 font-mono text-xs max-h-60 overflow-y-auto whitespace-pre-wrap">
                                {selectedAnswer.ocrAnalysis.extractedText || "No text extracted yet."}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-6 border rounded-lg bg-gray-50">
                            <p className="text-xs text-gray-500 mb-3">No OCR evaluation run for these files yet.</p>
                            <Button
                              size="sm"
                              onClick={() => runOCRAnalysis(selectedAnswer)}
                              disabled={analyzing === selectedAnswer.id}
                            >
                              {analyzing === selectedAnswer.id ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                <Bot className="h-4 w-4 mr-2" />
                              )}
                              Trigger OCR Analysis
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 py-4 text-center">
                        No external files were uploaded for this online submission.
                      </p>
                    )}
                  </TabsContent>

                  {/* Plagiarism & Similarity Tab */}
                  <TabsContent value="plagiarism" className="mt-4 space-y-4">
                    <div className="space-y-4">
                      {/* Overall Similarity Summary */}
                      <Card className="border-amber-200 bg-amber-50/20">
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-semibold text-xs text-gray-900 flex items-center gap-1.5">
                                <Copy className="h-4 w-4 text-amber-600" /> Cross-Student Plagiarism Score
                              </h4>
                              <p className="text-xs text-gray-500 mt-0.5">
                                Evaluated against all student submissions for exam: <strong>{selectedAnswer.examTitle}</strong>
                              </p>
                            </div>
                            {(() => {
                              const score = selectedAnswer.similarityScore ?? 0;
                              const level = getSimilarityLevel(score);
                              const color = getSimilarityColor(level);
                              return (
                                <Badge className={`${color.bg} ${color.text} ${color.border} border text-xs px-2.5 py-1 font-bold`}>
                                  {score}% Similarity ({level.toUpperCase()})
                                </Badge>
                              );
                            })()}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Matching Students Breakdown */}
                      {selectedAnswer.similarityMatches && selectedAnswer.similarityMatches.length > 0 ? (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-gray-800">Matching Student Scripts</h4>
                          {selectedAnswer.similarityMatches.map((match, mIdx) => (
                            <div key={mIdx} className="p-3 border rounded-lg bg-white flex items-center justify-between text-xs">
                              <div>
                                <p className="font-bold text-gray-900">{match.studentName || "Another Student"}</p>
                                <p className="text-[11px] text-gray-500">Student ID: {match.studentId}</p>
                              </div>
                              <Badge variant={match.score >= 70 ? "destructive" : "secondary"}>
                                {match.score}% Match
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 border rounded-lg bg-gray-50 text-center text-xs text-gray-600">
                          {selectedAnswer.ocrText || (selectedAnswer.answers && Object.keys(selectedAnswer.answers).length > 0) ? (
                            <p>No high-risk plagiarism matches detected against other students for this exam.</p>
                          ) : (
                            <p>Run OCR or upload answers first to check cross-student similarity.</p>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 text-xs gap-1.5"
                            onClick={async () => {
                              const text = selectedAnswer.ocrText || (selectedAnswer.answers ? Object.values(selectedAnswer.answers).join(" ") : "");
                              if (text.trim().length > 20) {
                                toast({ title: "Checking Plagiarism...", description: "Comparing script against all students" });
                                const res = await performSimilarityCheck(selectedAnswer.id, selectedAnswer.examId, selectedAnswer.studentId, text);
                                setSelectedAnswer(prev => prev ? {
                                  ...prev,
                                  similarityScore: res.score,
                                  // The AI-authorship signal is reported in its
                                  // own panel; only peer matches belong in the
                                  // "Matching Student Scripts" list.
                                  similarityMatches: res.matches
                                    .filter(m => m.sourceType === "student")
                                    .map(m => ({
                                      studentId: m.sourceId || "",
                                      studentName: m.sourceName,
                                      score: m.matchPercentage
                                    }))
                                } : null);
                                toast({ title: "Check Completed", description: `Plagiarism Score: ${res.score}%` });
                              } else {
                                toast({ title: "Notice", description: "Insufficient text length to perform similarity check", variant: "destructive" });
                              }
                            }}
                          >
                            <RefreshCcw className="h-3.5 w-3.5" /> Re-Check Similarity Now
                          </Button>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Submitted Online Answers Tab */}
                  <TabsContent value="answers" className="mt-4 space-y-3">
                    {selectedAnswer.answers && Object.keys(selectedAnswer.answers).length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(selectedAnswer.answers).map(([qId, ansVal], index) => (
                          <div key={qId} className="p-3 border rounded-lg bg-gray-50 text-xs">
                            <p className="font-semibold text-gray-700">Question #{index + 1}</p>
                            <p className="mt-1 text-gray-900 bg-white p-2 rounded border">
                              {String(ansVal)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 py-4 text-center">
                        No online form responses recorded. Check OCR tab for uploaded files.
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
                <Button variant="outline" onClick={() => setSelectedAnswer(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function TeacherAnswersPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout role="teacher">
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
          </div>
        </DashboardLayout>
      }
    >
      <AnswerReviewContent />
    </Suspense>
  );
}
