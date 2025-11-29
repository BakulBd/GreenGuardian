"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  FileText, 
  Clock, 
  Users, 
  Edit, 
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  BarChart,
  Loader2,
  User
} from "lucide-react";
import { getExam, deleteExam, updateExam, getQuestionsByExam, getSessionsByExam } from "@/lib/firebase/exams";
import { Exam, Question, ExamSession } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/lib/utils/helpers";

export default function AdminExamClient() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [loading, setLoading] = useState(true);

  const examId = params.id as string;

  useEffect(() => {
    if (examId && examId !== 'placeholder') {
      loadExamData();
    } else {
      setLoading(false);
    }
  }, [examId]);

  const loadExamData = async () => {
    try {
      const examData = await getExam(examId);
      if (!examData) {
        toast({ title: "Error", description: "Exam not found", variant: "destructive" });
        router.push("/dashboard/admin/exams");
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
      toast({ title: "Error", description: "Failed to load exam data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteExam = async () => {
    if (!confirm("Are you sure you want to delete this exam?")) return;
    
    try {
      await deleteExam(examId);
      toast({ title: "Success", description: "Exam deleted successfully" });
      router.push("/dashboard/admin/exams");
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete exam", variant: "destructive" });
    }
  };

  const handleStatusChange = async (status: Exam["status"]) => {
    try {
      await updateExam(examId, { status });
      setExam({ ...exam!, status });
      toast({ title: "Success", description: `Exam status changed to ${status}` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "published": return "bg-green-100 text-green-700";
      case "active": return "bg-blue-100 text-blue-700";
      case "completed": return "bg-gray-100 text-gray-700";
      default: return "bg-yellow-100 text-yellow-700";
    }
  };

  const completedSessions = sessions.filter(s => s.status === "submitted" || s.status === "auto-submitted");
  const avgScore = completedSessions.length > 0
    ? completedSessions.reduce((acc, s) => acc + (s.score || 0), 0) / completedSessions.length
    : 0;
  const passRate = completedSessions.length > 0
    ? (completedSessions.filter(s => (s.score || 0) >= 60).length / completedSessions.length) * 100
    : 0;

  if (loading) {
    return (
      <DashboardLayout role="admin">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!exam) {
    return (
      <DashboardLayout role="admin">
        <div className="text-center py-12">
          <p>Select an exam to view details</p>
          <Link href="/dashboard/admin/exams">
            <Button className="mt-4">Back to Exams</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard/admin/exams">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
              <p className="text-gray-600">{exam.description}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Badge className={getStatusColor(exam.status)}>{exam.status}</Badge>
            <Link href={`/dashboard/admin/exams/${examId}/edit`}>
              <Button variant="outline">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </Link>
            <Button variant="destructive" onClick={handleDeleteExam}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <FileText className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Questions</p>
                  <p className="text-2xl font-bold">{questions.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Clock className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Duration</p>
                  <p className="text-2xl font-bold">{exam.duration} min</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Attempts</p>
                  <p className="text-2xl font-bold">{sessions.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <BarChart className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Avg Score</p>
                  <p className="text-2xl font-bold">{avgScore.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Pass Rate</p>
                  <p className="text-2xl font-bold">{passRate.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Exam Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {["draft", "published", "active", "completed"].map((status) => (
                <Button 
                  key={status}
                  variant={exam.status === status ? "default" : "outline"} 
                  onClick={() => handleStatusChange(status as Exam["status"])}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Questions ({questions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {questions.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No questions</p>
            ) : (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <div key={q.id} className="p-3 border rounded-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <Badge variant="outline">Q{i + 1}</Badge>
                      <Badge>{q.type}</Badge>
                      <Badge variant="secondary">{q.marks} marks</Badge>
                    </div>
                    <p className="text-gray-900">{q.text}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions ({sessions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No attempts yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 text-sm font-medium">Student</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Status</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Score</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.slice(0, 10).map((s) => (
                      <tr key={s.id} className="border-b">
                        <td className="py-2 px-3">{s.studentName || s.studentId.slice(0, 10)}...</td>
                        <td className="py-2 px-3">
                          <Badge className={(s.status === "submitted" || s.status === "auto-submitted") ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">{s.score !== undefined ? `${s.score}%` : "-"}</td>
                        <td className="py-2 px-3">{s.proctoring?.suspiciousEvents || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
