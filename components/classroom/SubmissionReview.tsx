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
  Download,
  Pencil,
  CheckCircle2,
  ImageIcon,
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
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

function isImage(attachment: { type?: string; name?: string; url?: string }): boolean {
  if (attachment.type?.startsWith("image/")) return true;
  // Older attachments were stored without a MIME type; fall back to the name.
  const name = (attachment.name || attachment.url || "").toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => name.includes(extension));
}

function isPdf(attachment: { type?: string; name?: string; url?: string }): boolean {
  if (attachment.type === "application/pdf") return true;
  return (attachment.name || attachment.url || "").toLowerCase().includes(".pdf");
}

/**
 * One submitted file, rendered as something the teacher can actually assess.
 *
 * A bare filename link was the whole of this before, which meant marking a
 * photographed answer sheet required downloading every file first. Images are
 * shown inline; a PDF gets an embedded viewer that can be opened full-screen;
 * anything else keeps the download link it always had.
 */
function AttachmentCard({ attachment }: { attachment: { name?: string; url?: string; type?: string; size?: number } }) {
  const url = attachment.url || "";
  const name = attachment.name || "Attachment";

  if (!url) {
    return <p className="text-xs text-gray-500">{name} (no file reference stored)</p>;
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b bg-gray-50">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700 truncate">
          {isImage(attachment) ? (
            <ImageIcon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          ) : (
            <Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          )}
          <span className="truncate">{name}</span>
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Open
        </a>
      </div>

      {isImage(attachment) && (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage
        // URL, not a static asset; next/image cannot optimise it.
        <img
          src={url}
          alt={name}
          className="w-full max-h-80 object-contain bg-gray-100"
          loading="lazy"
        />
      )}

      {isPdf(attachment) && (
        <object data={url} type="application/pdf" className="w-full h-80 bg-gray-100">
          {/* Browsers without an inline PDF viewer land here. */}
          <div className="p-4 text-xs text-gray-600">
            This browser cannot display the PDF inline.{" "}
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
              Open it in a new tab
            </a>
            .
          </div>
        </object>
      )}
    </div>
  );
}

function SubmissionRow({
  submission,
  totalMarks,
  teacher,
  classworkDueDate,
}: {
  submission: ClassworkSubmission;
  totalMarks: number;
  teacher: User;
  classworkDueDate?: unknown;
}) {
  const { toast } = useToast();
  const [marks, setMarks] = useState<string>(
    submission.marks !== undefined ? String(submission.marks) : ""
  );
  const [feedback, setFeedback] = useState(submission.feedback || "");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(submission.status !== "returned");
  /** Re-marking work that has already been returned. */
  const [editingMarks, setEditingMarks] = useState(false);

  const returned = submission.status === "returned";

  // The deadline recorded at hand-in wins over the classwork's current one:
  // if the teacher moved the due date afterwards, the stored value is what the
  // student was actually working to.
  const deadline = submission.dueAtSubmission ?? classworkDueDate;

  const handleSave = async () => {
    const value = Number(marks);
    if (marks.trim() === "" || !Number.isFinite(value)) {
      toast({ title: "Enter a mark", description: "A numeric mark is required.", variant: "destructive" });
      return;
    }
    // Checked here as well as in `gradeSubmission` so the teacher is corrected
    // before the round trip rather than after it.
    if (value < 0) {
      toast({ title: "Invalid mark", description: "Enter a mark of zero or more.", variant: "destructive" });
      return;
    }
    if (totalMarks > 0 && value > totalMarks) {
      toast({
        title: "Mark too high",
        description: `The mark cannot exceed the total of ${totalMarks}.`,
        variant: "destructive",
      });
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
      toast({
        title: returned ? "Marks updated" : "Marks returned",
        description: `${submission.studentName} can now see ${returned ? "the updated result" : "the result"}.`,
      });
      setEditingMarks(false);
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
          <p className="text-xs text-gray-500">
            Submitted: {formatDateTime(submission.submittedAt) || "—"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {submission.late ? (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 font-semibold">
              <Clock className="h-3 w-3 mr-1" />
              LATE
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              On Time
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
          {/* Submission facts first: who, when, and against which deadline.
              A "LATE" badge with no deadline beside it is an accusation the
              teacher cannot check. */}
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 rounded-lg bg-gray-50 border p-2.5 text-xs">
            <div>
              <span className="text-gray-500">Submitted:</span>{" "}
              <span className="font-medium text-gray-900">
                {formatDateTime(submission.submittedAt) || "—"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Deadline:</span>{" "}
              <span className="font-medium text-gray-900">
                {formatDateTime(deadline) || "No deadline set"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>{" "}
              <span className={submission.late ? "font-semibold text-amber-700" : "font-medium text-gray-900"}>
                {submission.late ? "LATE SUBMISSION" : "On Time"}
              </span>
            </div>
            {submission.updatedAt && (
              <div>
                <span className="text-gray-500">Last edited:</span>{" "}
                <span className="font-medium text-gray-900">{formatDateTime(submission.updatedAt)}</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Answer</p>
            {submission.text ? (
              <p className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded-lg p-2.5">
                {submission.text}
              </p>
            ) : (
              // Said out loud rather than rendering nothing: "no written
              // answer" and "the answer failed to load" must not look alike.
              <p className="text-sm text-gray-500 italic bg-gray-50 border rounded-lg p-2.5">
                No written answer — {submission.attachments?.length ? "this student answered by file." : "nothing was submitted as text."}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">
              Attachments ({submission.attachments?.length ?? 0})
            </p>
            {submission.attachments && submission.attachments.length > 0 ? (
              <div className="space-y-2">
                {submission.attachments.map((a, i) => (
                  <AttachmentCard key={i} attachment={a} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">No files attached.</p>
            )}
          </div>

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

          {returned && !editingMarks ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-gray-600">
                Marked <strong className="text-gray-900">{submission.marks}</strong>
                {totalMarks ? ` / ${totalMarks}` : ""} by {submission.gradedByName || "a teacher"}
                {submission.feedback && <> · &ldquo;{submission.feedback}&rdquo;</>}
              </div>
              <div className="flex gap-2">
                {/* Correcting a mark should not require reopening the work —
                    that invites a resubmission nobody asked for. */}
                <Button size="sm" variant="outline" onClick={() => setEditingMarks(true)} disabled={saving}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit marks
                </Button>
                <Button size="sm" variant="ghost" onClick={handleReopen} disabled={saving}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reopen for revision
                </Button>
              </div>
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
              <div className="flex justify-end gap-2">
                {editingMarks && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMarks(submission.marks !== undefined ? String(submission.marks) : "");
                      setFeedback(submission.feedback || "");
                      setEditingMarks(false);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  )}
                  {editingMarks ? "Save marks" : "Return marks"}
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
      },
      // Constraining the query to this teacher is what makes it legal, not
      // merely narrower: Firestore refuses a list query it cannot statically
      // prove returns only readable documents, and the teacher's read grant is
      // per-document (`resource.data.teacherId == request.auth.uid`). Without
      // this the whole query was denied and every teacher saw an empty list.
      // Admins read under `isAdmin()`, which is unconditional, so they must
      // NOT be filtered by their own uid.
      teacher.role === "teacher" ? { teacherId: teacher.id } : undefined
    );
    return () => unsub();
  }, [open, classwork.id, teacher.id, teacher.role]);

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
                  <SubmissionRow
                    key={s.id}
                    submission={s}
                    totalMarks={totalMarks}
                    teacher={teacher}
                    classworkDueDate={classwork.dueDate}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
