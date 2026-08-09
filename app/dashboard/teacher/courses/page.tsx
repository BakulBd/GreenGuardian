"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Users,
  Layers,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  getAssignmentsByTeacher,
  getAssignedStudents,
} from "@/lib/firebase/assignments";
import { downloadStudentInfoPdf } from "@/lib/utils/studentPdf";
import { TeacherAssignment, TeacherStudentMapping } from "@/lib/types";

/**
 * Roster for one course, expandable in place, with a PDF export of exactly the
 * students shown.
 */
function EnrolledStudents({
  courseName,
  students,
  teacherName,
}: {
  courseName: string;
  students: TeacherStudentMapping[];
  teacherName?: string;
}) {
  const [open, setOpen] = useState(false);

  if (students.length === 0) {
    return (
      <p className="text-xs text-gray-400 border-t pt-3">No students enrolled in this course yet.</p>
    );
  }

  const handleExport = () => {
    downloadStudentInfoPdf(
      students.map((s) => ({
        name: s.studentName || s.studentId,
        studentCode: s.studentCode,
        email: "",
        semester: s.batchName ? `Batch ${s.batchName}` : undefined,
        department: s.sectionName ? `Section ${s.sectionName}` : undefined,
        assignedTeacher: teacherName,
      })),
      `${courseName} — Enrolled Students`
    );
  };

  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1.5 uppercase tracking-wider"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Enrolled Students ({students.length})
        </button>
        {open && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" />
            PDF
          </Button>
        )}
      </div>

      {open && (
        <ul className="mt-2 max-h-64 overflow-y-auto divide-y rounded-lg border">
          {students.map((s) => (
            <li key={s.studentId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {s.studentName || s.studentId}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                {s.studentCode && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {s.studentCode}
                  </Badge>
                )}
                {s.sectionName && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                    {s.batchName ? `${s.batchName}/` : ""}
                    {s.sectionName}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CourseGroup {
  courseId: string;
  courseName: string;
  courseCode?: string;
  batches: {
    batchId: string;
    batchName: string;
    sections: {
      sectionId: string;
      sectionName: string;
      studentCount: number;
    }[];
    studentCount: number;
  }[];
  totalStudents: number;
}

export default function MyCoursesPage() {
  const { user } = useAuth();
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [mappings, setMappings] = useState<TeacherStudentMapping[]>([]);

  /**
   * Roster per course, deduplicated by student.
   *
   * A student assigned to the same course across two sections has two mapping
   * rows; listing both would show them twice and inflate the exported roster.
   */
  const studentsByCourse = useMemo(() => {
    const byCourse = new Map<string, Map<string, TeacherStudentMapping>>();
    for (const mapping of mappings) {
      if (!byCourse.has(mapping.courseId)) byCourse.set(mapping.courseId, new Map());
      const students = byCourse.get(mapping.courseId)!;
      if (!students.has(mapping.studentId)) students.set(mapping.studentId, mapping);
    }
    return new Map(
      Array.from(byCourse, ([courseId, students]) => [
        courseId,
        Array.from(students.values()).sort((a, b) =>
          (a.studentName || "").localeCompare(b.studentName || "")
        ),
      ])
    );
  }, [mappings]);

  useEffect(() => {
    if (user) {
      loadTeacherCourses();
    }
  }, [user]);

  const loadTeacherCourses = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [assignments, studentMappings] = await Promise.all([
        getAssignmentsByTeacher(user.id),
        getAssignedStudents(user.id),
      ]);
      setMappings(studentMappings);

      // Group assignments by Course -> Batch -> Section
      const courseMap = new Map<string, {
        courseId: string;
        courseName: string;
        courseCode?: string;
        batches: Map<string, Map<string, { sectionId: string; sectionName: string }>>;
      }>();

      assignments.forEach((a) => {
        if (!courseMap.has(a.courseId)) {
          courseMap.set(a.courseId, {
            courseId: a.courseId,
            courseName: a.courseName || a.courseId,
            courseCode: a.courseCode,
            batches: new Map(),
          });
        }
        const course = courseMap.get(a.courseId)!;
        if (!course.batches.has(a.batchId)) {
          course.batches.set(a.batchId, new Map());
        }
        const batchSections = course.batches.get(a.batchId)!;
        if (!batchSections.has(a.sectionId)) {
          batchSections.set(a.sectionId, {
            sectionId: a.sectionId,
            sectionName: a.sectionName || a.sectionId,
          });
        }
      });

      // Build result and count students
      const result: CourseGroup[] = [];

      courseMap.forEach((course) => {
        let courseTotalStudents = 0;
        const batchesList: {
          batchId: string;
          batchName: string;
          sections: { sectionId: string; sectionName: string; studentCount: number }[];
          studentCount: number;
        }[] = [];

        course.batches.forEach((sections, batchId) => {
          const firstAssign = assignments.find((a) => a.batchId === batchId);
          const batchName = firstAssign?.batchName || batchId;
          let batchStudentCount = 0;

          const sectionsList = Array.from(sections.values()).map((s) => {
            // Count unique students in this section for this batch
            const studentIds = new Set(
              studentMappings
                .filter(
                  (m) =>
                    m.batchId === batchId &&
                    m.sectionId === s.sectionId &&
                    m.courseId === course.courseId
                )
                .map((m) => m.studentId)
            );
            batchStudentCount += studentIds.size;
            return {
              ...s,
              studentCount: studentIds.size,
            };
          });

          courseTotalStudents += batchStudentCount;
          batchesList.push({
            batchId,
            batchName,
            sections: sectionsList,
            studentCount: batchStudentCount,
          });
        });

        result.push({
          courseId: course.courseId,
          courseName: course.courseName,
          courseCode: course.courseCode,
          batches: batchesList.sort((a, b) => a.batchName.localeCompare(b.batchName)),
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

  const handleRefresh = () => {
    loadTeacherCourses();
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
              Courses assigned to you by the administrator
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
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
                    {courseGroups.reduce((acc, c) => acc + c.totalStudents, 0)}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 font-medium">Assigned Students</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Course Cards */}
        {courseGroups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-800">No Courses Assigned</h3>
              <p className="text-sm text-gray-500 mt-1">
                Please contact the administrator to assign courses.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {courseGroups.map((group) => (
              <Card key={group.courseId} className="hover:shadow-md transition-shadow border-gray-200">
                <CardHeader className="pb-3 border-b bg-gray-50/50">
                  <div className="flex items-start justify-between">
                    <div>
                      {group.courseCode && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                          {group.courseCode}
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
                        key={b.batchId}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100 gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-700 bg-white px-2.5 py-1 rounded border shadow-xs">
                            Batch {b.batchName}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {b.sections.map((sec) => (
                              <Badge key={sec.sectionId} variant="outline" className="bg-white border-emerald-300 text-emerald-700 text-xs font-semibold">
                                Section {sec.sectionName} ({sec.studentCount})
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

                  {/* Enrolled students.
                      The card previously reported only counts, so a teacher who
                      wanted to know WHO was in a course had to leave for the
                      Students page and filter it back down. Collapsed by default
                      to keep the grid of course cards scannable. */}
                  <EnrolledStudents
                    courseName={group.courseName}
                    students={studentsByCourse.get(group.courseId) || []}
                    teacherName={user?.name}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

