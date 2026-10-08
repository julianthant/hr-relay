import { fmtActionClock, fmtElapsed } from "../../shared/status/format.js";
import type { LogStep } from "./log-feed-model.js";
import { queueRowTitle, type QueueSurfaceWire } from "../../queue/queue-model.js";
import { PROPOSED_STATUS, dsStatusOf } from "../../shared/status/status-model.js";
import type { LogTimelineStage, LogTimelineState } from "./log-timeline-model.js";
import { selectedLogMock } from "./log-selected-fixture.js";

export type LogSelection = Readonly<{ row: QueueSurfaceWire; workflowLabel: string }>;
export const selectedLogSample = selectedLogMock;
const PIPELINE_STATE: Record<QueueSurfaceWire["pipeline"][number]["state"], LogTimelineState> = {
  done: "completed", active: "active", blocked: "waiting", failed: "failed", pending: "pending", skipped: "skipped", cancelled: "cancelled",
};

/** Queue facts provide selection context, never invented browser action history. */
export function selectedLogPresentation({ row }: LogSelection) {
  const status = PROPOSED_STATUS[dsStatusOf(row.status)].label;
  const time = fmtActionClock(row.updatedAt);
  const current = row.pipeline.find(node => ["active", "blocked", "failed"].includes(node.state));
  const steps: readonly LogStep[] = [{ id: "queue-state", time, title: "Run status", entries: [{ kind: "fields", id: "queue-fields", fields: [
    { id: "subject", time, kind: "read", label: "Subject", value: queueRowTitle(row) },
    { id: "state", time, kind: "read", label: "Status", value: status },
    { id: "attempt", time, kind: "read", label: "Attempt", value: `#${row.attempt}` },
  ] }] }, ...(row.liveMessage.state === "present" ? [{ id: current?.id ?? "current-message", time, title: current?.label ?? "Current action", entries: [{ kind: "note" as const, id: "current-message", time, message: row.liveMessage.value }] }] : [])];
  const timeline: readonly LogTimelineStage[] = row.pipeline.map(node => ({
    id: node.id, label: node.label, state: PIPELINE_STATE[node.state],
    ...(row.liveMessage.state === "present" && node.id === current?.id ? { stepId: node.id } : {}),
    ...(node.durationSec === undefined ? {} : { durationLabel: fmtElapsed(node.durationSec) }),
    substeps: [],
  }));
  return { title: queueRowTitle(row), status, steps, timeline };
}
