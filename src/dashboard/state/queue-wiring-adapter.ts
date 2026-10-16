import { useCallback, useMemo } from "react";
import type { QueueBusinessOutcome } from "../../models/dashboard/projection.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import { filterQueueSurfaces, type QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import type { QueueHandlers, QueueViewState } from "../surfaces/queue/queue.js";
import type { StatusBucket } from "../surfaces/shell/shell-model.js";
import { dsStatusOf } from "../surfaces/shared/status/status-model.js";

export function useQueueWiring(input: Readonly<{
  allRows: readonly QueueSurfaceWire[] | undefined;
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
  const { allRows, rows, activeWorkflowId, filter, selectedRunId, openWells, selectMode, bulkIds, nowIso,
    workflowLabelOf, selectRun, setActiveWorkflowId, onWells, onBulkIds, setBatchGrouping, exitQueueSelection,
    runQueueAction } = input;
  const surfaces = useMemo((): readonly QueueSurfaceWire[] => {
    if (allRows === undefined) return [];
    const canonical = new Map(allRows.map((surface) => [surface.runId, surface]));
    const scoped = rows.flatMap((row) => {
      const surface = canonical.get(row.runId);
      if (surface === undefined || surface.workflowId !== activeWorkflowId) return [];
      const actions = surface.actions.filter((action) => action.kind !== "command" || action.command !== "archive");
      return [actions.length === surface.actions.length ? surface : { ...surface, actions }];
    });
    return filterQueueSurfaces(scoped, filter);
  }, [allRows, rows, activeWorkflowId, filter]);

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
      onSelect: selectRun,
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
