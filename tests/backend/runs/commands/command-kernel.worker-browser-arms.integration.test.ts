import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { explorerEditCommandFingerprint } from "../../../../src/models/dashboard/explorer-override.js";
import { testRunContinuation,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
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
import {
SETTINGS_SCHEMA_HASH,
deriveSettingsPatchFingerprint
} from "../../../../src/models/config/settings.js";
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

describe("worker-browser arms", () => {
  function workerCommand(type: string, target: Record<string, unknown>, payload?: Record<string, unknown>) {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "worker-browser",
      type,
      target,
      ...(payload === undefined ? {} : { payload }),
    };
  }

  it("plans worker capacity under activated settings without spawning an unreviewed worker", async () => {
    const harness = createHarness();
    applyCurrentSettings(harness);
    const result = await harness.kernel.executeWorkerPool(workerCommand("plan-worker-count", { workflowId: "kernel-reject", expectedVersion: 0 }, { desiredWorkers: 2 }));
    assert.equal(result.state, "applied");
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 2);
    assert.deepEqual(harness.workerCalls, ["plan:plan-worker-count"]);
  });

  it("writes durable lease directives for stop/pause/resume against current authority", async () => {
    const harness = createHarness();
    testWorkerPorts(harness.database, harness.clock, { path: join(harness.stateRoot, "kernel.sqlite"), descriptor: rejectActiveDescriptor, poolIndex: 1 });
    const workerId = harness.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0].workerId;

    const paused = await harness.kernel.executeWorkerPool(workerCommand("pause-worker", { workerId, expectedVersion: 999, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }));
    assert.equal(paused.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "pause");

    const resumed = await harness.kernel.executeWorkerPool(workerCommand("resume-worker", { workerId, expectedVersion: 999, controlBasis: { leaseGeneration: 1, controlRevision: 2 } }));
    assert.equal(resumed.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "run");

    const stopped = await harness.kernel.executeWorkerPool(workerCommand("stop-worker", { workerId, expectedVersion: 999, controlBasis: { leaseGeneration: 1, controlRevision: 3 } }));
    assert.equal(stopped.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "stop");

    const missing = await harness.kernel.executeWorkerPool(workerCommand("stop-worker", { workerId: "worker-9", expectedVersion: 1 }));
    assert.equal(missing.state, "rejected");
    if (missing.state === "rejected") assert.equal(missing.code, "target-not-found");
  });

  it("delegates plan/spawn/refresh/reopen to the typed runtime seam after authority validation", async () => {
    const harness = createHarness();

    const planned = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 2 },
    ));
    assert.equal(planned.state, "applied");
    if (planned.state === "applied") {
      assert.deepEqual(planned.affectedTargets[0], { family: "worker-pool", workflowId: "kernel-reject" });
    }
    const pool = harness.database.authority.workerPools.get("kernel-reject");
    assert.equal(pool?.version, 1);
    assert.equal(pool?.desiredWorkers, 2);
    assert.equal(pool?.plannedBy, "local-operator");

    const workerId = harness.database.authority.workerSlots.list(rejectActiveDescriptor.id)[0].workerId;
    const spawned = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId },
    ));
    assert.equal(spawned.state, "applied");

    assert.equal(harness.database.authority.workerLeases.start({ workerId, workflow: rejectActiveDescriptor.id, browserSystems: [], processId: process.pid, requestedBy: "local-operator", now: NOW }).state, "started");
    const spawnLive = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId },
    ));
    assert.equal(spawnLive.state, "rejected");
    if (spawnLive.state === "rejected") assert.equal(spawnLive.code, "invalid-state");

    const lease = harness.database.authority.workerLeases.get(workerId);
    assert.ok(lease !== undefined);
    harness.database.authority.workerControls.observe({ workerId, leaseGeneration: lease.leaseGeneration, sessionId: UUID_4, system: "ucpath",
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint, signInFingerprint: HASH_A, browserMode: "headless", acceptDownloads: false,
      exclusive: false, health: "authenticated", observedAt: NOW, openedAt: NOW, profileRevision: 1 });
    const refreshed = await harness.kernel.executeWorkerPool(workerCommand(
      "refresh-browser",
      { workerId, controlBasis: { leaseGeneration: 1, controlRevision: 1 }, browserSessionId: UUID_4, expectedVersion: lease.version },
    ));
    assert.equal(refreshed.state, "applied");
    const unknownWorkflow = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-unknown", expectedVersion: 1 },
      { desiredWorkers: 1 },
    ));
    assert.equal(unknownWorkflow.state, "rejected");
    if (unknownWorkflow.state === "rejected") assert.equal(unknownWorkflow.code, "target-not-found");

    assert.deepEqual(harness.workerCalls, [
      "plan:plan-worker-count",
      "spawn:spawn-worker",
      "refresh:refresh-browser",
    ]);
  });

  it("plan/spawn CAS against the durable POOL version and refuse a stale one by name, before the runtime seam", async () => {
    const harness = createHarness();
    // No row yet: the basis is 0, and citing 1 is told so — with the current version.
    const unplanned = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { desiredWorkers: 1 },
    ));
    assert.equal(unplanned.state, "conflict");
    if (unplanned.state === "conflict") {
      assert.equal(unplanned.currentVersion, 0);
      assert.match(unplanned.message, /worker pool kernel-reject is at version 0 \(no worker count has been planned for it yet\), not 1/);
    }
    assert.equal(harness.database.authority.workerPools.get("kernel-reject"), undefined);
    assert.deepEqual(harness.workerCalls, [], "a refused CAS never reaches the runtime seam");

    const first = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 1 },
    ));
    assert.equal(first.state, "applied");
    const audit = harness.database.authority.commandAudits.findByCommand(first.commandId);
    assert.ok(audit !== undefined);
    assert.deepEqual(audit.versionChanges, [{ target: { family: "worker-pool", workflowId: "kernel-reject" }, before: 0, after: 1 }]);

    // The same basis again is stale now: the row is at 1.
    const stale = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 3 },
    ));
    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.currentVersion, 1);
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 1);

    const staleSpawn = await harness.kernel.executeWorkerPool(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { workerId: "worker-1" },
    ));
    assert.equal(staleSpawn.state, "conflict");
    if (staleSpawn.state === "conflict") assert.equal(staleSpawn.currentVersion, 1);
    assert.deepEqual(harness.workerCalls, ["plan:plan-worker-count"], "only the applied plan reached the seam");

    const next = await harness.kernel.executeWorkerPool(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { desiredWorkers: 3 },
    ));
    assert.equal(next.state, "applied");
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.version, 2);
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 3);
  });
});
