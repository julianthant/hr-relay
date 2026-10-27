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
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
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

const descriptor = defineWorkflowDescriptor({
  id: "kernel-recovery-fixture",
  version: 1,
  contractFingerprint: "e".repeat(64),
  code: "kr",
  label: "Kernel recovery fixture",
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
  timeline: [{ key: "probing", label: "Probing", nodes: ["probe"], omission: { form: { fields: [{ key: "present", label: "Present", kind: "boolean" }] }, produces: { probe: ({ facts, scope }) => ({ eid: (scope.input as { eid: string }).eid, present: facts.present === true }) } } }],
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

const { createHarness, nextCommandId, runCommand } = createKernelStubCommandFixtures({ profiles,
  roots,
  openDatabases,
  prefix: "hrauto-kernel-recovery-",
  migrationOwner: "kernel-recovery-test",
  resolve: (workflowId) => (String(descriptor.id) === workflowId ? descriptor : undefined),
});

const STEP_OMISSIONS = [{ step: "probing", facts: { present: true } }];

function startTerminalRun(harness: Harness, options: Readonly<{ dryRun: boolean; omit: boolean }>): { runId: string; version: number } {
  const plan = planStart(
    { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
    {
      descriptor,
      submissions: [{ eid: "10800000" }],
      dryRun: options.dryRun,
      priority: "bulk",
      shape: "single",
      configFingerprint: harness.configIdentity.configFingerprint,
      configSnapshotId: harness.configIdentity.configSnapshotId,
      plannedBy: "local-operator",
      ...(options.omit ? { stepOmissions: STEP_OMISSIONS } : {}),
    },
  );
  assert.deepEqual(plan.refused, [], JSON.stringify(plan.refused));
  assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
  const started = harness.kernel.execute({
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
  });
  assert.equal(started.state, "applied");
  const runId = singleAppliedRunId(started);
  const original = harness.database.authority.runs.get(runId);
  assert.ok(original !== undefined);
  const cancelled = harness.kernel.execute(runCommand("cancel", runId, original.version));
  assert.equal(cancelled.state, "applied");
  const version = harness.database.authority.runs.get(runId)?.version;
  assert.ok(version !== undefined);
  return { runId, version };
}

function recoveredRun(harness: Harness, type: "retry" | "restart", target: { runId: string; version: number }) {
  const applied = harness.kernel.execute(runCommand(type, target.runId, target.version));
  assert.equal(applied.state, "applied");
  if (applied.state !== "applied") throw new Error("unreachable");
  const newTarget = applied.affectedTargets[0];
  assert.ok(newTarget !== undefined && newTarget.family === "run");
  if (newTarget?.family !== "run") throw new Error("unreachable");
  const run = harness.database.authority.runs.get(newTarget.runId);
  assert.ok(run !== undefined);
  return run;
}

describe("command-kernel recovery choices", () => {
  it("restart mints the item's next attempt with recovery: restart-from-start and carries input, dryRun and omissions unchanged", async () => {
    const harness = await createHarness();

    const target = startTerminalRun(harness, { dryRun: false, omit: true });
    const original = harness.database.authority.runs.get(target.runId);
    assert.ok(original !== undefined);
    const restarted = recoveredRun(harness, "restart", target);
    assert.equal(restarted.envelope.recovery, "restart-from-start");
    assert.equal(restarted.envelope.retryOf, target.runId);
    assert.equal(restarted.envelope.itemId, original.envelope.itemId);
    assert.equal(restarted.envelope.attempt, original.envelope.attempt + 1);
    assert.equal(restarted.envelope.dryRun, original.envelope.dryRun);
    assert.deepEqual(restarted.envelope.stepOmissions, STEP_OMISSIONS);
    assert.deepEqual(restarted.input, original.input);
    assert.equal(Object.hasOwn(restarted.envelope, "startAt"), false, "a restart owns no explicit start node");
  });

  it("retry (Resume from checkpoints) mints the same next attempt WITHOUT a recovery marker", async () => {
    const harness = await createHarness();
    const target = startTerminalRun(harness, { dryRun: false, omit: false });
    const resumed = recoveredRun(harness, "retry", target);
    assert.equal(Object.hasOwn(resumed.envelope, "recovery"), false);
    assert.equal(resumed.envelope.retryOf, target.runId);
    assert.equal(resumed.envelope.attempt, 2);
  });

  it("refuses restart for a non-terminal run exactly as it refuses retry", async () => {
    const harness = await createHarness();
    const target = startTerminalRun(harness, { dryRun: false, omit: false });
    const restarted = recoveredRun(harness, "restart", target);
    // The restart is queued, not terminal: a second recovery command on it is refused by name.
    const again = harness.kernel.execute(runCommand("restart", restarted.envelope.runId, restarted.version));
    assert.equal(again.state, "rejected");
    if (again.state !== "rejected") return;
    assert.match(again.message, /only a terminal run can be retried/u);
    const retryAgain = harness.kernel.execute(runCommand("retry", restarted.envelope.runId, restarted.version));
    assert.equal(retryAgain.state, "rejected");
  });
});
