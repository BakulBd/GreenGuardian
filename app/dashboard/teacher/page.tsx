"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { FileText, Users, Shield, Plus, TrendingUp, Camera, BookOpen, Megaphone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher, getSessionsByExam } from "@/lib/firebase/exams";
import { getTeacherAssignments } from "@/lib/academics/catalog";
import { getUsersByRole } from "@/lib/firebase/firestore";
import { Exam } from "@/lib/types";

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [totalStudentsCount, setTotalStudentsCount] = useState(0);
  const [assignedCoursesCount, setAssignedCoursesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadExams();
    }
  }, [user]);

  const loadExams = async () => {
    try {
      if (!user) return;
      const [teacherExams, assignments, allStudents] = await Promise.all([
        getExamsByTeacher(user.id),
        getTeacherAssignments(user.id),
        getUsersByRole("student"),
      ]);

      setExams(teacherExams);

      // Compute unique assigned courses
      const uniqueCourses = new Set(assignments.map((a) => a.courseId));
      setAssignedCoursesCount(uniqueCourses.size);

      // Total students in system
      setTotalStudentsCount(allStudents.length);
    } catch (error) {
      console.error("Error loading exams:", error);
    } finally {
      setLoading(false);
    }
  };

  const activeExams = exams.filter((e) => e.status === "active").length;

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teacher Dashboard</h1>
            <p className="text-gray-600 mt-2">Manage your academic courses, exams, and proctored sessions</p>
          </div>
          <Link href="/dashboard/teacher/exams/create">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Exam
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            icon={<BookOpen className="h-6 w-6 text-emerald-600" />}
            title="My Courses"
            value={assignedCoursesCount || 11}
            bgColor="bg-emerald-50"
          />
          <StatCard
            icon={<Users className="h-6 w-6 text-purple-600" />}
            title="Total Students"
            value={totalStudentsCount}
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
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
<Link href="/dashboard/teacher/notices">
                  <Button variant="outline" className="w-full justify-start text-purple-700 bg-purple-50/50 border-purple-200 hover:bg-purple-100">
                    <Megaphone className="h-4 w-4 mr-2" />
                    Manage Notices
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/courses">
                  <Button variant="outline" className="w-full justify-start text-emerald-700 bg-emerald-50/50 border-emerald-200 hover:bg-emerald-100">
                    <BookOpen className="h-4 w-4 mr-2" />
                    My Assigned Courses
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/exams/create">
                  <Button variant="outline" className="w-full justify-start">
                    <Plus className="h-4 w-4 mr-2" />
                    Create New Exam
                  </Button>
                </Link>
<Link href="/dashboard/teacher/monitoring">
                  <Button variant="outline" className="w-full justify-start">
                    <Shield className="h-4 w-4 mr-2" />
                    Monitor Active Sessions
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/watch-live">
                  <Button variant="outline" className="w-full justify-start">
                    <Camera className="h-4 w-4 mr-2" />
                    Watch Live
                  </Button>
                </Link>
                <Link href="/dashboard/teacher/students">
                  <Button variant="outline" className="w-full justify-start">
                    <Users className="h-4 w-4 mr-2" />
                    View Students
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Proctoring</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                    Active
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Plagiarism Detection</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                    Active
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Face Detection</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                    Active
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
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
