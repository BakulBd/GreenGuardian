"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { createNotice, getTargetedStudentIds, publishNotice } from "@/lib/firebase/notices";
import { uploadFile } from "@/lib/firebase/storage";
import { Notice, NoticeTargetType } from "@/lib/types";
import {
  Loader2,
  ArrowLeft,
  Save,
  Send,
  Paperclip,
  Link as LinkIcon,
  X,
  FileText,
  Globe,
  Users,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import {
  DEFAULT_COURSES,
  DEFAULT_BATCHES,
  DEFAULT_SECTIONS,
} from "@/lib/academics/catalog";

export default function CreateNoticePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetType, setTargetType] = useState<NoticeTargetType>("all");
  const [targetCourseId, setTargetCourseId] = useState("");
  const [targetCourseName, setTargetCourseName] = useState("");
  const [targetBatch, setTargetBatch] = useState("");
  const [targetSection, setTargetSection] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentType, setAttachmentType] = useState("");
  const [saving, setSaving] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAttachment(file);
    setAttachmentUploading(true);

    try {
      const basePath = `notices/${user?.id}/${Date.now()}`;
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path = `${basePath}/${sanitizedName}`;

      const result = await uploadFile(file, path);
      setAttachmentUrl(result.url);
      setAttachmentName(result.name);
      setAttachmentType(result.type);
      toast({
        title: "File Uploaded",
        description: "Attachment uploaded successfully.",
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload attachment. Please try again.",
        variant: "destructive",
      });
      setAttachment(null);
    } finally {
      setAttachmentUploading(false);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachmentUrl("");
    setAttachmentName("");
    setAttachmentType("");
  };

  const handleCourseChange = (courseId: string) => {
    setTargetCourseId(courseId);
    const course = DEFAULT_COURSES.find((c) => c.id === courseId);
    setTargetCourseName(course?.name || "");
  };

  const handleSave = async (status: "draft" | "published") => {
    if (!user) return;
    if (!title.trim()) {
      toast({
        title: "Validation Error",
        description: "Title is required.",
        variant: "destructive",
      });
      return;
    }
    if (!description.trim()) {
      toast({
        title: "Validation Error",
        description: "Description is required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      const noticeData: Omit<Notice, "id" | "createdAt" | "updatedAt"> = {
        title: title.trim(),
        description: description.trim(),
        teacherId: user.id,
        teacherName: user.name,
        status,
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

      const noticeId = await createNotice(noticeData);

      if (status === "published") {
        // Get targeted students and send notifications
        const fullNotice = { ...noticeData, id: noticeId } as Notice;
        const targetedStudentIds = await getTargetedStudentIds(fullNotice);
        await publishNotice(noticeId, targetedStudentIds);

        toast({
          title: "Notice Published",
          description: `Notice sent to ${targetedStudentIds.length} student(s).`,
        });
      } else {
        toast({
          title: "Notice Saved",
          description: "Your notice has been saved as a draft.",
        });
      }

      router.push("/dashboard/teacher/notices");
    } catch (error) {
      console.error("Error saving notice:", error);
      toast({
        title: "Error",
        description: "Failed to save notice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

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
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Create Notice
            </h1>
            <p className="text-gray-600 mt-1">
              Create a new notice to send to your students
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notice Details</CardTitle>
                <CardDescription>
                  Enter the title and description of your notice
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">
                    Title <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="title"
                    placeholder="Enter notice title..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Enter notice description..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Attachment & External Link */}
            <Card>
              <CardHeader>
                <CardTitle>Additional Content</CardTitle>
                <CardDescription>
                  Add an optional attachment or external link
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Attachment */}
                <div className="space-y-2">
                  <Label>Attachment (PDF, Image, or File)</Label>
                  {attachmentUrl ? (
                    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <Paperclip className="h-4 w-4 text-green-600" />
                      <span className="flex-1 text-sm text-green-700 truncate">
                        {attachmentName}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={removeAttachment}
                        className="text-red-600 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Input
                        type="file"
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                        onChange={handleFileChange}
                        disabled={attachmentUploading}
                      />
                      {attachmentUploading && (
                        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    Accepted: PDF, Word, JPG, PNG (max 10MB)
                  </p>
                </div>

                {/* External Link */}
                <div className="space-y-2">
                  <Label htmlFor="externalLink">External Link (Optional)</Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="externalLink"
                      placeholder="https://example.com/resource"
                      className="pl-9"
                      value={externalLink}
                      onChange={(e) => setExternalLink(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Targeting */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Target Audience</CardTitle>
                <CardDescription>
                  Choose who should receive this notice
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="targetType">
                    Send To <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={targetType}
                    onValueChange={(v: NoticeTargetType) => setTargetType(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select target..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          All Students
                        </span>
                      </SelectItem>
                      <SelectItem value="course">
                        <span className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4" />
                          Specific Course
                        </span>
                      </SelectItem>
                      <SelectItem value="batch">
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Specific Batch
                        </span>
                      </SelectItem>
                      <SelectItem value="section">
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Specific Section
                        </span>
                      </SelectItem>
                      <SelectItem value="semester">
                        <span className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4" />
                          Specific Semester
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Course selector */}
                {targetType === "course" && (
                  <div className="space-y-2">
                    <Label htmlFor="course">Select Course</Label>
                    <Select value={targetCourseId} onValueChange={handleCourseChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a course..." />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_COURSES.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.code} - {course.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Batch selector */}
                {(targetType === "batch" || targetType === "section" || targetType === "semester") && (
                  <div className="space-y-2">
                    <Label htmlFor="batch">Select Batch</Label>
                    <Select value={targetBatch} onValueChange={setTargetBatch}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a batch..." />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_BATCHES.map((batch) => (
                          <SelectItem key={batch.id} value={batch.name}>
                            Batch {batch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Section selector */}
                {targetType === "section" && (
                  <div className="space-y-2">
                    <Label htmlFor="section">Select Section</Label>
                    <Select value={targetSection} onValueChange={setTargetSection}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a section..." />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_SECTIONS.map((section) => (
                          <SelectItem key={section.id} value={section.name}>
                            Section {section.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Target info */}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-blue-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-blue-800">
                        {targetType === "all" && "Notice will be sent to all students"}
                        {targetType === "course" && "Notice will be sent to students enrolled in the selected course"}
                        {targetType === "batch" && "Notice will be sent to all students in the selected batch"}
                        {targetType === "section" && "Notice will be sent to all students in the selected section"}
                        {targetType === "semester" && "Notice will be sent to all students in the selected semester"}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => handleSave("published")}
                  disabled={saving || !title || !description}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Publish Notice
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSave("draft")}
                  disabled={saving || !title || !description}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save as Draft
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
