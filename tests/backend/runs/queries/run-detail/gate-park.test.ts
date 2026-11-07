import assert from "node:assert/strict";
import { it } from "vitest";
import { buildGateParkSection } from "../../../../../src/backend/runs/queries/run-detail/gate-park.js";
import type { RunDetailQueryDeps } from "../../../../../src/backend/runs/queries/run-detail-types.js";
import { descriptorRuntimeNodes } from "../../../../../src/workflow-kit/workflow.js";
import { WriteIntentRecordSchema, deriveWriteBindingProofDigest } from "../../../../../src/rules/write-safety/write-safety.js";
import { FIXTURE_PARKED_WRITE_INTENT } from "../../../../support/fixtures/dashboard/run-detail/gates-park.js";
import { runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { separationsDescriptor } from "../../../../support/helpers/registered-workflows.js";

it("serves typed-ID support from the exact runtime completion contract for each parked transaction", () => {
  const original = WriteIntentRecordSchema.parse(FIXTURE_PARKED_WRITE_INTENT);
  assert.ok(original.status === "parked");
  const nodes = descriptorRuntimeNodes(separationsDescriptor).filter(node => node.kind === "transaction");
  assert.ok(nodes.length >= 3);
  for (const node of nodes) {
    const run = runRecordOf({ seed: 1, workflow: "separations", descriptor: separationsDescriptor,
      lifecycle: { state: "parked-write", writeIntentId: original.writeIntentId,
        intentGeneration: 1, parkedAt: original.updatedAt, code: "unknown", message: "Uncertain" } });
    const bindingProof = { ...original.bindingProof, runId: run.envelope.runId, attempt: run.envelope.attempt };
    const intent = WriteIntentRecordSchema.parse({ ...original, runId: run.envelope.runId,
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, taskId: node.commit.uses.id,
      bindingProof, bindingProofDigest: deriveWriteBindingProofDigest(bindingProof) });
    const deps = { runReader: { read: () => ({ state: "present", run }) }, authority: { getWriteIntent: () => intent },
      timeline: { withReadSnapshot: <T>(read: () => T) => read(), highWaterMark: () => 0, page: () => [] },
      descriptors: { resolve: () => undefined },
      canonical: { descriptors: { resolve: () => separationsDescriptor } },
    } as unknown as RunDetailQueryDeps;
    const response = buildGateParkSection(deps, run.envelope.runId, "parked-write");
    assert.ok(response.section === "parked-write");
    assert.equal(response.payload.acceptsTransactionId, node.commit.uses.id === "ucpath/create-termination", node.commit.uses.id);
    const mismatched = { ...deps, canonical: { ...deps.canonical!, descriptors: { resolve: () => undefined } } };
    const unavailable = buildGateParkSection(mismatched, run.envelope.runId, "parked-write");
    assert.ok(unavailable.section === "parked-write"); assert.equal(unavailable.payload.acceptsTransactionId, false);
  }
});
