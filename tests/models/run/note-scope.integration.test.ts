
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import {
buildRunSection,
type RunDetailQueryDeps
} from "../../../src/backend/runs/queries/run-detail.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import {
assertNoteWithinRunScope,
runRecordNoteScopeInstants,
runNotePartitionScope as sharedNotePartitionScope,
} from "../../../src/models/run/note-scope.js";
import { type RunRecord } from "../../../src/models/run/record.js";
import {
AT,
claimEventOf,
instantOffsetOf,
makeWorld,
queuedEventOf,
runEndedEventOf,
runRecordOf,
traceOf,
uuidOf,
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld({ descriptors: { resolve: () => personLookupDescriptor } });
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/** A settled `done` run, fold and authority agreeing, as the projector sees one. */
function terminalDone(w: DashboardWorld, seed: number, over: Record<string, unknown> = {}): void {
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



describe("a logs GET opens only its run partitions", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return { timeline: w.timeline, runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => personLookupDescriptor },
    };
  }

  /** `count` note lines for a run, written by the REAL writer at the clock's day. */
  function emitNotes(w: DashboardWorld, seed: number, count: number, from = 0): void {
    const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4242 });
    for (let index = 0; index < count; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed) },
        level: "step",
        message: `note ${String(from + index)}`,
      });
    }
  }

  function _poison(w: DashboardWorld, date: string): void {
    const seed = date === "2026-08-03" ? 1 : date < "2026-08-03" ? 100 : 101;
    if (seed !== 1 && w.authority.getRun(uuidOf(100)) === undefined) {
      for (const foreignSeed of [100, 101]) { terminalDone(w, foreignSeed); emitNotes(w, foreignSeed, 1); }
    }
    const raw = new DatabaseSync(join(w.stateRoot, "authority.db"));
    try { const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get(); assert.equal(typeof trigger?.sql, "string"); raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON"); raw.prepare("UPDATE timeline_events SET payload_json='{}' WHERE run_id=? AND kind='note'").run(uuidOf(seed)); raw.exec(String(trigger?.sql)); }
    finally { raw.close(); }
  }

  /* ── the producer half of the same contract ───────────────────────────── */

  /** The authority record `terminalDone` seeded — what a note PRODUCER holds. */
  function authorityOf(w: DashboardWorld): RunRecord {
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(authority !== undefined);
    return authority;
  }

  it("ADMITS a note filed the day after the run's last durable instant — the margin, from the producer's side", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assertNoteWithinRunScope(authorityOf(w), {
      runId: uuidOf(1),
      workflow: "person-lookup",
      at: new Date(AT.getTime() + DAY_MS),
    });
  });

  it("REFUSES a note filed two days after the run's terminal instant, naming the run, its day and the bounds", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });

    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), {
        runId: uuidOf(1),
        workflow: "person-lookup",
        at: new Date(AT.getTime() + 2 * DAY_MS),
      }),
      /refusing to file a note for run 0001.*partition for 2026-08-05, outside the run's own notes scope 2026-08-03\.\.2026-08-04/s,
    );
  });

  it("REFUSES a note filed under a workflow whose partitions this run's logs reader never opens", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(1), workflow: "separations", at: AT }),
      /the run belongs to person-lookup/,
    );
  });

  it("REFUSES a note scoped against another run's authority record", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(2), workflow: "person-lookup", at: AT }),
      /composed from a different run's instants/,
    );
  });

  it("scopes a producer INSIDE the window the reader opens, never outside it", () => {
    const w = world();
    terminalDone(w, 1);
    const row = w.projection.runFold(uuidOf(1));
    assert.ok(row !== undefined);
    const authority = authorityOf(w);

    const producer = sharedNotePartitionScope({
      runId: uuidOf(1),
      workflow: authority.envelope.workflow,
      instants: runRecordNoteScopeInstants(authority),
    });
    const reader = sharedNotePartitionScope({ runId: uuidOf(1), workflow: authority.envelope.workflow, instants: [...runRecordNoteScopeInstants(authority), ...runRecordNoteScopeInstants(authority)] });
    assert.ok(reader.fromDate <= producer.fromDate, `${reader.fromDate} must not start after ${producer.fromDate}`);
    assert.ok(reader.toDate >= producer.toDate, `${reader.toDate} must not end before ${producer.toDate}`);
  });

  it("refuses producer notes outside the admitted time scope before append", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    emitNotes(w, 1, 1);
    // Injected past the assertion, exactly as an unchecked producer would file
    // it: the line is on disk, in this run's own workflow, and unservable.
    w.clock.setWall(new Date(AT.getTime() + 2 * DAY_MS));
    assert.throws(() => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(1), workflow: "person-lookup", at: w.clock.now() }), /outside/u);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes.map((note) => note.message), ["note 0"]);
  });



  function _observedDepsOf(
    w: DashboardWorld,
    dataOrigins: readonly Readonly<{
      nodeId: string;
      step: string;
      taskId: string;
      system?: string;
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

  const _SEARCH_ORIGIN = {
    nodeId: "searching",
    step: "Search person",
    taskId: "ucpath/search-person-org",
    system: "ucpath",
  } as const;

  function _observedEvent(
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

  function _fencedEvent(w: DashboardWorld, at: string): void {
    w.writer.emit({
      t: "transaction.fenced",
      ts: at,
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/searching#1.1`,
      node: "searching",
      taskId: "ucpath/search-person-org",
    });
  }
});
