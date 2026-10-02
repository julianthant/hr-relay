import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
/**
 * D307 — the command kernel's start and retry envelope builders
 * (src/backend/runs/commands/command-kernel.ts `executeStartRun` / `executeRetry`) must carry
 * `stepOmissions` onto the run they create, byte for byte, the same way
 * `captureBrowserScreenshots` already rides through both doors. This is a
 * thin harness mirroring tests/unit/command-kernel.test.ts's own fixtures,
 * scoped to exactly the start → retry path.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../../../src/workflow-kit/workflow.js";
import {
  createCommandKernel,
  type CommandKernel,
  type WorkerRuntimeExecutor,
  type WriteResolutionExecutor,
} from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { EidSchema } from "../../../../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../../src/models/workflow/presentation.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { planStart } from "../../../../../../src/backend/runs/start/plan.js";
import { NOW } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { fixtureDescriptor, FixtureReadReceipt } from "../../../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../../../support/fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../../../../support/fixtures/archive-fixtures.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

function databasePath(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-kernel-omission-"));
  roots.push(root);
  return join(root, name);
}

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

function acceptingWorkerRuntime(): WorkerRuntimeExecutor {
  return {
    planWorkerCount: () => ({ state: "accepted", workerIds: ["worker-1"] }),
    spawnWorker: () => ({ state: "accepted" }),
    refreshBrowser: () => ({ state: "accepted" }),
    reopenBrowser: () => ({ state: "accepted" }),
  };
}

function requeueingWriteResolution(): WriteResolutionExecutor {
  const resolve = (repositories: AuthorityRepositories, context: {
    readonly run: { envelope: { runId: string }; version: number };
    readonly now: string;
  }) => {
    const outcome = repositories.runs.transition({
      runId: context.run.envelope.runId,
      expectedVersion: context.run.version,
      lifecycle: { state: "queued" },
      now: context.now,
    });
    if (outcome.state !== "applied") throw new Error(`fake write resolution could not requeue: ${outcome.state}`);
    return { run: outcome.run };
  };
  return { resolvePresent: resolve, resolveAbsent: resolve };
}

interface Harness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

function createHarness(): Harness {
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: databasePath("kernel.sqlite"), busyTimeoutMs: 250, migrationOwner: "kernel-omission-test" },
    clock,
  );
  openDatabases.push(database);
  seedSyntheticRuntimeConfig(database);
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
    },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors: {
      resolve: (workflowId) => DESCRIPTOR_SET.find((descriptor) => String(descriptor.id) === workflowId),
    },
    explorerEdits: {
      apply: (): never => { throw new Error("this harness composes no explorer edit executor"); },
    },
    writeResolution: requeueingWriteResolution(),
    workerRuntime: acceptingWorkerRuntime(),
    settings: {
      prepare: () => undefined,
      reconcileReplay: () => { throw new Error("this harness composes no settings replay authority"); },
      apply: (): never => { throw new Error("this harness composes no settings apply authority"); },
    },
  });
  return { database, kernel, clock, plannerIds: sequentialIdFactory("f") };
}

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

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
      configFingerprint: "b".repeat(64),
      configSnapshotId: "44444444-4444-4444-8444-444444444444",
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

describe("command-kernel start/retry step-omission carry (D307)", () => {
  it("carries the consumed start plan's stepOmissions onto the created run's envelope", () => {
    const harness = createHarness();
    const plan = createPlan(harness, ["10800000"], STEP_OMISSIONS);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    const runId = singleAppliedRunId(result);
    const run = harness.database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    assert.deepEqual(run.envelope.stepOmissions, STEP_OMISSIONS);
  });

  it("omits stepOmissions from the created run's envelope when the plan carried none", () => {
    const harness = createHarness();
    const plan = createPlan(harness, ["10800001"]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    const run = harness.database.authority.runs.get(singleAppliedRunId(result));
    assert.ok(run !== undefined);
    assert.equal(Object.hasOwn(run.envelope, "stepOmissions"), false);
  });

  it("carries the retried run's stepOmissions onto the fresh attempt, byte for byte", () => {
    const harness = createHarness();
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
