"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Clock, 
  CheckCircle, 
  AlertTriangle,
  Calendar,
  Award,
  TrendingUp,
  Loader2,
  PlayCircle,
  Eye,
  Megaphone
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import Link from "next/link";

interface Exam {
  id: string;
  title: string;
  description: string;
  duration: number;
  totalMarks: number;
  status: string;
  startDate?: string;
  endDate?: string;
}

interface ExamSession {
  id: string;
  examId: string;
  examTitle?: string;
  status: string;
  startTime: any;
  completedAt?: any;
  score?: number;
  totalMarks?: number;
}

export default function StudentDashboardPage() {
  const [availableExams, setAvailableExams] = useState<Exam[]>([]);
  const [recentSessions, setRecentSessions] = useState<ExamSession[]>([]);
  /** Every attempt by this student — drives stats and attempt locking. */
  const [allSessions, setAllSessions] = useState<ExamSession[]>([]);
  const [stats, setStats] = useState({
    totalExams: 0,
    completed: 0,
    avgScore: 0,
    passed: 0,
  });
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    if (!user) return;

    try {
      // Load available exams
      const now = new Date();
      const examsQuery = query(
        collection(db, "exams"),
        where("status", "in", ["published", "active"])
      );
      const examsSnapshot = await getDocs(examsQuery);
      const exams = examsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Exam))
        .filter(exam => {
          // Check if exam is within date range
          if (exam.startDate && new Date(exam.startDate) > now) return false;
          if (exam.endDate && new Date(exam.endDate) < now) return false;
          return true;
        });
      setAvailableExams(exams);

      // Load ALL of this student's sessions. The old query capped at 10 without
      // an ordering, so stats were computed from an arbitrary subset and an
      // older attempt could be missed entirely.
      const sessionsSnapshot = await getDocs(
        query(collection(db, "examSessions"), where("studentId", "==", user.id))
      );

      // Resolve exam titles in one pass instead of one query per session.
      const titleById = new Map(exams.map((e) => [e.id, e.title]));
      const missingExamIds = Array.from(
        new Set(
          sessionsSnapshot.docs
            .map((d) => (d.data() as any).examId)
            .filter((id: string) => id && !titleById.has(id))
        )
      );
      await Promise.all(
        missingExamIds.map(async (examId: string) => {
          const examDoc = await getDoc(doc(db, "exams", examId));
          if (examDoc.exists()) titleById.set(examId, (examDoc.data() as any).title);
        })
      );

      const sessions = sessionsSnapshot.docs
        .map((d) => {
          const session = { id: d.id, ...d.data() } as ExamSession;
          session.examTitle = session.examTitle || titleById.get(session.examId) || "Exam";
          return session;
        })
        .sort((a, b) => {
          const aMs = a.startTime?.toDate?.()?.getTime?.() ?? 0;
          const bMs = b.startTime?.toDate?.()?.getTime?.() ?? 0;
          return bMs - aMs;
        });
      setAllSessions(sessions);
      setRecentSessions(sessions.slice(0, 10));

      // Calculate stats over every attempt, not just the visible ten
      const completedSessions = sessions.filter(
        (s) => s.status === "submitted" || s.status === "auto-submitted" || s.status === "completed"
      );
      const scores = completedSessions
        .filter(s => s.score !== undefined && s.totalMarks)
        .map(s => (s.score! / s.totalMarks!) * 100);
      
      setStats({
        totalExams: sessions.length,
        completed: completedSessions.length,
        avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        passed: scores.filter(s => s >= 40).length,
      });
    } catch (error) {
      console.error("Error loading data:", error);
      toast({
        title: "Error",
        description: "Failed to load dashboard data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isSubmittedStatus = (status: string) =>
    status === "submitted" || status === "auto-submitted" || status === "completed";

  /** Finished attempt → exam is locked. */
  const hasAttempted = (examId: string) =>
    allSessions.some((s) => s.examId === examId && isSubmittedStatus(s.status));

  /** Unfinished attempt → the student must be able to go back in and finish. */
  const canResume = (examId: string) =>
    allSessions.some((s) => s.examId === examId && !isSubmittedStatus(s.status));

  const [selectedSession, setSelectedSession] = useState<ExamSession | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  const handleViewSessionResult = (session: ExamSession) => {
    setSelectedSession(session);
    setShowResultModal(true);
  };

  if (loading) {
    return (
      <DashboardLayout role="student">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="student">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Student Dashboard</h1>
          <p className="text-gray-600 mt-1">View your exams and track your progress</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.totalExams}</p>
                  <p className="text-sm text-gray-500">Total Attempts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.completed}</p>
                  <p className="text-sm text-gray-500">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.avgScore}%</p>
                  <p className="text-sm text-gray-500">Avg Score</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Award className="h-8 w-8 text-yellow-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.passed}</p>
                  <p className="text-sm text-gray-500">Passed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

{/* Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/dashboard/student/notices">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-purple-400 group">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                  <Megaphone className="h-8 w-8 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Notices</h3>
                  <p className="text-sm text-gray-500">View important announcements from your teachers</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/student/results">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-green-400 group">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors">
                  <Award className="h-8 w-8 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">View My Results</h3>
                  <p className="text-sm text-gray-500">Check your published exam results, grades, and performance</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/exam">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-400 group">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                  <FileText className="h-8 w-8 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Available Exams</h3>
                  <p className="text-sm text-gray-500">Browse and start your pending exams</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Available Exams */}
        <Card>
          <CardHeader>
            <CardTitle>Available Exams</CardTitle>
            <CardDescription>Exams you can take right now</CardDescription>
          </CardHeader>
          <CardContent>
            {availableExams.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-4">No exams available at the moment</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {availableExams.map((exam) => (
                  <Card key={exam.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-6">
                      <h3 className="font-semibold truncate">{exam.title}</h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{exam.description}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <Badge variant="outline">
                          <Clock className="h-3 w-3 mr-1" />
                          {exam.duration} min
                        </Badge>
                        <Badge variant="outline">
                          <FileText className="h-3 w-3 mr-1" />
                          {exam.totalMarks} marks
                        </Badge>
                      </div>
                      <Button
                        className="w-full mt-4"
                        onClick={() => router.push(`/exam/${exam.id}`)}
                        disabled={hasAttempted(exam.id)}
                        variant={canResume(exam.id) && !hasAttempted(exam.id) ? "secondary" : "default"}
                      >
                        {hasAttempted(exam.id) ? (
                          <>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Attempted
                          </>
                        ) : canResume(exam.id) ? (
                          <>
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Resume Exam
                          </>
                        ) : (
                          <>
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Start Exam
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Click any exam attempt to view detailed score breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {recentSessions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-4">No exam attempts yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentSessions.map((session) => {
                  const percentage = session.score !== undefined && session.totalMarks ? Math.round((session.score / session.totalMarks) * 100) : null;
                  
                  return (
                    <div
                      key={session.id}
                      onClick={() => handleViewSessionResult(session)}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg hover:border-green-400 hover:shadow-sm cursor-pointer transition-all bg-white"
                    >
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-900 truncate">{session.examTitle || "Exam"}</h4>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {session.startTime?.toDate?.()
                              ? session.startTime.toDate().toLocaleDateString()
                              : "Unknown date"}
                          </span>
                          <Badge
                            variant={session.status === "submitted" || session.status === "auto-submitted" ? "default" : "secondary"}
                            className="capitalize"
                          >
                            {session.status}
                          </Badge>
                        </div>
                      </div>
                      
                      {percentage !== null ? (
                        <div className="flex items-center gap-3 text-right">
                          <div>
                            <p className={`text-xl font-bold ${percentage >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                              {percentage}%
                            </p>
                            <p className="text-xs text-gray-500">
                              {session.score}/{session.totalMarks} Marks
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
                            View Details
                          </Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm">
                          Details
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Result Details Modal */}
      {selectedSession && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity ${showResultModal ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          onClick={() => setShowResultModal(false)}
        >
          <Card className="max-w-lg w-full bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="bg-gradient-to-r from-slate-900 to-slate-800 text-white">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-xl text-white">{selectedSession.examTitle || "Exam Result"}</CardTitle>
                  <CardDescription className="text-slate-300 text-xs mt-1">
                    Submitted: {selectedSession.completedAt?.toDate?.() ? selectedSession.completedAt.toDate().toLocaleString() : "Recently"}
                  </CardDescription>
                </div>
                <Badge className="bg-emerald-500 text-white capitalize">{selectedSession.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {/* Score Display */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-4 bg-slate-50 rounded-xl border">
                  <p className="text-xs text-slate-500 font-medium">Obtained Score</p>
                  <p className="text-3xl font-extrabold text-slate-900 mt-1">
                    {selectedSession.score ?? 0} <span className="text-sm font-normal text-slate-500">/ {selectedSession.totalMarks || 100}</span>
                  </p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border">
                  <p className="text-xs text-slate-500 font-medium">Accuracy Percentage</p>
                  <p className={`text-3xl font-extrabold mt-1 ${(selectedSession.score && selectedSession.totalMarks && (selectedSession.score / selectedSession.totalMarks) >= 0.5) ? "text-emerald-600" : "text-amber-600"}`}>
                    {selectedSession.score && selectedSession.totalMarks ? Math.round((selectedSession.score / selectedSession.totalMarks) * 100) : 0}%
                  </p>
                </div>
              </div>

              {/* Statistical Breakdown */}
              <div className="space-y-2 border-t pt-4 text-sm text-slate-700">
                <div className="flex justify-between items-center py-1">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-600" /> Correct Answers:
                  </span>
                  <span className="font-semibold text-emerald-600">{(selectedSession as any).correctAnswers ?? "N/A"}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" /> Wrong Answers:
                  </span>
                  <span className="font-semibold text-red-500">{(selectedSession as any).wrongAnswers ?? "N/A"}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-blue-500" /> Behavior Score:
                  </span>
                  <span className="font-semibold text-slate-900">{(selectedSession as any).behaviorScore ?? 100} / 100</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" /> Proctor Warnings:
                  </span>
                  <span className="font-semibold text-slate-900">{(selectedSession as any).warnings ?? 0}</span>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button 
                  className="flex-1 bg-blue-600 hover:bg-blue-700" 
                  onClick={() => router.push(`/exam/${selectedSession.examId}/review`)}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Review Answers
                </Button>
                <Button className="flex-1 bg-slate-900 hover:bg-slate-800" onClick={() => setShowResultModal(false)}>
                  Close Details
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
