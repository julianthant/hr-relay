
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { z as z_m1 } from "zod";
import { buildRunResult as buildRunResult_m0,buildRunResult as buildRunResult_m1 } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { RunRecordSchema as RunRecordSchema_m0,RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import {
RunResultRecordSchema as RunResultRecordSchema_m1,
deriveTerminalDependencyDigest as deriveTerminalDependencyDigest_m1
} from "../../../../src/models/run/result.js";
import { ReadOnboardingDatesOutputSchema as ReadOnboardingDatesOutputSchema_m1 } from "../../../../src/models/systems/crm/read-onboarding-dates.js";
import { deriveSchemaHash as deriveSchemaHash_m0,deriveSchemaHash as deriveSchemaHash_m1 } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema as RunCheckpointRecordSchema_m0,RunCheckpointRecordSchema as RunCheckpointRecordSchema_m1 } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS as STANDARD_WORKFLOW_ACTIONS_m1 } from "../../../../src/models/workflow/presentation.js";
import { ReadActiveStatus as ReadActiveStatus_m1 } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { ItemIdSchema as ItemIdSchema_m1 } from "../../../../src/rules/identity/ids.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { defineWorkflowRole as defineWorkflowRole_m1 } from "../../../../src/workflow-kit/validation/module-role.js";
import { compileWorkflow as compileWorkflow_m1,defineWorkflow as defineWorkflow_m1 } from "../../../../src/workflow-kit/workflow-definition.js";
import { workflowTerminalResultExecution as workflowTerminalResultExecution_m1 } from "../../../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput as PersonLookupCanonicalInput_m1 } from "../../../../src/workflows/person-lookup/workflow.js";
import { FixtureReadReceipt as FixtureReadReceipt_m0,fixtureDescriptor as fixtureDescriptor_m1 } from "../../../support/fixtures/descriptor-fixtures.js";
import { HASH_A as HASH_A_m0,HASH_A as HASH_A_m1,HASH_B as HASH_B_m1,LATER as LATER_m0,LATER as LATER_m1,NOW as NOW_m0,NOW as NOW_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m0,QUEUED_RUN as QUEUED_RUN_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureBuildManifest as fixtureBuildManifest_m1 } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { FixtureCanonicalInput as FixtureCanonicalInput_m0,stepOmissionTerminalDescriptor as stepOmissionTerminalDescriptor_m0 } from "../../../support/fixtures/workflow/step-omission-terminal-fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m1 } from "../../../support/helpers/registered-workflows.js";


{


const CLOCK = manualClock_m0(new Date(LATER_m0));
const OUTPUT_HASH = deriveSchemaHash_m0(FixtureReadReceipt_m0.output, "output");
const ASSERTED_AT = NOW_m0;

function runningRun(stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
  return RunRecordSchema_m0.parse({
    ...QUEUED_RUN_m0,
    envelope: {
      ...QUEUED_RUN_m0.envelope,
      workflow: stepOmissionTerminalDescriptor_m0.id,
      contractFingerprint: stepOmissionTerminalDescriptor_m0.contractFingerprint,
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
    },
    input: {
      ...QUEUED_RUN_m0.input,
      parsed: {
        protectedBindings: [],
        schemaHash: deriveSchemaHash_m0(FixtureCanonicalInput_m0, "output"),
        value: { eid: "10873698" },
      },
    },
    lifecycle: {
      state: "running",
      workerId: "worker-1",
      claimedAt: NOW_m0,
      heartbeatAt: LATER_m0,
      currentNodeId: "fold",
    },
    claimGeneration: 1,
    version: 4,
    updatedAt: LATER_m0,
  });
}

function checkpoint(nodeId: "read" | "fold" | "skip", value: unknown) {
  return RunCheckpointRecordSchema_m0.parse({
    workflowId: stepOmissionTerminalDescriptor_m0.id,
    itemId: QUEUED_RUN_m0.envelope.itemId,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: QUEUED_RUN_m0.envelope.runId,
    output: { schemaHash: OUTPUT_HASH, value },
    descriptorVersion: 1,
    contractFingerprint: stepOmissionTerminalDescriptor_m0.contractFingerprint,
    implFingerprint: HASH_A_m0,
    provenance: [{ path: "eid", source: "live", observedAt: NOW_m0, originalObservedAt: NOW_m0 }],
    writtenAt: NOW_m0,
  });
}

const RESOLVED_FOLD = { state: "resolved" as const, nodeId: "fold", checkpoint: checkpoint("fold", { eid: "10873698", present: true }) };
const RESOLVED_READ = { state: "resolved" as const, nodeId: "read", checkpoint: checkpoint("read", { eid: "10873698", present: true }) };
/** `skip` belongs to the "skipping" omittable step, which produces nothing for it — always legally step-omitted here. */
const NOT_RUN_SKIP = { state: "not-run" as const, nodeId: "skip", reason: "step-omitted" as const };

describe_m0("resolveTerminalDependencies under step omission", () => {
  it_m0("resolves a well-formed asserted dependency for an omitted, produced step", () => {
    const { record } = buildRunResult_m0(
      stepOmissionTerminalDescriptor_m0,
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
    assert_m0.deepEqual(record.dependencies.map((dependency) => [dependency.nodeId, dependency.state]), [
      ["read", "asserted"],
      ["fold", "resolved"],
      ["skip", "not-run"],
    ]);
  });

  it_m0("refuses an asserted claim for a node no step omission can produce (\"not producible\")", () => {
    assert_m0.throws(
      () => buildRunResult_m0(
        stepOmissionTerminalDescriptor_m0,
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

  it_m0("refuses an asserted claim whose output schemaHash does not match the node's own contract", () => {
    assert_m0.throws(
      () => buildRunResult_m0(
        stepOmissionTerminalDescriptor_m0,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          {
            state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
            output: { schemaHash: HASH_A_m0, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read asserted output schema .* does not match/,
    );
  });

  it_m0("refuses an asserted claim whose step is not the node's own declared omittable step", () => {
    assert_m0.throws(
      () => buildRunResult_m0(
        stepOmissionTerminalDescriptor_m0,
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

  it_m0("refuses an asserted claim for a step this run's envelope did not omit", () => {
    assert_m0.throws(
      () => buildRunResult_m0(
        stepOmissionTerminalDescriptor_m0,
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

  it_m0("refuses a not-run/step-omitted claim for a node that belongs to no omittable step", () => {
    assert_m0.throws(
      () => buildRunResult_m0(
        stepOmissionTerminalDescriptor_m0,
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

  it_m0("refuses a not-run/operator-asserted claim outright — an assertion is never a not-run reason", () => {
    assert_m0.throws(
      () => buildRunResult_m0(
        stepOmissionTerminalDescriptor_m0,
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


const CLOCK = manualClock_m1(new Date(LATER_m1));
const ACTIVE = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};
const CRM_DATES = ReadOnboardingDatesOutputSchema_m1.parse({
  emplId: "10873698",
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

function runningRun(includeCrmDates = false) {
  return RunRecordSchema_m1.parse({
    ...QUEUED_RUN_m1,
    envelope: {
      ...QUEUED_RUN_m1.envelope,
      contractFingerprint: personLookupDescriptor_m1.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN_m1.input,
      parsed: {
        ...QUEUED_RUN_m1.input.parsed,
        schemaHash: deriveSchemaHash_m1(PersonLookupCanonicalInput_m1, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates },
      },
    },
    lifecycle: {
      state: "running",
      workerId: "worker-1",
      claimedAt: NOW_m1,
      heartbeatAt: LATER_m1,
      currentNodeId: "crm-dates",
    },
    claimGeneration: 1,
    version: 4,
    updatedAt: LATER_m1,
  });
}

function checkpoint(nodeId: "active-status" | "crm-dates", value: unknown) {
  const schema = nodeId === "active-status" ? ReadActiveStatus_m1.output : ReadOnboardingDatesOutputSchema_m1;
  return RunCheckpointRecordSchema_m1.parse({
    workflowId: "person-lookup",
    itemId: QUEUED_RUN_m1.envelope.itemId,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: QUEUED_RUN_m1.envelope.runId,
    output: { schemaHash: deriveSchemaHash_m1(schema, "output"), value: schema.parse(value) },
    descriptorVersion: 1,
    contractFingerprint: personLookupDescriptor_m1.contractFingerprint,
    implFingerprint: HASH_B_m1,
    provenance: [{ path: "state", source: "derived", observedAt: NOW_m1, originalObservedAt: NOW_m1 }],
    writtenAt: NOW_m1,
  });
}

describe_m1("factory-authenticated terminal run results", () => {
  it_m1("exposes exact callable parse and derive callbacks only for the factory object", () => {
    const execution = workflowTerminalResultExecution_m1(personLookupDescriptor_m1);
    const derived = execution.derive({
      input: personLookupDescriptor_m1.input.parse({ emplId: "10873698" }),
      outputs: { "active-status": ACTIVE, "crm-dates": undefined },
    });
    assert_m1.deepEqual(execution.parseResult(derived), {
      activeStatus: ACTIVE,
      crmDates: { state: "not-requested" },
    });
    assert_m1.throws(
      () => workflowTerminalResultExecution_m1({ ...personLookupDescriptor_m1 }),
      /exact object returned by defineWorkflowDescriptor/,
    );
  });

  it_m1("binds conditional not-run reasons to their exact authored cause", () => {
    assert_m1.deepEqual(workflowTerminalResultExecution_m1(personLookupDescriptor_m1).dependencies, [
      { nodeId: "active-status" },
      { nodeId: "crm-dates", notRunReason: "condition-false" },
    ]);
    assert_m1.deepEqual(workflowTerminalResultExecution_m1(fixtureDescriptor_m1).dependencies, [
      { nodeId: "submit", notRunReason: "branch-not-selected" },
    ]);
  });

  it_m1("builds Person Lookup's conditional not-run dependency in authenticated order", () => {
    const { record: result } = buildRunResult_m1(
      personLookupDescriptor_m1,
      runningRun(),
      [
        { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
      ],
      CLOCK,
    );
    assert_m1.deepEqual(result.dependencies.map(({ nodeId }) => nodeId), ["active-status", "crm-dates"]);
    assert_m1.equal(result.dependencies[1]?.state, "not-run");
    assert_m1.deepEqual(RunResultRecordSchema_m1.parse(result).result.value, {
      activeStatus: ACTIVE,
      crmDates: { state: "not-requested" },
    });
  });

  it_m1("retains both resolved dependency identities when the conditional node runs", () => {
    const { record: result } = buildRunResult_m1(
      personLookupDescriptor_m1,
      runningRun(true),
      [
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
        { state: "resolved", nodeId: "crm-dates", checkpoint: checkpoint("crm-dates", CRM_DATES) },
      ],
      CLOCK,
    );
    assert_m1.deepEqual(result.dependencies.map(({ state }) => state), ["resolved", "resolved"]);
  });

  it_m1("rejects copied descriptors and missing, extra, duplicate, or illegal not-run evidence", () => {
    const active = { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) };
    const skipped = { state: "not-run", nodeId: "crm-dates", reason: "condition-false" };
    assert_m1.throws(
      () => buildRunResult_m1({ ...personLookupDescriptor_m1 }, runningRun(), [active, skipped], CLOCK),
      /exact object returned by defineWorkflowDescriptor/,
    );
    assert_m1.throws(() => buildRunResult_m1(personLookupDescriptor_m1, runningRun(), [active], CLOCK), /missing=crm-dates/);
    assert_m1.throws(
      () => buildRunResult_m1(personLookupDescriptor_m1, runningRun(), [active, skipped, { ...skipped, nodeId: "searching" }], CLOCK),
      /extra=searching/,
    );
    assert_m1.throws(() => buildRunResult_m1(personLookupDescriptor_m1, runningRun(), [active, skipped, skipped], CLOCK), /duplicate/);
    assert_m1.throws(
      () => buildRunResult_m1(personLookupDescriptor_m1, runningRun(), [
        { state: "not-run", nodeId: "active-status", reason: "condition-false" },
        skipped,
      ], CLOCK),
      /unconditional.*cannot be marked not-run/,
    );
    assert_m1.throws(
      () => buildRunResult_m1(personLookupDescriptor_m1, runningRun(), [
        active,
        { ...skipped, reason: "branch-not-selected" },
      ], CLOCK),
      /does not match authenticated reason condition-false/,
    );
    assert_m1.throws(
      () => buildRunResult_m1(personLookupDescriptor_m1, runningRun(), [
        { ...active, checkpoint: { ...active.checkpoint, contractFingerprint: HASH_A_m1 } },
        skipped,
      ], CLOCK),
      /checkpoint descriptor binding does not match/,
    );
  });

  it_m1("rejects result schema, result digest, dependency, output, and provenance drift", () => {
    const { record: result } = buildRunResult_m1(
      personLookupDescriptor_m1,
      runningRun(),
      [
        { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
        { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
      ],
      CLOCK,
    );
    assert_m1.throws(() => RunResultRecordSchema_m1.parse({
      ...result,
      result: { ...result.result, schemaHash: HASH_A_m1 },
    }), /schema hash/);
    assert_m1.throws(() => RunResultRecordSchema_m1.parse({ ...result, resultDigest: HASH_A_m1 }), /result digest/);
    assert_m1.throws(() => RunResultRecordSchema_m1.parse({ ...result, dependencyDigest: HASH_A_m1 }), /dependency digest/);

    const changedOutput = result.dependencies.map((dependency) => dependency.state === "resolved"
      ? { ...dependency, outputDigest: HASH_A_m1 }
      : dependency);
    assert_m1.throws(() => RunResultRecordSchema_m1.parse({ ...result, dependencies: changedOutput }), /dependency digest/);
    const changedProvenance = result.dependencies.map((dependency) => dependency.state === "resolved"
      ? { ...dependency, provenanceDigest: HASH_A_m1 }
      : dependency);
    assert_m1.throws(() => RunResultRecordSchema_m1.parse({ ...result, dependencies: changedProvenance }), /dependency digest/);
    assert_m1.throws(() => RunResultRecordSchema_m1.parse({
      ...result,
      dependencies: [result.dependencies[0], result.dependencies[0]],
      dependencyDigest: deriveTerminalDependencyDigest_m1([result.dependencies[0], result.dependencies[0]]),
    }), /exactly once/);
  });
});


describe_m1("canonical awaited child terminal evidence", () => {
  const parentDefinition = (cardinality: "one" | "many" = "one") => defineWorkflow_m1({
    id: "fixture-child-result-parent", version: 1, code: "fcr", label: "Child result parent", icon: "Search", category: "operations",
    input: personLookupDescriptor_m1.input, canonicalInput: PersonLookupCanonicalInput_m1, inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS_m1,
    surfaces: {}, details: [], identity: { matchKey: () => "child-fixture" }, presentation: { title: () => "Child parent" },
    scenarios: ["fixture-child-result/parent"], role: defineWorkflowRole_m1({ kind: "standalone" }),
    steps: ({ delegate, result }) => {
      const common = { id: "child", target: { id: personLookupDescriptor_m1.id, input: personLookupDescriptor_m1.input, result: workflowTerminalResultExecution_m1(personLookupDescriptor_m1).schema }, edgeId: "fixture-child-result-edge", await: "terminal" as const,
        policy: { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const, afterChildRetry: "resume-parent" as const, visibility: "inline" as const } };
      const child = cardinality === "one"
        ? delegate({ ...common, cardinality: "one", join: "one" }, [], { bind: ({ input }) => input, deriveChildItemId: () => ItemIdSchema_m1.parse(QUEUED_RUN_m1.envelope.itemId) })
        : delegate({ ...common, cardinality: "many", join: "all" }, [], { bind: ({ input }) => [input], deriveChildItemId: () => ItemIdSchema_m1.parse(QUEUED_RUN_m1.envelope.itemId) });
      return { steps: [[{ key: "child", label: "Child" }, [child]]],
        result: result(z_m1.strictObject({ state: z_m1.literal("done") }), [child], ({ outputs }) => z_m1.object({ state: z_m1.literal("done") }).parse(outputs.child)) };
    },
  });
  const parentDescriptor = compileWorkflow_m1(parentDefinition(), { manifest: fixtureBuildManifest_m1(["fixture-child-result-parent"]) }).descriptor;
  const parentRun = () => ({ ...runningRun(), envelope: { ...runningRun().envelope, runId: "00000000-0000-4000-8000-000000000bad",
    workflow: parentDescriptor.id, contractFingerprint: parentDescriptor.contractFingerprint } });
  const evidence = () => {
    const child = runningRun();
    const { record } = buildRunResult_m1(personLookupDescriptor_m1, child, [
      { state: "resolved", nodeId: "active-status", checkpoint: checkpoint("active-status", ACTIVE) },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ], CLOCK);
    return { state: "child-resolved", nodeId: "child", parentRunId: parentRun().envelope.runId, edgeId: "fixture-child-result-edge",
      childRun: { runId: child.envelope.runId, itemId: child.envelope.itemId, workflowId: child.envelope.workflow,
        attempt: child.envelope.attempt, descriptorVersion: child.envelope.descriptorVersion, contractFingerprint: child.envelope.contractFingerprint, lifecycle: "done" }, result: record };
  };
  it_m1("derives from the retained child result and binds its exact terminal identity", () => {
    const { record } = buildRunResult_m1(parentDescriptor, parentRun(), [evidence()], CLOCK);
    assert_m1.deepEqual(record.result.value, { state: "done" });
    assert_m1.equal(record.dependencies[0]?.state, "child-resolved");
    assert_m1.ok(record.dependencies[0]?.state === "child-resolved");
    assert_m1.equal(record.dependencies[0].child.resultDigest, evidence().result.resultDigest);
    assert_m1.equal(record.dependencies[0].child.dependencyDigest, evidence().result.dependencyDigest);
    assert_m1.equal(record.dependencies[0].parentRunId, parentRun().envelope.runId);
  });
  it_m1("refuses parent, edge, target, lifecycle and retained-result mismatch", () => {
    const valid = evidence();
    for (const invalid of [ { ...valid, parentRunId: valid.childRun.runId }, { ...valid, edgeId: "foreign-edge" },
      { ...valid, childRun: { ...valid.childRun, workflowId: "foreign-child" } },
      { ...valid, childRun: { ...valid.childRun, lifecycle: "failed" } },
      { ...valid, childRun: { ...valid.childRun, lifecycle: "unknown" } },
      { ...valid, result: { ...valid.result, resultDigest: HASH_A_m1 } },
      { ...valid, result: { ...valid.result, attempt: 2 } } ]) {
      assert_m1.throws(() => buildRunResult_m1(parentDescriptor, parentRun(), [invalid], CLOCK));
    }
  });
});
}
