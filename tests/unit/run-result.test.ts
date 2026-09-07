import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { workflowTerminalResultExecution } from "../../src/base/workflow.js";
import {
  buildRunResult,
} from "../../src/core/run-result.js";
import { manualClock } from "../../src/domain/clock.js";
import { ReadOnboardingDatesOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import {
  RunResultRecordSchema,
  deriveTerminalDependencyDigest,
} from "../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";
import { HASH_A, HASH_B, LATER, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import { fixtureDescriptor } from "./architecture/helpers/descriptor-fixtures.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

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
