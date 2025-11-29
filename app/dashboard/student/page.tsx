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
  PlayCircle
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
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
  startedAt: any;
  completedAt?: any;
  score?: number;
  totalMarks?: number;
}

export default function StudentDashboardPage() {
  const [availableExams, setAvailableExams] = useState<Exam[]>([]);
  const [recentSessions, setRecentSessions] = useState<ExamSession[]>([]);
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

      // Load user's exam sessions
      const sessionsQuery = query(
        collection(db, "examSessions"),
        where("studentId", "==", user.id),
        orderBy("startedAt", "desc"),
        limit(10)
      );
      const sessionsSnapshot = await getDocs(sessionsQuery);
      const sessions = await Promise.all(
        sessionsSnapshot.docs.map(async (doc) => {
          const session = { id: doc.id, ...doc.data() } as ExamSession;
          // Get exam title
          const examDoc = await getDocs(
            query(collection(db, "exams"), where("__name__", "==", session.examId))
          );
          if (!examDoc.empty) {
            session.examTitle = examDoc.docs[0].data().title;
          }
          return session;
        })
      );
      setRecentSessions(sessions);

      // Calculate stats
      const completedSessions = sessions.filter(s => s.status === "submitted" || s.status === "auto-submitted");
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

  const hasAttempted = (examId: string) => {
    return recentSessions.some(s => s.examId === examId);
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
                      >
                        {hasAttempted(exam.id) ? (
                          <>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Attempted
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
            <CardDescription>Your exam history</CardDescription>
          </CardHeader>
          <CardContent>
            {recentSessions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-4">No exam attempts yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{session.examTitle || "Exam"}</h4>
                      <div className="flex flex-wrap gap-2 mt-1 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {session.startedAt?.toDate?.()
                            ? session.startedAt.toDate().toLocaleDateString()
                            : "Unknown date"}
                        </span>
                        <Badge
                          variant={session.status === "submitted" || session.status === "auto-submitted" ? "default" : "secondary"}
                        >
                          {session.status}
                        </Badge>
                      </div>
                    </div>
                    {session.score !== undefined && session.totalMarks && (
                      <div className="text-right">
                        <p className="text-xl font-bold">
                          {Math.round((session.score / session.totalMarks) * 100)}%
                        </p>
                        <p className="text-sm text-gray-500">
                          {session.score}/{session.totalMarks}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
