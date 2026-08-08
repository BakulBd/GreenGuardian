"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Edit, X, Download, Search, Loader2, AlertCircle } from "lucide-react";
import { getUsersByRole, deleteUser, updateUser } from "@/lib/firebase/firestore";
import { resyncStudentAssignments } from "@/lib/firebase/assignments";
import { auth } from "@/lib/firebase/config";
import { User as UserType } from "@/lib/types";
import { formatDate } from "@/lib/utils/helpers";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_DEPARTMENT } from "@/lib/academics/catalog";
import { useAcademicCatalog } from "@/hooks/useAcademicCatalog";
import AccountStatusControl from "@/components/AccountStatusControl";
import { doc, setDoc, serverTimestamp, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { downloadStudentInfoPdf } from "@/lib/utils/studentPdf";

import { validateName, validateEmail } from "@/lib/utils/validation";

export default function StudentsPage() {
  const [students, setStudents] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<UserType | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [teacherNamesByStudent, setTeacherNamesByStudent] = useState<Map<string, string[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const { toast } = useToast();
  const catalog = useAcademicCatalog();

  // Batches/sections are course-scoped in Firestore (one BatchDoc per
  // course+name), but a student's batch/section fields are flat strings —
  // dedupe by name so the dropdown doesn't repeat "241" once per course.
  const departmentNames = useMemo(() => {
    const names = Array.from(new Set(catalog.courses.map((c) => c.departmentName).filter(Boolean))) as string[];
    return names.length > 0 ? names : [DEFAULT_DEPARTMENT.name];
  }, [catalog.courses]);
  const batchNames = useMemo(() => {
    const names = Array.from(new Set(catalog.batches.map((b) => b.name).filter(Boolean)));
    return names.sort();
  }, [catalog.batches]);
  const sectionNames = useMemo(() => {
    const names = Array.from(new Set(catalog.sections.map((s) => s.name).filter(Boolean)));
    return names.sort();
  }, [catalog.sections]);

  // Add Student Form State
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "Password123!",
    studentCode: "",
    department: DEFAULT_DEPARTMENT.name,
    batch: "",
    section: "",
  });

  // Edit Assignment Form State
  const [editData, setEditData] = useState({
    studentCode: "",
    department: DEFAULT_DEPARTMENT.name,
    batch: "",
    section: "",
  });

  useEffect(() => {
    loadStudents();
  }, []);

  // Seed the new-student selects from the live catalog rather than shipping
  // fixed "251"/"D3" defaults that may not exist in this deployment.
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      batch: prev.batch || batchNames[0] || "",
      section: prev.section || sectionNames[0] || "",
    }));
  }, [batchNames, sectionNames]);

  const loadStudents = async () => {
    try {
      setLoading(true);
      setError(null);
      const [studentUsers, mappingsSnap] = await Promise.all([
        getUsersByRole("student"),
        getDocs(collection(db, "teacher_student_mapping")).catch(() => null),
      ]);
      setStudents(studentUsers);

      if (mappingsSnap) {
        const map = new Map<string, Set<string>>();
        mappingsSnap.docs.forEach((d) => {
          const data = d.data();
          if (!data.studentId || !data.teacherName) return;
          const set = map.get(data.studentId) || new Set<string>();
          set.add(data.teacherName);
          map.set(data.studentId, set);
        });
        setTeacherNamesByStudent(new Map(Array.from(map.entries()).map(([k, v]) => [k, Array.from(v)])));
      }
    } catch (err) {
      console.error("Error loading students:", err);
      setError("Could not load students. Check your connection and try again.");
      toast({
        title: "Error",
        description: "Failed to load students",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allShown = filteredStudents.length > 0 && filteredStudents.every((s) => prev.has(s.id));
      return allShown ? new Set() : new Set(filteredStudents.map((s) => s.id));
    });
  };

  const handleDownloadPdf = () => {
    const toExport =
      selectedIds.size > 0 ? students.filter((s) => selectedIds.has(s.id)) : filteredStudents;
    if (toExport.length === 0) {
      toast({ title: "No Students", description: "There are no students to export.", variant: "destructive" });
      return;
    }
    downloadStudentInfoPdf(
      toExport.map((s) => ({
        name: s.name,
        studentCode: s.studentCode,
        email: s.email,
        department: s.department || DEFAULT_DEPARTMENT.name,
        semester: s.batch ? `Batch ${s.batch}` : undefined,
        phone: s.phone,
        assignedTeacher: (teacherNamesByStudent.get(s.id) || []).join(", ") || undefined,
        registrationDate: s.createdAt ? formatDate(s.createdAt as any) : undefined,
        status: s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : "Active",
      })),
      "Student Information Report"
    );
    toast({ title: "PDF Generated", description: `Exported ${toExport.length} student${toExport.length !== 1 ? "s" : ""}.` });
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;

    const nameCheck = validateName(formData.name);
    if (!nameCheck.isValid) {
      toast({
        title: "Validation Error",
        description: nameCheck.error || "Invalid full name.",
        variant: "destructive",
      });
      return;
    }

    const emailCheck = validateEmail(formData.email);
    if (!emailCheck.isValid) {
      toast({
        title: "Validation Error",
        description: emailCheck.error || "Invalid email address.",
        variant: "destructive",
      });
      return;
    }

    if (formData.password.length < 8) {
      toast({
        title: "Validation Error",
        description: "The initial password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.batch || !formData.section) {
      toast({
        title: "Validation Error",
        description: "Pick a batch and a section — teacher rosters and exam targeting are keyed off them.",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      // Created through the Admin SDK route. Calling the client SDK's
      // createUserWithEmailAndPassword here signed this browser in as the new
      // student, dropping the admin out of their own session mid-task.
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Your session expired. Please sign in again.");
      const token = await currentUser.getIdToken();

      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Could not create the student (${res.status}).`);
      }

      // Attach the new student to every teacher assignment covering their
      // batch/section straight away, so they show on the right roster and are
      // included in that group's exams without waiting for an admin to
      // re-save the assignment.
      const sync = await resyncStudentAssignments(data.studentId).catch(() => null);

      toast({
        title: "Student Created",
        description:
          `${formData.name} added to Batch ${formData.batch}, Section ${formData.section}` +
          (sync && sync.gained.length > 0
            ? ` and linked to ${sync.gained.length} teacher assignment${sync.gained.length !== 1 ? "s" : ""}.`
            : ". No teacher is assigned to that group yet."),
      });

      setShowAddModal(false);
      setFormData({
        name: "",
        email: "",
        password: "Password123!",
        studentCode: "",
        department: DEFAULT_DEPARTMENT.name,
        batch: batchNames[0] || "",
        section: sectionNames[0] || "",
      });

      loadStudents();
    } catch (err: any) {
      toast({
        title: "Error Creating Student",
        description: err.message || "Failed to create student",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateStudentAcademic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent || savingEdit) return;

    if (!editData.batch || !editData.section) {
      toast({
        title: "Validation Error",
        description: "Batch and section are required.",
        variant: "destructive",
      });
      return;
    }

    const moved =
      editData.batch !== editingStudent.batch || editData.section !== editingStudent.section;

    setSavingEdit(true);
    try {
      await updateUser(editingStudent.id, {
        studentCode: editData.studentCode,
        department: editData.department,
        batch: editData.batch,
        section: editData.section,
        sections: [editData.section],
      });

      // Moving a student between groups used to leave every downstream record
      // behind: they kept their old teacher's roster slot, kept seeing that
      // teacher's published exams, and never appeared for the new one.
      const sync = await resyncStudentAssignments(editingStudent.id).catch(() => null);

      toast({
        title: "Student Updated",
        description:
          moved && sync
            ? `Moved to Batch ${editData.batch} / Section ${editData.section}. Teacher links: +${sync.gained.length}, -${sync.lost.length}.`
            : `Updated profile for ${editingStudent.name}.`,
      });

      setEditingStudent(null);
      loadStudents();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to update student academic assignment",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    if (deletingId) return;
    if (
      !confirm(
        `Delete ${userName}?\n\nTheir profile, roster links and results become inaccessible. ` +
          `Their sign-in credentials are not removed, so use Hold/Suspend instead if you only want to block access.\n\nThis cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingId(userId);
    try {
      await deleteUser(userId);
      toast({
        title: "Student Deleted",
        description: `${userName} has been removed from the system.`,
      });
      loadStudents();
    } catch (error) {
      console.error("Error deleting student:", error);
      toast({
        title: "Error",
        description: "Failed to delete student",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (batchFilter !== "all" && s.batch !== batchFilter) return false;
      const sectionValue = s.section || s.sections?.[0] || "";
      if (sectionFilter !== "all" && sectionValue !== sectionFilter) return false;
      if (!q) return true;
      return (
        (s.name || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        (s.studentCode || "").toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, batchFilter, sectionFilter]);

  const filtersActive =
    !!searchQuery.trim() || batchFilter !== "all" || sectionFilter !== "all";

  const resetFilters = () => {
    setSearchQuery("");
    setBatchFilter("all");
    setSectionFilter("all");
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Student Management</h1>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">
              Manage student accounts with Department, Batch, and Section assignments
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleDownloadPdf} variant="outline" className="w-fit" disabled={loading || students.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Download PDF{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>
            <Button onClick={() => setShowAddModal(true)} className="w-fit">
              <Plus className="h-4 w-4 mr-2" />
              Add New Student
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadStudents}>
              Retry
            </Button>
          </div>
        )}

        {/* Search & filters */}
        {students.length > 0 && (
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name, email, or student ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  aria-label="Search students"
                />
              </div>
              <select
                className="h-9 px-3 rounded-md border border-gray-300 bg-white text-sm"
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                aria-label="Filter by batch"
              >
                <option value="all">All Batches</option>
                {batchNames.map((name) => (
                  <option key={name} value={name}>Batch {name}</option>
                ))}
              </select>
              <select
                className="h-9 px-3 rounded-md border border-gray-300 bg-white text-sm"
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                aria-label="Filter by section"
              >
                <option value="all">All Sections</option>
                {sectionNames.map((name) => (
                  <option key={name} value={name}>Section {name}</option>
                ))}
              </select>
              <Button variant="outline" onClick={resetFilters} disabled={!filtersActive}>
                Reset
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Add Student Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-lg bg-white shadow-2xl">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">Add New Student</CardTitle>
                  <CardDescription className="text-xs">Create student with academic assignment</CardDescription>
                </div>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleCreateStudent} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="name" className="text-xs font-semibold">Full Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Student Name"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="email" className="text-xs font-semibold">Email Address *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="student@example.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="studentCode" className="text-xs font-semibold">Student ID</Label>
                      <Input
                        id="studentCode"
                        value={formData.studentCode}
                        onChange={(e) => setFormData({ ...formData, studentCode: e.target.value })}
                        placeholder="0182220005101001"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="password" className="text-xs font-semibold">Initial Password</Label>
                      <Input
                        id="password"
                        type="text"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Department</Label>
                      <select
                        className="w-full h-9 px-2 rounded border text-xs bg-white"
                        value={formData.department}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      >
                        {departmentNames.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Batch</Label>
                      <select
                        className="w-full h-9 px-2 rounded border text-xs bg-white"
                        value={formData.batch}
                        onChange={(e) => setFormData({ ...formData, batch: e.target.value })}
                      >
                        {batchNames.map((name) => (
                          <option key={name} value={name}>Batch {name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Section</Label>
                      <select
                        className="w-full h-9 px-2 rounded border text-xs bg-white"
                        value={formData.section}
                        onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                      >
                        {sectionNames.map((name) => (
                          <option key={name} value={name}>Section {name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={creating}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={creating}>
                      {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create Student
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Edit Student Modal */}
        {editingStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md bg-white shadow-2xl">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                <div>
                  <CardTitle className="text-lg">Edit Student Academic Assignment</CardTitle>
                  <CardDescription className="text-xs">{editingStudent.name} ({editingStudent.email})</CardDescription>
                </div>
                <button onClick={() => setEditingStudent(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </CardHeader>
              <CardContent className="pt-4">
                <form onSubmit={handleUpdateStudentAcademic} className="space-y-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Student ID</Label>
                    <Input
                      value={editData.studentCode}
                      onChange={(e) => setEditData({ ...editData, studentCode: e.target.value })}
                      placeholder="0182220005101001"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Dept</Label>
                      <select
                        className="w-full h-8 px-2 rounded border text-xs bg-white"
                        value={editData.department}
                        onChange={(e) => setEditData({ ...editData, department: e.target.value })}
                      >
                        {departmentNames.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Batch</Label>
                      <select
                        className="w-full h-8 px-2 rounded border text-xs bg-white"
                        value={editData.batch}
                        onChange={(e) => setEditData({ ...editData, batch: e.target.value })}
                      >
                        {batchNames.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Section</Label>
                      <select
                        className="w-full h-8 px-2 rounded border text-xs bg-white"
                        value={editData.section}
                        onChange={(e) => setEditData({ ...editData, section: e.target.value })}
                      >
                        {sectionNames.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={() => setEditingStudent(null)} disabled={savingEdit}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={savingEdit}>
                      {savingEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Save Changes
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Student List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Enrolled Students</CardTitle>
                <CardDescription>Academic hierarchy view by Department, Batch, and Section</CardDescription>
              </div>
              <Badge variant="secondary" className="font-semibold text-sm">
                {filtersActive
                  ? `${filteredStudents.length} of ${students.length}`
                  : `Total: ${students.length}`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : students.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium text-gray-700">No students yet</p>
                <p className="text-sm mt-1">
                  Students appear here once they register, or add one directly.
                </p>
                <Button className="mt-4" onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Student
                </Button>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium text-gray-700">No matching students</p>
                <p className="text-sm mt-1">
                  None of your {students.length} students match the current search or filters.
                </p>
                <Button variant="outline" className="mt-4" onClick={resetFilters}>
                  Reset filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-gray-50/50 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      <th className="text-left py-3 px-4 w-8">
                        <input
                          type="checkbox"
                          checked={filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id))}
                          onChange={toggleSelectAll}
                          aria-label="Select all students"
                        />
                      </th>
                      <th className="text-left py-3 px-4">Student & ID</th>
                      <th className="text-left py-3 px-4">Department</th>
                      <th className="text-left py-3 px-4">Batch</th>
                      <th className="text-left py-3 px-4">Section</th>
                      <th className="text-left py-3 px-4">Joined Date</th>
                      <th className="text-right py-3 px-4">Status</th>
                      <th className="text-right py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-sm">
                    {filteredStudents.map((student) => (
                      <tr key={student.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(student.id)}
                            onChange={() => toggleSelect(student.id)}
                            aria-label={`Select ${student.name}`}
                          />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center">
                            <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold mr-3 text-xs">
                              {student.name ? student.name.charAt(0).toUpperCase() : "S"}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">{student.name}</p>
                              <p className="text-xs text-gray-500">{student.email}</p>
                              <p className="text-[10px] font-mono text-emerald-700 font-semibold mt-0.5">
                                ID: {student.studentCode || student.id.slice(0, 10)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-gray-50 text-gray-700 font-medium text-xs">
                            {student.department || DEFAULT_DEPARTMENT.code}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 text-xs font-semibold">
                            {student.batch ? `Batch ${student.batch}` : "No batch"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-200 text-xs font-semibold">
                            {student.section || student.sections?.[0]
                              ? `Section ${student.section || student.sections?.[0]}`
                              : "No section"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">
                          {formatDate(student.createdAt as any)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <AccountStatusControl
                            userId={student.id}
                            userName={student.name}
                            status={student.status}
                            onChanged={loadStudents}
                          />
                        </td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingStudent(student);
                              setEditData({
                                studentCode: student.studentCode || "",
                                department: student.department || DEFAULT_DEPARTMENT.name,
                                batch: student.batch || batchNames[0] || "",
                                section: student.section || student.sections?.[0] || sectionNames[0] || "",
                              });
                            }}
                          >
                            <Edit className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(student.id, student.name)}
                            disabled={deletingId === student.id}
                          >
                            {deletingId === student.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
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
