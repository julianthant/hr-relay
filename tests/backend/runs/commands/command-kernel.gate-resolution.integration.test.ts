import { DatabaseSync } from "node:sqlite";
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
deriveGateResultCheckpointFingerprint,
type CommandKernel,
type ExplorerEditExecutor,
type SettingsApplicationExecutor,
type WorkerPoolRuntimeAdoption,
type WriteResolutionExecutor
} from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { ExplorerEditApplyResultSchema,ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { UcpathReadJobSummary } from "../../../../src/models/systems/ucpath/read-job-summary.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import type { RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { FactProvenanceSchema,checkpointLookupKey } from "../../../../src/models/workflow/checkpoint.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { MatchIdentityOutputSchema } from "../../../../src/models/workflows/separations/match-identity.js";
import { deriveStableUuid } from "../../../../src/rules/identity/identifiers.js";
import { EidSchema,FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import { deriveIdentityEvidenceDigest } from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { BUILD_MANIFEST,resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { defineWorkflowDescriptor,descriptorRuntimeNodes,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt,fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import {
seedInitialSettingsRuntimeConfig,
singleAppliedRunId
} from "../../../support/fixtures/operator-command-fixtures.js";
import {
HASH_A,
NOW,
UUID_4
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
  function stageIdentityGateRun(
    harness: Harness,
    source: "name-resolved" | "document-eid" = "name-resolved",
    planChange?: Readonly<{ currentReason: string; previousReason: string }>,
  ): { runId: string; version: number; evidenceDigest: string; eid: string; checkpoint: RunCheckpointRecord } {
    const submission = source === "name-resolved"
      ? {
        documentNumber: "4502",
        employeeName: "Hernandez, Jose Santos",
        emplId: "10401814",
        emplIdSource: "name-resolved" as const,
        documentEid: { state: "absent" as const, reason: "the separation document's EID field was blank" },
      }
      : {
        documentNumber: "4510",
        employeeName: "Battistessa, Johnnie",
        emplId: "10873698",
        emplIdSource: "document-eid" as const,
        documentEid: { state: "present" as const, value: "10873698" },
      };
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: identityCheckDescriptor,
        submissions: [submission],
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
    const claimed = harness.database.authority.runs.claimNext({ workflow: identityCheckDescriptor.id, workerId: "worker-1", now: NOW });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("unreachable");
    const claim = { workerId: "worker-1", claimGeneration: claimed.run.claimGeneration };
    const task = descriptorRuntimeNodes(identityCheckDescriptor)
      .find((node) => node.kind === "task" && String(node.id) === "comparison");
    assert.ok(task !== undefined && task.kind === "task");
    const example = MatchIdentityOutputSchema.parse(task.uses.example);
    const packet = {
      ...example.packet,
      ...(planChange === undefined ? {} : { plan: noSeparationWritePlan(planChange.currentReason) }),
      emplIdSource: source,
      documentEidText: source === "document-eid"
        ? example.packet.emplId
        : "the separation document's EID field was blank",
    };
    const output = MatchIdentityOutputSchema.parse({
      packet,
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
    });
    const checkpoint = harness.database.authority.runCheckpoints.insert({
      workflowId: identityCheckDescriptor.id,
      itemId: claimed.run.envelope.itemId,
      nodeId: "comparison",
      attempt: claimed.run.envelope.attempt,
      claimGeneration: claimed.run.claimGeneration,
      runId,
      output: { schemaHash: deriveSchemaHash(task.uses.output, "output"), value: output },
      descriptorVersion: identityCheckDescriptor.version,
      contractFingerprint: identityCheckDescriptor.contractFingerprint,
      implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, task.uses.id),
      provenance: [],
      writtenAt: NOW,
    });
    assert.equal(checkpoint.state, "inserted");
    if (checkpoint.state !== "inserted") throw new Error("identity checkpoint fixture was not inserted");
    const checkpointEvent = harness.database.authority.timelineEvents.get(deriveStableUuid(
      "timeline-checkpoint-recorded",
      checkpointLookupKey(
        checkpoint.record.workflowId,
        checkpoint.record.itemId,
        checkpoint.record.nodeId,
        checkpoint.record.attempt,
        checkpoint.record.claimGeneration,
      ),
    ));
    assert.equal(checkpointEvent?.payload.kind, "checkpoint-recorded");
    if (checkpointEvent?.payload.kind !== "checkpoint-recorded") {
      throw new Error("identity checkpoint fixture did not persist its timeline authority link");
    }
    assert.equal(checkpointEvent.payload.runId, runId);
    assert.equal(checkpointEvent.payload.workflow, identityCheckDescriptor.id);
    assert.equal(checkpointEvent.payload.attempt, claimed.run.envelope.attempt);
    assert.equal(Number(checkpointEvent.payload.claimGeneration), Number(claimed.run.claimGeneration));
    const lifecycleBase = { workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      const outcome = harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, ...lifecycleBase }, now: NOW,
      });
      assert.equal(outcome.state, "applied");
      version += 1;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "identity-approval", parkedAt: NOW, resumeAt: "approval" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("unreachable");
    return {
      runId,
      version: parked.run.version,
      evidenceDigest: output.evidenceDigest,
      eid: packet.emplId,
      checkpoint: checkpoint.record,
    };
  }

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

  function identityResult(staged: { evidenceDigest: string; eid: string }, digest = staged.evidenceDigest) {
    return {
      schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
      value: { decision: "approved", eid: staged.eid, chosenFrom: "checked", evidenceDigest: digest },
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

  it("rolls back gate result, resume and command when the required SQLite event cannot persist", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const gate = descriptorRuntimeNodes(identityCheckDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "identity-approval");
    assert.ok(gate?.kind === "gate");
    const command = gateCommand(staged.runId, staged.version, identityResult(staged));
    const before = harness.database.authority.runs.get(staged.runId);
    const generation = harness.database.getMeta().authorityGeneration;
    const history = harness.database.authority.timelineEvents.page({});
    using raw = new DatabaseSync(join(harness.stateRoot, "kernel.sqlite"));
    raw.exec("CREATE TRIGGER injected_gate_event_failure BEFORE INSERT ON timeline_events BEGIN SELECT RAISE(ABORT, 'injected gate event failure'); END");
    assert.throws(() => harness.kernel.execute(command), /injected gate event failure/);
    assert.deepEqual(harness.database.authority.runs.get(staged.runId), before);
    assert.equal(harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`), undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(harness.database.authority.timelineEvents.page({}), history);
    raw.exec("DROP TRIGGER injected_gate_event_failure");
    assert.equal(harness.kernel.execute(command).state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`);
    assert.ok(stored !== undefined);
    assert.ok(!("source" in stored));
    assert.equal(stored.resolvedBy, "local-operator");
    assert.equal(stored.resolvedAt, NOW);
    assert.deepEqual(stored.result.value, IdentityApprovalResultSchema.parse(identityResult(staged).value));
    const resolved = harness.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "span" && event.payload.event.t === "gate.resolved");
    assert.equal(resolved.length, 1);
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "span" && event.payload.event.t === "gate.resolved").length, 1);
  });

  it("parses the descriptor's exact gate schema, stores the result, and resumes at the parked node", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const gateNode = descriptorRuntimeNodes(identityCheckDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "identity-approval");
    assert.ok(gateNode !== undefined && gateNode.kind === "gate");
    const schemaHash = deriveSchemaHash(gateNode.result, "output");

    assertGateRefusalHasNoMutation(harness, staged.runId, gateCommand(staged.runId, staged.version, {
      ...identityResult(staged), schemaHash: HASH_A,
    }), "schema-mismatch");

    assertGateRefusalHasNoMutation(harness, staged.runId, gateCommand(staged.runId, staged.version, {
      schemaHash,
      value: { decision: "approved", eid: staged.eid, chosenFrom: "checked", evidenceDigest: "malformed" },
    }), "schema-mismatch");

    const stale = harness.kernel.execute(gateCommand(staged.runId, staged.version + 2, {
      ...identityResult(staged), schemaHash,
    }));
    assert.equal(stale.state, "conflict");

    const resolved = harness.kernel.execute(gateCommand(staged.runId, staged.version, identityResult(staged)));
    assert.equal(resolved.state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`);
    assert.ok(stored !== undefined);
    assert.deepEqual(stored.result, { schemaHash, value: identityResult(staged).value });
    assert.equal(stored.checkpointFingerprint, deriveGateResultCheckpointFingerprint(stored.result));
    const resumed = harness.database.authority.runs.get(staged.runId);
    assert.equal(resumed?.lifecycle.state, "queued");
    assert.equal(resumed?.envelope.startAt, "approval");
  });

  it("refuses a decision bound to the previous write plan before writing authority", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness, "name-resolved", {
      currentReason: "the current run does not compose a separation write plan",
      previousReason: "the approved packet showed a prior write plan",
    });
    const currentPacket = MatchIdentityOutputSchema.parse(staged.checkpoint.output.value).packet;
    const staleDigest = deriveIdentityEvidenceDigest({
      ...currentPacket,
      plan: noSeparationWritePlan("the approved packet showed a prior write plan"),
    });
    assertGateRefusalHasNoMutation(
      harness,
      staged.runId,
      gateCommand(staged.runId, staged.version, identityResult(staged, staleDigest)),
      "invalid-state",
    );
  });

  it("records an explicit rejection by the command actor and resumes at the declared node", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const result = harness.kernel.execute(gateCommand(staged.runId, staged.version, {
      schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
      value: { decision: "rejected", reason: "the packet does not establish this identity", evidenceDigest: staged.evidenceDigest },
    }));
    assert.equal(result.state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:identity-approval`);
    assert.ok(stored !== undefined && !("source" in stored));
    assert.equal(stored.resolvedBy, "local-operator");
    assert.equal(stored.resolvedAt, NOW);
    assert.equal(IdentityApprovalResultSchema.parse(stored.result.value).decision, "rejected");
    const resumed = harness.database.authority.runs.get(staged.runId);
    assert.equal(resumed?.lifecycle.state, "queued");
    assert.equal(resumed?.envelope.startAt, "approval");
  });

  it("refuses a newer item checkpoint from an unlinked claim before writing authority", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness);
    const sibling = harness.database.authority.runCheckpoints.insert({
      ...staged.checkpoint,
      runId: staged.runId,
      claimGeneration: Number(staged.checkpoint.claimGeneration) + 1,
    });
    assert.equal(sibling.state, "inserted");
    assertGateRefusalHasNoMutation(
      harness,
      staged.runId,
      gateCommand(staged.runId, staged.version, identityResult(staged)),
      "invalid-state",
    );
  });

  it("refuses a gate whose declared condition is now false before writing authority", () => {
    const harness = createHarness();
    const staged = stageIdentityGateRun(harness, "document-eid");
    assertGateRefusalHasNoMutation(
      harness,
      staged.runId,
      gateCommand(staged.runId, staged.version, identityResult(staged)),
      "invalid-state",
    );
  });
});
