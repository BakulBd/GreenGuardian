"use client";

/**
 * Teacher performance analytics.
 *
 * Answers the three questions a teacher actually has after an exam closes:
 * how many passed, how the marks were distributed, and which exams are going
 * badly relative to the rest. Everything is scoped to exams this teacher owns.
 */

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, BarChart3, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { loadTeacherAnalytics } from "@/lib/firebase/analytics";
import {
  scoreSubmission,
  summarise,
  summariseBy,
  type ScoredSubmission,
} from "@/lib/analytics/exam-analytics";
import { BarChart, ChartCard, ProportionBar, RankedBars, StatTile } from "@/components/analytics/Charts";
import type { Answer, Exam } from "@/lib/types";

const ALL_EXAMS = "__all__";

function percent(value: number | null): string | null {
  return value === null ? null : value.toFixed(1);
}

export default function TeacherAnalyticsPage() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [examFilter, setExamFilter] = useState<string>(ALL_EXAMS);
  const [courseFilter, setCourseFilter] = useState<string>(ALL_EXAMS);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    loadTeacherAnalytics(user.id)
      .then((data) => {
        if (!active) return;
        setExams(data.exams);
        setAnswers(data.answers);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "Could not load analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const examsById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);

  const courses = useMemo(() => {
    const seen = new Map<string, string>();
    exams.forEach((e) => {
      if (e.courseId) seen.set(e.courseId, e.courseName || e.courseId);
    });
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [exams]);

  /** Graded submissions only — see `scoreSubmission` on why ungraded ≠ zero. */
  const scored = useMemo<ScoredSubmission[]>(
    () =>
      answers
        .map((answer) => scoreSubmission(answer, examsById.get(String(answer.examId))))
        .filter((s): s is ScoredSubmission => s !== null),
    [answers, examsById]
  );

  const filtered = useMemo(
    () =>
      scored.filter((s) => {
        if (examFilter !== ALL_EXAMS && s.examId !== examFilter) return false;
        if (courseFilter !== ALL_EXAMS) {
          const exam = examsById.get(s.examId);
          if (exam?.courseId !== courseFilter) return false;
        }
        return true;
      }),
    [scored, examFilter, courseFilter, examsById]
  );

  const summary = useMemo(() => summarise(filtered), [filtered]);

  const byExam = useMemo(
    () =>
      summariseBy(filtered, (s) => {
        const exam = examsById.get(s.examId);
        if (!exam) return null;
        return {
          key: exam.id,
          label: exam.title,
          sublabel: exam.courseName || exam.batch || undefined,
        };
      }),
    [filtered, examsById]
  );

  const byBatch = useMemo(
    () =>
      summariseBy(filtered, (s) => {
        const exam = examsById.get(s.examId);
        const batch = exam?.batch;
        if (!batch) return null;
        return { key: batch, label: `Batch ${batch}`, sublabel: exam?.section ? `Sec ${exam.section}` : undefined };
      }),
    [filtered, examsById]
  );

  const ungraded = useMemo(
    () => answers.filter((a) => !Number.isFinite(Number(a.score))).length,
    [answers]
  );

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="h-7 w-7 text-blue-600" />
              Analytics
            </h1>
            <p className="text-gray-600 mt-1">Performance across the exams you own.</p>
          </div>

          {/* Filters sit in one row above the charts, never between them. */}
          <div className="flex flex-wrap gap-2">
            {courses.length > 0 && (
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="All courses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_EXAMS}>All courses</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={examFilter} onValueChange={setExamFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All exams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EXAMS}>All exams</SelectItem>
                {exams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
          </div>
        ) : exams.length === 0 ? (
          <Card>
            <CardContent className="py-14 text-center text-gray-500">
              <BarChart3 className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p>You have not created any exams yet.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Graded submissions" value={summary.submissions} hint={`${summary.students} students`} />
              <StatTile
                label="Pass rate"
                value={percent(summary.passRate)}
                suffix="%"
                tone={summary.passRate === null ? "neutral" : summary.passRate >= 60 ? "good" : "bad"}
              />
              <StatTile label="Average score" value={percent(summary.averagePercentage)} suffix="%" />
              <StatTile
                label="Average GPA"
                value={summary.averageGpa === null ? null : summary.averageGpa.toFixed(2)}
                hint={
                  summary.medianPercentage === null
                    ? undefined
                    : `Median ${summary.medianPercentage.toFixed(1)}%`
                }
              />
            </div>

            {ungraded > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {/* Excluded rather than counted as zero — a submission nobody has
                    marked is not a failure, and treating it as one would drag
                    every average below the truth. */}
                {ungraded} submission{ungraded === 1 ? "" : "s"} not yet graded — excluded from these figures.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Pass / fail ratio"
                description="Against each exam's own pass mark, defaulting to 40%."
              >
                <ProportionBar passed={summary.passed} failed={summary.failed} />
              </ChartCard>

              <ChartCard title="Grade distribution" description="Students per grade band.">
                <BarChart data={summary.gradeDistribution} />
              </ChartCard>
            </div>

            <ChartCard
              title="Performance by exam"
              description="Average score, ranked. The lowest rows are where to look first."
            >
              <RankedBars
                rows={byExam.map((g) => ({
                  key: g.key,
                  label: g.label,
                  sublabel: g.sublabel,
                  value: g.averagePercentage,
                  meta: `${g.passed}/${g.submissions} passed`,
                }))}
              />
            </ChartCard>

            {byBatch.length > 0 && (
              <ChartCard title="Performance by batch" description="Average score across batches you teach.">
                <RankedBars
                  rows={byBatch.map((g) => ({
                    key: g.key,
                    label: g.label,
                    sublabel: g.sublabel,
                    value: g.averagePercentage,
                    meta: `${g.submissions} submissions`,
                  }))}
                />
              </ChartCard>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
