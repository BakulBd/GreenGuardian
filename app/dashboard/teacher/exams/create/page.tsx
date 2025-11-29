"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { 
  Save, 
  Loader2, 
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  FileText,
  Upload as UploadIcon,
  ListChecks
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import Link from "next/link";
import FileUpload from "@/components/FileUpload";
import { UploadResult } from "@/lib/firebase/storage";

interface Question {
  id: string;
  text: string;
  type: "multiple-choice" | "true-false" | "short-answer";
  options: string[];
  correctAnswer: string;
  marks: number;
}

export default function CreateExamPage() {
  const [saving, setSaving] = useState(false);
  const [examMode, setExamMode] = useState<"online" | "upload">("online");
  const [examData, setExamData] = useState({
    title: "",
    description: "",
    duration: 60,
    totalMarks: 100,
    passingScore: 40,
    startDate: "",
    endDate: "",
    shuffleQuestions: true,
    showResults: true,
    attemptsAllowed: 1,
    allowAnswerUpload: false,
  });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [examPapers, setExamPapers] = useState<UploadResult[]>([]);
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const addQuestion = () => {
    const newQuestion: Question = {
      id: Date.now().toString(),
      text: "",
      type: "multiple-choice",
      options: ["", "", "", ""],
      correctAnswer: "",
      marks: 10,
    };
    setQuestions([...questions, newQuestion]);
  };

  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, ...updates } : q));
  };

  const removeQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  const updateOption = (questionId: string, optionIndex: number, value: string) => {
    setQuestions(questions.map(q => {
      if (q.id === questionId) {
        const newOptions = [...q.options];
        newOptions[optionIndex] = value;
        return { ...q, options: newOptions };
      }
      return q;
    }));
  };

  const handleSubmit = async (status: "draft" | "published") => {
    if (!user) return;

    if (!examData.title.trim()) {
      toast({
        title: "Error",
        description: "Please enter an exam title",
        variant: "destructive",
      });
      return;
    }

    // Validate based on exam mode
    if (examMode === "online") {
      if (questions.length === 0) {
        toast({
          title: "Error",
          description: "Please add at least one question",
          variant: "destructive",
        });
        return;
      }

      // Validate questions
      for (const q of questions) {
        if (!q.text.trim()) {
          toast({
            title: "Error",
            description: "All questions must have text",
            variant: "destructive",
          });
          return;
        }
        if (q.type === "multiple-choice" && !q.correctAnswer) {
          toast({
            title: "Error",
            description: "All multiple choice questions must have a correct answer",
            variant: "destructive",
          });
          return;
        }
      }
    } else {
      // Upload mode - must have at least one exam paper
      if (examPapers.length === 0) {
        toast({
          title: "Error",
          description: "Please upload at least one exam paper",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const totalMarks = examMode === "online" 
        ? questions.reduce((sum, q) => sum + q.marks, 0)
        : examData.totalMarks;
      
      const examDoc: any = {
        ...examData,
        totalMarks,
        examMode,
        status,
        teacherId: user.id,
        createdBy: user.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Add questions or exam papers based on mode
      if (examMode === "online") {
        examDoc.questions = questions;
      } else {
        examDoc.examPapers = examPapers;
        examDoc.allowAnswerUpload = true;
      }

      const examRef = await addDoc(collection(db, "exams"), examDoc);

      toast({
        title: "Success",
        description: status === "draft" ? "Exam saved as draft" : "Exam published successfully",
      });

      router.push("/dashboard/teacher/exams");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create exam",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard/teacher/exams">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Create Exam</h1>
            <p className="text-gray-600 mt-1">Set up your exam details and questions</p>
          </div>
        </div>

        {/* Exam Mode Tabs */}
        <TabsPrimitive.Root value={examMode} onValueChange={(v: string) => setExamMode(v as "online" | "upload")}>
          <TabsPrimitive.List className="grid w-full grid-cols-2">
            <TabsPrimitive.Trigger value="online" className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Online Questions
            </TabsPrimitive.Trigger>
            <TabsPrimitive.Trigger value="upload" className="flex items-center gap-2">
              <UploadIcon className="h-4 w-4" />
              Upload Paper
            </TabsPrimitive.Trigger>
          </TabsPrimitive.List>
          
          <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
            {examMode === "online" ? (
              <p>Create questions directly. Students answer online with automatic proctoring.</p>
            ) : (
              <p>Upload PDF/documents as exam paper. Students can view and upload handwritten answers.</p>
            )}
          </div>
        </TabsPrimitive.Root>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Exam Details</CardTitle>
            <CardDescription>Basic information about the exam</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={examData.title}
                onChange={(e) => setExamData({ ...examData, title: e.target.value })}
                placeholder="Enter exam title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={examData.description}
                onChange={(e) => setExamData({ ...examData, description: e.target.value })}
                placeholder="Enter exam description"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  min="1"
                  value={examData.duration}
                  onChange={(e) => setExamData({ ...examData, duration: parseInt(e.target.value) || 60 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="passingScore">Passing Score (%)</Label>
                <Input
                  id="passingScore"
                  type="number"
                  min="0"
                  max="100"
                  value={examData.passingScore}
                  onChange={(e) => setExamData({ ...examData, passingScore: parseInt(e.target.value) || 40 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="attempts">Attempts Allowed</Label>
                <Input
                  id="attempts"
                  type="number"
                  min="1"
                  value={examData.attemptsAllowed}
                  onChange={(e) => setExamData({ ...examData, attemptsAllowed: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="datetime-local"
                  value={examData.startDate}
                  onChange={(e) => setExamData({ ...examData, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="datetime-local"
                  value={examData.endDate}
                  onChange={(e) => setExamData({ ...examData, endDate: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Exam Settings</CardTitle>
            <CardDescription>Configure exam behavior</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Shuffle Questions</Label>
                <p className="text-sm text-gray-500">Randomize question order for each student</p>
              </div>
              <Switch
                checked={examData.shuffleQuestions}
                onCheckedChange={(checked) => setExamData({ ...examData, shuffleQuestions: checked })}
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Show Results</Label>
                <p className="text-sm text-gray-500">Show results to students after submission</p>
              </div>
              <Switch
                checked={examData.showResults}
                onCheckedChange={(checked) => setExamData({ ...examData, showResults: checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Upload Exam Paper Section - for upload mode */}
        {examMode === "upload" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Exam Paper
              </CardTitle>
              <CardDescription>
                Upload your exam paper as PDF, Word document, or images
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload
                basePath={`exams/${user?.id}/papers`}
                onUploadComplete={(files) => setExamPapers(files)}
                maxFiles={10}
              />
              
              <div className="space-y-2">
                <Label htmlFor="totalMarks">Total Marks *</Label>
                <Input
                  id="totalMarks"
                  type="number"
                  min="1"
                  value={examData.totalMarks}
                  onChange={(e) => setExamData({ ...examData, totalMarks: parseInt(e.target.value) || 100 })}
                  placeholder="Enter total marks for this exam"
                />
                <p className="text-xs text-gray-500">
                  Since this is a paper-based exam, you need to specify the total marks manually.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Questions - for online mode */}
        {examMode === "online" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Questions</CardTitle>
                <CardDescription>
                  {questions.length} question{questions.length !== 1 ? "s" : ""} • 
                  Total: {questions.reduce((sum, q) => sum + q.marks, 0)} marks
                </CardDescription>
              </div>
              <Button onClick={addQuestion} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Question
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {questions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No questions added yet</p>
                <Button onClick={addQuestion} variant="outline" className="mt-2">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Your First Question
                </Button>
              </div>
            ) : (
              questions.map((question, index) => (
                <div key={question.id} className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-5 w-5 text-gray-400" />
                      <span className="font-medium">Question {index + 1}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeQuestion(question.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Question Text *</Label>
                    <Textarea
                      value={question.text}
                      onChange={(e) => updateQuestion(question.id, { text: e.target.value })}
                      placeholder="Enter your question"
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Question Type</Label>
                      <select
                        className="w-full px-3 py-2 border rounded-md"
                        value={question.type}
                        onChange={(e) => updateQuestion(question.id, { 
                          type: e.target.value as Question["type"],
                          options: e.target.value === "true-false" ? ["True", "False"] : ["", "", "", ""],
                        })}
                      >
                        <option value="multiple-choice">Multiple Choice</option>
                        <option value="true-false">True/False</option>
                        <option value="short-answer">Short Answer</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Marks</Label>
                      <Input
                        type="number"
                        min="1"
                        value={question.marks}
                        onChange={(e) => updateQuestion(question.id, { marks: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>

                  {question.type !== "short-answer" && (
                    <div className="space-y-2">
                      <Label>Options</Label>
                      <div className="space-y-2">
                        {question.options.map((option, optIndex) => (
                          <div key={optIndex} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`correct-${question.id}`}
                              checked={question.correctAnswer === option && option !== ""}
                              onChange={() => updateQuestion(question.id, { correctAnswer: option })}
                              className="h-4 w-4"
                            />
                            <Input
                              value={option}
                              onChange={(e) => updateOption(question.id, optIndex, e.target.value)}
                              placeholder={`Option ${optIndex + 1}`}
                              className="flex-1"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500">Select the radio button next to the correct answer</p>
                    </div>
                  )}

                  {question.type === "short-answer" && (
                    <div className="space-y-2">
                      <Label>Expected Answer (for auto-grading)</Label>
                      <Input
                        value={question.correctAnswer}
                        onChange={(e) => updateQuestion(question.id, { correctAnswer: e.target.value })}
                        placeholder="Enter expected answer"
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button
            variant="outline"
            onClick={() => handleSubmit("draft")}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save as Draft
          </Button>
          <Button
            onClick={() => handleSubmit("published")}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Publish Exam
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
