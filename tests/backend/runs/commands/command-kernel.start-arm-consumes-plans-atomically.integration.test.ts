import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { explorerEditCommandFingerprint } from "../../../../src/models/dashboard/explorer-override.js";
import { testRunContinuation } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import {
WRITE_FIXTURE_IMPL_FINGERPRINT,
writeFixtureDescriptor
} from "../../../support/fixtures/write-sequencer-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { separationsIdentityCheckModule } from "../../../../src/backend/app/registries/step-proof-modules.js";
import {
createCommandKernel,
type CommandKernel,
type ExplorerEditExecutor,
type SettingsApplicationExecutor,
type WorkerPoolRuntimeAdoption,
type WriteResolutionExecutor
} from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import {
SETTINGS_SCHEMA_HASH,
deriveSettingsPatchFingerprint
} from "../../../../src/models/config/settings.js";
import { ExplorerEditApplyResultSchema,ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt,fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import {
appliedRunIds,
seedInitialSettingsRuntimeConfig,
singleAppliedRunId,
} from "../../../support/fixtures/operator-command-fixtures.js";
import {
HASH_A,
NOW,
UUID_4,
UUID_7
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase,createCredentialStore,type AuthorityRepositories } from "../../../support/helpers/synthetic-storage-admission.js";


const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

function databasePath(name: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-command-kernel-"));
  roots.push(root);
  return join(root, name);
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ── fixture descriptors: one per enqueue policy ─────────────────────────── */

const KernelInput = z.strictObject({ eid: EidSchema });
const KernelCanonicalInput = defineCanonicalInput(
  KernelInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10800000" }, { eid: "10800001" }],
);

function kernelDescriptor(id: string, code: string, enqueue: "reject-active" | "supersede-active" | "allow-parallel") {
  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: "e".repeat(64),
    code,
    label: `Kernel ${id}`,
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: KernelCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue,
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
}

const rejectActiveDescriptor = kernelDescriptor("kernel-reject", "kr", "reject-active");
const supersedeDescriptor = kernelDescriptor("kernel-supersede", "ks", "supersede-active");
const parallelDescriptor = kernelDescriptor("kernel-parallel", "kp", "allow-parallel");
const identityCheckDescriptor = separationsIdentityCheckModule.descriptor;
const DESCRIPTOR_SET: readonly AnyWorkflowDescriptor[] = [
  rejectActiveDescriptor,
  supersedeDescriptor,
  parallelDescriptor,
  fixtureDescriptor,
  identityCheckDescriptor,
  writeFixtureDescriptor,
];


/* ── harness ─────────────────────────────────────────────────────────────── */

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;
type AuthorityTransactionWrap = <Result>(
  database: AuthorityDatabase,
  work: (repositories: AuthorityRepositories) => Result,
) => Result;

interface HarnessOptions {
  readonly failureResolution?: import("../../../../src/backend/runs/commands/command-kernel.js").CommandKernelDependencies["failureResolution"];
  readonly explorerEdits?: ExplorerEditExecutor;
  readonly afterAuthorityCommit?: () => void;
  readonly descriptors?: readonly AnyWorkflowDescriptor[];
}

interface Harness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
  readonly workerCalls: string[];
  readonly writeCalls: string[];
  readonly credentials: ReturnType<typeof createCredentialStore>;
  readonly stateRoot: string;
  readonly explorerCalls: unknown[];
}

function acceptingWorkerRuntime(calls: string[], database: AuthorityDatabase): WorkerPoolRuntimeAdoption {
  const control = async (context: import("../../../../src/backend/runs/commands/command-kernel.js").WorkerRuntimeContext) => {
    const command = context.command;
    calls.push(`${command.type === "spawn-worker" ? "spawn" : command.type === "refresh-browser" ? "refresh" : command.type === "reopen-browser" ? "reopen" : command.type}:${command.type}`);
    if ((command.type === "stop-worker" || command.type === "pause-worker" || command.type === "resume-worker") && "workerId" in command.target) {
      const lease = database.authority.workerLeases.get(command.target.workerId);
      assert.ok(lease);
      const result = database.authority.workerLeases.control({ workerId: lease.workerId,
        expectedVersion: lease.version, commandId: command.commandId, control: { directive: command.type === "stop-worker" ? "stop" : command.type === "pause-worker" ? "pause" : "run",
        requestedBy: command.requestedBy, requestedAt: context.now }, now: context.now });
      assert.equal(result.state, "applied");
      if (command.type === "stop-worker") return { state: "accepted", directiveLeaseVersions: { before: lease.version, after: lease.version + 1 } };
    }
    if (command.type === "refresh-browser" || command.type === "reopen-browser") {
      const controls = database.authority.workerControls;
      assert.equal(controls.get(command.commandId)?.phase.state, "admitted");
      controls.transition(command.commandId, "admitted", { state: "ready" });
      controls.transition(command.commandId, "ready", { state: "executing", startedAt: context.now });
      controls.transition(command.commandId, "executing", { state: "succeeded", startedAt: context.now,
        completedAt: context.now, acknowledgement: { kind: "control", browserSessionId: command.target.browserSessionId } });
    }
    return { state: "accepted" };
  };
  return { pool: {
    planPoolWorkerCount: async context => { calls.push(`plan:${context.command.type}`); assert.ok(context.roster);
      return { state: "accepted", workerIds: context.roster.selected.map(slot => slot.workerId), retirements: [] }; },
    spawnPoolWorker: control, refreshPoolBrowser: control, reopenPoolBrowser: control,
    stopPoolWorker: control, pausePoolWorker: control, resumePoolWorker: control,
  } };
}

function requeueingWriteResolution(calls: string[], database: AuthorityDatabase, clock: ReturnType<typeof manualClock>): WriteResolutionExecutor {
  const executor = createWriteResolutionExecutor({ authority: database,
    continuation: testRunContinuation(database, clock), ids: sequentialIdFactory("c"),
    descriptors: { resolve: id => id === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined },
    resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT });
  return {
    resolvePresent: (repositories, context) => { calls.push(`${context.command.type}:${context.run.envelope.runId}`); return executor.resolvePresent(repositories, context); },
    resolveAbsent: (repositories, context) => { calls.push(`${context.command.type}:${context.run.envelope.runId}`); return executor.resolveAbsent(repositories, context); },
  };
}

function createHarness(
  wrap?: RepositoryWrap,
  settingsInputOrOptions?: SettingsApplicationExecutor | HarnessOptions,
  transactionWrap?: AuthorityTransactionWrap,
): Harness {
  const options = settingsInputOrOptions !== undefined && !("applyOrdinary" in settingsInputOrOptions)
    ? settingsInputOrOptions : {};
  const descriptors = options.descriptors ?? DESCRIPTOR_SET;
  const settingsOverride = settingsInputOrOptions !== undefined && "applyOrdinary" in settingsInputOrOptions
    ? settingsInputOrOptions : undefined;
  const clock = manualClock(new Date(NOW));
  const path = databasePath("kernel.sqlite");
  const stateRoot = dirname(path);
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "kernel-test" },
    clock,
  );
  openDatabases.push(database);
  seedInitialSettingsRuntimeConfig(database, clock);
  if (wrap !== undefined) {
    const transaction = database.withAuthorityTransaction.bind(database);
    database.withAuthorityTransaction = (work) => transaction((repositories) => work(wrap(repositories)));
  }

  const workerCalls: string[] = [];
  const writeCalls: string[] = [];
  const credentials = createCredentialStore({ stateRoot });
  const explorerCalls: unknown[] = [];
  const kernel = createCommandKernel({
    ...(options.failureResolution === undefined ? {} : { failureResolution: options.failureResolution }),
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: { configFingerprint: database.authority.runtimeConfig.get()!.configFingerprint, configSnapshotId: database.authority.runtimeConfig.get()!.configSnapshotId },
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => {
        const wrappedWork = (repositories: AuthorityRepositories) =>
          work(repositories);
        const result = transactionWrap === undefined
          ? database.withAuthorityTransaction(wrappedWork)
          : transactionWrap(database, wrappedWork);
        options.afterAuthorityCommit?.();
        return result;
      },
    },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors: {
      resolve: (workflowId) => descriptors.find((descriptor) => String(descriptor.id) === workflowId),
    },
    explorerEdits: options.explorerEdits ?? {
      apply: (input, repositories) => {
        explorerCalls.push(input);
        const override = ExplorerWorkflowOverrideSchema.parse({
          overrideVersion: 1 as const,
          workflowId: input.target.workflowId,
          descriptorVersion: input.target.expectedVersion,
          contractFingerprint: input.target.contractFingerprint,
          revision: input.target.expectedOverrideRevision + 1,
          appliedCommandId: input.commandId,
          commandFingerprint: explorerEditCommandFingerprint(input),
          presentation: { label: "Reviewed fixture label" },
        });
        const readback = repositories.explorerOverrides.replace(input, override);
        return {
          result: ExplorerEditApplyResultSchema.parse({ state: "applied", override, readback }),
        };
      },
    },
    writeResolution: requeueingWriteResolution(writeCalls, database, clock),
    workerRuntime: acceptingWorkerRuntime(workerCalls, database),
    settings: settingsOverride ?? createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), credentials),
  });
  return {
    database,
    kernel,
    clock,
    plannerIds: sequentialIdFactory("f"),
    workerCalls,
    writeCalls,
    credentials,
    stateRoot,
    explorerCalls,
  };
}

let commandSequence = 0;

function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

function createPlan(harness: Harness, descriptor: AnyWorkflowDescriptor, eids: readonly string[]) {
  const plan = planStart(
    { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
    {
      descriptor,
      submissions: eids.map((eid) => ({ eid })),
      dryRun: false,
      priority: "bulk",
      shape: "single",
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: UUID_4,
      plannedBy: "local-operator",
    },
  );
  const created = harness.database.authority.startPlans.create(plan);
  assert.equal(created.state, "inserted");
  return plan;
}

function startCommand(plan: ReturnType<typeof createPlan>, commandId = nextCommandId()) {
  return {
    commandId,
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
  };
}

function applyCurrentSettings(harness: Harness): void {
  const patch = { "browser.headless": { set: false } } as const;
  harness.kernel.execute({
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    },
  });
}

describe("start arm consumes plans atomically", () => {
  it("requires renewed review for a start plan made before settings activation", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    applyCurrentSettings(harness);

    const refused = harness.kernel.execute(startCommand(plan));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "replan-required");
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
  });

  it("consumes the plan and enqueues every accepted run in one applied command", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    assert.equal(plan.planned.length, 2);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), [], "saving a request creates no runs");
    assert.deepEqual(harness.database.authority.runSessions.list(), [], "saving a request creates no batch");

    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.equal(result.affectedTargets.length, 3);
    const runIds = appliedRunIds(result);
    assert.equal(runIds.length, plan.planned.length);

    const consumed = harness.database.authority.startPlans.get(plan.startPlanId);
    assert.ok(consumed?.consumedBy !== undefined);
    assert.equal(consumed.consumedBy.commandId, result.commandId);
    assert.equal(consumed.version, plan.version + 1);
    for (const [index, planned] of plan.planned.entries()) {
      const runId = runIds[index];
      assert.ok(runId !== undefined);
      const run = harness.database.authority.runs.get(runId);
      assert.ok(run !== undefined, runId);
      assert.equal(run.lifecycle.state, "queued");
      assert.deepEqual(run.input.raw, planned.rawInput);
      assert.deepEqual(run.input.parsed, planned.input);
      assert.equal(run.input.ingressSchemaHash, plan.ingressSchemaHash);
      assert.equal(run.envelope.contractFingerprint, plan.descriptorFingerprint);
    }
    const audit = harness.database.authority.commandAudits.findByCommand(result.commandId);
    assert.ok(audit !== undefined);
    assert.equal(audit.result.state, "applied");
    assert.equal(audit.versionChanges[0].before, plan.version);
    assert.equal(audit.versionChanges[0].after, plan.version + 1);
  });

  it("the fan-out is ONE durable session, written before its first member, and membership is the run rows", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    const runIds = appliedRunIds(result);

    const sessionIds = new Set(runIds.map((runId) => harness.database.authority.runs.get(runId)?.sessionId));
    assert.equal(sessionIds.size, 1, "both runs carry the same session id");
    const [sessionId] = [...sessionIds];
    assert.ok(sessionId !== undefined);
    const session = harness.database.authority.runSessions.get(sessionId);
    assert.ok(session !== undefined);
    assert.equal(session.workflow, plan.workflowId);
    assert.deepEqual(session.origin, { kind: "start-plan", startPlanId: plan.startPlanId, actorId: "local-operator" });
    assert.equal(session.startedAt, NOW);
    // Membership is DERIVED — the session row names nobody; the run table does.
    assert.deepEqual(
      harness.database.authority.runs.listBySession(sessionId).map((run) => run.envelope.runId).sort(),
      [...runIds].sort(),
    );
    assert.deepEqual(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).map((row) => row.sessionId), [sessionId]);
  });

  it("rolls back consumption and the journal when a run insert crashes", () => {
    let shouldFail = false;
    const harness = createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        enqueue: (input: unknown) => {
          if (shouldFail) throw new Error("injected run-insert crash");
          return repositories.runs.enqueue(input);
        },
      },
    }));
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    const generationBefore = harness.database.getMeta().authorityGeneration;
    shouldFail = true;
    assert.throws(() => harness.kernel.execute(command), /injected run-insert crash/);
    shouldFail = false;

    const stored = harness.database.authority.startPlans.get(plan.startPlanId);
    assert.equal(stored?.consumedBy, undefined);
    assert.equal(stored?.version, plan.version);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);


    const retried = harness.kernel.execute(command);
    assert.equal(retried.state, "applied");
  });

  it("creates zero runs when the active-run authority lookup fails", () => {
    let shouldFail = false;
    const harness = createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        listByItem: (input: unknown) => {
          if (shouldFail) throw new Error("injected active-run lookup failure");
          return repositories.runs.listByItem(input);
        },
      },
    }));
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    shouldFail = true;
    const generationBefore = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(startCommand(plan)), /injected active-run lookup failure/);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("conflicts on a stale confirmation revision without consuming the plan", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = { ...startCommand(plan), target: { ...startCommand(plan).target, expectedVersion: plan.version + 5 } };
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") return;
    assert.equal(result.currentVersion, plan.version);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("rejects binding drift as schema-mismatch and an expired plan as invalid-state", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const base = startCommand(plan);
    const drifted = { ...base, payload: { ...base.payload, inputFingerprint: HASH_A } };
    const driftResult = harness.kernel.execute(drifted);
    assert.equal(driftResult.state, "rejected");
    if (driftResult.state === "rejected") assert.equal(driftResult.code, "schema-mismatch");
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);

    harness.clock.advanceWall(3_600_000);
    const expired = harness.kernel.execute(startCommand(plan));
    assert.equal(expired.state, "rejected");
    if (expired.state === "rejected") {
      assert.equal(expired.code, "invalid-state");
      assert.match(expired.message, /expired/);
    }
  });

  it("refuses the whole command under reject-active when an active run appeared after planning", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    const itemId = deriveItemId("kernel-reject", "eid:10800001");
    const conflicting = {
      envelope: {
        runId: UUID_7,
        workflow: "kernel-reject",
        itemId,
        traceId: "kr-170000-7777",
        descriptorVersion: 1,
        contractFingerprint: plan.descriptorFingerprint,
        resolvedInstance: { ucpath: "prod" },
        configFingerprint: plan.configFingerprint,
        configSnapshotId: UUID_4,
        shape: "single",
        priority: "bulk",
        dryRun: false,
        attempt: 1,
        enqueuedAt: NOW,
      },
      input: {
        raw: plan.planned[1].rawInput,
        parsed: plan.planned[1].input,
        ingressSchemaHash: plan.ingressSchemaHash,
      },
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    assert.equal(harness.database.authority.runs.enqueue(conflicting).state, "inserted");

    const command = startCommand(plan);
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "policy-refused");
      assert.match(result.message, /already has an active run/);
    }

    assert.equal(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);

    assert.deepEqual(
      harness.database.authority.runs.listByWorkflow(plan.workflowId).map((run) => run.envelope.runId),
      [UUID_7],
    );
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("supersede-active terminalizes the exact active run and creates the replacement atomically", () => {
    const harness = createHarness();
    const first = createPlan(harness, supersedeDescriptor, ["10800000"]);
    const firstResult = harness.kernel.execute(startCommand(first));
    assert.equal(firstResult.state, "applied");
    const activeRunId = singleAppliedRunId(firstResult);

    const second = createPlan(harness, supersedeDescriptor, ["10800000"]);
    const result = harness.kernel.execute(startCommand(second));
    assert.equal(result.state, "applied");
    const replacementId = appliedRunIds(result).at(-1);
    assert.ok(replacementId !== undefined);

    const superseded = harness.database.authority.runs.get(activeRunId);
    assert.equal(superseded?.lifecycle.state, "terminal");
    if (superseded?.lifecycle.state === "terminal") {
      assert.equal(superseded.lifecycle.outcome, "superseded");
    }
    const replacement = harness.database.authority.runs.get(replacementId);
    assert.equal(replacement?.lifecycle.state, "queued");
  });

  it("allow-parallel enqueues beside an active run for the same item", () => {
    const harness = createHarness();
    const first = createPlan(harness, parallelDescriptor, ["10800000"]);
    const firstResult = harness.kernel.execute(startCommand(first));
    assert.equal(firstResult.state, "applied");
    const second = createPlan(harness, parallelDescriptor, ["10800000"]);
    const secondResult = harness.kernel.execute(startCommand(second));
    assert.equal(secondResult.state, "applied");
    const firstRun = harness.database.authority.runs.get(singleAppliedRunId(firstResult));
    const secondRun = harness.database.authority.runs.get(singleAppliedRunId(secondResult));
    assert.equal(firstRun?.lifecycle.state, "queued");
    assert.equal(secondRun?.lifecycle.state, "queued");
  });
});
