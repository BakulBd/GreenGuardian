"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Users,
  Mail,
  Search,
  BookOpen,
  Layers,
  Loader2,
  RefreshCw,
  GraduationCap,
  Download,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getAssignedStudents,
  subscribeToAssignedStudents,
  getAssignmentsByTeacher,
} from "@/lib/firebase/assignments";
import { TeacherStudentMapping, TeacherAssignment, User as UserType } from "@/lib/types";
import { getUsersByRole } from "@/lib/firebase/firestore";
import { downloadStudentInfoPdf } from "@/lib/utils/studentPdf";
import { formatDate } from "@/lib/utils/helpers";

interface StudentInfo {
  id: string;
  name: string;
  email: string;
  studentCode?: string;
  batch?: string;
  section?: string;
  department?: string;
  phone?: string;
  status?: string;
  createdAt?: any;
  courses: { courseId: string; courseName: string }[];
}

export default function TeacherStudentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [mappings, setMappings] = useState<TeacherStudentMapping[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (teacherId: string) => {
    try {
      setLoading(true);
      setError(null);
      const [mappingsData, assign, allStudentDocs] = await Promise.all([
        getAssignedStudents(teacherId).catch(() => []),
        getAssignmentsByTeacher(teacherId).catch(() => []),
        // Only used to enrich the students this teacher is already mapped to
        // with their full profile — never to widen who is shown.
        getUsersByRole("student").catch(() => []),
      ]);

      setAssignments(assign);
      setMappings(mappingsData);

      const userMap = new Map<string, UserType>();
      for (const u of allStudentDocs) {
        if (u.id) userMap.set(u.id, u);
      }

      const studentMap = new Map<string, StudentInfo>();

      // Build the roster strictly from this teacher's admin assignments.
      //
      // There used to be a fallback here: if a teacher had no mappings, the page
      // loaded *every* student in the system and presented them as "assigned to
      // you" — complete with an Export-to-PDF of their names, emails and phone
      // numbers. An unassigned teacher could walk the whole student directory.
      for (const mapping of mappingsData) {
        const sid = mapping.studentId;
        const u = userMap.get(sid);
        if (!studentMap.has(sid)) {
          studentMap.set(sid, {
            id: sid,
            name: u?.name || mapping.studentName || `Student ${sid.slice(0, 8)}`,
            email: u?.email || "",
            studentCode: u?.studentCode || mapping.studentCode || "",
            // No invented defaults: a blank batch renders as "—" rather than
            // showing every student as batch 241 / section D1.
            batch: u?.batch || mapping.batchName || "",
            section: u?.section || mapping.sectionName || "",
            department: u?.department || "",
            phone: u?.phone || "",
            status: u?.status || "active",
            createdAt: u?.createdAt,
            courses: [],
          });
        }
        const student = studentMap.get(sid)!;
        if (mapping.courseName && !student.courses.some((c) => c.courseId === mapping.courseId)) {
          student.courses.push({
            courseId: mapping.courseId,
            courseName: mapping.courseName || mapping.courseId,
          });
        }
      }

      setStudents(
        Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (err) {
      console.error("Failed to load teacher students:", err);
      setError("Could not load your students. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    loadData(user.id);

    const unsubscribe = subscribeToAssignedStudents(user.id, () => {
      loadData(user.id);
    });

    return () => unsubscribe();
  }, [user, loadData]);

  // Refresh data
  const handleRefresh = async () => {
    if (!user) return;
    await loadData(user.id);
    toast({ title: "Refreshed", description: "Student list updated successfully." });
  };

  // Get unique courses for filter
  const courseOptions = Array.from(
    new Map(
      assignments.map((a) => [a.courseId, { id: a.courseId, name: a.courseName || a.courseId }])
    ).values()
  );

  // Get unique batches for filter
  const batchOptions = Array.from(
    new Map(
      assignments.map((a) => [a.batchId, a.batchName || a.batchId])
    ).values()
  );

  const filteredStudents = students.filter((student) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      student.name.toLowerCase().includes(q) ||
      (student.studentCode || "").toLowerCase().includes(q) ||
      (student.batch || "").toLowerCase().includes(q) ||
      (student.section || "").toLowerCase().includes(q) ||
      student.courses.some((c) => c.courseName.toLowerCase().includes(q))
    );
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === filteredStudents.length ? new Set() : new Set(filteredStudents.map((s) => s.id))
    );
  };

  const handleDownloadPdf = () => {
    const toExport = selectedIds.size > 0 ? filteredStudents.filter((s) => selectedIds.has(s.id)) : filteredStudents;
    if (toExport.length === 0) {
      toast({ title: "No Students", description: "There are no students to export.", variant: "destructive" });
      return;
    }
    downloadStudentInfoPdf(
      toExport.map((s) => ({
        name: s.name,
        studentCode: s.studentCode,
        email: s.email,
        department: s.department,
        semester: s.batch ? `Batch ${s.batch}` : undefined,
        phone: s.phone,
        assignedTeacher: user?.name,
        registrationDate: s.createdAt ? formatDate(s.createdAt) : undefined,
        status: s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : "Active",
      })),
      "My Students Report"
    );
    toast({ title: "PDF Generated", description: `Exported ${toExport.length} student${toExport.length !== 1 ? "s" : ""}.` });
  };

  // Stats
  const totalStudents = students.length;
  const totalCourses = courseOptions.length;
  const totalBatches = batchOptions.length;

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Students</h1>
            <p className="text-gray-600 mt-2">
              Students assigned to you by the administrator
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleDownloadPdf}
              variant="outline"
              disabled={loading || filteredStudents.length === 0}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download PDF{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>
            <Button
              onClick={handleRefresh}
              variant="outline"
              className="flex items-center gap-2"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh List
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Total Students</p>
                <p className="text-2xl font-bold text-emerald-900 mt-1">{totalStudents}</p>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-600">
                <Users className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Courses</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">{totalCourses}</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-xl text-blue-600">
                <BookOpen className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border-purple-200">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wider">Batches</p>
                <p className="text-2xl font-bold text-purple-900 mt-1">{totalBatches}</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-xl text-purple-600">
                <Layers className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        {students.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search students by name, ID, batch, section, or course..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>
        )}

        {/* Student Table / Cards */}
        <Card>
          <CardHeader>
            <CardTitle>Assigned Students Directory</CardTitle>
            <CardDescription>
              Showing {filteredStudents.length} of {students.length} students
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading students...
              </div>
            ) : students.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-lg font-medium">No students assigned yet</p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  An administrator assigns you a Course, Batch and Section, and the
                  students enrolled in it appear here automatically.
                </p>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-lg font-medium">No matching students</p>
                <p className="text-sm mt-1">
                  None of your {students.length} student{students.length !== 1 ? "s" : ""} match
                  &ldquo;{searchQuery}&rdquo;.
                </p>
                <Button variant="outline" className="mt-4" onClick={() => setSearchQuery("")}>
                  Clear search
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-700 font-semibold uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3 w-8">
                        <input
                          type="checkbox"
                          checked={filteredStudents.length > 0 && selectedIds.size === filteredStudents.length}
                          onChange={toggleSelectAll}
                          aria-label="Select all students"
                        />
                      </th>
                      <th className="px-4 py-3">Student Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Student ID</th>
                      <th className="px-4 py-3">Batch</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Courses</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.map((student) => (
                      <tr key={student.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(student.id)}
                            onChange={() => toggleSelect(student.id)}
                            aria-label={`Select ${student.name}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                            {student.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{student.name}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {student.email ? (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5 text-gray-400" />
                              {student.email}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">N/A</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">
                          {student.studentCode || "N/A"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            {student.batch ? `Batch ${student.batch}` : "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            {student.section ? `Section ${student.section}` : "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {student.courses.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {student.courses.map((c) => (
                                <Badge key={c.courseId} className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-none text-xs">
                                  {c.courseName}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">All Department Courses</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
