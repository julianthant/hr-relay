import { PERSON_LOOKUP_ACTIVE, personLookupTerminalIdentityEvidence } from "../../../support/helpers/run-integration-world.js";

import { default as assert } from "node:assert/strict";
import { describe, it, vi } from "vitest";
import * as schemaBoundValue from "../../../../src/models/validation/schema-bound-value.js";
import { z } from "zod";
import { buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema, deriveTerminalDependencyDigest } from "../../../../src/models/run/result.js";
import { ReadOnboardingDatesOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-dates.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { ItemIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { workflowTerminalResultExecution } from "../../../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { FixtureReadReceipt, fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { HASH_A, HASH_B, LATER, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { FixtureCanonicalInput, stepOmissionTerminalDescriptor } from "../../../support/fixtures/workflow/step-omission-terminal-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

{

const CLOCK = manualClock(new Date(LATER));
const OUTPUT_HASH = deriveSchemaHash(FixtureReadReceipt.output, "output");
const ASSERTED_AT = NOW;

function runningRun(stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: stepOmissionTerminalDescriptor.id,
      contractFingerprint: stepOmissionTerminalDescriptor.contractFingerprint,
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        protectedBindings: [],
        schemaHash: deriveSchemaHash(FixtureCanonicalInput, "output"),
        value: { eid: "10873698" },
      },
    },
    lifecycle: {
      state: "running",
      workerId: "worker-1",
      claimedAt: NOW,
      heartbeatAt: LATER,
      currentNodeId: "fold",
    },
    claimGeneration: 1,
    version: 4,
    updatedAt: LATER,
  });
}

function checkpoint(nodeId: "read" | "fold" | "skip", value: unknown) {
  return RunCheckpointRecordSchema.parse({
    workflowId: stepOmissionTerminalDescriptor.id,
    itemId: QUEUED_RUN.envelope.itemId,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: QUEUED_RUN.envelope.runId,
    output: { schemaHash: OUTPUT_HASH, value },
    descriptorVersion: 1,
    contractFingerprint: stepOmissionTerminalDescriptor.contractFingerprint,
    implFingerprint: HASH_A,
    provenance: [{ path: "eid", source: "live", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
}

const RESOLVED_FOLD = { state: "resolved" as const, nodeId: "fold", checkpoint: checkpoint("fold", { eid: "10873698", present: true }) };
const RESOLVED_READ = { state: "resolved" as const, nodeId: "read", checkpoint: checkpoint("read", { eid: "10873698", present: true }) };
/** `skip` belongs to the "skipping" omittable step, which produces nothing for it — always legally step-omitted here. */
const NOT_RUN_SKIP = { state: "not-run" as const, nodeId: "skip", reason: "step-omitted" as const };

describe("resolveTerminalDependencies under step omission", () => {
  it("reuses descriptor schema identities while still validating each terminal output", () => {
    const run = runningRun();
    const evidence = [RESOLVED_READ, RESOLVED_FOLD, NOT_RUN_SKIP];
    const hash = vi.spyOn(schemaBoundValue, "deriveSchemaHash");
    try {
      const first = buildRunResult(stepOmissionTerminalDescriptor, run, evidence, CLOCK).record;
      const second = buildRunResult(stepOmissionTerminalDescriptor, run, evidence, CLOCK).record;
      assert.deepEqual(second, first);
      assert.throws(() => buildRunResult(stepOmissionTerminalDescriptor, run, [
        { ...RESOLVED_READ, checkpoint: { ...RESOLVED_READ.checkpoint, output: { schemaHash: HASH_B, value: { eid: "10873698", present: true } } } },
        RESOLVED_FOLD, NOT_RUN_SKIP,
      ], CLOCK), /checkpoint output schema/);
      assert.throws(() => buildRunResult(stepOmissionTerminalDescriptor, run, [
        { ...RESOLVED_READ, checkpoint: { ...RESOLVED_READ.checkpoint, output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: "invalid" } } } },
        RESOLVED_FOLD, NOT_RUN_SKIP,
      ], CLOCK));
      assert.equal(hash.mock.calls.length, 0);
    } finally { hash.mockRestore(); }
  });

  it("resolves a well-formed asserted dependency for an omitted, produced step", () => {
    const { record } = buildRunResult(
      stepOmissionTerminalDescriptor,
      runningRun([{ step: "reading", facts: { present: true } }]),
      [
        {
          state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
          output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
        },
        RESOLVED_FOLD,
        NOT_RUN_SKIP,
      ],
      CLOCK,
    );
    assert.deepEqual(record.dependencies.map((dependency) => [dependency.nodeId, dependency.state]), [
      ["read", "asserted"],
      ["fold", "resolved"],
      ["skip", "not-run"],
    ]);
  });

  it("refuses an asserted claim for a node no step omission can produce (\"not producible\")", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          RESOLVED_READ,
          {
            state: "asserted", nodeId: "fold", step: "folding", assertedAt: ASSERTED_AT,
            output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
          },
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency fold is not producible by any step omission and cannot be asserted/,
    );
  });

  it("refuses an asserted claim whose output schemaHash does not match the node's own contract", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          {
            state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
            output: { schemaHash: HASH_A, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read asserted output schema .* does not match/,
    );
  });

  it("refuses an asserted claim whose step is not the node's own declared omittable step", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          {
            state: "asserted", nodeId: "read", step: "folding", assertedAt: ASSERTED_AT,
            output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read is asserted for step "folding", but its declared omittable step is "reading"/,
    );
  });

  it("refuses an asserted claim for a step this run's envelope did not omit", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun(), // no stepOmissions on the envelope at all
        [
          {
            state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
            output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read is asserted for step "reading", which this run did not omit/,
    );
  });

  it("refuses a not-run/step-omitted claim for a node that belongs to no omittable step", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          RESOLVED_READ,
          { state: "not-run", nodeId: "fold", reason: "step-omitted" },
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency fold belongs to no omittable step and cannot be marked step-omitted/,
    );
  });

  it("refuses a not-run/operator-asserted claim outright — an assertion is never a not-run reason", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          { state: "not-run", nodeId: "read", reason: "operator-asserted" },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read cannot be marked not-run as operator-asserted; an asserted node carries its output in the asserted evidence arm/,
    );
  });
});
}

{

const CLOCK = manualClock(new Date(LATER));
const ACTIVE = PERSON_LOOKUP_ACTIVE;
const CRM_DATES = ReadOnboardingDatesOutputSchema.parse({ emplId: "10873698", state: "read", employmentDate: "2026-07-15", oathDate: null, reason: "" });

function runningRun(includeCrmDates = false) {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        ...QUEUED_RUN.input.parsed,
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { mode: "search", emplId: "10873698", crmCheck: true, keepNonHdh: false, includeCrmDates },
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
    descriptorVersion: personLookupDescriptor.version,
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
      { nodeId: "search-identity" },
      { nodeId: "crm-identity", notRunReason: "condition-false" },
      { nodeId: "matching", notRunReason: "condition-false" },
      { nodeId: "crm-selected-record", notRunReason: "condition-false" },
      { nodeId: "crm-results", notRunReason: "condition-false" },
      { nodeId: "active-status", notRunReason: "condition-false" },
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
        ...personLookupTerminalIdentityEvidence(runningRun()),
        { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
      ],
      CLOCK,
    );
    assert.deepEqual(result.dependencies.map(({ nodeId }) => nodeId), ["search-identity", "crm-identity", "matching", "crm-selected-record", "crm-results", "active-status", "crm-dates"]);
    assert.equal(result.dependencies[6]?.state, "not-run");
    assert.deepEqual(RunResultRecordSchema.parse(result).result.value, {
      activeStatus: ACTIVE,
      crmDates: { state: "not-requested" },
    });
  });

  it("retains every resolved dependency identity when the conditional node runs", () => {
    const { record: result } = buildRunResult(
      personLookupDescriptor,
      runningRun(true),
      [
        ...personLookupTerminalIdentityEvidence(runningRun()),
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", { ...ACTIVE, datesEid: "10873698" }) },
        { state: "resolved", nodeId: "crm-dates", checkpoint: checkpoint("crm-dates", CRM_DATES) },
      ],
      CLOCK,
    );
    assert.deepEqual(result.dependencies.map(({ state }) => state), ["resolved", "resolved", "not-run", "not-run", "not-run", "resolved", "resolved"]);
  });

  it("rejects copied descriptors and missing, extra, duplicate, or illegal not-run evidence", () => {
    const active = { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) };
    const skipped = { state: "not-run", nodeId: "crm-dates", reason: "condition-false" };
    assert.throws(
      () => buildRunResult({ ...personLookupDescriptor }, runningRun(), [...personLookupTerminalIdentityEvidence(runningRun()), active, skipped], CLOCK),
      /exact object returned by defineWorkflowDescriptor/,
    );
    assert.throws(() => buildRunResult(personLookupDescriptor, runningRun(), [...personLookupTerminalIdentityEvidence(runningRun()), active], CLOCK), /missing=crm-dates/);
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [...personLookupTerminalIdentityEvidence(runningRun()), active, skipped, { ...skipped, nodeId: "searching" }], CLOCK),
      /extra=searching/,
    );
    assert.throws(() => buildRunResult(personLookupDescriptor, runningRun(), [...personLookupTerminalIdentityEvidence(runningRun()), active, skipped, skipped], CLOCK), /duplicate/);
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [
        ...personLookupTerminalIdentityEvidence(runningRun()).filter(entry => entry.nodeId !== "search-identity"),
        { state: "not-run", nodeId: "search-identity", reason: "condition-false" },
        active, skipped,
      ], CLOCK),
      /unconditional.*cannot be marked not-run/,
    );
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [
        ...personLookupTerminalIdentityEvidence(runningRun()),
        active,
        { ...skipped, reason: "branch-not-selected" },
      ], CLOCK),
      /does not match authenticated reason condition-false/,
    );
    assert.throws(
      () => buildRunResult(personLookupDescriptor, runningRun(), [
        ...personLookupTerminalIdentityEvidence(runningRun()),
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
        ...personLookupTerminalIdentityEvidence(runningRun()),
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
    workflow: parentDescriptor.id, descriptorVersion: parentDescriptor.version, contractFingerprint: parentDescriptor.contractFingerprint } });
  const evidence = () => {
    const child = runningRun();
    const { record } = buildRunResult(personLookupDescriptor, child, [
      ...personLookupTerminalIdentityEvidence(child),
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
});
}
