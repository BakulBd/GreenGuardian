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
  AlertTriangle,
  Check
} from "lucide-react";
import { getExam, updateExam, getQuestionsByExam, createQuestion, updateQuestion, deleteQuestion, notifyExamPublished } from "@/lib/firebase/exams";
import { subscribeToAssignedCatalog, computeAssignmentTargetStudentIds, AssignedCatalogEntry } from "@/lib/firebase/assignments";
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
    marks: 10,
  });
  const [assignedCatalog, setAssignedCatalog] = useState<AssignedCatalogEntry[]>([]);

  const examId = params.id as string;

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToAssignedCatalog(user.id, setAssignedCatalog);
    return () => unsubscribe();
  }, [user]);

  const selectedCourse = assignedCatalog.find((c) => c.courseId === editedExam.courseId);
  const selectedBatch = selectedCourse?.batches.find((b) => b.batchId === editedExam.batchId);

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

      // Security check: teacher must own this exam
      const ownerId = examData.teacherId || (examData as any).createdBy;
      if (ownerId && user?.id && ownerId !== user.id) {
        toast({ title: "Access Denied", description: "You can only edit exams created by yourself", variant: "destructive" });
        router.push("/dashboard/teacher/exams");
        return;
      }
      
      setExam(examData);
      setEditedExam({
        title: examData.title || "",
        description: examData.description || "",
        courseId: examData.courseId || "",
        courseName: examData.courseName || "",
        batchId: examData.batchId || "",
        batch: examData.batch || "",
        sectionId: examData.sectionId || "",
        section: examData.section || "",
        duration: examData.duration || 60,
        totalMarks: examData.totalMarks || 100,
        attemptsAllowed: examData.attemptsAllowed || 1,
        status: examData.status || "draft",
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
    if (!exam || !user) return;
    if (!editedExam.title?.trim()) {
      toast({ title: "Error", description: "Exam title is required", variant: "destructive" });
      return;
    }
    if (!editedExam.courseId || !editedExam.batchId || !editedExam.sectionId) {
      toast({ title: "Error", description: "Please select the Course, Batch, and Section this exam is for.", variant: "destructive" });
      return;
    }
    // Students only see an exam inside its start/end window; an inverted window
    // hides it from everyone.
    if (
      editedExam.startDate &&
      editedExam.endDate &&
      new Date(editedExam.endDate) <= new Date(editedExam.startDate)
    ) {
      toast({
        title: "Invalid schedule",
        description: "The end date must be after the start date.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const totalMarksCalculated = questions.length > 0
        ? questions.reduce((sum, q) => sum + (q.marks || 0), 0)
        : Number(editedExam.totalMarks || 100);

      // Recompute visibility whenever course/batch/section could have
      // changed — cheap, and keeps `targetStudentIds` (what firestore.rules
      // and subscribeToStudentVisibleExams actually check) authoritative.
      const targetStudentIds = await computeAssignmentTargetStudentIds(
        user.id,
        editedExam.courseId,
        editedExam.batchId,
        editedExam.sectionId
      );

      const updateData = {
        ...editedExam,
        totalMarks: totalMarksCalculated,
        questionCount: questions.length,
        targetStudentIds,
      };

      const wasPublished = exam.status === "published" || exam.status === "active";
      const isNowPublished = updateData.status === "published" || updateData.status === "active";

      await updateExam(examId, updateData);
      setExam({ ...exam, ...updateData } as Exam);

      if (!wasPublished && isNowPublished && targetStudentIds.length > 0) {
        notifyExamPublished(examId, targetStudentIds).catch((err) =>
          console.warn("[EditExam] Failed to send publish notifications:", err)
        );
      }

      toast({ title: "Success", description: "Exam details updated successfully" });
      router.push(`/dashboard/teacher/exams/${examId}`);
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

    if (newQuestion.type === "multiple-choice" && !newQuestion.correctAnswer) {
      toast({ title: "Error", description: "Select a correct answer for multiple choice question", variant: "destructive" });
      return;
    }
    
    try {
      await createQuestion({
        examId,
        text: newQuestion.text,
        type: newQuestion.type,
        options:
          newQuestion.type === "multiple-choice"
            ? newQuestion.options.map((o) => o.trim())
            : newQuestion.type === "true-false"
            ? ["True", "False"]
            : [],
        correctAnswer: newQuestion.correctAnswer,
        marks: Number(newQuestion.marks || 10),
        order: questions.length,
        courseId: editedExam.courseId || "",
        batch: editedExam.batch || "",
        section: editedExam.section || "",
      });

      await loadExamData();
      setShowNewQuestion(false);
      setNewQuestion({ text: "", type: "multiple-choice", options: ["", "", "", ""], correctAnswer: "", marks: 10 });
      toast({ title: "Success", description: "Question added successfully" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to add question", variant: "destructive" });
    }
  };

  const startEditQuestion = (question: Question) => {
    setEditingQuestionId(question.id);
    const opts = question.options && question.options.length > 0 
      ? [...question.options] 
      : ["", "", "", ""];
    
    while (opts.length < 4) opts.push("");

    setEditedQuestion({
      text: question.text,
      type: question.type,
      options: opts,
      correctAnswer: (question as any).correctAnswer || "",
      marks: question.marks || 10,
    });
  };

  const handleSaveQuestion = async (questionId: string) => {
    if (!editedQuestion.text?.trim()) {
      toast({ title: "Error", description: "Question text is required", variant: "destructive" });
      return;
    }

    try {
      const questionType = editedQuestion.type || "multiple-choice";
      const cleanOptions =
        questionType === "multiple-choice"
          ? (editedQuestion.options || []).map((o) => String(o).trim())
          : questionType === "true-false"
          ? ["True", "False"]
          : [];

      await updateQuestion(questionId, {
        text: editedQuestion.text!,
        type: (editedQuestion.type as any) || "multiple-choice",
        options: cleanOptions,
        correctAnswer: String(editedQuestion.correctAnswer || ""),
        marks: Number(editedQuestion.marks || 10),
        courseId: editedExam.courseId || "",
        batch: editedExam.batch || "",
        section: editedExam.section || "",
      } as any);

      await loadExamData();
      setEditingQuestionId(null);
      setEditedQuestion({});
      toast({ title: "Success", description: "Question updated successfully" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update question", variant: "destructive" });
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Are you sure you want to delete this question?")) return;
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
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-600 mb-4" />
          <p className="text-gray-600 font-medium">Loading Exam & Questions...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!exam) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <p className="text-gray-600">Exam not found</p>
          <Link href="/dashboard/teacher/exams"><Button className="mt-4">Back to My Exams</Button></Link>
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
            <Link href={`/dashboard/teacher/exams/${exam.id}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to View
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Edit Exam & Questions</h1>
              <p className="text-sm text-gray-500">{exam.title}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveExam} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 font-semibold">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save All Changes
            </Button>
          </div>
        </div>

        {/* Basic Info & Academic Structure */}
        <Card className="border-emerald-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-900">
              <FileText className="h-5 w-5 text-emerald-600" /> Exam Details & Academic Settings
            </CardTitle>
            <CardDescription>Update general information, target course, batch, and section</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>Exam Title *</Label>
                <Input 
                  value={editedExam.title || ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, title: e.target.value })} 
                  placeholder="e.g. Database Management Midterm"
                />
              </div>

              <div className="sm:col-span-2">
                <Label>Description / Instructions</Label>
                <Textarea 
                  value={editedExam.description || ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, description: e.target.value })} 
                  placeholder="Instructions for students taking this exam..."
                  rows={3}
                />
              </div>

              {/* Academic Dropdowns — restricted to this teacher's own
                  Course/Batch/Section assignments (see lib/firebase/assignments.ts) */}
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-emerald-50/60 p-4 rounded-lg border border-emerald-200">
                <div>
                  <Label>Course *</Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-emerald-500"
                    value={editedExam.courseId || ""}
                    onChange={(e) => {
                      const course = assignedCatalog.find((c) => c.courseId === e.target.value);
                      setEditedExam({
                        ...editedExam,
                        courseId: course?.courseId || "",
                        courseName: course?.courseName || "",
                        batchId: "",
                        batch: "",
                        sectionId: "",
                        section: "",
                      });
                    }}
                  >
                    <option value="">-- Select Course --</option>
                    {assignedCatalog.map((course) => (
                      <option key={course.courseId} value={course.courseId}>
                        {course.courseCode ? `${course.courseCode} - ` : ""}{course.courseName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>Batch *</Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-emerald-500"
                    value={editedExam.batchId || ""}
                    disabled={!selectedCourse}
                    onChange={(e) => {
                      const batch = selectedCourse?.batches.find((b) => b.batchId === e.target.value);
                      setEditedExam({
                        ...editedExam,
                        batchId: batch?.batchId || "",
                        batch: batch?.batchName || "",
                        sectionId: "",
                        section: "",
                      });
                    }}
                  >
                    <option value="">-- Select Batch --</option>
                    {selectedCourse?.batches.map((batch) => (
                      <option key={batch.batchId} value={batch.batchId}>
                        Batch {batch.batchName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>Section *</Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-emerald-500"
                    value={editedExam.sectionId || ""}
                    disabled={!selectedBatch}
                    onChange={(e) => {
                      const section = selectedBatch?.sections.find((s) => s.sectionId === e.target.value);
                      setEditedExam({
                        ...editedExam,
                        sectionId: section?.sectionId || "",
                        section: section?.sectionName || "",
                      });
                    }}
                  >
                    <option value="">-- Select Section --</option>
                    {selectedBatch?.sections.map((section) => (
                      <option key={section.sectionId} value={section.sectionId}>
                        Section {section.sectionName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Duration (Minutes) *</Label>
                <Input 
                  type="number" 
                  min="1"
                  value={editedExam.duration || 60} 
                  onChange={(e) => setEditedExam({ ...editedExam, duration: parseInt(e.target.value) || 60 })} 
                />
              </div>

              <div>
                <Label>Total Marks (Calculated automatically if questions exist)</Label>
                <Input
                  type="number"
                  min="1"
                  value={questions.length > 0 ? questions.reduce((s, q) => s + (q.marks || 0), 0) : (editedExam.totalMarks || 100)}
                  onChange={(e) => setEditedExam({ ...editedExam, totalMarks: parseInt(e.target.value) || 100 })}
                  disabled={questions.length > 0}
                />
              </div>

              <div>
                <Label>Attempts Allowed</Label>
                <Input
                  type="number"
                  min="1"
                  value={editedExam.attemptsAllowed || 1}
                  onChange={(e) => setEditedExam({ ...editedExam, attemptsAllowed: parseInt(e.target.value) || 1 })}
                />
              </div>

              <div>
                <Label>Status</Label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-medium"
                  value={editedExam.status || "draft"}
                  onChange={(e) => setEditedExam({ ...editedExam, status: e.target.value as any })}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="active">Active (Ongoing)</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              <div className="sm:col-span-1">
                <Label>Start Time</Label>
                <Input 
                  type="datetime-local" 
                  value={editedExam.startDate ? new Date(editedExam.startDate).toISOString().slice(0, 16) : ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, startDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })} 
                />
              </div>

              <div className="sm:col-span-1">
                <Label>End Time</Label>
                <Input 
                  type="datetime-local" 
                  value={editedExam.endDate ? new Date(editedExam.endDate).toISOString().slice(0, 16) : ""} 
                  onChange={(e) => setEditedExam({ ...editedExam, endDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })} 
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Question Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <HelpCircle className="h-5 w-5 text-emerald-600" /> Exam Questions ({questions.length})
                </CardTitle>
                <CardDescription>
                  Total Marks: {questions.reduce((sum, q) => sum + (q.marks || 0), 0)} | Edit, add, or delete questions
                </CardDescription>
              </div>
              <Button onClick={() => setShowNewQuestion(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4 mr-1" /> Add Question
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* New Question Form */}
            {showNewQuestion && (
              <Card className="bg-emerald-50/40 border-2 border-emerald-300">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-emerald-900">Add New Question</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Question Text *</Label>
                    <Textarea 
                      value={newQuestion.text} 
                      onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })} 
                      placeholder="Enter question prompt..."
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Question Type</Label>
                      <select
                        className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm"
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
                        min="1"
                        value={newQuestion.marks} 
                        onChange={(e) => setNewQuestion({ ...newQuestion, marks: parseInt(e.target.value) || 1 })} 
                      />
                    </div>
                  </div>

                  {newQuestion.type === "multiple-choice" && (
                    <div className="space-y-2">
                      <Label>Options & Select Correct Answer *</Label>
                      {newQuestion.options.map((opt, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input 
                            type="radio" 
                            name="newCorrectOpt" 
                            checked={newQuestion.correctAnswer === opt && opt !== ""} 
                            onChange={() => setNewQuestion({ ...newQuestion, correctAnswer: opt })} 
                            className="h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                          />
                          <Input 
                            value={opt} 
                            onChange={(e) => {
                              const updated = [...newQuestion.options];
                              updated[idx] = e.target.value;
                              setNewQuestion({ ...newQuestion, options: updated });
                            }} 
                            placeholder={`Option ${String.fromCharCode(65 + idx)}`} 
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {newQuestion.type === "true-false" && (
                    <div>
                      <Label>Correct Answer *</Label>
                      <select
                        className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm"
                        value={newQuestion.correctAnswer}
                        onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })}
                      >
                        <option value="">Select Correct Answer</option>
                        <option value="True">True</option>
                        <option value="False">False</option>
                      </select>
                    </div>
                  )}

                  {newQuestion.type === "short-answer" && (
                    <div>
                      <Label>Expected Answer (for auto-grading)</Label>
                      <Input 
                        value={newQuestion.correctAnswer} 
                        onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })} 
                        placeholder="Expected answer string"
                      />
                    </div>
                  )}

                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" size="sm" onClick={() => setShowNewQuestion(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAddQuestion} className="bg-emerald-600 hover:bg-emerald-700">Save Question</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Questions List */}
            {questions.length === 0 && !showNewQuestion ? (
              <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                <HelpCircle className="mx-auto h-10 w-10 text-gray-300 mb-2" />
                <p>No questions added yet. Click &quot;Add Question&quot; to begin.</p>
              </div>
            ) : (
              questions.map((q, idx) => (
                <Card key={q.id || idx} className="border border-gray-200">
                  <CardContent className="p-4">
                    {editingQuestionId === q.id ? (
                      /* Rich Editing Mode for Existing Question */
                      <div className="space-y-4 bg-gray-50 p-4 rounded-lg border border-gray-300">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-sm text-emerald-900">Editing Question {idx + 1}</span>
                          <Badge variant="outline">ID: {q.id.substring(0, 8)}</Badge>
                        </div>

                        <div>
                          <Label>Question Text *</Label>
                          <Textarea 
                            value={editedQuestion.text || ""} 
                            onChange={(e) => setEditedQuestion({ ...editedQuestion, text: e.target.value })} 
                            rows={2}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Question Type</Label>
                            <select
                              className="w-full h-10 px-3 rounded-md border text-sm bg-white"
                              value={editedQuestion.type || "multiple-choice"}
                              onChange={(e) => setEditedQuestion({ ...editedQuestion, type: e.target.value as any })}
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
                              min="1"
                              value={editedQuestion.marks || 10} 
                              onChange={(e) => setEditedQuestion({ ...editedQuestion, marks: parseInt(e.target.value) || 1 })} 
                            />
                          </div>
                        </div>

                        {/* MCQ Options Editing */}
                        {(editedQuestion.type || "multiple-choice") === "multiple-choice" && (
                          <div className="space-y-2">
                            <Label>Options & Radio Correct Selection *</Label>
                            {(editedQuestion.options || ["", "", "", ""]).map((opt, optIdx) => (
                              <div key={optIdx} className="flex gap-2 items-center">
                                <input 
                                  type="radio" 
                                  name={`editCorrectOpt-${q.id}`} 
                                  checked={editedQuestion.correctAnswer === opt && opt !== ""} 
                                  onChange={() => setEditedQuestion({ ...editedQuestion, correctAnswer: opt })} 
                                  className="h-4 w-4 text-emerald-600"
                                />
                                <Input 
                                  value={opt} 
                                  onChange={(e) => {
                                    const updatedOpts = [...(editedQuestion.options || ["", "", "", ""])];
                                    updatedOpts[optIdx] = e.target.value;
                                    setEditedQuestion({ ...editedQuestion, options: updatedOpts });
                                  }} 
                                  placeholder={`Option ${String.fromCharCode(65 + optIdx)}`} 
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {editedQuestion.type === "true-false" && (
                          <div>
                            <Label>Correct Answer</Label>
                            <select
                              className="w-full h-10 px-3 rounded-md border text-sm bg-white"
                              value={String(editedQuestion.correctAnswer || "")}
                              onChange={(e) => setEditedQuestion({ ...editedQuestion, correctAnswer: e.target.value })}
                            >
                              <option value="">Select Correct Answer</option>
                              <option value="True">True</option>
                              <option value="False">False</option>
                            </select>
                          </div>
                        )}

                        {editedQuestion.type === "short-answer" && (
                          <div>
                            <Label>Correct Answer String</Label>
                            <Input 
                              value={String(editedQuestion.correctAnswer || "")} 
                              onChange={(e) => setEditedQuestion({ ...editedQuestion, correctAnswer: e.target.value })} 
                            />
                          </div>
                        )}

                        <div className="flex gap-2 justify-end pt-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingQuestionId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => handleSaveQuestion(q.id)} className="bg-emerald-600 hover:bg-emerald-700">Save Question Changes</Button>
                        </div>
                      </div>
                    ) : (
                      /* Read Display Mode */
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-bold bg-emerald-50 text-emerald-900 border-emerald-200">
                              Q{idx + 1}
                            </Badge>
                            <Badge className="bg-gray-100 text-gray-700 capitalize">{q.type}</Badge>
                            <Badge className="bg-emerald-600 text-white">{q.marks} Marks</Badge>
                          </div>
                          <p className="font-semibold text-gray-900 mt-2">{q.text}</p>
                          {q.options && q.options.length > 0 && (
                            <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-gray-700">
                              {q.options.map((opt, i) => (
                                <div 
                                  key={i} 
                                  className={`p-2 rounded border ${
                                    opt === (q as any).correctAnswer 
                                      ? "bg-emerald-50 border-emerald-300 font-semibold text-emerald-900" 
                                      : "bg-gray-50 border-gray-200"
                                  }`}
                                >
                                  {String.fromCharCode(65 + i)}. {opt} {opt === (q as any).correctAnswer && " ✓ (Correct)"}
                                </div>
                              ))}
                            </div>
                          )}
                          {(!q.options || q.options.length === 0) && (q as any).correctAnswer && (
                            <p className="text-xs text-emerald-800 font-medium mt-1">
                              Answer: {(q as any).correctAnswer}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEditQuestion(q)} title="Edit Question">
                            <Edit2 className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteQuestion(q.id)} title="Delete Question">
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
