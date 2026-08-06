"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  ArrowLeft, 
  FileText, 
  Clock, 
  Users, 
  Edit, 
  Trash2,
  Plus,
  CheckCircle,
  Loader2,
  Eye,
  Calendar,
  BookOpen,
  Award,
  HelpCircle,
  Check,
  AlertCircle
} from "lucide-react";
import { getExam, updateExam, deleteExam, getQuestionsByExam, createQuestion, deleteQuestion, getSessionsByExam, updateQuestion } from "@/lib/firebase/exams";
import { Exam, Question, ExamSession } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils/helpers";
import { isOptionBasedQuestion } from "@/lib/utils/questionTypes";

export default function TeacherExamClient() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [loading, setLoading] = useState(true);

  const examId = params.id as string;

  useEffect(() => {
    if (examId && examId !== 'placeholder' && user) {
      loadExamData();
    } else if (examId === 'placeholder') {
      setLoading(false);
    }
  }, [examId, user]);

  const loadExamData = async () => {
    try {
      const examData = await getExam(examId);
      if (!examData) {
        toast({ title: "Error", description: "Exam not found", variant: "destructive" });
        router.push("/dashboard/teacher/exams");
        return;
      }
      
      // Ownership security check
      const teacherId = examData.teacherId || (examData as any).createdBy;
      if (teacherId && user?.id && teacherId !== user.id) {
        toast({ title: "Access Denied", description: "You can only view exams created by yourself.", variant: "destructive" });
        router.push("/dashboard/teacher/exams");
        return;
      }
      
      setExam(examData);
      
      const [questionsData, sessionsData] = await Promise.all([
        getQuestionsByExam(examId),
        getSessionsByExam(examId),
      ]);
      
      setQuestions(questionsData);
      setSessions(sessionsData);
    } catch (error) {
      console.error("Error loading exam:", error);
      toast({ title: "Error", description: "Failed to load exam details", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteExam = async () => {
    if (!confirm("Are you sure you want to delete this exam? This action cannot be undone.")) return;
    try {
      await deleteExam(examId);
      toast({ title: "Success", description: "Exam deleted successfully" });
      router.push("/dashboard/teacher/exams");
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete exam", variant: "destructive" });
    }
  };

  const handleStatusChange = async (status: Exam["status"]) => {
    try {
      await updateExam(examId, { status });
      setExam({ ...exam!, status });
      toast({ title: "Success", description: `Exam status updated to ${status}` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-600 mb-4" />
          <p className="text-gray-600 font-medium">Loading Exam Details & Questions...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!exam) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <p className="text-gray-600">Exam not found</p>
          <Link href="/dashboard/teacher/exams">
            <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700">Back to Exams</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; bg: string }> = {
      draft: { variant: "secondary", label: "Draft", bg: "bg-gray-100 text-gray-800" },
      published: { variant: "default", label: "Published", bg: "bg-emerald-600 text-white" },
      active: { variant: "default", label: "Active", bg: "bg-blue-600 text-white" },
      completed: { variant: "outline", label: "Completed", bg: "bg-purple-50 text-purple-700 border-purple-200" },
      archived: { variant: "outline", label: "Archived", bg: "bg-amber-50 text-amber-800 border-amber-200" }
    };
    const { label, bg } = variants[status] || variants.draft;
    return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${bg}`}>{label}</span>;
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header Navigation & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <Link href="/dashboard/teacher/exams">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to My Exams
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{exam.title}</h1>
                {getStatusBadge(exam.status)}
              </div>
              <p className="text-sm text-gray-600 mt-0.5">{exam.description || "No description provided."}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={`/dashboard/teacher/exams/${exam.id}/edit`}>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                <Edit className="h-4 w-4" /> Edit Exam & Questions
              </Button>
            </Link>
            <Button variant="outline" onClick={handleDeleteExam} className="text-red-600 hover:text-red-700 border-red-200 gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>

        {/* Complete Exam Information Details Card */}
        <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white">
          <CardHeader className="pb-3 border-b border-emerald-100/60">
            <CardTitle className="text-lg flex items-center gap-2 text-emerald-900">
              <BookOpen className="h-5 w-5 text-emerald-600" /> Complete Exam Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs sm:text-sm">
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Course</span>
                <p className="font-semibold text-gray-900">{exam.courseName || exam.courseId || "CSE Department"}</p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Batch & Section</span>
                <p className="font-semibold text-gray-900">
                  Batch {exam.batch || "All"} / Sec {exam.section || "All"}
                </p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Duration</span>
                <p className="font-semibold text-emerald-700 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {exam.duration} Minutes
                </p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Total Marks</span>
                <p className="font-bold text-gray-900 flex items-center gap-1">
                  <Award className="h-3.5 w-3.5 text-amber-500" /> {exam.totalMarks || questions.reduce((s, q) => s + (q.marks || 0), 0)} Marks
                </p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Start Time</span>
                <p className="font-semibold text-gray-800">
                  {exam.startDate ? new Date(exam.startDate).toLocaleString() : "Flexible / Any"}
                </p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">End Time</span>
                <p className="font-semibold text-gray-800">
                  {exam.endDate ? new Date(exam.endDate).toLocaleString() : "Flexible / Any"}
                </p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Created Date</span>
                <p className="font-semibold text-gray-800">
                  {exam.createdAt ? formatDate((exam.createdAt as any)?.toDate?.() || (exam.createdAt as any)) : "N/A"}
                </p>
              </div>
              <div className="space-y-1 bg-white p-3 rounded-lg border border-gray-100">
                <span className="text-gray-500 font-medium">Exam Status</span>
                <div className="pt-0.5">{getStatusBadge(exam.status)}</div>
              </div>
            </div>

            {/* Quick Status Control Bar */}
            <div className="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-medium text-gray-600">Quick Change Status:</span>
              <div className="flex flex-wrap gap-2">
                {(["draft", "published", "active", "completed", "archived"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={exam.status === s ? "default" : "outline"}
                    className={`h-7 text-xs capitalize ${exam.status === s ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                    onClick={() => handleStatusChange(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Summary Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <HelpCircle className="h-7 w-7 text-blue-600" />
                <div>
                  <p className="text-xl font-bold text-gray-900">{questions.length}</p>
                  <p className="text-xs text-gray-500">Questions Added</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <Clock className="h-7 w-7 text-emerald-600" />
                <div>
                  <p className="text-xl font-bold text-gray-900">{exam.duration} min</p>
                  <p className="text-xs text-gray-500">Time Duration</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <Users className="h-7 w-7 text-purple-600" />
                <div>
                  <p className="text-xl font-bold text-gray-900">{sessions.length}</p>
                  <p className="text-xs text-gray-500">Student Attempts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-7 w-7 text-green-600" />
                <div>
                  <p className="text-xl font-bold text-gray-900">
                    {sessions.filter(s => s.status === "submitted" || s.status === "auto-submitted").length}
                  </p>
                  <p className="text-xs text-gray-500">Submissions</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Question List View */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600" /> Question List ({questions.length})
              </CardTitle>
              <CardDescription>All assigned questions and answer keys for this examination</CardDescription>
            </div>
            <Link href={`/dashboard/teacher/exams/${exam.id}/edit`}>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Manage / Edit Questions
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions.length === 0 ? (
              <div className="text-center py-10 border-2 border-dashed rounded-lg bg-gray-50/50">
                <HelpCircle className="mx-auto h-10 w-10 text-gray-300 mb-2" />
                <h4 className="font-semibold text-gray-700">No Questions Added Yet</h4>
                <p className="text-xs text-gray-500 mt-1 mb-4">Click below to start adding questions to this exam.</p>
                <Link href={`/dashboard/teacher/exams/${exam.id}/edit`}>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="h-4 w-4 mr-1" /> Add Questions
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {questions.map((q, index) => (
                  <Card key={q.id || index} className="border border-gray-200 hover:border-emerald-300 transition-colors shadow-sm">
                    <CardContent className="p-5">
                      <div className="space-y-3">
                        {/* Header Badge Row */}
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded font-bold text-xs bg-emerald-100 text-emerald-900 border border-emerald-200">
                              Question {index + 1}
                            </span>
                            <Badge variant="outline" className="text-xs capitalize bg-gray-50">
                              Type: {q.type}
                            </Badge>
                          </div>
                          <Badge className="bg-emerald-600 text-white font-medium text-xs">
                            {q.marks} {q.marks === 1 ? "Mark" : "Marks"}
                          </Badge>
                        </div>

                        {/* Question Text */}
                        <div className="text-base font-semibold text-gray-900 pt-1">
                          {q.text}
                        </div>

                        {/* Options View for MCQ / True-False */}
                        {isOptionBasedQuestion(q) && (
                          <div className="space-y-2 pt-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Options:</span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              {(q.options || []).map((opt, optIdx) => {
                                const isCorrect = opt === (q as any).correctAnswer && opt !== "";
                                const letter = String.fromCharCode(65 + optIdx); // A, B, C, D
                                return (
                                  <div
                                    key={optIdx}
                                    className={`p-2.5 rounded-lg border flex items-center justify-between ${
                                      isCorrect
                                        ? "bg-emerald-50 border-emerald-400 font-semibold text-emerald-900 shadow-sm"
                                        : "bg-gray-50/80 border-gray-200 text-gray-700"
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                        isCorrect ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-700"
                                      }`}>
                                        {letter}
                                      </span>
                                      {opt || `Option ${optIdx + 1}`}
                                    </span>
                                    {isCorrect && (
                                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded">
                                        <Check className="h-3 w-3" /> Correct Answer
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Correct Answer Display for Short-Answer */}
                        {!isOptionBasedQuestion(q) && (q as any).correctAnswer && (
                          <div className="mt-3 p-3 bg-emerald-50/80 rounded-lg border border-emerald-200 text-xs flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            <div>
                              <span className="font-semibold text-emerald-900">Correct Answer: </span>
                              <span className="font-mono text-emerald-800 font-semibold">{(q as any).correctAnswer}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Student Submissions Link */}
        {sessions.length > 0 && (
          <Card className="bg-emerald-900 text-white">
            <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold">Student Answers & Results Ready</h3>
                <p className="text-xs text-emerald-200 mt-1">
                  {sessions.length} student attempt(s) recorded for this exam. Review completed answers and OCR analysis.
                </p>
              </div>
              <Link href={`/dashboard/teacher/answers?examId=${exam.id}`}>
                <Button className="bg-white text-emerald-900 hover:bg-emerald-50 font-semibold text-xs gap-1.5 whitespace-nowrap">
                  <Eye className="h-4 w-4" /> View Submissions & OCR Results
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
