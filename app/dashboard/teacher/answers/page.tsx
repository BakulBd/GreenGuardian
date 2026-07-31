"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bot,
  Copy,
  Users,
  Eye,
  BarChart,
  Loader2,
  Download,
  RefreshCcw,
  Calendar,
  Clock,
  Filter,
  Check,
  Search
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getSimilarityLevel, getSimilarityColor, SIMILARITY_THRESHOLDS } from "@/lib/utils/similarity";
import { analyzeSubmittedAnswer } from "@/lib/utils/gemini";
import { formatDate } from "@/lib/utils/helpers";
import { getQuestionsByExam, getExamsByTeacher, getAnswersByTeacher } from "@/lib/firebase/exams";
import { DEFAULT_COURSES, DEFAULT_BATCHES, DEFAULT_SECTIONS } from "@/lib/academics/catalog";
import { Exam } from "@/lib/types";

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

function AnswerReviewContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const examIdParam = searchParams.get("examId");

  const [exam, setExam] = useState<Exam | null>(null);
  const [examsList, setExamsList] = useState<Exam[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [studentsMap, setStudentsMap] = useState<Map<string, StudentInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null);

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
              where("examId", "in", chunk),
              where("submitted", "==", true)
            );
            const sSnapshot = await getDocs(q);
            sSnapshot.docs.forEach((docSnap) => {
              const sData = docSnap.data();
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

      for (const sId of studentIds) {
        try {
          const sDoc = await getDoc(doc(db, "users", sId));
          if (sDoc.exists()) {
            const data = sDoc.data();
            sMap.set(sId, {
              id: sId,
              name: data.name || "Unknown Student",
              email: data.email || "",
              studentCode: data.studentCode || data.id?.substring(0, 8),
              department: data.department || "CSE",
              batch: data.batch || "",
              section: data.section || (data.sections?.[0] ?? ""),
            });
          }
        } catch (e) {
          console.error("Error fetching student record:", e);
        }
      }
      setStudentsMap(sMap);

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
    } catch (error) {
      console.error("Error loading submissions data:", error);
      toast({ title: "Error", description: "Failed to load submissions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const runOCRAnalysis = async (answer: Answer) => {
    if (!answer.answerFiles || answer.answerFiles.length === 0) {
      toast({ title: "Error", description: "No files to analyze", variant: "destructive" });
      return;
    }

    setAnalyzing(answer.id);
    try {
      const fileUrl = answer.answerFiles[0].downloadURL || answer.answerFiles[0].url;
      if (!fileUrl) throw new Error("File URL not found");

      const analysis = await analyzeSubmittedAnswer(fileUrl);

      // Update the answer document in Firestore
      await updateDoc(doc(db, "answers", answer.id), {
        ocrAnalysis: {
          extractedText: analysis.extractedText.substring(0, 10000),
          wordCount: analysis.wordCount,
          aiDetection: analysis.aiDetection,
          errors: analysis.errors,
          analyzedAt: new Date().toISOString(),
        },
      });

      // Update local state
      setAnswers((prev) =>
        prev.map((a) =>
          a.id === answer.id
            ? { ...a, ocrAnalysis: { ...analysis, analyzedAt: new Date().toISOString() } }
            : a
        )
      );

      if (selectedAnswer?.id === answer.id) {
        setSelectedAnswer((prev) =>
          prev ? { ...prev, ocrAnalysis: { ...analysis, analyzedAt: new Date().toISOString() } } : null
        );
      }

      toast({ title: "Success", description: "OCR analysis completed successfully" });
    } catch (error: any) {
      console.error("OCR analysis error:", error);
      toast({ title: "Error", description: error.message || "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzing(null);
    }
  };

  const getOCRBadge = (answer: Answer) => {
    if (!answer.answerFiles || answer.answerFiles.length === 0) {
      return <Badge variant="outline" className="bg-gray-50 text-gray-600">Online Mode</Badge>;
    }
    if (answer.ocrAnalysis?.error) {
      return <Badge variant="destructive">OCR Error</Badge>;
    }
    if (answer.ocrAnalysis?.aiDetection) {
      const isAI = answer.ocrAnalysis.aiDetection.isAIGenerated;
      return isAI ? (
        <Badge variant="destructive" className="flex items-center gap-1">
          <Bot className="h-3 w-3" />
          AI Content ({answer.ocrAnalysis.aiDetection.confidence}%)
        </Badge>
      ) : (
        <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1">
          <CheckCircle className="h-3 w-3" />
          Human Verified
        </Badge>
      );
    }
    if (answer.ocrAnalysis?.extractedText) {
      return <Badge variant="secondary" className="bg-blue-50 text-blue-700">OCR Extracted</Badge>;
    }
    return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">Pending OCR</Badge>;
  };

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
          <Button variant="outline" onClick={loadSubmissionsData} className="gap-2">
            <RefreshCcw className="h-4 w-4" />
            Refresh Results
          </Button>
        </div>

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
                <Bot className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold">
                    {filteredAnswers.filter((a) => a.ocrAnalysis?.extractedText).length}
                  </p>
                  <p className="text-sm text-gray-500">OCR Analyzed</p>
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
                    {filteredAnswers.filter((a) => a.flagged || a.ocrAnalysis?.aiDetection?.isAIGenerated).length}
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
                  {DEFAULT_COURSES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name}
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
                  {DEFAULT_BATCHES.map((b) => (
                    <option key={b.id} value={b.name}>
                      Batch {b.name}
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
                  {DEFAULT_SECTIONS.map((s) => (
                    <option key={s.id} value={s.name}>
                      Section {s.name}
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
              const obtainedMarks = answer.grading?.obtainedMarks ?? answer.score ?? 0;
              const totalMarks = answer.grading?.totalMarks ?? answer.totalMarks ?? 100;
              const accuracy = answer.grading?.accuracy ?? answer.accuracy ?? 0;

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
                          <p className="text-xs text-gray-500 font-medium">Exam Marks</p>
                          <p className="text-xl font-bold text-emerald-700">
                            {obtainedMarks} <span className="text-xs text-gray-400 font-normal">/ {totalMarks}</span>
                          </p>
                          <p className="text-xs text-gray-500">{accuracy}% Accuracy</p>
                        </div>

                        {/* OCR / Answer Actions */}
                        <div className="flex gap-2 w-full sm:w-auto">
                          {answer.answerFiles && answer.answerFiles.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => runOCRAnalysis(answer)}
                              disabled={analyzing === answer.id}
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
                            onClick={() => setSelectedAnswer(answer)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View Details
                          </Button>
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
                    <span className="text-gray-500">Score Obtained:</span>
                    <p className="font-bold text-emerald-700 text-sm">
                      {selectedAnswer.grading?.obtainedMarks ?? selectedAnswer.score ?? 0} /{" "}
                      {selectedAnswer.grading?.totalMarks ?? selectedAnswer.totalMarks ?? 100}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Submission Date:</span>
                    <p className="font-semibold text-gray-900">
                      {selectedAnswer.submittedAt ? formatDate(selectedAnswer.submittedAt) : "—"}
                    </p>
                  </div>
                </div>

                {/* Tabs for Overview, Answers, and OCR Analysis */}
                <Tabs defaultValue="ocr" className="w-full">
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="ocr">OCR & File Evaluation</TabsTrigger>
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
                            {/* AI Detection Summary */}
                            {selectedAnswer.ocrAnalysis.aiDetection && (
                              <Card className={selectedAnswer.ocrAnalysis.aiDetection.isAIGenerated ? "border-red-200 bg-red-50/30" : "border-emerald-200 bg-emerald-50/30"}>
                                <CardContent className="pt-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-xs text-gray-800 flex items-center gap-1.5">
                                      <Bot className="h-4 w-4 text-purple-600" /> AI Content Analysis
                                    </span>
                                    <Badge variant={selectedAnswer.ocrAnalysis.aiDetection.isAIGenerated ? "destructive" : "default"}>
                                      {selectedAnswer.ocrAnalysis.aiDetection.isAIGenerated ? "AI Generated Flagged" : "Human Written"}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-gray-600">
                                    Confidence Level: <strong>{selectedAnswer.ocrAnalysis.aiDetection.confidence}%</strong>
                                  </p>
                                </CardContent>
                              </Card>
                            )}

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
