import { RunRecordService,lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
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


describe("delete — a terminal run leaves authority behind one tombstone", () => {
  function startOne(harness: Harness, descriptor: AnyWorkflowDescriptor, eid: string): string {
    const plan = createPlan(harness, descriptor, [eid]);
    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    return singleAppliedRunId(result);
  }

  function settle(harness: Harness, runId: string): number {
    const run = harness.database.authority.runs.get(runId);
    assert.ok(run !== undefined);
    const settled = harness.database.authority.runs.transition({
      runId,
      expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
      now: NOW,
    });
    assert.equal(settled.state, "applied");
    return run.version + 1;
  }

  it("refuses a run that is not terminal, and leaves it exactly as it was", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const before = harness.database.authority.runs.get(runId);
    assert.ok(before !== undefined);

    const result = harness.kernel.execute(runCommand("delete", runId, before.version));
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, "invalid-state");
      assert.match(result.message, /only a terminal run can be deleted/u);
    }
    assert.deepEqual(harness.database.authority.runs.get(runId), before);
    assert.equal(harness.database.authority.deletedRuns.get(runId), undefined);
  });

  it("CASes the caller's version before it reads anything else", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = settle(harness, runId);

    const stale = harness.kernel.execute(runCommand("delete", runId, version - 1));
    assert.equal(stale.state, "conflict");
    assert.ok(harness.database.authority.runs.get(runId) !== undefined);
  });

  it("deletes a cancelled run entirely, keeps the journal, and refuses a second delete by name", () => {
    const harness = createHarness();
    const runId = startOne(harness, rejectActiveDescriptor, "10800000");
    const version = settle(harness, runId);
    const generationBefore = harness.database.getMeta().authorityGeneration;

    const command = runCommand("delete", runId, version);
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "applied");
    if (result.state === "applied") {
      assert.deepEqual(result.affectedTargets, [{ family: "run", runId }]);
    }

    assert.equal(harness.database.authority.runs.get(runId), undefined, "the tasks row is gone");
    assert.equal(harness.database.authority.runs.findByTrace("kr-170000-0001"), undefined);
    const tombstone = harness.database.authority.deletedRuns.get(runId);
    assert.ok(tombstone !== undefined, "exactly one tombstone remains");
    assert.equal(tombstone.origin, "queue");
    assert.equal(tombstone.commandId, lifecycleCommandId("operator-delete", command.commandId));
    assert.equal(tombstone.workflow, "kernel-reject");
    assert.deepEqual(tombstone.removed.filter(({ table }) => table === "runs"), [{ table: "runs", rows: 1 }]);
    assert.ok(harness.database.authority.commands.get(command.commandId) !== undefined, "the delete is journaled");
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore + 1);

    const again = harness.kernel.execute(runCommand("delete", runId, version));
    assert.equal(again.state, "rejected");
    if (again.state === "rejected") assert.equal(again.code, "target-deleted");
  });



  it("deletes a tree leaves-first, and refuses the tree while any member is not terminal", () => {
    const harness = createHarness();
    const parentId = startOne(harness, rejectActiveDescriptor, "10800000");
    const parent = harness.database.authority.runs.get(parentId);
    assert.ok(parent !== undefined);
    const childId = "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa";
    const manifestId = "bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb";
    const dependencyId = "cccccccc-4444-4444-8444-cccccccccccc";
    assert.equal(harness.database.authority.runs.enqueue({
      envelope: {
        runId: childId,
        workflow: "kernel-reject",
        itemId: deriveItemId("kernel-reject", "child:delete"),
        traceId: "kr-170000-4444",
        descriptorVersion: 1,
        contractFingerprint: parent.envelope.contractFingerprint,
        resolvedInstance: { ucpath: "prod" },
        configFingerprint: parent.envelope.configFingerprint,
        configSnapshotId: parent.envelope.configSnapshotId,
        parent: { runId: parentId, tracePrefix: parent.envelope.traceId, edgeId: "delete-edge" },
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
    harness.database.authority.delegationManifests.insert({
      manifestId,
      parentRunId: parentId,
      edgeId: "delete-edge",
      inputSchemaHash: HASH_A,
      resultSchemaHash: HASH_B,
      cardinality: "one",
      join: "one",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      children: [{ dependencyId, childRunId: childId, childItemId: deriveItemId("kernel-reject", "child:delete"), canonicalInputFingerprint: HASH_A }],
      createdAt: NOW,
      manifestFingerprint: HASH_A,
    });
    harness.database.authority.dependencies.insert({
      dependencyId,
      manifestId,
      edgeId: "delete-edge",
      parentRunId: parentId,
      childRunId: childId,
      childItemId: deriveItemId("kernel-reject", "child:delete"),
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      state: "active",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // The parent settles on its own; the child is still queued.
    const parentVersion = settle(harness, parentId);
    const refused = harness.kernel.execute(runCommand("delete", parentId, parentVersion));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") {
      assert.equal(refused.code, "invalid-state");
      assert.match(refused.message, /delegated child .* is queued/u);
    }
    assert.ok(harness.database.authority.runs.get(parentId) !== undefined, "nothing was deleted");
    assert.ok(harness.database.authority.runs.get(childId) !== undefined);

    const childVersion = settle(harness, childId);
    const memberDoor = harness.kernel.execute(runCommand("delete", childId, childVersion));
    assert.equal(memberDoor.state, "rejected");
    if (memberDoor.state === "rejected") {
      assert.equal(memberDoor.code, "invalid-state");
      assert.match(memberDoor.message, /delegated member of run .*; delete the group/u);
    }
    assert.ok(harness.database.authority.runs.get(childId) !== undefined, "a member is not deleted alone");

    const deleted = harness.kernel.execute(runCommand("delete", parentId, parentVersion));
    assert.equal(deleted.state, "applied");
    if (deleted.state === "applied") {
      assert.deepEqual(
        deleted.affectedTargets.map((target) => ("runId" in target ? target.runId : undefined)),
        [childId, parentId],
        "leaves first, then the target",
      );
    }
    assert.equal(harness.database.authority.runs.get(childId), undefined);
    assert.equal(harness.database.authority.runs.get(parentId), undefined);
    assert.deepEqual(harness.database.authority.dependencies.listByParentRun(parentId), []);
    assert.ok(harness.database.authority.deletedRuns.get(childId) !== undefined);
    assert.ok(harness.database.authority.deletedRuns.get(parentId) !== undefined);
  });
});
