import { useCallback, useMemo } from "react";
import type { DashboardDayWire, QueueBusinessOutcome, QueueMemberSelection } from "../../models/dashboard/projection.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import { filterQueueSurfaces, lookupBatchId, queueItemKey, type QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import type { QueueHandlers, QueueViewState } from "../surfaces/queue/queue.js";
import type { StatusBucket } from "../surfaces/shell/shell-model.js";

export function useQueueWiring(input: Readonly<{
  allRows: readonly QueueSurfaceWire[] | undefined;
  attemptHistory?: DashboardDayWire["attemptHistory"];
  rows: readonly QueueSurfaceWire[];
  activeWorkflowId: string;
  filter: readonly StatusBucket[];
  selectedRunId: string | undefined;
  selectedMember?: QueueMemberSelection;
  openMember?: QueueHandlers["onOpenMember"];
  openWells: ReadonlySet<string>;
  nowIso: string;
  selectRun: (runId: string, partitionDay?: string) => void;
  openRelatedRun: NonNullable<QueueHandlers["onOpenLinked"]>;
  onWells: (next: ReadonlySet<string>) => void;
  setBatchGrouping: NonNullable<QueueHandlers["onSetBatchGrouping"]>;
  runQueueAction: NonNullable<QueueHandlers["onAction"]>;
  renameTitle?: QueueHandlers["onRenameTitle"];
}>) {
  const { allRows, attemptHistory, rows, activeWorkflowId, filter, selectedRunId, openWells, nowIso,
    selectRun, openRelatedRun, selectedMember, openMember, onWells, setBatchGrouping,
    runQueueAction, renameTitle } = input;
  const surfaces = useMemo((): readonly QueueSurfaceWire[] => {
    if (allRows === undefined) return [];
    const metadata = attemptHistory === undefined ? undefined : new Map(attemptHistory.map(entry => [entry.runId, entry]));
    const canonical = new Map(allRows.map(surface => [surface.runId, surface]));
    const visible = rows.flatMap(row => {
      const surface = canonical.get(row.runId);
      return surface === undefined ? [] : [surface];
    });
    const batches = new Set(visible.map(lookupBatchId).filter(id => id !== undefined));
    const inBatch = (surface: QueueSurfaceWire): boolean => {
      const id = lookupBatchId(surface);
      return id !== undefined && batches.has(id);
    };
    const items = new Set(visible.map(queueItemKey));
    const visibleIds = new Set(visible.map(surface => surface.runId));
    const candidates = metadata === undefined && batches.size === 0 ? [...visible, ...allRows.filter(surface => !visibleIds.has(surface.runId))] : allRows;
    const roots = metadata === undefined ? candidates.filter(surface => visibleIds.has(surface.runId) || inBatch(surface))
      : candidates.filter(surface => items.has(queueItemKey(surface)) || inBatch(surface));
    const included = new Set(roots.filter(surface => surface.workflowId === activeWorkflowId).map(surface => String(surface.runId)));
    let changed = true;
    while (changed) {
      changed = false;
      for (const surface of candidates) {
        if (metadata === undefined && surface.workflowId === activeWorkflowId && !visibleIds.has(surface.runId) && !inBatch(surface)) continue;
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
      ...(selectedMember === undefined ? {} : { selectedMember }),
      openWells,
      panelWorkflowId: activeWorkflowId,
      nowIso,
    }),
    [selectedRunId, selectedMember, openWells, activeWorkflowId, nowIso],
  );

  const queueHandlers = useMemo(
    (): QueueHandlers => ({
      onSetBatchGrouping: setBatchGrouping,
      onSelect: runId => selectRun(runId),
      ...(openMember === undefined ? {} : { onOpenMember: openMember }),
      onAction: runQueueAction,
      onToggleWell: (runId) => {
        const next = new Set(openWells);
        if (next.has(runId)) next.delete(runId);
        else next.add(runId);
        onWells(next);
      },
      onOpenParent: openRelatedRun,
      onOpenLinked: openRelatedRun,
      ...(renameTitle === undefined ? {} : { onRenameTitle: renameTitle }),
    }),
    [setBatchGrouping, selectRun, runQueueAction, openWells, onWells, openRelatedRun, openMember, renameTitle],
  );

  const actionsOf = useCallback((surface: QueueSurfaceWire): readonly ActionDescriptorWire[] => surface.actions, []);
  return { surfaces, outcomes, viewState, queueHandlers, actionsOf };
}
