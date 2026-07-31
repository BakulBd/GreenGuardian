"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getNotice, deleteNotice, publishNoticeWithNotifications, getTargetedStudentIds, formatNoticeDate } from "@/lib/firebase/notices";
import { Notice } from "@/lib/types";
import {
  Loader2,
  ArrowLeft,
  Edit,
  Trash2,
  Send,
  Calendar,
  Users,
  BookOpen,
  Paperclip,
  ExternalLink,
  Globe,
  CheckCircle,
  Clock,
  FileText,
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

export default function TeacherNoticeDetailPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const noticeId = params.id as string;

  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (noticeId) {
      loadNotice();
    }
  }, [noticeId]);

  const loadNotice = async () => {
    try {
      const data = await getNotice(noticeId);
      if (!data) {
        toast({
          title: "Not Found",
          description: "Notice not found.",
          variant: "destructive",
        });
        router.push("/dashboard/teacher/notices");
        return;
      }
      // Verify ownership
      if (user && data.teacherId !== user.id) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to view this notice.",
          variant: "destructive",
        });
        router.push("/dashboard/teacher/notices");
        return;
      }
      setNotice(data);
    } catch (error) {
      console.error("Error loading notice:", error);
      toast({
        title: "Error",
        description: "Failed to load notice.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!notice) return;
    setPublishing(true);
    try {
      const targetedStudentIds = await getTargetedStudentIds(notice);
      await publishNoticeWithNotifications(noticeId, targetedStudentIds);
      setNotice({ ...notice, status: "published", publishedAt: new Date() });
      toast({
        title: "Notice Published",
        description: `Notice sent to ${targetedStudentIds.length} student(s).`,
      });
    } catch (error) {
      console.error("Error publishing notice:", error);
      toast({
        title: "Error",
        description: "Failed to publish notice.",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteNotice(noticeId);
      toast({
        title: "Notice Deleted",
        description: "The notice has been deleted.",
      });
      router.push("/dashboard/teacher/notices");
    } catch (error) {
      console.error("Error deleting notice:", error);
      toast({
        title: "Error",
        description: "Failed to delete notice.",
        variant: "destructive",
      });
    }
    setDeleteDialogOpen(false);
  };

  const getTargetLabel = (n: Notice): string => {
    switch (n.targetType) {
      case "all": return "All Students";
      case "course": return `Course: ${n.targetCourseName || n.targetCourseId}`;
      case "batch": return `Batch: ${n.targetBatch}`;
      case "section": return `Section: ${n.targetSection}`;
      case "semester": return `Semester/Batch: ${n.targetBatch}`;
      case "individual": return `Individual (${n.targetStudentIds?.length || 0} students)`;
      default: return "Unknown";
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!notice) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <FileText className="mx-auto h-16 w-16 text-gray-300" />
          <h3 className="mt-4 text-lg font-semibold text-gray-600">Notice Not Found</h3>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/teacher/notices">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Notice Details</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {notice.status === "draft" && (
              <Button
                onClick={handlePublish}
                disabled={publishing}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Publish
              </Button>
            )}
            <Link href={`/dashboard/teacher/notices/${noticeId}/edit`}>
              <Button variant="outline">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </Link>
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>

        {/* Notice Content */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">{notice.title}</CardTitle>
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
            </div>
            <CardDescription>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <span className="flex items-center gap-1 text-xs">
                  <Calendar className="h-3.5 w-3.5" />
                  Created: {formatNoticeDate(notice.createdAt)}
                </span>
                {notice.publishedAt && (
                  <span className="flex items-center gap-1 text-xs">
                    <Send className="h-3.5 w-3.5" />
                    Published: {formatNoticeDate(notice.publishedAt)}
                  </span>
                )}
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Description */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
              <div className="p-4 bg-gray-50 rounded-lg whitespace-pre-wrap text-gray-700">
                {notice.description}
              </div>
            </div>

            {/* Target Info */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Target Audience</h3>
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <Users className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-blue-800">{getTargetLabel(notice)}</span>
              </div>
            </div>

            {/* Attachment */}
            {notice.attachmentUrl && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Attachment</h3>
                <a
                  href={notice.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                >
                  <Paperclip className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 font-medium">
                    {notice.attachmentName || "Download Attachment"}
                  </span>
                  <ExternalLink className="h-4 w-4 text-green-600 ml-auto" />
                </a>
              </div>
            )}

            {/* External Link */}
            {notice.externalLink && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">External Link</h3>
                <a
                  href={notice.externalLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  <Globe className="h-4 w-4 text-purple-600" />
                  <span className="text-sm text-purple-700 font-medium truncate">
                    {notice.externalLink}
                  </span>
                  <ExternalLink className="h-4 w-4 text-purple-600 ml-auto" />
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation */}
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
