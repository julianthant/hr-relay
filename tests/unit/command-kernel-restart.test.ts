import { RunRecordService } from "../../src/core/run-record-service.js";
/**
 * D314 — the command kernel's two ordinary recovery choices.
 *
 * `retry` (Resume from checkpoints) and `restart` (Restart from start) share
 * one door: both mint the ITEM's next attempt as a fresh run, keep the logical
 * item, canonical input, dry-run flag and omission bundle byte for byte, and
 * link back through `retryOf`. Only `restart` stamps `recovery:
 * "restart-from-start"`, and neither is admitted for a parked unknown write.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../src/base/workflow.js";
import {
  createCommandKernel,
  type CommandKernel,
  type WorkerRuntimeExecutor,
  type WriteResolutionExecutor,
} from "../../src/core/command-kernel.js";
import { manualClock } from "../../src/domain/clock.js";
import { EidSchema } from "../../src/domain/ids.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../src/infra/sqlite/index.js";
import { planStart } from "../../src/services/start/plan.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../fixtures/operator-command-fixtures.js";
import { FixtureReadReceipt } from "./architecture/helpers/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";

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
  const root = mkdtempSync(join(tmpdir(), "hrauto-kernel-recovery-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "kernel.sqlite"), busyTimeoutMs: 250, migrationOwner: "kernel-recovery-test" },
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
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors: { resolve: (workflowId) => (String(descriptor.id) === workflowId ? descriptor : undefined) },
    explorerEdits: {
      reconcilePending: () => undefined,
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
      configFingerprint: "b".repeat(64),
      configSnapshotId: "44444444-4444-4444-8444-444444444444",
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

describe("command-kernel recovery choices (D314)", () => {
  it("restart mints the item's next attempt with recovery: restart-from-start and carries input, dryRun and omissions unchanged", () => {
    const harness = createHarness();
    // D209: this transaction-free fixture cannot be started as a dry run, so the
    // carried flag is proved on its only admissible value.
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
