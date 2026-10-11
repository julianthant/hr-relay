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
seedInitialSettingsRuntimeConfig,
singleAppliedRunId
} from "../../../support/fixtures/operator-command-fixtures.js";
import {
HASH_A,
HASH_B,
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

describe("run arms", () => {
  function startOne(harness: Harness, descriptor: AnyWorkflowDescriptor, eid: string): string {
    const plan = createPlan(harness, descriptor, [eid]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    return singleAppliedRunId(result);
  }

  it("retries a terminal run into a fresh linked run and refuses an active item", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");

    const active = harness.kernel.execute(runCommand("retry", runId, 1));
    assert.equal(active.state, "rejected");
    if (active.state === "rejected") assert.equal(active.code, "invalid-state");

    const run = harness.database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    const cancelResult = harness.kernel.execute(runCommand("cancel", runId, run.version));
    assert.equal(cancelResult.state, "applied");

    const retry = harness.kernel.execute(runCommand("retry", runId, 2));
    assert.equal(retry.state, "applied");
    if (retry.state !== "applied") return;
    const newTarget = retry.affectedTargets[0];
    assert.equal(newTarget.family, "run");
    if (newTarget.family !== "run") return;
    const retried = harness.database.authority.runs.get(newTarget.runId);
    assert.ok(retried !== undefined);
    assert.equal(retried.envelope.retryOf, runId);

    assert.equal(retried.envelope.attempt, 2);
    assert.equal(retried.lifecycle.state, "queued");
    assert.deepEqual(retried.input, harness.database.authority.runs.get(runId)?.input);

    assert.ok(run.sessionId !== undefined);
    assert.equal(retried.sessionId, run.sessionId);
    assert.deepEqual(
      harness.database.authority.runs.listBySession(run.sessionId).map((member) => member.envelope.runId).sort(),
      [runId, newTarget.runId].sort(),
    );
  });

  it("cancel is CAS-scoped and cascades through authority dependency edges only", () => {
    const harness = createHarness();
    const parentId = startOne(harness, rejectActiveDescriptor, "10800000");
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);

    const cascadeChildId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const independentChildId = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
    const childRecord = (childRunId: string, edgeId: string, suffix: string) => ({
      envelope: {
        runId: childRunId,
        workflow: "kernel-reject",
        itemId: deriveItemId("kernel-reject", `child:${suffix}`),
        traceId: `kr-170000-${suffix}`,
        descriptorVersion: 1,
        contractFingerprint: parent.envelope.contractFingerprint,
        resolvedInstance: { ucpath: "prod" },
        configFingerprint: parent.envelope.configFingerprint,
        configSnapshotId: parent.envelope.configSnapshotId,
        parent: { runId: parentId, tracePrefix: parent.envelope.traceId, edgeId },
        shape: "operation-member",
        priority: "bulk",
        dryRun: false,
        attempt: 1,
        enqueuedAt: NOW,
      },
      input: parent.input,
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    assert.equal(harness.database.authority.runs.enqueue(childRecord(cascadeChildId, "cascade-edge", "aaaa")).state, "inserted");
    assert.equal(harness.database.authority.runs.enqueue(childRecord(independentChildId, "independent-edge", "bbbb")).state, "inserted");

    const manifest = (manifestId: string, edgeId: string, childRunId: string, childItemId: string, cascadeCancel: string) => ({
      manifestId,
      parentRunId: parentId,
      edgeId,
      inputSchemaHash: HASH_A,
      resultSchemaHash: HASH_B,
      cardinality: "one",
      join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel, afterChildRetry: "resume-parent", visibility: "inline" },
      children: [{ dependencyId: `${manifestId.slice(0, 8)}-3333-4333-8333-333333333333`, childRunId, childItemId, canonicalInputFingerprint: HASH_A }],
      createdAt: NOW,
      manifestFingerprint: HASH_A,
    });
    const dependency = (dependencyId: string, manifestId: string, edgeId: string, childRunId: string, childItemId: string, cascadeCancel: string) => ({
      dependencyId,
      manifestId,
      edgeId,
      parentRunId: parentId,
      childRunId,
      childItemId,
      policy: { onChildFailed: "fail-parent", cascadeCancel, afterChildRetry: "resume-parent", visibility: "inline" },
      state: "active",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const cascadeItem = deriveItemId("kernel-reject", "child:aaaa");
    const independentItem = deriveItemId("kernel-reject", "child:bbbb");
    harness.database.authority.delegationManifests.insert(manifest("dddddddd-1111-4111-8111-dddddddddddd", "cascade-edge", cascadeChildId, cascadeItem, "cascade"));
    harness.database.authority.delegationManifests.insert(manifest("dddddddd-2222-4222-8222-dddddddddddd", "independent-edge", independentChildId, independentItem, "independent"));
    harness.database.authority.dependencies.insert(dependency("dddddddd-3333-4333-8333-dddddddddddd", "dddddddd-1111-4111-8111-dddddddddddd", "cascade-edge", cascadeChildId, cascadeItem, "cascade"));
    harness.database.authority.dependencies.insert(dependency("dddddddd-4444-4444-8444-dddddddddddd", "dddddddd-2222-4222-8222-dddddddddddd", "independent-edge", independentChildId, independentItem, "independent"));

    const stale = harness.kernel.execute(runCommand("cancel", parentId, parent.version + 7));
    assert.equal(stale.state, "conflict");

    const result = harness.kernel.execute(runCommand("cancel", parentId, parent.version));
    assert.equal(result.state, "applied", JSON.stringify(result));
    const cancelledParent = harness.database.authority.runs.get(parentId);
    assert.equal(cancelledParent?.lifecycle.state, "terminal");
    const cascaded = harness.database.authority.runs.get(cascadeChildId);
    assert.equal(cascaded?.lifecycle.state, "terminal");
    if (cascaded?.lifecycle.state === "terminal") assert.equal(cascaded.lifecycle.outcome, "cancelled");
    const independent = harness.database.authority.runs.get(independentChildId);
    assert.equal(independent?.lifecycle.state, "queued");
  });

  it("cancels nothing when a child has no dependency edge in authority", () => {
    const harness = createHarness();
    const parentId = startOne(harness, rejectActiveDescriptor, "10800000");
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);
    const orphanId = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
    assert.equal(harness.database.authority.runs.enqueue({
      envelope: {
        runId: orphanId,
        workflow: "kernel-reject",
        itemId: deriveItemId("kernel-reject", "child:orphan"),
        traceId: "kr-170000-9999",
        descriptorVersion: 1,
        contractFingerprint: parent.envelope.contractFingerprint,
        resolvedInstance: { ucpath: "prod" },
        configFingerprint: parent.envelope.configFingerprint,
        configSnapshotId: parent.envelope.configSnapshotId,
        parent: { runId: parentId, tracePrefix: parent.envelope.traceId, edgeId: "orphan-edge" },
        shape: "operation-member",
        priority: "bulk",
        dryRun: false,
        attempt: 1,
        enqueuedAt: NOW,
      },
      input: parent.input,
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }).state, "inserted");

    assert.throws(
      () => harness.kernel.execute(runCommand("cancel", parentId, parent.version)),
      /no dependency edge in authority/,
    );
    assert.equal(harness.database.authority.runs.get(parentId)?.lifecycle.state, "queued");
    assert.equal(harness.database.authority.runs.get(orphanId)?.lifecycle.state, "queued");
  });


  it("bump elevates a queued run to interactive at the live version, and refuses a stale one", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = () => harness.database.authority.runs.get(runId)?.version ?? 0;

    const stale = harness.kernel.execute(runCommand("bump", runId, version() + 998));
    assert.equal(stale.state, "conflict", "a stale bump may not reorder the claim queue");
    if (stale.state === "conflict") {
      assert.equal(stale.currentVersion, version());
      assert.match(stale.message, /refresh before bumping it/);
    }
    // The refusal wrote nothing: the run is still at its authored priority.
    assert.equal(harness.database.authority.runs.get(runId)?.envelope.priority, "bulk");

    const bumped = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(bumped.state, "applied");
    assert.equal(harness.database.authority.runs.get(runId)?.envelope.priority, "interactive");

    // Re-bumping an already-interactive run is the no-op arm: it advances no
    // version, so the SAME expected version is still live and still accepted.
    const again = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(again.state, "applied");

    const claimed = harness.database.authority.runs.claimNext({ workflow: "kernel-reject", workerId: "worker-1", now: NOW });
    assert.equal(claimed.state, "claimed");
    const busy = harness.kernel.execute(runCommand("bump", runId, version()));
    assert.equal(busy.state, "rejected");
    if (busy.state === "rejected") assert.equal(busy.code, "invalid-state");
  });

  it("rename is presentation-only and changes no lifecycle", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = () => {
      const run = harness.database.authority.runs.get(runId);
      assert.notEqual(run, undefined);
      return run?.version ?? 0;
    };

    const renamed = harness.kernel.execute(
      runCommand("rename", runId, version(), { payload: { displayName: "Kernel case" } }),
    );
    assert.equal(renamed.state, "applied");
    const run = harness.database.authority.runs.get(runId);
    assert.equal(run?.displayName, "Kernel case");

    assert.equal(run?.lifecycle.state, "queued");
  });


  it("refuses a stale rename with the live version", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800001");
    const live = harness.database.authority.runs.get(runId)?.version ?? 0;
    assert.ok(live > 0);
    const stale = live + 998;

    const result = harness.kernel.execute(
      runCommand("rename", runId, stale, { payload: { displayName: "Yesterday's name" } }),
    );
    assert.equal(result.state, "conflict", "a stale rename applied over a current name");
    if (result.state === "conflict") {
      // The server's own sentence names the version that IS live, because it
      // is the only party that knows it.
      assert.equal(result.currentVersion, live);
      assert.match(result.message, new RegExp(`not ${String(stale)}`));
    }


    const run = harness.database.authority.runs.get(runId);
    assert.equal(run?.version, live);
    assert.equal(run?.displayName, undefined);
  });
});
