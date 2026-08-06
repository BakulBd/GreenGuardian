"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Hash, Users, Copy, Check } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import StreamTab from "./StreamTab";
import ClassworkTab from "./ClassworkTab";
import PeopleTab from "./PeopleTab";
import AboutTab from "./AboutTab";
import { Classroom, User } from "@/lib/types";

interface ClassroomDetailShellProps {
  classroom: Classroom;
  isTeacher: boolean;
  currentUser: User;
  backHref: string;
}

export default function ClassroomDetailShell({ classroom, isTeacher, currentUser, backHref }: ClassroomDetailShellProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState("stream");
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(classroom.code);
      setCopied(true);
      toast({ title: "Code Copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) — non-fatal.
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push(backHref)}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Classrooms
      </Button>

      <div className="rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 text-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{classroom.name}</h1>
              {classroom.status === "archived" && (
                <Badge className="bg-white/20 border-white/30 text-white">Archived</Badge>
              )}
            </div>
            <p className="text-emerald-50 mt-1">
              {classroom.subject} &middot; Section {classroom.section}
              {classroom.semester ? ` · ${classroom.semester}` : ""}
            </p>
            <p className="text-emerald-100 text-sm mt-1">{classroom.teacherName}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={copyCode}
              className="flex items-center gap-2 bg-white/15 hover:bg-white/25 transition-colors rounded-lg px-3 py-1.5 text-sm font-mono tracking-widest"
              title="Copy classroom code"
            >
              <Hash className="h-3.5 w-3.5" />
              {classroom.code}
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <span className="text-xs text-emerald-100 flex items-center gap-1">
              <Users className="h-3 w-3" /> {classroom.studentCount ?? 0} students
            </span>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stream">Stream</TabsTrigger>
          <TabsTrigger value="classwork">Classwork</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>
        <TabsContent value="stream">
          <StreamTab classroom={classroom} isTeacher={isTeacher} currentUser={currentUser} />
        </TabsContent>
        <TabsContent value="classwork">
          <ClassworkTab classroom={classroom} isTeacher={isTeacher} currentUser={currentUser} />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab classroom={classroom} isTeacher={isTeacher} currentUser={currentUser} />
        </TabsContent>
        <TabsContent value="about">
          <AboutTab classroom={classroom} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
