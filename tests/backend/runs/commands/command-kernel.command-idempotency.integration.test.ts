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
import { EidSchema,FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt,fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import {
seedInitialSettingsRuntimeConfig
} from "../../../support/fixtures/operator-command-fixtures.js";
import {
NOW,
UUID_4
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase,createCredentialStore,type AuthorityRepositories } from "../../../support/helpers/synthetic-storage-admission.js";

import { createExplorerEditService } from "../../../../src/backend/runs/commands/explorer-edit-service.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";

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

function explorerCommand(
  descriptor: AnyWorkflowDescriptor,
  commandId: string,
  expectedOverrideRevision: number,
  label: string,
) {
  return {
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    reason: `Apply reviewed label ${label}`,
    family: "explorer",
    type: "apply-explorer-edit",
    target: {
      workflowId: descriptor.id,
      expectedVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      expectedOverrideRevision,
    },
    payload: { changes: [{ kind: "workflow-label", value: label }] },
  } as const;
}

function realExplorerEdits() {
  const query = explorerQueryDeps(
    manualClock(new Date(NOW)),
    FingerprintSchema.parse("b".repeat(64)),
  );
  const descriptor = query.modules.find(
    ({ descriptor: candidate }) => String(candidate.id) === "person-lookup",
  )?.descriptor;
  assert.ok(descriptor !== undefined);
  return {
    descriptor,
    service: createExplorerEditService({
      explorer: query,
      overrides: { read: () => undefined, readAll: () => [] },
    }),
  };
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

describe("command idempotency", () => {
  it("journals Explorer apply with actor/source audit and executes one write across byte-exact replay", () => {
    const harness = createHarness();
    const command = {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: fixtureDescriptor.id,
        expectedVersion: fixtureDescriptor.version,
        contractFingerprint: fixtureDescriptor.contractFingerprint,
        expectedOverrideRevision: 0,
      },
      payload: {
        changes: [{ kind: "workflow-label", value: "Reviewed fixture label" }],
      },
    };

    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    if (first.state !== "applied") return;
    assert.deepEqual(first.affectedTargets, [{ family: "explorer", workflowId: fixtureDescriptor.id, revision: 1 }]);
    assert.equal(harness.explorerCalls.length, 1);
    assert.equal(harness.database.authority.explorerOverrides.read(fixtureDescriptor.id)?.revision, 1);

    const audit = harness.database.authority.commandAudits.findByCommand(first.commandId);
    assert.ok(audit !== undefined);
    assert.equal(audit.request.requestedBy, "local-operator");
    assert.equal(audit.request.source, "dashboard");
    assert.deepEqual(audit.versionChanges, [{
      target: { family: "explorer", workflowId: fixtureDescriptor.id, revision: 1 },
      before: 0,
      after: 1,
    }]);

    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    assert.equal(harness.explorerCalls.length, 1);
  });

  it("rolls back an Explorer edit with its audit, then accepts a valid intervening command", () => {
    const explorer = realExplorerEdits();
    let failAudit = true;
    const harness = createHarness((repositories) => ({
      ...repositories,
      commandAudits: { ...repositories.commandAudits, insert: (input: unknown) => {
        if (failAudit) { failAudit = false; throw new Error("injected Explorer audit failure"); }
        return repositories.commandAudits.insert(input);
      } },
    }), { explorerEdits: explorer.service });
    const original = explorerCommand(explorer.descriptor, "11111111-2222-4333-8444-555555555555", 0, "People search");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(original), /injected Explorer audit failure/u);
    assert.equal(harness.database.authority.commands.get(original.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(original.commandId), undefined);
    assert.deepEqual(harness.database.authority.explorerOverrides.readAll(), []);
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
    const stale = explorerCommand(explorer.descriptor, "66666666-7777-4888-8999-000000000000", 1, "Directory search");
    assert.equal(harness.kernel.execute(stale).state, "conflict");
    const valid = { ...stale, target: { ...stale.target, expectedOverrideRevision: 0 } };
    assert.equal(harness.kernel.execute(valid).state, "applied");
    assert.equal(harness.kernel.execute(original).state, "conflict");
    assert.equal(harness.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "Directory search");
  });

  it("recovers an ambiguous authority commit from the journal without a file finalizer", () => {
    const explorer = realExplorerEdits();
    let throwAfterCommit = true;
    const harness = createHarness(undefined, { explorerEdits: explorer.service, afterAuthorityCommit: () => {
      if (throwAfterCommit) { throwAfterCommit = false; throw new Error("injected ambiguous authority commit return"); }
    } });
    const original = explorerCommand(explorer.descriptor, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", 0, "People search");
    assert.throws(() => harness.kernel.execute(original), /injected ambiguous authority commit return/u);
    assert.equal(harness.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "People search");
    assert.ok(harness.database.authority.commandAudits.findByCommand(original.commandId));
    assert.throws(() => harness.kernel.execute({ ...original, reason: "Different envelope" }), /reused|identity/u);
    assert.equal(harness.kernel.execute(structuredClone(original)).state, "already-applied");
    const next = explorerCommand(explorer.descriptor, "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb", 1, "Directory search");
    assert.equal(harness.kernel.execute(next).state, "applied");
    assert.equal(harness.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "Directory search");
  });

  it("returns already-applied for a byte-exact replay after revalidating the plan bindings", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    if (first.state !== "applied") return;

    const generationBefore = harness.database.getMeta().authorityGeneration;
    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    if (replayed.state !== "already-applied") return;
    assert.deepEqual(replayed.affectedTargets, first.affectedTargets);
    // Replay reads; it never re-executes.
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
    const runs = harness.database.authority.runs.listByItem({
      workflow: plan.workflowId,
      itemId: plan.planned[0].itemId,
    });
    assert.equal(runs.length, 1);
  });

  it("rejects a same-id different-content replay loudly", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    assert.equal(harness.kernel.execute(command).state, "applied");
    const conflicting = { ...command, reason: "a different body wearing the same id" };
    assert.throws(() => harness.kernel.execute(conflicting), /reused with different content/);
  });

  it("refuses a spent plan presented by a different command", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    assert.equal(harness.kernel.execute(startCommand(plan)).state, "applied");
    const second = harness.kernel.execute(startCommand(plan, nextCommandId()));
    assert.equal(second.state, "rejected");
    if (second.state === "rejected") {
      assert.equal(second.code, "invalid-state");
      assert.match(second.message, /already consumed/);
    }
  });
});
