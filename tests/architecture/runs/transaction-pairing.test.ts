
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import type { RuntimeScope } from "../../../src/models/workflow/graph.js";
import { deriveGraphCoveragePoints } from "../../../src/workflow-kit/validation/scenario-coverage.js";
import {
  absentProbeEvidence,
  WRITE_FIXTURE_EID,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_NOW,
  WRITE_FIXTURE_STAGED_STATE,
} from "../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../support/helpers/backend/write-sequencer-world.js";
import {
  FixtureCommit,
  FixtureReadReceipt,
  FixtureStage,
  fixtureDescriptor,
} from "../../support/fixtures/descriptor-fixtures.js";

const ALL = [...DESCRIPTORS, fixtureDescriptor];
const FixtureInput = z.strictObject({ eid: z.string().regex(/^10\d{6}$/) });


/** Standalone steps whose runtime contract is not a read, whatever the contract is named in source. */
function standaloneWriteSteps(descriptor: AnyWorkflowDescriptor): readonly string[] {
  return descriptorRuntimeNodes(descriptor)
    .flatMap((node) => {
      if (node.kind !== "task") return [];
      const effect: string = node.uses.effect;
      return effect === "read" ? [] : [`${descriptor.id}: step ${String(node.id)} uses ${node.uses.id} (${effect})`];
    });
}

const PREPARE_MARKER = String(WRITE_FIXTURE_STAGED_STATE);

/** True when a bind scope can see the prepare arm's output. */
function scopeSeesPrepareOutput(scope: unknown): boolean {
  return JSON.stringify(scope ?? null).includes(PREPARE_MARKER);
}

describe("transaction pairing", () => {
  it("pairs prepare and commit arms from one system under one lease", () => {
    let seen = 0;
    for (const descriptor of ALL) {
      for (const node of descriptorRuntimeNodes(descriptor)) {
        if (node.kind !== "transaction") continue;
        seen += 1;
        assert.equal(node.prepare.uses.effect, "prepare", String(node.id));
        assert.equal(node.commit.uses.effect, "commit", String(node.id));
        assert.equal(node.leaseScope, "transaction", String(node.id));
        const system = (id: string) => id.slice(0, id.indexOf("/"));
        assert.equal(system(node.prepare.uses.id), system(node.commit.uses.id), String(node.id));
        assert.ok(Number.isInteger(node.probeToFenceMaxMs) && node.probeToFenceMaxMs > 0, String(node.id));
        assert.ok(["always", "retries-and-recovery-only"].includes(node.probePolicy), String(node.id));
        assert.ok(["stop-after-prepare", "unsupported"].includes(node.dryRun), String(node.id));
        // The commit contract's own recovery probe must be a read in its system.
        assert.equal(node.commit.uses.writeSafety.idempotency.probe.effect, "read", String(node.id));
        assert.equal(
          system(node.commit.uses.writeSafety.idempotency.probe.taskId),
          system(node.commit.uses.id),
          String(node.id),
        );
      }
    }
    assert.ok(seen > 0, "the sweep must actually see a transaction");
  });

  it("keeps commit.bind blind to prepare output", async () => {
    const { harness, claimRunning, contextFor, cleanup } = createWriteSequencerTestWorld();
    try {
      const h = await harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      const context = contextFor(run, claim);
      const scopes: unknown[] = [];
      const bindAtCall: boolean[] = [];
      const commit = context.node.commit;
      const node = { ...context.node, commit: { ...commit, bind: (scope: RuntimeScope) => {
        scopes.push(scope);
        bindAtCall.push(scopeSeesPrepareOutput(scope));
        return commit.bind(scope);
      } } };
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      h.world.commitOutput = { transactionId: "T123456" };
      await h.execute({ ...context, node });
      assert.ok(h.world.events.includes("prepare"), "the prepare arm must actually run");
      assert.ok(h.world.events.some((event) => event.startsWith("commit-click:")), "the commit arm must actually run");
      assert.ok(scopes.length > 0, "commit.bind must be observed");
      assert.deepEqual(bindAtCall, scopes.map(() => false), "commit.bind saw prepare output when it ran");
      assert.equal(scopes.some(scopeSeesPrepareOutput), false, "the commit scope gained prepare output afterwards");
      assert.equal(scopeSeesPrepareOutput({ input: { eid: WRITE_FIXTURE_EID },
        outputs: { [WRITE_FIXTURE_NODE_ID]: { staged: true, stagedPageState: WRITE_FIXTURE_STAGED_STATE } } }), true,
      "the probe must recognise a scope that carries prepare output");
    } finally { await cleanup(); }
  });

  it("rejects a non-positive probe-to-fence budget", () => {
    for (const budget of [0, -1, 1.5]) {
      assert.throws(
        () => flow(FixtureInput)
          .step("probe", FixtureReadReceipt, {
            dependsOn: [],
            replay: "checkpoint",
            bind: ({ input }) => ({ eid: input.eid }),
          })
          .transaction("submit", {
            dependsOn: ["probe"],
            prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
            commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
            dryRun: "stop-after-prepare",
            probePolicy: "always",
            probeToFenceMaxMs: budget,
          }),
        /positive integer probeToFenceMaxMs budget/,
        `budget ${String(budget)}`,
      );
    }
  });

  it("keeps commit contracts out of every standalone step across the tree", () => {
    assert.deepEqual(ALL.flatMap(standaloneWriteSteps), []);
    const lookupReceipt = FixtureCommit;
    const renamed = flow(FixtureInput)
      .step("write", lookupReceipt as never, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
      .build({ schema: z.strictObject({ transactionId: z.string() }), dependsOn: ["write"], derive: () => ({ transactionId: "T1" }) });
    assert.throws(() => defineWorkflowDescriptor({ ...fixtureDescriptor, flow: renamed } as never),
      /step write uses a commit contract; only transactions may/,
      "a renamed commit contract used as a standalone step must be refused");
  });

  it("derives one scenario path per way a transaction can end", () => {
    for (const descriptor of ALL) {
      const nodes = descriptorRuntimeNodes(descriptor);
      const derived = deriveGraphCoveragePoints(nodes)
        .filter((point) => point.kind === "transaction")
        .map((point) => point.id);
      for (const node of nodes) {
        if (node.kind !== "transaction") continue;
        // Every commit can refuse a subject mismatch, settle once or find its key satisfied; preview is conditional.
        const expected = [
          ...(node.dryRun === "stop-after-prepare" ? [`transaction:${node.id}/dry-run`] : []),
          `transaction:${node.id}/subject-mismatch`,
          `transaction:${node.id}/committed`,
          `transaction:${node.id}/already-present`,
        ];
        for (const point of expected) assert.ok(derived.includes(point), `missing ${point}`);
      }
    }
  });
});
