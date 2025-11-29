"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle, XCircle, Trash2, User } from "lucide-react";
import { getAllUsers } from "@/lib/firebase/firestore";
import { approveTeacher, rejectTeacher } from "@/lib/firebase/auth";
import { deleteUser } from "@/lib/firebase/firestore";
import { User as UserType } from "@/lib/types";
import { formatDate } from "@/lib/utils/helpers";

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadTeachers();
  }, []);

  const loadTeachers = async () => {
    try {
      const allUsers = await getAllUsers();
      const teacherUsers = allUsers.filter((u) => u.role === "teacher");
      setTeachers(teacherUsers);
    } catch (error) {
      console.error("Error loading teachers:", error);
      toast({
        title: "Error",
        description: "Failed to load teachers",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (userId: string, userName: string) => {
    try {
      await approveTeacher(userId);
      toast({
        title: "Teacher Approved",
        description: `${userName} has been approved and can now access the teacher dashboard.`,
      });
      loadTeachers();
    } catch (error) {
      console.error("Error approving teacher:", error);
      toast({
        title: "Error",
        description: "Failed to approve teacher",
        variant: "destructive",
      });
    }
  };

  const handleReject = async (userId: string, userName: string) => {
    try {
      await rejectTeacher(userId);
      toast({
        title: "Teacher Rejected",
        description: `${userName}'s application has been rejected.`,
      });
      loadTeachers();
    } catch (error) {
      console.error("Error rejecting teacher:", error);
      toast({
        title: "Error",
        description: "Failed to reject teacher",
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
        title: "Teacher Deleted",
        description: `${userName} has been removed from the system.`,
      });
      loadTeachers();
    } catch (error) {
      console.error("Error deleting teacher:", error);
      toast({
        title: "Error",
        description: "Failed to delete teacher",
        variant: "destructive",
      });
    }
  };

  const pendingTeachers = teachers.filter((t) => !t.approved && !t.rejected);
  const approvedTeachers = teachers.filter((t) => t.approved);
  const rejectedTeachers = teachers.filter((t) => t.rejected);

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Teacher Management</h1>
          <p className="text-gray-600 mt-2">Approve, reject, or manage teacher accounts</p>
        </div>

        {/* Pending Approvals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Pending Approvals ({pendingTeachers.length})</span>
            </CardTitle>
            <CardDescription>Teachers waiting for approval</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : pendingTeachers.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No pending approvals</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Name
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Email
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Applied Date
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTeachers.map((teacher) => (
                      <tr key={teacher.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm">{teacher.name}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">{teacher.email}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {formatDate(teacher.createdAt as any)}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(teacher.id, teacher.name)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleReject(teacher.id, teacher.name)}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
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

        {/* Approved Teachers */}
        <Card>
          <CardHeader>
            <CardTitle>Approved Teachers ({approvedTeachers.length})</CardTitle>
            <CardDescription>Active teacher accounts</CardDescription>
          </CardHeader>
          <CardContent>
            {approvedTeachers.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No approved teachers</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Name
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Email
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Joined Date
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedTeachers.map((teacher) => (
                      <tr key={teacher.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm flex items-center">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-green-100 text-green-600 mr-2">
                            <User className="h-4 w-4" />
                          </span>
                          {teacher.name}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">{teacher.email}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {formatDate(teacher.createdAt as any)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(teacher.id, teacher.name)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
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

        {/* Rejected Teachers */}
        {rejectedTeachers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Rejected Applications ({rejectedTeachers.length})</CardTitle>
              <CardDescription>Rejected teacher applications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Name
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Email
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                        Applied Date
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedTeachers.map((teacher) => (
                      <tr key={teacher.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm">{teacher.name}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">{teacher.email}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {formatDate(teacher.createdAt as any)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(teacher.id, teacher.name)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
