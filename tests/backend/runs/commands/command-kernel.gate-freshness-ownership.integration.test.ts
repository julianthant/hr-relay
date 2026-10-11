
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { explorerEditCommandFingerprint } from "../../../../src/models/dashboard/explorer-override.js";
import { testRunContinuation } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT, writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { separationsIdentityCheckModule } from "../../../../src/backend/app/registries/step-proof-modules.js";
import { createCommandKernel, type CommandKernel, type ExplorerEditExecutor, type SettingsApplicationExecutor, type WorkerPoolRuntimeAdoption, type WriteResolutionExecutor } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { ExplorerEditApplyResultSchema, ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { UcpathReadJobSummary } from "../../../../src/models/systems/ucpath/read-job-summary.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";

import { FactProvenanceSchema } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";

import { EidSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";

import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt, fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { seedInitialSettingsRuntimeConfig, singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase, createCredentialStore, type AuthorityRepositories } from "../../../support/helpers/synthetic-storage-admission.js";

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
const externalGateInputSchema = z.strictObject({ token: z.string().min(1) });
const externalGateCanonicalInput = defineCanonicalInput(
  externalGateInputSchema,
  externalGateInputSchema,
  [{ token: "external-gate-fixture" }],
);
const externalGateResultSchema = z.strictObject({ authorized: z.boolean() });
const externalGateFlow = flow(externalGateInputSchema)
  .gate("approval", {
    dependsOn: [],
    label: "External Approval",
    resolvedBy: "external",
    subscribes: {
      kind: "external",
      sourceId: "fixture-approval-source",
      event: z.strictObject({ approved: z.boolean() }),
      correlationKey: "runId",
    },
    result: externalGateResultSchema,
    resolve: () => ({ authorized: true }),
  })
  .build({
    schema: externalGateResultSchema,
    dependsOn: ["approval"],
    derive: ({ outputs }) => outputs.approval,
  });
const externalGateDescriptor = defineWorkflowDescriptor({
  id: "kernel-external-gate",
  version: 1,
  contractFingerprint: FingerprintSchema.parse("e".repeat(64)),
  code: "keg",
  label: "External Gate Fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: externalGateCanonicalInput,
  inputSubject: () => "none",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `external-gate:${input.token}` },
  presentation: { title: (input) => `External gate ${input.token}` },
  scenarios: ["command-kernel/external-gate"],
  flow: {
    ...externalGateFlow,
  },
});

const finiteGateInputSchema = z.strictObject({ emplId: EidSchema });
const finiteGateCanonicalInput = defineCanonicalInput(
  finiteGateInputSchema,
  finiteGateInputSchema,
  [{ emplId: "10873698" }],
);
const finiteGateFlow = flow(finiteGateInputSchema)
  .step("job-summary", UcpathReadJobSummary, {
    dependsOn: [],
    replay: "always-rerun",
    bind: ({ input }) => ({ emplId: input.emplId }),
  })
  .gate("approval", {
    dependsOn: ["job-summary"],
    label: "Finite Freshness Approval",
    resolvedBy: "operator",
    result: externalGateResultSchema,
  })
  .build({
    schema: externalGateResultSchema,
    dependsOn: ["approval"],
    derive: ({ outputs }) => externalGateResultSchema.parse(outputs.approval),
  });
const finiteGateDescriptor = defineWorkflowDescriptor({
  id: "kernel-finite-gate",
  version: 1,
  contractFingerprint: FingerprintSchema.parse("f".repeat(64)),
  code: "kfg",
  label: "Finite Gate Fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: finiteGateCanonicalInput,
  inputSubject: () => "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `eid:${input.emplId}` },
  presentation: { title: (input) => `Finite gate ${input.emplId}` },
  scenarios: ["command-kernel/finite-gate"],
  flow: { ...finiteGateFlow },
});

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

function _createPlan(harness: Harness, descriptor: AnyWorkflowDescriptor, eids: readonly string[]) {
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

function startCommand(plan: ReturnType<typeof _createPlan>, commandId = nextCommandId()) {
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

describe("gate resolution", () => {

  function gateCommand(runId: string, expectedVersion: number, result: unknown, gateId = "identity-approval") {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
      target: { runId, gateId, expectedVersion },
      payload: { result },
    };
  }

  function assertGateRefusalHasNoMutation(
    harness: Harness,
    runId: string,
    command: ReturnType<typeof gateCommand>,
    expectedCode: "invalid-state" | "schema-mismatch",
  ) {
    const beforeRun = harness.database.authority.runs.get(runId);
    const beforeEvents = harness.database.authority.timelineEvents.page({});
    const beforeGeneration = harness.database.getMeta().authorityGeneration;
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, expectedCode);
    assert.deepEqual(harness.database.authority.runs.get(runId), beforeRun);
    assert.equal(harness.database.authority.gateResults.get(`${runId}:${command.target.gateId}`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, beforeGeneration);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), beforeEvents);
    return result;
  }

  it("refuses a stale direct gate dependency under its finite declared freshness bound", () => {
    const harness = createHarness(undefined, { descriptors: [...DESCRIPTOR_SET, finiteGateDescriptor] });
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: finiteGateDescriptor,
        submissions: [{ emplId: "10873698" }],
        dryRun: false,
        priority: "bulk",
        shape: "single",
        configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
    assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);
    const claimed = harness.database.authority.runs.claimNext({
      workflow: String(finiteGateDescriptor.id), workerId: "worker-1", now: NOW,
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("finite-gate fixture was not claimed");

    const task = descriptorRuntimeNodes(finiteGateDescriptor)
      .find((node) => node.kind === "task" && String(node.id) === "job-summary");
    assert.ok(task?.kind === "task");
    const observedAt = new Date(Date.parse(NOW) - 4 * 60 * 60 * 1000 - 1).toISOString();
    const output = UcpathReadJobSummary.output.parse({ ...UcpathReadJobSummary.example, observedAt });
    const inserted = harness.database.authority.runCheckpoints.insert({
      workflowId: finiteGateDescriptor.id,
      itemId: claimed.run.envelope.itemId,
      nodeId: "job-summary",
      attempt: claimed.run.envelope.attempt,
      claimGeneration: claimed.run.claimGeneration,
      runId,
      output: { schemaHash: deriveSchemaHash(task.uses.output, "output"), value: output },
      descriptorVersion: finiteGateDescriptor.version,
      contractFingerprint: finiteGateDescriptor.contractFingerprint,
      implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, task.uses.id),
      provenance: [FactProvenanceSchema.parse({
        path: "observedAt",
        source: "live",
        observedAt,
        originalObservedAt: observedAt,
      })],
      writtenAt: NOW,
    });
    assert.equal(inserted.state, "inserted");

    const claim = { workerId: "worker-1", claimGeneration: claimed.run.claimGeneration };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      const transitioned = harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim,
        lifecycle: { state, workerId: claim.workerId, claimedAt: NOW, heartbeatAt: NOW }, now: NOW,
      });
      assert.equal(transitioned.state, "applied");
      if (transitioned.state !== "applied") throw new Error("finite-gate run transition was refused");
      version = transitioned.run.version;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "approval" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("finite gate was not parked");

    const gate = descriptorRuntimeNodes(finiteGateDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "approval");
    assert.ok(gate?.kind === "gate");
    const refusal = assertGateRefusalHasNoMutation(harness, runId, gateCommand(
      runId,
      parked.run.version,
      { schemaHash: deriveSchemaHash(gate.result, "output"), value: { authorized: true } },
      "approval",
    ), "invalid-state");
    if (refusal.state === "rejected") {
      assert.match(refusal.message, /expired .*4 hours|expired .*14400000ms/u);
    }
  });

  it("refuses an operator resolution for a gate owned by its registered external source", () => {
    const harness = createHarness(undefined, { descriptors: [...DESCRIPTOR_SET, externalGateDescriptor] });
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: externalGateDescriptor,
        submissions: [{ token: "operator-test" }],
        dryRun: false,
        priority: "bulk",
        shape: "single",
        configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
    assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);
    const claimResult = harness.database.authority.runs.claimNext({
      workflow: String(externalGateDescriptor.id), workerId: "worker-1", now: NOW,
    });
    assert.equal(claimResult.state, "claimed");
    if (claimResult.state !== "claimed") throw new Error("external-gate fixture was not claimed");
    const claim = { workerId: "worker-1", claimGeneration: claimResult.run.claimGeneration };
    let version = claimResult.run.version;
    for (const state of ["validating", "running"] as const) {
      const transitioned = harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, workerId: claim.workerId,
          claimedAt: NOW, heartbeatAt: NOW }, now: NOW,
      });
      assert.equal(transitioned.state, "applied");
      if (transitioned.state !== "applied") throw new Error("external-gate run transition was refused");
      version = transitioned.run.version;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "approval" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("external gate was not parked");
    const gate = descriptorRuntimeNodes(externalGateDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "approval");
    assert.ok(gate?.kind === "gate");
    const command = gateCommand(runId, parked.run.version, {
      schemaHash: deriveSchemaHash(gate.result, "output"),
      value: { approved: true },
    }, "approval");
    const beforeEvents = harness.database.authority.timelineEvents.page({});
    const beforeGeneration = harness.database.getMeta().authorityGeneration;
    const refusal = harness.kernel.execute(command);
    assert.equal(refusal.state, "rejected");
    if (refusal.state === "rejected") {
      assert.equal(refusal.code, "invalid-state");
      assert.match(refusal.message, /only its registered source may settle it/);
    }
    assert.equal(harness.database.authority.gateResults.get(`${runId}:approval`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.runs.get(runId)?.lifecycle.state, "parked-gate");
    assert.equal(harness.database.getMeta().authorityGeneration, beforeGeneration);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), beforeEvents);
  });
});
