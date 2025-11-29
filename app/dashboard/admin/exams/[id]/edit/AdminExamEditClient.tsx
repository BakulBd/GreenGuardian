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
import { Switch } from "@/components/ui/switch";
import { 
  ArrowLeft, 
  Save, 
  Plus,
  Trash2,
  Loader2
} from "lucide-react";
import { getExam, updateExam, getQuestionsByExam, createQuestion, deleteQuestion } from "@/lib/firebase/exams";
import { Exam, Question, ExamSettings } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";

const defaultSettings: ExamSettings = {
  requireWebcam: true,
  allowedTabSwitches: 3,
  faceMissingTolerance: 30,
  attentionTimeout: 60,
  fileUploadsAllowed: false,
  shuffleQuestions: false,
  autoSubmitOnTimeout: true,
  allowedLateSubmission: false,
  showResults: true,
  allowReview: true,
  proctoring: {
    faceDetection: true,
    tabSwitchDetection: true,
    fullscreenRequired: true,
  },
};

export default function AdminExamEditClient() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
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
      setEditedExam({
        title: examData.title,
        description: examData.description,
        duration: examData.duration,
        totalMarks: examData.totalMarks,
        settings: examData.settings,
      });
      
      const questionsData = await getQuestionsByExam(examId);
      setQuestions(questionsData);
    } catch (error) {
      console.error("Error loading exam:", error);
      toast({ title: "Error", description: "Failed to load exam data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveExam = async () => {
    setSaving(true);
    try {
      await updateExam(examId, editedExam);
      setExam({ ...exam!, ...editedExam });
      toast({ title: "Success", description: "Exam updated successfully" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update exam", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.text.trim()) {
      toast({ title: "Error", description: "Question text is required", variant: "destructive" });
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
      toast({ title: "Error", description: "Failed to add question", variant: "destructive" });
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Delete this question?")) return;
    try {
      await deleteQuestion(questionId);
      setQuestions(questions.filter(q => q.id !== questionId));
      toast({ title: "Success", description: "Question deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

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
          <p>Exam not found</p>
          <Link href="/dashboard/admin/exams"><Button className="mt-4">Back</Button></Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href={`/dashboard/admin/exams/${examId}`}>
              <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Edit Exam</h1>
              <p className="text-gray-600">{exam.title}</p>
            </div>
          </div>
          <Button onClick={handleSaveExam} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input value={editedExam.title || ""} onChange={(e) => setEditedExam({ ...editedExam, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={editedExam.description || ""} onChange={(e) => setEditedExam({ ...editedExam, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Duration (min)</Label>
                <Input type="number" value={editedExam.duration || 60} onChange={(e) => setEditedExam({ ...editedExam, duration: parseInt(e.target.value) })} />
              </div>
              <div>
                <Label>Total Marks</Label>
                <Input type="number" value={editedExam.totalMarks || 100} onChange={(e) => setEditedExam({ ...editedExam, totalMarks: parseInt(e.target.value) })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><Label>Shuffle Questions</Label></div>
              <Switch checked={editedExam.settings?.shuffleQuestions || false} onCheckedChange={(c) => setEditedExam({ ...editedExam, settings: { ...defaultSettings, ...editedExam.settings, shuffleQuestions: c } })} />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Show Results</Label></div>
              <Switch checked={editedExam.settings?.showResults || false} onCheckedChange={(c) => setEditedExam({ ...editedExam, settings: { ...defaultSettings, ...editedExam.settings, showResults: c } })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Questions ({questions.length})</CardTitle>
              <Button onClick={() => setShowNewQuestion(true)}><Plus className="h-4 w-4 mr-2" />Add</Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewQuestion && (
              <Card className="mb-4 bg-gray-50">
                <CardContent className="pt-4 space-y-3">
                  <Textarea value={newQuestion.text} onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })} placeholder="Question text" />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowNewQuestion(false)}>Cancel</Button>
                    <Button onClick={handleAddQuestion}>Add</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {questions.map((q, i) => (
              <div key={q.id} className="p-3 border rounded-lg mb-2 flex justify-between">
                <div>
                  <Badge variant="outline">Q{i + 1}</Badge>
                  <span className="ml-2">{q.text}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteQuestion(q.id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
