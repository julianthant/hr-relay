import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { explorerEditCommandFingerprint } from "../../../../src/models/dashboard/explorer-override.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { testRunContinuation,testRunLifecycle,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import {
WRITE_FIXTURE_IMPL_FINGERPRINT,
WRITE_FIXTURE_RUN_ID,
absentProbeEvidence,
buildWriteFixtureRegistry,
createWriteFixtureWorld,
writeFixtureDescriptor,writeFixtureQueuedRun,
writeFixtureSessions
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";

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
import { ExplorerEditApplyResultSchema,ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt,fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import {
seedInitialSettingsRuntimeConfig
} from "../../../support/fixtures/operator-command-fixtures.js";
import {
NOW
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

function runCommand(type: string, runId: string, expectedVersion: number, extra?: Record<string, unknown>) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "run",
    type,
    target: { runId, expectedVersion },
    ...(extra === undefined ? {} : extra),
  };
}

describe("write resolution", () => {
  async function parkOnWrite(harness: Harness) {
    const active = harness.database.authority.runtimeConfig.get(); assert.ok(active);
    const world = createWriteFixtureWorld(), stores = buildWriteFixtureRegistry(world), sessions = writeFixtureSessions(world);
    const scheduler = new ManualScheduler(harness.clock), ids = sequentialIdFactory("b"), emitter = recordingEmitter().emitter, log = recordingLogger().log;
    harness.clock.advanceWall(Date.parse("2026-08-03T09:00:00.000Z") - harness.clock.nowMs());
    const run = RunRecordSchema.parse(writeFixtureQueuedRun());
    harness.database.authority.runs.enqueue({ ...run, envelope: { ...run.envelope, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId } });
    const ports = testWorkerPorts(harness.database, harness.clock, { path: join(harness.stateRoot, "kernel.sqlite"), descriptor: writeFixtureDescriptor, poolIndex: 1 });
    const slot = harness.database.authority.workerSlots.list(writeFixtureDescriptor.id)[0];
    world.probeResults.push(absentProbeEvidence(NOW)); world.commitThrows = new Error("probe returned unknown");
    await runWorkerLoop({ ...ports, workflowId: writeFixtureDescriptor.id, workerId: slot.workerId, descriptor: writeFixtureDescriptor,
      stores, authority: harness.database, sessionFactory: sessions.factory, emitter, clock: harness.clock, ids, scheduler,
      taskDeadlineMs: 60_000, sessionAcquireMs: 20_000, duoCeremony: fixtureDuoCeremonyGates(harness.clock), heartbeatIntervalMs: 600_000,
      idleRepollMs: 1_000, log, stopSignal: new AbortController().signal, exitWhenIdle: true,
      writeSequencerFor: manager => createWriteSequencer({ lifecycle: testRunLifecycle(harness.database, harness.clock), stores,
        authority: harness.database, sessions: manager, emitter, clock: harness.clock, ids, scheduler, taskDeadlineMs: 60_000,
        operator: "local-operator", log, resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT }) });
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(parked && parked.lifecycle.state === "parked-write");
    const intent = harness.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID)[0]; assert.ok(intent.status === "parked"); if (intent.status !== "parked") throw new Error("fixture intent must be parked");
    return { runId: WRITE_FIXTURE_RUN_ID, version: parked.version, intent };
  }

  it("resolves a parked write through the typed executor seam inside the command transaction", async () => {
    const harness = createHarness();
    const parked = await parkOnWrite(harness);
    const result = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version,
        writeIntentId: parked.intent.writeIntentId, writeAttemptId: parked.intent.currentAttemptId, bindingProofDigest: parked.intent.bindingProofDigest,
        intentGeneration: 1,
      },
      payload: { occurrenceKeyDigest: parked.intent.idempotencyKeyDigest, evidenceNote: "Checked UCPath directly; the transaction is absent" },
    }));
    assert.equal(result.state, "applied");
    assert.deepEqual(harness.writeCalls, [`resolve-write-absent:${parked.runId}`]);
    assert.equal(harness.database.authority.runs.get(parked.runId)?.lifecycle.state, "queued");
  });

  it("CAS-conflicts on a stale version and rejects a stale intent generation", async () => {
    const harness = createHarness();
    const parked = await parkOnWrite(harness);
    const stale = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version + 3, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version + 3,
        writeIntentId: parked.intent.writeIntentId, writeAttemptId: parked.intent.currentAttemptId, bindingProofDigest: parked.intent.bindingProofDigest,
        intentGeneration: 1,
      },
      payload: { occurrenceKeyDigest: parked.intent.idempotencyKeyDigest, evidenceNote: "stale browser action" },
    }));
    assert.equal(stale.state, "conflict");

    const staleGeneration = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version,
        writeIntentId: parked.intent.writeIntentId, writeAttemptId: parked.intent.currentAttemptId, bindingProofDigest: parked.intent.bindingProofDigest,
        intentGeneration: 4,
      },
      payload: { occurrenceKeyDigest: parked.intent.idempotencyKeyDigest, evidenceNote: "stale generation" },
    }));
    assert.equal(staleGeneration.state, "rejected");
    if (staleGeneration.state === "rejected") assert.equal(staleGeneration.code, "invalid-state");
    assert.deepEqual(harness.writeCalls, []);
    assert.equal(harness.database.authority.runs.get(parked.runId)?.lifecycle.state, "parked-write");
  });
});
