"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  FileText,
  Calendar,
  Eye,
  Loader2,
  AlertTriangle,
  BookOpen,
  Filter,
  RefreshCw,
  TrendingUp,
  Award,
  Clock,
  Ban,
  XCircle,
  AlertCircle,
  DollarSign,
  Info,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import {
  getStudentResults,
  getStudentWarnings,
  subscribeToResults,
  subscribeToWarnings,
  getGradeColor,
  getGpaColor,
  getWarningStyle,
} from "@/lib/firebase/results";
import { Result, StudentWarning, WarningType, ResultFilters } from "@/lib/types";
// Pure helper (no model client, no Firestore) — safe in a client component.
import { isEvaluationInProgress } from "@/lib/server/ai-evaluation";

export default function StudentResultsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [results, setResults] = useState<Result[]>([]);
  const [warnings, setWarnings] = useState<StudentWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ResultFilters>({});

  // Available filter options (derived from results)
  const [filterOptions, setFilterOptions] = useState({
    courses: [] as string[],
    batches: [] as string[],
    sections: [] as string[],
    semesters: [] as string[],
    academicYears: [] as string[],
    examNames: [] as string[],
  });

  // Load data initially
  useEffect(() => {
    if (user) {
      loadResults();
      loadWarnings();
    }
  }, [user]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!user) return;

    // `subscribeToResults` watches ONLY the `results` collection, which nothing
    // in the app currently writes. getStudentResults() additionally synthesizes
    // results from the student's submitted exam sessions — so assigning the
    // raw snapshot here used to wipe every exam result off the page the moment
    // the listener fired. Re-run the full merge instead of overwriting.
    const unsubResults = subscribeToResults(user.id, () => {
      loadResults();
    });

    const unsubWarnings = subscribeToWarnings(user.id, (updatedWarnings) => {
      setWarnings(updatedWarnings);
    });

    return () => {
      unsubResults();
      unsubWarnings();
    };
  }, [user]);

  const loadResults = async () => {
    if (!user) return;
    try {
      const data = await getStudentResults(user.id);
      setResults(data);
      deriveFilterOptions(data);
    } catch (error) {
      console.error("Error loading results:", error);
      toast({
        title: "Error",
        description: "Failed to load results",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadWarnings = async () => {
    if (!user) return;
    try {
      const data = await getStudentWarnings(user.id, "active");
      setWarnings(data);
    } catch (error) {
      console.error("Error loading warnings:", error);
    }
  };

  const deriveFilterOptions = (results: Result[]) => {
    const courses = [...new Set(results.map((r) => r.courseName).filter(Boolean))] as string[];
    const batches = [...new Set(results.map((r) => r.batchName).filter(Boolean))] as string[];
    const sections = [...new Set(results.map((r) => r.sectionName).filter(Boolean))] as string[];
    const semesters = [...new Set(results.map((r) => r.semester).filter(Boolean))] as string[];
    const academicYears = [...new Set(results.map((r) => r.academicYear).filter(Boolean))] as string[];
    const examNames = [...new Set(results.map((r) => r.examName).filter(Boolean))] as string[];

    setFilterOptions({ courses, batches, sections, semesters, academicYears, examNames });
  };

  const handleFilterChange = (key: keyof ResultFilters, value: string) => {
    if (value === "all" || value === "") {
      const newFilters = { ...filters };
      delete newFilters[key];
      setFilters(newFilters);
    } else {
      setFilters((prev) => ({ ...prev, [key]: value }));
    }
  };

  const clearFilters = () => {
    setFilters({});
    setSearchQuery("");
  };

  const applyFilters = useCallback(() => {
    if (!user) return [];
    let filtered = [...results];

    // Apply client-side filters
    if (filters.courseName) {
      filtered = filtered.filter((r) => r.courseName === filters.courseName);
    }
    if (filters.batchName) {
      filtered = filtered.filter((r) => r.batchName === filters.batchName);
    }
    if (filters.sectionName) {
      filtered = filtered.filter((r) => r.sectionName === filters.sectionName);
    }
    if (filters.semester) {
      filtered = filtered.filter((r) => r.semester === filters.semester);
    }
    if (filters.academicYear) {
      filtered = filtered.filter((r) => r.academicYear === filters.academicYear);
    }
    if (filters.examName) {
      filtered = filtered.filter((r) => r.examName === filters.examName);
    }

    // Search by exam name
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.examName?.toLowerCase().includes(query) ||
          r.courseName?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [results, filters, searchQuery, user]);

  const filteredResults = applyFilters();
  const hasActiveFilters = Object.keys(filters).length > 0 || searchQuery.length > 0;

  /**
   * Results whose marks are real. A submission still being evaluated stores a
   * placeholder 0, and letting that into the averages would drag every summary
   * figure down until the evaluation finishes.
   */
  const scoredResults = results.filter((r) => !isEvaluationInProgress(r.evaluationStatus));

  const pendingEvaluations = results.filter((r) =>
    isEvaluationInProgress(r.evaluationStatus)
  ).length;

  /**
   * Poll while an evaluation is running.
   *
   * `subscribeToResults` only watches the `results` collection, which nothing
   * writes; these results are synthesised from exam sessions, so there is no
   * listener to fire when the evaluation lands. A slow poll is enough — the
   * whole point is that the student can leave the page open and watch
   * "Processing…" turn into a mark.
   */
  useEffect(() => {
    if (pendingEvaluations === 0) return;
    const timer = setInterval(() => {
      loadResults();
    }, 15_000);
    return () => clearInterval(timer);
  }, [pendingEvaluations, user]);

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    const d = date?.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
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

  return (
    <DashboardLayout role="student">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Results</h1>
            <p className="text-gray-600 mt-1">View your exam results and academic performance</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadResults();
              loadWarnings();
            }}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Warning Cards Section */}
        {warnings.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Active Warnings & Notices
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {warnings.map((warning) => {
                const style = getWarningStyle(warning.warningType);
                return (
                  <Card
                    key={warning.id}
                    className={`border-2 ${style.bgColor} ${style.color}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {getWarningIcon(warning.warningType)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-sm truncate">{warning.title}</h3>
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
                          <p className="text-xs mt-1 opacity-80 line-clamp-2">{warning.description}</p>
                          <div className="flex items-center gap-2 mt-2 text-xs opacity-70">
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

        {/* Filters Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            <CardDescription>Filter and search your results</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <div className="xl:col-span-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search exam name..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              <Select
                value={filters.courseName || "all"}
                onValueChange={(v) => handleFilterChange("courseName", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Courses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Courses</SelectItem>
                  {filterOptions.courses.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.batchName || "all"}
                onValueChange={(v) => handleFilterChange("batchName", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Batches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Batches</SelectItem>
                  {filterOptions.batches.map((b) => (
                    <SelectItem key={b} value={b}>Batch {b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.sectionName || "all"}
                onValueChange={(v) => handleFilterChange("sectionName", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Sections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {filterOptions.sections.map((s) => (
                    <SelectItem key={s} value={s}>Section {s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.semester || "all"}
                onValueChange={(v) => handleFilterChange("semester", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Semesters" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Semesters</SelectItem>
                  {filterOptions.semesters.map((s) => (
                    <SelectItem key={s} value={s}>Semester {s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.academicYear || "all"}
                onValueChange={(v) => handleFilterChange("academicYear", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Academic Years</SelectItem>
                  {filterOptions.academicYears.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.examName || "all"}
                onValueChange={(v) => handleFilterChange("examName", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Exams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Exam Types</SelectItem>
                  {filterOptions.examNames.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {filteredResults.length} result{filteredResults.length !== 1 ? "s" : ""} found
                </Badge>
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-7">
                  <Ban className="h-3 w-3 mr-1" />
                  Clear Filters
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Exam Results
            </CardTitle>
            <CardDescription>
              {results.length === 0
                ? "No results have been published yet."
                : `Showing ${filteredResults.length} of ${results.length} results`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-16 w-16 text-gray-300" />
                <h3 className="mt-4 text-lg font-semibold text-gray-600">No Results Published Yet</h3>
                <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
                  Your exam results will appear here once they are published by your teachers or administrators.
                </p>
              </div>
            ) : filteredResults.length === 0 ? (
              <div className="text-center py-12">
                <Search className="mx-auto h-16 w-16 text-gray-300" />
                <h3 className="mt-4 text-lg font-semibold text-gray-600">No Results Match Your Filters</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Try adjusting your search or filter criteria.
                </p>
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4">
                  <Ban className="h-4 w-4 mr-2" />
                  Clear Filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Exam Name</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Course</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Batch/Section</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Total</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Obtained</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Percentage</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Grade</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">GPA</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Status</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Date</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((result) => {
                      const isPassed = result.passFailStatus === "Pass";
                      const gradeColor = getGradeColor(result.grade);
                      const gpaColor = result.gpa !== undefined ? getGpaColor(result.gpa) : "bg-gray-100";

                      // While the AI evaluation is still running there is no
                      // mark yet — the stored 0 is an absence, not a score.
                      // Showing it as "0 / 100, Fail" would be a lie that
                      // corrects itself minutes later, so the derived columns
                      // are suppressed until the evaluation lands.
                      const evaluationPending = isEvaluationInProgress(result.evaluationStatus);
                      const evaluationFailed = result.evaluationStatus === "failed";

                      if (evaluationPending || evaluationFailed) {
                        return (
                          <tr
                            key={result.id}
                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="font-medium text-gray-900">{result.examName}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{result.academicYear}</div>
                            </td>
                            <td className="py-3 px-4 text-gray-700">{result.courseName}</td>
                            <td className="py-3 px-4 text-gray-700">
                              {result.batchName} / {result.sectionName}
                            </td>
                            <td className="py-3 px-4 text-center font-medium">{result.totalMarks}</td>
                            <td className="py-3 px-4 text-center" colSpan={5}>
                              {evaluationPending ? (
                                <span className="inline-flex items-center gap-2 text-sm font-medium text-blue-700">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  AI Evaluation Processing...
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-700">
                                  <AlertTriangle className="h-4 w-4" />
                                  Evaluation could not be completed — your teacher will mark this
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center text-xs text-gray-500">
                              <div className="flex items-center gap-1 justify-center">
                                <Calendar className="h-3 w-3" />
                                {formatDate(result.resultPublishedDate)}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                onClick={() => router.push(`/dashboard/student/results/${result.id}`)}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View Details
                              </Button>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr
                          key={result.id}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-medium text-gray-900">{result.examName}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{result.academicYear}</div>
                          </td>
                          <td className="py-3 px-4 text-gray-700">{result.courseName}</td>
                          <td className="py-3 px-4 text-gray-700">
                            {result.batchName} / {result.sectionName}
                          </td>
                          <td className="py-3 px-4 text-center font-medium">{result.totalMarks}</td>
                          <td className="py-3 px-4 text-center font-medium">{result.obtainedMarks}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`font-semibold ${isPassed ? "text-green-600" : "text-red-600"}`}>
                              {result.percentage.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${gradeColor}`}>
                              {result.grade}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {result.gpa !== undefined ? (
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${gpaColor}`}>
                                {result.gpa.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-gray-400">N/A</span>
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
                              {isPassed ? (
                                <CheckCircle2 className="h-3 w-3 mr-1 inline" />
                              ) : (
                                <XCircle className="h-3 w-3 mr-1 inline" />
                              )}
                              {result.passFailStatus}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-center text-xs text-gray-500">
                            <div className="flex items-center gap-1 justify-center">
                              <Calendar className="h-3 w-3" />
                              {formatDate(result.resultPublishedDate)}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => router.push(`/dashboard/student/results/${result.id}`)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View Details
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary Stats */}
        {results.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-blue-600" />
                  <div>
                    <p className="text-2xl font-bold">{results.length}</p>
                    <p className="text-sm text-gray-500">Total Results</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold">
                      {scoredResults.filter((r) => r.passFailStatus === "Pass").length}
                    </p>
                    <p className="text-sm text-gray-500">Passed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <TrendingUp className="h-8 w-8 text-purple-600" />
                  <div>
                    <p className="text-2xl font-bold">
                      {scoredResults.length > 0
                        ? (
                            scoredResults.reduce((sum, r) => sum + r.percentage, 0) /
                            scoredResults.length
                          ).toFixed(1)
                        : 0}%
                    </p>
                    <p className="text-sm text-gray-500">Avg Percentage</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Award className="h-8 w-8 text-yellow-600" />
                  <div>
                    <p className="text-2xl font-bold">
                      {scoredResults.filter((r) => r.gpa !== undefined && r.gpa >= 3.5).length}
                    </p>
                    <p className="text-sm text-gray-500">Honors (GPA ≥ 3.5)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
