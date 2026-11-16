import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { redactObservedDataPoints } from "../../../../src/backend/logs/observed-data.js";
import { I9ReadSection2Signer } from "../../../../src/models/systems/i9/read-section2-signer.js";
import { ReadI9LookupResult } from "../../../../src/models/workflows/i9-lookup/read-result.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { i9LookupWorkflow } from "../../../../src/workflows/i9-lookup/workflow.js";
import { readI9LookupResultTask } from "../../../../src/workflows/i9-lookup/tasks/read-result.js";

describe("I-9 Lookup result task", () => {
  it("retains the exact signer observation and its original freshness without another browser session", async () => {
    const descriptor = compileWorkflow(i9LookupWorkflow).descriptor;
    const signer = I9ReadSection2Signer.output.parse(I9ReadSection2Signer.example);
    const observedAt = "2026-11-01T12:00:00.000Z";
    const runId = "aaaaaaaa-0001-4000-8000-000100000000";
    const checkpoint = RunCheckpointRecordSchema.parse({
      workflowId: descriptor.id, itemId: "33333333-3333-4333-8333-333333333333", nodeId: "lookup-source",
      attempt: 1, claimGeneration: 1, runId,
      output: { schemaHash: deriveSchemaHash(I9ReadSection2Signer.output, "output"), value: signer },
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
      implFingerprint: "a".repeat(64), writtenAt: observedAt,
      provenance: Object.keys(signer).map(path => ({ path, source: "live", observedAt, originalObservedAt: observedAt })),
    });
    const collector = createTaskProvenanceCollector({
      descriptor, execution: { runId, traceId: "il-190000-aaaa", attempt: 1, workflowId: descriptor.id, nodeId: "lookup", taskId: ReadI9LookupResult.id },
      upstreamEvidence: { checkpoints: [checkpoint] }, clock: manualClock(new Date("2026-11-01T12:01:00Z")),
      onRecord: batch => { redactObservedDataPoints(ReadI9LookupResult.id, batch.points); },
    });
    const output = await readI9LookupResultTask.impl.run({ input: { signer }, ctx: {
      signal: new AbortController().signal, log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
      fail: (_code, message): never => { throw new Error(message); }, recordData: collector.recordData,
    } });
    assert.equal(output, signer);
    const proof = collector.finalizeRead(output);
    assert.deepEqual(proof.provenance.map(fact => fact.path).sort(), Object.keys(signer).sort());
    for (const fact of proof.provenance) {
      assert.equal(fact.source, "derived");
      assert.equal(fact.originalObservedAt, observedAt);
    }
  });
});
