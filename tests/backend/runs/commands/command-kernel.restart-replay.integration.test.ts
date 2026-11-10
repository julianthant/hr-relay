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
import { defineWorkflowDescriptor, workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { WriteFixturePrepare, WriteFixtureCommit } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { type AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { testAdmittedWorker, testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { buildEntryValidationFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { buildFailureTerminalAuthorization } from "../../../../src/backend/runs/lifecycle/terminal-authorization.js";

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
  timeline: [{ key: "probing", label: "Probing", nodes: ["probe"], omission: { form: { fields: [{ key: "present", label: "Present", kind: "boolean" }] }, produces: { probe: ({ facts, scope }) => ({ eid: (scope.input as { eid: string }).eid, present: facts.present === true }) } } },
    { key: "filing", label: "Filing", nodes: ["submit"] }],
  flow: flow(KernelInput)
    .step("probe", FixtureReadReceipt, {
      dependsOn: [],
      replay: "checkpoint",
      bind: ({ input }) => ({ eid: input.eid }),
    })
    .transaction("submit", { dependsOn: ["probe"], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 })
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

function startTerminalRun(harness: Harness, options: Readonly<{ dryRun: boolean; omit: boolean }>, outcome: "failed" | "cancelled" | "queued" = "failed"): { runId: string; version: number } {
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
  if (outcome === "queued") return { runId, version: original.version };
  if (outcome === "cancelled") assert.equal(harness.kernel.execute(runCommand("cancel", runId, original.version)).state, "applied");
  else {
    const owner = testAdmittedWorker(harness.database, harness.clock, { path: syntheticDatabasePath(harness.database), workflow: descriptor.id, poolIndex: 1, browserSystems: workflowProjections(descriptor).systems });
    const lifecycle = testRunService(harness.database, harness.clock);
    const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: nextCommandId(), workflow: descriptor.id, workerId: owner.workerId,
      runtimeConfig: selectRunRuntime(harness.database.authority) }));
    assert.equal(claimed.envelope.runId, runId);
    const failure = buildEntryValidationFailureRecord({ run: claimed, failureId: nextCommandId(), problems: ["fixture entry refused"], occurredAt: NOW });
    const authorization = buildFailureTerminalAuthorization({ run: claimed, authorizedAt: NOW, consequence: { kind: "failed", failure } });
    requireLifecycleApplied(lifecycle.terminalize({ commandId: nextCommandId(), kind: "failure", terminal: { authorization, failure } }, descriptor));
  }
  const version = harness.database.authority.runs.get(runId)?.version;
  assert.ok(version !== undefined);
  return { runId, version };
}

function recoveredRun(harness: Harness, type: "retry", target: { runId: string; version: number }) {
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
  it.each([false, true])("Retry preserves failed-source input, omissions and dryRun=%s without a recovery marker", async dryRun => {
    const harness = await createHarness();
    const target = startTerminalRun(harness, { dryRun, omit: true });
    const original = harness.database.authority.runs.get(target.runId); assert.ok(original);
    const resumed = recoveredRun(harness, "retry", target);
    assert.equal(Object.hasOwn(resumed.envelope, "recovery"), false);
    assert.equal(resumed.envelope.continuation, undefined);
    assert.equal(resumed.envelope.retryOf, target.runId);
    assert.equal(resumed.envelope.attempt, 2);
    assert.equal(resumed.envelope.itemId, original.envelope.itemId);
    assert.equal(resumed.envelope.dryRun, dryRun);
    assert.deepEqual(resumed.envelope.stepOmissions, STEP_OMISSIONS);
    assert.deepEqual(resumed.input, original.input);
    assert.equal(Object.hasOwn(resumed.envelope, "startAt"), false);
    assert.deepEqual(harness.database.authority.writeIntents.listByRun(original.envelope.runId), []);
    assert.deepEqual(harness.database.authority.writeIntents.listByRun(resumed.envelope.runId), []);
  });
});
