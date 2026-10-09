import { RunRecordSchema } from "../../../../../../src/models/run/record.js";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunDetail } from "../../../../../../src/backend/runs/queries/run-detail.js";
import { createArchiveSnapshotSource } from "../../../../../../src/backend/runs/queries/archive-snapshot.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import {
  claimEventOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const SEED = 1;
const NODE = "timecard-search";

const SPAN_PATH = `${traceOf(SEED)}/${NODE}#1`;

function deps(w: DashboardWorld) {
  return { runReader: w.runReader,
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => undefined },
  };
}

// Distinct producers can emit the same span identity; each execution retains its own durable sequence.
function executeOnce(w: DashboardWorld, pid: number, ms: number): void {
  const writer = createTimelineEmitter({ repository: w.timeline, clock: w.clock, pid });
  const base = {
    workflow: "person-lookup" as const,
    runId: uuidOf(SEED),
    traceId: traceOf(SEED),
    attempt: 1,
    spanPath: SPAN_PATH,
    parentSpanPath: traceOf(SEED),
    kind: "task" as const,
  };
  writer.emit({ ...base, t: "span.started", ts: w.clock.now().toISOString(), name: NODE });
  w.clock.advanceWall(ms);
  writer.emit({ ...base, t: "span.ended", ts: w.clock.now().toISOString(), outcome: "done" });
  w.clock.advanceWall(1_000);
  w.projection.ingestFromTimeline();
}

/** The poisoned run, terminal exactly as the real one is. */
function poisonedWorld(): DashboardWorld {
  const w = world();
  queuedEventOf(w, { seed: SEED });
  claimEventOf(w, SEED);
  executeOnce(w, 4242, 4_000);

  executeOnce(w, 4243, 9_000);
  const endedAt = instantOffsetOf(0, 60_000);
  w.authority.put(RunRecordSchema.parse({ ...runRecordOf({ seed: SEED }),
    lifecycle: { state: "terminal", outcome: "done", endedAt }, version: 2, claimGeneration: 1, updatedAt: endedAt,
    completion: { schemaVersion: 1, kind: "done", expectedVersion: 1, claim: { workerId: "worker-1", claimGeneration: 1 }, authorizedAt: endedAt, resultDigest: "a".repeat(64) },
  }));
  return w;
}

describe("two executions sharing one span identity in a checkpoint without claim generation", () => {
  it("parses a timeline with repeated execution identities", () => {

    const w = poisonedWorld();
    const detail = buildRunDetail(deps(w), uuidOf(SEED));
    assert.equal(detail.runId, uuidOf(SEED));
  });

  it("renders TWO executions, because that is what the stream records", () => {
    const w = poisonedWorld();
    const { events } = buildRunDetail(deps(w), uuidOf(SEED)).timeline;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.label), [NODE, NODE]);

    assert.deepEqual(
      events.map((event) => event.durationMs),
      [{ state: "present", ms: 4_000 }, { state: "present", ms: 9_000 }],
    );
  });

  it("gives the two executions DISTINCT note ids", () => {
    const w = poisonedWorld();
    const ids = buildRunDetail(deps(w), uuidOf(SEED)).timeline.events.map((event) => event.noteId);
    assert.equal(new Set(ids).size, 2);
  });

  it("leaves the FIRST execution's id byte-identical — the ordinal is read forward", () => {
    // Ordinal 1 adds no suffix, preserving existing timeline identities.
    const single = world();
    queuedEventOf(single, { seed: SEED });
    claimEventOf(single, SEED);
    executeOnce(single, 4242, 4_000);
    const before = buildRunDetail(deps(single), uuidOf(SEED)).timeline.events;

    const w = poisonedWorld();
    const after = buildRunDetail(deps(w), uuidOf(SEED)).timeline.events;
    assert.equal(after[0]?.noteId, before[0]?.noteId);
    assert.notEqual(after[1]?.noteId, before[0]?.noteId);
  });

  it("DERIVES the archive snapshot, which is what the bump refused for the whole workflow", () => {

    const w = poisonedWorld();
    const snapshot = createArchiveSnapshotSource(deps(w)).snapshot(uuidOf(SEED));
    assert.equal(snapshot.detail.timeline.events.length, 2);
    assert.equal(
      new Set(snapshot.detail.timeline.events.map((event) => event.noteId)).size,
      2,
    );
  });
});
