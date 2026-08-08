"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, FileText, Clock, ChevronRight, LogOut, ArrowLeft } from "lucide-react";
import { subscribeToStudentVisibleExams } from "@/lib/firebase/exams";
import { Exam } from "@/lib/types";
import { formatDate } from "@/lib/utils/helpers";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/firebase/auth";

export default function ExamPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  useEffect(() => {
    if (authLoading) return;

    // Guard the route: this page lives outside DashboardLayout, so without this
    // an anonymous visitor just saw an empty list (every read denied by rules).
    if (!user) {
      router.replace("/login?next=/exam");
      return;
    }

    // Realtime feed (Feature 5): a newly published exam appears without a
    // manual refresh. Visibility itself is enforced server-side (see
    // firestore.rules `exams` read rule) via `targetStudentIds`, resolved
    // at exam-creation time from the teacher's Course/Batch/Section
    // assignment — this query can only ever return exams this student is
    // actually allowed to see.
    const unsubscribe = subscribeToStudentVisibleExams(user.id, (availableExams) => {
      // Apply the same scheduling window the dashboard uses. Without it this
      // page listed — and offered a live "Start Exam" button for — exams that
      // hadn't opened yet or had already closed, so the two lists disagreed
      // and a student could start an exam early via this route.
      const now = new Date();
      setExams(
        availableExams.filter((e) => {
          if (e.startDate && new Date(e.startDate as any) > now) return false;
          if (e.endDate && new Date(e.endDate as any) < now) return false;
          return true;
        })
      );
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authLoading, user, router]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading exams...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="h-8 w-8 text-primary-600" />
            <span className="text-2xl font-bold text-gray-900">GreenGuardian</span>
          </div>
          {user && (
            <div className="flex items-center space-x-2 sm:space-x-4">
              <span className="text-sm text-gray-600 hidden sm:inline">Welcome, {user.name}</span>
              {/* This page renders outside DashboardLayout, so without an
                  explicit link back the only exits were browser-back or Logout. */}
              <Link href="/dashboard/student">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Available Exams</h1>
            <p className="text-gray-600 mt-2">Select an exam to begin your proctored session</p>
          </div>

          {exams.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">No Exams Available</h2>
                <p className="text-gray-600">
                  There are no active exams at the moment. Please check back later.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {exams.map((exam) => (
                <Card key={exam.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <CardTitle className="text-xl">{exam.title}</CardTitle>
                          {exam.courseName && (
                            <span className="bg-emerald-100 text-emerald-800 text-xs font-medium px-2.5 py-0.5 rounded">
                              {exam.courseName}
                            </span>
                          )}
                          {exam.batch && (
                            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded">
                              Batch {exam.batch}
                            </span>
                          )}
                          {exam.section && (
                            <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2.5 py-0.5 rounded">
                              Section {exam.section}
                            </span>
                          )}
                        </div>
                        <CardDescription className="mt-1">{exam.description}</CardDescription>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          exam.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {exam.status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <Clock className="h-4 w-4 mr-2" />
                        <span>Duration: {exam.duration} minutes</span>
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <FileText className="h-4 w-4 mr-2" />
                        <span>Total Marks: {exam.totalMarks}</span>
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <Shield className="h-4 w-4 mr-2" />
                        <span>Proctored</span>
                      </div>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-yellow-800 font-medium">Important Instructions:</p>
                      <ul className="text-xs text-yellow-700 mt-2 space-y-1 ml-4 list-disc">
                        <li>Ensure your webcam is enabled and working</li>
                        <li>Face detection will be active throughout the exam</li>
                        <li>Tab switching and fullscreen exits will be monitored</li>
                        <li>Answer files will be scanned for plagiarism</li>
                      </ul>
                    </div>

                    <Link href={`/exam/${exam.id}`}>
                      <Button className="w-full">
                        Start Exam
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
