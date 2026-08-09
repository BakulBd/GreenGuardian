"use client";

/**
 * Chart primitives for the teacher and admin analytics dashboards.
 *
 * Inline SVG and CSS only — no charting dependency. Every chart here plots at
 * most two series, so identity never rests on colour alone: the single-series
 * forms name their measure in the title and label the axis, and the two-part
 * proportion bar direct-labels both segments.
 *
 * Palette (validated against a white chart surface with the data-viz
 * validator — lightness band, chroma floor, CVD separation, normal-vision
 * floor, and 3:1 contrast all pass):
 *
 *   value / "Passed"  #2a78d6  blue
 *   "Failed"          #d03b3b  red
 *
 * Blue↔red is the documented diverging pair: warm/cool poles that read as
 * opposites, and — unlike the obvious green/red — they stay separable under
 * deuteranopia (ΔE 23.8 vs 4.1).
 *
 * Text uses the app's own ink tokens rather than the series colour, so a
 * number never inherits the meaning of a mark.
 */

import { ReactNode } from "react";

export const CHART_COLORS = {
  value: "#2a78d6",
  pass: "#2a78d6",
  fail: "#d03b3b",
  grid: "#e5e7eb",
  axis: "#d1d5db",
} as const;

export function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-700" : "text-gray-900";
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${toneClass}`}>
        {value === null || value === "" ? "—" : value}
        {value !== null && value !== "" && suffix ? (
          <span className="text-base font-semibold text-gray-400 ml-0.5">{suffix}</span>
        ) : null}
      </p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Vertical bar chart for a single measure across ordered categories
 * (grade distribution, score bands).
 *
 * Bars are anchored to the baseline with rounded tops only, and a 2px gap
 * separates neighbours so adjacent bars never appear to merge. Counts sit
 * above the bar rather than inside it, where a short bar would clip them.
 */
export function BarChart({
  data,
  height = 200,
  valueLabel = "Students",
  emptyMessage = "No graded submissions yet.",
}: {
  data: { label: string; count: number }[];
  height?: number;
  valueLabel?: string;
  emptyMessage?: string;
}) {
  const max = Math.max(...data.map((d) => d.count), 0);
  if (max === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">{emptyMessage}</p>;
  }

  // Four gridlines including the baseline, at whole numbers so a count axis
  // never reads "2.5 students".
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * 4;
  const ticks = [0, step, step * 2, step * 3, top];

  return (
    <figure className="w-full">
      <div className="flex gap-2">
        {/* Y axis */}
        <div
          className="flex flex-col justify-between text-[10px] text-gray-400 tabular-nums text-right pr-1 shrink-0"
          style={{ height }}
          aria-hidden="true"
        >
          {[...ticks].reverse().map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          <div className="relative" style={{ height }}>
            {/* Recessive gridlines behind the marks. */}
            <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
              {ticks.map((t) => (
                <div key={t} className="border-t" style={{ borderColor: CHART_COLORS.grid }} />
              ))}
            </div>

            <div className="absolute inset-0 flex items-end gap-[2px]">
              {data.map((d) => (
                <div key={d.label} className="flex-1 flex flex-col justify-end items-center h-full group">
                  {d.count > 0 && (
                    <span className="text-[10px] font-semibold text-gray-600 tabular-nums mb-0.5">
                      {d.count}
                    </span>
                  )}
                  <div
                    className="w-full rounded-t transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${(d.count / top) * 100}%`,
                      backgroundColor: CHART_COLORS.value,
                      minHeight: d.count > 0 ? 2 : 0,
                    }}
                    title={`${d.label}: ${d.count} ${valueLabel.toLowerCase()}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-[2px] border-t pt-1" style={{ borderColor: CHART_COLORS.axis }}>
            {data.map((d) => (
              <span key={d.label} className="flex-1 text-center text-[10px] font-medium text-gray-500">
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        {valueLabel} by {data.map((d) => `${d.label}: ${d.count}`).join(", ")}
      </figcaption>
    </figure>
  );
}

/**
 * Two-part proportion of a whole (pass vs fail).
 *
 * Both segments carry a visible label, so the split is legible without relying
 * on the colours at all.
 */
export function ProportionBar({
  passed,
  failed,
}: {
  passed: number;
  failed: number;
}) {
  const total = passed + failed;
  if (total === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">No graded submissions yet.</p>;
  }
  const passPct = (passed / total) * 100;

  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-lg gap-[2px]" role="img"
           aria-label={`${passed} passed, ${failed} failed out of ${total}`}>
        {passed > 0 && (
          <div
            className="flex items-center justify-center text-xs font-semibold text-white"
            style={{ width: `${passPct}%`, backgroundColor: CHART_COLORS.pass }}
          >
            {passPct >= 14 ? `${Math.round(passPct)}%` : ""}
          </div>
        )}
        {failed > 0 && (
          <div
            className="flex items-center justify-center text-xs font-semibold text-white"
            style={{ width: `${100 - passPct}%`, backgroundColor: CHART_COLORS.fail }}
          >
            {100 - passPct >= 14 ? `${Math.round(100 - passPct)}%` : ""}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART_COLORS.pass }} />
          <span className="text-gray-600">Passed</span>
          <span className="font-semibold text-gray-900 tabular-nums">{passed}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART_COLORS.fail }} />
          <span className="text-gray-600">Failed</span>
          <span className="font-semibold text-gray-900 tabular-nums">{failed}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Ranked horizontal bars — one row per group (exam, course, batch, teacher).
 *
 * Horizontal because the labels are names of arbitrary length; rotating them
 * under a vertical axis is the classic way to make a chart unreadable.
 */
export function RankedBars({
  rows,
  emptyMessage = "Nothing to compare yet.",
}: {
  rows: { key: string; label: string; sublabel?: string; value: number | null; meta?: string }[];
  emptyMessage?: string;
}) {
  const withValues = rows.filter((r) => r.value !== null);
  if (withValues.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-3">
      {withValues.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-900 truncate">{row.label}</span>
              {row.sublabel && <span className="text-xs text-gray-500 ml-2">{row.sublabel}</span>}
            </div>
            <div className="shrink-0 text-right">
              <span className="text-sm font-semibold text-gray-900 tabular-nums">
                {row.value!.toFixed(1)}%
              </span>
              {row.meta && <span className="text-xs text-gray-500 ml-2">{row.meta}</span>}
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(1, row.value!)}%`, backgroundColor: CHART_COLORS.value }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
