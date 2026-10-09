/**
 * The subject-derived row title (ref dashboard-surfaces §1.2, and ref dashboard-surfaces's *Queue-row
 * projection as-built delta*).
 *
 * A queue row starts life titled with whatever the start input could compose —
 * `Separation 4502`, `EID 10873698` — and becomes the PERSON once the run's own
 * reads have settled who it is about. The seam is the descriptor's declared
 * `subjectProjection`, and the whole point of the tests below is that the
 * decision is made from that DECLARATION and a stored checkpoint, never from a
 * workflow branch, a field name, or a shape that "looks like" a name.
 *
 * The four outcomes, one case each: replaced, kept-because-not-yet,
 * kept-because-undeclared, and refused-because-the-declaration-is-wrong. Plus
 * the operator's own `displayName`, which is served BESIDE the title rather
 * than folded into it.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RunCheckpointRecordSchema } from "../../../../../../src/models/workflow/checkpoint.js";
import { buildRunDetail } from "../../../../../../src/backend/runs/queries/run-detail.js";
import { separationsKualiFinalizationDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { resolveSubjectTitle } from "../../../../../../src/backend/runs/projections/run-subject-title.js";
import type { AnyWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import { HASH_A, HASH_B, NOW } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  DAY,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";

const worlds: DashboardWorld[] = [];

/**
 * The registry every case resolves against. It defaults to the REAL
 * person-lookup descriptor, whose `subjectProjection` names
 * `searching.selection.selected.name` — a path through a discriminated union,
 * which is the ordinary shape of a resolved subject and the reason the factory
 * validates the address with `offers`.
 *
 * Every case that wants a DIFFERENT declaration hands over another REAL
 * descriptor rather than a spread copy of one: `descriptorRuntimeNodes` keys
 * its graph off the exact frozen object the factory produced, so a spread is a
 * descriptor whose nodes cannot be read.
 */
function world(descriptor: AnyWorkflowDescriptor | "none" = personLookupDescriptor): DashboardWorld {
  const created = makeWorld({
    descriptors: { resolve: () => (descriptor === "none" ? undefined : descriptor) },
  });
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/** A `searching` checkpoint holding whatever the run is said to have resolved. */
function searchingCheckpoint(seed: number, selection: unknown): unknown {
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: uuidOf(seed + 5000),
    nodeId: "searching",
    attempt: 1,
    claimGeneration: 1,
    runId: uuidOf(seed),
    output: {
      schemaHash: HASH_A,
      value: { query: { kind: "by-eid", emplId: "10873698" }, selection },
    },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance: [],
    writtenAt: NOW,
  });
}

const RESOLVED = {
  status: "resolved",
  selected: { emplId: "10873698", name: "Battistessa, Johnnie", hdh: true },
} as const;

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

describe("the subject-derived queue-row title (ref dashboard-surfaces §1.2)", () => {
  it("replaces the start-input title once the declared subject leaf has a checkpoint", () => {
    const w = world();
    seedRun(w, 1);
    assert.equal(rowOf(w, 1).title, "EID 10873698");

    w.authority.putCheckpoint(searchingCheckpoint(1, RESOLVED) as never);
    assert.equal(rowOf(w, 1).title, "Battistessa, Johnnie");
  });

  it("keeps the start-input title while the declared node has produced no checkpoint", () => {
    const w = world();
    seedRun(w, 2);
    // The ordinary state of every row for the first seconds of its life. There
    // is no blank arm and no placeholder: the run genuinely knows only the EID
    // it was started from.
    assert.equal(rowOf(w, 2).title, "EID 10873698");
  });

  it("keeps the start-input title when the run took the union arm the declared leaf does not live on", () => {
    const w = world();
    seedRun(w, 3);
    // `selected: null` is person-lookup's real not-found arm. A lookup that
    // resolved nobody has no subject to be named after, and the EID it was
    // started from is exactly what it should still be called.
    w.authority.putCheckpoint(searchingCheckpoint(3, {
      status: "not-found",
      selected: null,
      candidates: [],
    }) as never);
    assert.equal(rowOf(w, 3).title, "EID 10873698");
  });

  it("keeps the start-input title forever for a workflow that declares no subject leaf", () => {
    // A COMPLETE declared state, not a gap: the Kuali finalization harness's
    // subject IS its document, so it declares nothing and its rows are titled
    // by their start input for the whole life of the run.
    const w = world(separationsKualiFinalizationDescriptor);
    seedRun(w, 4);
    w.authority.putCheckpoint(searchingCheckpoint(4, RESOLVED) as never);
    assert.equal(rowOf(w, 4).title, "EID 10873698");
  });

  it("resolves nothing for a workflow this build holds no descriptor for", () => {
    const w = world("none");
    seedRun(w, 5);
    w.authority.putCheckpoint(searchingCheckpoint(5, RESOLVED) as never);
    // Same posture as `#pipeline`'s: a build that cannot read the declaration
    // must not invent an address into the checkpoint it happens to hold.
    assert.equal(rowOf(w, 5).title, "EID 10873698");
  });

  it("refuses by name when the declared leaf holds something that is not a name", () => {
    const w = world();
    seedRun(w, 6);
    // A checkpoint is canonical JSON, so nothing between the contract and this
    // read re-checks that the declared leaf is a string. Printing `42` — or
    // `[object Object]` — in the one column an operator scans is worse than
    // refusing, and the refusal names the workflow, the node and the path so
    // the DECLARATION is what gets fixed.
    w.authority.putCheckpoint(searchingCheckpoint(6, {
      status: "resolved",
      selected: { emplId: "10873698", name: 42, hdh: true },
    }) as never);
    assert.throws(
      () => rowOf(w, 6),
      /person-lookup declares its subject name at searching\.selection\.selected\.name.*number/s,
    );
  });

  it("names a structured value for what it is rather than stringifying it", () => {
    // The same refusal, taken at the seam that owns it: a declaration that
    // addresses a WRAPPER instead of its leaf is the likeliest way to author
    // this wrong, and `[object Object]` is the outcome being refused.
    assert.throws(
      () => resolveSubjectTitle(
        { nodeId: "searching", fieldPath: "selection.selected" },
        { workflowId: "person-lookup", itemId: uuidOf(5000) },
        {
          latestCheckpoint: () => searchingCheckpoint(1, RESOLVED) as never,
        },
      ),
      /declares its subject name at searching\.selection\.selected.*object/s,
    );
  });

  it("refuses by name when the declared leaf holds a blank string", () => {
    const w = world();
    seedRun(w, 7);
    w.authority.putCheckpoint(searchingCheckpoint(7, {
      status: "resolved",
      selected: { emplId: "10873698", name: "   ", hdh: true },
    }) as never);
    assert.throws(() => rowOf(w, 7), /blank string/);
  });

  it("serves the operator's own name BESIDE the title, never folded into it", () => {
    const w = world();
    seedRun(w, 8, { displayName: "Johnnie — final check" });
    w.authority.putCheckpoint(searchingCheckpoint(8, RESOLVED) as never);

    const row = rowOf(w, 8);
    // The row renders `displayName ?? title`; the subject stays on `title` so
    // the renamed row's tooltip can still say what the run is about. Folding
    // the two on the server is what made that tooltip unwritable.
    assert.deepEqual(row.displayName, { state: "present", value: "Johnnie — final check" });
    assert.equal(row.title, "Battistessa, Johnnie");
  });

  it("names the absence of an operator title rather than omitting it", () => {
    const w = world();
    seedRun(w, 9);
    assert.deepEqual(rowOf(w, 9).displayName, {
      state: "absent",
      reason: "the operator has not renamed this run",
    });
  });

  it("gives the run-detail header the same title the queue row shows", () => {
    const w = world();
    seedRun(w, 10);
    w.authority.putCheckpoint(searchingCheckpoint(10, RESOLVED) as never);

    const detail = buildRunDetail({ runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => personLookupDescriptor },
    }, uuidOf(10));
    // A row and the panel it opens are the pair an operator sees side by side;
    // two surfaces naming one run two ways is the divergence ref dashboard-surfaces's "one
    // projection" rule exists to prevent.
    assert.equal(detail.header.title, "Battistessa, Johnnie");
    assert.equal(detail.header.title, rowOf(w, 10).title);
  });

  it("carries the resolved title into the whole-day payload every count is derived from", () => {
    const w = world();
    seedRun(w, 11);
    w.authority.putCheckpoint(searchingCheckpoint(11, RESOLVED) as never);

    const wire = w.projection.buildDashboardDayWire(DAY);
    const row = wire.queueSurfaces.find((surface) => surface.runId === uuidOf(11));
    assert.equal(row?.title, "Battistessa, Johnnie");
  });
});
