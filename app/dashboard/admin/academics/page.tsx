"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookOpen, Layers, Users, Shield, Plus, Edit, Trash2, Check, X, Loader2 } from "lucide-react";
import { DEFAULT_DEPARTMENT, DEFAULT_COURSES, DEFAULT_BATCHES, DEFAULT_SECTIONS, getTeacherAssignments, saveTeacherAssignments, CourseAssignment } from "@/lib/academics/catalog";
import { getUsersByRole } from "@/lib/firebase/firestore";
import { User } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";

export default function AdminAcademicsPage() {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<User | null>(null);
  const [teacherAssignments, setTeacherAssignments] = useState<CourseAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Custom assignment builder state
  const [newAssignment, setNewAssignment] = useState({
    courseId: DEFAULT_COURSES[0].id,
    batch: DEFAULT_BATCHES[0].name,
    section: DEFAULT_SECTIONS[0].name,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const teacherUsers = await getUsersByRole("teacher");
      setTeachers(teacherUsers);
      if (teacherUsers.length > 0) {
        selectTeacherForAssignment(teacherUsers[0]);
      }
    } catch (error) {
      console.error("Error loading academics data:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectTeacherForAssignment = async (teacher: User) => {
    setSelectedTeacher(teacher);
    const assignments = await getTeacherAssignments(teacher.id);
    setTeacherAssignments(assignments);
  };

  const handleAddAssignment = () => {
    const catalogCourse = DEFAULT_COURSES.find((c) => c.id === newAssignment.courseId);
    const courseName = catalogCourse ? catalogCourse.name : newAssignment.courseId;

    const exists = teacherAssignments.some(
      (a) => a.courseId === newAssignment.courseId && a.batch === newAssignment.batch && a.section === newAssignment.section
    );

    if (exists) {
      toast({
        title: "Assignment Exists",
        description: "This course, batch, and section is already assigned.",
        variant: "destructive",
      });
      return;
    }

    const updated = [
      ...teacherAssignments,
      {
        courseId: newAssignment.courseId,
        courseName,
        batch: newAssignment.batch,
        section: newAssignment.section,
      },
    ];

    setTeacherAssignments(updated);
  };

  const handleRemoveAssignment = (index: number) => {
    const updated = teacherAssignments.filter((_, i) => i !== index);
    setTeacherAssignments(updated);
  };

  const handleSaveAssignments = async () => {
    if (!selectedTeacher) return;
    try {
      setSaving(true);
      await saveTeacherAssignments(selectedTeacher.id, teacherAssignments);
      toast({
        title: "Assignments Saved",
        description: `Updated course assignments for ${selectedTeacher.name}.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save assignments",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="admin">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Academic Structure & Catalog</h1>
            <p className="text-gray-600 mt-1">
              Manage CSE Department courses, batches, sections, and teacher assignments
            </p>
          </div>
          <Badge variant="outline" className="w-fit bg-emerald-50 border-emerald-300 text-emerald-800 text-sm font-semibold">
            {DEFAULT_DEPARTMENT.name} ({DEFAULT_DEPARTMENT.code})
          </Badge>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-white to-emerald-50/40 border-emerald-100">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-xl text-emerald-700">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{DEFAULT_COURSES.length}</p>
                  <p className="text-xs text-gray-500 font-medium">CSE Courses</p>
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
                  <p className="text-2xl font-bold text-gray-900">{DEFAULT_BATCHES.length}</p>
                  <p className="text-xs text-gray-500 font-medium">Active Batches (231 - 262)</p>
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
                  <p className="text-2xl font-bold text-gray-900">{DEFAULT_SECTIONS.length}</p>
                  <p className="text-xs text-gray-500 font-medium">Sections per Course (D1 - D5)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Teacher Assignment Management */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Teacher Selector */}
          <Card className="lg:col-span-1 border-gray-200">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-bold">Approved Teachers</CardTitle>
              <CardDescription className="text-xs">Select teacher to manage course assignments</CardDescription>
            </CardHeader>
            <CardContent className="pt-3 px-2 space-y-1">
              {teachers.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTeacherForAssignment(t)}
                  className={`w-full text-left p-3 rounded-lg flex items-center justify-between transition-colors ${
                    selectedTeacher?.id === t.id
                      ? "bg-emerald-50 border border-emerald-300 text-emerald-900 font-semibold"
                      : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.email}</p>
                  </div>
                  {selectedTeacher?.id === t.id && <Check className="h-4 w-4 text-emerald-600" />}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Assignment Editor */}
          <Card className="lg:col-span-2 border-gray-200">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">
                  Course Assignments: {selectedTeacher ? selectedTeacher.name : "Select Teacher"}
                </CardTitle>
                <CardDescription className="text-xs">
                  Assign specific Courses, Batches, and Sections to this teacher
                </CardDescription>
              </div>
              {selectedTeacher && (
                <Button size="sm" onClick={handleSaveAssignments} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                  Save Assignments
                </Button>
              )}
            </CardHeader>

            <CardContent className="pt-4 space-y-4">
              {/* Add Assignment controls */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-gray-50 p-3 rounded-lg border">
                <select
                  className="h-9 px-2 border rounded text-xs bg-white"
                  value={newAssignment.courseId}
                  onChange={(e) => setNewAssignment({ ...newAssignment, courseId: e.target.value })}
                >
                  {DEFAULT_COURSES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>

                <select
                  className="h-9 px-2 border rounded text-xs bg-white"
                  value={newAssignment.batch}
                  onChange={(e) => setNewAssignment({ ...newAssignment, batch: e.target.value })}
                >
                  {DEFAULT_BATCHES.map((b) => (
                    <option key={b.id} value={b.name}>
                      Batch {b.name}
                    </option>
                  ))}
                </select>

                <select
                  className="h-9 px-2 border rounded text-xs bg-white"
                  value={newAssignment.section}
                  onChange={(e) => setNewAssignment({ ...newAssignment, section: e.target.value })}
                >
                  {DEFAULT_SECTIONS.map((s) => (
                    <option key={s.id} value={s.name}>
                      Section {s.name}
                    </option>
                  ))}
                </select>

                <Button size="sm" onClick={handleAddAssignment} className="h-9">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>

              {/* Assignment Table / List */}
              <div className="max-h-96 overflow-y-auto space-y-2 border rounded-lg p-2">
                {teacherAssignments.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-6">
                    No course assignments added yet. Use controls above to assign courses.
                  </p>
                ) : (
                  teacherAssignments.map((a, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 bg-white rounded border border-gray-100 hover:border-gray-200 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{a.courseName}</span>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Batch {a.batch}
                        </Badge>
                        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                          Section {a.section}
                        </Badge>
                      </div>
                      <button
                        onClick={() => handleRemoveAssignment(idx)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Remove Assignment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* CSE Course Catalog List */}
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle className="text-lg">CSE Course Catalog</CardTitle>
            <CardDescription>Default course offerings for Computer Science & Engineering</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {DEFAULT_COURSES.map((course) => (
                <div key={course.id} className="p-3 bg-gray-50 rounded-lg border flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                      {course.code}
                    </span>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{course.name}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Mapped to all Batches & Sections D1-D5</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
