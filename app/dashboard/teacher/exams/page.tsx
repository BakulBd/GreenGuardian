"use client";

import { useState, useEffect } from "react";
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
  BarChart
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import Link from "next/link";
import { DEFAULT_COURSES, DEFAULT_BATCHES, DEFAULT_SECTIONS } from "@/lib/academics/catalog";

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
    
    try {
      const examsQuery = query(
        collection(db, "exams"),
        where("createdBy", "==", user.id)
      );
      const snapshot = await getDocs(examsQuery);
      const examsList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Exam[];
      
      setExams(examsList.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      }));
    } catch (error) {
      console.error("Error loading exams:", error);
      toast({
        title: "Error",
        description: "Failed to load exams",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (examId: string) => {
    if (!confirm("Are you sure you want to delete this exam?")) return;

    try {
      await deleteDoc(doc(db, "exams", examId));
      setExams(exams.filter(e => e.id !== examId));
      toast({
        title: "Exam Deleted",
        description: "The exam has been deleted successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete exam",
        variant: "destructive",
      });
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

        {/* Filter Controls */}
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
                {DEFAULT_COURSES.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
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
                {DEFAULT_BATCHES.map((batch) => (
                  <option key={batch.id} value={batch.name}>
                    Batch {batch.name}
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
                {DEFAULT_SECTIONS.map((section) => (
                  <option key={section.id} value={section.name}>
                    Section {section.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Exam List */}
        {filteredExams.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">No matching exams found</h3>
                <p className="mt-2 text-gray-500">Try selecting different course, batch, or section filters</p>
                <Link href="/dashboard/teacher/exams/create">
                  <Button className="mt-4">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Exam
                  </Button>
                </Link>
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
                        onClick={() => handleDelete(exam.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4 sm:mr-1" />
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
