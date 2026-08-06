"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  BookOpen,
  Users,
  Hash,
  Archive,
  ArchiveRestore,
  Trash2,
  Edit,
  X,
  Loader2,
  School,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  createClassroom,
  updateClassroom,
  archiveClassroom,
  restoreClassroom,
  deleteClassroom,
  subscribeToTeacherClassrooms,
} from "@/lib/firebase/classrooms";
import { Classroom } from "@/lib/types";

export default function TeacherClassroomsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Classroom | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", section: "", semester: "", description: "" });

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToTeacherClassrooms(user.id, (data) => {
      setClassrooms(data);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const resetForm = () => {
    setForm({ name: "", subject: "", section: "", semester: "", description: "" });
    setEditing(null);
    setShowModal(false);
  };

  const startEdit = (c: Classroom) => {
    setEditing(c);
    setForm({ name: c.name, subject: c.subject, section: c.section, semester: c.semester || "", description: c.description || "" });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.name.trim() || !form.subject.trim() || !form.section.trim()) {
      toast({ title: "Missing fields", description: "Name, subject, and section are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateClassroom(editing.id, form);
        toast({ title: "Classroom Updated" });
      } else {
        await createClassroom({ ...form, teacherId: user.id, teacherName: user.name });
        toast({ title: "Classroom Created", description: `${form.name} is ready.` });
      }
      resetForm();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save classroom", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (c: Classroom) => {
    try {
      await archiveClassroom(c.id);
      toast({ title: "Classroom Archived" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleRestore = async (c: Classroom) => {
    try {
      await restoreClassroom(c.id);
      toast({ title: "Classroom Restored" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (c: Classroom) => {
    if (!confirm(`Permanently delete "${c.name}"? All posts, classwork, and the student roster will be lost. This cannot be undone.`)) return;
    try {
      await deleteClassroom(c.id);
      toast({ title: "Classroom Deleted" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const visible = classrooms.filter((c) => (showArchived ? c.status === "archived" : c.status === "active"));

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Classrooms</h1>
            <p className="text-gray-600 mt-1">Manage your classrooms — stream, classwork, and students in one place</p>
          </div>
          <div className="flex gap-2">
            <Button variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived((v) => !v)}>
              <Archive className="h-4 w-4 mr-2" />
              {showArchived ? "Viewing Archived" : "View Archived"}
            </Button>
            <Button onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Classroom
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16 text-gray-500">
              <School className="mx-auto h-16 w-16 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600">
                {showArchived ? "No archived classrooms" : "No classrooms yet"}
              </h3>
              {!showArchived && (
                <Button className="mt-4" onClick={() => setShowModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first classroom
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <Card key={c.id} className="hover:shadow-md transition-shadow overflow-hidden">
                <div className="h-2 bg-gradient-to-r from-emerald-500 to-green-500" />
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg truncate cursor-pointer hover:text-emerald-700" onClick={() => router.push(`/dashboard/teacher/classrooms/${c.id}`)}>
                    {c.name}
                  </CardTitle>
                  <CardDescription>
                    {c.subject} &middot; Section {c.section}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Badge variant="outline" className="font-mono">
                      <Hash className="h-3 w-3 mr-1" />
                      {c.code}
                    </Badge>
                    <Badge variant="outline">
                      <Users className="h-3 w-3 mr-1" />
                      {c.studentCount ?? 0}
                    </Badge>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/teacher/classrooms/${c.id}`)}>
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(c)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    {c.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => handleArchive(c)} title="Archive">
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => handleRestore(c)} title="Restore">
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg bg-white shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div>
                <CardTitle className="text-lg">{editing ? "Edit Classroom" : "Create New Classroom"}</CardTitle>
                <CardDescription className="text-xs">
                  {editing ? "Update classroom details" : "A unique join code will be generated automatically"}
                </CardDescription>
              </div>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-1">
                <Label>Classroom Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Structures — Section D2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Subject *</Label>
                  <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. CSE 201" />
                </div>
                <div className="space-y-1">
                  <Label>Section *</Label>
                  <Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="e.g. D2" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Semester (optional)</Label>
                <Input value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} placeholder="e.g. Fall 2026" />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {editing ? "Save Changes" : "Create Classroom"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
