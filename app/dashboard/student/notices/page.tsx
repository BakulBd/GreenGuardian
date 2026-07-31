"use client";

import { useState, useEffect, useCallback } from "react";
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
  getStudentNotices,
  getNoticesReadStatus,
  markNoticeRead,
  formatNoticeDate,
} from "@/lib/firebase/notices";
import { Notice } from "@/lib/types";
import {
  Search,
  FileText,
  Eye,
  Loader2,
  Bell,
  Calendar,
  Users,
  BookOpen,
  Paperclip,
  ExternalLink,
  Filter,
  RefreshCw,
  CheckCircle,
  Clock,
  Megaphone,
} from "lucide-react";
import Link from "next/link";

export default function StudentNoticesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [readStatus, setReadStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState<string>("all");

  useEffect(() => {
    if (user) {
      loadNotices();
    }
  }, [user]);

  const loadNotices = async () => {
    if (!user) return;
    try {
      const data = await getStudentNotices(user);
      setNotices(data);

      // Get read status for all notices
      const noticeIds = data.map((n) => n.id);
      if (noticeIds.length > 0) {
        const status = await getNoticesReadStatus(noticeIds, user.id);
        setReadStatus(status);
      }
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

  const handleViewNotice = async (noticeId: string) => {
    // Mark as read
    if (user && !readStatus[noticeId]) {
      try {
        await markNoticeRead(noticeId, user.id);
        setReadStatus((prev) => ({ ...prev, [noticeId]: true }));
      } catch (error) {
        console.error("Error marking notice as read:", error);
      }
    }
    router.push(`/dashboard/student/notices/${noticeId}`);
  };

  const getTargetLabel = (notice: Notice): string => {
    switch (notice.targetType) {
      case "all": return "All Students";
      case "course": return `Course: ${notice.targetCourseName || notice.targetCourseId}`;
      case "batch": return `Batch: ${notice.targetBatch}`;
      case "section": return `Section: ${notice.targetSection}`;
      case "semester": return `Semester: ${notice.targetBatch}`;
      case "individual": return "Direct Notice";
      default: return "Unknown";
    }
  };

  // Filter notices
  const filteredNotices = notices.filter((notice) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !notice.title.toLowerCase().includes(q) &&
        !notice.description.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (targetFilter !== "all" && notice.targetType !== targetFilter) {
      return false;
    }
    return true;
  });

  const unreadCount = notices.filter((n) => !readStatus[n.id]).length;
  const readCount = notices.filter((n) => readStatus[n.id]).length;

  if (loading) {
    return (
      <DashboardLayout role="student">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="student">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Notices</h1>
            <p className="text-gray-600 mt-1">
              View important notices and announcements from your teachers
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadNotices}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        {notices.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{notices.length}</p>
                <p className="text-xs text-gray-500">Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-2xl font-bold text-blue-600">{unreadCount}</p>
                <p className="text-xs text-gray-500">Unread</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-2xl font-bold text-green-600">{readCount}</p>
                <p className="text-xs text-gray-500">Read</p>
              </CardContent>
            </Card>
          </div>
        )}

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
              <Select value={targetFilter} onValueChange={setTargetFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="all_students">General</SelectItem>
                  <SelectItem value="course">Course</SelectItem>
                  <SelectItem value="batch">Batch</SelectItem>
                  <SelectItem value="section">Section</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Notices List */}
        {notices.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Megaphone className="mx-auto h-16 w-16 text-gray-300" />
                <h3 className="mt-4 text-lg font-semibold text-gray-600">No Notices Yet</h3>
                <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
                  There are no notices for you yet. Teachers will send notices here when they publish them.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : filteredNotices.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Search className="mx-auto h-16 w-16 text-gray-300" />
                <h3 className="mt-4 text-lg font-semibold text-gray-600">No Matching Notices</h3>
                <p className="mt-2 text-sm text-gray-500">Try adjusting your search or filter.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredNotices.map((notice) => {
              const isRead = readStatus[notice.id] || false;
              return (
                <Card
                  key={notice.id}
                  className={`hover:shadow-md transition-shadow cursor-pointer ${
                    !isRead ? "border-l-4 border-l-blue-500 bg-blue-50/30" : ""
                  }`}
                  onClick={() => handleViewNotice(notice.id)}
                >
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-full ${
                        !isRead ? "bg-blue-100" : "bg-gray-100"
                      }`}>
                        {!isRead ? (
                          <Bell className="h-5 w-5 text-blue-600" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-semibold truncate ${
                            !isRead ? "text-gray-900" : "text-gray-600"
                          }`}>
                            {notice.title}
                          </h3>
                          {!isRead && (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                              New
                            </Badge>
                          )}
                        </div>
                        <p className={`text-sm mt-1 line-clamp-2 ${
                          isRead ? "text-gray-500" : "text-gray-700"
                        }`}>
                          {notice.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatNoticeDate(notice.publishedAt || notice.createdAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {getTargetLabel(notice)}
                          </span>
                          {notice.attachmentUrl && (
                            <span className="flex items-center gap-1">
                              <Paperclip className="h-3.5 w-3.5" />
                              Attachment
                            </span>
                          )}
                          {notice.externalLink && (
                            <span className="flex items-center gap-1">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Link
                            </span>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="flex-shrink-0">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
