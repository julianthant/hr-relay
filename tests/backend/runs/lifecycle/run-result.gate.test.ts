import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { RunResultRecordSchema, deriveTerminalDependencyDigest } from "../../../../src/models/run/result.js";
import { GateResultRecordSchema, OperatorGateResultRecordSchema, deriveGateResultCheckpointFingerprint } from "../../../../src/models/workflow/gates.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const schema = z.strictObject({ approved: z.boolean() });
const descriptor = compileWorkflow(defineWorkflow({
  id: "fixture-gate-result", version: 1, code: "fgr", label: "Gate result", icon: "Search", category: "operations",
  input: personLookupDescriptor.input, canonicalInput: PersonLookupCanonicalInput, inputSubject: "eid",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], identity: { matchKey: () => "gate-fixture" }, presentation: { title: () => "Gate result" },
  scenarios: ["fixture-gate-result/approved"], role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ gate, result }) => {
    const approval = gate({ id: "approval", label: "Approval", resolvedBy: "operator", result: schema }, []);
    return { steps: [[{ key: "approval", label: "Approval" }, [approval]]],
      result: result(schema, [approval], ({ outputs }) => outputs.approval) };
  },
})).descriptor;
const run = { ...QUEUED_RUN,
  lifecycle: { state: "running", workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW }, claimGeneration: 1,
  envelope: { ...QUEUED_RUN.envelope, workflow: descriptor.id, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint },
  input: { ...QUEUED_RUN.input, parsed: { protectedBindings: [], schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
    value: personLookupDescriptor.input.parse({ emplId: "10873698" }) } },
};
const result = { schemaHash: deriveSchemaHash(schema, "output"), value: { approved: true } };
const gate = OperatorGateResultRecordSchema.parse({ runId: run.envelope.runId, nodeId: "approval", gateId: "approval",
  commandId: "00000000-0000-4000-8000-000000000bad", expectedVersion: 2, resolvedBy: "local-operator", resolvedAt: NOW,
  checkpointFingerprint: deriveGateResultCheckpointFingerprint(result), result });
const clock = manualClock(new Date(NOW));

describe("terminal gate evidence", () => {
  it("derives the approved output and retains a digest-bound gate reference", () => {
    const built = buildRunResult(descriptor, run, [{ state: "gate-resolved", nodeId: "approval", gate }], clock).record;
    assert.deepEqual(built.result.value, { approved: true });
    const dependency = built.dependencies[0]; assert.ok(dependency?.state === "gate-resolved");
    assert.deepEqual(dependency.gate, { runId: run.envelope.runId, gateId: "approval" });
    assert.equal(dependency.resultSchemaHash, result.schemaHash);
    assert.equal(dependency.checkpointFingerprint, gate.checkpointFingerprint);
    const changed = [{ ...dependency, recordDigest: HASH_A }];
    assert.throws(() => RunResultRecordSchema.parse({ ...built, dependencies: changed }), /dependency digest/);
    assert.notEqual(deriveTerminalDependencyDigest(changed), built.dependencyDigest);
  });

  it("refuses missing, foreign, renamed, altered-schema, altered-value and non-operator gate evidence", () => {
    assert.throws(() => buildRunResult(descriptor, run, [], clock), /missing=approval/);
    const source = GateResultRecordSchema.parse({ runId: gate.runId, nodeId: gate.nodeId, gateId: gate.gateId,
      expectedVersion: gate.expectedVersion, resolvedAt: gate.resolvedAt, checkpointFingerprint: gate.checkpointFingerprint, result: gate.result,
      source: { kind: "workflow", sourceId: "foreign", eventId: "foreign", eventDigest: HASH_A, correlationKey: "foreign", correlationDigest: HASH_A, attempt: 1 } });
    for (const invalid of [
      { ...gate, runId: "00000000-0000-4000-8000-000000000bad" },
      { ...gate, nodeId: "foreign" }, { ...gate, gateId: "foreign" },
      { ...gate, result: { ...result, schemaHash: HASH_A } },
      { ...gate, result: { ...result, value: { approved: false } } },
      source,
    ]) assert.throws(() => buildRunResult(descriptor, run, [{ state: "gate-resolved", nodeId: "approval", gate: invalid }], clock));
  });
});
