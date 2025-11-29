"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Loader2, Plus, Trash2 } from "lucide-react";
import { createExam, createQuestion } from "@/lib/firebase/exams";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface QuestionForm {
  id: string;
  text: string;
  type: "multiple-choice" | "short-answer" | "essay";
  options: string[];
  correctAnswer: string;
  marks: number;
}

export default function CreateExamPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  
  const [examData, setExamData] = useState({
    title: "",
    description: "",
    duration: 60,
    totalMarks: 100,
    passingMarks: 40,
    instructions: "",
  });

  const [questions, setQuestions] = useState<QuestionForm[]>([]);

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: `q-${Date.now()}`,
        text: "",
        type: "multiple-choice",
        options: ["", "", "", ""],
        correctAnswer: "",
        marks: 10,
      },
    ]);
  };

  const updateQuestion = (index: number, field: keyof QuestionForm, value: any) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: value };
    setQuestions(updated);
  };

  const updateOption = (qIndex: number, oIndex: number, value: string) => {
    const updated = [...questions];
    updated[qIndex].options[oIndex] = value;
    setQuestions(updated);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!examData.title.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter an exam title",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Create exam
      const examId = await createExam({
        title: examData.title,
        description: examData.description,
        duration: examData.duration,
        totalMarks: examData.totalMarks,
        passingMarks: examData.passingMarks,
        instructions: examData.instructions,
        teacherId: user.id,
        status: "draft",
        questionCount: questions.length,
        settings: {
          requireWebcam: true,
          allowedTabSwitches: 3,
          faceMissingTolerance: 10,
          attentionTimeout: 30,
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
        },
      });

      // Create questions
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await createQuestion({
          examId,
          text: q.text,
          type: q.type,
          options: q.type === "multiple-choice" ? q.options.filter(o => o.trim()) : [],
          correctAnswer: q.correctAnswer,
          marks: q.marks,
          order: i + 1,
        });
      }

      toast({
        title: "Exam Created",
        description: "Your exam has been created successfully.",
      });

      router.push("/dashboard/admin/exams");
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
    <DashboardLayout role="admin">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create New Exam</h1>
            <p className="text-gray-600">Set up a new exam with questions</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Exam Details */}
          <Card>
            <CardHeader>
              <CardTitle>Exam Details</CardTitle>
              <CardDescription>Basic information about the exam</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Exam Title *</Label>
                <Input
                  id="title"
                  value={examData.title}
                  onChange={(e) => setExamData({ ...examData, title: e.target.value })}
                  placeholder="Enter exam title"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={examData.description}
                  onChange={(e) => setExamData({ ...examData, description: e.target.value })}
                  placeholder="Brief description of the exam"
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
                  <Label htmlFor="totalMarks">Total Marks</Label>
                  <Input
                    id="totalMarks"
                    type="number"
                    min="1"
                    value={examData.totalMarks}
                    onChange={(e) => setExamData({ ...examData, totalMarks: parseInt(e.target.value) || 100 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passingMarks">Passing Marks</Label>
                  <Input
                    id="passingMarks"
                    type="number"
                    min="0"
                    value={examData.passingMarks}
                    onChange={(e) => setExamData({ ...examData, passingMarks: parseInt(e.target.value) || 40 })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructions">Instructions</Label>
                <Textarea
                  id="instructions"
                  value={examData.instructions}
                  onChange={(e) => setExamData({ ...examData, instructions: e.target.value })}
                  placeholder="Instructions for students taking the exam"
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Questions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Questions</CardTitle>
                  <CardDescription>Add questions to your exam</CardDescription>
                </div>
                <Button type="button" onClick={addQuestion} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Question
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {questions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No questions added yet.</p>
                  <Button type="button" onClick={addQuestion} variant="link">
                    Add your first question
                  </Button>
                </div>
              ) : (
                questions.map((question, qIndex) => (
                  <div key={question.id} className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-4">
                        <div className="flex items-center gap-4">
                          <span className="font-medium text-gray-700">Q{qIndex + 1}</span>
                          <select
                            value={question.type}
                            onChange={(e) => updateQuestion(qIndex, "type", e.target.value)}
                            className="text-sm border rounded-lg px-3 py-1.5"
                          >
                            <option value="multiple-choice">Multiple Choice</option>
                            <option value="short-answer">Short Answer</option>
                            <option value="essay">Essay</option>
                          </select>
                          <Input
                            type="number"
                            min="1"
                            value={question.marks}
                            onChange={(e) => updateQuestion(qIndex, "marks", parseInt(e.target.value) || 1)}
                            className="w-20"
                            placeholder="Marks"
                          />
                        </div>

                        <Textarea
                          value={question.text}
                          onChange={(e) => updateQuestion(qIndex, "text", e.target.value)}
                          placeholder="Enter question text"
                          rows={2}
                        />

                        {question.type === "multiple-choice" && (
                          <div className="space-y-2">
                            <Label>Options</Label>
                            {question.options.map((option, oIndex) => (
                              <div key={oIndex} className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={`correct-${qIndex}`}
                                  checked={question.correctAnswer === option && option !== ""}
                                  onChange={() => updateQuestion(qIndex, "correctAnswer", option)}
                                  className="text-green-600"
                                />
                                <Input
                                  value={option}
                                  onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                                  placeholder={`Option ${oIndex + 1}`}
                                  className="flex-1"
                                />
                              </div>
                            ))}
                            <p className="text-xs text-gray-500">Select the radio button for the correct answer</p>
                          </div>
                        )}

                        {question.type === "short-answer" && (
                          <div className="space-y-2">
                            <Label>Expected Answer</Label>
                            <Input
                              value={question.correctAnswer}
                              onChange={(e) => updateQuestion(qIndex, "correctAnswer", e.target.value)}
                              placeholder="Enter expected answer"
                            />
                          </div>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(qIndex)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Create Exam
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
