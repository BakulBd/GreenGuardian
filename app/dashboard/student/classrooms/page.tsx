"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, School, Users, Hash, LogOut, X, Loader2, BookOpen } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeToStudentClassrooms, joinClassroomByCode, leaveClassroom } from "@/lib/firebase/classrooms";
import { Classroom } from "@/lib/types";

export default function StudentClassroomsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToStudentClassrooms(user.id, (data) => {
      setClassrooms(data);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const handleJoin = async () => {
    if (!user) return;
    setJoining(true);
    try {
      const result = await joinClassroomByCode(joinCode, user);
      if (result.success) {
        toast({ title: "Joined!", description: `You're now in ${result.classroomName}.` });
        setJoinCode("");
        setShowJoinModal(false);
        router.push(`/dashboard/student/classrooms/${result.classroomId}`);
      } else {
        toast({ title: "Could Not Join", description: result.error, variant: "destructive" });
      }
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async (c: Classroom) => {
    if (!user) return;
    if (!confirm(`Leave "${c.name}"? You'll need the code to rejoin.`)) return;
    try {
      await leaveClassroom(c.id, user.id);
      toast({ title: "Left Classroom" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  return (
    <DashboardLayout role="student">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Classrooms</h1>
            <p className="text-gray-600 mt-1">Join with a class code, or ask your teacher to add you</p>
          </div>
          <Button onClick={() => setShowJoinModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Join Classroom
          </Button>
        </div>

        {classrooms.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16 text-gray-500">
              <School className="mx-auto h-16 w-16 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600">You haven&apos;t joined any classrooms yet</h3>
              <p className="text-sm mt-1">Ask your teacher for a classroom code or invite link.</p>
              <Button className="mt-4" onClick={() => setShowJoinModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Join a Classroom
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classrooms.map((c) => (
              <Card key={c.id} className="hover:shadow-md transition-shadow overflow-hidden">
                <div className="h-2 bg-gradient-to-r from-emerald-500 to-green-500" />
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg truncate cursor-pointer hover:text-emerald-700" onClick={() => router.push(`/dashboard/student/classrooms/${c.id}`)}>
                    {c.name}
                  </CardTitle>
                  <CardDescription>
                    {c.subject} &middot; Section {c.section}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-gray-500">{c.teacherName}</p>
                  {c.status === "archived" && (
                    <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">Archived</Badge>
                  )}
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/student/classrooms/${c.id}`)}>
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleLeave(c)} className="text-red-600 hover:text-red-700">
                      <LogOut className="h-3.5 w-3.5 mr-1" />
                      Leave
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm bg-white shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-lg">Join a Classroom</CardTitle>
              <button onClick={() => setShowJoinModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm text-gray-600">Ask your teacher for the classroom code.</p>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  className="pl-9 uppercase tracking-widest font-mono"
                  placeholder="ABC123"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  maxLength={10}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowJoinModal(false)} disabled={joining}>
                  Cancel
                </Button>
                <Button onClick={handleJoin} disabled={joining || !joinCode.trim()}>
                  {joining ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Users className="h-4 w-4 mr-1" />}
                  Join
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
