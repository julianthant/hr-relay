import { useMemo } from "react";
import type { MockRun } from "../../workflows/mocks/workflow-mock-model.js";
import { mockRunStatus } from "../../workflows/mocks/workflow-mock-model.js";
import { mockRunDisplayId } from "../../workflows/mocks/workflow-queue-model.js";
import { mockWorkflow } from "../../workflows/mocks/workflow-mock-catalog.js";
import { dsStatusOf, statusAccessibleName } from "../../shared/status/status-model.js";
import { runDisplayId } from "../../shared/status/run-display-model.js";
import type { QueueSurfaceWire } from "../../queue/queue-model.js";
import type { NavbarData } from "./navbar-view-model.js";

export function buildWorkspaceSearchData(input: {
  readonly today: string;
  readonly day: string;
  readonly unavailable?: string;
  readonly rows: readonly QueueSurfaceWire[];
  readonly workflowLabel: (workflowId: string) => string;
  readonly mockRuns: readonly MockRun[];
}): NavbarData {
  const { today, day, unavailable, rows, workflowLabel, mockRuns } = input;
  return {
    today,
    counts: {},
    unavailable,
    results: unavailable ? [] : [
      ...rows.map(row => ({ id: String(row.runId), publicId: runDisplayId(row.runId, row.traceId), subject: row.title, workflow: workflowLabel(row.workflowId), day, state: statusAccessibleName(dsStatusOf(row.status)),
        destination: { kind: "run" as const, runId: row.runId, day } })),
      ...mockRuns.map(run => ({ id: run.id, publicId: mockRunDisplayId(run), subject: run.title, workflow: mockWorkflow(run.workflowId).label, day, state: mockRunStatus(run),
        destination: { kind: "preview-run" as const, runId: run.id, day, records: run.workflowId === "ocr" && !run.approved } })),
    ],
  };
}

export function useWorkspaceSearchData(input: Parameters<typeof buildWorkspaceSearchData>[0]): NavbarData {
  const { today, day, unavailable, rows, workflowLabel, mockRuns } = input;
  return useMemo(() => buildWorkspaceSearchData({ today, day, unavailable, rows, workflowLabel, mockRuns }), [today, day, unavailable, rows, workflowLabel, mockRuns]);
}
