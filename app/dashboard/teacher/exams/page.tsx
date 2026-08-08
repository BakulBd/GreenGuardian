"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Edit, 
  Trash2, 
  Eye, 
  Loader2, 
  FileText,
  Calendar,
  Clock,
  Users,
  BarChart,
  AlertCircle
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { getExamsByTeacher, deleteExam } from "@/lib/firebase/exams";

interface Exam {
  id: string;
  title: string;
  description: string;
  duration: number;
  totalMarks: number;
  status: "draft" | "published" | "active" | "completed";
  createdAt: any;
  startDate?: string;
  endDate?: string;
  questionCount?: number;
  attemptCount?: number;
  courseId?: string;
  courseName?: string;
  batch?: string;
  section?: string;
}

export default function TeacherExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<string>("all");
  const [selectedBatch, setSelectedBatch] = useState<string>("all");
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      loadExams();
    }
  }, [user]);

  const loadExams = async () => {
    if (!user) return;

    setError(null);
    try {
      const examsList = await getExamsByTeacher(user.id);
      setExams(examsList as any[]);
    } catch (err) {
      console.error("Error loading exams:", err);
      setError("Could not load your exams.");
      toast({
        title: "Error",
        description: "Failed to load exams",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (exam: Exam) => {
    // Deleting an exam takes its questions with it and orphans any submissions,
    // so the confirmation names the exam and says what is lost.
    const published = exam.status !== "draft";
    const warning = published
      ? `\n\nThis exam is ${exam.status}. Students who already sat it will lose access to their result.`
      : "";
    if (!confirm(`Delete "${exam.title}"?${warning}\n\nThis cannot be undone.`)) return;

    setDeletingId(exam.id);
    try {
      await deleteExam(exam.id);
      setExams((prev) => prev.filter((e) => e.id !== exam.id));
      toast({
        title: "Exam Deleted",
        description: `"${exam.title}" has been deleted.`,
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to delete exam",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      draft: { variant: "secondary", label: "Draft" },
      published: { variant: "default", label: "Published" },
      active: { variant: "default", label: "Active" },
      completed: { variant: "outline", label: "Completed" },
    };
    const { variant, label } = variants[status] || variants.draft;
    return <Badge variant={variant}>{label}</Badge>;
  };

  // Filter options come from the exams themselves. They used to come from the
  // hardcoded DEFAULT_* catalog, whose ids (e.g. "cse-301") never match the
  // Firestore course documents exams actually reference — so picking any course
  // filtered the list down to nothing, every time.
  const courseOptions = useMemo(() => {
    const byId = new Map<string, string>();
    exams.forEach((e) => {
      if (e.courseId) byId.set(e.courseId, e.courseName || e.courseId);
    });
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [exams]);

  const batchOptions = useMemo(
    () => Array.from(new Set(exams.map((e) => e.batch).filter(Boolean) as string[])).sort(),
    [exams]
  );

  const sectionOptions = useMemo(
    () => Array.from(new Set(exams.map((e) => e.section).filter(Boolean) as string[])).sort(),
    [exams]
  );

  const filteredExams = exams.filter((e) => {
    const matchCourse = selectedCourse === "all" || e.courseId === selectedCourse || (!e.courseId && selectedCourse === "all");
    const matchBatch = selectedBatch === "all" || e.batch === selectedBatch || (!e.batch && selectedBatch === "all");
    const matchSection = selectedSection === "all" || e.section === selectedSection || (!e.section && selectedSection === "all");
    return matchCourse && matchBatch && matchSection;
  });

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Exams</h1>
            <p className="text-gray-600 mt-1">Create and manage your exams</p>
          </div>
          <Link href="/dashboard/teacher/exams/create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Exam
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-2xl font-bold">{exams.length}</p>
                  <p className="text-sm text-gray-500">Total Exams</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold">{exams.filter(e => e.status === "active").length}</p>
                  <p className="text-sm text-gray-500">Active</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold">{exams.filter(e => e.status === "published").length}</p>
                  <p className="text-sm text-gray-500">Published</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <BarChart className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-2xl font-bold">{exams.filter(e => e.status === "completed").length}</p>
                  <p className="text-sm text-gray-500">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadExams}>
              Retry
            </Button>
          </div>
        )}

        {/* Filter Controls — pointless chrome until there is something to filter. */}
        {exams.length > 0 && (
        <Card className="bg-emerald-50/40 border-emerald-100 p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span>Filter Exams:</span>
              {(selectedCourse !== "all" || selectedBatch !== "all" || selectedSection !== "all") && (
                <button
                  onClick={() => {
                    setSelectedCourse("all");
                    setSelectedBatch("all");
                    setSelectedSection("all");
                  }}
                  className="text-xs text-emerald-700 underline font-medium hover:text-emerald-900"
                >
                  Reset Filters
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full md:w-auto">
              {/* Course Filter */}
              <select
                className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
              >
                <option value="all">All Courses</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>

              {/* Batch Filter */}
              <select
                className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={selectedBatch}
                onChange={(e) => setSelectedBatch(e.target.value)}
              >
                <option value="all">All Batches</option>
                {batchOptions.map((batch) => (
                  <option key={batch} value={batch}>
                    Batch {batch}
                  </option>
                ))}
              </select>

              {/* Section Filter */}
              <select
                className="h-9 px-3 rounded-md border border-gray-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
              >
                <option value="all">All Sections</option>
                {sectionOptions.map((section) => (
                  <option key={section} value={section}>
                    Section {section}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>
        )}

        {/* Exam List */}
        {filteredExams.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                {exams.length === 0 ? (
                  <>
                    <h3 className="mt-4 text-lg font-medium text-gray-900">No exams yet</h3>
                    <p className="mt-2 text-gray-500">
                      Create your first exam and pick the Course, Batch and Section it targets.
                    </p>
                    <Link href="/dashboard/teacher/exams/create">
                      <Button className="mt-4">
                        <Plus className="mr-2 h-4 w-4" />
                        Create Exam
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <h3 className="mt-4 text-lg font-medium text-gray-900">No matching exams</h3>
                    <p className="mt-2 text-gray-500">
                      None of your {exams.length} exam{exams.length !== 1 ? "s" : ""} match the
                      current filters.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setSelectedCourse("all");
                        setSelectedBatch("all");
                        setSelectedSection("all");
                      }}
                    >
                      Reset Filters
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredExams.map((exam) => (
              <Card key={exam.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-lg text-gray-900">{exam.title}</h3>
                        {getStatusBadge(exam.status)}
                        {exam.courseName && (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-xs">
                            {exam.courseName}
                          </Badge>
                        )}
                        {exam.batch && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-xs">
                            Batch {exam.batch}
                          </Badge>
                        )}
                        {exam.section && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300 text-xs">
                            Section {exam.section}
                          </Badge>
                        )}
                      </div>
                      <p className="text-gray-600 text-sm mt-1 line-clamp-2">{exam.description}</p>
                      <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {exam.duration} min
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          {exam.totalMarks} marks
                        </div>
                        {exam.startDate && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {new Date(exam.startDate).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/dashboard/teacher/exams/${exam.id}`)}
                      >
                        <Eye className="h-4 w-4 sm:mr-1" />
                        <span className="hidden sm:inline">View</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/dashboard/teacher/exams/${exam.id}/edit`)}
                      >
                        <Edit className="h-4 w-4 sm:mr-1" />
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(exam)}
                        disabled={deletingId === exam.id}
                        className="text-red-600 hover:text-red-700"
                      >
                        {deletingId === exam.id ? (
                          <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 sm:mr-1" />
                        )}
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
