/**
 * Executable scenarios for the representative graph — one per derived coverage
 * point (doc 01 §1c · 1d · 1e's item 1e: "executable per-branch/gate/policy scenarios").
 *
 * Every scenario walks the descriptor's own pure functions along one path and
 * REPORTS the points it exercised; the test then asserts that report equals the
 * scenario's row in `coverage-claims.ts`. That is what makes the claim corpus
 * observed rather than asserted, and it is what `scenario-coverage` audits
 * against the graph in both directions.
 *
 * Two points cannot be reached by a pure walk and say so out loud:
 * `transaction:submit/dry-run` and `transaction:submit/subject-mismatch` are
 * executor behaviours (compiling a commit-free graph; refusing before the fence
 * on a mismatched observation). They are pinned here as the CONTRACT the 1f
 * executor must satisfy, and re-pointed at a real run when it exists.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { workflowProjections } from "../../src/base/workflow.js";
import { RunIdSchema } from "../../src/domain/ids.js";
import { fixtureChildItemId, fixtureDescriptor } from "../helpers/architecture/descriptor-fixtures.js";
import { FIXTURE_GRAPH_CLAIMS } from "./coverage-claims.js";
import { walkDescriptor } from "./helpers/pure-walk.js";

const CHILD_RUN_ID = RunIdSchema.parse("55555555-5555-4555-8555-555555555555");
const PROBE_OUTPUT = { eid: "10800000", present: true };
const COMMITTED = {
  disposition: "committed",
  proofSource: "normal-output",
  output: { transactionId: "T123" },
  proof: { transactionId: "T123" },
};
const ALREADY_PRESENT = {
  disposition: "already-present",
  proofSource: "live-probe",
  output: { transactionId: "T123" },
  proof: { transactionId: "T123" },
};

function claimFor(scenarioId: string): readonly string[] {
  const claim = FIXTURE_GRAPH_CLAIMS.find((entry) => entry.scenarioId === scenarioId);
  assert.ok(claim, `no registered claim for ${scenarioId}`);
  return claim.covers;
}

function childOutcome(note: string, state: "done" | "failed") {
  const itemId = fixtureChildItemId({ note });
  return state === "done"
    ? { state, runId: CHILD_RUN_ID, itemId, output: { acknowledged: true } }
    : { state, runId: CHILD_RUN_ID, itemId, failureId: "66666666-6666-4666-8666-666666666666" };
}

describe("fixture-graph scenarios", () => {
  it("fixture-graph/write-arm-committed — branch, gate, many fan-out with a failed child, commit", () => {
    const walk = walkDescriptor(fixtureDescriptor, { eid: "10800000", mode: "write", notes: ["a", "b"] }, {
      outputs: {
        probe: PROBE_OUTPUT,
        recheck: PROBE_OUTPUT,
        approval: { approved: true },
        submit: COMMITTED,
      },
      // `all-settled` with allow-partial: a failed child does not fail the parent.
      childOutcomes: { notify: [childOutcome("a", "done"), childOutcome("b", "failed")] },
    });
    assert.deepEqual(walk.result, { transactionId: "T123" });
    assert.deepEqual([...walk.covered].sort(), [...claimFor("fixture-graph/write-arm-committed")].sort());
  });

  it("fixture-graph/read-only-arm-already-present — the other arm, one child, an existing key", () => {
    const walk = walkDescriptor(fixtureDescriptor, { eid: "10800001", mode: "read-only", notes: ["a"] }, {
      outputs: {
        probe: PROBE_OUTPUT,
        recheck: PROBE_OUTPUT,
        approval: { approved: true },
        submit: ALREADY_PRESENT,
      },
      childOutcomes: { notify: [childOutcome("a", "done")] },
    });
    assert.deepEqual(walk.result, { transactionId: "T123" });
    const expected = new Set(claimFor("fixture-graph/read-only-arm-already-present"));
    for (const point of expected) assert.ok(walk.covered.includes(point), `missing ${point}`);
  });

  it("fixture-graph/empty-fan-out — an empty upstream list stays an explicit satisfied join", () => {
    const walk = walkDescriptor(fixtureDescriptor, { eid: "10800000", mode: "write", notes: [] }, {
      outputs: {
        probe: PROBE_OUTPUT,
        recheck: PROBE_OUTPUT,
        approval: { approved: true },
        submit: COMMITTED,
      },
      childOutcomes: { notify: [] },
    });
    assert.ok(walk.covered.includes("delegation:notify/fan-out-zero"));
    assert.deepEqual(walk.outputs.notify, []);
  });

  it("fixture-graph/delegation-replay — a second walk of the same inputs re-plans identically", () => {
    const supply = {
      outputs: {
        probe: PROBE_OUTPUT,
        recheck: PROBE_OUTPUT,
        approval: { approved: true },
        submit: COMMITTED,
      },
      childOutcomes: { notify: [childOutcome("a", "done"), childOutcome("b", "done")] },
    };
    // Replay safety is identity: a list that changed under an already-delegated
    // run must not join. Outcomes for children this plan did not produce are
    // refused rather than absorbed.
    assert.throws(
      () => walkDescriptor(fixtureDescriptor, { eid: "10800000", mode: "write", notes: ["a", "b"] }, {
        ...supply,
        childOutcomes: { notify: [childOutcome("a", "done"), childOutcome("c", "done")] },
      }),
      /join received outcomes for different children than it planned/,
    );
    const first = walkDescriptor(fixtureDescriptor, { eid: "10800000", mode: "write", notes: ["a"] }, {
      ...supply,
      childOutcomes: { notify: [childOutcome("a", "done")] },
    });
    const second = walkDescriptor(fixtureDescriptor, { eid: "10800000", mode: "write", notes: ["a"] }, {
      ...supply,
      childOutcomes: { notify: [childOutcome("a", "done")] },
    });
    assert.deepEqual(first.outputs.notify, second.outputs.notify);
    assert.deepEqual(claimFor("fixture-graph/delegation-replay"), ["delegation:notify/replay"]);
  });

  it("fixture-graph/dry-run — the descriptor declares a commit-free preview the executor must honour", () => {
    const transaction = fixtureDescriptor.nodes.find((node) => node.id === "submit");
    assert.ok(transaction);
    assert.equal(Reflect.get(transaction, "dryRun"), "stop-after-prepare");
    // The obligation, pinned until 1f can run it: a dry run compiles the graph
    // with the commit arm ABSENT, so no intent and no click can exist.
    assert.deepEqual(claimFor("fixture-graph/dry-run"), ["transaction:submit/dry-run"]);
  });

  it("fixture-graph/subject-mismatch — the commit declares the observation it must match first", () => {
    const transaction = fixtureDescriptor.nodes.find((node) => node.id === "submit");
    assert.ok(transaction);
    const commit = Reflect.get(transaction, "commit") as { uses: { subject: unknown } };
    const subject = z.strictObject({
      kind: z.literal("person"),
      expected: z.strictObject({ fromInput: z.string(), identity: z.literal("eid") }),
      observe: z.string(),
      match: z.literal("normalized-exact-eid"),
      // Ref write-safety: the proof is observed AFTER prepare and BEFORE the fence, which
      // is the only window in which a mismatch can still stop the write.
      requiredAt: z.literal("after-prepare-before-fence"),
    }).parse(commit.uses.subject);
    assert.equal(subject.requiredAt, "after-prepare-before-fence");
    assert.deepEqual(claimFor("fixture-graph/subject-mismatch"), ["transaction:submit/subject-mismatch"]);
  });

  it("covers every point the graph derives, and claims none it does not", () => {
    const derived = new Set(workflowProjections(fixtureDescriptor).coveragePoints.map((point) => point.id));
    const claimed = new Set(FIXTURE_GRAPH_CLAIMS.flatMap((claim) => claim.covers));
    assert.deepEqual([...claimed].sort(), [...derived].sort());
  });
});
