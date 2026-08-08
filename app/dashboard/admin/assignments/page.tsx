"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicCatalog } from "@/hooks/useAcademicCatalog";
import { auth } from "@/lib/firebase/config";
import { getUsersByRole } from "@/lib/firebase/firestore";
import {
  createTeacherAssignment,
  updateTeacherAssignment,
  removeTeacherAssignment,
  getAllAssignments,
  getAssignedStudents,
  getAssignmentHistory,
  subscribeToAllAssignments,
  getStudentGroup,
} from "@/lib/firebase/assignments";
import { TeacherAssignment, TeacherStudentMapping, AssignmentHistory, User } from "@/lib/types";
import {
  Plus,
  Trash2,
  X,
  Loader2,
  Users,
  BookOpen,
  GraduationCap,
  Layers,
  Link2,
  History,
  UserCog,
  Check,
  AlertTriangle,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils/helpers";

export default function AdminAssignmentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const catalog = useAcademicCatalog();

  const [teachers, setTeachers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [history, setHistory] = useState<AssignmentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Assignment form state
  const [showForm, setShowForm] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<TeacherAssignment | null>(null);
  const [formData, setFormData] = useState({
    teacherId: "",
    courseId: "",
    batchId: "",
    sectionId: "",
    selectedStudentIds: [] as string[],
  });
  const [groupStudents, setGroupStudents] = useState<User[]>([]);
  const [includeIndividuals, setIncludeIndividuals] = useState(false);

  // Assignment details / mappings
  const [mappingsByAssignment, setMappingsByAssignment] = useState<Record<string, TeacherStudentMapping[]>>({});
  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("all");

  // Students who currently have no teacher at all. A notice or exam published
  // to "all" reaches nobody in this list, and nothing else in the admin panel
  // made that visible — the notice just appeared to send successfully.
  const [uncoveredStudents, setUncoveredStudents] = useState<User[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(true);

  // ===================== Data Loading =====================

  const loadTeachersAndStudents = useCallback(async () => {
    try {
      const t = await getUsersByRole("teacher");
      setTeachers(t.filter((x) => x.approved));
    } catch (error) {
      console.error("Error loading teachers:", error);
    }
  }, []);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const students = await getUsersByRole("student");
      setUncoveredStudents(
        students.filter((s) => (s.assignedTeacherIds || []).length === 0)
      );
    } catch (error) {
      console.error("Error loading assignment coverage:", error);
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeachersAndStudents();
    loadCoverage();
  }, [loadTeachersAndStudents, loadCoverage]);

  // Real-time assignments
  useEffect(() => {
    const unsubscribe = subscribeToAllAssignments((data) => {
      setAssignments(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load history on mount
  useEffect(() => {
    getAssignmentHistory().then(setHistory).catch(() => {});
  }, []);

  // Load mappings for all assignments
  useEffect(() => {
    if (assignments.length === 0) return;
    let active = true;
    (async () => {
      const map: Record<string, TeacherStudentMapping[]> = {};
      for (const a of assignments) {
        if (!active) return;
        try {
          map[a.id] = await getAssignedStudents(a.teacherId);
        } catch {
          map[a.id] = [];
        }
      }
      if (active) setMappingsByAssignment(map);
    })();
    return () => {
      active = false;
    };
  }, [assignments]);

  // ===================== Group Resolution =====================

  useEffect(() => {
    if (formData.courseId && formData.batchId && formData.sectionId) {
      const batch = catalog.batches.find((b) => b.id === formData.batchId);
      const section = catalog.sections.find((s) => s.id === formData.sectionId);
      getStudentGroup(formData.courseId, batch?.name || "", section?.name || "").then((students) => {
        setGroupStudents(students);
      });
    } else {
      setGroupStudents([]);
    }
  }, [formData.courseId, formData.batchId, formData.sectionId, catalog.batches, catalog.sections]);

  // ===================== Form Helpers =====================

  const resetForm = () => {
    setFormData({
      teacherId: "",
      courseId: "",
      batchId: "",
      sectionId: "",
      selectedStudentIds: [],
    });
    setGroupStudents([]);
    setIncludeIndividuals(false);
    setEditingAssignment(null);
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (assignment: TeacherAssignment) => {
    setEditingAssignment(assignment);
    setFormData({
      teacherId: assignment.teacherId,
      courseId: assignment.courseId,
      batchId: assignment.batchId,
      sectionId: assignment.sectionId,
      selectedStudentIds: assignment.studentIds || [],
    });
    setIncludeIndividuals(false);
    setShowForm(true);
  };

  const toggleStudent = (studentId: string) => {
    setFormData((prev) => {
      const has = prev.selectedStudentIds.includes(studentId);
      return {
        ...prev,
        selectedStudentIds: has
          ? prev.selectedStudentIds.filter((id) => id !== studentId)
          : [...prev.selectedStudentIds, studentId],
      };
    });
  };

  const selectedBatch = catalog.batches.find((b) => b.id === formData.batchId);
  const selectedSection = catalog.sections.find((s) => s.id === formData.sectionId);

  // ===================== Submit Handlers =====================

  const handleCreate = async () => {
    if (!formData.teacherId || !formData.courseId || !formData.batchId || !formData.sectionId) {
      toast({ title: "Validation Error", description: "Please select teacher, course, batch and section.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const teacher = teachers.find((t) => t.id === formData.teacherId);
      const course = catalog.courses.find((c) => c.id === formData.courseId);
      const finalStudentIds = includeIndividuals ? formData.selectedStudentIds : undefined;

      await createTeacherAssignment({
        teacherId: formData.teacherId,
        teacherName: teacher?.name,
        courseId: formData.courseId,
        courseName: course?.name,
        courseCode: course?.code,
        batchId: formData.batchId,
        batchName: selectedBatch?.name,
        sectionId: formData.sectionId,
        sectionName: selectedSection?.name,
        studentIds: finalStudentIds,
        createdByAdminId: user?.id,
        createdByAdminName: user?.name,
      });

      toast({ title: "Assignment Created", description: "Students have been assigned to the teacher." });
      setShowForm(false);
      resetForm();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create assignment.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingAssignment) return;
    if (!formData.teacherId || !formData.courseId || !formData.batchId || !formData.sectionId) {
      toast({ title: "Validation Error", description: "Please select teacher, course, batch and section.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const teacher = teachers.find((t) => t.id === formData.teacherId);
      const course = catalog.courses.find((c) => c.id === formData.courseId);
      const finalStudentIds = includeIndividuals ? formData.selectedStudentIds : undefined;

      await updateTeacherAssignment(editingAssignment.id, {
        teacherId: formData.teacherId,
        teacherName: teacher?.name,
        courseId: formData.courseId,
        courseName: course?.name,
        courseCode: course?.code,
        batchId: formData.batchId,
        batchName: selectedBatch?.name,
        sectionId: formData.sectionId,
        sectionName: selectedSection?.name,
        studentIds: finalStudentIds,
        createdByAdminId: user?.id,
        createdByAdminName: user?.name,
      });

      toast({ title: "Assignment Updated", description: "Students have been re-synced to the teacher." });
      setShowForm(false);
      resetForm();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update assignment.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (assignment: TeacherAssignment) => {
    if (!confirm(`Remove this assignment?\n\nTeacher: ${assignment.teacherName || assignment.teacherId}\n${assignment.courseName || assignment.courseId} • Batch ${assignment.batchName || ""} • Section ${assignment.sectionName || ""}\n\nStudents will lose access for this group.`)) return;
    setSaving(true);
    try {
      await removeTeacherAssignment(assignment.id, { id: user?.id, name: user?.name });
      toast({ title: "Assignment Removed", description: "Students removed from this teacher's access." });
      const updatedHistory = await getAssignmentHistory();
      setHistory(updatedHistory);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove assignment.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const [assign, hist, t] = await Promise.all([
        getAllAssignments(),
        getAssignmentHistory(),
        getUsersByRole("teacher"),
      ]);
      setAssignments(assign);
      setHistory(hist);
      setTeachers(t.filter((x) => x.approved));
    } catch (error) {
      console.error("Error refreshing:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Fixes the "published exams / notices not visible" bug for every student
   * whose roster links have drifted — including students who registered after
   * their teacher's assignment was created and so never got a mapping row at
   * all. Safe to run any time — see backfillAllAssignedTeacherIds() for why.
   */
  const handleSyncAssignedTeacherIds = async () => {
    const current = auth.currentUser;
    if (!current) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      return;
    }
    setSyncing(true);
    try {
      // Server-side: the rebuild has to create `teacher_student_mapping` rows
      // and write other users' documents, and it walks every student. Doing it
      // from the browser meant one round trip per student and only worked for
      // an admin session.
      const res = await fetch("/api/admin/roster/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await current.getIdToken()}`,
        },
        body: JSON.stringify({}),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.success) {
        throw new Error(result?.error || "The rebuild could not be completed.");
      }

      await loadCoverage();
      toast({
        title: "Roster Rebuilt",
        description:
          `Checked ${result.studentsChecked} student${result.studentsChecked !== 1 ? "s" : ""}: ` +
          `${result.linksCreated} link${result.linksCreated !== 1 ? "s" : ""} added, ` +
          `${result.linksRemoved} removed. ` +
          (result.uncovered > 0
            ? `${result.uncovered} student${result.uncovered !== 1 ? "s are" : " is"} still not covered by any assignment — see "Coverage Gaps" below.`
            : "Every student is now covered by at least one assignment."),
      });
    } catch (error: any) {
      toast({ title: "Sync Failed", description: error.message || "Failed to sync assignments", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  // ===================== Derived Data =====================

  const teacherName = (id: string) => teachers.find((t) => t.id === id)?.name || id;

  const getAssignmentStudentCount = (assignmentId: string): number => {
    const mappings = mappingsByAssignment[assignmentId];
    if (mappings) {
      return new Set(mappings.map((m) => m.studentId)).size;
    }
    return 0;
  };

  const filteredAssignments = assignments.filter((a) => {
    if (teacherFilter !== "all" && a.teacherId !== teacherFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const teacher = (a.teacherName || "").toLowerCase();
      const course = (a.courseName || "").toLowerCase();
      const batch = (a.batchName || "").toLowerCase();
      const section = (a.sectionName || "").toLowerCase();
      if (!teacher.includes(q) && !course.includes(q) && !batch.includes(q) && !section.includes(q)) {
        return false;
      }
    }
    return true;
  });

  const groupedByTeacher = new Map<string, TeacherAssignment[]>();
  filteredAssignments.forEach((a) => {
    if (!groupedByTeacher.has(a.teacherId)) groupedByTeacher.set(a.teacherId, []);
    groupedByTeacher.get(a.teacherId)!.push(a);
  });

  // Roll the uncovered students up to Batch → Section, which is the unit an
  // admin actually fixes: one new assignment covers a whole section at once.
  const coverageGaps = Array.from(
    uncoveredStudents
      .reduce((acc, s) => {
        const batch = s.batch || "No batch";
        const section = s.section || s.sections?.[0] || "No section";
        const key = `${batch}|${section}`;
        const entry = acc.get(key) || { batch, section, students: [] as User[] };
        entry.students.push(s);
        acc.set(key, entry);
        return acc;
      }, new Map<string, { batch: string; section: string; students: User[] }>())
      .values()
  ).sort((a, b) => a.batch.localeCompare(b.batch) || a.section.localeCompare(b.section));

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teacher Assignments</h1>
            <p className="text-gray-600 mt-1">
              Assign courses, batches & sections to teachers. Teachers only see their assigned students.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" onClick={handleSyncAssignedTeacherIds} disabled={syncing} title="Fixes exams/notices not showing up for already-assigned students">
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserCog className="h-4 w-4 mr-2" />}
              Sync Assignment Visibility
            </Button>
            <Button onClick={openCreateForm} disabled={saving}>
              <Plus className="h-4 w-4 mr-2" />
              New Assignment
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-xl text-blue-700"><Link2 className="h-6 w-6" /></div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{assignments.length}</p>
                  <p className="text-xs text-gray-500 font-medium">Total Assignments</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-xl text-emerald-700"><UserCog className="h-6 w-6" /></div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{groupedByTeacher.size}</p>
                  <p className="text-xs text-gray-500 font-medium">Teachers Assigned</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-xl text-purple-700"><Users className="h-6 w-6" /></div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {Object.values(mappingsByAssignment).reduce((acc, m) => acc + new Set(m.map((x) => x.studentId)).size, 0)}
                  </p>
                  <p className="text-xs text-gray-500 font-medium">Students Assigned</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-100 rounded-xl text-amber-700"><History className="h-6 w-6" /></div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{history.length}</p>
                  <p className="text-xs text-gray-500 font-medium">History Events</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coverage gaps.
            A student with no teacher receives nothing: not notices, not exams,
            not even a notice addressed to "all". Until this panel existed
            nothing surfaced that, so a teacher would publish a notice, see a
            success message, and quietly reach an empty audience. */}
        {!coverageLoading && coverageGaps.length > 0 && (
          <Card className="border-amber-300 bg-amber-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900 text-base">
                <AlertTriangle className="h-5 w-5" />
                Coverage Gaps — {uncoveredStudents.length} student
                {uncoveredStudents.length !== 1 ? "s" : ""} have no teacher
              </CardTitle>
              <CardDescription className="text-amber-800">
                These students are not covered by any assignment, so notices and exams
                — including ones sent to &ldquo;all students&rdquo; — will never reach
                them. Create an assignment for each group below, then run{" "}
                <span className="font-medium">Sync Assignment Visibility</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {coverageGaps.map((gap) => (
                  <div
                    key={`${gap.batch}-${gap.section}`}
                    className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
                  >
                    <Layers className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-gray-900">
                      Batch {gap.batch} &middot; Section {gap.section}
                    </span>
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                      {gap.students.length}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===================== Assignment Form Modal ===================== */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4 sticky top-0 bg-white z-10">
                <div>
                  <CardTitle className="text-lg">{editingAssignment ? "Edit Assignment" : "New Teacher Assignment"}</CardTitle>
                  <CardDescription className="text-xs">
                    {editingAssignment ? "Update the group or teacher. Students will be re-synced." : "Select Course → Batch → Section → Teacher"}
                  </CardDescription>
                </div>
                <button onClick={() => { setShowForm(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Step 1: Course */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs flex items-center justify-center font-bold">1</span>
                    Select Course
                  </Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={formData.courseId}
                    onChange={(e) => setFormData({ ...formData, courseId: e.target.value, batchId: "", sectionId: "" })}
                  >
                    <option value="">-- Choose a course --</option>
                    {catalog.courseOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.code ? `${c.code} - ` : ""}{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Step 2: Batch */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">2</span>
                    Select Batch
                  </Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100"
                    value={formData.batchId}
                    onChange={(e) => setFormData({ ...formData, batchId: e.target.value, sectionId: "" })}
                    disabled={!formData.courseId}
                  >
                    <option value="">{formData.courseId ? "-- Choose a batch --" : "Select a course first"}</option>
                    {/* Batches are global — every course is taught to the same
                        set of intake cohorts, so this list is not filtered by
                        the selected course. */}
                    {catalog.batchOptions.map((b) => (
                      <option key={b.id} value={b.id}>Batch {b.name}</option>
                    ))}
                  </select>
                </div>

                {/* Step 3: Section */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs flex items-center justify-center font-bold">3</span>
                    Select Section
                  </Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100"
                    value={formData.sectionId}
                    onChange={(e) => setFormData({ ...formData, sectionId: e.target.value })}
                    disabled={!formData.batchId}
                  >
                    <option value="">{formData.batchId ? "-- Choose a section --" : "Select a batch first"}</option>
                    {catalog.getSectionsForBatch(formData.batchId).map((s) => (
                      <option key={s.id} value={s.id}>Section {s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Step 4: Teacher */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-orange-100 text-orange-700 text-xs flex items-center justify-center font-bold">4</span>
                    Select Teacher
                  </Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={formData.teacherId}
                    onChange={(e) => setFormData({ ...formData, teacherId: e.target.value })}
                  >
                    <option value="">-- Choose a teacher --</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
                    ))}
                  </select>
                </div>

                {/* Student Preview */}
                {formData.courseId && formData.batchId && formData.sectionId && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-gray-500" />
                        <span className="text-sm font-semibold text-gray-700">
                          Students in {selectedSection?.name ? `Section ${selectedSection.name}` : ""} • {selectedBatch?.name ? `Batch ${selectedBatch.name}` : ""}
                        </span>
                      </div>
                      <Badge variant="secondary">{groupStudents.length} students</Badge>
                    </div>

                    {/* Include individual toggle */}
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeIndividuals}
                        onChange={(e) => setIncludeIndividuals(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-medium text-gray-700">Assign only specific students (optional)</span>
                    </label>

                    {includeIndividuals && (
                      <>
                        <Input
                          placeholder="Search students by name or ID..."
                          className="text-sm"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <div className="max-h-48 overflow-y-auto rounded-lg border bg-white divide-y">
                          {groupStudents.filter((s) =>
                            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (s.studentCode || "").toLowerCase().includes(searchQuery.toLowerCase())
                          ).map((s) => (
                            <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formData.selectedStudentIds.includes(s.id)}
                                onChange={() => toggleStudent(s.id)}
                                className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                              />
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">{s.name}</p>
                                <p className="text-xs text-gray-500">{s.studentCode || s.email}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500">
                          {formData.selectedStudentIds.length} of {groupStudents.length} students selected
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* Summary / Validation */}
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                  {!formData.teacherId && <p><AlertTriangle className="h-3.5 w-3.5 inline mr-1" /> Select a teacher to complete the assignment.</p>}
                  {formData.teacherId && formData.courseId && formData.batchId && formData.sectionId && (
                    <p><Check className="h-3.5 w-3.5 inline mr-1" />
                      Will assign{" "}
                      <strong>{includeIndividuals ? formData.selectedStudentIds.length : groupStudents.length}</strong> student(s)
                      {includeIndividuals && formData.selectedStudentIds.length < groupStudents.length ? " (subset)" : ""} to{" "}
                      <strong>{teacherName(formData.teacherId)}</strong>
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={editingAssignment ? handleUpdate : handleCreate}
                    disabled={saving || !formData.teacherId || !formData.courseId || !formData.batchId || !formData.sectionId || (includeIndividuals && formData.selectedStudentIds.length === 0)}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {editingAssignment ? "Update Assignment" : "Assign Students"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================== Filters ===================== */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Assignments</CardTitle>
            <CardDescription>Filter and review all teacher assignments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by teacher, course, batch or section..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                className="w-full sm:w-[220px] h-10 px-3 rounded-md border border-gray-300 bg-white text-sm"
                value={teacherFilter}
                onChange={(e) => setTeacherFilter(e.target.value)}
              >
                <option value="all">All Teachers</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* ===================== Assignments List ===================== */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
          </div>
        ) : filteredAssignments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Link2 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-800">No Assignments Found</h3>
              <p className="text-sm text-gray-500 mt-1">
                {assignments.length === 0 ? "Create your first teacher assignment to get started." : "No assignments match your filters."}
              </p>
              {assignments.length === 0 && (
                <Button onClick={openCreateForm} className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  New Assignment
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          Array.from(groupedByTeacher.entries()).map(([tId, teacherAssignments]) => (
            <Card key={tId}>
              <CardHeader className="pb-3 border-b bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      {(teacherName(tId) || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <CardTitle className="text-base">{teacherName(tId)}</CardTitle>
                      <CardDescription className="text-xs">
                        {teacherAssignments.length} assignment{teacherAssignments.length !== 1 ? "s" : ""} •{" "}
                        {new Set(teacherAssignments.flatMap((a) => a.courseId)).size} course(s)
                      </CardDescription>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={openCreateForm}>
                    <Plus className="h-4 w-4 mr-1" />
                    Assign
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {teacherAssignments.map((assignment) => {
                    const count = getAssignmentStudentCount(assignment.id);
                    const isExpanded = expandedAssignment === assignment.id;
                    const mappings = mappingsByAssignment[assignment.id] || [];
                    return (
                      <div key={assignment.id} className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-50/50 hover:bg-gray-100/70 cursor-pointer" onClick={() => setExpandedAssignment(isExpanded ? null : assignment.id)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                              <BookOpen className="h-3 w-3 mr-1" />
                              {assignment.courseName || assignment.courseId}
                            </Badge>
                            <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                              <Layers className="h-3 w-3 mr-1" />
                              Batch {assignment.batchName || ""}
                            </Badge>
                            <Badge className="bg-purple-100 text-purple-800 border-purple-200">
                              <Users className="h-3 w-3 mr-1" />
                              Section {assignment.sectionName || ""}
                            </Badge>
                            {assignment.studentIds && assignment.studentIds.length > 0 && (
                              <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                                <GraduationCap className="h-3 w-3 mr-1" />
                                {assignment.studentIds.length} individual student(s)
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{count} students</Badge>
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-blue-600"
                                onClick={() => openEditForm(assignment)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-red-600 hover:bg-red-50"
                                onClick={() => handleRemove(assignment)}
                                disabled={saving}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="p-3 border-t bg-white">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Assigned Students</p>
                            {mappings.length === 0 ? (
                              <p className="text-sm text-gray-400">No student mappings found.</p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                                {Array.from(new Map(mappings.map((m) => [m.studentId, m])).values()).map((m) => (
                                  <div key={m.studentId} className="flex items-center gap-2 rounded-md border border-gray-100 px-2 py-1.5 text-sm">
                                    <div className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 text-xs flex items-center justify-center font-bold">
                                      {(m.studentName || "?").charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate text-gray-900">{m.studentName}</p>
                                      <p className="text-[10px] text-gray-500">{m.studentCode || m.studentId.slice(0, 8)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {/* ===================== History ===================== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Assignment History
            </CardTitle>
            <CardDescription>Audit trail of all assignment changes</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-center text-gray-500 py-6 text-sm">No assignment activity yet.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                    <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                      h.action === "created" ? "bg-green-500" :
                      h.action === "updated" ? "bg-blue-500" : "bg-red-500"
                    }`} />
                    <div className="flex-1 min-w-0 text-sm">
                      <p className="text-gray-800">
                        <strong>{h.teacherName || h.teacherId}</strong>{" "}
                        <span className={
                          h.action === "created" ? "text-green-600 font-medium" :
                          h.action === "updated" ? "text-blue-600 font-medium" : "text-red-600 font-medium"
                        }>{h.action}</span>{" "}
                        {h.courseName || h.courseId} • Batch {h.batchName || ""} • Section {h.sectionName || ""}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {h.studentCount ?? 0} student(s) affected
                        {h.changedByAdminName ? ` • by ${h.changedByAdminName}` : ""}
                        {" • "}
                        {h.timestamp ? formatDateTime((h.timestamp as any)?.toDate ? (h.timestamp as any).toDate() : new Date()) : "N/A"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

