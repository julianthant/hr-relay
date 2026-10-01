import { z } from "zod";
import { compileWorkflow, defineWorkflow } from "../../../../../src/base/workflow-definition.js";
import { ItemIdSchema } from "../../../../../src/domain/ids.js";
import { defineWorkflowRole } from "../../../../../src/domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../src/domain/workflow/presentation.js";
import { fixtureBuildManifest } from "../../../../fixtures/workflow-definition-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { workflowTerminalResultExecution } from "../../../../../src/base/workflow.js";
import {
  buildRunResult,
} from "../../../../../src/backend/runs/run-result.js";
import { manualClock } from "../../../../../src/domain/clock.js";
import { ReadOnboardingDatesOutputSchema } from "../../../../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadActiveStatus } from "../../../../../src/domain/contracts/person-lookup/read-active-status.js";
import { RunRecordSchema } from "../../../../../src/domain/run/record.js";
import {
  RunResultRecordSchema,
  deriveTerminalDependencyDigest,
} from "../../../../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../../../../src/domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../../src/domain/workflow/checkpoint.js";
import { PersonLookupCanonicalInput } from "../../../../../src/workflows/person-lookup/workflow.js";
import { HASH_A, HASH_B, LATER, NOW } from "../../../../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../../fixtures/phase1f-run-fixtures.js";
import { fixtureDescriptor } from "../../../../fixtures/descriptor-fixtures.js";
import { personLookupDescriptor } from "../../../../helpers/registered-workflows.js";

const CLOCK = manualClock(new Date(LATER));
const ACTIVE = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};
const CRM_DATES = ReadOnboardingDatesOutputSchema.parse({
  emplId: "10873698",
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

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
    runId: QUEUED_RUN.envelope.runId,
    output: { schemaHash: deriveSchemaHash(schema, "output"), value: schema.parse(value) },
    descriptorVersion: 1,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
}

describe("factory-authenticated terminal run results", () => {
  it("exposes exact callable parse and derive callbacks only for the factory object", () => {
    const execution = workflowTerminalResultExecution(personLookupDescriptor);
    const derived = execution.derive({
      input: personLookupDescriptor.input.parse({ emplId: "10873698" }),
      outputs: { "active-status": ACTIVE, "crm-dates": undefined },
    });
    assert.deepEqual(execution.parseResult(derived), {
      activeStatus: ACTIVE,
      crmDates: { state: "not-requested" },
    });
    assert.throws(
      () => workflowTerminalResultExecution({ ...personLookupDescriptor }),
      /exact object returned by defineWorkflowDescriptor/,
    );
  });

  it("binds conditional not-run reasons to their exact authored cause", () => {
    assert.deepEqual(workflowTerminalResultExecution(personLookupDescriptor).dependencies, [
      { nodeId: "active-status" },
      { nodeId: "crm-dates", notRunReason: "condition-false" },
    ]);
    assert.deepEqual(workflowTerminalResultExecution(fixtureDescriptor).dependencies, [
      { nodeId: "submit", notRunReason: "branch-not-selected" },
    ]);
  });

  it("builds Person Lookup's conditional not-run dependency in authenticated order", () => {
    const { record: result } = buildRunResult(
      personLookupDescriptor,
      runningRun(),
      [
        { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
      ],
      CLOCK,
    );
    assert.deepEqual(result.dependencies.map(({ nodeId }) => nodeId), ["active-status", "crm-dates"]);
    assert.equal(result.dependencies[1]?.state, "not-run");
    assert.deepEqual(RunResultRecordSchema.parse(result).result.value, {
      activeStatus: ACTIVE,
      crmDates: { state: "not-requested" },
    });
  });

  it("retains both resolved dependency identities when the conditional node runs", () => {
    const { record: result } = buildRunResult(
      personLookupDescriptor,
      runningRun(true),
      [
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
        { state: "resolved", nodeId: "crm-dates", checkpoint: checkpoint("crm-dates", CRM_DATES) },
      ],
      CLOCK,
    );
    assert.deepEqual(result.dependencies.map(({ state }) => state), ["resolved", "resolved"]);
  });

  it("rejects copied descriptors and missing, extra, duplicate, or illegal not-run evidence", () => {
    const active = { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) };
    const skipped = { state: "not-run", nodeId: "crm-dates", reason: "condition-false" };
    assert.throws(
      () => buildRunResult({ ...personLookupDescriptor }, runningRun(), [active, skipped], CLOCK),
      /exact object returned by defineWorkflowDescriptor/,
    );
    assert.throws(() => buildRunResult(personLookupDescriptor, runningRun(), [active], CLOCK), /missing=crm-dates/);
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [active, skipped, { ...skipped, nodeId: "searching" }], CLOCK),
      /extra=searching/,
    );
    assert.throws(() => buildRunResult(personLookupDescriptor, runningRun(), [active, skipped, skipped], CLOCK), /duplicate/);
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [
        { state: "not-run", nodeId: "active-status", reason: "condition-false" },
        skipped,
      ], CLOCK),
      /unconditional.*cannot be marked not-run/,
    );
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [
        active,
        { ...skipped, reason: "branch-not-selected" },
      ], CLOCK),
      /does not match authenticated reason condition-false/,
    );
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [
        { ...active, checkpoint: { ...active.checkpoint, contractFingerprint: HASH_A } },
        skipped,
      ], CLOCK),
      /checkpoint descriptor binding does not match/,
    );
  });

  it("rejects result schema, result digest, dependency, output, and provenance drift", () => {
    const { record: result } = buildRunResult(
      personLookupDescriptor,
      runningRun(),
      [
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
        { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
      ],
      CLOCK,
    );
    assert.throws(() => RunResultRecordSchema.parse({
      ...result,
      result: { ...result.result, schemaHash: HASH_A },
    }), /schema hash/);
    assert.throws(() => RunResultRecordSchema.parse({ ...result, resultDigest: HASH_A }), /result digest/);
    assert.throws(() => RunResultRecordSchema.parse({ ...result, dependencyDigest: HASH_A }), /dependency digest/);

    const changedOutput = result.dependencies.map((dependency) => dependency.state === "resolved"
      ? { ...dependency, outputDigest: HASH_A }
      : dependency);
    assert.throws(() => RunResultRecordSchema.parse({ ...result, dependencies: changedOutput }), /dependency digest/);
    const changedProvenance = result.dependencies.map((dependency) => dependency.state === "resolved"
      ? { ...dependency, provenanceDigest: HASH_A }
      : dependency);
    assert.throws(() => RunResultRecordSchema.parse({ ...result, dependencies: changedProvenance }), /dependency digest/);
    assert.throws(() => RunResultRecordSchema.parse({
      ...result,
      dependencies: [result.dependencies[0], result.dependencies[0]],
      dependencyDigest: deriveTerminalDependencyDigest([result.dependencies[0], result.dependencies[0]]),
    }), /exactly once/);
  });
});


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
  const evidence = () => {
    const child = runningRun();
    const { record } = buildRunResult(personLookupDescriptor, child, [
      { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ], CLOCK);
    return { state: "child-resolved", nodeId: "child", parentRunId: parentRun().envelope.runId, edgeId: "fixture-child-result-edge",
      childRun: { runId: child.envelope.runId, itemId: child.envelope.itemId, workflowId: child.envelope.workflow,
        attempt: child.envelope.attempt, descriptorVersion: child.envelope.descriptorVersion, contractFingerprint: child.envelope.contractFingerprint, lifecycle: "done" }, result: record };
  };
  it("derives from the retained child result and binds its exact terminal identity", () => {
    const { record } = buildRunResult(parentDescriptor, parentRun(), [evidence()], CLOCK);
    assert.deepEqual(record.result.value, { state: "done" });
    assert.equal(record.dependencies[0]?.state, "child-resolved");
    assert.ok(record.dependencies[0]?.state === "child-resolved");
    assert.equal(record.dependencies[0].child.resultDigest, evidence().result.resultDigest);
    assert.equal(record.dependencies[0].child.dependencyDigest, evidence().result.dependencyDigest);
    assert.equal(record.dependencies[0].parentRunId, parentRun().envelope.runId);
  });
  it("refuses parent, edge, target, lifecycle and retained-result mismatch", () => {
    const valid = evidence();
    for (const invalid of [ { ...valid, parentRunId: valid.childRun.runId }, { ...valid, edgeId: "foreign-edge" },
      { ...valid, childRun: { ...valid.childRun, workflowId: "foreign-child" } },
      { ...valid, childRun: { ...valid.childRun, lifecycle: "failed" } },
      { ...valid, childRun: { ...valid.childRun, lifecycle: "unknown" } },
      { ...valid, result: { ...valid.result, resultDigest: HASH_A } },
      { ...valid, result: { ...valid.result, attempt: 2 } } ]) {
      assert.throws(() => buildRunResult(parentDescriptor, parentRun(), [invalid], CLOCK));
    }
  });
  it("refuses a many-child result dependency instead of inventing one child identity", () => {
    assert.throws(() => compileWorkflow(parentDefinition("many"), { manifest: fixtureBuildManifest(["fixture-child-result-parent"]) }), /owns no output schema/);
  });
});
