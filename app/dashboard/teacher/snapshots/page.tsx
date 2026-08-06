"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Trash2,
  Download,
  X,
  ImageOff,
  Loader2,
  RefreshCw,
  Camera,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  User as UserIcon,
  FileText,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWarningScreenshotsByTeacher,
  deleteWarningScreenshot,
  WarningScreenshot,
} from "@/lib/services/proctoring";

const formatWarningType = (type: string) =>
  (type || "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatTimestamp = (value: any): string => {
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "Unknown";
  return d.toLocaleString();
};

interface ExamGroup {
  examId: string;
  examTitle: string;
  shots: WarningScreenshot[];
}

interface StudentGroup {
  studentId: string;
  studentName: string;
  exams: ExamGroup[];
  total: number;
}

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // CORS or network hiccup — fall back to opening it so the user can save manually.
    window.open(url, "_blank");
  }
}

export default function TeacherSnapshotsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [screenshots, setScreenshots] = useState<WarningScreenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());
  const [expandedExams, setExpandedExams] = useState<Set<string>>(new Set());
  const [previewShot, setPreviewShot] = useState<WarningScreenshot | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WarningScreenshot | null>(null);

  useEffect(() => {
    if (user) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getWarningScreenshotsByTeacher(user.id);
      setScreenshots(data);
    } catch (error) {
      console.error("Error loading snapshots:", error);
      toast({ title: "Error", description: "Failed to load snapshots", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Student -> Exam -> Snapshots hierarchy (Feature 3)
  const studentGroups = useMemo<StudentGroup[]>(() => {
    const byStudent = new Map<string, Map<string, ExamGroup>>();
    for (const shot of screenshots) {
      const studentKey = shot.studentId;
      if (!byStudent.has(studentKey)) byStudent.set(studentKey, new Map());
      const examMap = byStudent.get(studentKey)!;
      if (!examMap.has(shot.examId)) {
        examMap.set(shot.examId, { examId: shot.examId, examTitle: shot.examTitle || "Untitled Exam", shots: [] });
      }
      examMap.get(shot.examId)!.shots.push(shot);
    }

    const groups: StudentGroup[] = [];
    for (const [studentId, examMap] of byStudent.entries()) {
      const exams = Array.from(examMap.values()).map((g) => ({
        ...g,
        shots: g.shots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      }));
      exams.sort((a, b) => a.examTitle.localeCompare(b.examTitle));
      const anyShot = exams[0]?.shots[0];
      groups.push({
        studentId,
        studentName: anyShot?.studentName || "Unknown Student",
        exams,
        total: exams.reduce((sum, e) => sum + e.shots.length, 0),
      });
    }
    groups.sort((a, b) => a.studentName.localeCompare(b.studentName));
    return groups;
  }, [screenshots]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return studentGroups;
    const q = searchQuery.trim().toLowerCase();
    return studentGroups.filter((g) => g.studentName.toLowerCase().includes(q));
  }, [studentGroups, searchQuery]);

  const toggleStudent = (studentId: string) => {
    setExpandedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleExam = (key: string) => {
    setExpandedExams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (screenshot: WarningScreenshot) => {
    if (!screenshot.id) return;
    setDeletingId(screenshot.id);
    try {
      await deleteWarningScreenshot(screenshot);
      setScreenshots((prev) => prev.filter((s) => s.id !== screenshot.id));
      toast({ title: "Snapshot Deleted", description: "The snapshot has been permanently removed." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete snapshot", variant: "destructive" });
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  };

  const totalSnapshots = screenshots.length;

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Snapshots</h1>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">
              Permanent webcam captures, organized by student and exam — {totalSnapshots} total
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Search by student name..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600 mx-auto" />
          </div>
        ) : screenshots.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16 text-gray-500">
              <ImageOff className="mx-auto h-16 w-16 text-gray-300 mb-3" />
              <h3 className="text-lg font-medium text-gray-600">No Snapshots Yet</h3>
              <p className="mt-1 text-sm">A snapshot is captured automatically whenever a student receives a proctoring warning during an exam.</p>
            </CardContent>
          </Card>
        ) : filteredGroups.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16 text-gray-500">
              <Search className="mx-auto h-12 w-12 text-gray-300 mb-3" />
              <p>No students match your search.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map((group) => {
              const isStudentOpen = expandedStudents.has(group.studentId);
              return (
                <Card key={group.studentId} className="overflow-hidden">
                  <button
                    onClick={() => toggleStudent(group.studentId)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      {isStudentOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                        {group.studentName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 flex items-center gap-1">
                          <UserIcon className="h-3.5 w-3.5 text-gray-400" /> {group.studentName}
                        </p>
                        <p className="text-xs text-gray-500">{group.exams.length} exam{group.exams.length !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <Badge variant="secondary">{group.total} snapshot{group.total !== 1 ? "s" : ""}</Badge>
                  </button>

                  {isStudentOpen && (
                    <CardContent className="pt-0 pb-4 space-y-2 border-t">
                      {group.exams.map((exam) => {
                        const examKey = `${group.studentId}_${exam.examId}`;
                        const isExamOpen = expandedExams.has(examKey);
                        return (
                          <div key={exam.examId} className="ml-4 border rounded-lg overflow-hidden">
                            <button
                              onClick={() => toggleExam(examKey)}
                              className="w-full flex items-center justify-between p-3 bg-gray-50/60 hover:bg-gray-100 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2">
                                {isExamOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                                <FileText className="h-3.5 w-3.5 text-gray-500" />
                                <span className="text-sm font-medium text-gray-800">{exam.examTitle}</span>
                              </div>
                              <Badge variant="outline">{exam.shots.length}</Badge>
                            </button>

                            {isExamOpen && (
                              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 bg-white">
                                {exam.shots.map((shot) => (
                                  <div key={shot.id} className="group relative rounded-lg overflow-hidden border bg-gray-50">
                                    <button type="button" onClick={() => setPreviewShot(shot)} className="block w-full aspect-video bg-black">
                                      {shot.screenshotUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={shot.screenshotUrl} alt={`Snapshot of ${shot.studentName}`} className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500">
                                          <ImageOff className="h-6 w-6" />
                                        </div>
                                      )}
                                    </button>
                                    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={() => downloadImage(shot.screenshotUrl, `${shot.studentName}_${shot.examTitle}_${shot.id}.jpg`)}
                                        className="p-1.5 rounded-full bg-black/60 text-white hover:bg-emerald-600"
                                        title="Download"
                                      >
                                        <Download className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPendingDelete(shot)}
                                        className="p-1.5 rounded-full bg-black/60 text-white hover:bg-red-600"
                                        title="Delete"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                    <div className="p-1.5">
                                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200 w-full justify-center truncate">
                                        {formatWarningType(shot.warningType)}
                                      </Badge>
                                      <p className="text-[10px] text-gray-400 text-center mt-1">{formatTimestamp(shot.timestamp)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Dialog */}
      {previewShot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewShot(null)}>
          <Card className="w-full max-w-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div>
                <CardTitle className="text-lg">{previewShot.studentName}</CardTitle>
                <CardDescription>{previewShot.examTitle}</CardDescription>
              </div>
              <button onClick={() => setPreviewShot(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {previewShot.screenshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewShot.screenshotUrl} alt={`Snapshot of ${previewShot.studentName}`} className="w-full rounded-lg border" />
              ) : (
                <div className="aspect-video flex items-center justify-center bg-gray-100 rounded-lg text-gray-400">
                  <ImageOff className="h-10 w-10" />
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Badge className="bg-amber-100 text-amber-800 border-amber-200" variant="outline">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {formatWarningType(previewShot.warningType)}
                </Badge>
                <span className="flex items-center gap-1 text-gray-500 text-xs">
                  <Calendar className="h-3 w-3" />
                  {formatTimestamp(previewShot.timestamp)}
                </span>
              </div>
              {previewShot.warningMessage && <p className="text-sm text-gray-700">{previewShot.warningMessage}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => downloadImage(previewShot.screenshotUrl, `${previewShot.studentName}_${previewShot.examTitle}_${previewShot.id}.jpg`)}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setPendingDelete(previewShot);
                    setPreviewShot(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPendingDelete(null)}>
          <Card className="w-full max-w-sm bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base">Delete this snapshot?</CardTitle>
              <CardDescription>This permanently removes the image for {pendingDelete.studentName}. This cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={!!deletingId}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => handleDelete(pendingDelete)} disabled={!!deletingId}>
                {deletingId ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Delete
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
