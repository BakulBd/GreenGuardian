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
  UserCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getAssignedStudents,
  subscribeToAssignedStudents,
  getAssignmentsByTeacher,
} from "@/lib/firebase/assignments";
import { TeacherStudentMapping, TeacherAssignment } from "@/lib/types";
import { formatDateTime } from "@/lib/utils/helpers";

interface StudentInfo {
  id: string;
  name: string;
  email: string;
  studentCode?: string;
  batch?: string;
  section?: string;
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

  useEffect(() => {
    if (!user) return;

    // Load assignments
    getAssignmentsByTeacher(user.id).then(setAssignments).catch(() => {});

    // Real-time subscription to assigned students
    const unsubscribe = subscribeToAssignedStudents(user.id, (data) => {
      setMappings(data);
      buildStudentList(data, assignments);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Rebuild student list when mappings or assignments change
  const buildStudentList = useCallback(async (mappingsData: TeacherStudentMapping[], assignmentsData?: TeacherAssignment[]) => {
    const assign = assignmentsData || assignments;
    const studentMap = new Map<string, StudentInfo>();

    for (const mapping of mappingsData) {
      const sid = mapping.studentId;
      if (!studentMap.has(sid)) {
        // Try to get student name from mapping or from users collection
        let studentName = mapping.studentName || `Student ${sid.slice(0, 8)}`;
        let studentCode = mapping.studentCode;
        let email = "";

        // We store the mapping info directly
        studentMap.set(sid, {
          id: sid,
          name: studentName,
          email: email,
          studentCode,
          batch: mapping.batchName,
          section: mapping.sectionName,
          courses: [],
        });
      }
      const student = studentMap.get(sid)!;
      // Add course if not already present
      if (mapping.courseName && !student.courses.some((c) => c.courseId === mapping.courseId)) {
        student.courses.push({
          courseId: mapping.courseId,
          courseName: mapping.courseName || mapping.courseId,
        });
      }
    }

    setStudents(Array.from(studentMap.values()));
  }, [assignments]);

  // Refresh data
  const handleRefresh = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mappingsData, assign] = await Promise.all([
        getAssignedStudents(user.id),
        getAssignmentsByTeacher(user.id),
      ]);
      setMappings(mappingsData);
      setAssignments(assign);
      buildStudentList(mappingsData, assign);
    } catch (error) {
      console.error("Error refreshing students:", error);
      toast({ title: "Error", description: "Failed to refresh students", variant: "destructive" });
    } finally {
      setLoading(false);
    }
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
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Assigned Students</p>
                  <p className="text-2xl font-bold">{totalStudents}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-emerald-100 rounded-lg">
                  <BookOpen className="h-6 w-6 text-emerald-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Assigned Courses</p>
                  <p className="text-2xl font-bold">{totalCourses}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Layers className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Active Batches</p>
                  <p className="text-2xl font-bold">{totalBatches}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search students by name, ID, batch, section, or course..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Students List */}
        <Card>
          <CardHeader>
            <CardTitle>Students</CardTitle>
            <CardDescription>
              Students assigned to you ({filteredStudents.length} of {totalStudents})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 text-emerald-600 animate-spin mx-auto" />
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Students Found</h3>
                <p className="text-gray-600">
                  {searchQuery
                    ? "No students match your search criteria"
                    : "No students have been assigned to you yet. Contact the administrator."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Student</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">ID</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Batch</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Section</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Courses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((student) => (
                      <tr key={student.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center mr-3">
                              <span className="text-primary-600 font-medium">
                                {student.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{student.name}</p>
                              <p className="text-sm text-gray-500">{student.email || "Email not available"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm font-mono text-gray-700">
                            {student.studentCode || student.id.slice(0, 10)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                            Batch {student.batch || "N/A"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-200">
                            Section {student.section || "N/A"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {student.courses.map((c) => (
                              <Badge key={c.courseId} className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
                                {c.courseName}
                              </Badge>
                            ))}
                          </div>
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

