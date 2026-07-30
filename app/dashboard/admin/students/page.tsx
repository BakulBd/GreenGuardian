"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { User, Mail, Calendar, Trash2, Plus, Edit, Shield, Check, X } from "lucide-react";
import { getUsersByRole, deleteUser, updateUser } from "@/lib/firebase/firestore";
import { registerUser } from "@/lib/firebase/auth";
import { User as UserType } from "@/lib/types";
import { formatDate } from "@/lib/utils/helpers";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_DEPARTMENT, DEFAULT_BATCHES, DEFAULT_SECTIONS, DEFAULT_COURSES } from "@/lib/academics/catalog";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export default function StudentsPage() {
  const [students, setStudents] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<UserType | null>(null);
  const { toast } = useToast();

  // Add Student Form State
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "Password123!",
    studentCode: "",
    department: DEFAULT_DEPARTMENT.name,
    batch: "251",
    section: "D3",
  });

  // Edit Assignment Form State
  const [editData, setEditData] = useState({
    studentCode: "",
    department: DEFAULT_DEPARTMENT.name,
    batch: "251",
    section: "D3",
  });

  useEffect(() => {
    loadStudents();
  }, []);

  const loadStudents = async () => {
    try {
      setLoading(true);
      const studentUsers = await getUsersByRole("student");
      setStudents(studentUsers);
    } catch (error) {
      console.error("Error loading students:", error);
      toast({
        title: "Error",
        description: "Failed to load students",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    try {
      // 1. Register student in Auth & basic Firestore profile
      const { user: newUser, error } = await registerUser(
        formData.email,
        formData.password,
        formData.name,
        "student"
      );

      if (error || !newUser?.id) {
        throw new Error(error || "Registration failed");
      }

      // 2. Stash academic properties onto the student profile
      await setDoc(
        doc(db, "users", newUser.id),
        {
          studentCode: formData.studentCode || `STU-${Date.now().toString().slice(-6)}`,
          department: formData.department,
          batch: formData.batch,
          section: formData.section,
          sections: [formData.section],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      toast({
        title: "Student Created",
        description: `${formData.name} added under ${formData.department} (Batch ${formData.batch}, Section ${formData.section}).`,
      });

      setShowAddModal(false);
      setFormData({
        name: "",
        email: "",
        password: "Password123!",
        studentCode: "",
        department: DEFAULT_DEPARTMENT.name,
        batch: "251",
        section: "D3",
      });

      loadStudents();
    } catch (err: any) {
      toast({
        title: "Error Creating Student",
        description: err.message || "Failed to create student",
        variant: "destructive",
      });
    }
  };

  const handleUpdateStudentAcademic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;

    try {
      await updateUser(editingStudent.id, {
        studentCode: editData.studentCode,
        department: editData.department,
        batch: editData.batch,
        section: editData.section,
        sections: [editData.section],
      });

      toast({
        title: "Academic Assignment Updated",
        description: `Updated profile for ${editingStudent.name}.`,
      });

      setEditingStudent(null);
      loadStudents();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to update student academic assignment",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to delete ${userName}?`)) {
      return;
    }

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
    }
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
          <Button onClick={() => setShowAddModal(true)} className="w-fit">
            <Plus className="h-4 w-4 mr-2" />
            Add New Student
          </Button>
        </div>

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
                        <option value={DEFAULT_DEPARTMENT.name}>{DEFAULT_DEPARTMENT.name}</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Batch</Label>
                      <select
                        className="w-full h-9 px-2 rounded border text-xs bg-white"
                        value={formData.batch}
                        onChange={(e) => setFormData({ ...formData, batch: e.target.value })}
                      >
                        {DEFAULT_BATCHES.map((b) => (
                          <option key={b.id} value={b.name}>Batch {b.name}</option>
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
                        {DEFAULT_SECTIONS.map((s) => (
                          <option key={s.id} value={s.name}>Section {s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">Create Student</Button>
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
                        <option value={DEFAULT_DEPARTMENT.name}>{DEFAULT_DEPARTMENT.name}</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Batch</Label>
                      <select
                        className="w-full h-8 px-2 rounded border text-xs bg-white"
                        value={editData.batch}
                        onChange={(e) => setEditData({ ...editData, batch: e.target.value })}
                      >
                        {DEFAULT_BATCHES.map((b) => (
                          <option key={b.id} value={b.name}>{b.name}</option>
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
                        {DEFAULT_SECTIONS.map((s) => (
                          <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={() => setEditingStudent(null)}>
                      Cancel
                    </Button>
                    <Button type="submit">Save Changes</Button>
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
                Total: {students.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : students.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No students found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-gray-50/50 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      <th className="text-left py-3 px-4">Student & ID</th>
                      <th className="text-left py-3 px-4">Department</th>
                      <th className="text-left py-3 px-4">Batch</th>
                      <th className="text-left py-3 px-4">Section</th>
                      <th className="text-left py-3 px-4">Joined Date</th>
                      <th className="text-right py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-sm">
                    {students.map((student) => (
                      <tr key={student.id} className="hover:bg-gray-50/80 transition-colors">
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
                            Batch {student.batch || "241"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-200 text-xs font-semibold">
                            Section {student.section || (student.sections && student.sections[0]) || "All"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">
                          {formatDate(student.createdAt as any)}
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
                                batch: student.batch || "241",
                                section: student.section || "D1",
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
      </div>
    </DashboardLayout>
  );
}
