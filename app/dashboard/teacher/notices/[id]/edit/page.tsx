"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getNotice, updateNotice, getTargetedStudentIds, publishNoticeWithNotifications, notifyNoticePublished } from "@/lib/firebase/notices";
import { subscribeToAssignedCatalog, AssignedCatalogEntry } from "@/lib/firebase/assignments";
import { uploadFile } from "@/lib/storage/client";
import { Notice, NoticeTargetType } from "@/lib/types";
import {
  Loader2,
  ArrowLeft,
  Save,
  Send,
  Paperclip,
  Globe,
  X,
  FileText,
  Users,
  BookOpen,
} from "lucide-react";
import Link from "next/link";

export default function EditNoticePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const noticeId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetType, setTargetType] = useState<NoticeTargetType>("all");
  const [targetCourseId, setTargetCourseId] = useState("");
  const [targetCourseName, setTargetCourseName] = useState("");
  const [targetBatch, setTargetBatch] = useState("");
  const [targetSection, setTargetSection] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentType, setAttachmentType] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [assignedCatalog, setAssignedCatalog] = useState<AssignedCatalogEntry[]>([]);

  useEffect(() => {
    if (noticeId && user) {
      loadNotice();
    }
  }, [noticeId, user]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToAssignedCatalog(user.id, setAssignedCatalog);
    return () => unsubscribe();
  }, [user]);

  const assignedBatchNames = useMemo(() => {
    const names = new Set<string>();
    assignedCatalog.forEach((c) => c.batches.forEach((b) => names.add(b.batchName)));
    return Array.from(names).sort();
  }, [assignedCatalog]);

  const assignedSectionNames = useMemo(() => {
    const names = new Set<string>();
    assignedCatalog.forEach((c) => c.batches.forEach((b) => b.sections.forEach((s) => names.add(s.sectionName))));
    return Array.from(names).sort();
  }, [assignedCatalog]);

  const loadNotice = async () => {
    try {
      const data = await getNotice(noticeId);
      if (!data) {
        toast({ title: "Not Found", description: "Notice not found.", variant: "destructive" });
        router.push("/dashboard/teacher/notices");
        return;
      }
      if (user && data.teacherId !== user.id) {
        toast({ title: "Access Denied", description: "You don't have permission to edit this notice.", variant: "destructive" });
        router.push("/dashboard/teacher/notices");
        return;
      }
      // Populate form
      setTitle(data.title);
      setDescription(data.description);
      setTargetType(data.targetType);
      setTargetCourseId(data.targetCourseId || "");
      setTargetCourseName(data.targetCourseName || "");
      setTargetBatch(data.targetBatch || "");
      setTargetSection(data.targetSection || "");
      setExternalLink(data.externalLink || "");
      setAttachmentUrl(data.attachmentUrl || "");
      setAttachmentName(data.attachmentName || "");
      setAttachmentType(data.attachmentType || "");
      setStatus(data.status);
    } catch (error) {
      console.error("Error loading notice:", error);
      toast({ title: "Error", description: "Failed to load notice.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setNewFile(file);
    setFileUploading(true);

    try {
      const basePath = `notices/${user?.id}/${Date.now()}`;
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path = `${basePath}/${sanitizedName}`;
      const result = await uploadFile(file, path);
      setAttachmentUrl(result.url);
      setAttachmentName(result.name);
      setAttachmentType(result.type);
      toast({ title: "File Uploaded", description: "Attachment uploaded successfully." });
    } catch (error) {
      console.error("Error uploading file:", error);
      toast({ title: "Upload Failed", description: "Failed to upload attachment.", variant: "destructive" });
    } finally {
      setFileUploading(false);
    }
  };

  const removeAttachment = () => {
    setAttachmentUrl("");
    setAttachmentName("");
    setAttachmentType("");
    setNewFile(null);
  };

  const handleCourseChange = (courseId: string) => {
    setTargetCourseId(courseId);
    const course = assignedCatalog.find((c) => c.courseId === courseId);
    setTargetCourseName(course?.courseName || "");
  };

  const handleSave = async (newStatus?: "draft" | "published") => {
    if (!user || !noticeId) return;
    if (!title.trim() || !description.trim()) {
      toast({ title: "Validation Error", description: "Title and description are required.", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const updateData: Partial<Notice> = {
        title: title.trim(),
        description: description.trim(),
        targetType,
        targetCourseId: targetType === "course" ? targetCourseId : undefined,
        targetCourseName: targetType === "course" ? targetCourseName : undefined,
        targetBatch: targetType === "batch" || targetType === "section" || targetType === "semester" ? targetBatch : undefined,
        targetSection: targetType === "section" ? targetSection : undefined,
        targetSemester: targetType === "semester" ? targetBatch : undefined,
        externalLink: externalLink.trim() || undefined,
        attachmentUrl: attachmentUrl || undefined,
        attachmentName: attachmentName || undefined,
        attachmentType: attachmentType || undefined,
      };

      if (newStatus) {
        updateData.status = newStatus;
      }

      await updateNotice(noticeId, updateData);

if (newStatus === "published") {
        const fullNotice = { ...updateData, id: noticeId } as Notice;
        const targetedStudentIds = await getTargetedStudentIds(fullNotice);
        if (targetedStudentIds.length > 0) {
          const result = await publishNoticeWithNotifications(noticeId, targetedStudentIds);
          notifyNoticePublished(noticeId, targetedStudentIds).catch((err) =>
            console.warn("[EditNotice] Failed to send publish emails:", err)
          );
          toast({ title: "✅ Notice Published", description: `Notice sent to ${result.notificationCount} student(s) successfully.` });
        } else {
          await publishNoticeWithNotifications(noticeId, []);
          toast({ title: "✅ Notice Published", description: "Notice published, but no targeted students found." });
        }
      } else {
        toast({ title: "✅ Notice Updated", description: "Your notice has been updated." });
      }

      router.push("/dashboard/teacher/notices");
    } catch (error: any) {
      console.error("Error updating notice:", error);
      const errorMessage = error?.message || "Failed to update notice.";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    } finally {
      setSaving(false);
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

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard/teacher/notices">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Edit Notice</h1>
            <p className="text-gray-600 mt-1">Update your notice details</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notice Details</CardTitle>
                <CardDescription>Edit the title and description</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description <span className="text-red-500">*</span></Label>
                  <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Additional Content</CardTitle>
                <CardDescription>Attachment and external link</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Attachment (PDF, Image, or File)</Label>
                  {attachmentUrl ? (
                    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <Paperclip className="h-4 w-4 text-green-600" />
                      <span className="flex-1 text-sm text-green-700 truncate">{attachmentName}</span>
                      <Button variant="ghost" size="sm" onClick={removeAttachment} className="text-red-600">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={handleFileChange} disabled={fileUploading} />
                      {fileUploading && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="externalLink">External Link (Optional)</Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input id="externalLink" className="pl-9" value={externalLink} onChange={(e) => setExternalLink(e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Target Audience</CardTitle>
                <CardDescription>Who should receive this notice</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Send To</Label>
                  <Select value={targetType} onValueChange={(v: NoticeTargetType) => setTargetType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Students</SelectItem>
                      <SelectItem value="course">Specific Course</SelectItem>
                      <SelectItem value="batch">Specific Batch</SelectItem>
                      <SelectItem value="section">Specific Section</SelectItem>
                      <SelectItem value="semester">Specific Semester</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {targetType === "course" && (
                  <div className="space-y-2">
                    <Label>Select Course</Label>
                    <Select value={targetCourseId} onValueChange={handleCourseChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a course..." />
                      </SelectTrigger>
                      <SelectContent>
                        {assignedCatalog.map((course) => (
                          <SelectItem key={course.courseId} value={course.courseId}>{course.courseCode ? `${course.courseCode} - ` : ""}{course.courseName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(targetType === "batch" || targetType === "section" || targetType === "semester") && (
                  <div className="space-y-2">
                    <Label>Select Batch</Label>
                    <Select value={targetBatch} onValueChange={setTargetBatch}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a batch..." />
                      </SelectTrigger>
                      <SelectContent>
                        {assignedBatchNames.map((name) => (
                          <SelectItem key={name} value={name}>Batch {name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {targetType === "section" && (
                  <div className="space-y-2">
                    <Label>Select Section</Label>
                    <Select value={targetSection} onValueChange={setTargetSection}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a section..." />
                      </SelectTrigger>
                      <SelectContent>
                        {assignedSectionNames.map((name) => (
                          <SelectItem key={name} value={name}>Section {name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {status === "draft" && (
                  <Button className="w-full" onClick={() => handleSave("published")} disabled={saving || !title || !description}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Publish & Update
                  </Button>
                )}
                <Button variant="outline" className="w-full" onClick={() => handleSave()} disabled={saving || !title || !description}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
