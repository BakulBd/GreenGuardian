"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Loader2, Hash, CheckCircle, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { joinClassroomByCode } from "@/lib/firebase/classrooms";

function JoinClassroomContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, initialized } = useAuth();
  const code = (searchParams?.get("code") || "").toUpperCase();

  const [status, setStatus] = useState<"idle" | "joining" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [classroomId, setClassroomId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized || authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/classroom/join?code=${code}`)}`);
      return;
    }
    if (user.role !== "student") {
      setStatus("error");
      setMessage("Only student accounts can join a classroom.");
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("This invite link is missing a classroom code.");
      return;
    }
  }, [initialized, authLoading, user, router, code]);

  const handleJoin = async () => {
    if (!user) return;
    setStatus("joining");
    try {
      const result = await joinClassroomByCode(code, user);
      if (result.success) {
        setStatus("success");
        setClassroomId(result.classroomId);
        setMessage(`You've joined ${result.classroomName}.`);
      } else {
        setStatus("error");
        setMessage(result.error);
      }
    } catch (error: any) {
      // Without this the button spun forever on any unexpected throw and the
      // student was left with no message at all — worse than a wrong one.
      console.error("[Classrooms] Join by invite link failed:", error);
      setStatus("error");
      setMessage(error?.message || "Could not join this classroom. Please try again.");
    }
  };

  if (!initialized || authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto p-4 bg-emerald-50 rounded-full w-16 h-16 flex items-center justify-center mb-2">
            <Shield className="h-8 w-8 text-emerald-600" />
          </div>
          <CardTitle className="text-2xl">Classroom Invitation</CardTitle>
          <CardDescription>
            {code ? (
              <span className="flex items-center justify-center gap-1 mt-1 font-mono tracking-widest text-base">
                <Hash className="h-4 w-4" /> {code}
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {status === "success" ? (
            <>
              <CheckCircle className="mx-auto h-10 w-10 text-green-500" />
              <p className="text-gray-700">{message}</p>
              <Button className="w-full" onClick={() => router.push(`/dashboard/student/classrooms/${classroomId}`)}>
                Open Classroom
              </Button>
            </>
          ) : status === "error" ? (
            <>
              <XCircle className="mx-auto h-10 w-10 text-red-500" />
              <p className="text-gray-700">{message}</p>
              <Button variant="outline" className="w-full" onClick={() => router.push("/dashboard/student/classrooms")}>
                Back to My Classrooms
              </Button>
            </>
          ) : (
            <>
              <p className="text-gray-600">You&apos;ve been invited to join this classroom.</p>
              <Button className="w-full" onClick={handleJoin} disabled={status === "joining"}>
                {status === "joining" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Join Classroom
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function JoinClassroomPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      }
    >
      <JoinClassroomContent />
    </Suspense>
  );
}
