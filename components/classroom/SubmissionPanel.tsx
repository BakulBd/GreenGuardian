"use client";

/**
 * Student-facing hand-in for one piece of classwork.
 *
 * Accepts a typed answer, file uploads, or both — which of those makes sense
 * is the student's call, since a quiz answer is usually text and an assignment
 * is usually a document. The panel has three states, and the state is always
 * stated in words as well as colour: not yet submitted, submitted (still
 * editable), and returned with a mark (closed).
 */

import { useEffect, useState } from "react";
import {
  Upload,
  Send,
  Loader2,
  CheckCircle2,
  Clock,
  RotateCcw,
  Award,
  MessageSquare,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import FileUpload from "@/components/FileUpload";
import {
  subscribeToOwnSubmission,
  submitClasswork,
  unsubmitClasswork,
} from "@/lib/firebase/submissions";
import { CLASSROOM_MATERIAL_ALLOWED_TYPES, CLASSROOM_MAX_FILE_SIZE, UploadResult } from "@/lib/firebase/storage";
import type { ClassroomAttachment, ClassworkItem, ClassworkSubmission, User } from "@/lib/types";

function formatDateTime(value: any): string {
  if (!value) return "";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SubmissionPanel({
  classwork,
  student,
}: {
  classwork: ClassworkItem;
  student: User;
}) {
  const { toast } = useToast();
  const [submission, setSubmission] = useState<ClassworkSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeToOwnSubmission(classwork.id, student.id, (data) => {
      setSubmission(data);
      setLoading(false);
    });
    return () => unsub();
  }, [classwork.id, student.id]);

  const returned = submission?.status === "returned";

  const startEditing = () => {
    setText(submission?.text || "");
    setUploads([]);
    setEditing(true);
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      // Files already attached to a previous draft are kept unless this pass
      // uploads replacements — re-uploading everything to change one sentence
      // would be a poor trade for the student's connection.
      const attachments: ClassroomAttachment[] = uploads.length
        ? uploads.map((u) => ({ name: u.name, url: u.url, type: u.type, size: u.size }))
        : submission?.attachments || [];

      await submitClasswork({ classwork, student, text, attachments });
      toast({ title: "Submitted", description: `Your work for "${classwork.title}" was handed in.` });
      setEditing(false);
      setUploads([]);
    } catch (error: any) {
      toast({ title: "Could not submit", description: error.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleUnsubmit = async () => {
    if (!confirm("Withdraw this submission? You can hand it in again before the deadline.")) return;
    setBusy(true);
    try {
      await unsubmitClasswork(classwork.id, student.id);
      toast({ title: "Withdrawn", description: "Your submission has been removed." });
    } catch (error: any) {
      toast({ title: "Could not withdraw", description: error.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 border-t pt-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking your submission…
      </div>
    );
  }

  // --- Marked and returned: read-only, with the mark and the feedback. ---
  if (returned && submission) {
    const total = submission.totalMarks ?? classwork.totalMarks;
    return (
      <div className="mt-3 border-t pt-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
            <Award className="h-3 w-3 mr-1" />
            Marked
          </Badge>
          <span className="text-sm font-semibold text-gray-900">
            {submission.marks ?? 0}
            {total ? ` / ${total}` : ""}
          </span>
          {submission.gradedByName && (
            <span className="text-xs text-gray-500">by {submission.gradedByName}</span>
          )}
          {submission.gradedAt && (
            <span className="text-xs text-gray-400">{formatDateTime(submission.gradedAt)}</span>
          )}
        </div>
        {submission.feedback && (
          <div className="rounded-lg bg-gray-50 border p-2.5 text-sm text-gray-700">
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">
              <MessageSquare className="h-3.5 w-3.5" />
              Teacher feedback
            </p>
            {submission.feedback}
          </div>
        )}
      </div>
    );
  }

  // --- Submitted, not yet marked. ---
  if (submission && !editing) {
    return (
      <div className="mt-3 border-t pt-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Submitted
          </Badge>
          {submission.late && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
              <Clock className="h-3 w-3 mr-1" />
              Late
            </Badge>
          )}
          <span className="text-xs text-gray-500">{formatDateTime(submission.submittedAt)}</span>
        </div>

        {submission.text && (
          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 border rounded-lg p-2.5">
            {submission.text}
          </p>
        )}
        {submission.attachments && submission.attachments.length > 0 && (
          <ul className="space-y-1">
            {submission.attachments.map((a, i) => (
              <li key={i}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:underline"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={startEditing} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Edit submission
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={handleUnsubmit} disabled={busy}>
            Withdraw
          </Button>
        </div>
      </div>
    );
  }

  // --- Not submitted, or editing an existing submission. ---
  return (
    <div className="mt-3 border-t pt-3 space-y-3">
      {!editing ? (
        <Button size="sm" onClick={startEditing}>
          <Upload className="h-3.5 w-3.5 mr-1" />
          Add submission
        </Button>
      ) : (
        <>
          <Textarea
            placeholder="Type your answer here (optional if you attach a file)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
          />
          <FileUpload
            basePath={`classrooms/${classwork.classroomId}/submissions/${student.id}`}
            onUploadComplete={setUploads}
            maxFiles={5}
            allowedTypes={CLASSROOM_MATERIAL_ALLOWED_TYPES}
            maxSize={CLASSROOM_MAX_FILE_SIZE}
            accept=".pdf,.doc,.docx,.ppt,.pptx,.zip,.jpg,.jpeg,.png,.gif,.webp"
          />
          {submission?.attachments?.length && uploads.length === 0 ? (
            <p className="text-xs text-gray-500">
              Keeping {submission.attachments.length} previously attached file
              {submission.attachments.length === 1 ? "" : "s"}. Upload again to replace them.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={busy}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1" />
              )}
              {submission ? "Update submission" : "Submit"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
