"use client";

/**
 * The AI evaluation of one submission, rendered for whoever is looking at it.
 *
 * `variant="teacher"` shows everything: AI marks against final marks, the
 * question-by-question breakdown with the model's reasoning, the authorship
 * estimate, and per-question override boxes. `variant="student"` shows the
 * student their own marks and feedback — but never the authorship estimate,
 * which is an integrity signal about them and belongs with staff, exactly like
 * the plagiarism report.
 *
 * Two things this component is careful never to imply:
 *
 *   - that a completed OCR pass means a human wrote the script. Text
 *     extraction and authorship are separate signals and are shown separately.
 *   - that the authorship estimate had anything to do with the marks. It is
 *     rendered in its own panel, below the marks, with that stated.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCcw,
  ShieldQuestion,
  Sparkles,
  XCircle,
} from "lucide-react";
import { authorshipLabel } from "@/lib/server/ai-evaluation";
import type {
  AiEvaluation,
  AnswerVerdict,
  AuthorshipEstimate,
  FinalMarksSource,
  QuestionEvaluation,
  TeacherOverride,
} from "@/lib/types";

export interface AiEvaluationPanelProps {
  evaluation?: AiEvaluation | null;
  authorship?: (AuthorshipEstimate & { analyzedAt?: string }) | null;
  teacherOverride?: TeacherOverride | null;
  finalMarks?: number | null;
  finalTotalMarks?: number | null;
  finalPercentage?: number | null;
  finalMarksSource?: FinalMarksSource | null;
  variant?: "teacher" | "student";
  /** Teacher-only: kick off a fresh evaluation. */
  onRerun?: () => Promise<void> | void;
  rerunning?: boolean;
  /** Teacher-only: save question-by-question marks. */
  onSaveQuestionMarks?: (
    marks: Array<{ questionId: string; marks: number }>
  ) => Promise<void> | void;
  savingQuestionMarks?: boolean;
}

const VERDICT_STYLE: Record<AnswerVerdict, { label: string; className: string }> = {
  correct: { label: "Correct", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  partially_correct: {
    label: "Partially correct",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  incorrect: { label: "Incorrect", className: "bg-red-100 text-red-700 border-red-200" },
  unrelated: { label: "Unrelated", className: "bg-red-100 text-red-700 border-red-200" },
  unanswered: { label: "Not answered", className: "bg-gray-100 text-gray-600 border-gray-200" },
  unreadable: { label: "Could not read", className: "bg-purple-100 text-purple-800 border-purple-200" },
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  queued: { label: "AI Evaluation Queued", className: "bg-blue-50 text-blue-700 border-blue-200" },
  processing: {
    label: "AI Evaluation Processing...",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  completed: { label: "AI Evaluated", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  needs_review: {
    label: "Needs Review",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  failed: { label: "Evaluation Failed", className: "bg-red-50 text-red-700 border-red-200" },
};

function StatusBadge({ status }: { status?: string | null }) {
  const style = STATUS_STYLE[String(status ?? "")] ?? {
    label: "Not evaluated",
    className: "bg-gray-50 text-gray-600 border-gray-200",
  };
  const spinning = status === "queued" || status === "processing";
  return (
    <Badge variant="outline" className={`${style.className} gap-1.5`}>
      {spinning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
      {style.label}
    </Badge>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

function QuestionCard({
  question,
  variant,
  overrideValue,
  onOverrideChange,
}: {
  question: QuestionEvaluation;
  variant: "teacher" | "student";
  overrideValue?: string;
  onOverrideChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const verdict = VERDICT_STYLE[question.verdict] ?? VERDICT_STYLE.incorrect;

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-700">Q{question.questionNumber}</span>
            <Badge variant="outline" className={`text-[10px] ${verdict.className}`}>
              {verdict.label}
            </Badge>
            {question.gradedFromAnswerKey && (
              <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600">
                From answer key
              </Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-gray-600">{question.questionText}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-sm font-bold text-emerald-700">
            {question.awardedMarks}
            <span className="text-xs font-normal text-gray-400"> / {question.maxMarks}</span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t bg-gray-50/60 p-3 text-xs">
          {variant === "teacher" && onOverrideChange && (
            <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700">Override mark:</label>
              <Input
                type="number"
                min={0}
                max={question.maxMarks}
                step="0.5"
                value={overrideValue ?? ""}
                onChange={(event) => onOverrideChange(event.target.value)}
                className="h-8 w-24 bg-white"
              />
              <span className="text-gray-500">/ {question.maxMarks}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Relevance" value={`${question.relevance}%`} />
            <Stat label="Correctness" value={`${question.correctness}%`} />
            <Stat label="Completeness" value={`${question.completeness}%`} />
            <Stat label="Reasoning" value={`${question.reasoningQuality}%`} />
          </div>

          <div>
            <p className="mb-1 font-semibold text-gray-700">Question</p>
            <p className="whitespace-pre-wrap rounded border bg-white p-2 text-gray-800">
              {question.questionText}
            </p>
          </div>

          <div>
            <p className="mb-1 font-semibold text-gray-700">Student answer (as read)</p>
            <p className="whitespace-pre-wrap rounded border bg-white p-2 text-gray-800">
              {question.studentAnswer?.trim() || "Nothing was found in the script for this question."}
            </p>
          </div>

          {question.feedback && (
            <div>
              <p className="mb-1 font-semibold text-gray-700">AI feedback</p>
              <p className="whitespace-pre-wrap rounded border border-blue-100 bg-blue-50/60 p-2 text-gray-800">
                {question.feedback}
              </p>
            </div>
          )}

          {(question.keyConceptsCovered.length > 0 || question.keyConceptsMissing.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {question.keyConceptsCovered.map((concept, index) => (
                <Badge
                  key={`c-${index}`}
                  variant="outline"
                  className="bg-emerald-50 text-[10px] text-emerald-800"
                >
                  <Check className="mr-1 h-3 w-3" />
                  {concept}
                </Badge>
              ))}
              {question.keyConceptsMissing.map((concept, index) => (
                <Badge key={`m-${index}`} variant="outline" className="bg-red-50 text-[10px] text-red-700">
                  <XCircle className="mr-1 h-3 w-3" />
                  {concept}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AiEvaluationPanel({
  evaluation,
  authorship,
  teacherOverride,
  finalMarks,
  finalTotalMarks,
  finalPercentage,
  finalMarksSource,
  variant = "teacher",
  onRerun,
  rerunning,
  onSaveQuestionMarks,
  savingQuestionMarks,
}: AiEvaluationPanelProps) {
  const status = evaluation?.status;
  const questions = useMemo(() => evaluation?.questions ?? [], [evaluation]);

  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const dirtyOverrides = useMemo(
    () =>
      questions
        .map((q) => {
          const raw = overrides[q.questionId];
          if (raw === undefined || raw === "") return null;
          const value = Number(raw);
          if (!Number.isFinite(value)) return null;
          if (value === q.awardedMarks) return null;
          return { questionId: q.questionId, marks: value };
        })
        .filter((entry): entry is { questionId: string; marks: number } => entry !== null),
    [overrides, questions]
  );

  const outOfRange = questions.some((q) => {
    const raw = overrides[q.questionId];
    if (raw === undefined || raw === "") return false;
    const value = Number(raw);
    return !Number.isFinite(value) || value < 0 || value > q.maxMarks;
  });

  // While an evaluation is running there is nothing to show but the state.
  if (!evaluation || status === "queued" || status === "processing") {
    return (
      <Card className="border-blue-200 bg-blue-50/30">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-blue-600" />
              AI Evaluation
            </CardTitle>
            <StatusBadge status={status} />
          </div>
          <CardDescription className="text-xs">
            {status === "queued" || status === "processing"
              ? "The question paper and the answer script are being read and marked. This page updates when it finishes."
              : "This submission has not been evaluated by AI."}
          </CardDescription>
        </CardHeader>
        {variant === "teacher" && onRerun && (
          <CardContent>
            <Button size="sm" variant="outline" onClick={() => onRerun()} disabled={rerunning}>
              {rerunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Bot className="mr-2 h-4 w-4 text-purple-600" />
              )}
              Run AI evaluation
            </Button>
          </CardContent>
        )}
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="border-red-200 bg-red-50/30">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              AI Evaluation Failed
            </CardTitle>
            <StatusBadge status={status} />
          </div>
          <CardDescription className="text-xs">
            No marks were produced. Nothing has been guessed or filled in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {evaluation.error && (
            <p className="rounded border border-red-200 bg-white p-2 text-xs text-red-700">
              {evaluation.error}
            </p>
          )}
          {variant === "teacher" && onRerun && (
            <Button size="sm" variant="outline" onClick={() => onRerun()} disabled={rerunning}>
              {rerunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Retry evaluation
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const aiTotal = evaluation.totalMarks ?? 0;
  const maxMarks = evaluation.maxMarks ?? 0;
  const shownFinal = finalMarks ?? aiTotal;
  const shownFinalTotal = finalTotalMarks ?? maxMarks;
  const shownPercentage =
    finalPercentage ??
    (shownFinalTotal > 0 ? Math.round((shownFinal / shownFinalTotal) * 1000) / 10 : 0);

  return (
    <div className="space-y-4">
      <Card className={status === "needs_review" ? "border-amber-200" : "border-emerald-200"}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                AI Evaluation
              </CardTitle>
              <CardDescription className="text-xs">
                {evaluation.model ? `Marked by ${evaluation.model}` : "Marked by the configured AI model"}
                {evaluation.questionSource === "paper_document" &&
                  " · questions read from the uploaded question paper"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={status} />
              {variant === "teacher" && onRerun && (
                <Button size="sm" variant="outline" onClick={() => onRerun()} disabled={rerunning}>
                  {rerunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  <span className="ml-1.5 text-xs">Re-run</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {variant === "teacher" && (
              <Stat
                label="AI mark"
                value={`${aiTotal} / ${maxMarks}`}
                hint={teacherOverride ? "kept on record" : undefined}
              />
            )}
            <Stat
              label="Final mark"
              value={`${shownFinal} / ${shownFinalTotal}`}
              hint={
                finalMarksSource === "teacher"
                  ? "teacher override"
                  : finalMarksSource === "ai"
                  ? "from AI evaluation"
                  : finalMarksSource === "auto"
                  ? "from answer key"
                  : undefined
              }
            />
            <Stat label="Maximum" value={String(shownFinalTotal)} />
            <Stat label="Percentage" value={`${shownPercentage}%`} />
          </div>

          {teacherOverride && variant === "teacher" && (
            <p className="rounded border border-emerald-200 bg-emerald-50/60 p-2 text-xs text-emerald-900">
              Overridden by {teacherOverride.overriddenByName || "a teacher"}: AI {aiTotal} →{" "}
              <strong>{teacherOverride.marks}</strong> / {teacherOverride.totalMarks}. The AI
              evaluation above is unchanged.
            </p>
          )}

          {status === "needs_review" && (evaluation.needsReviewReasons?.length ?? 0) > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50/60 p-2 text-xs text-amber-900">
              <p className="mb-1 font-semibold">This evaluation needs a human look:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {evaluation.needsReviewReasons!.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.summary && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Overall feedback</p>
              <p className="whitespace-pre-wrap rounded border bg-white p-2 text-xs text-gray-800">
                {evaluation.summary}
              </p>
            </div>
          )}

          {questions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">
                  Question-wise marks ({questions.length})
                </p>
                {variant === "teacher" && onSaveQuestionMarks && dirtyOverrides.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => onSaveQuestionMarks(dirtyOverrides)}
                    disabled={savingQuestionMarks || outOfRange}
                  >
                    {savingQuestionMarks ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Save {dirtyOverrides.length} question override
                    {dirtyOverrides.length !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
              {outOfRange && (
                <p className="text-xs text-red-600">
                  One of the overrides is outside its question&apos;s mark range.
                </p>
              )}
              {questions.map((question) => (
                <QuestionCard
                  key={`${question.questionId}-${question.questionNumber}`}
                  question={question}
                  variant={variant}
                  overrideValue={
                    overrides[question.questionId] ?? String(question.awardedMarks)
                  }
                  onOverrideChange={
                    variant === "teacher" && onSaveQuestionMarks
                      ? (value) =>
                          setOverrides((prev) => ({ ...prev, [question.questionId]: value }))
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Authorship is staff-only and deliberately in its own card, below the
          marks, so it never reads as part of the grade. */}
      {variant === "teacher" && authorship && (
        <Card className="border-purple-200 bg-purple-50/20">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldQuestion className="h-4 w-4 text-purple-600" />
                Human vs AI authorship estimate
              </CardTitle>
              <Badge
                variant="outline"
                className={
                  authorship.status === "likely_ai"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : authorship.status === "likely_human"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }
              >
                {authorshipLabel(authorship.status)}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              A probabilistic estimate from the writing itself — not proof, and not a factor in any
              mark above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Human written" value={`${authorship.humanPercent}%`} />
              <Stat label="AI generated" value={`${authorship.aiPercent}%`} />
              <Stat label="Confidence" value={`${authorship.confidence}%`} />
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-red-200">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${authorship.humanPercent}%` }}
              />
            </div>

            {authorship.rationale && (
              <p className="rounded border bg-white p-2 text-xs text-gray-700">
                {authorship.rationale}
              </p>
            )}

            {authorship.indicators.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {authorship.indicators.map((indicator, index) => (
                  <Badge key={index} variant="outline" className="bg-white text-[10px] text-gray-700">
                    {indicator}
                  </Badge>
                ))}
              </div>
            )}

            <p className="text-[11px] text-gray-500">
              Handwriting is not evidence of human authorship, and typed text is not evidence of AI
              authorship. A suspected AI answer still receives the marks it earns.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
