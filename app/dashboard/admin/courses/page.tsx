"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Layers,
  Users,
  Plus,
  Edit,
  Trash2,
  X,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Save,
  FolderTree,
  GraduationCap,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  getAllCourses,
  getAllBatches,
  getSectionsByBatch,
  createCourse,
  updateCourse,
  deleteCourse,
  createBatch,
  deleteBatch,
  createSection,
  deleteSection,
  seedDefaultCatalog,
} from "@/lib/academics/courseManagement";
import { CourseDoc, BatchDoc, SectionDoc } from "@/lib/types";

type ModalMode = "add" | "edit";

export default function AdminCoursesPage() {
  const { toast } = useToast();

  // Data states
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [batches, setBatches] = useState<BatchDoc[]>([]);
  const [sections, setSections] = useState<SectionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Selection states
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  // Modal states
  const [courseModal, setCourseModal] = useState<{ mode: ModalMode; course?: CourseDoc } | null>(null);
  const [batchModal, setBatchModal] = useState<{ mode: ModalMode; batch?: BatchDoc } | null>(null);
  const [sectionModal, setSectionModal] = useState<{ mode: ModalMode; section?: SectionDoc } | null>(null);

  // Form states
  const [courseForm, setCourseForm] = useState({ name: "", code: "" });
  const [batchForm, setBatchForm] = useState({ name: "" });
  const [sectionForm, setSectionForm] = useState({ name: "" });

  const loadCourses = async () => {
    try {
      const data = await getAllCourses();
      setCourses(data);
      if (data.length > 0 && !selectedCourseId) {
        setSelectedCourseId(data[0].id);
      }
    } catch (error) {
      console.error("Error loading courses:", error);
    }
  };

  // Batches are global — an intake cohort like "241" is the same cohort no
  // matter which course you are looking at. They used to be loaded per course,
  // which duplicated every batch under every course and left a student's single
  // `batch: "241"` value unable to say which document it meant.
  const loadBatches = async () => {
    try {
      const data = await getAllBatches();
      setBatches(data);
      if (data.length > 0 && !data.some((b) => b.id === selectedBatchId)) {
        setSelectedBatchId(data[0].id);
      } else if (data.length === 0) {
        setSelectedBatchId("");
        setSections([]);
      }
    } catch (error) {
      console.error("Error loading batches:", error);
    }
  };

  const loadSections = async (batchId: string) => {
    if (!batchId) return;
    try {
      const data = await getSectionsByBatch(batchId);
      setSections(data);
    } catch (error) {
      console.error("Error loading sections:", error);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadCourses();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Batches are global, so they load once rather than per selected course.
  useEffect(() => {
    loadBatches();
  }, []);

  useEffect(() => {
    if (selectedBatchId) {
      loadSections(selectedBatchId);
    }
  }, [selectedBatchId]);

  // ===================== Course Handlers =====================

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseForm.name.trim() || !courseForm.code.trim()) {
      toast({ title: "Validation Error", description: "Course name and code are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const id = await createCourse(courseForm);
      toast({ title: "Course Created", description: `"${courseForm.name}" (${courseForm.code}) has been added.` });
      setCourseModal(null);
      setCourseForm({ name: "", code: "" });
      await loadCourses();
      if (!selectedCourseId) setSelectedCourseId(id);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create course.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseModal?.course) return;
    if (!courseForm.name.trim() || !courseForm.code.trim()) {
      toast({ title: "Validation Error", description: "Course name and code are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateCourse(courseModal.course.id, courseForm);
      toast({ title: "Course Updated", description: `"${courseForm.name}" has been updated.` });
      setCourseModal(null);
      await loadCourses();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update course.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = async (course: CourseDoc) => {
    // Batches and sections are shared across courses now, so they survive.
    if (
      !confirm(
        `Delete course "${course.name}"? Batches and sections are shared and will not be affected. It will be refused if any teacher assignment still uses this course.`
      )
    )
      return;
    setSaving(true);
    try {
      await deleteCourse(course.id);
      toast({ title: "Course Deleted", description: `"${course.name}" was removed.` });
      setSelectedCourseId("");
      await loadCourses();
    } catch (error: any) {
      toast({ title: "Cannot Delete Course", description: error.message || "Failed to delete course.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ===================== Batch Handlers =====================

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchForm.name.trim()) {
      toast({ title: "Validation Error", description: "Batch name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const id = await createBatch({ name: batchForm.name });
      toast({ title: "Batch Created", description: `Batch "${batchForm.name}" added.` });
      setBatchModal(null);
      setBatchForm({ name: "" });
      await loadBatches();
      setSelectedBatchId(id);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create batch.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBatch = async (batch: BatchDoc) => {
    if (
      !confirm(
        `Delete batch "${batch.name}"? This also deletes its sections. It will be refused if any student or teacher assignment still uses it.`
      )
    )
      return;
    setSaving(true);
    try {
      await deleteBatch(batch.id);
      toast({ title: "Batch Deleted", description: `Batch "${batch.name}" and its sections removed.` });
      await loadBatches();
      setSections([]);
    } catch (error: any) {
      toast({ title: "Cannot Delete Batch", description: error.message || "Failed to delete batch.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ===================== Section Handlers =====================

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchId) {
      toast({ title: "Validation Error", description: "Select a batch first.", variant: "destructive" });
      return;
    }
    if (!sectionForm.name.trim()) {
      toast({ title: "Validation Error", description: "Section name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createSection({ batchId: selectedBatchId, name: sectionForm.name });
      toast({ title: "Section Created", description: `Section "${sectionForm.name}" added.` });
      setSectionModal(null);
      setSectionForm({ name: "" });
      await loadSections(selectedBatchId);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create section.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (section: SectionDoc) => {
    if (
      !confirm(
        `Delete section "${section.name}"? It will be refused if any student or teacher assignment still uses it.`
      )
    )
      return;
    setSaving(true);
    try {
      await deleteSection(section.id);
      toast({ title: "Section Deleted", description: `Section "${section.name}" removed.` });
      await loadSections(selectedBatchId);
    } catch (error: any) {
      toast({ title: "Cannot Delete Section", description: error.message || "Failed to delete section.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ===================== Seed defaults =====================

  const handleSeedDefaults = async () => {
    if (!confirm("Seed the default CSE courses, batches, and sections? This will only run if the courses collection is empty.")) return;
    setSaving(true);
    try {
      await seedDefaultCatalog();
      toast({ title: "Default Catalog Seeded", description: "Default courses, batches, and sections created." });
      await loadCourses();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to seed default catalog.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);
  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  // ===================== Render =====================

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Course, Batch & Section Management</h1>
            <p className="text-gray-600 mt-1">
              Create and manage the academic hierarchy: Courses → Batches → Sections
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSeedDefaults} disabled={saving}>
              <RefreshCcw className="h-4 w-4 mr-2" />
              Seed Defaults
            </Button>
            <Button
              onClick={() => {
                setCourseForm({ name: "", code: "" });
                setCourseModal({ mode: "add" });
              }}
              disabled={saving}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Course
            </Button>
          </div>
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
                  <p className="text-2xl font-bold text-gray-900">{courses.length}</p>
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
                  <p className="text-2xl font-bold text-gray-900">{batches.length}</p>
                  <p className="text-xs text-gray-500 font-medium">Batches in {selectedCourse?.name || "Selected Course"}</p>
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
                  <p className="text-2xl font-bold text-gray-900">{sections.length}</p>
                  <p className="text-xs text-gray-500 font-medium">Sections in {selectedBatch?.name ? `Batch ${selectedBatch.name}` : "Selected Batch"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="courses" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="courses">
                <BookOpen className="h-4 w-4 mr-2" /> Courses
              </TabsTrigger>
              <TabsTrigger value="batches">
                <Layers className="h-4 w-4 mr-2" /> Batches
              </TabsTrigger>
              <TabsTrigger value="sections">
                <Users className="h-4 w-4 mr-2" /> Sections
              </TabsTrigger>
            </TabsList>

            {/* ==================== COURSES TAB ==================== */}
            <TabsContent value="courses" className="space-y-4 mt-4">
              <Card className="border-gray-200">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base font-bold">All Courses</CardTitle>
                  <CardDescription className="text-xs">
                    Course codes must be unique. Add, edit, or delete courses.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  {courses.length === 0 ? (
                    <div className="text-center py-10">
                      <FolderTree className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 font-medium">No courses yet.</p>
                      <p className="text-xs text-gray-400 mt-1">Click "Add Course" to create your first course, or "Seed Defaults" to load the default CSE catalog.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-gray-50/50 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                            <th className="text-left py-3 px-4">Course Code</th>
                            <th className="text-left py-3 px-4">Course Name</th>
                            <th className="text-left py-3 px-4">Department</th>
                            <th className="text-right py-3 px-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y text-sm">
                          {courses.map((course) => (
                            <tr key={course.id} className="hover:bg-gray-50/80 transition-colors">
                              <td className="py-3 px-4">
                                <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                  {course.code}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-semibold text-gray-900">{course.name}</td>
                              <td className="py-3 px-4">
                                <Badge variant="outline" className="bg-gray-50 text-gray-700 font-medium text-xs">
                                  {course.departmentName || "CSE Department"}
                                </Badge>
                              </td>
                              <td className="py-3 px-4 text-right space-x-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setCourseForm({ name: course.name, code: course.code });
                                    setCourseModal({ mode: "edit", course });
                                  }}
                                  disabled={saving}
                                >
                                  <Edit className="h-3.5 w-3.5 mr-1" />
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleDeleteCourse(course)}
                                  disabled={saving}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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
            </TabsContent>

            {/* ==================== BATCHES TAB ==================== */}
            <TabsContent value="batches" className="space-y-4 mt-4">
              <Card className="border-gray-200">
                <CardHeader className="pb-3 border-b">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-bold">Batches</CardTitle>
                      <CardDescription className="text-xs">
                        An intake cohort (e.g. 241). Batches are shared across all courses — a
                        student belongs to exactly one. Names are permanent.
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setBatchForm({ name: "" });
                        setBatchModal({ mode: "add" });
                      }}
                      disabled={saving}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Batch
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {batches.length === 0 ? (
                    <div className="text-center py-8">
                      <Layers className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-500 font-medium text-sm">No batches yet.</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Click &quot;Add Batch&quot; to create one, or seed the defaults.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {batches.map((batch) => (
                        <div key={batch.id} className="p-3 bg-gray-50 rounded-lg border flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                              Batch {batch.name}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => handleDeleteBatch(batch)}
                              disabled={saving}
                              title="Delete Batch"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500">
                            {sections.filter((s) => s.batchId === batch.id).length > 0
                              ? `${sections.filter((s) => s.batchId === batch.id).length} section(s)`
                              : "Manage sections in the Sections tab"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== SECTIONS TAB ==================== */}
            <TabsContent value="sections" className="space-y-4 mt-4">
              <Card className="border-gray-200">
                <CardHeader className="pb-3 border-b">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-bold">Sections</CardTitle>
                      <CardDescription className="text-xs">
                        Sections belong to a batch. Unique within their batch, so 241/D1 and
                        232/D1 are different sections. Names are permanent.
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSectionForm({ name: "" });
                        setSectionModal({ mode: "add" });
                      }}
                      disabled={!selectedBatchId || saving}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Section
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {/* Batch selector. No course selector: sections hang off the
                      batch alone, which is what makes a student's single
                      `section` value unambiguous. */}
                  <div className="bg-gray-50 p-3 rounded-lg border">
                    <Label className="text-xs font-semibold">Batch</Label>
                    <select
                      className="w-full h-9 px-2 mt-1 rounded border text-xs bg-white"
                      value={selectedBatchId}
                      onChange={(e) => setSelectedBatchId(e.target.value)}
                    >
                      <option value="">{batches.length ? "-- Select a batch --" : "No batches yet"}</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          Batch {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!selectedBatchId ? (
                    <p className="text-center text-xs text-gray-500 py-6">
                      Select a batch above to manage its sections.
                    </p>
                  ) : sections.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-500 font-medium text-sm">
                        No sections for Batch {selectedBatch?.name}.
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Click "Add Section" to create one.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {sections.map((section) => (
                        <div key={section.id} className="p-3 bg-gray-50 rounded-lg border flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                              Section {section.name}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => handleDeleteSection(section)}
                              disabled={saving}
                              title="Delete Section"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500">
                            Batch {selectedBatch?.name} • {selectedCourse?.code}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* ==================== COURSE MODAL ==================== */}
      {courseModal && (
        <ModalShell title={courseModal.mode === "add" ? "Add New Course" : "Edit Course"} onClose={() => setCourseModal(null)}>
          <form onSubmit={courseModal.mode === "add" ? handleCreateCourse : handleUpdateCourse} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="courseName" className="text-xs font-semibold">Course Name *</Label>
              <Input
                id="courseName"
                value={courseForm.name}
                onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}
                placeholder="e.g. Database Management System"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="courseCode" className="text-xs font-semibold">Course Code *</Label>
              <Input
                id="courseCode"
                value={courseForm.code}
                onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}
                placeholder="e.g. CSE 301"
                required
              />
              <p className="text-[11px] text-gray-400">Course codes must be unique. Displayed in UPPERCASE.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => setCourseModal(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                {courseModal.mode === "add" ? "Create Course" : "Save Changes"}
              </Button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* ==================== BATCH MODAL ==================== */}
      {batchModal && (
        <ModalShell title="Add Batch" onClose={() => setBatchModal(null)}>
          <form onSubmit={handleCreateBatch} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="batchName" className="text-xs font-semibold">Batch Name *</Label>
              <Input
                id="batchName"
                value={batchForm.name}
                onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                placeholder="e.g. 241"
                required
              />
              <p className="text-[11px] text-gray-400">
                Globally unique. Permanent once created — students and teacher assignments
                reference the batch by name.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => setBatchModal(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Create Batch
              </Button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* ==================== SECTION MODAL ==================== */}
      {sectionModal && (
        <ModalShell title={`Add Section to Batch ${selectedBatch?.name || ""}`} onClose={() => setSectionModal(null)}>
          <form onSubmit={handleCreateSection} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="sectionName" className="text-xs font-semibold">Section Name *</Label>
              <Input
                id="sectionName"
                value={sectionForm.name}
                onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })}
                placeholder="e.g. D1"
                required
              />
              <p className="text-[11px] text-gray-400">
                Unique within this batch. Permanent once created.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => setSectionModal(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Create Section
              </Button>
            </div>
          </form>
        </ModalShell>
      )}
    </DashboardLayout>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

