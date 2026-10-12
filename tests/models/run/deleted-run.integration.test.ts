import { createSeededDashboardWorld } from "../../support/helpers/seeded-dashboard-world.js";
import { DeletedRunRecordSchema, type DeletedRunRecord } from "../../../src/models/run/deleted-run.js";
import { inMemoryRunReaderFake } from "../../support/helpers/canonical-run-reader.js";
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { DAY, instantOffsetOf, makeWorld, taskEventsOf, uuidOf, type DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";

const { queuedEventOf } = createSeededDashboardWorld();


const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

describe("the fold arms a moving run reaches (ref dashboard-surfaces §2.2)", () => {

  it("hands the client a fresh snapshot when a canonically deleted row leaves the payload", () => {
    const w = world();
    const deleted = new Map<string, DeletedRunRecord>();
    const canonical = inMemoryRunReaderFake({ ...w.runReaderState, deleted });
    vi.spyOn(w.runReader, "read").mockImplementation(canonical.read);
    queuedEventOf(w, { seed: 1 });
    queuedEventOf(w, { seed: 2 });
    taskEventsOf(w, 1, "searching");
    const before = w.changes.length;
    for (const seed of [1, 2]) {
      const run = w.authority.getRun(uuidOf(seed)); assert.ok(run);
      w.authority.records.delete(run.envelope.runId);
      deleted.set(run.envelope.runId, DeletedRunRecordSchema.parse({
        runId: run.envelope.runId, workflow: run.envelope.workflow, traceId: run.envelope.traceId,
        itemId: run.envelope.itemId, attempt: run.envelope.attempt, runNumber: run.runNumber ?? null,
        ordinalSource: "tombstone", origin: "queue", commandId: uuidOf(800 + seed),
        deletedAt: instantOffsetOf(0), tallyVersion: 3, removed: [{ table: "runs", rows: 1 }],
      }));
      w.projection.refreshRun(run.envelope.runId);
    }
    w.projection.refreshRun(uuidOf(99));
    assert.deepEqual(w.changes.slice(before).map(({ kind }) => kind), ["snapshot", "snapshot"]);
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(day.queueSurfaces, []);
    assert.deepEqual(day.statusCounts, []);
    assert.deepEqual(day.workflowCounts, []);
  });
});
