"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  FileText,
  Users,
  Plus,
  TrendingUp,
  Camera,
  BookOpen,
  Megaphone,
  School,
  AlertCircle,
  Image as ImageIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher } from "@/lib/firebase/exams";
import { Exam } from "@/lib/types";
import {
  getAssignmentsByTeacher,
  getAssignedStudents,
} from "@/lib/firebase/assignments";

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [assignedStudentsCount, setAssignedStudentsCount] = useState(0);
  const [assignedCoursesCount, setAssignedCoursesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const loadDashboardData = async () => {
    try {
      if (!user) return;
      setError(null);

      const [teacherExams, assignments, students] = await Promise.all([
        getExamsByTeacher(user.id),
        getAssignmentsByTeacher(user.id).catch(() => []),
        getAssignedStudents(user.id).catch(() => []),
      ]);

      setExams(teacherExams);

      // Compute unique assigned courses from assignments
      const uniqueCourses = new Set(assignments.map((a) => a.courseId));
      setAssignedCoursesCount(uniqueCourses.size);

      // Count unique assigned students
      const uniqueStudents = new Set(students.map((s) => s.studentId));
      setAssignedStudentsCount(uniqueStudents.size);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
      setError("Could not load your dashboard. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // Exams are created with status "published"; "active" is only set when a
  // teacher explicitly activates one. Counting just "active" reported 0 for
  // every live exam.
  const activeExams = exams.filter(
    (e) => e.status === "active" || e.status === "published"
  ).length;

  const examCounts = {
    draft: exams.filter((e) => e.status === "draft").length,
    published: exams.filter((e) => e.status === "published").length,
    active: exams.filter((e) => e.status === "active").length,
    completed: exams.filter((e) => e.status === "completed").length,
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teacher Dashboard</h1>
            <p className="text-gray-600 mt-2">
              Manage your assigned courses, students, exams, and proctored sessions
            </p>
          </div>
          <Link href="/dashboard/teacher/exams/create">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Exam
            </Button>
          </Link>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadDashboardData}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && assignedCoursesCount === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              No courses are assigned to you yet. Ask an administrator to assign a
              Course, Batch and Section — exams and notices you create can only reach
              students inside your assignments.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            icon={<BookOpen className="h-6 w-6 text-emerald-600" />}
            title="Assigned Courses"
            value={assignedCoursesCount}
            bgColor="bg-emerald-50"
          />
          <StatCard
            icon={<Users className="h-6 w-6 text-purple-600" />}
            title="Assigned Students"
            value={assignedStudentsCount}
            bgColor="bg-purple-50"
          />
          <StatCard
            icon={<TrendingUp className="h-6 w-6 text-blue-600" />}
            title="Active Exams"
            value={activeExams}
            bgColor="bg-blue-50"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Exams</CardTitle>
            <CardDescription>Your recently created exams</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : exams.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">No exams created yet</p>
                <Link href="/dashboard/teacher/exams/create">
                  <Button>Create Your First Exam</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {exams.slice(0, 5).map((exam) => (
                  <div
                    key={exam.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div>
                      <h3 className="font-medium text-gray-900">{exam.title}</h3>
                      <p className="text-sm text-gray-600">{exam.description}</p>
                      <div className="flex items-center space-x-4 mt-2">
                        <span className="text-xs text-gray-500">
                          Duration: {exam.duration} mins
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          exam.status === "active"
                            ? "bg-green-100 text-green-700"
                            : exam.status === "draft"
                            ? "bg-gray-100 text-gray-700"
                            : "bg-blue-100 text-blue-700"
                        }`}>
                          {exam.status}
                        </span>
                      </div>
                    </div>
                    <Link href={`/dashboard/teacher/exams/${exam.id}`}>
                      <Button variant="outline">View Details</Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Jump straight to the things you do most</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Link href="/dashboard/teacher/exams/create">
                  <Button variant="outline" className="w-full justify-start">
                    <Plus className="h-4 w-4 mr-2" />
                    Create New Exam
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/watch-live">
                  <Button variant="outline" className="w-full justify-start">
                    <Camera className="h-4 w-4 mr-2" />
                    Watch Live Exam Sessions
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/answers">
                  <Button variant="outline" className="w-full justify-start">
                    <FileText className="h-4 w-4 mr-2" />
                    Review Submissions &amp; OCR
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/classrooms">
                  <Button variant="outline" className="w-full justify-start">
                    <School className="h-4 w-4 mr-2" />
                    My Classrooms
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/notices">
                  <Button variant="outline" className="w-full justify-start">
                    <Megaphone className="h-4 w-4 mr-2" />
                    Manage Notices
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/snapshots">
                  <Button variant="outline" className="w-full justify-start">
                    <ImageIcon className="h-4 w-4 mr-2" />
                    Proctoring Snapshots
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Real, derived numbers. The panel that used to sit here reported
              "Proctoring: Active / Face Detection: Active" from hardcoded
              strings — it was the same green regardless of system state. */}
          <Card>
            <CardHeader>
              <CardTitle>Exam Pipeline</CardTitle>
              <CardDescription>Where your exams currently stand</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />
                  ))}
                </div>
              ) : exams.length === 0 ? (
                <div className="py-6 text-center">
                  <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    Nothing here yet. Your exams will be summarised once you create one.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <PipelineRow label="Drafts" count={examCounts.draft} tone="bg-gray-100 text-gray-700" />
                  <PipelineRow label="Published" count={examCounts.published} tone="bg-blue-100 text-blue-700" />
                  <PipelineRow label="Active now" count={examCounts.active} tone="bg-green-100 text-green-700" />
                  <PipelineRow label="Completed" count={examCounts.completed} tone="bg-purple-100 text-purple-700" />
                  <div className="pt-2 border-t">
                    <Link href="/dashboard/teacher/exams">
                      <Button variant="outline" size="sm" className="w-full">
                        View all exams
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function PipelineRow({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${tone}`}>{count}</span>
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  bgColor: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
          </div>
          <div className={`p-3 rounded-lg ${bgColor}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

