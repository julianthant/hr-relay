import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DeletedRunRecordSchema } from "../../../src/models/run/deleted-run.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { runRecordOf,uuidOf } from "./backend/dashboard-harness.js";
import { inMemoryRunReaderFake } from "./canonical-run-reader.js";

describe("canonical reader fixture contract", () => {
  it("distinguishes absent, live and deleted, and refuses contradictory authority", () => {
    const run = runRecordOf({ seed: 1, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const records = new Map([[run.envelope.runId, run]]);
    const tombstone = DeletedRunRecordSchema.parse({ runId: run.envelope.runId, workflow: run.envelope.workflow,
      traceId: run.envelope.traceId, itemId: run.envelope.itemId, attempt: run.envelope.attempt,
      runNumber: run.runNumber ?? null, ordinalSource: "tombstone", tallyVersion: 3, origin: "queue", commandId: uuidOf(20), deletedAt: NOW, removed: [] });
    const deleted = new Map<string, typeof tombstone>();
    const reader = inMemoryRunReaderFake({ records, deleted, generation: 0 });
    assert.equal(reader.read(uuidOf(2)).state, "absent");
    assert.deepEqual(reader.read(run.envelope.runId), { state: "present", run, disposition: "live" });
    deleted.set(run.envelope.runId, tombstone);
    assert.throws(() => reader.read(run.envelope.runId), /both lifecycle authority and a tombstone/u);
    records.delete(run.envelope.runId);
    assert.deepEqual(reader.read(run.envelope.runId), { state: "deleted", tombstone });
  });

  it("pages in service order and refuses generation or filter changes", () => {
    const runs = [runRecordOf({ seed: 2 }), runRecordOf({ seed: 1 }), runRecordOf({ seed: 3, priority: "bulk" })];
    const state = { records: new Map(runs.map(run => [run.envelope.runId, run])), deleted: new Map(), generation: 4 };
    const reader = inMemoryRunReaderFake(state);
    const page = reader.list({ disposition: "live", limit: 1 });
    assert.equal(page.state, "listed");
    if (page.state !== "listed") throw new Error("fixture list refused");
    assert.deepEqual(page.rows.map(run => run.envelope.runId), [uuidOf(1)]);
    assert.ok(page.cursor);
    const next = reader.list({ disposition: "live", limit: 2, cursor: page.cursor });
    assert.equal(next.state, "listed");
    if (next.state !== "listed") throw new Error("fixture next page refused");
    assert.deepEqual(next.rows.map(run => run.envelope.runId), [uuidOf(2), uuidOf(3)]);
    assert.equal(next.cursor, undefined);
    const stale = { state: "refused", refusal: { reason: "cursor-stale" } };
    assert.deepEqual(reader.list({ disposition: "live", workflow: "person-lookup", limit: 1, cursor: page.cursor }), stale);
    state.generation++;
    assert.deepEqual(reader.list({ disposition: "live", limit: 1, cursor: page.cursor }), stale);
  });

  it("captures the complete selected run tree and refuses a missing owner", () => {
    const parent = runRecordOf({ seed: 1 }), unrelated = runRecordOf({ seed: 3 });
    const child = runRecordOf({ seed: 2, parentSeed: 1 });
    const records = new Map([parent,child,unrelated].map(run => [run.envelope.runId,run]));
    const reader = inMemoryRunReaderFake({records,deleted:new Map(),generation:0});
    const snapshot = reader.withRunTreeSnapshot([parent.envelope.runId], rows => rows);
    assert.deepEqual(snapshot.map(run => run.envelope.runId),[parent.envelope.runId,child.envelope.runId]);
    assert.throws(()=>reader.withRunTreeSnapshot([uuidOf(4)],()=>undefined),/run-tree-source-unavailable/u);
  });
});
