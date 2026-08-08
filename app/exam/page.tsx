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

import DashboardLayout from "@/components/layouts/DashboardLayout";

export default function ExamPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.replace("/login?next=/exam");
      return;
    }

    const unsubscribe = subscribeToStudentVisibleExams(
      user.id,
      (availableExams) => {
        const now = new Date();
        setExams(
          availableExams.filter((e) => {
            if (e.startDate && new Date(e.startDate as any) > now) return false;
            if (e.endDate && new Date(e.endDate as any) < now) return false;
            return true;
          })
        );
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [authLoading, user, router]);

  if (authLoading || loading) {
    return (
      <DashboardLayout role="student">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="student">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Available Exams</h1>
          <p className="text-gray-600 mt-1">Select an active exam to begin your proctored session</p>
        </div>

        {exams.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">No Exams Available</h2>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                There are no active or published exams scheduled for your Batch and Section right now. Please check back later.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {exams.map((exam) => (
              <Card key={exam.id} className="hover:shadow-md transition-all border-emerald-100">
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
                      className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
                        exam.status === "active"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : "bg-blue-100 text-blue-800 border border-blue-200"
                      }`}
                    >
                      {exam.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="flex items-center text-sm text-gray-600">
                      <Clock className="h-4 w-4 mr-2 text-emerald-600" />
                      <span>Duration: {exam.duration} minutes</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <FileText className="h-4 w-4 mr-2 text-emerald-600" />
                      <span>Total Marks: {exam.totalMarks}</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <Shield className="h-4 w-4 mr-2 text-emerald-600" />
                      <span>Proctored Session</span>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-4">
                    <p className="text-sm text-amber-900 font-semibold">Important Instructions:</p>
                    <ul className="text-xs text-amber-800 mt-1.5 space-y-1 ml-4 list-disc">
                      <li>Ensure your webcam is enabled and working before starting</li>
                      <li>Proctoring monitors face presence, tab switching, and window focus</li>
                      <li>Warning violations will be captured as high-resolution screenshots for teacher review</li>
                    </ul>
                  </div>

                  <Link href={`/exam/${exam.id}`}>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
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
    </DashboardLayout>
  );
}
