"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, UserMinus, UserPlus, Copy, Check, Users, Mail, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  subscribeToClassroomMembers,
  removeClassroomMember,
  addStudentToClassroom,
  addStudentsToClassroomByGroup,
} from "@/lib/firebase/classrooms";
import { subscribeToAssignedCatalog, AssignedCatalogEntry } from "@/lib/firebase/assignments";
import { getUsersByRole } from "@/lib/firebase/firestore";
import { Classroom, ClassroomMember, User } from "@/lib/types";

interface PeopleTabProps {
  classroom: Classroom;
  isTeacher: boolean;
  currentUser: User;
}

function formatDate(value: any): string {
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PeopleTab({ classroom, isTeacher }: PeopleTabProps) {
  const { toast } = useToast();
  const [members, setMembers] = useState<ClassroomMember[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [allStudents, setAllStudents] = useState<User[]>([]);
  const [addSearch, setAddSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const [assignedCatalog, setAssignedCatalog] = useState<AssignedCatalogEntry[]>([]);
  const [bulkCourseId, setBulkCourseId] = useState("");
  const [bulkBatchId, setBulkBatchId] = useState("");
  const [bulkSectionId, setBulkSectionId] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);

  useEffect(() => {
    const unsub = subscribeToClassroomMembers(classroom.id, setMembers);
    return () => unsub();
  }, [classroom.id]);

  useEffect(() => {
    if (!isTeacher) return;
    const unsub = subscribeToAssignedCatalog(classroom.teacherId, setAssignedCatalog);
    return () => unsub();
  }, [isTeacher, classroom.teacherId]);

  useEffect(() => {
    if (!showAddPanel || allStudents.length > 0) return;
    getUsersByRole("student").then(setAllStudents).catch(() => setAllStudents([]));
  }, [showAddPanel, allStudents.length]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.trim().toLowerCase();
    return members.filter(
      (m) => m.studentName?.toLowerCase().includes(q) || m.studentEmail?.toLowerCase().includes(q) || m.studentCode?.toLowerCase().includes(q)
    );
  }, [members, searchQuery]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.studentId)), [members]);

  const addCandidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return allStudents
      .filter((s) => !memberIds.has(s.id))
      .filter((s) => !q || s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q))
      .slice(0, 20);
  }, [allStudents, memberIds, addSearch]);

  const bulkCourse = assignedCatalog.find((c) => c.courseId === bulkCourseId);
  const bulkBatch = bulkCourse?.batches.find((b) => b.batchId === bulkBatchId);

  const handleRemove = async (member: ClassroomMember) => {
    if (!confirm(`Remove ${member.studentName} from this classroom?`)) return;
    try {
      await removeClassroomMember(classroom.id, member.studentId);
      toast({ title: "Student Removed" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove student", variant: "destructive" });
    }
  };

  const handleAddStudent = async (student: User) => {
    setAddingId(student.id);
    try {
      await addStudentToClassroom({ id: classroom.id, teacherId: classroom.teacherId }, student);
      toast({ title: "Student Added", description: `${student.name} was added to the classroom.` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add student", variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  const handleBulkAdd = async () => {
    if (!bulkCourse || !bulkBatch || !bulkSectionId) return;
    const section = bulkBatch.sections.find((s) => s.sectionId === bulkSectionId);
    if (!section) return;
    setBulkAdding(true);
    try {
      const result = await addStudentsToClassroomByGroup(
        { id: classroom.id, teacherId: classroom.teacherId },
        bulkCourse.courseId,
        bulkBatch.batchName,
        section.sectionName
      );
      toast({
        title: "Students Added",
        description: `Enrolled ${result.added} student${result.added === 1 ? "" : "s"} from ${bulkCourse.courseName} / Batch ${bulkBatch.batchName} / Section ${section.sectionName}.`,
      });
      setBulkCourseId("");
      setBulkBatchId("");
      setBulkSectionId("");
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add students", variant: "destructive" });
    } finally {
      setBulkAdding(false);
    }
  };

  const copyInvite = async () => {
    const link = `${window.location.origin}/classroom/join?code=${classroom.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast({ title: "Invite Link Copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy Failed", description: link, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {isTeacher && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Invite students</p>
                <p className="text-xs text-gray-500">Anyone with the code or link can join — or add students directly below.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyInvite}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  Copy Invite Link
                </Button>
                <Button size="sm" onClick={() => setShowAddPanel((v) => !v)}>
                  <UserPlus className="h-4 w-4 mr-1" />
                  Add Students
                </Button>
              </div>
            </div>

            {showAddPanel && (
              <div className="space-y-4 border-t pt-4">
                {/* Manual add by search */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Add individually</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input placeholder="Search students by name or email..." className="pl-9" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
                  </div>
                  {addSearch.trim() && (
                    <div className="max-h-48 overflow-y-auto divide-y border rounded-md">
                      {addCandidates.length === 0 ? (
                        <p className="text-xs text-gray-500 p-3">No matching students found.</p>
                      ) : (
                        addCandidates.map((s) => (
                          <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{s.name}</p>
                              <p className="text-xs text-gray-500 truncate">{s.email}</p>
                            </div>
                            <Button size="sm" variant="outline" disabled={addingId === s.id} onClick={() => handleAddStudent(s)}>
                              {addingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Bulk add by Course/Batch/Section */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Bulk-add by Course/Batch/Section</p>
                  {assignedCatalog.length === 0 ? (
                    <p className="text-xs text-amber-700">You have no Course/Batch/Section assignments yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <select
                        className="h-9 px-2 border rounded text-xs bg-white"
                        value={bulkCourseId}
                        onChange={(e) => { setBulkCourseId(e.target.value); setBulkBatchId(""); setBulkSectionId(""); }}
                      >
                        <option value="">Course</option>
                        {assignedCatalog.map((c) => (
                          <option key={c.courseId} value={c.courseId}>{c.courseName}</option>
                        ))}
                      </select>
                      <select
                        className="h-9 px-2 border rounded text-xs bg-white"
                        value={bulkBatchId}
                        disabled={!bulkCourse}
                        onChange={(e) => { setBulkBatchId(e.target.value); setBulkSectionId(""); }}
                      >
                        <option value="">Batch</option>
                        {bulkCourse?.batches.map((b) => (
                          <option key={b.batchId} value={b.batchId}>Batch {b.batchName}</option>
                        ))}
                      </select>
                      <select
                        className="h-9 px-2 border rounded text-xs bg-white"
                        value={bulkSectionId}
                        disabled={!bulkBatch}
                        onChange={(e) => setBulkSectionId(e.target.value)}
                      >
                        <option value="">Section</option>
                        {bulkBatch?.sections.map((s) => (
                          <option key={s.sectionId} value={s.sectionId}>Section {s.sectionName}</option>
                        ))}
                      </select>
                      <Button size="sm" disabled={!bulkSectionId || bulkAdding} onClick={handleBulkAdd}>
                        {bulkAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Add Group
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Students
            </span>
            <Badge variant="secondary">{members.length}</Badge>
          </CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input placeholder="Search students..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No students found.</p>
          ) : (
            <div className="divide-y">
              {filtered.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                      {m.studentName?.charAt(0).toUpperCase() || "S"}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{m.studentName}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3" /> {m.studentEmail}
                        {m.studentCode && <span className="ml-1 font-mono">&middot; {m.studentCode}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-gray-400 hidden sm:inline">Joined {formatDate(m.joinedAt)}</span>
                    {isTeacher && (
                      <Button size="sm" variant="ghost" onClick={() => handleRemove(m)} className="text-red-600 hover:text-red-700">
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
