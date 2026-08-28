"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  FileText,
  Calendar,
  Award,
  TrendingUp,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BookOpen,
  Users,
  GraduationCap,
  Clock,
  AlertCircle,
  DollarSign,
  Info,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getResultDetails,
  getStudentWarnings,
  getGradeColor,
  getGpaColor,
  getWarningStyle,
} from "@/lib/firebase/results";
import { Result, StudentWarning, WarningType } from "@/lib/types";
import { isEvaluationInProgress } from "@/lib/server/ai-evaluation";

export default function ResultDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [result, setResult] = useState<Result | null>(null);
  const [warnings, setWarnings] = useState<StudentWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resultId = params.id as string;

  useEffect(() => {
    if (user && resultId) {
      loadData();
    }
  }, [user, resultId]);

  const loadData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);

      const resultData = await getResultDetails(resultId);

      // Security: Ensure student can only view their own results
      if (!resultData) {
        setError("Result not found.");
        return;
      }

      if (resultData.studentId !== user.id) {
        setError("You are not authorized to view this result.");
        return;
      }

      setResult(resultData);

      // Warnings are supplementary — never let them fail the whole page. This
      // query needs a (studentId, dateIssued) composite index; without it the
      // FAILED_PRECONDITION used to bubble up and render "Failed to load
      // result details" even though the result itself had loaded fine.
      try {
        const warningsData = await getStudentWarnings(user.id);
        const relatedWarnings = warningsData.filter(
          (w) => w.relatedResultId === resultId || w.status === "active"
        );
        setWarnings(relatedWarnings);
      } catch (warningError) {
        console.warn("Could not load related warnings:", warningError);
        setWarnings([]);
      }
    } catch (error) {
      console.error("Error loading result details:", error);
      setError("Failed to load result details.");
      toast({
        title: "Error",
        description: "Failed to load result details",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    const d = date?.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (date: any) => {
    if (!date) return "N/A";
    const d = date?.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getWarningIcon = (type: WarningType) => {
    switch (type) {
      case "attendance": return <AlertCircle className="h-5 w-5 text-orange-600" />;
      case "academic": return <BookOpen className="h-5 w-5 text-red-600" />;
      case "low_gpa": return <TrendingUp className="h-5 w-5 text-yellow-600" />;
      case "failed_subject": return <XCircle className="h-5 w-5 text-red-700" />;
      case "due_payment": return <DollarSign className="h-5 w-5 text-purple-600" />;
      case "custom": return <Info className="h-5 w-5 text-blue-600" />;
      default: return <AlertTriangle className="h-5 w-5 text-gray-600" />;
    }
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

  if (error || !result) {
    return (
      <DashboardLayout role="student">
        <div className="max-w-2xl mx-auto text-center py-12">
          <XCircle className="mx-auto h-16 w-16 text-red-400" />
          <h2 className="mt-4 text-xl font-semibold text-gray-700">
            {error || "Result not found"}
          </h2>
          <p className="mt-2 text-gray-500">
            The result you are looking for could not be accessed.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => router.push("/dashboard/student/results")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Results
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const isPassed = result.passFailStatus === "Pass";
  const evaluationPending = isEvaluationInProgress(result.evaluationStatus);

  return (
    <DashboardLayout role="student">
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/student/results")}
          className="text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Results
        </Button>

        {/* Header Card */}
        <Card className="bg-gradient-to-r from-slate-900 to-slate-800 text-white overflow-hidden">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-slate-300 text-sm">
                  <FileText className="h-4 w-4" />
                  <span>{result.examName}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold mt-1 text-white">
                  {result.courseName}
                </h1>
                {result.courseCode && (
                  <p className="text-slate-300 text-sm mt-1">{result.courseCode}</p>
                )}
              </div>
              {/* While the AI evaluation is still running the stored 0 is an
                  absence, not a score — showing "0% FAILED" here would be a
                  lie that corrects itself a few minutes later. */}
              {evaluationPending ? (
                <div className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-200" />
                  <span className="text-sm font-medium text-blue-100">
                    AI Evaluation Processing...
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-3xl font-bold">{result.percentage.toFixed(1)}%</p>
                    <p className="text-slate-300 text-sm">
                      {result.obtainedMarks} / {result.totalMarks} Marks
                    </p>
                  </div>
                  <Badge
                    className={
                      isPassed
                        ? "bg-emerald-500 text-white text-sm px-3 py-1"
                        : "bg-red-500 text-white text-sm px-3 py-1"
                    }
                  >
                    {isPassed ? "PASSED" : "FAILED"}
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Warning Cards Section */}
        {warnings.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Warnings & Notices
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {warnings.map((warning) => {
                const style = getWarningStyle(warning.warningType);
                return (
                  <Card
                    key={warning.id}
                    className={`border-2 ${style.bgColor}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {getWarningIcon(warning.warningType)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-sm truncate" style={{ color: style.color }}>
                              {warning.title}
                            </h3>
                            <Badge
                              variant="outline"
                              className={
                                warning.status === "active"
                                  ? "bg-red-100 text-red-700 border-red-200 text-xs"
                                  : "bg-green-100 text-green-700 border-green-200 text-xs"
                              }
                            >
                              {warning.status === "active" ? "Active" : "Resolved"}
                            </Badge>
                          </div>
                          <p className="text-xs mt-1 text-gray-600 line-clamp-2">{warning.description}</p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(warning.dateIssued)}</span>
                            {warning.issuedByName && (
                              <>
                                <span>•</span>
                                <span>By: {warning.issuedByName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Academic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Academic Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Course</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{result.courseName}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Batch</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{result.batchName}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Section</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{result.sectionName}</p>
              </div>
              {result.semester && (
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 font-medium">Semester</p>
                  <p className="text-sm font-semibold text-gray-800 mt-1">{result.semester}</p>
                </div>
              )}
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Academic Year</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{result.academicYear}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Exam Name</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{result.examName}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Exam Date</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{formatDate(result.examDate)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Published Date</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">
                  {formatDate(result.resultPublishedDate)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subject-wise Marks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-indigo-600" />
              Subject-wise Marks
            </CardTitle>
            <CardDescription>
              Detailed marks breakdown for each subject
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.subjects && result.subjects.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">#</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Subject</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Total Marks</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Obtained</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Grade</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-700">Grade Point</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.subjects.map((subject, index) => {
                      const subjectPercentage = (subject.obtainedMarks / subject.totalMarks) * 100;
                      const isSubjectPassed = subject.isPassed !== undefined
                        ? subject.isPassed
                        : subjectPercentage >= 40;

                      return (
                        <tr
                          key={subject.id || index}
                          className={`border-b border-gray-100 transition-colors ${
                            !isSubjectPassed ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="py-3 px-4 text-gray-500">{index + 1}</td>
                          <td className={`py-3 px-4 font-medium ${!isSubjectPassed ? "text-red-700" : "text-gray-900"}`}>
                            <div className="flex items-center gap-2">
                              {subject.subjectName}
                              {subject.subjectCode && (
                                <span className="text-xs text-gray-400">({subject.subjectCode})</span>
                              )}
                              {!isSubjectPassed && (
                                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-gray-700">{subject.totalMarks}</td>
                          <td className={`py-3 px-4 text-right font-semibold ${!isSubjectPassed ? "text-red-600" : "text-gray-800"}`}>
                            {subject.obtainedMarks}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {subject.grade ? (
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getGradeColor(subject.grade)}`}>
                                {subject.grade}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {subject.gradePoint !== undefined ? (
                              <span className="text-gray-700">{subject.gradePoint.toFixed(2)}</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge
                              variant="outline"
                              className={
                                isSubjectPassed
                                  ? "bg-green-100 text-green-700 border-green-200 text-xs"
                                  : "bg-red-100 text-red-700 border-red-200 text-xs"
                              }
                            >
                              {isSubjectPassed ? "Pass" : "Fail"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                      <td colSpan={2} className="py-3 px-4 text-gray-800">Total</td>
                      <td className="py-3 px-4 text-right text-gray-800">{result.totalMarks}</td>
                      <td className="py-3 px-4 text-right text-gray-800">{result.obtainedMarks}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getGradeColor(result.grade)}`}>
                          {result.grade}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {result.gpa !== undefined ? (
                          <span className="text-gray-800">{result.gpa.toFixed(2)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          className={
                            isPassed
                              ? "bg-green-100 text-green-700 border-green-200"
                              : "bg-red-100 text-red-700 border-red-200"
                          }
                          variant="outline"
                        >
                          {isPassed ? "Pass" : "Fail"}
                        </Badge>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-4">No subject-wise marks available for this result.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <FileText className="h-8 w-8 text-blue-600 mx-auto" />
              <p className="text-2xl font-bold mt-2">{result.totalMarks}</p>
              <p className="text-sm text-gray-500">Total Marks</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <TrendingUp className="h-8 w-8 text-green-600 mx-auto" />
              <p className="text-2xl font-bold mt-2">{result.obtainedMarks}</p>
              <p className="text-sm text-gray-500">Obtained Marks</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <Award className="h-8 w-8 text-purple-600 mx-auto" />
              <p className="text-2xl font-bold mt-2">{result.percentage.toFixed(1)}%</p>
              <p className="text-sm text-gray-500">Percentage</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <GraduationCap className="h-8 w-8 text-yellow-600 mx-auto" />
              <p className="text-2xl font-bold mt-2">{result.gpa?.toFixed(2) || "N/A"}</p>
              <p className="text-sm text-gray-500">GPA</p>
            </CardContent>
          </Card>
        </div>

        {/* Additional Info */}
        {result.position && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 justify-center">
                <Award className="h-10 w-10 text-amber-500" />
                <div>
                  <p className="text-lg font-bold">Position / Rank</p>
                  <p className="text-sm text-gray-500">
                    {result.position}{result.position === 1 ? "st" : result.position === 2 ? "nd" : result.position === 3 ? "rd" : "th"} position
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
