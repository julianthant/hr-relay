import { createOperationDisplayFixtures } from "../../../support/helpers/operation-display-fixtures.js";
import { describe, expect, it } from "vitest";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { RunEnvelopeSchema } from "../../../../src/models/run/envelope.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { requireWorkflowOperationDisplaySnapshot } from "../../../../src/models/workflow/operation-display-snapshot.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";

const { DISPLAY_FORWARD_ID, DisplayInput, DisplayCanonicalInput, outerWorkflow, displayManifest } = createOperationDisplayFixtures();


const operation = SearchPersonOrg.operation;
if (operation === undefined) throw new Error("SearchPersonOrg must declare its reusable display operation");

const forwardWorkflow = outerWorkflow(DISPLAY_FORWARD_ID, "forward");

function compileDisplayWorkflow(definition: Parameters<typeof compileWorkflow>[0]) {
  return compileWorkflow(definition, { manifest: displayManifest });
}

describe("workflow operation display declarations", () => {

  it("attaches the complete snapshot when buildQueuedRun mints the immutable envelope", () => {
    const compiled = compileDisplayWorkflow(forwardWorkflow);
    const run = buildQueuedRun({
      descriptor: compiled.descriptor,
      appVersion: "0.1.0",
      runId: "aaaaaaaa-0001-4000-8000-000100000000",
      itemId: "aaaaaaaa-0002-4000-8000-000200000000",
      traceId: "fdo-170000-aaaa",
      rawInput: { firstEid: "10800000", secondEid: "10800001" },
      canonicalInput: {
        protectedBindings: [],
        schemaHash: deriveSchemaHash(DisplayCanonicalInput, "output"),
        value: { firstEid: "10800000", secondEid: "10800001" },
      },
      ingressSchemaHash: deriveSchemaHash(DisplayInput, "input"),
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
    const snapshot = run.envelope.operationDisplaySnapshot;
    expect(snapshot).toBeDefined();
    expect(requireWorkflowOperationDisplaySnapshot(snapshot, {
      workflowId: compiled.descriptor.id,
      definitionFingerprint: compiled.descriptor.contractFingerprint,
    }).contentDigest).toBe(snapshot?.contentDigest);
    if (snapshot === undefined) throw new Error("complete run envelope has no snapshot");
    expect(() => RunEnvelopeSchema.parse({
      ...run.envelope,
      operationDisplaySnapshot: { ...snapshot, contentDigest: "0".repeat(64) },
    })).toThrow(/corrupt frozen operation display snapshot digest/u);
  });
});
