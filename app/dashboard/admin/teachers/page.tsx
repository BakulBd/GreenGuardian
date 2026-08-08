"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle, XCircle, Trash2, User, Search, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getAllUsers } from "@/lib/firebase/firestore";
import { approveTeacher, rejectTeacher } from "@/lib/firebase/auth";
import { deleteUser } from "@/lib/firebase/firestore";
import { User as UserType } from "@/lib/types";
import { formatDate } from "@/lib/utils/helpers";
import AccountStatusControl from "@/components/AccountStatusControl";

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    loadTeachers();
  }, []);

  const loadTeachers = async () => {
    try {
      setError(null);
      const allUsers = await getAllUsers();
      const teacherUsers = allUsers.filter((u) => u.role === "teacher");
      setTeachers(teacherUsers);
    } catch (err) {
      console.error("Error loading teachers:", err);
      setError("Could not load teachers. Check your connection and try again.");
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
    if (busyId) return;
    setBusyId(userId);
    try {
      await approveTeacher(userId);
      toast({
        title: "Teacher Approved",
        description: `${userName} has been approved and can now access the teacher dashboard.`,
      });
      await loadTeachers();
    } catch (error) {
      console.error("Error approving teacher:", error);
      toast({
        title: "Error",
        description: "Failed to approve teacher",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (userId: string, userName: string) => {
    if (busyId) return;
    // Rejection locks the teacher out of the dashboard, so it asks first.
    if (!confirm(`Reject ${userName}'s application?\n\nThey will not be able to access the teacher dashboard. You can approve them later.`)) {
      return;
    }
    setBusyId(userId);
    try {
      await rejectTeacher(userId);
      toast({
        title: "Teacher Rejected",
        description: `${userName}'s application has been rejected.`,
      });
      await loadTeachers();
    } catch (error) {
      console.error("Error rejecting teacher:", error);
      toast({
        title: "Error",
        description: "Failed to reject teacher",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    if (busyId) return;
    if (
      !confirm(
        `Delete ${userName}?\n\nTheir exams, notices and classrooms stay in the database but lose their owner. ` +
          `Their sign-in credentials are not removed, so use Hold/Suspend instead if you only want to block access.\n\nThis cannot be undone.`
      )
    ) {
      return;
    }

    setBusyId(userId);
    try {
      await deleteUser(userId);
      toast({
        title: "Teacher Deleted",
        description: `${userName} has been removed from the system.`,
      });
      await loadTeachers();
    } catch (error) {
      console.error("Error deleting teacher:", error);
      toast({
        title: "Error",
        description: "Failed to delete teacher",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const matchesSearch = (t: UserType) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (t.name || "").toLowerCase().includes(q) || (t.email || "").toLowerCase().includes(q);
  };

  const visibleTeachers = teachers.filter(matchesSearch);
  const pendingTeachers = visibleTeachers.filter((t) => !t.approved && !t.rejected);
  const approvedTeachers = visibleTeachers.filter((t) => t.approved);
  const rejectedTeachers = visibleTeachers.filter((t) => t.rejected);

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teacher Management</h1>
            <p className="text-gray-600 mt-2">Approve, reject, or manage teacher accounts</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search teachers"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadTeachers}>
              Retry
            </Button>
          </div>
        )}

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
              <p className="text-center text-gray-500 py-8">
                {searchQuery ? "No pending applications match your search" : "No pending approvals"}
              </p>
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
                            disabled={!!busyId}
                          >
                            {busyId === teacher.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4 mr-1" />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleReject(teacher.id, teacher.name)}
                            disabled={!!busyId}
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
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : approvedTeachers.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                {searchQuery ? "No approved teachers match your search" : "No approved teachers"}
              </p>
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
                        Status
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
                          <AccountStatusControl
                            userId={teacher.id}
                            userName={teacher.name}
                            status={teacher.status}
                            onChanged={loadTeachers}
                          />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(teacher.id, teacher.name)}
                            disabled={!!busyId}
                          >
                            {busyId === teacher.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-1" />
                            )}
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
                        <td className="py-3 px-4 text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApprove(teacher.id, teacher.name)}
                            disabled={!!busyId}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Reconsider
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(teacher.id, teacher.name)}
                            disabled={!!busyId}
                          >
                            {busyId === teacher.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-1" />
                            )}
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
