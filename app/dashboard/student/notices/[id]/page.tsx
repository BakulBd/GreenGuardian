"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getNotice,
  markNoticeRead,
  formatNoticeDate,
} from "@/lib/firebase/notices";
import { Notice } from "@/lib/types";
import {
  Loader2,
  ArrowLeft,
  Calendar,
  Users,
  Paperclip,
  ExternalLink,
  Globe,
  Download,
  FileText,
  Bell,
  CheckCircle,
  User,
  BookOpen,
} from "lucide-react";
import Link from "next/link";

export default function StudentNoticeDetailPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const noticeId = params.id as string;

  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (noticeId && user) {
      loadNotice();
    }
  }, [noticeId, user]);

  const loadNotice = async () => {
    try {
      const data = await getNotice(noticeId);
      if (!data) {
        toast({
          title: "Not Found",
          description: "Notice not found.",
          variant: "destructive",
        });
        router.push("/dashboard/student/notices");
        return;
      }
      setNotice(data);

      // Mark as read
      if (user) {
        await markNoticeRead(noticeId, user.id);
      }
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

  const getTargetLabel = (n: Notice): string => {
    switch (n.targetType) {
      case "all": return "All Students";
      case "course": return `Course: ${n.targetCourseName || n.targetCourseId}`;
      case "batch": return `Batch: ${n.targetBatch}`;
      case "section": return `Section: ${n.targetSection}`;
      case "semester": return `Semester: ${n.targetBatch}`;
      case "individual": return "Direct Notice";
      default: return "Unknown";
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="student">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!notice) {
    return (
      <DashboardLayout role="student">
        <div className="text-center py-12">
          <FileText className="mx-auto h-16 w-16 text-gray-300" />
          <h3 className="mt-4 text-lg font-semibold text-gray-600">Notice Not Found</h3>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="student">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard/student/notices">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Notices
            </Button>
          </Link>
        </div>

        {/* Notice Content */}
        <Card>
          <CardHeader className="bg-gradient-to-r from-blue-50 to-white border-b">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-xl sm:text-2xl">{notice.title}</CardTitle>
                  <Badge className="bg-green-100 text-green-700 border-green-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Published
                  </Badge>
                </div>
                <CardDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    <span className="flex items-center gap-1 text-xs">
                      <Calendar className="h-3.5 w-3.5" />
                      Published: {formatNoticeDate(notice.publishedAt || notice.createdAt)}
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      <User className="h-3.5 w-3.5" />
                      By: {notice.teacherName}
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      <Users className="h-3.5 w-3.5" />
                      {getTargetLabel(notice)}
                    </span>
                  </div>
                </CardDescription>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <Bell className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Description */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Notice Details</h3>
              <div className="p-4 bg-gray-50 rounded-lg whitespace-pre-wrap text-gray-700 leading-relaxed">
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
                  download={notice.attachmentName}
                  className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors group"
                >
                  <div className="p-2 bg-green-100 rounded-lg group-hover:bg-green-200">
                    <Download className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">
                      {notice.attachmentName || "Download Attachment"}
                    </p>
                    <p className="text-xs text-green-600">Click to download or view</p>
                  </div>
                  <ExternalLink className="h-5 w-5 text-green-600 flex-shrink-0" />
                </a>
              </div>
            )}

            {/* External Link */}
            {notice.externalLink && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">External Resource</h3>
                <a
                  href={notice.externalLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors group"
                >
                  <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200">
                    <Globe className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-purple-800 truncate">
                      {notice.externalLink}
                    </p>
                    <p className="text-xs text-purple-600">Click to open external link</p>
                  </div>
                  <ExternalLink className="h-5 w-5 text-purple-600 flex-shrink-0" />
                </a>
              </div>
            )}

            {/* Teacher Info */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <User className="h-4 w-4" />
                <span>Posted by <strong>{notice.teacherName}</strong></span>
                <span className="text-gray-300">|</span>
                <Calendar className="h-4 w-4" />
                <span>{formatNoticeDate(notice.createdAt)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
