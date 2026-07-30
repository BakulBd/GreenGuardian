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
  Edit2,
  CheckCircle,
  Loader2,
  FileText,
  Clock,
  Settings,
  HelpCircle,
  AlertTriangle
} from "lucide-react";
import { getExam, updateExam, getQuestionsByExam, createQuestion, updateQuestion, deleteQuestion } from "@/lib/firebase/exams";
import { Exam, Question, ExamSettings } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";

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

export default function TeacherExamEditClient() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [editedExam, setEditedExam] = useState<Partial<Exam>>({});
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editedQuestion, setEditedQuestion] = useState<Partial<Question>>({});
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

      if (examData.teacherId && user?.id && examData.teacherId !== user.id) {
        toast({ title: "Error", description: "Access denied", variant: "destructive" });
        router.push("/dashboard/teacher/exams");
        return;
      }
      
      setExam(examData);
      setEditedExam({
        title: examData.title,
        description: examData.description,
        duration: examData.duration,
        totalMarks: examData.totalMarks,
        status: examData.status,
        startDate: examData.startDate,
        endDate: examData.endDate,
        settings: examData.settings || defaultSettings,
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
    if (!exam) return;
    setSaving(true);
    try {
      await updateExam(examId, editedExam);
      setExam({ ...exam, ...editedExam });
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
        marks: Number(newQuestion.marks || 1),
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

  const startEditQuestion = (question: Question) => {
    setEditingQuestionId(question.id);
    setEditedQuestion({
      text: question.text,
      type: question.type,
      options: question.options || ["", "", "", ""],
      correctAnswer: (question as any).correctAnswer || "",
      marks: question.marks,
    });
  };

  const handleSaveQuestion = async (questionId: string) => {
    if (!editedQuestion.text?.trim()) {
      toast({ title: "Error", description: "Question text required", variant: "destructive" });
      return;
    }

    try {
      await updateQuestion(questionId, {
        text: editedQuestion.text!,
        type: (editedQuestion.type as any) || "multiple-choice",
        options: (editedQuestion.type === "multiple-choice" ? (editedQuestion.options || []).filter((o) => String(o).trim()) : []),
        correctAnswer: String(editedQuestion.correctAnswer || ""),
        marks: Number(editedQuestion.marks || 1),
      } as any);
      await loadExamData();
      setEditingQuestionId(null);
      setEditedQuestion({});
      toast({ title: "Success", description: "Question updated" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update question", variant: "destructive" });
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Delete this question?")) return;
    try {
      await deleteQuestion(questionId);
      setQuestions(questions.filter(q => q.id !== questionId));
      toast({ title: "Success", description: "Question deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete question", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!exam) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <p>Exam not found</p>
          <Link href="/dashboard/teacher/exams"><Button className="mt-4">Back to Exams</Button></Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <Link href={`/dashboard/teacher/exams`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Edit Exam</h1>
              <p className="text-sm text-gray-500">{exam.title}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveExam} disabled={saving} className="bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save All Changes
            </Button>
          </div>
        </div>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-600" /> Exam Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>Exam Title</Label>
                <Input 
                  value={editedExam.title || ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, title: e.target.value })} 
                  placeholder="e.g. Midterm Computer Science 101"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Description</Label>
                <Textarea 
                  value={editedExam.description || ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, description: e.target.value })} 
                  placeholder="Instructions for students taking this exam..."
                  rows={3}
                />
              </div>
              <div>
                <Label>Duration (Minutes)</Label>
                <Input 
                  type="number" 
                  value={editedExam.duration || 60} 
                  onChange={(e) => setEditedExam({ ...editedExam, duration: parseInt(e.target.value) || 60 })} 
                />
              </div>
              <div>
                <Label>Total Marks</Label>
                <Input 
                  type="number" 
                  value={editedExam.totalMarks || 100} 
                  onChange={(e) => setEditedExam({ ...editedExam, totalMarks: parseInt(e.target.value) || 100 })} 
                />
              </div>
              <div>
                <Label>Status</Label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={editedExam.status || "draft"}
                  onChange={(e) => setEditedExam({ ...editedExam, status: e.target.value as any })}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="active">Active (Ongoing)</option>
                  <option value="completed">Completed (Ended)</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="sm:col-span-1">
                <Label>Start Date & Time (Optional)</Label>
                <Input 
                  type="datetime-local" 
                  value={editedExam.startDate ? new Date(editedExam.startDate).toISOString().slice(0, 16) : ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, startDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })} 
                />
              </div>
              <div className="sm:col-span-1">
                <Label>End Date & Time (Optional)</Label>
                <Input 
                  type="datetime-local" 
                  value={editedExam.endDate ? new Date(editedExam.endDate).toISOString().slice(0, 16) : ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, endDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })} 
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration & Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-600" /> Exam Rules & Proctoring Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b">
              <div>
                <Label className="font-semibold">Shuffle Questions</Label>
                <p className="text-xs text-gray-500">Randomize question order for each student</p>
              </div>
              <Switch 
                checked={editedExam.settings?.shuffleQuestions || false} 
                onCheckedChange={(c) => setEditedExam({ 
                  ...editedExam, 
                  settings: { ...defaultSettings, ...editedExam.settings, shuffleQuestions: c } 
                })} 
              />
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <div>
                <Label className="font-semibold">Show Results Immediately</Label>
                <p className="text-xs text-gray-500">Allow students to see score after submission</p>
              </div>
              <Switch 
                checked={editedExam.settings?.showResults || false} 
                onCheckedChange={(c) => setEditedExam({ 
                  ...editedExam, 
                  settings: { ...defaultSettings, ...editedExam.settings, showResults: c } 
                })} 
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="font-semibold">Require Webcam Proctoring</Label>
                <p className="text-xs text-gray-500">Enable AI face and behavior detection</p>
              </div>
              <Switch 
                checked={editedExam.settings?.requireWebcam !== false} 
                onCheckedChange={(c) => setEditedExam({ 
                  ...editedExam, 
                  settings: { ...defaultSettings, ...editedExam.settings, requireWebcam: c } 
                })} 
              />
            </div>
          </CardContent>
        </Card>

        {/* Question Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-purple-600" /> Questions ({questions.length})
                </CardTitle>
                <CardDescription>Add, edit, or remove exam questions</CardDescription>
              </div>
              <Button onClick={() => setShowNewQuestion(true)} size="sm" className="bg-purple-600 hover:bg-purple-700">
                <Plus className="h-4 w-4 mr-1" /> Add Question
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showNewQuestion && (
              <Card className="bg-slate-50 border-2 border-purple-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-purple-900">New Question</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Question Text</Label>
                    <Textarea 
                      value={newQuestion.text} 
                      onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })} 
                      placeholder="Enter question prompt..."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Type</Label>
                      <select
                        className="w-full h-10 px-3 rounded-md border text-sm"
                        value={newQuestion.type}
                        onChange={(e) => setNewQuestion({ ...newQuestion, type: e.target.value as any })}
                      >
                        <option value="multiple-choice">Multiple Choice</option>
                        <option value="true-false">True / False</option>
                        <option value="short-answer">Short Answer</option>
                      </select>
                    </div>
                    <div>
                      <Label>Marks</Label>
                      <Input 
                        type="number" 
                        value={newQuestion.marks} 
                        onChange={(e) => setNewQuestion({ ...newQuestion, marks: parseInt(e.target.value) || 1 })} 
                      />
                    </div>
                  </div>

                  {newQuestion.type === "multiple-choice" && (
                    <div className="space-y-2">
                      <Label>Options</Label>
                      {newQuestion.options.map((opt, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <Input 
                            value={opt} 
                            onChange={(e) => {
                              const updated = [...newQuestion.options];
                              updated[idx] = e.target.value;
                              setNewQuestion({ ...newQuestion, options: updated });
                            }} 
                            placeholder={`Option ${idx + 1}`} 
                          />
                          <input 
                            type="radio" 
                            name="correctOpt" 
                            checked={newQuestion.correctAnswer === opt && opt !== ""} 
                            onChange={() => setNewQuestion({ ...newQuestion, correctAnswer: opt })} 
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {newQuestion.type === "true-false" && (
                    <div>
                      <Label>Correct Answer</Label>
                      <select
                        className="w-full h-10 px-3 rounded-md border text-sm"
                        value={newQuestion.correctAnswer}
                        onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })}
                      >
                        <option value="">Select Correct Option</option>
                        <option value="True">True</option>
                        <option value="False">False</option>
                      </select>
                    </div>
                  )}

                  {newQuestion.type === "short-answer" && (
                    <div>
                      <Label>Correct Answer Keywords / Reference Solution</Label>
                      <Input 
                        value={newQuestion.correctAnswer} 
                        onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })} 
                        placeholder="Expected answer or key phrase"
                      />
                    </div>
                  )}

                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" size="sm" onClick={() => setShowNewQuestion(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAddQuestion} className="bg-purple-600 hover:bg-purple-700">Save Question</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {questions.length === 0 && !showNewQuestion ? (
              <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                <HelpCircle className="mx-auto h-10 w-10 text-gray-300 mb-2" />
                <p>No questions added yet. Click &quot;Add Question&quot; to begin building your exam.</p>
              </div>
            ) : (
              questions.map((q, idx) => (
                <Card key={q.id} className="border">
                  <CardContent className="p-4">
                    {editingQuestionId === q.id ? (
                      <div className="space-y-3">
                        <Textarea 
                          value={editedQuestion.text || ""} 
                          onChange={(e) => setEditedQuestion({ ...editedQuestion, text: e.target.value })} 
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Marks</Label>
                            <Input 
                              type="number" 
                              value={editedQuestion.marks || 1} 
                              onChange={(e) => setEditedQuestion({ ...editedQuestion, marks: parseInt(e.target.value) || 1 })} 
                            />
                          </div>
                          <div>
                            <Label>Correct Answer</Label>
                            <Input 
                              value={editedQuestion.correctAnswer || ""} 
                              onChange={(e) => setEditedQuestion({ ...editedQuestion, correctAnswer: e.target.value })} 
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" size="sm" onClick={() => setEditingQuestionId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => handleSaveQuestion(q.id)}>Save Edit</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-bold">Q{idx + 1}</Badge>
                            <Badge className="bg-slate-100 text-slate-700 capitalize">{q.type}</Badge>
                            <Badge className="bg-emerald-50 text-emerald-700">{q.marks} Marks</Badge>
                          </div>
                          <p className="font-semibold text-slate-900 mt-2">{q.text}</p>
                          {q.options && q.options.length > 0 && (
                            <div className="grid grid-cols-2 gap-1 mt-2 text-sm text-slate-600">
                              {q.options.map((opt, i) => (
                                <div key={i} className={`p-1.5 rounded border text-xs ${opt === (q as any).correctAnswer ? "bg-emerald-50 border-emerald-300 font-medium" : "bg-slate-50"}`}>
                                  {opt} {opt === (q as any).correctAnswer && "✓"}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEditQuestion(q)}>
                            <Edit2 className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteQuestion(q.id)}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
