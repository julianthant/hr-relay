/** Mock report for the proposed Analytics page (#752): the real workflows with invented counts, shaped like a working office week.
 * Browser-safe. */
import { useMemo } from "react";
import type { ActivityReportHook } from "../../../../src/dashboard/surfaces/activity/activity.js";
import type { ActivityDateRange } from "../../../../src/dashboard/surfaces/activity/activity-model.js";
import { shiftDate, type AnalyticsData } from "../../../../src/dashboard/surfaces/activity/analytics-model.js";
import { activitySample } from "./activity-sample.js";

interface MockWorkflow {
  id: string; label: string; seconds: number | null;
  /** Runs on Monday to Friday. */
  week: readonly [number, number, number, number, number];
  /** Every nth run fails, or waits on the operator; 0 for never. */
  failEvery: number; waitEvery: number;
  failedAt: readonly string[];
}
const WORKFLOWS: readonly MockWorkflow[] = [
  { id: "onboarding", label: "Onboarding", seconds: 139, week: [3, 4, 2, 5, 3], failEvery: 4, waitEvery: 7, failedAt: ["I-9 lookup", "CRM hire data"] },
  { id: "separations", label: "Separations", seconds: 76, week: [2, 3, 3, 2, 4], failEvery: 5, waitEvery: 0, failedAt: ["Kronos timecard", "Kronos sign-in", "Kuali document"] },
  { id: "person-lookup", label: "Person Lookup", seconds: 78, week: [6, 4, 7, 5, 6], failEvery: 14, waitEvery: 0, failedAt: ["CRM sign-in"] },
  { id: "work-study", label: "Work-Study", seconds: 82, week: [1, 0, 2, 0, 1], failEvery: 3, waitEvery: 0, failedAt: ["UCPath sign-in"] },
  { id: "emergency-contact", label: "Emergency Contact", seconds: null, week: [0, 0, 0, 0, 0], failEvery: 0, waitEvery: 0, failedAt: [] },
];
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function mockAnalytics(range: ActivityDateRange): AnalyticsData {
  const days = Array.from({ length: dayNumber(range.to) - dayNumber(range.from) + 1 }, (_, index) => shiftDate(range.from, index));
  const workflows = WORKFLOWS.map(workflow => {
    const steps = new Map<string, number>();
    const rows = days.map(date => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(), count = weekday === 0 || weekday === 6 ? 0 : workflow.week[weekday - 1] ?? 0;
      let failed = 0, attention = 0;
      for (let run = 0; run < count; run++) {
        const serial = dayNumber(date) * 7 + run;
        if (workflow.failEvery > 0 && serial % workflow.failEvery === 0) {
          failed++;
          // Earlier steps are the common ones.
          const pick = serial % 3 === 0 ? 1 : serial % 7 === 0 ? 2 : 0;
          const step = workflow.failedAt[Math.min(pick, workflow.failedAt.length - 1)];
          if (step !== undefined) steps.set(step, (steps.get(step) ?? 0) + 1);
        } else if (workflow.waitEvery > 0 && serial % workflow.waitEvery === 0) attention++;
      }
      return { date, done: count - failed - attention, failed, attention, seconds: count - failed - attention > 0 ? workflow.seconds : null };
    });
    return { id: workflow.id, label: workflow.label, done: rows.reduce((n, row) => n + row.done, 0), failed: rows.reduce((n, row) => n + row.failed, 0), attention: rows.reduce((n, row) => n + row.attention, 0),
      typicalSeconds: workflow.seconds, failedAt: [...steps].map(([label, runs]) => ({ label, runs })).sort((a, b) => b.runs - a.runs), days: rows };
  });
  return { running: 2, typicalSeconds: 96, workflows,
    assistant: { messages: days.map((date, index) => ({ date, count: (index * 3) % 7 })), actions: days.map((date, index) => ({ date, proposed: index % 3 })) } };
}

/** The sample report's run lists under the mock figures, so a run link still opens the page's own drilldown. */
export function analyticsRedesignMockReport(): ActivityReportHook {
  return (_client, range) => {
    const data = useMemo(() => { const base = activitySample(range, "normal"); return base.state === "loaded" ? { ...base, report: { ...base.report, analytics: mockAnalytics(range) } } : base; }, [range]);
    return useMemo(() => ({ data, pending: false, exportReady: true, notice: "", exportCsv: () => Promise.reject(new Error("The mock has no export.")) }), [data]);
  };
}
