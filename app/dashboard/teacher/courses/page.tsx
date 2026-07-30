"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Users, Layers, Bookmark, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getTeacherAssignments, CourseAssignment, DEFAULT_COURSES } from "@/lib/academics/catalog";
import { getUsersByRole } from "@/lib/firebase/firestore";
import { User } from "@/lib/types";

interface CourseGroup {
  courseId: string;
  courseName: string;
  code?: string;
  batches: {
    batch: string;
    sections: string[];
    studentCount: number;
  }[];
  totalStudents: number;
}

export default function MyCoursesPage() {
  const { user } = useAuth();
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [allStudents, setAllStudents] = useState<User[]>([]);

  useEffect(() => {
    if (user) {
      loadTeacherCourses();
    }
  }, [user]);

  const loadTeacherCourses = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [assignments, students] = await Promise.all([
        getTeacherAssignments(user.id),
        getUsersByRole("student"),
      ]);

      setAllStudents(students);

      // Group assignments by Course -> Batch -> Sections
      const map = new Map<string, Map<string, Set<string>>>();

      assignments.forEach((assignment) => {
        if (!map.has(assignment.courseId)) {
          map.set(assignment.courseId, new Map());
        }
        const batchMap = map.get(assignment.courseId)!;
        if (!batchMap.has(assignment.batch)) {
          batchMap.set(assignment.batch, new Set());
        }
        batchMap.get(assignment.batch)!.add(assignment.section);
      });

      const result: CourseGroup[] = [];

      map.forEach((batchMap, courseId) => {
        const catalogCourse = DEFAULT_COURSES.find((c) => c.id === courseId || c.name === courseId);
        const courseName = catalogCourse ? catalogCourse.name : courseId;
        const code = catalogCourse ? catalogCourse.code : undefined;

        let courseTotalStudents = 0;
        const batchesList: { batch: string; sections: string[]; studentCount: number }[] = [];

        batchMap.forEach((sectionsSet, batch) => {
          const sections = Array.from(sectionsSet).sort();
          
          // Calculate student count for this batch + sections
          const matchingStudents = students.filter((s) => {
            const matchBatch = !s.batch || s.batch === batch;
            const studentSections = s.sections || (s.section ? [s.section] : ["D1", "D2", "D3", "D4", "D5"]);
            const matchSection = sections.some((sec) => studentSections.includes(sec));
            return matchBatch && matchSection;
          });

          courseTotalStudents += matchingStudents.length;
          batchesList.push({
            batch,
            sections,
            studentCount: matchingStudents.length,
          });
        });

        result.push({
          courseId,
          courseName,
          code,
          batches: batchesList.sort((a, b) => a.batch.localeCompare(b.batch)),
          totalStudents: courseTotalStudents,
        });
      });

      setCourseGroups(result);
    } catch (error) {
      console.error("Error loading teacher courses:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 text-emerald-600 animate-spin mb-4" />
          <p className="text-gray-500 font-medium">Loading assigned courses...</p>
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
            <div className="flex items-center gap-2">
              <BookOpen className="h-7 w-7 text-emerald-600" />
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Courses</h1>
            </div>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">
              Overview of your assigned academic courses, batches, sections, and student roster.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-emerald-500 text-emerald-700 bg-emerald-50 px-3 py-1 text-sm">
            CSE Department
          </Badge>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-emerald-100 bg-gradient-to-br from-white to-emerald-50/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{courseGroups.length}</p>
                  <p className="text-xs sm:text-sm text-gray-500 font-medium">Assigned Courses</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-100 bg-gradient-to-br from-white to-blue-50/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-xl text-blue-600">
                  <Layers className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {courseGroups.reduce((acc, c) => acc + c.batches.length, 0)}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 font-medium">Active Batches</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-100 bg-gradient-to-br from-white to-purple-50/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-xl text-purple-600">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {allStudents.length}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 font-medium">Total Enrolled Students</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Course Cards */}
        {courseGroups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Bookmark className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-800">No Courses Assigned</h3>
              <p className="text-sm text-gray-500 mt-1">Please contact your administrator to assign courses.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {courseGroups.map((group) => (
              <Card key={group.courseId} className="hover:shadow-md transition-shadow border-gray-200">
                <CardHeader className="pb-3 border-b bg-gray-50/50">
                  <div className="flex items-start justify-between">
                    <div>
                      {group.code && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                          {group.code}
                        </span>
                      )}
                      <CardTitle className="text-lg font-bold text-gray-900 mt-1">
                        {group.courseName}
                      </CardTitle>
                      <CardDescription className="text-xs text-gray-500">
                        Department of Computer Science & Engineering
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="flex items-center gap-1 font-medium text-xs">
                      <Users className="h-3 w-3" />
                      {group.totalStudents} Students
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Assigned Batches & Sections
                  </h4>
                  <div className="space-y-3">
                    {group.batches.map((b) => (
                      <div
                        key={b.batch}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100 gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-700 bg-white px-2.5 py-1 rounded border shadow-xs">
                            Batch {b.batch}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {b.sections.map((sec) => (
                              <Badge key={sec} variant="outline" className="bg-white border-emerald-300 text-emerald-700 text-xs font-semibold">
                                Section {sec}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 font-medium self-end sm:self-auto">
                          <Users className="h-3.5 w-3.5 text-gray-400" />
                          <span>{b.studentCount} students</span>
                        </div>
                      </div>
                    ))}
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
