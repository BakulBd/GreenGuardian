"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  FileText, 
  Plus, 
  Search, 
  Clock, 
  Users, 
  Eye,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Archive
} from "lucide-react";
import { getAllExams, deleteExam, updateExam, notifyExamPublished } from "@/lib/firebase/exams";
import { Exam } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";

export default function AdminExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadExams();
  }, []);

  const loadExams = async () => {
    setError(null);
    try {
      const allExams = await getAllExams();
      setExams(allExams);
    } catch (error) {
      console.error("Error loading exams:", error);
      setError("Could not load exams. Check your connection and try again.");
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
    if (busyId) return;
    if (
      !confirm(
        `Delete "${exam.title}"?\n\nIts questions go with it and any student attempts are orphaned.\n\nThis cannot be undone.`
      )
    ) {
      return;
    }

    setBusyId(exam.id);
    try {
      await deleteExam(exam.id);
      setExams((prev) => prev.filter((e) => e.id !== exam.id));
      toast({
        title: "Exam Deleted",
        description: `"${exam.title}" has been deleted.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete exam",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (exam: Exam, status: Exam["status"]) => {
    if (busyId || status === exam.status) return;

    const targets = exam.targetStudentIds ?? [];
    const goingLive = status === "published" || status === "active";
    const wasLive = exam.status === "published" || exam.status === "active";

    // Flipping the dropdown to "published" used to just write the field. An
    // exam with no resolved audience is invisible to every student however it
    // is labelled, so publishing one silently produced an exam nobody could
    // sit and nobody was told about.
    if (goingLive && targets.length === 0) {
      toast({
        title: "Cannot publish",
        description:
          "This exam has no target students. Edit it and select a Course, Batch and Section first.",
        variant: "destructive",
      });
      return;
    }
    if (goingLive && !exam.questionCount) {
      toast({
        title: "Cannot publish",
        description: "This exam has no questions yet.",
        variant: "destructive",
      });
      return;
    }

    setBusyId(exam.id);
    try {
      await updateExam(exam.id, { status });
      setExams((prev) => prev.map((e) => (e.id === exam.id ? { ...e, status } : e)));

      if (goingLive && !wasLive) {
        notifyExamPublished(exam.id, targets).catch((err) =>
          console.warn("[AdminExams] Failed to send publish notifications:", err)
        );
        toast({
          title: "Exam Published",
          description: `Notified ${targets.length} student${targets.length !== 1 ? "s" : ""}.`,
        });
      } else {
        toast({ title: "Status Updated", description: `"${exam.title}" is now ${status}.` });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update exam status",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const filteredExams = exams.filter((exam) => {
    if (statusFilter !== "all" && exam.status !== statusFilter) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      exam.title.toLowerCase().includes(q) ||
      (exam.description || "").toLowerCase().includes(q) ||
      (exam.teacherName || "").toLowerCase().includes(q) ||
      (exam.courseName || "").toLowerCase().includes(q)
    );
  });

  const getStatusColor = (status: Exam["status"]) => {
    switch (status) {
      case "published":
        return "bg-green-100 text-green-700";
      case "active":
        return "bg-blue-100 text-blue-700";
      case "completed":
        return "bg-gray-100 text-gray-700";
      case "archived":
        return "bg-gray-100 text-gray-500";
      case "draft":
      default:
        return "bg-yellow-100 text-yellow-700";
    }
  };

  const getStatusIcon = (status: Exam["status"]) => {
    switch (status) {
      case "published":
        return <CheckCircle className="h-4 w-4" />;
      case "active":
        return <AlertCircle className="h-4 w-4" />;
      case "completed":
        return <XCircle className="h-4 w-4" />;
      case "archived":
        return <Archive className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Manage Exams</h1>
            <p className="text-gray-600 mt-1">View and manage all exams in the system</p>
          </div>
          <Link href="/dashboard/admin/exams/create">
            <Button className="bg-gradient-to-r from-green-600 to-emerald-600">
              <Plus className="h-4 w-4 mr-2" />
              Create Exam
            </Button>
          </Link>
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

        {/* Search & filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by title, teacher, or course..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              aria-label="Search exams"
            />
          </div>
          <select
            className="h-10 px-3 rounded-md border border-gray-300 bg-white text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Exams List */}
        {loading ? (
          <div className="grid gap-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredExams.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">No Exams Found</h2>
              <p className="text-gray-600 mb-4">
                {searchQuery || statusFilter !== "all"
                  ? "No exams match your search or filter."
                  : "Get started by creating your first exam."}
              </p>
              {(searchQuery || statusFilter !== "all") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                >
                  Reset filters
                </Button>
              )}
              {!searchQuery && statusFilter === "all" && (
                <Link href="/dashboard/admin/exams/create">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Exam
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredExams.map((exam) => (
              <Card key={exam.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">{exam.title}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(exam.status)}`}>
                          {getStatusIcon(exam.status)}
                          {exam.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{exam.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {exam.duration} minutes
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          {exam.totalMarks} marks
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          {exam.questionCount || 0} questions
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          {(exam.targetStudentIds?.length ?? 0) > 0
                            ? `${exam.targetStudentIds!.length} students targeted`
                            : "No students targeted"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                        {exam.teacherName && <span>Teacher: {exam.teacherName}</span>}
                        {exam.courseName && <span>· {exam.courseName}</span>}
                        {exam.batch && <span>· Batch {exam.batch}</span>}
                        {exam.section && <span>· Section {exam.section}</span>}
                      </div>
                      {(exam.targetStudentIds?.length ?? 0) === 0 && exam.status !== "draft" && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                          <AlertCircle className="h-3.5 w-3.5" />
                          No students can see this exam — edit it to set a Course, Batch and Section.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={exam.status}
                        onChange={(e) => handleStatusChange(exam, e.target.value as Exam["status"])}
                        disabled={busyId === exam.id}
                        aria-label={`Status for ${exam.title}`}
                        className="text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50"
                      >
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="archived">Archived</option>
                      </select>
                      <Link href={`/dashboard/admin/exams/${exam.id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Link href={`/dashboard/admin/exams/${exam.id}/edit`}>
                        <Button variant="outline" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleDelete(exam)}
                        disabled={busyId === exam.id}
                        aria-label={`Delete ${exam.title}`}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        {busyId === exam.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
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
