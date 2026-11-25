import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { defineTaskContract, ContractFieldPathSchema } from "../../../src/models/task/task-contract.js";
import { EidSchema, taskId, TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";
import { WRITE_FIXTURE_OBSERVATION, writeFixtureDescriptor, writeFixtureSaveDescriptor } from "../../support/fixtures/write-sequencer-fixtures.js";

const ALL_DESCRIPTORS = [
  ...DESCRIPTORS,
  fixtureDescriptor,
  writeFixtureDescriptor,
  writeFixtureSaveDescriptor,
];

describe("static subject declarations", () => {
  it("pairs compatible prepare/commit subjects observed after prepare, in one system", () => {
    let transactions = 0;
    for (const descriptor of ALL_DESCRIPTORS) {
      for (const node of descriptorRuntimeNodes(descriptor)) {
        if (node.kind !== "transaction") continue;
        transactions += 1;
        const prepare = node.prepare.uses.subject;
        const commit = node.commit.uses.subject;
        const label = `${descriptor.id}/${String(node.id)}`;
        if (commit.kind === "none") {
          assert.ok(commit.reviewedReasonId !== undefined, `${label}: unscoped commit needs a reviewed reason`);
          continue;
        }
        // Compatible: the prepare arm declares the same subject class over the
        // same observation and expected identity as the commit arm.
        assert.notEqual(prepare.kind, "none", `${label}: prepare cannot be unscoped when commit binds a subject`);
        if (prepare.kind !== "none") {
          assert.equal(prepare.kind, commit.kind, label);
          assert.equal(String(prepare.observe), String(commit.observe), label);
          assert.equal(prepare.expected.identity, commit.expected.identity, label);
          assert.equal(String(prepare.expected.fromInput), String(commit.expected.fromInput), label);
        }
        // The observation resolves in the commit's own system, and the proof
        // is required after prepare and before the fence.
        const system = node.commit.uses.id.slice(0, node.commit.uses.id.indexOf("/"));
        assert.ok(String(commit.observe).startsWith(`${system}.`), label);
        assert.equal(commit.requiredAt, "after-prepare-before-fence", label);
      }
    }
    assert.ok(transactions >= 2, "the sweep must actually see transaction nodes");
  });

  it("refuses unscoped commits without a reviewed allowlisted reason, fail-both-ways", () => {
    const ProofSchema = z.strictObject({ receipt: z.string().min(1) });
    const base = {
      title: "Unscoped Fixture",
      effect: "commit" as const,
      input: z.strictObject({ eid: EidSchema }),
      output: ProofSchema,
      errorCodes: ["submit-failed"] as const,
      scenarios: ["ucpath/write-fixture-happy"],
      writeSafety: {
        completion: {
          kind: "receipt" as const,
          proofSchema: ProofSchema,
          proofFromOutput: (output: z.output<typeof ProofSchema>) => output,
          proofFromPresentProbe: ({ proof }: { proof: z.output<typeof ProofSchema> }) => proof,
          outputFromProof: (proof: z.output<typeof ProofSchema>) => proof,
        },
        idempotency: {
          probe: { taskId: TaskIdSchema.parse("ucpath/read-write-fixture-probe"), effect: "read" as const },
          key: ({ eid }: { eid: string }) => `${eid}|unscoped-fixture`,
          recoveryAbsence: { kind: "operator-only" as const, reason: "fixture" },
        },
      },
      example: { receipt: "R1" },
    };
    // Free text is not review.
    assert.throws(() => defineTaskContract({
      ...base,
      id: taskId("ucpath/submit-unscoped-free-text"),
      subject: { kind: "none" as const, reason: "someone said it was fine" },
    }), /reviewed UnscopedCommitReasonId/);

    const unregistered: unknown = {
      ...base,
      id: taskId("ucpath/submit-unscoped-unregistered"),
      subject: { kind: "none", reviewedReasonId: "made-up-reason" },
    };
    assert.throws(() => defineTaskContract(unregistered as Parameters<typeof defineTaskContract>[0]));
    // And a person-scoped commit must be observed after prepare, before fence.
    assert.throws(() => defineTaskContract({
      ...base,
      id: taskId("ucpath/submit-early-subject"),
      subject: {
        kind: "person" as const,
        expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" as const },
        observe: WRITE_FIXTURE_OBSERVATION,
        match: "normalized-exact-eid" as const,
        requiredAt: "before-subject-read" as const,
      },
    }), /observed after prepare and before fence/);
  });
});
