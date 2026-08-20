/**
 * D258 — TWO executions at ONE span identity, and the id that has to tell them
 * apart (doc 03 §2.3; separations §9.22 item 6).
 *
 * The shape seeded here is not hypothetical. Run
 * `00419600-ef68-4e7d-8528-4705ad462bf5` / `sp-080639-0041`, enqueued
 * 2026-08-14T15:06:55Z, holds **two** `span.started` and **two** `span.ended`
 * at the identical `(attempt 1, sp-080639-0041/timecard-search#1)`: a pre-D214
 * gate resume re-executing an `always-rerun` node, both executions emitting the
 * same span path because the path did not yet carry the claim generation.
 *
 * D123's note identity therefore derived ONE id for two events, so
 * `RunDetailWireSchema`'s uniqueness refinement refused the whole wire — that
 * run's detail answered HTTP 400 — and because a version bump is one atomic act
 * over every prior-version run and the archive freezes the record through this
 * same projection, ONE unreadable run refused `apply-version-bump` with
 * `SCHEMA_INVALID` for the entire workflow. Zero runs could archive, forever.
 *
 * Those lines are durable history and are never rewritten. The fix is at the
 * FOLD and it is read forward: the first execution at a seed keeps the id it
 * has always had, and each further one appends `~<n>`.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunDetail } from "../../../src/server/dashboard/queries/run-detail.js";
import { createArchiveSnapshotSource } from "../../../src/server/dashboard/queries/archive.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";
import {
  claimEventOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

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
/** The pre-D214 path: `<trace>/<node>#<taskAttempt>`, with no claim generation. */
const SPAN_PATH = `${traceOf(SEED)}/${NODE}#1`;

function deps(w: DashboardWorld) {
  return {
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => undefined },
  };
}

/**
 * ONE execution of the node, emitted at the SAME identity every time.
 *
 * Each execution goes through its OWN `createSpanJsonlWriter`, because that is
 * how the real file came to hold two: the writer's identity write-once set is
 * per PROCESS, and a gate resume is a fresh claim that a restarted (or second)
 * worker process serves. The lines are written by the production writer, so the
 * fixture is real durable history rather than hand-rolled JSON.
 */
function executeOnce(w: DashboardWorld, pid: number, ms: number): void {
  const writer = createSpanJsonlWriter({ stateRoot: w.stateRoot, clock: w.clock, pid });
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
  w.projection.ingestFromDisk();
}

/** The poisoned run, terminal exactly as the real one is. */
function poisonedWorld(): DashboardWorld {
  const w = world();
  queuedEventOf(w, { seed: SEED });
  claimEventOf(w, SEED);
  executeOnce(w, 4242, 4_000);
  // The gate park and its resume: a second execution of the SAME node, inside
  // one attempt, at an identity nothing distinguished before D214.
  executeOnce(w, 4243, 9_000);
  w.authority.put(runRecordOf({
    seed: SEED,
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 60_000) },
  }));
  return w;
}

describe("D258 — a pre-D214 run with two executions at one span identity", () => {
  it("PARSES, where the whole wire used to be refused", () => {
    // The regression in one line: before this, `buildRunDetail` threw
    // `timeline note ids must be unique` and the run's panel was HTTP 400.
    const w = poisonedWorld();
    const detail = buildRunDetail(deps(w), uuidOf(SEED));
    assert.equal(detail.runId, uuidOf(SEED));
  });

  it("renders TWO executions, because that is what the stream records", () => {
    const w = poisonedWorld();
    const { events } = buildRunDetail(deps(w), uuidOf(SEED)).timeline;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.label), [NODE, NODE]);
    // Each execution is a fact about ITSELF (D255 at the fold, D258 at the id):
    // its own start, its own end, its own measurement — never one entry wearing
    // the first execution's start and the second's end.
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
    // The read-forward proof, in D214's own shape: an ordinal of 1 appends
    // nothing, so every id this projection has ever derived — and every id an
    // archived record froze — is the id it still derives.
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
    // A version bump is one atomic act over every prior-version run, and the
    // archive freezes the record through this projection — so this derivation
    // succeeding is the difference between `apply-version-bump` archiving 19
    // runs and refusing all of them with `SCHEMA_INVALID`.
    const w = poisonedWorld();
    const snapshot = createArchiveSnapshotSource(deps(w)).snapshot(uuidOf(SEED));
    assert.equal(snapshot.detail.timeline.events.length, 2);
    assert.equal(
      new Set(snapshot.detail.timeline.events.map((event) => event.noteId)).size,
      2,
    );
  });
});
