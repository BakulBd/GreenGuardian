"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTeacherNotices,
  deleteNotice,
  formatNoticeDate,
} from "@/lib/firebase/notices";
import { Notice, NoticeStatus, NoticeTargetType } from "@/lib/types";
import {
  Plus,
  Search,
  FileText,
  Eye,
  Edit,
  Trash2,
  Loader2,
  Send,
  Clock,
  CheckCircle,
  Users,
  BookOpen,
  Filter,
  RefreshCw,
  ExternalLink,
  Paperclip,
} from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function TeacherNoticesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noticeToDelete, setNoticeToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadNotices();
    }
  }, [user]);

  const loadNotices = async () => {
    if (!user) return;
    try {
      const data = await getTeacherNotices(user.id);
      setNotices(data);
    } catch (error) {
      console.error("Error loading notices:", error);
      toast({
        title: "Error",
        description: "Failed to load notices",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!noticeToDelete) return;
    try {
      await deleteNotice(noticeToDelete);
      setNotices((prev) => prev.filter((n) => n.id !== noticeToDelete));
      toast({
        title: "Notice Deleted",
        description: "The notice has been deleted successfully.",
      });
    } catch (error) {
      console.error("Error deleting notice:", error);
      toast({
        title: "Error",
        description: "Failed to delete notice",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setNoticeToDelete(null);
    }
  };

  const getTargetLabel = (notice: Notice): string => {
    switch (notice.targetType) {
      case "all":
        return "All Students";
      case "course":
        return `Course: ${notice.targetCourseName || notice.targetCourseId}`;
      case "batch":
        return `Batch: ${notice.targetBatch}`;
      case "section":
        return `Section: ${notice.targetSection}`;
      case "semester":
        return `Semester/Batch: ${notice.targetBatch}`;
      case "individual":
        return `Individual Students (${notice.targetStudentIds?.length || 0})`;
      default:
        return "Unknown";
    }
  };

  const getTargetIcon = (type: NoticeTargetType) => {
    switch (type) {
      case "all":
        return <Users className="h-3.5 w-3.5" />;
      case "course":
        return <BookOpen className="h-3.5 w-3.5" />;
      case "batch":
        return <Users className="h-3.5 w-3.5" />;
      case "section":
        return <Users className="h-3.5 w-3.5" />;
      case "semester":
        return <BookOpen className="h-3.5 w-3.5" />;
      case "individual":
        return <Users className="h-3.5 w-3.5" />;
      default:
        return <Users className="h-3.5 w-3.5" />;
    }
  };

  // Filter notices
  const filteredNotices = notices.filter((notice) => {
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !notice.title.toLowerCase().includes(q) &&
        !notice.description.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    // Status filter
    if (statusFilter !== "all" && notice.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const draftNotices = filteredNotices.filter((n) => n.status === "draft");
  const publishedNotices = filteredNotices.filter((n) => n.status === "published");

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
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Notices</h1>
            <p className="text-gray-600 mt-1">
              Create and manage notices for your students
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadNotices}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Link href="/dashboard/teacher/notices/create">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Notice
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            <CardDescription>Search and filter your notices</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search notices..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Drafts</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Draft Notices */}
        {draftNotices.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Draft Notices ({draftNotices.length})
            </h2>
            <div className="space-y-3">
              {draftNotices.map((notice) => (
                <NoticeCard
                  key={notice.id}
                  notice={notice}
                  getTargetLabel={getTargetLabel}
                  getTargetIcon={getTargetIcon}
                  onDelete={(id) => {
                    setNoticeToDelete(id);
                    setDeleteDialogOpen(true);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Published Notices */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Published Notices ({publishedNotices.length})
          </h2>
          {notices.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <FileText className="mx-auto h-16 w-16 text-gray-300" />
                  <h3 className="mt-4 text-lg font-semibold text-gray-600">
                    No Notices Yet
                  </h3>
                  <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
                    Create your first notice to send important announcements to your students.
                  </p>
                  <Link href="/dashboard/teacher/notices/create">
                    <Button className="mt-4">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Notice
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : publishedNotices.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <div className="text-center">
                  <Send className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-2 text-gray-500">No published notices yet.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {publishedNotices.map((notice) => (
                <NoticeCard
                  key={notice.id}
                  notice={notice}
                  getTargetLabel={getTargetLabel}
                  getTargetIcon={getTargetIcon}
                  onDelete={(id) => {
                    setNoticeToDelete(id);
                    setDeleteDialogOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        {notices.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{notices.length}</p>
                  <p className="text-sm text-gray-500">Total Notices</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{publishedNotices.length}</p>
                  <p className="text-sm text-gray-500">Published</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-600">{draftNotices.length}</p>
                  <p className="text-sm text-gray-500">Drafts</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">
                    {notices.filter((n) => n.targetType === "all").length}
                  </p>
                  <p className="text-sm text-gray-500">Sent to All</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Notice</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this notice? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function NoticeCard({
  notice,
  getTargetLabel,
  getTargetIcon,
  onDelete,
}: {
  notice: Notice;
  getTargetLabel: (n: Notice) => string;
  getTargetIcon: (t: NoticeTargetType) => React.ReactNode;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 truncate">
                {notice.title}
              </h3>
              <Badge
                variant={notice.status === "published" ? "default" : "secondary"}
                className={
                  notice.status === "published"
                    ? "bg-green-100 text-green-700 border-green-200"
                    : "bg-amber-100 text-amber-700 border-amber-200"
                }
              >
                {notice.status === "published" ? (
                  <CheckCircle className="h-3 w-3 mr-1" />
                ) : (
                  <Clock className="h-3 w-3 mr-1" />
                )}
                {notice.status}
              </Badge>
            </div>
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">
              {notice.description}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                {getTargetIcon(notice.targetType)}
                {getTargetLabel(notice)}
              </span>
              {notice.attachmentUrl && (
                <span className="flex items-center gap-1">
                  <Paperclip className="h-3 w-3" />
                  Attachment
                </span>
              )}
              {notice.externalLink && (
                <span className="flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  External Link
                </span>
              )}
              <span>
                {formatNoticeDate(notice.createdAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/dashboard/teacher/notices/${notice.id}`)}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/dashboard/teacher/notices/${notice.id}/edit`)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(notice.id)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
