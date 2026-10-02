import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DeletedRunRecordSchema } from "../../../../src/domain/run/deleted-run.js";
import { inMemoryRunReaderFake } from "../../../helpers/canonical-run-reader.js";
import { NOW } from "../../../fixtures/phase1c-contract-fixtures.js";
import { runRecordOf, uuidOf } from "../../../helpers/backend/dashboard-harness.js";

describe("canonical reader fixture contract", () => {
  it("distinguishes absent, live, archived and deleted, and refuses contradictory authority", () => {
    const run = runRecordOf({ seed: 1, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const records = new Map([[run.envelope.runId, run]]);
    const archived = new Set<string>();
    const tombstone = DeletedRunRecordSchema.parse({ runId: run.envelope.runId, workflow: run.envelope.workflow,
      traceId: run.envelope.traceId, origin: "queue", commandId: uuidOf(20), deletedAt: NOW, removed: [] });
    const deleted = new Map<string, typeof tombstone>();
    const reader = inMemoryRunReaderFake({ records, archived, deleted, generation: 0 });
    assert.equal(reader.read(uuidOf(2)).state, "absent");
    assert.deepEqual(reader.read(run.envelope.runId), { state: "present", run, disposition: "live" });
    archived.add(run.envelope.runId);
    assert.deepEqual(reader.read(run.envelope.runId), { state: "present", run, disposition: "archived" });
    deleted.set(run.envelope.runId, tombstone);
    assert.throws(() => reader.read(run.envelope.runId), /both lifecycle authority and a tombstone/u);
    records.delete(run.envelope.runId);
    assert.deepEqual(reader.read(run.envelope.runId), { state: "deleted", tombstone });
    const queued = runRecordOf({ seed: 2 });
    records.set(queued.envelope.runId, queued);
    archived.add(uuidOf(2));
    assert.throws(() => reader.read(uuidOf(2)), /not terminal/u);
  });

  it("pages in service order and refuses generation or filter changes", () => {
    const runs = [runRecordOf({ seed: 2 }), runRecordOf({ seed: 1 }), runRecordOf({ seed: 3, priority: "bulk" })];
    const state = { records: new Map(runs.map(run => [run.envelope.runId, run])), archived: new Set<string>(), deleted: new Map(), generation: 4 };
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
    assert.deepEqual(reader.list({ disposition: "archived", limit: 1, cursor: page.cursor }), stale);
    assert.deepEqual(reader.list({ disposition: "live", workflow: "person-lookup", limit: 1, cursor: page.cursor }), stale);
    state.generation++;
    assert.deepEqual(reader.list({ disposition: "live", limit: 1, cursor: page.cursor }), stale);
  });
});
