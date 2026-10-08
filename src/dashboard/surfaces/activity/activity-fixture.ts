import { successfulWorkflowTimings } from "./activity-timing-model.js";
import { ActivityVolumeSchema, buildActivityVolumeBoundarySkeleton } from "../../../models/dashboard/activity-volume.js";
import type { ActivityDateRange } from "./activity-model.js";
import type { ActivityViewState } from "./activity-view-model.js";
import type { ActivityRunRecord } from './activity-drilldown-model.js';
import { runDisplayId, workflowDisplayCode } from '../shared/status/run-display-model.js';

export const ACTIVITY_SAMPLE_TODAY = "2026-09-26";
export const ACTIVITY_SAMPLE_RANGE: ActivityDateRange = { from: "2026-09-20", to: ACTIVITY_SAMPLE_TODAY };
export const ACTIVITY_SAMPLE_STATES = [
  { id: "normal", label: "Full report" }, { id: "empty", label: "Empty period" },
  { id: "incomplete", label: "Missing evidence" }, { id: "loading", label: "Loading" },
  { id: "unavailable", label: "Unavailable" },
] as const;
export type ActivitySampleState = typeof ACTIVITY_SAMPLE_STATES[number]["id"];

// Synthetic records exist only in the temporary producer. Views receive the same summary contract later.
const records = [5, 8, 7, 6, 9, 9].flatMap((count, day) => Array.from({ length: count }, (_, index) => ({
  day: `2026-09-${21 + day}`,
  instant: `2026-09-${21 + day}T${String(16 + index % 6).padStart(2, "0")}:00:00.000Z`,
}))).map((record, index) => ({
  ...record,
  id: `activity-sample-${index}`,
  parentRunId: null,
  workflow: index < 29 ? "sample-separations" : "sample-person-lookup",
  status: index < 24 || index >= 29 && index < 43 ? "completed" : index === 28 ? "waiting" : index === 24 || index === 25 ? "failed" : "running",
  duration: index < 39 ? index === 0 ? 281 : index === 1 ? 74 : 134 : null,
  readback: index < 21 || index >= 29,
  ucpath: index < 18,
  kuali: index < 17,
}));

function sampleRun(row: typeof records[number], incomplete: boolean): ActivityRunRecord {
  const index = records.indexOf(row);
  const subject = ['Jordan Lee', 'Casey Rivera', 'Taylor Park', 'Alex Morgan', 'Morgan Chen', 'Nguyen, Thi'][index % 6];
  const workflowLabel = row.workflow === 'sample-separations' ? 'Separations' : 'Person lookup';
  const status = row.status as ActivityRunRecord['status'];
  const time = new Date(row.instant).toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles' });
  const finalTime = row.duration === null ? time : new Date(Date.parse(row.instant) + row.duration * 1000).toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles' });
  const steps: ActivityRunRecord['steps'] = [
    { id: `${row.id}:input`, time, title: 'Run input', entries: [{ kind: 'fields', id: `${row.id}:subject`, fields: [
      { id: `${row.id}:name`, time, kind: 'read', label: 'Employee', value: subject },
      { id: `${row.id}:workflow`, time, kind: 'read', label: 'Workflow', value: workflowLabel },
    ] }] },
    { id: `${row.id}:outcome`, time: finalTime, title: status === 'completed' ? 'Run completed' : status === 'failed' ? 'Document read failed' : status === 'waiting' ? 'Review employee match' : 'Read employee record',
      entries: status === 'failed' || status === 'waiting' ? [{ kind: 'decision', id: `${row.id}:decision`, time: finalTime,
        decision: status === 'failed' ? { state: 'failed', title: 'Document read failed', message: 'The document read timed out.', footer: 'No final submission was started.' }
          : { state: 'review', title: 'Review employee match', message: `Confirm the employee match for ${subject}.` } }]
        : [{ kind: 'note', id: `${row.id}:result`, time: finalTime, message: status === 'completed' ? `${workflowLabel} completed for ${subject}.` : `Reading the employee record for ${subject}.`, tone: status === 'completed' ? 'positive' : 'info' }] },
  ];
  return { id: row.id, displayId: runDisplayId(row.id, workflowDisplayCode(workflowLabel)), subject, day: row.day, workflowId: row.workflow,
    workflowLabel, status, seconds: incomplete ? null : row.duration, readback: incomplete ? null : row.readback, attempt: 1, steps,
    timeline: steps.map((step, position) => ({ id: step.id, stepId: step.id, label: step.title,
      state: position === 0 || status === 'completed' ? 'completed' : status === 'waiting' ? 'waiting' : status === 'failed' ? 'failed' : 'active', substeps: [] })) };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] ?? null : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export function activitySample(range: ActivityDateRange, scenario: ActivitySampleState): ActivityViewState {
  if (scenario === "loading") return { state: "loading" };
  if (scenario === "unavailable") return { state: "unavailable", reason: "The report is unavailable. Try another period or return later." };
  const rows = scenario === "empty" ? [] : records.filter(row => row.day >= range.from && row.day <= range.to);
  const successfulTimings = successfulWorkflowTimings(rows.map(row => ({
    id: row.id, workflowId: row.workflow, parentRunId: row.parentRunId,
    status: row.status as 'completed' | 'failed' | 'running' | 'waiting', seconds: scenario === 'incomplete' ? null : row.duration,
  })));
  const count = (status: string) => rows.filter(row => row.status === status).length;
  const completed = count("completed");
  const failed = count("failed");
  const terminal = rows.filter(row => row.status === "completed" || row.status === "failed");
  // Duration tiles use the successful population, like the workflow averages.
  const successful = rows.filter(row => row.status === "completed");
  const measured = scenario === "incomplete" ? [] : successful.flatMap(row => row.duration === null ? [] : [row.duration]);
  const skeleton = buildActivityVolumeBoundarySkeleton(range, "America/Los_Angeles");
  const volume = ActivityVolumeSchema.parse({ state: "complete", ...skeleton, coveredRuns: rows.length,
    buckets: skeleton.buckets.map(bucket => ({ ...bucket, runs: rows.filter(row => row.instant >= bucket.start && row.instant < bucket.endExclusive).length })),
  });
  return { state: "loaded", report: {
    runs: rows.map(row => sampleRun(row, scenario === 'incomplete')),
    range, timeZone: volume.timeZone, total: rows.length, completed, failed,
    running: count("running"), waiting: count("waiting"), outstanding: count("running") + count("waiting"), terminal: terminal.length,
    duration: { medianSeconds: median(measured), longestSeconds: measured.length ? Math.max(...measured) : null,
      totalSeconds: measured.length ? measured.reduce((total, seconds) => total + seconds, 0) : successful.length ? null : 0,
      measured: measured.length, unmeasured: successful.length - measured.length },
    failures: scenario === "incomplete" ? null : failed ? [{ label: "Document read timeout", runs: failed }] : [],
    evidence: scenario === "incomplete" ? { verified: null, unread: null } : { verified: rows.filter(row => row.status === "completed" && row.readback).length, unread: rows.filter(row => row.status === "completed" && !row.readback).length },
    workflows: [
      { id: "sample-separations", label: "Separations", version: "2.1" },
      { id: "sample-person-lookup", label: "Person lookup", version: "2.0" },
    ].flatMap(workflow => {
      const group = rows.filter(row => row.workflow === workflow.id);
      return group.length ? [{ ...workflow, total: group.length, completed: group.filter(row => row.status === "completed").length,
        successfulTiming: successfulTimings.get(workflow.id) ?? { totalSeconds: 0, measured: 0, unmeasured: 0 },
        failed: group.filter(row => row.status === "failed").length, outstanding: group.filter(row => row.status === "running" || row.status === "waiting").length }] : [];
    }),
    transactions: [
      { id: "sample-ucpath", label: "UCPath terminations", count: rows.filter(row => row.ucpath).length, environment: "test" },
      { id: "sample-kuali", label: "Kuali finalizations", count: rows.filter(row => row.kuali).length, environment: "test" },
    ], ...(scenario === "incomplete" ? {} : { volume }),
  } };
}
