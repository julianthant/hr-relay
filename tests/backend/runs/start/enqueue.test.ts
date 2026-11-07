import { describe, expect, it } from "vitest";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { RunEnvelopeSchema } from "../../../../src/models/run/envelope.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { Plan1CanonicalInput, Plan1Input, plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";

describe("queued run envelope", () => {
  it("stamps no operation display and still reads one recorded on an older run", () => {
    const value = { emplId: "10800000", text: "same", mode: "ok" };
    const run = buildQueuedRun({
      descriptor: plan1Leaf.descriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0001-4000-8000-000100000000",
      itemId: "aaaaaaaa-0002-4000-8000-000200000000",
      traceId: "fpo-170000-aaaa",
      rawInput: value,
      canonicalInput: { protectedBindings: [], schemaHash: deriveSchemaHash(Plan1CanonicalInput, "output"), value },
      ingressSchemaHash: deriveSchemaHash(Plan1Input, "input"),
      configFingerprint: "a".repeat(64),
      configSnapshotId: "aaaaaaaa-0003-4000-8000-000300000000",
      resolvedInstance: { ucpath: "prod" },
      shape: "single",
      priority: "bulk",
      dryRun: false,
      attempt: 1,
      runNumber: 1,
      now: "2026-09-27T12:00:00.000Z",
    });
    expect(run.envelope.operationDisplayCapability).toBeUndefined();
    expect(run.envelope.operationDisplaySnapshot).toBeUndefined();
    const recorded = { ...run.envelope, operationDisplayCapability: "complete", operationDisplaySnapshot: { contentDigest: "0".repeat(64) } };
    expect(RunEnvelopeSchema.parse(recorded)).toEqual(recorded);
  });
});
