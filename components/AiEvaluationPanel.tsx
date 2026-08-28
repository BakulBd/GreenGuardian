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
 *
 * On the visual encoding, since this screen is mostly numbers:
 *
 *   - A mark is a MAGNITUDE against a limit, so it is drawn as a meter — one
 *     hue, light track / dark fill — not as a donut or a two-slice pie, and
 *     not colour-graded by score. Painting 45% amber and 30% red would be the
 *     component inventing a pass mark the teacher never set.
 *   - Judgement lives on the verdict badge instead, which carries an icon and
 *     a word as well as a colour, so it never depends on hue alone.
 *   - Human vs AI authorship is an IDENTITY pair (emerald / violet — violet is
 *     already this app's colour for automated work), not good vs bad. Using
 *     red for the AI share would read as an accusation, which is precisely
 *     what this estimate must not be. The pair is checked for colour-vision
 *     separation rather than eyeballed.
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
  User as UserIcon,
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

/**
 * Status colours ship with an icon and a word, never colour alone — these
 * badges are the only place a value judgement about an answer is expressed.
 */
const VERDICT_STYLE: Record<AnswerVerdict, { label: string; className: string }> = {
  correct: { label: "Correct", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  partially_correct: {
    label: "Partial",
    className: "bg-amber-100 text-amber-900 border-amber-300",
  },
  incorrect: { label: "Incorrect", className: "bg-red-100 text-red-900 border-red-300" },
  unrelated: { label: "Unrelated", className: "bg-red-100 text-red-900 border-red-300" },
  unanswered: { label: "Not answered", className: "bg-gray-100 text-gray-700 border-gray-300" },
  unreadable: {
    label: "Could not read",
    className: "bg-violet-100 text-violet-900 border-violet-300",
  },
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-blue-50 text-blue-700 border-blue-200" },
  processing: {
    label: "AI Evaluation Processing...",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  completed: { label: "AI Evaluated", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  needs_review: { label: "Needs Review", className: "bg-amber-50 text-amber-800 border-amber-300" },
  failed: { label: "Evaluation Failed", className: "bg-red-50 text-red-700 border-red-200" },
};

function StatusBadge({ status }: { status?: string | null }) {
  const style = STATUS_STYLE[String(status ?? "")] ?? {
    label: "Not evaluated",
    className: "bg-gray-50 text-gray-600 border-gray-200",
  };
  const spinning = status === "queued" || status === "processing";
  return (
    <Badge variant="outline" className={`${style.className} gap-1.5 font-medium`}>
      {spinning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
      {style.label}
    </Badge>
  );
}

/**
 * A ratio against a limit.
 *
 * Single hue: the track is a light step of the same ramp as the fill, so the
 * bar reads as "this much of that" across its whole length. Rounded ends and a
 * minimum visible width mean a non-zero mark never renders as an empty track.
 */
function Meter({
  value,
  max,
  className = "",
  height = "h-2",
}: {
  value: number;
  max: number;
  className?: string;
  height?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const width = ratio === 0 ? 0 : Math.max(3, ratio * 100);
  return (
    <div
      className={`${height} w-full overflow-hidden rounded-full bg-emerald-100 ${className}`}
      role="img"
      aria-label={`${value} out of ${max}`}
    >
      <div
        className="h-full rounded-full bg-emerald-600 transition-[width] duration-500 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** Compact label/value pair. Not a stat tile — no delta, no trend. */
function Figure({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-semibold text-gray-900 ${emphasis ? "text-xl" : "text-base"}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

function SubScore({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-gray-500">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-gray-700">{value}%</span>
      </div>
      <Meter value={value} max={100} height="h-1.5" />
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
    <div className="overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[11px] font-bold text-gray-600">
          {question.questionNumber}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${verdict.className}`}>
              {verdict.label}
            </Badge>
            {question.gradedFromAnswerKey && (
              <Badge variant="outline" className="bg-gray-50 text-[10px] text-gray-600">
                From answer key
              </Badge>
            )}
          </span>
          <span className="mt-1 line-clamp-2 block text-xs text-gray-600">
            {question.questionText}
          </span>
          <span className="mt-2 block">
            <Meter value={question.awardedMarks} max={question.maxMarks} height="h-1.5" />
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span className="text-right">
            <span className="block text-sm font-bold tabular-nums text-emerald-700">
              {question.awardedMarks}
            </span>
            <span className="block text-[11px] tabular-nums text-gray-400">
              / {question.maxMarks}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t bg-gray-50/70 p-3 text-xs">
          {variant === "teacher" && onOverrideChange && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-white p-2">
              <label className="font-medium text-gray-700">Override mark:</label>
              <Input
                type="number"
                min={0}
                max={question.maxMarks}
                step="0.5"
                value={overrideValue ?? ""}
                onChange={(event) => onOverrideChange(event.target.value)}
                className="h-8 w-24"
              />
              <span className="text-gray-500">/ {question.maxMarks}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <SubScore label="Relevance" value={question.relevance} />
            <SubScore label="Correctness" value={question.correctness} />
            <SubScore label="Completeness" value={question.completeness} />
            <SubScore label="Reasoning" value={question.reasoningQuality} />
          </div>

          <div>
            <p className="mb-1 font-semibold text-gray-700">Question</p>
            <p className="whitespace-pre-wrap rounded-lg border bg-white p-2 text-gray-800">
              {question.questionText}
            </p>
          </div>

          <div>
            <p className="mb-1 font-semibold text-gray-700">Student answer (as read)</p>
            <p className="whitespace-pre-wrap rounded-lg border bg-white p-2 text-gray-800">
              {question.studentAnswer?.trim() ||
                "Nothing was found in the script for this question."}
            </p>
          </div>

          {question.feedback && (
            <div>
              <p className="mb-1 font-semibold text-gray-700">AI feedback</p>
              <p className="whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50/70 p-2 text-gray-800">
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
                  className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-900"
                >
                  <Check className="mr-1 h-3 w-3" />
                  {concept}
                </Badge>
              ))}
              {question.keyConceptsMissing.map((concept, index) => (
                <Badge
                  key={`m-${index}`}
                  variant="outline"
                  className="border-red-200 bg-red-50 text-[10px] text-red-900"
                >
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
    const running = status === "queued" || status === "processing";
    return (
      <Card className={running ? "border-blue-200 bg-blue-50/40" : "bg-gray-50/60"}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className={`h-4 w-4 ${running ? "text-blue-600" : "text-gray-400"}`} />
              AI Evaluation
            </CardTitle>
            <StatusBadge status={status} />
          </div>
          <CardDescription className="text-xs">
            {running
              ? "Reading the question paper and the answer script, then marking each question. This updates on its own when it finishes."
              : "This submission has not been evaluated by AI."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {running && (
            // An indeterminate track: progress is unknown, so nothing here
            // pretends to measure it.
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
            </div>
          )}
          {variant === "teacher" && onRerun && !running && (
            <Button size="sm" variant="outline" onClick={() => onRerun()} disabled={rerunning}>
              {rerunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Bot className="mr-2 h-4 w-4 text-emerald-600" />
              )}
              Run AI evaluation
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="border-red-200 bg-red-50/40">
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
            <p className="rounded-lg border border-red-200 bg-white p-2.5 text-xs text-red-800">
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

  const sourceLabel =
    finalMarksSource === "teacher"
      ? "Teacher override"
      : finalMarksSource === "ai"
      ? "From AI evaluation"
      : finalMarksSource === "auto"
      ? "From answer key"
      : "";

  return (
    <div className="space-y-4">
      <Card
        className={`overflow-hidden ${
          status === "needs_review" ? "border-amber-300" : "border-emerald-200"
        }`}
      >
        <CardHeader className="border-b bg-gray-50/70 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                AI Evaluation
              </CardTitle>
              <CardDescription className="text-xs">
                {evaluation.model
                  ? `Marked by ${evaluation.model}`
                  : "Marked by the configured AI model"}
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

        <CardContent className="space-y-5 pt-5">
          {/* The headline. One hero figure, one meter — the mark and how much
              of the paper it represents. Everything else is context beside it. */}
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Final mark</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-5xl font-bold leading-none text-gray-900">{shownFinal}</span>
                <span className="text-xl font-medium text-gray-400">/ {shownFinalTotal}</span>
              </div>
              <div className="mt-3 max-w-sm">
                <Meter value={shownFinal} max={shownFinalTotal} height="h-2.5" />
              </div>
              {sourceLabel && <p className="mt-1.5 text-[11px] text-gray-500">{sourceLabel}</p>}
            </div>

            <div className="grid grid-cols-3 gap-5 sm:gap-6">
              <Figure label="Percentage" value={`${shownPercentage}%`} emphasis />
              {variant === "teacher" && (
                <Figure
                  label="AI mark"
                  value={`${aiTotal} / ${maxMarks}`}
                  hint={teacherOverride ? "kept on record" : undefined}
                />
              )}
              <Figure label="Questions" value={String(questions.length)} />
            </div>
          </div>

          {teacherOverride && variant === "teacher" && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900">
              Overridden by {teacherOverride.overriddenByName || "a teacher"}: AI{" "}
              <strong>{aiTotal}</strong> → <strong>{teacherOverride.marks}</strong> /{" "}
              {teacherOverride.totalMarks}. The AI evaluation below is unchanged.
            </p>
          )}

          {status === "needs_review" && (evaluation.needsReviewReasons?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 text-xs text-amber-900">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                This evaluation needs a human look
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {evaluation.needsReviewReasons!.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.summary && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Overall feedback</p>
              <p className="whitespace-pre-wrap rounded-lg border bg-gray-50/70 p-2.5 text-xs leading-relaxed text-gray-800">
                {evaluation.summary}
              </p>
            </div>
          )}

          {questions.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-700">
                  Question-wise marks
                  <span className="ml-1.5 font-normal text-gray-400">
                    tap a question for the reasoning
                  </span>
                </p>
                {variant === "teacher" && onSaveQuestionMarks && dirtyOverrides.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => onSaveQuestionMarks(dirtyOverrides)}
                    disabled={savingQuestionMarks || outOfRange}
                  >
                    {savingQuestionMarks ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save {dirtyOverrides.length} override
                    {dirtyOverrides.length !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
              {outOfRange && (
                <p className="text-xs text-red-600">
                  One of the overrides is outside its question&apos;s mark range.
                </p>
              )}
              <div className="space-y-2">
                {questions.map((question) => (
                  <QuestionCard
                    key={`${question.questionId}-${question.questionNumber}`}
                    question={question}
                    variant={variant}
                    overrideValue={overrides[question.questionId] ?? String(question.awardedMarks)}
                    onOverrideChange={
                      variant === "teacher" && onSaveQuestionMarks
                        ? (value) =>
                            setOverrides((prev) => ({ ...prev, [question.questionId]: value }))
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Authorship is staff-only and deliberately in its own card, below the
          marks, so it never reads as part of the grade. */}
      {variant === "teacher" && authorship && (
        <Card className="border-violet-200">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldQuestion className="h-4 w-4 text-violet-600" />
                Human vs AI authorship estimate
              </CardTitle>
              <Badge
                variant="outline"
                className={
                  authorship.status === "likely_ai"
                    ? "border-violet-300 bg-violet-100 text-violet-900"
                    : authorship.status === "likely_human"
                    ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                    : "border-gray-300 bg-gray-100 text-gray-700"
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
            {/* Two identity colours, both directly labelled, with a surface gap
                between the segments so the split is legible without relying on
                the hue boundary. */}
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
              <div
                className="h-full rounded-l-full bg-emerald-600 transition-[width] duration-500"
                style={{ width: `${authorship.humanPercent}%` }}
              />
              <div
                className="h-full rounded-r-full bg-violet-600 transition-[width] duration-500"
                style={{ width: `${authorship.aiPercent}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-gray-800">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                <UserIcon className="h-3.5 w-3.5 text-gray-400" />
                Human written{" "}
                <strong className="tabular-nums text-gray-900">{authorship.humanPercent}%</strong>
              </span>
              <span className="flex items-center gap-1.5 font-medium text-gray-800">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
                <Bot className="h-3.5 w-3.5 text-gray-400" />
                AI generated{" "}
                <strong className="tabular-nums text-gray-900">{authorship.aiPercent}%</strong>
              </span>
              <span className="text-gray-500">
                Confidence <strong className="tabular-nums">{authorship.confidence}%</strong>
              </span>
            </div>

            {authorship.rationale && (
              <p className="rounded-lg border bg-gray-50/70 p-2.5 text-xs leading-relaxed text-gray-700">
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

            <p className="text-[11px] leading-relaxed text-gray-500">
              Handwriting is not evidence of human authorship, and typed text is not evidence of AI
              authorship. A suspected AI answer still receives the marks it earns.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
