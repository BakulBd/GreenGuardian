"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, UserMinus, Copy, Check, Users, Mail } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { subscribeToClassroomMembers, removeClassroomMember } from "@/lib/firebase/classrooms";
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

  useEffect(() => {
    const unsub = subscribeToClassroomMembers(classroom.id, setMembers);
    return () => unsub();
  }, [classroom.id]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.trim().toLowerCase();
    return members.filter(
      (m) => m.studentName?.toLowerCase().includes(q) || m.studentEmail?.toLowerCase().includes(q) || m.studentCode?.toLowerCase().includes(q)
    );
  }, [members, searchQuery]);

  const handleRemove = async (member: ClassroomMember) => {
    if (!confirm(`Remove ${member.studentName} from this classroom?`)) return;
    try {
      await removeClassroomMember(classroom.id, member.studentId);
      toast({ title: "Student Removed" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove student", variant: "destructive" });
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
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Invite students</p>
              <p className="text-xs text-gray-500">Share the code or link — only students assigned to you can join.</p>
            </div>
            <Button variant="outline" size="sm" onClick={copyInvite}>
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              Copy Invite Link
            </Button>
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
