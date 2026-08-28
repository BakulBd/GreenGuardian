"use client";

/**
 * Teacher/admin override of one submission's mark.
 *
 * Marks now arrive automatically: the AI evaluation reads the question paper
 * and the answer script and awards a mark per question. This panel is where a
 * teacher disagrees with it — overall here, or question by question in the
 * AI evaluation panel above.
 *
 * The mark is submitted to `/api/exams/evaluate`, which owns the write: it
 * checks that this teacher owns the exam, records the override in its OWN
 * field (the AI evaluation is never overwritten), and updates the answer, the
 * session and the derived percentage together, so the mark cannot appear in
 * one screen and not another.
 *
 * "Clear override" exists because the final mark is derived rather than stored
 * twice: removing the override hands the student's mark straight back to the
 * AI evaluation, with no need to remember what it was.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Award, Bot, Loader2, Save, Sparkles } from "lucide-react";
import { authedFetch } from "@/lib/utils/api-client";
import { suggestAnswerGrade } from "@/lib/utils/ai-client";

export interface EvaluationTarget {
  id: string;
  studentName?: string;
  examTitle?: string;
  /** Current mark, from auto-grading or a previous manual evaluation. */
  score?: number;
  totalMarks?: number;
  grading?: { obtainedMarks?: number; totalMarks?: number } | null;
  teacherFeedback?: string;
  evaluation?: {
    marks?: number;
    feedback?: string;
    evaluatedByName?: string;
    method?: string;
  } | null;
  /** OCR text of the uploaded script, used for the AI suggestion. */
  ocrText?: string;
  ocrAnalysis?: { extractedText?: string } | null;
  /** The AI's own mark, shown for comparison and never modified here. */
  aiEvaluation?: { status?: string; totalMarks?: number; maxMarks?: number } | null;
  teacherOverride?: { marks?: number; totalMarks?: number; overriddenByName?: string } | null;
  finalMarks?: number;
  finalTotalMarks?: number;
  finalMarksSource?: "teacher" | "ai" | "auto";
}

export interface EvaluationResult {
  marks: number;
  totalMarks: number;
  accuracy: number;
  feedback: string;
  evaluatedByName: string;
}

export default function ManualEvaluationPanel({
  answer,
  /** Question/paper context handed to the model when suggesting a mark. */
  questionContext,
  onEvaluated,
}: {
  answer: EvaluationTarget;
  questionContext?: string;
  onEvaluated?: (result: EvaluationResult) => void;
}) {
  const { toast } = useToast();

  const aiEvaluated =
    answer.aiEvaluation?.status === "completed" || answer.aiEvaluation?.status === "needs_review";
  const aiMarks = aiEvaluated ? answer.aiEvaluation?.totalMarks : undefined;

  const totalMarks =
    answer.finalTotalMarks ??
    answer.aiEvaluation?.maxMarks ??
    answer.grading?.totalMarks ??
    answer.totalMarks ??
    100;

  // Pre-fill with whatever the student currently has, so saving without
  // touching the box is a no-op rather than a silent change.
  const currentMarks =
    answer.teacherOverride?.marks ??
    answer.finalMarks ??
    aiMarks ??
    answer.evaluation?.marks ??
    answer.grading?.obtainedMarks ??
    answer.score;

  const [marks, setMarks] = useState<string>(
    currentMarks === undefined || currentMarks === null ? "" : String(currentMarks)
  );
  const [feedback, setFeedback] = useState(
    answer.evaluation?.feedback ?? answer.teacherFeedback ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ score: number; feedback?: string } | null>(null);

  const extractedText = answer.ocrText || answer.ocrAnalysis?.extractedText || "";
  const hasOverride = Boolean(answer.teacherOverride) || answer.evaluation?.method === "manual";

  const handleSuggest = async () => {
    if (!extractedText.trim()) {
      toast({
        title: "Nothing to read yet",
        description: "Run the OCR pass over the uploaded files first — the model marks the extracted text.",
        variant: "destructive",
      });
      return;
    }

    setSuggesting(true);
    try {
      const result = await suggestAnswerGrade(
        questionContext?.trim() || `Exam: ${answer.examTitle || "submission"}. Mark out of ${totalMarks}.`,
        extractedText.slice(0, 20000)
      );

      if (!result.success || typeof result.score !== "number") {
        throw new Error(result.error || "The model did not return a usable score.");
      }

      // The model scores out of 100; rescale to this exam's total.
      const scaled = Math.round((result.score / 100) * totalMarks * 10) / 10;
      setSuggestion({ score: scaled, feedback: result.feedback });
      setMarks(String(scaled));
      if (result.feedback && !feedback.trim()) setFeedback(result.feedback);

      toast({
        title: "Suggestion ready",
        description: `The model suggests ${scaled} / ${totalMarks}. Review it before saving — it is not a grade until you save it.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not get a suggestion",
        description: error?.message || "The AI grading pass failed.",
        variant: "destructive",
      });
    } finally {
      setSuggesting(false);
    }
  };

  const handleSave = async () => {
    const value = Number(marks);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: "Invalid mark", description: "Enter a mark of zero or more.", variant: "destructive" });
      return;
    }
    if (value > totalMarks) {
      toast({
        title: "Mark too high",
        description: `The mark cannot exceed the total of ${totalMarks}.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await authedFetch<EvaluationResult & { success: boolean }>(
        "/api/exams/evaluate",
        {
          method: "POST",
          body: {
            answerId: answer.id,
            marks: value,
            totalMarks,
            feedback,
            ...(suggestion ? { aiSuggestedMarks: suggestion.score } : {}),
          },
          fallbackError: "Could not save the evaluation.",
        }
      );

      toast({
        title: "Evaluation saved",
        description: `${answer.studentName || "This student"} scored ${result.marks} / ${result.totalMarks}.`,
      });
      onEvaluated?.(result);
    } catch (error: any) {
      toast({
        title: "Could not save",
        description: error?.message || "The evaluation was not saved.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Drop the override and let the AI evaluation be the mark again.
   *
   * Possible only because `finalMarks` is derived: there is no "original" to
   * restore by hand, the server just recomputes without the override.
   */
  const handleClear = async () => {
    setClearing(true);
    try {
      const result = await authedFetch<EvaluationResult & { success: boolean; cleared: boolean }>(
        "/api/exams/evaluate",
        {
          method: "POST",
          body: { answerId: answer.id, clearOverride: true },
          fallbackError: "Could not remove the override.",
        }
      );
      toast({
        title: "Override removed",
        description: aiEvaluated
          ? `The mark is back to the AI evaluation: ${result.marks} / ${result.totalMarks}.`
          : "The teacher override has been removed.",
      });
      setMarks(result.marks === null || result.marks === undefined ? "" : String(result.marks));
      onEvaluated?.(result);
    } catch (error: any) {
      toast({
        title: "Could not remove the override",
        description: error?.message || "Nothing was changed.",
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <Card className="border-emerald-200 bg-emerald-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-600" />
              Manual Evaluation
            </CardTitle>
            <CardDescription className="text-xs">
              Override the mark for this submission. This is what the student sees. The AI
              evaluation is kept on record either way.
            </CardDescription>
          </div>
          {hasOverride && (
            <Badge variant="outline" className="text-[10px] bg-white">
              Overridden by {answer.teacherOverride?.overriddenByName || answer.evaluation?.evaluatedByName || "a teacher"}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr] sm:items-end">
          <div>
            <Label htmlFor="manual-marks" className="text-xs">
              Marks (out of {totalMarks})
            </Label>
            <Input
              id="manual-marks"
              type="number"
              min={0}
              max={totalMarks}
              step="0.5"
              value={marks}
              onChange={(event) => setMarks(event.target.value)}
              placeholder="0"
              className="bg-white"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {aiMarks !== undefined && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMarks(String(aiMarks))}
                disabled={saving || clearing}
                className="bg-white"
              >
                <Bot className="h-4 w-4 mr-2 text-emerald-600" />
                Use AI mark ({aiMarks})
              </Button>
            )}

            {/* Only offered when there is no full AI evaluation to override —
                otherwise it is a second, weaker opinion on the same script. */}
            {!aiEvaluated && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSuggest}
                disabled={suggesting || saving}
                className="bg-white"
              >
                {suggesting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2 text-purple-600" />
                )}
                Suggest a mark with AI
              </Button>
            )}

            <Button type="button" size="sm" onClick={handleSave} disabled={saving || suggesting || clearing}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save override
            </Button>

            {hasOverride && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={saving || clearing}
              >
                {clearing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Clear override
              </Button>
            )}
          </div>
        </div>

        {aiMarks !== undefined && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-white p-3">
            <Bot className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
            <p className="text-xs leading-relaxed text-gray-700">
              <span className="font-medium">
                AI mark: {aiMarks} / {answer.aiEvaluation?.maxMarks ?? totalMarks}.
              </span>{" "}
              Saving a different number here records a teacher override on top of it — the AI
              evaluation and its per-question reasoning stay exactly as they are.
            </p>
          </div>
        )}

        {suggestion && (
          <div className="flex items-start gap-2 rounded-lg border border-purple-200 bg-white p-3">
            <Bot className="h-4 w-4 shrink-0 mt-0.5 text-purple-600" />
            <p className="text-xs leading-relaxed text-gray-700">
              <span className="font-medium">Suggested: {suggestion.score} / {totalMarks}.</span>{" "}
              A suggestion from reading the extracted text — check it against the actual script before
              saving. Nothing is recorded until you press Save.
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="manual-feedback" className="text-xs">
            Feedback for the student (optional)
          </Label>
          <Textarea
            id="manual-feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What was good, and what to work on."
            className="bg-white min-h-[80px]"
          />
        </div>
      </CardContent>
    </Card>
  );
}
