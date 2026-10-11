import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import {
createCommandKernel,
type CommandKernel,
type CommandKernelDependencies,
} from "../../../../src/backend/runs/commands/command-kernel.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { seedSyntheticRuntimeConfig,singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
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

const unrelated=():never=>{throw new Error("unrelated kernel effect reached");};
const workerRuntime:CommandKernelDependencies["workerRuntime"]={pool:{planPoolWorkerCount:unrelated,spawnPoolWorker:unrelated,
  refreshPoolBrowser:unrelated,reopenPoolBrowser:unrelated,stopPoolWorker:unrelated,pausePoolWorker:unrelated,resumePoolWorker:unrelated}};
const writeResolution:CommandKernelDependencies["writeResolution"]={resolvePresent:unrelated,resolveAbsent:unrelated};

interface Harness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly configIdentity: CommandKernelDependencies["configIdentity"];
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

function createHarness(): Harness {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-kernel-recovery-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "kernel.sqlite"), busyTimeoutMs: 250, migrationOwner: "kernel-recovery-test" },
    clock,
  );
  openDatabases.push(database);
  seedSyntheticRuntimeConfig(database);
  const active=database.authority.runtimeConfig.get();assert.ok(active);
  const configIdentity={configSnapshotId:active.configSnapshotId,configFingerprint:active.configFingerprint};
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors: { resolve: (workflowId) => (String(descriptor.id) === workflowId ? descriptor : undefined) },
    explorerEdits: {
      apply: (): never => { throw new Error("this harness composes no explorer edit executor"); },
    },
    writeResolution,
    workerRuntime,
    settings: {
      validateRequest: () => undefined,
      commitPrivate: () => undefined,
      reconcileReplay: () => { throw new Error("this harness composes no settings replay authority"); },
      applyOrdinary: (): never => { throw new Error("this harness composes no settings apply authority"); },
    },
  });
  return { database, kernel, clock, configIdentity, plannerIds: sequentialIdFactory("f") };
}

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

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

function runCommand(type: string, runId: string, expectedVersion: number) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type,
    target: { runId, expectedVersion },
  } as const;
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
  it("restart mints the item's next attempt with recovery: restart-from-start and carries input, dryRun and omissions unchanged", () => {
    const harness = createHarness();

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

  it("retry (Resume from checkpoints) mints the same next attempt WITHOUT a recovery marker", () => {
    const harness = createHarness();
    const target = startTerminalRun(harness, { dryRun: false, omit: false });
    const resumed = recoveredRun(harness, "retry", target);
    assert.equal(Object.hasOwn(resumed.envelope, "recovery"), false);
    assert.equal(resumed.envelope.retryOf, target.runId);
    assert.equal(resumed.envelope.attempt, 2);
  });

  it("refuses restart for a non-terminal run exactly as it refuses retry", () => {
    const harness = createHarness();
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
