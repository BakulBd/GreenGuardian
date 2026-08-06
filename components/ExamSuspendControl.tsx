"use client";

import { useState } from "react";
import { PauseCircle, PlayCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { suspendExamSession, resumeExamSession } from "@/lib/services/proctoring";

interface ExamSuspendControlProps {
  sessionId: string;
  studentName: string;
  locked: boolean;
  size?: "sm" | "default";
}

/**
 * Teacher control to suspend (freeze) or resume a student's in-progress exam
 * session in real time. The student's ExamClient watches the session
 * document and locks/unlocks the moment this changes (see Task 3).
 */
export default function ExamSuspendControl({ sessionId, studentName, locked, size = "sm" }: ExamSuspendControlProps) {
  const { user: teacher } = useAuth();
  const { toast } = useToast();
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSuspend = async (suspendReason?: string) => {
    if (!teacher) return;
    setSubmitting(true);
    try {
      await suspendExamSession(sessionId, teacher.id, suspendReason);
      toast({ title: "Exam Suspended", description: `${studentName}'s exam has been paused.` });
      setShowReasonModal(false);
      setReason("");
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to suspend exam", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async () => {
    setSubmitting(true);
    try {
      await resumeExamSession(sessionId);
      toast({ title: "Exam Resumed", description: `${studentName}'s exam has been resumed.` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to resume exam", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (locked) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
          <PauseCircle className="h-3 w-3 mr-1" />
          Suspended
        </Badge>
        <Button size={size} variant="outline" onClick={handleResume} disabled={submitting}>
          <PlayCircle className="h-3.5 w-3.5 mr-1" />
          Resume
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setShowReasonModal(true)} disabled={submitting}>
        <PauseCircle className="h-3.5 w-3.5 mr-1" />
        Suspend Exam
      </Button>

      {showReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm bg-white shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-base">Suspend {studentName}&apos;s Exam</CardTitle>
              <button onClick={() => setShowReasonModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm text-gray-600">
                The exam will freeze immediately for {studentName}. The timer stops and resumes
                exactly where it left off once you resume.
              </p>
              <Textarea
                placeholder="Reason (optional, shown to the student)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowReasonModal(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => handleSuspend(reason.trim() || undefined)} disabled={submitting}>
                  Confirm Suspend
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
