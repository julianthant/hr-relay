import { useCallback, useMemo } from "react";
import type { DashboardDayWire, QueueBusinessOutcome } from "../../models/dashboard/projection.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import { filterQueueSurfaces, type QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import type { QueueHandlers, QueueViewState } from "../surfaces/queue/queue.js";
import type { StatusBucket } from "../surfaces/shell/shell-model.js";
import { dsStatusOf } from "../surfaces/shared/status/status-model.js";

export function useQueueWiring(input: Readonly<{
  allRows: readonly QueueSurfaceWire[] | undefined;
  attemptHistory?: DashboardDayWire["attemptHistory"];
  rows: readonly QueueSurfaceWire[];
  activeWorkflowId: string;
  filter: readonly StatusBucket[];
  selectedRunId: string | undefined;
  openWells: ReadonlySet<string>;
  selectMode: boolean;
  bulkIds: ReadonlySet<string>;
  nowIso: string;
  workflowLabelOf: (workflowId: string) => string;
  selectRun: (runId: string, partitionDay?: string) => void;
  setActiveWorkflowId: (workflowId: string) => boolean;
  onWells: (next: ReadonlySet<string>) => void;
  onBulkIds: (next: ReadonlySet<string>) => void;
  setBatchGrouping: NonNullable<QueueHandlers["onSetBatchGrouping"]>;
  exitQueueSelection: () => void;
  runQueueAction: NonNullable<QueueHandlers["onAction"]>;
}>) {
  const { allRows, attemptHistory, rows, activeWorkflowId, filter, selectedRunId, openWells, selectMode, bulkIds, nowIso,
    workflowLabelOf, selectRun, setActiveWorkflowId, onWells, onBulkIds, setBatchGrouping, exitQueueSelection,
    runQueueAction } = input;
  const surfaces = useMemo((): readonly QueueSurfaceWire[] => {
    if (allRows === undefined) return [];
    const metadata = attemptHistory === undefined ? undefined : new Map(attemptHistory.map(entry => [entry.runId, entry]));
    const canonical = new Map(allRows.map(surface => [surface.runId, surface]));
    const visible = rows.flatMap(row => {
      const surface = canonical.get(row.runId);
      return surface === undefined ? [] : [surface];
    });
    const items = new Set(visible.map(row => JSON.stringify([row.workflowId, row.itemId])));
    const candidates = metadata === undefined ? visible : allRows;
    const scoped = candidates.flatMap((surface) => {
      if (!items.has(JSON.stringify([surface.workflowId, surface.itemId])) || surface.workflowId !== activeWorkflowId) return [];
      const timing = metadata?.get(surface.runId);
      if (metadata !== undefined && timing === undefined) throw new Error("queue run has no selected-day attempt metadata");
      const actions = surface.actions.filter((action) => action.kind !== "command" || action.command !== "archive");
      if (timing === undefined && actions.length === surface.actions.length) return [surface];
      return [{ ...surface, ...(timing === undefined ? {} : { startedAt: timing.startedAt, endedAt: timing.endedAt }), actions }];
    });
    return filterQueueSurfaces(scoped, filter);
  }, [allRows, attemptHistory, rows, activeWorkflowId, filter]);

  const outcomes = useMemo((): ReadonlyMap<string, QueueBusinessOutcome> => new Map(
    surfaces.flatMap(surface => surface.outcome === undefined ? [] : [[surface.runId, surface.outcome] as const]),
  ), [surfaces]);

  const parentOf = useCallback(
    (parentRunId: string) => {
      const parent = allRows?.find((surface) => String(surface.runId) === parentRunId);
      return parent === undefined
        ? undefined
        : {
          runId: String(parent.runId),
          title: parent.title,
          workflowLabel: workflowLabelOf(String(parent.workflowId)),
          status: dsStatusOf(parent.status),
        };
    },
    [allRows, workflowLabelOf],
  );

  const viewState = useMemo(
    (): QueueViewState => ({
      ...(selectedRunId === undefined ? {} : { selectedRunId }),
      openWells,
      selectMode,
      bulkIds,
      panelWorkflowId: activeWorkflowId,
      nowIso,
    }),
    [selectedRunId, openWells, selectMode, bulkIds, activeWorkflowId, nowIso],
  );

  const queueHandlers = useMemo(
    (): QueueHandlers => ({
      onSetBatchGrouping: setBatchGrouping,
      onSelect: runId => selectRun(runId),
      onExitSelection: exitQueueSelection,
      onAction: runQueueAction,
      onToggleWell: (runId) => {
        const next = new Set(openWells);
        if (next.has(runId)) next.delete(runId);
        else next.add(runId);
        onWells(next);
      },
      onToggleBulk: (runId) => {
        const next = new Set(bulkIds);
        if (next.has(runId)) next.delete(runId);
        else next.add(runId);
        onBulkIds(next);
      },
      /* Cross-workflow parent jumps switch scope before selecting the run. */
      onOpenParent: (runId) => {
        const parent = allRows?.find((s) => String(s.runId) === runId);
        if (parent !== undefined && !setActiveWorkflowId(String(parent.workflowId))) return;
        selectRun(runId);
      },
      /* Use the served child route; current-day lookup cannot find cross-day delegation. */
      onOpenLinked: (link) => {
        if (!setActiveWorkflowId(String(link.workflowId))) return;
        selectRun(String(link.runId), link.partitionDay);
      },
    }),
    [setBatchGrouping, selectRun, runQueueAction, openWells, onWells, bulkIds, onBulkIds, allRows, setActiveWorkflowId, exitQueueSelection],
  );

  const actionsOf = useCallback((surface: QueueSurfaceWire): readonly ActionDescriptorWire[] => surface.actions, []);
  return { surfaces, outcomes, parentOf, viewState, queueHandlers, actionsOf };
}
