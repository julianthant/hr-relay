import { nodeIdOfTaskSpanPath } from "../../../runs/support.js";
import { readRerunValues } from "../../../runs/start/rerun-values.js";
import { createDataQueries } from "../../../runs/dashboard/queries/data.js";
import type { RunDetailQueryDeps } from "../../../runs/dashboard/queries/run-detail-types.js";

/** Each composition supplies its own explicit query backing. */
export function composeDataQueries(deps: RunDetailQueryDeps) {
  // Archived Context reads may reach queries/data; only the live composition
  // imports the descriptor runtime needed by the new source-value reader.
  return {
    ...createDataQueries(deps),
    rerunValues: (request: unknown) => {
      if (deps.canonical === undefined) throw new Error("RERUN_VALUES_NOT_CONFIGURED");
      return readRerunValues({ ...deps.canonical, executions: (runId) => {
        const row = deps.projection.runFold(runId);
        if (row === undefined) return [];
        if (row.queued.runId !== runId) throw new Error("RERUN_VALUES_EVIDENCE_MISMATCH");
        return row.taskSpans.flatMap((span) => {
          const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
          if (nodeId === undefined) return [];
          return [{ nodeId, attempt: span.attempt, ...(span.startedAt === undefined ? {} : { startedAt: span.startedAt }),
            ...(span.endedAt === undefined ? {} : { endedAt: span.endedAt }),
            ...(span.outcome === undefined ? {} : { outcome: span.outcome }) }];
        });
      } }, request);
    },
  };
}
