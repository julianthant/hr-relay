import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { terminalDone, depsOf, observedDepsOf, observedEvent } from "../../../support/helpers/backend/note-scope-fixtures.js";

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, it } from "vitest";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { separationsKualiFinalizationModule } from "../../../../src/backend/app/registries/step-proof-modules.js";
import { deterministicUuid } from "../../../../src/backend/runs/lifecycle/support.js";
import { buildRunSection, createRunNoteScanCache, type RunDetailQueryDeps, type RunNoteScanEntry } from "../../../../src/backend/runs/queries/run-detail.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";

import { AT, instantOffsetOf, makeWorld, queuedEventOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());
const worlds: DashboardWorld[] = [];
async function world(): Promise<DashboardWorld> {
  const created = await makeWorld({ profileFixture: profileFixtures.create, descriptors: { resolve: () => personLookupDescriptor } });
  worlds.push(created);
  return created;
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

/** A settled `done` run, fold and authority agreeing, as the projector sees one. */


describe("a logs GET opens only its run partitions", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;



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

  function poison(w: DashboardWorld, date: string): void {
    const seed = date === "2026-08-03" ? 1 : date < "2026-08-03" ? 100 : 101;
    if (seed !== 1 && w.authority.getRun(uuidOf(100)) === undefined) {
      for (const foreignSeed of [100, 101]) { terminalDone(w, foreignSeed); emitNotes(w, foreignSeed, 1); }
    }
    const raw = new DatabaseSync(join(w.stateRoot, "state.db"));
    try { const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get(); assert.equal(typeof trigger?.sql, "string"); raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON"); raw.prepare("UPDATE timeline_events SET payload_json='{}' WHERE run_id=? AND kind='note'").run(uuidOf(seed)); raw.exec(String(trigger?.sql)); }
    finally { raw.close(); }
  }

  it("serves the run's notes without reading a distant partition of the same workflow", async () => {
    const w = await world();
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

  it("does not read another workflow's partition on the run's own day", async () => {
    const w = await world();
    terminalDone(w, 1);
    emitNotes(w, 1, 2);
    queuedEventOf(w, { seed: 102, workflow: "separations" });
    poison(w, "2026-12-31");
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.equal(section.payload.notes.length, 2);
  });

  it("REFUSES an unparsable line inside the scope, naming the file and line it could not read", async () => {
    const w = await world();
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

  it("still serves a note written the day AFTER the run's last durable instant", async () => {
    const w = await world();
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

  it("serves an empty page, not a throw, for a run whose workflow wrote no notes", async () => {
    const w = await world();
    terminalDone(w, 1);
    mkdirSync(join(w.stateRoot, "notes"), { recursive: true });
    writeFileSync(join(w.stateRoot, "notes", "separations-2026-08-03.jsonl"), `{"n":1}\n`);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes, []);
  });



  const SEARCH_ORIGIN = {
    nodeId: "searching",
    step: "Search person",
    taskId: "ucpath/search-person-org",
    system: "ucpath",
  } as const;



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

  it("serves declared operator observations in Logs while Run data retains the complete evidence", async () => {
    const w = await world();
    terminalDone(w, 1);
    const first = instantOffsetOf(0, 10);
    const fence = instantOffsetOf(0, 20);
    const last = instantOffsetOf(0, 30);
    observedEvent(w, { at: first });
    fencedEvent(w, fence);
    observedEvent(w, { at: last });
    const deps = observedDepsOf(w, [{ ...SEARCH_ORIGIN, operatorFields: [{ label: "Selection", kind: "output", fieldPath: "selection.status" }] }]);
    const section = buildRunSection(deps, uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.ok(section.payload.rows !== undefined);
    assert.deepEqual(section.payload.rows.map((row) => row.kind), ["observed", "transaction-fenced", "observed"]);
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
    const fenced = section.payload.rows[1];
    assert.ok(fenced !== undefined && fenced.kind === "transaction-fenced");
    assert.equal(fenced.at, fence);
    assert.deepEqual(fenced.producer, SEARCH_ORIGIN);
    assert.equal("points" in fenced, false, "a durable fence is not fabricated page data");
  });

  it("serves a real transaction module as probe, prepare, fence, commit, verify without fabricating fence data", async () => {
    const module = separationsKualiFinalizationModule;
    const w = await makeWorld({ profileFixture: profileFixtures.create, descriptors: { resolve: () => module.descriptor } });
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

  it("preserves a descriptor's absent browser system and still refuses an ambiguous producer", async () => {
    const w = await world();
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

  it("examines only this run's indexed span rows, excludes another run, and preserves legal retry attempts", async () => {
    const w = await world();
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

  it("serves an observation appended more than two days after the run instead of dropping its append partition", async () => {
    const w = await world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    w.clock.setWall(new Date(AT.getTime() + 3 * DAY_MS));
    observedEvent(w, { at: instantOffsetOf(0, 10) });

    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "context-data");

    assert.equal(section.section, "context-data");
    assert.deepEqual(section.payload.observations?.map((row) => row.kind), ["observed"]);
  });

  it("keeps SQLite ingestion order when equal-time observations append on different days", async () => {
    const w = await world();
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

  it("orders equal-clock rows by their durable stream location and pages the combined list without a second scan", async () => {
    const w = await world();
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

  it("orders equal-clock SQLite observations by ingestion cursor rather than random event identity", async () => {
    const w = await world();
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

  it("keeps a page walk on one immutable ordering when a later append has an older record clock", async () => {
    const w = await world();
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

  it("ignores retired malformed spans and refuses corrupt SQLite events instead of serving an empty observation page", async () => {
    const w = await world();
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
    const raw = new DatabaseSync(join(w.stateRoot, "state.db"));
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

  it("does not open another workflow's span partition even when it is malformed", async () => {
    const w = await world();
    terminalDone(w, 1);
    mkdirSync(join(w.stateRoot, "spans"), { recursive: true });
    writeFileSync(join(w.stateRoot, "spans", "separations-2026-08-03.jsonl"), "{ not json at all\n");
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.rows, []);
  });
});

describe("native logs snapshot scans a run once", () => {

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
});
