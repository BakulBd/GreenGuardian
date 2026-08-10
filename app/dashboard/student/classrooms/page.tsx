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
import { subscribeToStudentClassrooms, joinClassroomByCode, leaveClassroom, getSuggestedClassroomsForStudent } from "@/lib/firebase/classrooms";
import { Classroom } from "@/lib/types";
import { Sparkles, ArrowRight } from "lucide-react";

export default function StudentClassroomsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [suggestedClassrooms, setSuggestedClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joiningSuggestedId, setJoiningSuggestedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToStudentClassrooms(user.id, (data) => {
      setClassrooms(data);
      setLoading(false);
    });

    getSuggestedClassroomsForStudent(user).then((sug) => {
      setSuggestedClassrooms(sug);
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
    } catch (error: any) {
      toast({
        title: "Could Not Join",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setJoining(false);
    }
  };

  const handleJoinSuggested = async (c: Classroom) => {
    if (!user) return;
    setJoiningSuggestedId(c.id);
    try {
      const result = await joinClassroomByCode(c.code, user);
      if (result.success) {
        toast({ title: "Joined Classroom!", description: `You're now in ${c.name}.` });
        setSuggestedClassrooms((prev) => prev.filter((item) => item.id !== c.id));
      } else {
        toast({ title: "Could Not Join", description: result.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({
        title: "Could Not Join",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setJoiningSuggestedId(null);
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

        {/* Suggested Classrooms Section */}
        {suggestedClassrooms.length > 0 && (
          <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-green-50 border border-emerald-200/80 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-600 text-white rounded-xl">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-emerald-950">
                  Recommended Classrooms for Section {user?.section}
                </h3>
                <p className="text-xs text-emerald-700">
                  These active classrooms match your enrolled batch & section. Click to join instantly.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suggestedClassrooms.map((sc) => (
                <div
                  key={sc.id}
                  className="bg-white border border-emerald-100 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-all"
                >
                  <div>
                    <h4 className="font-bold text-sm text-slate-900 truncate">{sc.name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{sc.subject} • Section {sc.section}</p>
                    <p className="text-[11px] text-emerald-700 mt-1 font-medium">Instructor: {sc.teacherName}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleJoinSuggested(sc)}
                    disabled={joiningSuggestedId === sc.id}
                    className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-8 rounded-lg"
                  >
                    {joiningSuggestedId === sc.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Users className="h-3.5 w-3.5 mr-1" />
                    )}
                    Join Class
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

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
