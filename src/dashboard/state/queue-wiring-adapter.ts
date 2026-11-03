import { useCallback, useMemo } from "react";
import type { DashboardDayWire, QueueBusinessOutcome } from "../../models/dashboard/projection.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import { filterQueueSurfaces, type QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import type { QueueHandlers, QueueViewState } from "../surfaces/queue/queue.js";
import type { StatusBucket } from "../surfaces/shell/shell-model.js";

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
  selectRun: (runId: string, partitionDay?: string) => void;
  setActiveWorkflowId: (workflowId: string) => boolean;
  onWells: (next: ReadonlySet<string>) => void;
  onBulkIds: (next: ReadonlySet<string>) => void;
  setBatchGrouping: NonNullable<QueueHandlers["onSetBatchGrouping"]>;
  exitQueueSelection: () => void;
  runQueueAction: NonNullable<QueueHandlers["onAction"]>;
}>) {
  const { allRows, attemptHistory, rows, activeWorkflowId, filter, selectedRunId, openWells, selectMode, bulkIds, nowIso,
    selectRun, setActiveWorkflowId, onWells, onBulkIds, setBatchGrouping, exitQueueSelection,
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
    const visibleIds = new Set(visible.map(surface => surface.runId));
    const candidates = metadata === undefined ? [...visible, ...allRows.filter(surface => !visibleIds.has(surface.runId))] : allRows;
    const roots = metadata === undefined ? visible : candidates.filter(surface => items.has(JSON.stringify([surface.workflowId, surface.itemId])));
    const included = new Set(roots.filter(surface => surface.workflowId === activeWorkflowId).map(surface => String(surface.runId)));
    let changed = true;
    while (changed) {
      changed = false;
      for (const surface of candidates) {
        if (metadata === undefined && surface.workflowId === activeWorkflowId && !visibleIds.has(surface.runId)) continue;
        if (surface.parent === null || surface.parent.visibility === "linked" || !included.has(surface.parent.runId) || included.has(surface.runId)) continue;
        included.add(surface.runId);
        changed = true;
      }
    }
    const scoped = candidates.flatMap((surface) => {
      if (!included.has(surface.runId)) return [];
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
      onOpenParent: (parent) => {
        if (!setActiveWorkflowId(String(parent.workflowId))) return;
        selectRun(String(parent.runId), parent.partitionDay);
      },
      /* Use the served child route; current-day lookup cannot find cross-day delegation. */
      onOpenLinked: (link) => {
        if (!setActiveWorkflowId(String(link.workflowId))) return;
        selectRun(String(link.runId), link.partitionDay);
      },
    }),
    [setBatchGrouping, selectRun, runQueueAction, openWells, onWells, bulkIds, onBulkIds, setActiveWorkflowId, exitQueueSelection],
  );

  const actionsOf = useCallback((surface: QueueSurfaceWire): readonly ActionDescriptorWire[] => surface.actions, []);
  return { surfaces, outcomes, viewState, queueHandlers, actionsOf };
}
