"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Loader2, Plus, Trash2, AlertCircle } from "lucide-react";
import {
  createExam,
  createQuestion,
  getGlobalProctoringDefaults,
  notifyExamPublished,
} from "@/lib/firebase/exams";
import {
  getAllAssignments,
  groupAssignmentsByCourse,
  computeAssignmentTargetStudentIds,
  AssignedCatalogEntry,
} from "@/lib/firebase/assignments";
import { getUsersByRole } from "@/lib/firebase/firestore";
import { TeacherAssignment, User as UserType } from "@/lib/types";
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
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [teachers, setTeachers] = useState<UserType[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);

  const [examData, setExamData] = useState({
    title: "",
    description: "",
    duration: 60,
    totalMarks: 100,
    passingMarks: 40,
    instructions: "",
    teacherId: "",
    courseId: "",
    batchId: "",
    sectionId: "",
  });

  const [questions, setQuestions] = useState<QuestionForm[]>([]);

  // An exam has to belong to a teacher and a Course/Batch/Section: students see
  // an exam through `targetStudentIds`, which is resolved from that teacher's
  // admin assignment. This page used to create exams with `teacherId` set to
  // the *admin*, no course, batch or section, and therefore no targets — so an
  // admin-created exam was invisible to every student no matter its status.
  useEffect(() => {
    (async () => {
      try {
        const [teacherUsers, allAssignments] = await Promise.all([
          getUsersByRole("teacher"),
          getAllAssignments(),
        ]);
        setTeachers(teacherUsers.filter((t) => t.approved && !t.rejected));
        setAssignments(allAssignments);
      } catch (err) {
        console.error("Failed to load teachers/assignments:", err);
        toast({
          title: "Error",
          description: "Could not load teachers and their assigned courses.",
          variant: "destructive",
        });
      } finally {
        setCatalogLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teacherCatalog: AssignedCatalogEntry[] = useMemo(
    () =>
      examData.teacherId
        ? groupAssignmentsByCourse(
            assignments.filter((a) => a.teacherId === examData.teacherId)
          )
        : [],
    [assignments, examData.teacherId]
  );

  const selectedCourse = teacherCatalog.find((c) => c.courseId === examData.courseId);
  const selectedBatch = selectedCourse?.batches.find((b) => b.batchId === examData.batchId);
  const teachersWithAssignments = useMemo(() => {
    const ids = new Set(assignments.map((a) => a.teacherId));
    return teachers.filter((t) => ids.has(t.id));
  }, [teachers, assignments]);

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

  const validate = (status: "draft" | "published"): string | null => {
    if (!examData.title.trim()) return "Please enter an exam title.";
    if (!examData.teacherId) return "Please choose the teacher who owns this exam.";
    if (!examData.courseId || !examData.batchId || !examData.sectionId) {
      return "Please choose the Course, Batch and Section this exam targets.";
    }
    if (examData.duration < 1) return "Duration must be at least 1 minute.";
    if (examData.totalMarks < 1) return "Total marks must be at least 1.";
    if (examData.passingMarks < 0 || examData.passingMarks > examData.totalMarks) {
      return "Passing marks must be between 0 and the total marks.";
    }

    if (status === "published") {
      // An exam with no questions cannot be sat, so it must not reach students.
      if (questions.length === 0) {
        return "Add at least one question before publishing. Save as a draft instead.";
      }
      for (const [i, q] of questions.entries()) {
        if (!q.text.trim()) return `Question ${i + 1} has no text.`;
        if (q.marks < 1) return `Question ${i + 1} must be worth at least 1 mark.`;
        if (q.type === "multiple-choice") {
          const filled = q.options.filter((o) => o.trim());
          if (filled.length < 2) return `Question ${i + 1} needs at least two options.`;
          if (!q.correctAnswer.trim()) return `Question ${i + 1} has no correct answer selected.`;
        }
      }
    }
    return null;
  };

  const handleSubmit = async (
    e: React.FormEvent,
    status: "draft" | "published" = "draft"
  ) => {
    e.preventDefault();
    if (!user || saving) return;

    const problem = validate(status);
    if (problem) {
      toast({ title: "Validation Error", description: problem, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const [proctoringDefaults, targetStudentIds] = await Promise.all([
        getGlobalProctoringDefaults(),
        computeAssignmentTargetStudentIds(
          examData.teacherId,
          examData.courseId,
          examData.batchId,
          examData.sectionId
        ),
      ]);

      if (status === "published" && targetStudentIds.length === 0) {
        toast({
          title: "No students in this group",
          description:
            "Nobody is enrolled in that Course/Batch/Section, so publishing would reach no one. Save it as a draft instead.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      const courseEntry = teacherCatalog.find((c) => c.courseId === examData.courseId);
      const batchEntry = courseEntry?.batches.find((b) => b.batchId === examData.batchId);
      const sectionEntry = batchEntry?.sections.find((s) => s.sectionId === examData.sectionId);

      // Create exam
      const examId = await createExam({
        title: examData.title,
        description: examData.description,
        duration: examData.duration,
        totalMarks: examData.totalMarks,
        passingMarks: examData.passingMarks,
        instructions: examData.instructions,
        teacherId: examData.teacherId,
        teacherName: teachers.find((t) => t.id === examData.teacherId)?.name,
        courseId: examData.courseId,
        courseName: courseEntry?.courseName,
        batchId: examData.batchId,
        batch: batchEntry?.batchName,
        sectionId: examData.sectionId,
        section: sectionEntry?.sectionName,
        targetStudentIds,
        createdBy: user.id,
        status,
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
          proctoring: proctoringDefaults,
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

      if (status === "published" && targetStudentIds.length > 0) {
        notifyExamPublished(examId, targetStudentIds).catch((err) =>
          console.warn("[AdminCreateExam] Failed to send publish notifications:", err)
        );
      }

      toast({
        title: status === "draft" ? "Draft Saved" : "Exam Published",
        description:
          status === "draft"
            ? "The exam was saved as a draft. Publish it when the questions are ready."
            : `Published to ${targetStudentIds.length} student${targetStudentIds.length !== 1 ? "s" : ""}.`,
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

        <form onSubmit={(e) => handleSubmit(e, "draft")} className="space-y-6">
          {/* Ownership & audience */}
          <Card>
            <CardHeader>
              <CardTitle>Teacher &amp; Audience</CardTitle>
              <CardDescription>
                Who owns this exam, and which group of students can see it
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {catalogLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading teachers and assigned courses...
                </div>
              ) : teachersWithAssignments.length === 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    No approved teacher has a course assignment yet. Create one under{" "}
                    <strong>Assignments</strong> first — an exam needs a teacher and a
                    Course/Batch/Section to reach any student.
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="teacher">Teacher *</Label>
                    <select
                      id="teacher"
                      className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm"
                      value={examData.teacherId}
                      onChange={(e) =>
                        setExamData({
                          ...examData,
                          teacherId: e.target.value,
                          courseId: "",
                          batchId: "",
                          sectionId: "",
                        })
                      }
                    >
                      <option value="">Select a teacher</option>
                      {teachersWithAssignments.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="course">Course *</Label>
                    <select
                      id="course"
                      className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm disabled:bg-gray-50"
                      value={examData.courseId}
                      disabled={!examData.teacherId}
                      onChange={(e) =>
                        setExamData({
                          ...examData,
                          courseId: e.target.value,
                          batchId: "",
                          sectionId: "",
                        })
                      }
                    >
                      <option value="">
                        {examData.teacherId ? "Select a course" : "Choose a teacher first"}
                      </option>
                      {teacherCatalog.map((c) => (
                        <option key={c.courseId} value={c.courseId}>
                          {c.courseCode ? `${c.courseCode} — ` : ""}
                          {c.courseName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="batch">Batch *</Label>
                    <select
                      id="batch"
                      className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm disabled:bg-gray-50"
                      value={examData.batchId}
                      disabled={!examData.courseId}
                      onChange={(e) =>
                        setExamData({ ...examData, batchId: e.target.value, sectionId: "" })
                      }
                    >
                      <option value="">
                        {examData.courseId ? "Select a batch" : "Choose a course first"}
                      </option>
                      {(selectedCourse?.batches ?? []).map((b) => (
                        <option key={b.batchId} value={b.batchId}>
                          Batch {b.batchName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="section">Section *</Label>
                    <select
                      id="section"
                      className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm disabled:bg-gray-50"
                      value={examData.sectionId}
                      disabled={!examData.batchId}
                      onChange={(e) => setExamData({ ...examData, sectionId: e.target.value })}
                    >
                      <option value="">
                        {examData.batchId ? "Select a section" : "Choose a batch first"}
                      </option>
                      {(selectedBatch?.sections ?? []).map((sec) => (
                        <option key={sec.sectionId} value={sec.sectionId}>
                          Section {sec.sectionName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

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
          <div className="flex flex-col sm:flex-row justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="outline" disabled={saving || catalogLoading}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save as Draft
            </Button>
            <Button
              type="button"
              onClick={(e) => handleSubmit(e, "published")}
              disabled={saving || catalogLoading}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish Exam
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
