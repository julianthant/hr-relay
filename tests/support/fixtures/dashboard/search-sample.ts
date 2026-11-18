import { useMemo } from "react";
import { dsStatusOf, statusAccessibleName } from "../../../../src/dashboard/surfaces/shared/status/status-model.js";
import { runDisplayId } from "../../../../src/dashboard/surfaces/shared/status/run-display-model.js";
import type { QueueSurfaceWire } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import type { NavbarData } from "../../../../src/dashboard/surfaces/shell/search/navbar-view-model.js";

export function buildWorkspaceSearchData(input: {
  readonly today: string;
  readonly day: string;
  readonly unavailable?: string;
  readonly rows: readonly QueueSurfaceWire[];
  readonly workflowLabel: (workflowId: string) => string;
}): NavbarData {
  const { today, day, unavailable, rows, workflowLabel } = input;
  return {
    today,
    counts: {},
    unavailable,
    results: unavailable ? [] : [
      ...rows.map(row => ({ id: String(row.runId), publicId: runDisplayId(row.runId, row.traceId), subject: row.title, workflow: workflowLabel(row.workflowId), day, state: statusAccessibleName(dsStatusOf(row.status)),
        destination: { kind: "run" as const, runId: row.runId, day } })),
    ],
  };
}

export function useWorkspaceSearchData(input: Parameters<typeof buildWorkspaceSearchData>[0]): NavbarData {
  const { today, day, unavailable, rows, workflowLabel } = input;
  return useMemo(() => buildWorkspaceSearchData({ today, day, unavailable, rows, workflowLabel }), [today, day, unavailable, rows, workflowLabel]);
}
