import { RunRecordService } from "../../src/core/run-record-service.js";
import { RunExistenceSchema } from "../../src/domain/authority.js";
import type { Clock } from "../../src/domain/clock.js";
import { RunIdSchema } from "../../src/domain/ids.js";
import type { DeletedRunRecord } from "../../src/domain/run/deleted-run.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { CanonicalListRunsRequestSchema } from "../../src/infra/sqlite/run-store-contracts.js";

export type CanonicalRunReader = Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot">;

/** Real service over the caller's isolated database; read fixtures cannot publish or mint IDs. */
export function sqliteRunReader(database: AuthorityDatabase, clock: Clock): CanonicalRunReader {
  const forbidden = (): never => { throw new Error("read-only run fixture attempted a mutation capability"); };
  const service = new RunRecordService({ database, clock, ids: { uuid: forbidden }, publishQueued: forbidden });
  return Object.freeze({ read: service.read.bind(service), list: service.list.bind(service), withRunTreeSnapshot: service.withRunTreeSnapshot.bind(service) });
}

export interface InMemoryRunReaderState {
  readonly records: ReadonlyMap<string, RunRecord>;
  readonly archived: ReadonlySet<string>;
  readonly deleted: ReadonlyMap<string, DeletedRunRecord>;
  /** The fixture advances this explicitly whenever its authority generation changes. */
  generation: number;
}

/** Unit-test fake, never the oracle for canonical lifecycle acceptance (use sqliteRunReader there). */
export function inMemoryRunReaderFake(state: InMemoryRunReaderState): CanonicalRunReader {
  const read: CanonicalRunReader["read"] = (input) => {
    const runId = RunIdSchema.parse(input);
    const run = state.records.get(runId);
    const tombstone = state.deleted.get(runId);
    if (run !== undefined && tombstone !== undefined) throw new Error(`run ${runId} has both lifecycle authority and a tombstone`);
    if (tombstone !== undefined) return RunExistenceSchema.parse({ state: "deleted", tombstone });
    if (run === undefined) return RunExistenceSchema.parse({ state: "absent", runId });
    const archived = state.archived.has(runId);
    if (archived && run.lifecycle.state !== "terminal") throw new Error(`archived run ${runId} is not terminal`);
    return RunExistenceSchema.parse({ state: "present", run, disposition: archived ? "archived" : "live" });
  };
  return Object.freeze({
    read,
    withRunTreeSnapshot(runIds, work) {
      const selected = new Set(runIds);
      const rows = [...state.records.values()].filter(run => selected.has(run.envelope.runId) || (run.envelope.parent !== undefined && selected.has(run.envelope.parent.runId)));
      for (const id of new Set([...runIds, ...rows.map(run => run.envelope.runId)])) {
        const result = read(id);
        if (result.state !== "present" || result.disposition !== "live") throw new Error("run-tree-source-unavailable");
      }
      return work(rows);
    },
    list(input) {
      const request = CanonicalListRunsRequestSchema.parse(input);
      const { cursor } = request;
      if (cursor !== undefined && (cursor.generation !== state.generation
        || cursor.workflow !== request.workflow || cursor.disposition !== request.disposition)) {
        return { state: "refused" as const, refusal: { reason: "cursor-stale" as const } };
      }
      const rows = [...state.records.values()].filter(run => {
        const existence = read(run.envelope.runId);
        return existence.state === "present" && existence.disposition === request.disposition
          && (request.workflow === undefined || run.envelope.workflow === request.workflow);
      }).sort((a, b) => Number(a.envelope.priority === "bulk") - Number(b.envelope.priority === "bulk")
        || Date.parse(a.envelope.enqueuedAt) - Date.parse(b.envelope.enqueuedAt)
        || (a.envelope.runId < b.envelope.runId ? -1 : a.envelope.runId === b.envelope.runId ? 0 : 1));
      const offset = cursor?.offset ?? 0;
      const page = rows.slice(offset, offset + request.limit);
      return { state: "listed" as const, rows: page,
        ...(offset + page.length >= rows.length ? {} : { cursor: {
          generation: state.generation, offset: offset + page.length, disposition: request.disposition,
          ...(request.workflow === undefined ? {} : { workflow: request.workflow }),
        } }),
      };
    },
  });
}
