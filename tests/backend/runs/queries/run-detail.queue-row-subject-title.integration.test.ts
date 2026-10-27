import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { DAY, makeWorld, queuedEventOf, runRecordOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

const { descriptor: subjectDescriptor, searchingCheckpoint, RESOLVED } = createSubjectTitleTestWorld();


const worlds: DashboardWorld[] = [];


async function world(descriptor: AnyWorkflowDescriptor | "none" = subjectDescriptor): Promise<DashboardWorld> {
  const created = await makeWorld({
    descriptors: { resolve: () => (descriptor === "none" ? undefined : descriptor) },
  });
  worlds.push(created);
  return created;
}

afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

function rowOf(w: DashboardWorld, seed: number) {
  const surface = w.projection.queueSurface(uuidOf(seed));
  if (surface === undefined) throw new Error(`no queue surface for seed ${String(seed)}`);
  return surface;
}

/** A run seeded with the plan's own title and nothing read yet. */
function seedRun(w: DashboardWorld, seed: number, input: { displayName?: string } = {}): void {
  queuedEventOf(w, { seed, title: "EID 10873698" });
  w.authority.put(runRecordOf({
    seed,
    version: 2,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  }));
}

describe("the subject-derived queue-row title (ref dashboard-surfaces)", () => {
  it("replaces the start-input title once the declared subject leaf has a checkpoint", async () => {
    const w = await world();
    seedRun(w, 1);
    assert.equal(rowOf(w, 1).title, "EID 10873698");

    w.authority.putCheckpoint(searchingCheckpoint(1, RESOLVED) as never);
    assert.equal(rowOf(w, 1).title, "Battistessa, Johnnie");
  });

  it("keeps the start-input title while the declared node has produced no checkpoint", async () => {
    const w = await world();
    seedRun(w, 2);

    assert.equal(rowOf(w, 2).title, "EID 10873698");
  });

  it("keeps the start-input title when the run took the union arm the declared leaf does not live on", async () => {
    const w = await world();
    seedRun(w, 3);

    w.authority.putCheckpoint(searchingCheckpoint(3, {
      status: "not-found",
      selected: null,
      candidates: [],
    }) as never);
    assert.equal(rowOf(w, 3).title, "EID 10873698");
  });

  it("keeps the start-input title forever for a workflow that declares no subject leaf", async () => {

    const w = await world(separationsKualiFinalizationDescriptor);
    seedRun(w, 4);
    w.authority.putCheckpoint(searchingCheckpoint(4, RESOLVED) as never);
    assert.equal(rowOf(w, 4).title, "EID 10873698");
  });

  it("resolves nothing for a workflow this build holds no descriptor for", async () => {
    const w = await world("none");
    seedRun(w, 5);
    w.authority.putCheckpoint(searchingCheckpoint(5, RESOLVED) as never);
    // Same posture as `#pipeline`'s: a build that cannot read the declaration
    // must not invent an address into the checkpoint it happens to hold.
    assert.equal(rowOf(w, 5).title, "EID 10873698");
  });

  it("refuses by name when the declared leaf holds something that is not a name", async () => {
    const w = await world();
    seedRun(w, 6);
    // Checkpoint JSON does not validate a declared string leaf; reject non-string titles at this read boundary.
    w.authority.putCheckpoint(searchingCheckpoint(6, {
      status: "resolved",
      selected: { emplId: "10873698", name: 42, hdh: true },
    }) as never);
    assert.throws(
      () => rowOf(w, 6),
      /person-lookup declares its subject name at searching\.selection\.selected\.name.*number/s,
    );
  });

  it("refuses by name when the declared leaf holds a blank string", async () => {
    const w = await world();
    seedRun(w, 7);
    w.authority.putCheckpoint(searchingCheckpoint(7, {
      status: "resolved",
      selected: { emplId: "10873698", name: "   ", hdh: true },
    }) as never);
    assert.throws(() => rowOf(w, 7), /blank string/);
  });

  it("serves the operator's own name BESIDE the title, never folded into it", async () => {
    const w = await world();
    seedRun(w, 8, { displayName: "Johnnie — final check" });
    w.authority.putCheckpoint(searchingCheckpoint(8, RESOLVED) as never);

    const row = rowOf(w, 8);

    assert.deepEqual(row.displayName, { state: "present", value: "Johnnie — final check" });
    assert.equal(row.title, "Battistessa, Johnnie");
  });

  it("names the absence of an operator title rather than omitting it", async () => {
    const w = await world();
    seedRun(w, 9);
    assert.deepEqual(rowOf(w, 9).displayName, {
      state: "absent",
      reason: "the operator has not renamed this run",
    });
  });

  it("gives the run-detail header the same title the queue row shows", async () => {
    const w = await world();
    const generic = runRecordOf({ seed: 10, version: 2 });
    const run = RunRecordSchema.parse({ ...generic, envelope: { ...generic.envelope,
      descriptorVersion: subjectDescriptor.version, contractFingerprint: subjectDescriptor.contractFingerprint } });
    w.authority.put(run);
    w.writer.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "EID 10873698" }));
    const checkpoint = RunCheckpointRecordSchema.parse(searchingCheckpoint(10, RESOLVED));
    w.authority.putCheckpoint({ ...checkpoint, descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint });

    const detail = buildRunDetail({ runReader: w.runReader, timeline: w.timeline,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => subjectDescriptor },
    }, uuidOf(10));

    assert.equal(detail.header.title, "Battistessa, Johnnie");
    assert.equal(detail.header.title, rowOf(w, 10).title);
  });

  it("carries the resolved title into the whole-day payload every count is derived from", async () => {
    const w = await world();
    seedRun(w, 11);
    w.authority.putCheckpoint(searchingCheckpoint(11, RESOLVED) as never);

    const wire = w.projection.buildDashboardDayWire(DAY);
    const row = wire.queueSurfaces.find((surface) => surface.runId === uuidOf(11));
    assert.equal(row?.title, "Battistessa, Johnnie");
  });
});
