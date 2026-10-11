
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { AnyTaskContract } from "../../../src/models/task/task-contract.js";
import {
classifyEvidenceLeaf,
evidenceLeaves,
} from "../../../src/models/trust/evidence-classification.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import {
WriteFixtureCommit,
WriteFixtureSaveCommit,
} from "../../support/fixtures/write-sequencer-fixtures.js";

/* ── the write-proof redaction table is total over every commit contract ─── */

interface CommitLike {
  readonly contract: AnyTaskContract & {
    readonly writeSafety: {
      readonly completion: {
        readonly proofSchema: { parse: (value: unknown) => unknown };
        readonly proofFromOutput: (output: unknown) => unknown;
      };
    };
    readonly output: { parse: (value: unknown) => unknown };
    readonly example: unknown;
  };
}

function registeredCommitContracts(): readonly CommitLike["contract"][] {
  const contracts = new Map<string, CommitLike["contract"]>();
  for (const descriptor of WORKFLOW_DESCRIPTORS) {
    for (const node of descriptorRuntimeNodes(descriptor)) {
      if (node.kind !== "transaction") continue;
      const commit = node.commit.uses as CommitLike["contract"];
      contracts.set(String(commit.id), commit);
    }
  }
  return [...contracts.values()];
}

describe("the write-proof redaction table (declared, never guessed)", () => {

  for (const contract of registeredCommitContracts()) {
    it(`declares every leaf of ${String(contract.id)}'s example completion proof`, () => {
      const output = contract.output.parse(contract.example);
      const proof = contract.writeSafety.completion.proofSchema.parse(
        contract.writeSafety.completion.proofFromOutput(output),
      );
      const scope = { kind: "write-proof", taskId: contract.id } as const;
      for (const leaf of evidenceLeaves(proof)) {
        const declared = classifyEvidenceLeaf(scope, leaf.path);
        assert.ok(declared.classification.length > 0, `undeclared leaf ${leaf.path}`);
      }
    });
  }

  for (const fixture of [WriteFixtureCommit, WriteFixtureSaveCommit]) {
    it(`declares the sealed fixture contract ${String(fixture.id)}'s proof leaves`, () => {
      const proof = fixture.writeSafety.completion.proofSchema.parse(
        fixture.writeSafety.completion.proofFromOutput(fixture.output.parse(fixture.example)),
      );
      const scope = { kind: "write-proof", taskId: fixture.id } as const;
      for (const leaf of evidenceLeaves(proof)) {
        classifyEvidenceLeaf(scope, leaf.path);
      }
    });
  }

  it("negative control: an undeclared write-proof leaf is refused BY NAME, never dropped", () => {
    assert.throws(
      () => classifyEvidenceLeaf(
        { kind: "write-proof", taskId: "kuali/save-separation-finalization" } as never,
        "inventedLeaf",
      ),
      /no declared evidence classification for write-proof:kuali\/save-separation-finalization/u,
    );
  });
});
