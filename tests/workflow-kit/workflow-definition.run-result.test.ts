import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import {
buildRunResult,
} from "../../src/backend/runs/lifecycle/run-result.js";
import { RunRecordSchema } from "../../src/models/run/record.js";
import { ReadOnboardingDatesOutputSchema } from "../../src/models/systems/crm/read-onboarding-dates.js";
import { deriveSchemaHash } from "../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { ReadActiveStatus } from "../../src/models/workflows/person-lookup/read-active-status.js";
import { ItemIdSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow,defineWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { workflowTerminalResultExecution } from "../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";
import { HASH_B,LATER,NOW } from "../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../support/fixtures/workflow-definition-fixtures.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";

const CLOCK = manualClock(new Date(LATER));
const ACTIVE = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

function runningRun(includeCrmDates = false) {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        ...QUEUED_RUN.input.parsed,
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates },
      },
    },
    lifecycle: {
      state: "running",
      workerId: "worker-1",
      claimedAt: NOW,
      heartbeatAt: LATER,
      currentNodeId: "crm-dates",
    },
    claimGeneration: 1,
    version: 4,
    updatedAt: LATER,
  });
}

function checkpoint(nodeId: "active-status" | "crm-dates", value: unknown) {
  const schema = nodeId === "active-status" ? ReadActiveStatus.output : ReadOnboardingDatesOutputSchema;
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: QUEUED_RUN.envelope.itemId,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: QUEUED_RUN.envelope.runId,
    output: { schemaHash: deriveSchemaHash(schema, "output"), value: schema.parse(value) },
    descriptorVersion: 1,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
}


describe("canonical awaited child terminal evidence", () => {
  const parentDefinition = (cardinality: "one" | "many" = "one") => defineWorkflow({
    id: "fixture-child-result-parent", version: 1, code: "fcr", label: "Child result parent", icon: "Search", category: "operations",
    input: personLookupDescriptor.input, canonicalInput: PersonLookupCanonicalInput, inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {}, details: [], identity: { matchKey: () => "child-fixture" }, presentation: { title: () => "Child parent" },
    scenarios: ["fixture-child-result/parent"], role: defineWorkflowRole({ kind: "standalone" }),
    steps: ({ delegate, result }) => {
      const common = { id: "child", target: { id: personLookupDescriptor.id, input: personLookupDescriptor.input, result: workflowTerminalResultExecution(personLookupDescriptor).schema }, edgeId: "fixture-child-result-edge", await: "terminal" as const,
        policy: { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const, afterChildRetry: "resume-parent" as const, visibility: "inline" as const } };
      const child = cardinality === "one"
        ? delegate({ ...common, cardinality: "one", join: "one" }, [], { bind: ({ input }) => input, deriveChildItemId: () => ItemIdSchema.parse(QUEUED_RUN.envelope.itemId) })
        : delegate({ ...common, cardinality: "many", join: "all" }, [], { bind: ({ input }) => [input], deriveChildItemId: () => ItemIdSchema.parse(QUEUED_RUN.envelope.itemId) });
      return { steps: [[{ key: "child", label: "Child" }, [child]]],
        result: result(z.strictObject({ state: z.literal("done") }), [child], ({ outputs }) => z.object({ state: z.literal("done") }).parse(outputs.child)) };
    },
  });
  const parentDescriptor = compileWorkflow(parentDefinition(), { manifest: fixtureBuildManifest(["fixture-child-result-parent"]) }).descriptor;
  const parentRun = () => ({ ...runningRun(), envelope: { ...runningRun().envelope, runId: "00000000-0000-4000-8000-000000000bad",
    workflow: parentDescriptor.id, contractFingerprint: parentDescriptor.contractFingerprint } });
  const _evidence = () => {
    const child = runningRun();
    const { record } = buildRunResult(personLookupDescriptor, child, [
      { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ], CLOCK);
    return { state: "child-resolved", nodeId: "child", parentRunId: parentRun().envelope.runId, edgeId: "fixture-child-result-edge",
      childRun: { runId: child.envelope.runId, itemId: child.envelope.itemId, workflowId: child.envelope.workflow,
        attempt: child.envelope.attempt, descriptorVersion: child.envelope.descriptorVersion, contractFingerprint: child.envelope.contractFingerprint, lifecycle: "done" }, result: record };
  };
  it("refuses a many-child result dependency instead of inventing one child identity", () => {
    assert.throws(() => compileWorkflow(parentDefinition("many"), { manifest: fixtureBuildManifest(["fixture-child-result-parent"]) }), /owns no output schema/);
  });
});
