import { createKernelStubCommandFixtures, type KernelStubHarness as Harness } from "../../../support/helpers/backend/kernel-stub-command-fixtures.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { fixtureDescriptor,FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { type AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const profiles: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const KernelInput = z.strictObject({ eid: EidSchema });
const KernelCanonicalInput = defineCanonicalInput(
  KernelInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }, { eid: "10800001" }],
);

const rejectActiveDescriptor = defineWorkflowDescriptor({
  id: "kernel-omission-reject",
  version: 1,
  contractFingerprint: "e".repeat(64),
  code: "ko",
  label: "Kernel omission fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: KernelCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `eid:${input.eid}` },
  presentation: { title: (input) => `Kernel ${input.eid}` },
  scenarios: ["fixture-graph/happy"],
  flow: flow(KernelInput)
    .step("probe", FixtureReadReceipt, {
      dependsOn: [],
      replay: "checkpoint",
      bind: ({ input }) => ({ eid: input.eid }),
    })
    .build({
      schema: z.strictObject({ eid: EidSchema }),
      dependsOn: ["probe"],
      derive: ({ outputs }) => ({ eid: outputs.probe.eid }),
    }),
});

const DESCRIPTOR_SET = [rejectActiveDescriptor, fixtureDescriptor];

const { createHarness, nextCommandId, runCommand } = createKernelStubCommandFixtures({ profiles,
  roots,
  openDatabases,
  prefix: "hrauto-kernel-omission-",
  migrationOwner: "kernel-omission-test",
  resolve: (workflowId) => DESCRIPTOR_SET.find((descriptor) => String(descriptor.id) === workflowId),
});

const STEP_OMISSIONS = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];

function createPlan(harness: Harness, eids: readonly string[], stepOmissions?: typeof STEP_OMISSIONS) {
  const plan = planStart(
    { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
    {
      descriptor: rejectActiveDescriptor,
      submissions: eids.map((eid) => ({ eid })),
      dryRun: false,
      priority: "bulk",
      shape: "single",
      configFingerprint: harness.configIdentity.configFingerprint,
      configSnapshotId: harness.configIdentity.configSnapshotId,
      plannedBy: "local-operator",
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
    },
  );
  const created = harness.database.authority.startPlans.create(plan);
  assert.equal(created.state, "inserted");
  return plan;
}

function startCommand(plan: ReturnType<typeof createPlan>) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "start",
    type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: {
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
    },
  } as const;
}

describe("command-kernel start/retry step-omission carry", () => {
  it("carries the consumed start plan's stepOmissions onto the created run's envelope", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, ["10800000"], STEP_OMISSIONS);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    const runId = singleAppliedRunId(result);
    const run = harness.database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    assert.deepEqual(run.envelope.stepOmissions, STEP_OMISSIONS);
  });

  it("omits stepOmissions from the created run's envelope when the plan carried none", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, ["10800001"]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    const run = harness.database.authority.runs.get(singleAppliedRunId(result));
    assert.ok(run !== undefined);
    assert.equal(Object.hasOwn(run.envelope, "stepOmissions"), false);
  });

  it("carries the retried run's stepOmissions onto the fresh attempt, byte for byte", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, ["10800000"], STEP_OMISSIONS);
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);

    const originalRun = harness.database.authority.runs.get(runId);
    assert.ok(originalRun !== undefined);
    const cancelled = harness.kernel.execute(runCommand("cancel", runId, originalRun.version));
    assert.equal(cancelled.state, "applied");
    const cancelledVersion = harness.database.authority.runs.get(runId)?.version;
    assert.ok(cancelledVersion !== undefined);

    const retry = harness.kernel.execute(runCommand("retry", runId, cancelledVersion));
    assert.equal(retry.state, "applied");
    if (retry.state !== "applied") return;
    const newTarget = retry.affectedTargets[0];
    assert.equal(newTarget.family, "run");
    if (newTarget.family !== "run") return;
    const retried = harness.database.authority.runs.get(newTarget.runId);
    assert.ok(retried !== undefined);
    assert.equal(retried.envelope.retryOf, runId);
    assert.deepEqual(retried.envelope.stepOmissions, STEP_OMISSIONS);
  });
});
