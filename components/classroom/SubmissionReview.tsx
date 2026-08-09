"use client";

/**
 * Teacher's manual evaluation surface for one piece of classwork.
 *
 * The machine-assisted pass (OCR text and an AI mark suggestion, written by
 * `saveAiSuggestion`) is shown as *advice next to the input*, never prefilled
 * silently into it. A suggestion the teacher has to actively accept is a
 * suggestion; a suggestion that arrives already typed into the mark box is a
 * grade nobody chose. "Use suggestion" fills the field in one click for the
 * cases where the teacher agrees.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Award,
  Clock,
  Paperclip,
  Sparkles,
  Check,
  RotateCcw,
  Users,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  subscribeToClassworkSubmissions,
  gradeSubmission,
  returnForRevision,
  submissionProgress,
} from "@/lib/firebase/submissions";
import type { ClassworkItem, ClassworkSubmission, User } from "@/lib/types";

function formatDateTime(value: any): string {
  if (!value) return "";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SubmissionRow({
  submission,
  totalMarks,
  teacher,
}: {
  submission: ClassworkSubmission;
  totalMarks: number;
  teacher: User;
}) {
  const { toast } = useToast();
  const [marks, setMarks] = useState<string>(
    submission.marks !== undefined ? String(submission.marks) : ""
  );
  const [feedback, setFeedback] = useState(submission.feedback || "");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(submission.status !== "returned");

  const returned = submission.status === "returned";

  const handleSave = async () => {
    const value = Number(marks);
    if (marks.trim() === "" || !Number.isFinite(value)) {
      toast({ title: "Enter a mark", description: "A numeric mark is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await gradeSubmission({
        submissionId: submission.id,
        marks: value,
        totalMarks,
        feedback,
        grader: teacher,
      });
      toast({ title: "Marks returned", description: `${submission.studentName} can now see the result.` });
    } catch (error: any) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    setSaving(true);
    try {
      await returnForRevision(submission.id);
      toast({ title: "Reopened", description: `${submission.studentName} can revise and resubmit.` });
      setExpanded(true);
    } catch (error: any) {
      toast({ title: "Could not reopen", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {submission.studentName}
            {submission.studentCode && (
              <span className="text-xs text-gray-400 font-normal ml-2">{submission.studentCode}</span>
            )}
          </p>
          <p className="text-xs text-gray-500">{formatDateTime(submission.submittedAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {submission.late && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
              <Clock className="h-3 w-3 mr-1" />
              Late
            </Badge>
          )}
          {returned ? (
            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
              <Award className="h-3 w-3 mr-1" />
              {submission.marks ?? 0}
              {totalMarks ? `/${totalMarks}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
              Needs marking
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t p-3 space-y-3">
          {submission.text && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Answer</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded-lg p-2.5">
                {submission.text}
              </p>
            </div>
          )}

          {submission.attachments && submission.attachments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Attachments</p>
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
            </div>
          )}

          {/* Machine-assisted pre-pass — advice, not a grade. */}
          {(submission.aiSuggestedMarks !== undefined || submission.ocrText) && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-violet-800">
                <Sparkles className="h-3.5 w-3.5" />
                Automated review — for reference only
              </p>
              {submission.aiSuggestedMarks !== undefined && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-violet-900">
                    Suggested mark: <strong>{submission.aiSuggestedMarks}</strong>
                    {totalMarks ? ` / ${totalMarks}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setMarks(String(submission.aiSuggestedMarks))}
                    disabled={returned}
                  >
                    Use suggestion
                  </Button>
                </div>
              )}
              {submission.aiRationale && (
                <p className="text-xs text-violet-800 leading-relaxed">{submission.aiRationale}</p>
              )}
              {submission.ocrText && (
                <details className="text-xs text-violet-900">
                  <summary className="cursor-pointer font-medium">Extracted text</summary>
                  <p className="mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">{submission.ocrText}</p>
                </details>
              )}
            </div>
          )}

          {returned ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-gray-600">
                Marked {submission.marks}
                {totalMarks ? ` / ${totalMarks}` : ""} by {submission.gradedByName || "a teacher"}
                {submission.feedback && <> · &ldquo;{submission.feedback}&rdquo;</>}
              </div>
              <Button size="sm" variant="outline" onClick={handleReopen} disabled={saving}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Reopen for revision
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">
                    Mark {totalMarks ? `(out of ${totalMarks})` : ""}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={totalMarks || undefined}
                    value={marks}
                    onChange={(e) => setMarks(e.target.value)}
                    className="w-28"
                  />
                </div>
              </div>
              <Textarea
                placeholder="Feedback for the student (optional)"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  )}
                  Return marks
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function SubmissionReview({
  classwork,
  teacher,
}: {
  classwork: ClassworkItem;
  teacher: User;
}) {
  const [submissions, setSubmissions] = useState<ClassworkSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const unsub = subscribeToClassworkSubmissions(
      classwork.id,
      (data) => {
        setSubmissions(data);
        setLoading(false);
      },
      (err) => {
        setError(
          err?.code === "permission-denied"
            ? "You can only review submissions for classwork you own."
            : "Submissions could not be loaded."
        );
        setLoading(false);
      }
    );
    return () => unsub();
  }, [open, classwork.id]);

  const progress = useMemo(() => submissionProgress(submissions), [submissions]);
  const totalMarks = classwork.totalMarks ?? 0;

  return (
    <div className="mt-3 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1.5 font-medium"
      >
        <Users className="h-3.5 w-3.5" />
        {open ? "Hide submissions" : "Review submissions"}
        {open && !loading && (
          <span className="text-gray-400 font-normal">
            · {progress.graded}/{progress.total} marked
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading submissions…
            </div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500">
              <FileText className="h-8 w-8 mx-auto text-gray-300 mb-2" />
              No submissions yet.
            </div>
          ) : (
            <>
              <div className="flex gap-4 text-xs text-gray-600 mb-2">
                <span>
                  <strong className="text-gray-900">{progress.total}</strong> submitted
                </span>
                <span>
                  <strong className="text-gray-900">{progress.pending}</strong> awaiting marks
                </span>
                {progress.late > 0 && (
                  <span className="text-amber-700">
                    <strong>{progress.late}</strong> late
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {submissions.map((s) => (
                  <SubmissionRow key={s.id} submission={s} totalMarks={totalMarks} teacher={teacher} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
