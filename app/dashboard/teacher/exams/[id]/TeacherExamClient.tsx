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
  Save,
  CheckCircle,
  Loader2,
  Eye
} from "lucide-react";
import { getExam, updateExam, deleteExam, getQuestionsByExam, createQuestion, deleteQuestion, getSessionsByExam } from "@/lib/firebase/exams";
import { Exam, Question, ExamSession } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils/helpers";

export default function TeacherExamClient() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedExam, setEditedExam] = useState<Partial<Exam>>({});
  
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [newQuestion, setNewQuestion] = useState({
    text: "",
    type: "multiple-choice" as "multiple-choice" | "true-false" | "short-answer",
    options: ["", "", "", ""],
    correctAnswer: "",
    marks: 1,
  });

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
      
      if (examData.teacherId !== user?.id) {
        toast({ title: "Error", description: "Access denied", variant: "destructive" });
        router.push("/dashboard/teacher/exams");
        return;
      }
      
      setExam(examData);
      setEditedExam(examData);
      
      const [questionsData, sessionsData] = await Promise.all([
        getQuestionsByExam(examId),
        getSessionsByExam(examId),
      ]);
      
      setQuestions(questionsData);
      setSessions(sessionsData);
    } catch (error) {
      console.error("Error loading exam:", error);
      toast({ title: "Error", description: "Failed to load exam", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveExam = async () => {
    if (!exam) return;
    setSaving(true);
    try {
      await updateExam(examId, editedExam);
      setExam({ ...exam, ...editedExam });
      setIsEditing(false);
      toast({ title: "Success", description: "Exam updated" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExam = async () => {
    if (!confirm("Delete this exam?")) return;
    try {
      await deleteExam(examId);
      toast({ title: "Success", description: "Exam deleted" });
      router.push("/dashboard/teacher/exams");
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.text.trim()) {
      toast({ title: "Error", description: "Question text required", variant: "destructive" });
      return;
    }
    try {
      await createQuestion({
        examId,
        text: newQuestion.text,
        type: newQuestion.type,
        options: newQuestion.type === "multiple-choice" ? newQuestion.options.filter(o => o.trim()) : [],
        correctAnswer: newQuestion.correctAnswer,
        marks: newQuestion.marks,
        order: questions.length,
      });
      await loadExamData();
      setShowNewQuestion(false);
      setNewQuestion({ text: "", type: "multiple-choice", options: ["", "", "", ""], correctAnswer: "", marks: 1 });
      toast({ title: "Success", description: "Question added" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to add", variant: "destructive" });
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Delete question?")) return;
    try {
      await deleteQuestion(questionId);
      setQuestions(questions.filter(q => q.id !== questionId));
      toast({ title: "Success", description: "Question deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  const handleStatusChange = async (status: Exam["status"]) => {
    try {
      await updateExam(examId, { status });
      setExam({ ...exam!, status });
      toast({ title: "Success", description: `Status: ${status}` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!exam) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <p>Select an exam to view</p>
          <Link href="/dashboard/teacher/exams"><Button className="mt-4">Back</Button></Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard/teacher/exams">
              <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
              <p className="text-gray-600">{exam.description}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Badge>{exam.status}</Badge>
            {!isEditing && (
              <>
                <Button variant="outline" onClick={() => setIsEditing(true)}><Edit className="h-4 w-4 mr-2" />Edit</Button>
                <Button variant="destructive" onClick={handleDeleteExam}><Trash2 className="h-4 w-4 mr-2" />Delete</Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><FileText className="h-6 w-6 text-blue-600" /><p className="text-2xl font-bold mt-2">{questions.length}</p><p className="text-sm text-gray-600">Questions</p></CardContent></Card>
          <Card><CardContent className="pt-6"><Clock className="h-6 w-6 text-green-600" /><p className="text-2xl font-bold mt-2">{exam.duration} min</p><p className="text-sm text-gray-600">Duration</p></CardContent></Card>
          <Card><CardContent className="pt-6"><Users className="h-6 w-6 text-purple-600" /><p className="text-2xl font-bold mt-2">{sessions.length}</p><p className="text-sm text-gray-600">Attempts</p></CardContent></Card>
          <Card><CardContent className="pt-6"><CheckCircle className="h-6 w-6 text-green-600" /><p className="text-2xl font-bold mt-2">{sessions.filter(s => s.status === "submitted" || s.status === "auto-submitted").length}</p><p className="text-sm text-gray-600">Completed</p></CardContent></Card>
        </div>

        {isEditing && (
          <Card>
            <CardHeader><CardTitle>Edit Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Title</Label><Input value={editedExam.title || ""} onChange={(e) => setEditedExam({ ...editedExam, title: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea value={editedExam.description || ""} onChange={(e) => setEditedExam({ ...editedExam, description: e.target.value })} /></div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button onClick={handleSaveExam} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {["draft", "published", "active", "completed"].map((s) => (
                <Button key={s} variant={exam.status === s ? "default" : "outline"} onClick={() => handleStatusChange(s as Exam["status"])}>{s}</Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between">
              <CardTitle>Questions ({questions.length})</CardTitle>
              <Button onClick={() => setShowNewQuestion(true)}><Plus className="h-4 w-4 mr-2" />Add</Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewQuestion && (
              <Card className="mb-4 bg-gray-50">
                <CardContent className="pt-4 space-y-3">
                  <Textarea value={newQuestion.text} onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })} placeholder="Question" />
                  <Input value={newQuestion.correctAnswer} onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })} placeholder="Correct Answer" />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowNewQuestion(false)}>Cancel</Button>
                    <Button onClick={handleAddQuestion}>Add</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {questions.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No questions</p>
            ) : (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <div key={q.id} className="p-3 border rounded-lg flex justify-between">
                    <div>
                      <Badge variant="outline">Q{i + 1}</Badge>
                      <span className="ml-2">{q.text}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteQuestion(q.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent Attempts</CardTitle></CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No attempts</p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex justify-between p-2 border rounded">
                    <span>{s.studentName || s.studentId.slice(0, 10)}...</span>
                    <Badge>{s.status}</Badge>
                    <span>{s.score !== undefined ? `${s.score}%` : "-"}</span>
                  </div>
                ))}
                {sessions.length > 0 && (
                  <Link href={`/dashboard/teacher/answers?examId=${examId}`} className="block mt-4">
                    <Button variant="outline" className="w-full">
                      <Eye className="h-4 w-4 mr-2" />
                      Review All Answers & Analysis
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
