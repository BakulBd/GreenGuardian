"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  FileText,
  ClipboardList,
  BookOpen,
  Link as LinkIcon,
  Loader2,
  Trash2,
  Edit,
  Clock,
  Award,
  Send,
  X,
  Paperclip,
  Download,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import FileUpload from "@/components/FileUpload";
import {
  createClasswork,
  updateClasswork,
  deleteClasswork,
  publishClasswork,
  subscribeToClasswork,
  notifyClassroom,
} from "@/lib/firebase/classrooms";
import { CLASSROOM_MATERIAL_ALLOWED_TYPES, CLASSROOM_MAX_FILE_SIZE, UploadResult } from "@/lib/firebase/storage";
import { Classroom, ClassworkItem, ClassworkType, ClassroomAttachment, User } from "@/lib/types";

interface ClassworkTabProps {
  classroom: Classroom;
  isTeacher: boolean;
  currentUser: User;
}

const TYPE_META: Record<ClassworkType, { label: string; icon: any; color: string }> = {
  assignment: { label: "Assignment", icon: ClipboardList, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  quiz: { label: "Quiz", icon: Award, color: "bg-purple-100 text-purple-700 border-purple-200" },
  material: { label: "Study Material", icon: BookOpen, color: "bg-blue-100 text-blue-700 border-blue-200" },
  resource: { label: "Resource", icon: FileText, color: "bg-slate-100 text-slate-700 border-slate-200" },
  link: { label: "External Link", icon: LinkIcon, color: "bg-amber-100 text-amber-700 border-amber-200" },
};

function formatDate(value: any): string {
  if (!value) return "";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ClassworkTab({ classroom, isTeacher, currentUser }: ClassworkTabProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<ClassworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    type: "assignment" as ClassworkType,
    title: "",
    instructions: "",
    dueDate: "",
    totalMarks: "",
    externalLink: "",
  });
  const [attachments, setAttachments] = useState<UploadResult[]>([]);

  useEffect(() => {
    // Students may only read published classwork (firestore.rules); querying
    // without that filter is denied for the whole list, so it must be part of
    // the query rather than a post-hoc client filter.
    const unsub = subscribeToClasswork(
      classroom.id,
      (data) => {
        setItems(data);
        setLoading(false);
      },
      { publishedOnly: !isTeacher }
    );
    return () => unsub();
  }, [classroom.id, isTeacher]);

  const resetForm = () => {
    setForm({ type: "assignment", title: "", instructions: "", dueDate: "", totalMarks: "", externalLink: "" });
    setAttachments([]);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (item: ClassworkItem) => {
    setEditingId(item.id);
    setForm({
      type: item.type,
      title: item.title,
      instructions: item.instructions || "",
      dueDate: item.dueDate ? new Date((item.dueDate as any).toDate ? (item.dueDate as any).toDate() : item.dueDate).toISOString().slice(0, 16) : "",
      totalMarks: item.totalMarks !== undefined ? String(item.totalMarks) : "",
      externalLink: item.externalLink || "",
    });
    setAttachments([]);
    setShowForm(true);
  };

  const handleSave = async (status: "draft" | "published") => {
    if (!form.title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const finalAttachments: ClassroomAttachment[] = attachments.map((a) => ({ name: a.name, url: a.url, type: a.type, size: a.size }));
      const payload = {
        classroomId: classroom.id,
        teacherId: currentUser.id,
        teacherName: currentUser.name,
        type: form.type,
        title: form.title.trim(),
        instructions: form.instructions.trim(),
        attachments: editingId ? undefined : finalAttachments,
        externalLink: form.externalLink.trim() || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate) : null,
        totalMarks: form.totalMarks ? Number(form.totalMarks) : undefined,
        status,
      };

      if (editingId) {
        await updateClasswork(editingId, payload);
        toast({ title: "Classwork Updated" });
      } else {
        const id = await createClasswork(payload);
        toast({ title: status === "published" ? "Classwork Published" : "Saved as Draft" });
        if (status === "published") {
          notifyClassroom({ classroomId: classroom.id, classworkId: id, kind: "classwork" });
        }
      }
      resetForm();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save classwork", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: ClassworkItem) => {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await deleteClasswork(item.id);
      toast({ title: "Deleted" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete", variant: "destructive" });
    }
  };

  const handlePublishDraft = async (item: ClassworkItem) => {
    try {
      await publishClasswork(item.id);
      toast({ title: "Published" });
      notifyClassroom({ classroomId: classroom.id, classworkId: item.id, kind: "classwork" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to publish", variant: "destructive" });
    }
  };

  const visibleItems = isTeacher ? items : items.filter((i) => i.status === "published");

  return (
    <div className="space-y-4">
      {isTeacher && (
        <div className="flex justify-end">
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>
      )}

      {isTeacher && showForm && (
        <Card className="border-2 border-green-200">
          <CardContent className="pt-6 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(TYPE_META) as ClassworkType[]).map((t) => {
                const meta = TYPE_META[t];
                const Icon = meta.icon;
                return (
                  <Button key={t} type="button" size="sm" variant={form.type === t ? "default" : "outline"} onClick={() => setForm({ ...form, type: t })} disabled={!!editingId}>
                    <Icon className="h-3.5 w-3.5 mr-1" />
                    {meta.label}
                  </Button>
                );
              })}
            </div>
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Chapter 3 Homework" />
            </div>
            <div className="space-y-2">
              <Label>Instructions</Label>
              <Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Total Marks</Label>
                <Input type="number" min="0" value={form.totalMarks} onChange={(e) => setForm({ ...form, totalMarks: e.target.value })} />
              </div>
            </div>
            {form.type === "link" && (
              <div className="space-y-2">
                <Label>External Link</Label>
                <Input value={form.externalLink} onChange={(e) => setForm({ ...form, externalLink: e.target.value })} placeholder="https://..." />
              </div>
            )}
            {!editingId && (
              <FileUpload
                basePath={`classrooms/${classroom.id}/classwork`}
                onUploadComplete={setAttachments}
                maxFiles={10}
                allowedTypes={CLASSROOM_MATERIAL_ALLOWED_TYPES}
                maxSize={CLASSROOM_MAX_FILE_SIZE}
                accept=".pdf,.doc,.docx,.ppt,.pptx,.zip,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov"
              />
            )}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
              {!editingId && (
                <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving}>
                  Save Draft
                </Button>
              )}
              <Button onClick={() => handleSave(editingId ? (items.find((i) => i.id === editingId)?.status || "published") : "published")} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                {editingId ? "Save Changes" : "Publish"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-green-600 mx-auto" />
        </div>
      ) : visibleItems.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <ClipboardList className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p>No classwork yet.</p>
          </CardContent>
        </Card>
      ) : (
        visibleItems.map((item) => {
          const meta = TYPE_META[item.type] || TYPE_META.material;
          const Icon = meta.icon;
          return (
            <Card key={item.id}>
              <CardContent className="pt-6 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={meta.color}>
                      <Icon className="h-3 w-3 mr-1" />
                      {meta.label}
                    </Badge>
                    {item.status === "draft" && (
                      <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">
                        Draft
                      </Badge>
                    )}
                    {item.totalMarks !== undefined && (
                      <Badge variant="outline" className="bg-gray-50">
                        {item.totalMarks} marks
                      </Badge>
                    )}
                  </div>
                  {isTeacher && (
                    <div className="flex gap-1">
                      {item.status === "draft" && (
                        <Button size="sm" variant="outline" onClick={() => handlePublishDraft(item)}>
                          Publish
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => startEdit(item)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(item)} className="text-red-600 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                {item.instructions && <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.instructions}</p>}
                {item.dueDate && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Due {formatDate(item.dueDate)}
                  </p>
                )}
                {item.externalLink && (
                  <a href={item.externalLink} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                    <LinkIcon className="h-3.5 w-3.5" /> {item.externalLink}
                  </a>
                )}
                {item.attachments && item.attachments.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2 pt-1">
                    {item.attachments.map((att, idx) => (
                      <a
                        key={idx}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 rounded-lg border bg-gray-50 hover:bg-gray-100 transition-colors text-sm"
                      >
                        <Paperclip className="h-4 w-4 text-gray-500 flex-shrink-0" />
                        <span className="truncate flex-1 text-gray-800">{att.name}</span>
                        <Download className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
