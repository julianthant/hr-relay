
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { createNoteTimelineWriter } from "../../../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import { deterministicUuid } from "../../../../../../src/backend/runs/lifecycle/support.js";
import { type RunRecord } from "../../../../../../src/models/run/record.js";
import {
  assertNoteWithinRunScope,
  runNotePartitionScope as sharedNotePartitionScope,
  runRecordNoteScopeInstants,
} from "../../../../../../src/models/run/note-scope.js";
import type { RunCheckpointRecord } from "../../../../../../src/models/workflow/checkpoint.js";
import {
  buildRunSection,
  createRunNoteScanCache,
  type RunDetailQueryDeps,
  type RunNoteScanEntry,
} from "../../../../../../src/backend/runs/queries/run-detail.js";
import { separationsKualiFinalizationModule } from "../../../../../../src/backend/app/registries/step-proof-modules.js";
import { dataOriginViewsOf } from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import {
  AT,
  claimEventOf,
  cleanReceiptOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  receiptWithWarningsOf,
  runEndedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";

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


function countAuthorityReads<Result>(
  w: DashboardWorld,
  work: () => Result,
): { value: Result; getRun: number; canonicalRead: number; canonicalList: number; latestCheckpoint: number; getReceipt: number } {
  const original = {
    canonicalRead: w.runReader.read.bind(w.runReader),
    canonicalList: w.runReader.list.bind(w.runReader),
    getRun: w.authority.getRun.bind(w.authority),
    latestCheckpoint: w.authority.latestCheckpoint.bind(w.authority),
    getReceipt: w.authority.getReceipt.bind(w.authority),
  };
  const counts = { getRun: 0, canonicalRead: 0, canonicalList: 0, latestCheckpoint: 0, getReceipt: 0 };
  w.runReader.read = (runId) => {
    counts.canonicalRead += 1;
    return original.canonicalRead(runId);
  };
  w.runReader.list = (input) => {
    counts.canonicalList += 1;
    return original.canonicalList(input);
  };
  w.authority.getRun = (runId: string): RunRecord | undefined => {
    counts.getRun += 1;
    return original.getRun(runId);
  };
  w.authority.latestCheckpoint = (
    workflowId: string,
    itemId: string,
    nodeId: string,
  ): RunCheckpointRecord | undefined => {
    counts.latestCheckpoint += 1;
    return original.latestCheckpoint(workflowId, itemId, nodeId);
  };
  w.authority.getReceipt = (runId: string) => {
    counts.getReceipt += 1;
    return original.getReceipt(runId);
  };
  try {
    return { value: work(), ...counts };
  } finally {
    w.runReader.read = original.canonicalRead;
    w.runReader.list = original.canonicalList;
    w.authority.getRun = original.getRun;
    w.authority.latestCheckpoint = original.latestCheckpoint;
    w.authority.getReceipt = original.getReceipt;
  }
}



describe("member preview slices before joining", () => {
  /** A group of `members` members, each titled so the preview can be read. */
  function groupOf(w: DashboardWorld, members: number): void {
    queuedEventOf(w, { seed: 1, shape: "operation", title: "Termination batch" });
    for (let index = 0; index < members; index += 1) {
      queuedEventOf(w, {
        seed: 100 + index,
        shape: "operation-member",
        parentSeed: 1,
        title: `Member ${String(index)}`,
      });
    }
  }

  it("names the first three and counts the rest", () => {
    const w = world();
    groupOf(w, 8);
    const group = w.projection.queueSurface(uuidOf(1));
    assert.ok(group !== undefined && group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "present",
      value: "Member 0, Member 1, Member 2 +5 more",
    });
  });

  it("joins authority for at most the three members it can name", () => {
    const w = world();
    groupOf(w, 8);
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));

    assert.equal(counted.latestCheckpoint, 4);
    assert.equal(counted.getRun, 0);
    assert.equal(counted.canonicalRead, 1);
    assert.equal(counted.canonicalList, 1);
  });

  it("costs the same three joins whether the group has four members or forty", () => {
    const small = world();
    groupOf(small, 4);
    const large = world();
    groupOf(large, 40);
    const smallCount = countAuthorityReads(small, () => small.projection.queueSurface(uuidOf(1)));
    const largeCount = countAuthorityReads(large, () => large.projection.queueSurface(uuidOf(1)));
    assert.equal(largeCount.latestCheckpoint, smallCount.latestCheckpoint);
    assert.equal(largeCount.getRun, smallCount.getRun);
    assert.equal(largeCount.canonicalRead, smallCount.canonicalRead);
    assert.equal(largeCount.canonicalList, smallCount.canonicalList);
  });

  it("still counts every member the fold has seen in the `+N more` tail", () => {
    const w = world();
    groupOf(w, 40);
    const group = w.projection.queueSurface(uuidOf(1));
    assert.ok(group !== undefined && group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "present",
      value: "Member 0, Member 1, Member 2 +37 more",
    });
  });

  it("names the absence when the fold has seen no member of a group that claims some", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, shape: "operation" });
    const group = w.projection.queueSurface(uuidOf(1));
    assert.ok(group !== undefined && group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "absent",
      reason: "this group has fanned out to no members yet",
    });
  });
});



describe("a row reads its evidence receipt once", () => {
  it("reads the receipt exactly once for a terminal row", () => {
    const w = world();
    terminalDone(w, 1);
    w.authority.receipts.set(uuidOf(1), cleanReceiptOf({ seed: 1 }));
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    assert.equal(counted.getReceipt, 1);
  });

  it("reads it once even when the run has no derived receipt at all", () => {
    const w = world();
    terminalDone(w, 1);
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    assert.equal(counted.getReceipt, 1);
  });

  it("reads none for a row that has not produced a terminal result", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    assert.equal(counted.getReceipt, 0);
  });

  it("keeps both consumers' answers, from that one read", () => {
    const w = world();
    terminalDone(w, 1);
    w.authority.receipts.set(uuidOf(1), cleanReceiptOf({ seed: 1 }));
    const row = w.projection.queueSurface(uuidOf(1));
    assert.ok(row !== undefined);
    assert.deepEqual(row.warnings, {
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    });
    assert.deepEqual(row.facts, {
      state: "absent",
      reason: "this run's evidence receipt records no output fact",
    });
  });

  it("keeps `unread` and `none` apart when no receipt was ever derived", () => {
    const w = world();
    terminalDone(w, 1);
    const row = w.projection.queueSurface(uuidOf(1));
    assert.ok(row !== undefined);
    assert.deepEqual(row.warnings, {
      state: "absent",
      reason: "no evidence receipt has been derived for this run, so its warning set is unknown",
    });
  });

  it("scales the day wire's receipt reads with the TERMINAL rows, not with every row", () => {
    const w = world();
    terminalDone(w, 1);
    terminalDone(w, 2);
    queuedEventOf(w, { seed: 3 });
    queuedEventOf(w, { seed: 4 });
    const counted = countAuthorityReads(w, () => w.projection.buildDashboardDayWire(
      AT.toISOString().slice(0, 10),
    ));
    assert.equal(counted.value.queueSurfaces.length, 4);
    assert.equal(counted.getReceipt, 2);
  });

  it("reuses each terminal row's safe receipt projection for the Activity completion split", () => {
    const w = world();

    terminalDone(w, 1);
    terminalDone(w, 2);
    terminalDone(w, 3);
    terminalDone(w, 4);
    w.authority.receipts.set(uuidOf(1), cleanReceiptOf({ seed: 1 }));
    w.authority.receipts.set(uuidOf(2), receiptWithWarningsOf({
      seed: 2,
      summaries: ["a safe warning"],
    }));
    const legacyReceipt = { ...cleanReceiptOf({ seed: 4 }) };
    w.authority.receipts.set(uuidOf(4), legacyReceipt);

    const counted = countAuthorityReads(w, () => w.projection.buildActivityReportWire(
      AT.toISOString().slice(0, 10),
      AT.toISOString().slice(0, 10),
    ));
    assert.equal(counted.value.totalRuns, 4);
    assert.equal(counted.value.terminalRuns, 4);
    assert.deepEqual(counted.value.completion, { readBack: 2, warnings: 1, warningsUnknown: 1 });
    assert.deepEqual(counted.value.workflows[0]?.completion, {
      readBack: 2,
      warnings: 1,
      warningsUnknown: 1,
    });
    assert.equal(counted.getReceipt, 4);

    const rows = w.projection.buildDashboardDayWire(AT.toISOString().slice(0, 10)).queueSurfaces;
    const rowOf = (seed: number) => rows.find((row) => row.runId === uuidOf(seed));
    assert.deepEqual(rowOf(1)?.warnings, {
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    });
    assert.deepEqual(rowOf(2)?.warnings, {
      state: "present",
      count: 1,
      first: "a safe warning",
    });
    assert.deepEqual(rowOf(3)?.warnings, {
      state: "absent",
      reason: "no evidence receipt has been derived for this run, so its warning set is unknown",
    });
    assert.deepEqual(rowOf(4)?.warnings, {
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    });
  });
});



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
    const notes = createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 });
    for (let index = 0; index < count; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed) },
        level: "step",
        message: `note ${String(from + index)}`,
      });
    }
  }

  function poison(w: DashboardWorld, date: string): void {
    const seed = date === "2026-08-03" ? 1 : date < "2026-08-03" ? 100 : 101;
    if (seed !== 1 && w.authority.getRun(uuidOf(100)) === undefined) {
      for (const foreignSeed of [100, 101]) { terminalDone(w, foreignSeed); emitNotes(w, foreignSeed, 1); }
    }
    const raw = new DatabaseSync(join(w.stateRoot, "authority.db"));
    try { const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get(); assert.equal(typeof trigger?.sql, "string"); raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON"); raw.prepare("UPDATE timeline_events SET payload_json='{}' WHERE run_id=? AND kind='note'").run(uuidOf(seed)); raw.exec(String(trigger?.sql)); }
    finally { raw.close(); }
  }

  it("serves the run's notes without reading a distant partition of the same workflow", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 3);
    // A whole-corpus reader would hand these bytes to `NoteWireSchema.parse`
    // and throw; serving the page is the observation that it never opened them.
    poison(w, "2026-06-01");
    poison(w, "2026-12-31");
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(
      section.payload.notes.map((note) => note.message),
      ["note 0", "note 1", "note 2"],
    );
  });

  it("does not read another workflow's partition on the run's own day", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 2);
    queuedEventOf(w, { seed: 102, workflow: "separations" });
    poison(w, "2026-12-31");
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.equal(section.payload.notes.length, 2);
  });

  it("REFUSES an unparsable line inside the scope, naming the file and line it could not read", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 2);
    poison(w, "2026-08-03");
    // A bare SyntaxError/ZodError names no byte on disk, so the operator whose
    // logs tab just answered 500 has nothing to grep for.
    assert.throws(
      () => buildRunSection(depsOf(w), uuidOf(1), "logs"),
      /timeline-record-invalid/u,
    );
  });

  it("still serves a note written the day AFTER the run's last durable instant", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 1);
    // The midnight the margin exists for: an append-at-now partition rolls over
    // between the terminal transition and the worker's last note.
    w.clock.setWall(new Date(AT.getTime() + DAY_MS));
    emitNotes(w, 1, 1, 1);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes.map((note) => note.message), ["note 0", "note 1"]);
  });

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

  it("serves an empty page, not a throw, for a run whose workflow wrote no notes", () => {
    const w = world();
    terminalDone(w, 1);
    mkdirSync(join(w.stateRoot, "notes"), { recursive: true });
    writeFileSync(join(w.stateRoot, "notes", "separations-2026-08-03.jsonl"), `{"n":1}\n`);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes, []);
  });



  function observedDepsOf(
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

  const SEARCH_ORIGIN = {
    nodeId: "searching",
    step: "Search person",
    taskId: "ucpath/search-person-org",
    system: "ucpath",
  } as const;

  function observedEvent(
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

  function fencedEvent(w: DashboardWorld, at: string): void {
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

  it("serves observations in Run data while Logs keeps the durable fence", () => {
    const w = world();
    terminalDone(w, 1);
    const first = instantOffsetOf(0, 10);
    const fence = instantOffsetOf(0, 20);
    const last = instantOffsetOf(0, 30);
    observedEvent(w, { at: first });
    fencedEvent(w, fence);
    observedEvent(w, { at: last });
    const deps = observedDepsOf(w, [SEARCH_ORIGIN]);
    const section = buildRunSection(deps, uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.ok(section.payload.rows !== undefined);
    assert.deepEqual(section.payload.rows.map((row) => row.kind), ["transaction-fenced"]);
    const data = buildRunSection(deps, uuidOf(1), "context-data");
    assert.equal(data.section, "context-data");
    assert.equal(data.payload.observations?.length, 2);
    const observed = data.payload.observations?.[0];
    assert.ok(observed !== undefined && observed.kind === "observed");
    assert.equal(observed.at, first);
    assert.equal(observed.attempt, 1);
    assert.equal(observed.spanPath, `${traceOf(1)}/searching#1.1`);
    assert.deepEqual(observed.producer, SEARCH_ORIGIN);
    assert.equal(observed.points[0]?.direction, "read");
    assert.equal(observed.points[0]?.values[0]?.transform, "allow");
    const fenced = section.payload.rows[0];
    assert.ok(fenced !== undefined && fenced.kind === "transaction-fenced");
    assert.equal(fenced.at, fence);
    assert.deepEqual(fenced.producer, SEARCH_ORIGIN);
    assert.equal("points" in fenced, false, "a durable fence is not fabricated page data");
  });

  it("serves a real transaction module as probe, prepare, fence, commit, verify without fabricating fence data", () => {
    const module = separationsKualiFinalizationModule;
    const w = makeWorld({ descriptors: { resolve: () => module.descriptor } });
    worlds.push(w);
    queuedEventOf(w, { seed: 1, workflow: "separations-kuali-finalization" });
    const emitObserved = (taskId: string, direction: "read" | "write", at: string): void => {
      w.writer.emit({
        t: "data.observed",
        ts: at,
        workflow: "separations-kuali-finalization",
        runId: uuidOf(1),
        attempt: 1,
        traceId: traceOf(1),
        spanPath: `${traceOf(1)}/finalize-kuali/${taskId.split("/").at(-1)}#1.1`,
        nodeId: "finalize-kuali",
        taskId,
        observedAt: at,
        points: [{
          direction,
          field: "timekeeper.name",
          values: [{
            key: "timekeeper.name",
            state: "allowed",
            classification: "safe-diagnostic",
            transform: "allow",
            value: taskId,
          }],
        }],
      });
    };
    emitObserved("kuali/match-separation-finalization", "read", instantOffsetOf(0, 10));
    emitObserved("kuali/stage-separation-finalization", "write", instantOffsetOf(0, 20));
    w.writer.emit({
      t: "transaction.fenced",
      ts: instantOffsetOf(0, 30),
      workflow: "separations-kuali-finalization",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/finalize-kuali/commit`,
      node: "finalize-kuali",
      taskId: "kuali/save-separation-finalization",
    });
    emitObserved("kuali/save-separation-finalization", "write", instantOffsetOf(0, 40));
    emitObserved("kuali/verify-separation-finalization", "read", instantOffsetOf(0, 50));
    const deps: RunDetailQueryDeps = { timeline: w.timeline, runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(module) }) },
    };

    const section = buildRunSection(deps, uuidOf(1), "logs");
    const data = buildRunSection(deps, uuidOf(1), "context-data");

    assert.equal(section.section, "logs");
    assert.equal(data.section, "context-data");
    assert.ok(section.payload.rows !== undefined);
    assert.deepEqual(data.payload.observations?.map((row) => ({
      kind: row.kind,
      taskId: row.producer.taskId,
      direction: row.points[0]?.direction,
      hasPoints: "points" in row,
    })), [
      { kind: "observed", taskId: "kuali/match-separation-finalization", direction: "read", hasPoints: true },
      { kind: "observed", taskId: "kuali/stage-separation-finalization", direction: "write", hasPoints: true },
      { kind: "observed", taskId: "kuali/save-separation-finalization", direction: "write", hasPoints: true },
      { kind: "observed", taskId: "kuali/verify-separation-finalization", direction: "read", hasPoints: true },
    ]);
    assert.deepEqual(section.payload.rows.map((row) => row.kind), ["transaction-fenced"]);
    assert.ok(section.payload.rows.every((row) => row.kind === "note" || row.producer.system === "kuali"));
  });

  it("preserves a descriptor's absent browser system and still refuses an ambiguous producer", () => {
    const w = world();
    terminalDone(w, 1);
    observedEvent(w);
    const section = buildRunSection(
      observedDepsOf(w, [{ ...SEARCH_ORIGIN, system: undefined }]),
      uuidOf(1),
      "context-data",
    );
    assert.equal(section.section, "context-data");
    const row = section.payload.observations?.[0];
    assert.ok(row !== undefined);
    assert.deepEqual(row.producer, {
      nodeId: SEARCH_ORIGIN.nodeId,
      step: SEARCH_ORIGIN.step,
      taskId: SEARCH_ORIGIN.taskId,
    });
    assert.throws(
      () => buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN, { ...SEARCH_ORIGIN, system: "crm" }]), uuidOf(1), "context-data"),
      /has 2 matching data origins/,
    );
  });

  it("examines only this run's indexed span rows, excludes another run, and preserves legal retry attempts", () => {
    const w = world();
    terminalDone(w, 1, { attempt: 2 });
    terminalDone(w, 2);
    observedEvent(w, { seed: 2, at: instantOffsetOf(0, 5) });
    observedEvent(w, { seed: 1, attempt: 1, at: instantOffsetOf(0, 10) });
    w.writer.emit({
      t: "run.requeued",
      ts: instantOffsetOf(0, 15),
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      nextAttempt: 2,
      traceId: traceOf(1),
      spanPath: traceOf(1),
      cause: "recovery",
    });
    observedEvent(w, { seed: 1, attempt: 2, at: instantOffsetOf(0, 20) });
    assert.equal(w.projection.runLogSnapshot(uuidOf(1)).entries.length, 2);
    assert.equal(w.projection.runLogSnapshot(uuidOf(2)).entries.length, 1);
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "context-data");
    assert.equal(section.section, "context-data");
    const observations = section.payload.observations ?? [];
    assert.deepEqual(observations.map((row) => row.attempt), [1, 2]);
    assert.deepEqual(observations.map((row) => row.at), [instantOffsetOf(0, 10), instantOffsetOf(0, 20)]);
  });

  it("serves an observation appended more than two days after the run instead of dropping its append partition", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    w.clock.setWall(new Date(AT.getTime() + 3 * DAY_MS));
    observedEvent(w, { at: instantOffsetOf(0, 10) });

    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "context-data");

    assert.equal(section.section, "context-data");
    assert.deepEqual(section.payload.observations?.map((row) => row.kind), ["observed"]);
  });

  it("keeps SQLite ingestion order when equal-time observations append on different days", () => {
    const w = world();
    terminalDone(w, 1);
    const observedAt = instantOffsetOf(0, 10);
    observedEvent(w, { at: observedAt });
    w.clock.setWall(new Date(AT.getTime() + 3 * DAY_MS));
    observedEvent(w, { at: observedAt });
    const indexed = w.projection.runLogSnapshot(uuidOf(1)).entries;
    assert.equal(indexed.length, 2);
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "context-data");
    assert.equal(section.section, "context-data");
    assert.deepEqual(section.payload.observations?.map((row) => row.logId), indexed.map(({ line }) =>
      deterministicUuid(`log:${line.file.path}:${String(line.lineNumber)}`)));
  });

  it("serves a completed browser action as a concise Logs line", () => {
    const w = world();
    terminalDone(w, 1);
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(authority !== undefined);
    const notes = createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 });
    notes.emitRunAction({
      workflow: "person-lookup",
      address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
      action: { kind: "clicked", targetId: "ucpath.person-org.search-button", at: w.clock.now().toISOString() },
    }, authority);
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.rows?.map((row) => row.kind), ["note"]);
    assert.equal(section.payload.notes[0]?.message, "Clicked ucpath person org search button");
  });

  it("serves classified note values in Logs", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 });
    notes.emitNote({
      workflow: "person-lookup",
      address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
      level: "step",
      message: "Entered person details",
      fields: [{ key: "ssn", classification: "direct-identifier", transform: "last4", value: "951-57-1700" }],
    });
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes[0]?.fields, [{ key: "ssn", kind: "text", value: "951-57-1700" }]);
  });

  it("refuses a same-run observation whose trace is not the run authority trace", () => {
    const w = world();
    terminalDone(w, 1);
    assert.throws(() => observedEvent(w, { traceId: traceOf(2) }), /timeline-event-owner-mismatch/u);
  });

  it("refuses observed rows under a foreign workflow or outside the run's legal attempts", () => {
    const foreignWorkflow = world();
    terminalDone(foreignWorkflow, 1);
    assert.throws(() => observedEvent(foreignWorkflow, { workflow: "separations" }), /timeline-event-owner-mismatch/u);
    const foreignAttempt = world();
    terminalDone(foreignAttempt, 1);
    assert.throws(() => observedEvent(foreignAttempt, { attempt: 2 }), /timeline-event-owner-mismatch/u);
  });

  it("refuses foreign note workflow and trace identities by source line", () => {
    const foreignWorkflow = world();
    terminalDone(foreignWorkflow, 1);
    const foreignNotes = createNoteTimelineWriter({ repository: foreignWorkflow.timeline, clock: foreignWorkflow.clock, pid: 4242 });
    assert.throws(() => foreignNotes.emitNote({ workflow: "separations", address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) }, level: "step", message: "foreign workflow" }), /timeline-event-owner-mismatch/u);

    const foreignTrace = world();
    terminalDone(foreignTrace, 1);
    const notes = createNoteTimelineWriter({ repository: foreignTrace.timeline, clock: foreignTrace.clock, pid: 4242 });
    assert.throws(() => notes.emitNote({ workflow: "person-lookup", address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(2), spanPath: traceOf(2) }, level: "step", message: "foreign trace" }), /timeline-note-owner-mismatch/u);

  });

  it("orders equal-clock rows by their durable stream location and pages the combined list without a second scan", () => {
    const w = world();
    terminalDone(w, 1);
    const tie = instantOffsetOf(0, 10);
    for (let index = 0; index < 201; index += 1) fencedEvent(w, tie);
    const inner = createRunNoteScanCache();
    let scans = 0;
    const cache = {
      start: (runId: string, scan: () => readonly RunNoteScanEntry[]) =>
        inner.start(runId, () => {
          scans += 1;
          return scan();
        }),
      resume: (runId: string, snapshotId: string) => inner.resume(runId, snapshotId),
    };
    const first = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs", undefined, cache);
    assert.equal(first.section, "logs");
    assert.ok(first.payload.rows !== undefined);
    assert.equal(first.payload.rows.length, 200);
    assert.equal(first.payload.nextCursor.state, "present");
    if (first.payload.nextCursor.state !== "present") throw new Error("first combined page must continue");
    const second = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs", first.payload.nextCursor.value, cache);
    assert.equal(second.section, "logs");
    assert.ok(second.payload.rows !== undefined);
    assert.equal(second.payload.rows.length, 1);
    assert.equal(second.payload.nextCursor.state, "absent");
    assert.equal(scans, 1);
    assert.deepEqual(
      [...first.payload.rows, ...second.payload.rows].map((row) => row.sequence),
      Array.from({ length: 201 }, (_, index) => index),
    );
  });

  it("orders equal-clock SQLite observations by ingestion cursor rather than random event identity", () => {
    const w = world();
    terminalDone(w, 1);
    const identities = ["ffffffff-ffff-4fff-8fff-ffffffffffff", "00000000-0000-4000-8000-000000000001"];
    const writer = createTimelineEmitter({ repository: w.timeline, clock: w.clock, pid: 4242,
      uuid: () => { const id = identities.shift(); if (id === undefined) throw new Error("fixture identities exhausted"); return id; } });
    const producer = { ...w, writer };
    const at = instantOffsetOf(0, 10);
    observedEvent(producer, { at });
    fencedEvent(producer, at);
    w.projection.ingestFromTimeline();
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.rows?.map((row) => row.kind), ["transaction-fenced"]);
    const data = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "context-data");
    assert.equal(data.section, "context-data");
    assert.deepEqual(data.payload.observations?.map((row) => row.kind), ["observed"]);
  });

  it("keeps a page walk on one immutable ordering when a later append has an older record clock", () => {
    const w = world();
    terminalDone(w, 1);
    const tie = instantOffsetOf(0, 20);
    for (let index = 0; index < 201; index += 1) fencedEvent(w, tie);
    const deps = observedDepsOf(w, [SEARCH_ORIGIN]);
    const first = buildRunSection(deps, uuidOf(1), "logs");
    assert.equal(first.section, "logs");
    assert.ok(first.payload.rows !== undefined);
    assert.equal(first.payload.nextCursor.state, "present");
    if (first.payload.nextCursor.state !== "present") throw new Error("first combined page must continue");

    fencedEvent(w, instantOffsetOf(0, 10));
    const second = buildRunSection(deps, uuidOf(1), "logs", first.payload.nextCursor.value);

    assert.equal(second.section, "logs");
    assert.ok(second.payload.rows !== undefined);
    const walked = [...first.payload.rows, ...second.payload.rows];
    assert.equal(walked.length, 201);
    assert.equal(new Set(walked.map((row) => row.logId)).size, 201);
    assert.ok(walked.every((row) => row.kind === "transaction-fenced" && row.at === tie));
  });

  it("ignores retired malformed spans and refuses corrupt SQLite events instead of serving an empty observation page", () => {
    const w = world();
    terminalDone(w, 1);
    rmSync(join(w.stateRoot, "spans"), { recursive: true, force: true });
    const noSpans = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(noSpans.section, "logs");
    assert.deepEqual(noSpans.payload.rows, []);
    mkdirSync(join(w.stateRoot, "spans"), { recursive: true });
    writeFileSync(join(w.stateRoot, "spans", "person-lookup-2026-08-03.jsonl"), "{ not json at all\n");
    w.projection.ingestFromTimeline();
    const unchanged = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(unchanged.section, "logs");
    assert.deepEqual(unchanged.payload.rows, []);
    observedEvent(w);
    const raw = new DatabaseSync(join(w.stateRoot, "authority.db"));
    try {
      const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get();
      assert.equal(typeof trigger?.sql, "string");
      raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
      raw.prepare("UPDATE timeline_events SET payload_json='{}' WHERE cursor=(SELECT max(cursor) FROM timeline_events)").run();
      raw.exec(String(trigger?.sql));
    } finally { raw.close(); }
    w.projection.rebuildFromTimeline();
    assert.throws(
      () => buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "context-data"),
      /degraded/u,
    );
  });

  it("does not open another workflow's span partition even when it is malformed", () => {
    const w = world();
    terminalDone(w, 1);
    mkdirSync(join(w.stateRoot, "spans"), { recursive: true });
    writeFileSync(join(w.stateRoot, "spans", "separations-2026-08-03.jsonl"), "{ not json at all\n");
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.rows, []);
  });
});



describe("native logs snapshot scans a run once", () => {
  function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return { timeline: w.timeline, runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => personLookupDescriptor },
    };
  }


  it("scans once across a whole page walk, and every page is the same list", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 });
    for (let index = 0; index < 450; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
        level: "step",
        message: `note ${String(index)}`,
      });
    }
    const inner = createRunNoteScanCache();
    let scans = 0;
    const cache = {
      start: (runId: string, scan: () => readonly RunNoteScanEntry[]) =>
        inner.start(runId, () => {
          scans += 1;
          return scan();
        }),
      resume: (runId: string, snapshotId: string) => inner.resume(runId, snapshotId),
    };
    const messages: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const section = buildRunSection(depsOf(w), uuidOf(1), "logs", cursor, cache);
      assert.equal(section.section, "logs");
      messages.push(...section.payload.notes.map((note) => note.message));
      if (section.payload.nextCursor.state === "absent") break;
      cursor = section.payload.nextCursor.value;
    }
    assert.equal(scans, 1);
    assert.equal(messages.length, 450);
    assert.equal(messages[0], "note 0");
    assert.equal(messages.at(-1), "note 449");
  });

  it("serves one run from one scan and a second run from its own", () => {
    // The cache OBJECT's keying, which is the half `buildRunSection` cannot
    // show: a per-run map, not a per-call one.
    const inner = createRunNoteScanCache();
    let scans = 0;
    const counting = (): readonly RunNoteScanEntry[] => {
      scans += 1;
      return [];
    };
    const first = inner.start(uuidOf(1), counting);
    inner.resume(uuidOf(1), first.id);
    inner.start(uuidOf(2), counting);
    assert.equal(scans, 2);
  });

  it("re-reads the corpus on EVERY call when no cache is handed in", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 });
    const emit = (message: string): void => {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
        level: "step",
        message,
      });
    };
    emit("note 0");
    const first = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(first.section, "logs");
    assert.deepEqual(first.payload.notes.map((note) => note.message), ["note 0"]);

    emit("note 1");
    const second = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(second.section, "logs");
    assert.deepEqual(second.payload.notes.map((note) => note.message), ["note 0", "note 1"]);
  });
});
