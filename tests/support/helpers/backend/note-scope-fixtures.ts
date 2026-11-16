







import { type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";


import { claimEventOf, instantOffsetOf, queuedEventOf, runEndedEventOf, runRecordOf, traceOf, uuidOf, type DashboardWorld } from "./dashboard-harness.js";
import { personLookupDescriptor } from "../registered-workflows.js";

export function terminalDone(w: DashboardWorld, seed: number, over: Record<string, unknown> = {}): void {
  queuedEventOf(w, { seed, ...over });
  claimEventOf(w, seed);
  runEndedEventOf(w, seed, "done");
  w.authority.put(runRecordOf({
    seed,
    ...over,
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 60_000) },
    claimGeneration: 1,
    version: 3,
  }));
}

export function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return { timeline: w.timeline, runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => personLookupDescriptor },
    };
  }

export function observedDepsOf(
    w: DashboardWorld,
    dataOrigins: readonly Readonly<{
      nodeId: string;
      step: string;
      taskId: string;
      system?: string;
      operatorFields?: import("../../../../src/backend/runs/queries/run-detail-types.js").RunDetailDataOriginView["operatorFields"];
    }>[],
  ): RunDetailQueryDeps {
    return { timeline: w.timeline, runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: {
        resolve: () => ({
          dataOrigins: dataOrigins.map((origin) => ({ ...origin, dir: "read" as const, feeds: [] })),
        }),
      },
    };
  }

export function observedEvent(
    w: DashboardWorld,
    input: Readonly<{
      seed?: number;
      attempt?: number;
      at?: string;
      nodeId?: string;
      taskId?: string;
      workflow?: string;
      traceId?: string;
    }> = {},
  ): void {
    const seed = input.seed ?? 1;
    const at = input.at ?? w.clock.now().toISOString();
    const traceId = input.traceId ?? traceOf(seed);
    w.writer.emit({
      t: "data.observed",
      ts: at,
      workflow: input.workflow ?? "person-lookup",
      runId: uuidOf(seed),
      attempt: input.attempt ?? 1,
      traceId,
      spanPath: `${traceId}/searching#1.${String(input.attempt ?? 1)}`,
      nodeId: input.nodeId ?? "searching",
      taskId: input.taskId ?? "ucpath/search-person-org",
      observedAt: at,
      points: [{
        direction: "read",
        field: "selection.status",
        values: [{
          key: "selection.status",
          state: "allowed",
          classification: "safe-diagnostic",
          transform: "allow",
          value: "resolved",
        }],
      }],
    });
  }
