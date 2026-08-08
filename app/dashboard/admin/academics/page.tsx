"use client";

import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Layers, Users, ArrowRight, UserCog, Loader2, FolderTree } from "lucide-react";
import { useAcademicCatalog } from "@/hooks/useAcademicCatalog";
import { DEFAULT_DEPARTMENT } from "@/lib/academics/catalog";

/**
 * Read-only academic catalog overview. Course/Batch/Section CRUD lives on
 * /dashboard/admin/courses; assigning teachers to a Course+Batch+Section
 * (the thing that actually drives exam/notice visibility) lives on
 * /dashboard/admin/assignments. This page used to duplicate both — a dead
 * "assignment builder" here wrote to an unused `teacher_courses` collection
 * that nothing else in the app ever reads.
 */
export default function AdminAcademicsPage() {
  const catalog = useAcademicCatalog();

  const departmentNames = Array.from(
    new Set(catalog.courses.map((c) => c.departmentName).filter(Boolean))
  ) as string[];

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Academic Structure & Catalog</h1>
            <p className="text-gray-600 mt-1">Overview of courses, batches, and sections</p>
          </div>
          {departmentNames.length > 0 && (
            <Badge variant="outline" className="w-fit bg-emerald-50 border-emerald-300 text-emerald-800 text-sm font-semibold">
              {departmentNames.join(", ")}
            </Badge>
          )}
        </div>

        {catalog.loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
          </div>
        ) : catalog.courses.length === 0 ? (
          <Card className="border-gray-200">
            <CardContent className="py-16 text-center">
              <FolderTree className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No courses have been created yet.</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">
                Create your Course/Batch/Section catalog on the Courses page first.
              </p>
              <Link href="/dashboard/admin/courses">
                <Button>
                  <BookOpen className="h-4 w-4 mr-2" />
                  Go to Courses
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Overview Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-white to-emerald-50/40 border-emerald-100">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-emerald-100 rounded-xl text-emerald-700">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{catalog.courses.length}</p>
                      <p className="text-xs text-gray-500 font-medium">Total Courses</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-white to-blue-50/40 border-blue-100">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-100 rounded-xl text-blue-700">
                      <Layers className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{catalog.batches.length}</p>
                      <p className="text-xs text-gray-500 font-medium">Total Batches</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-white to-purple-50/40 border-purple-100">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-100 rounded-xl text-purple-700">
                      <Users className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{catalog.sections.length}</p>
                      <p className="text-xs text-gray-500 font-medium">Total Sections</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Course Catalog List */}
            <Card className="border-gray-200">
              <CardHeader className="flex flex-row items-center justify-between border-b">
                <div>
                  <CardTitle className="text-lg">Course Catalog</CardTitle>
                  <CardDescription>
                    {catalog.courses.length} course{catalog.courses.length === 1 ? "" : "s"} across {departmentNames.length || 1} department{departmentNames.length === 1 ? "" : "s"}
                  </CardDescription>
                </div>
                <Link href="/dashboard/admin/courses">
                  <Button variant="outline" size="sm">
                    Manage Catalog
                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {catalog.courses.map((course) => {
                    const batchCount = catalog.batches.filter((b) => b.courseId === course.id).length;
                    return (
                      <div key={course.id} className="p-3 bg-gray-50 rounded-lg border flex flex-col justify-between">
                        <div>
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                            {course.code}
                          </span>
                          <p className="text-sm font-semibold text-gray-900 mt-1">{course.name}</p>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {batchCount} batch{batchCount === 1 ? "" : "es"} · {course.departmentName || DEFAULT_DEPARTMENT.name}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Pointer to the real teacher-assignment workflow */}
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-100 rounded-lg text-emerald-700">
                <UserCog className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm">Assign teachers to a Course + Batch + Section</p>
                <p className="text-xs text-gray-500">
                  This is what determines which students see a teacher's exams and notices.
                </p>
              </div>
            </div>
            <Link href="/dashboard/admin/assignments">
              <Button size="sm">
                Go to Assignments
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
