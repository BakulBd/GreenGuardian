"use client";

/**
 * Institution-wide analytics.
 *
 * The admin cut of the same data the teacher dashboard shows, sliced by the
 * three dimensions an administrator manages rather than teaches: course,
 * batch, and teacher. Teacher performance is presented as the outcomes of the
 * exams they own — stated plainly on the card, because a bare "teacher
 * ranking" invites reading a cohort's difficulty as an individual's failing.
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
import { loadAdminAnalytics } from "@/lib/firebase/analytics";
import {
  scoreSubmission,
  summarise,
  summariseBy,
  type ScoredSubmission,
} from "@/lib/analytics/exam-analytics";
import { BarChart, ChartCard, ProportionBar, RankedBars, StatTile } from "@/components/analytics/Charts";
import type { Answer, Exam, User } from "@/lib/types";

const ALL = "__all__";

export default function AdminAnalyticsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState(ALL);
  const [batchFilter, setBatchFilter] = useState(ALL);

  useEffect(() => {
    let active = true;
    loadAdminAnalytics()
      .then((data) => {
        if (!active) return;
        setExams(data.exams);
        setAnswers(data.answers);
        setUsers(data.users);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err?.message || "Could not load analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const examsById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);
  const teacherNames = useMemo(
    () => new Map(users.filter((u) => u.role === "teacher").map((u) => [u.id, u.name])),
    [users]
  );

  const courses = useMemo(() => {
    const seen = new Map<string, string>();
    exams.forEach((e) => e.courseId && seen.set(e.courseId, e.courseName || e.courseId));
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [exams]);

  const batches = useMemo(
    () => Array.from(new Set(exams.map((e) => e.batch).filter(Boolean) as string[])).sort(),
    [exams]
  );

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
        const exam = examsById.get(s.examId);
        if (courseFilter !== ALL && exam?.courseId !== courseFilter) return false;
        if (batchFilter !== ALL && exam?.batch !== batchFilter) return false;
        return true;
      }),
    [scored, courseFilter, batchFilter, examsById]
  );

  const summary = useMemo(() => summarise(filtered), [filtered]);

  const byCourse = useMemo(
    () =>
      summariseBy(filtered, (s) => {
        const exam = examsById.get(s.examId);
        if (!exam?.courseId) return null;
        return { key: exam.courseId, label: exam.courseName || exam.courseId };
      }),
    [filtered, examsById]
  );

  const byBatch = useMemo(
    () =>
      summariseBy(filtered, (s) => {
        const exam = examsById.get(s.examId);
        if (!exam?.batch) return null;
        return { key: exam.batch, label: `Batch ${exam.batch}` };
      }),
    [filtered, examsById]
  );

  const byTeacher = useMemo(
    () =>
      summariseBy(filtered, (s) => {
        const exam = examsById.get(s.examId);
        const teacherId = exam?.teacherId;
        if (!teacherId) return null;
        return {
          key: teacherId,
          label: teacherNames.get(teacherId) || exam?.teacherName || "Unknown teacher",
        };
      }),
    [filtered, examsById, teacherNames]
  );

  return (
    <DashboardLayout role="admin">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="h-7 w-7 text-blue-600" />
              Analytics
            </h1>
            <p className="text-gray-600 mt-1">Course, batch, and teaching outcomes across the platform.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select value={courseFilter} onValueChange={setCourseFilter}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="All courses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All courses</SelectItem>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All batches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All batches</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b} value={b}>
                    Batch {b}
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
        ) : summary.submissions === 0 && exams.length === 0 ? (
          <Card>
            <CardContent className="py-14 text-center text-gray-500">
              <BarChart3 className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p>No exams have been created yet.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Graded submissions" value={summary.submissions} hint={`${summary.students} students`} />
              <StatTile
                label="Pass rate"
                value={summary.passRate === null ? null : summary.passRate.toFixed(1)}
                suffix="%"
                tone={summary.passRate === null ? "neutral" : summary.passRate >= 60 ? "good" : "bad"}
              />
              <StatTile
                label="Average score"
                value={summary.averagePercentage === null ? null : summary.averagePercentage.toFixed(1)}
                suffix="%"
              />
              <StatTile label="Exams" value={exams.length} hint={`${courses.length} courses`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Pass / fail ratio" description="All graded submissions in the current filter.">
                <ProportionBar passed={summary.passed} failed={summary.failed} />
              </ChartCard>
              <ChartCard title="Grade distribution" description="Students per grade band.">
                <BarChart data={summary.gradeDistribution} />
              </ChartCard>
            </div>

            <ChartCard title="Course-wise performance" description="Average score per course.">
              <RankedBars
                rows={byCourse.map((g) => ({
                  key: g.key,
                  label: g.label,
                  value: g.averagePercentage,
                  meta: `${g.passed}/${g.submissions} passed`,
                }))}
                emptyMessage="No exams are linked to a course yet."
              />
            </ChartCard>

            <ChartCard title="Batch-wise performance" description="Average score per batch.">
              <RankedBars
                rows={byBatch.map((g) => ({
                  key: g.key,
                  label: g.label,
                  value: g.averagePercentage,
                  meta: `${g.submissions} submissions`,
                }))}
                emptyMessage="No exams are linked to a batch yet."
              />
            </ChartCard>

            <ChartCard
              title="Teacher performance"
              description="Average score across the exams each teacher owns. Cohort difficulty varies — read alongside the exam-level detail, not on its own."
            >
              <RankedBars
                rows={byTeacher.map((g) => ({
                  key: g.key,
                  label: g.label,
                  value: g.averagePercentage,
                  meta: `${g.submissions} submissions · ${
                    g.passRate === null ? "—" : `${g.passRate.toFixed(0)}% pass`
                  }`,
                }))}
              />
            </ChartCard>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
