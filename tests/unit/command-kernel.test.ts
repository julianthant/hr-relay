import { archivedRunReferenceFingerprint } from "../../src/domain/archive/model.js";
import { RETIRED_EDIT_CHECKPOINT_COMMAND } from "./fixtures/phase1c-contract-fixtures.js";
import { RunRecordService, lifecycleCommandId } from "../../src/core/run-record-service.js";
/**
 * D113 command-kernel semantics (ref dashboard-surfaces §Phase-1f authority, §2.4).
 *
 * The suite drives the REAL authority database through the kernel: the D109
 * consume step commits plan consumption, active-run policy, run creation, and
 * the command journal/audit in one transaction; a crash or refusal anywhere
 * rolls back everything; replays are byte-exact; and every deferred arm is a
 * pure typed rejection that provably changes no authority row.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import {
  createCommandKernel,
  deriveGateResultCheckpointFingerprint,
  PHASE1_ACTIVE_COMMAND_ARMS,
  PHASE1_DEFERRED_COMMAND_ARMS,
  type CommandKernel,
  type SettingsApplicationExecutor,
  type ExplorerEditExecutor,
  type WorkerRuntimeExecutor,
  type WriteResolutionExecutor,
} from "../../src/core/command-kernel.js";
import {
  CommandRequestSchema,
  COMMAND_FAMILY_REGISTRY,
  ProtectedSettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
  type CommandRequest,
} from "../../src/domain/commands.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsApplyRejectionCodeSchema,
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
} from "../../src/domain/config/protected-settings.js";
import { ExplorerEditApplyResultSchema, ExplorerOverrideDocumentSchema } from "../../src/domain/dashboard/explorer.js";
import { deriveItemId } from "../../src/domain/identifiers.js";
import { EidSchema, FingerprintSchema } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../src/infra/sqlite/index.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { planStart } from "../../src/services/start/plan.js";
import { createSettingsApplicationExecutor } from "../../src/server/dashboard/commands/settings-service.js";
import { readSettings } from "../../src/server/settings-runtime.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import {
  COMMAND_FIXTURES,
  HASH_A,
  HASH_B,
  NOW,
  UUID_4,
  UUID_7,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "./fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  appliedRunIds,
  seedSyntheticRuntimeConfig,
  singleAppliedRunId,
} from "./fixtures/operator-command-fixtures.js";
import { fixtureDescriptor } from "./architecture/helpers/descriptor-fixtures.js";
import { FixtureReadReceipt } from "./architecture/helpers/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";
import {
  ARCHIVED_RUN,
  UNWIRED_ARCHIVE_SNAPSHOTS,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "./fixtures/archive-fixtures.js";
import { createExplorerEditService } from "../../src/server/dashboard/commands/explorer-edit-service.js";
import { createExplorerOverrideStore } from "../../src/server/dashboard/commands/explorer-override-store.js";
import { explorerQueryDeps } from "../fixtures/explorer-seams.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

function databasePath(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-command-kernel-"));
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
const DESCRIPTOR_SET: readonly AnyWorkflowDescriptor[] = [
  rejectActiveDescriptor,
  supersedeDescriptor,
  parallelDescriptor,
  fixtureDescriptor,
];


/* ── harness ─────────────────────────────────────────────────────────────── */

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;
type AuthorityTransactionWrap = <Result>(
  database: AuthorityDatabase,
  work: (repositories: AuthorityRepositories) => Result,
) => Result;

interface HarnessOptions {
  readonly explorerEdits?: ExplorerEditExecutor;
  readonly afterAuthorityCommit?: () => void;
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

function acceptingWorkerRuntime(calls: string[]): WorkerRuntimeExecutor {
  return {
    planWorkerCount: (context) => {
      calls.push(`plan:${context.command.type}`);
      return { state: "accepted", workerIds: ["worker-1", "worker-2"] };
    },
    spawnWorker: (context) => {
      calls.push(`spawn:${context.command.type}`);
      return { state: "accepted" };
    },
    refreshBrowser: (context) => {
      calls.push(`refresh:${context.command.type}`);
      return { state: "accepted" };
    },
    reopenBrowser: (context) => {
      calls.push(`reopen:${context.command.type}`);
      return { state: "accepted" };
    },
  };
}

/** Resolves the park by re-queueing the run — the durable half a real sequencer owns. */
function requeueingWriteResolution(calls: string[]): WriteResolutionExecutor {
  const resolve = (repositories: AuthorityRepositories, context: {
    readonly command: { type: string };
    readonly run: { envelope: { runId: string }; version: number };
    readonly now: string;
  }) => {
    calls.push(`${context.command.type}:${context.run.envelope.runId}`);
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

function createHarness(
  wrap?: RepositoryWrap,
  settingsInputOrOptions?: SettingsApplicationExecutor | HarnessOptions,
  transactionWrap?: AuthorityTransactionWrap,
): Harness {
  const options = settingsInputOrOptions !== undefined && !("apply" in settingsInputOrOptions)
    ? settingsInputOrOptions : {};
  const settingsOverride = settingsInputOrOptions !== undefined && "apply" in settingsInputOrOptions
    ? settingsInputOrOptions : undefined;
  const clock = manualClock(new Date(NOW));
  const path = databasePath("kernel.sqlite");
  const stateRoot = dirname(path);
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "kernel-test" },
    clock,
  );
  openDatabases.push(database);
  seedSyntheticRuntimeConfig(database);
  if (wrap !== undefined) {
    const transaction = database.withAuthorityTransaction.bind(database);
    database.withAuthorityTransaction = (work) => transaction((repositories) => work(wrap(repositories)));
  }

  const workerCalls: string[] = [];
  const writeCalls: string[] = [];
  const credentials = createCredentialStore({ stateRoot });
  const explorerCalls: unknown[] = [];
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
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
      resolve: (workflowId) => DESCRIPTOR_SET.find((descriptor) => String(descriptor.id) === workflowId),
    },
    explorerEdits: options.explorerEdits ?? {
      reconcilePending: () => undefined,
      apply: (input) => {
        explorerCalls.push(input);
        const override = {
          overrideVersion: 1 as const,
          workflowId: input.target.workflowId,
          descriptorVersion: input.target.expectedVersion,
          contractFingerprint: input.target.contractFingerprint,
          revision: input.target.expectedOverrideRevision + 1,
          appliedCommandId: input.commandId,
          commandFingerprint: "a".repeat(64),
          presentation: { label: "Reviewed fixture label" },
        };
        return {
          result: ExplorerEditApplyResultSchema.parse({ state: "applied", override, readback: override }),
        };
      },
    },
    writeResolution: requeueingWriteResolution(writeCalls),
    workerRuntime: acceptingWorkerRuntime(workerCalls),
    settings: settingsOverride ?? createSettingsApplicationExecutor(() => undefined, credentials),
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

function realExplorerEdits(path: string) {
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
      overrides: createExplorerOverrideStore(path),
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
      configFingerprint: HASH_B,
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

function applySettingsRequiringRestart(harness: Harness): void {
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

function protectedSettingsCommand(input: Readonly<{
  commandId?: string;
  expectedRevision?: number;
  protectedSchemaHash?: string;
  value: string;
  writeId?: string;
}>) {
  return ProtectedSettingsCommandRequestSchema.parse({
    commandId: input.commandId ?? nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: input.expectedRevision ?? 1 },
    payload: {
      protectedSchemaHash: input.protectedSchemaHash ?? PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: input.writeId ?? UUID_7,
      entries: { ucpathPassword: { set: input.value } },
    },
  });
}

function commandFixture(family: CommandRequest["family"], type: string): CommandRequest {
  const fixture = COMMAND_FIXTURES.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const record = candidate as Readonly<Record<string, unknown>>;
    return record.family === family && record.type === type;
  });
  assert.ok(fixture !== undefined, `${family}/${type} fixture exists`);
  return CommandRequestSchema.parse(fixture);
}

describe("settings restart fence", () => {
  it("refuses intake run fan-out after settings make this runtime stale", () => {
    const harness = createHarness();
    applySettingsRequiringRestart(harness);
    const fixture = commandFixture("intake", "enqueue-intake-manifest");
    const command = CommandRequestSchema.parse({ ...fixture, commandId: nextCommandId() });

    assert.throws(
      () => harness.kernel.execute(command),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("refuses retry run fan-out after settings make this runtime stale", () => {
    const harness = createHarness();
    applySettingsRequiringRestart(harness);
    const fixture = commandFixture("run", "retry");
    const command = CommandRequestSchema.parse({ ...fixture, commandId: nextCommandId() });

    assert.throws(
      () => harness.kernel.execute(command),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("refuses archive relaunch fan-out after settings make this runtime stale", () => {
    const harness = createHarness();
    applySettingsRequiringRestart(harness);
    const fixture = commandFixture("version-archive", "relaunch-archived-run");
    const command = CommandRequestSchema.parse({ ...fixture, commandId: nextCommandId() });

    assert.throws(
      () => harness.kernel.execute(command),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });
});

describe("D113 start arm — atomic D109 plan consumption", () => {
  it("refuses a pre-apply start plan after settings make this runtime stale", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    applySettingsRequiringRestart(harness);

    assert.throws(
      () => harness.kernel.execute(startCommand(plan)),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
  });

  it("consumes the plan and enqueues every accepted run in one applied command", () => {
    const harness = createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000", "10800001"]);
    assert.equal(plan.planned.length, 2);

    const result = harness.kernel.execute(startCommand(plan));
    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.equal(result.affectedTargets.length, 3);
    const runIds = appliedRunIds(result);
    assert.equal(runIds.length, plan.planned.length);

    const consumed = harness.database.authority.startPlans.get(plan.startPlanId);
    assert.ok(consumed?.consumedBy !== undefined);
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

  it("D269: the fan-out is ONE durable session, written before its first member, and membership is the run rows", () => {
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

    // The same commandId may retry after the crash — nothing was burned.
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
    // D269: the session row minted for this fan-out went with it — it lives
    // inside the same transaction as its members.
    assert.equal(harness.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);
    // The FIRST planned run was enqueued before the second refused — all of it
    // must have rolled back with the consumption.
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

describe("D113 command idempotency", () => {
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

  it("keeps an applied file claimed across audit rollback, blocks an intervening command, and completes exact replay", () => {
    const overridePath = databasePath("explorer-overrides.json");
    const explorer = realExplorerEdits(overridePath);
    let failAudit = true;
    const harness = createHarness((repositories) => ({
      ...repositories,
      commandAudits: {
        ...repositories.commandAudits,
        insert: (input: unknown) => {
          if (failAudit) {
            failAudit = false;
            throw new Error("injected post-file audit failure");
          }
          return repositories.commandAudits.insert(input);
        },
      },
    }), { explorerEdits: explorer.service });
    const original = explorerCommand(
      explorer.descriptor,
      "11111111-2222-4333-8444-555555555555",
      0,
      "People search",
    );

    assert.throws(() => harness.kernel.execute(original), /injected post-file audit failure/u);
    assert.equal(existsSync(`${overridePath}.claim`), true);
    assert.equal(harness.database.authority.commands.get(original.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(original.commandId), undefined);

    const intervening = explorerCommand(
      explorer.descriptor,
      "66666666-7777-4888-8999-000000000000",
      1,
      "Directory search",
    );
    assert.throws(
      () => harness.kernel.execute(intervening),
      /has uncommitted command 11111111-2222-4333-8444-555555555555/u,
    );
    assert.equal(harness.database.authority.commands.get(intervening.commandId), undefined);

    const replayed = harness.kernel.execute(structuredClone(original));
    assert.equal(replayed.state, "applied");
    assert.equal(existsSync(`${overridePath}.claim`), false);
    const audit = harness.database.authority.commandAudits.findByCommand(original.commandId);
    assert.ok(audit !== undefined);
    assert.deepEqual(audit.request, original);
    const document = ExplorerOverrideDocumentSchema.parse(JSON.parse(readFileSync(overridePath, "utf8")));
    assert.equal(document.workflows[0]?.presentation.label, "People search");
  });

  it("recovers an ambiguous authority commit from the journal after a service restart", () => {
    const overridePath = databasePath("explorer-overrides.json");
    const explorer = realExplorerEdits(overridePath);
    let throwAfterCommit = true;
    const harness = createHarness(undefined, {
      explorerEdits: explorer.service,
      afterAuthorityCommit: () => {
        if (!throwAfterCommit) return;
        throwAfterCommit = false;
        throw new Error("injected ambiguous authority commit return");
      },
    });
    const original = explorerCommand(
      explorer.descriptor,
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      0,
      "People search",
    );

    assert.throws(
      () => harness.kernel.execute(original),
      /injected ambiguous authority commit return/u,
    );
    assert.equal(existsSync(`${overridePath}.claim`), true);
    assert.ok(harness.database.authority.commandAudits.findByCommand(original.commandId) !== undefined);

    const restarted = realExplorerEdits(overridePath);
    const committedAudit = harness.database.authority.commandAudits.findByCommand(original.commandId);
    assert.ok(committedAudit !== undefined);
    assert.throws(
      () => restarted.service.reconcilePending(
        structuredClone(original),
        () => ({
          request: CommandRequestSchema.parse({ ...original, requestedBy: "different-operator" }),
          audit: committedAudit,
        }),
      ),
      /journal .* does not preserve the pending complete command envelope/u,
    );
    assert.equal(existsSync(`${overridePath}.claim`), true);
    restarted.service.reconcilePending(
      structuredClone(original),
      (commandId) => ({
        request: harness.database.authority.commands.get(commandId),
        audit: harness.database.authority.commandAudits.findByCommand(commandId),
      }),
    );
    assert.equal(existsSync(`${overridePath}.claim`), false);

    const replayed = harness.kernel.execute(structuredClone(original));
    assert.equal(replayed.state, "already-applied");
    const next = explorerCommand(
      explorer.descriptor,
      "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      1,
      "Directory search",
    );
    assert.equal(harness.kernel.execute(next).state, "applied");
    const document = ExplorerOverrideDocumentSchema.parse(JSON.parse(readFileSync(overridePath, "utf8")));
    assert.equal(document.workflows[0]?.presentation.label, "Directory search");
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

describe("D113 run arms", () => {
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
    // D221 — a retry is the ITEM's next attempt, never a second attempt 1.
    assert.equal(retried.envelope.attempt, 2);
    assert.equal(retried.lifecycle.state, "queued");
    assert.deepEqual(retried.input, harness.database.authority.runs.get(runId)?.input);
    // D269 — a retry INHERITS the retried run's session; it mints none.
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

  /*
   * D233's rule applied to bump. This case used to pass `999` to every call
   * with the comment "bump is NOT a CAS arm" — which was true of the code and
   * is the hole itself: `executeBump` re-read the run and handed its own
   * `current.version` to the store, a compare-and-swap that cannot fail. Every
   * run verb now CASes the CALLER's value, with no exceptions.
   */
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
    // The whole claim of "presentation-only": the run is exactly where it was
    // — same state, same claim, same everything else.
    assert.equal(run?.lifecycle.state, "queued");
  });

  /*
   * D233. This case previously asserted the OPPOSITE — it passed version `999`
   * and pinned `applied`, under the heading "never CAS-reject". The premise was
   * that presentation changes no outcome, so a stale one is harmless. Rename is
   * the counterexample: a name is a value the operator authored, and applying
   * yesterday's name over today's silently discards an edit and answers
   * "Recorded." D234 retired the two verbs that made the premise look true.
   */
  it("refuses a stale rename with the live version (D233)", () => {
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

    // Nothing was written.
    const run = harness.database.authority.runs.get(runId);
    assert.equal(run?.version, live);
    assert.equal(run?.displayName, undefined);
  });
});

describe("D113 write resolution", () => {
  function parkOnWrite(harness: Harness): { runId: string; version: number } {
    assert.equal(harness.database.authority.runs.enqueue(QUEUED_RUN).state, "inserted");
    const claimed = harness.database.authority.runs.claimNext({ workflow: "person-lookup", workerId: "worker-1", now: NOW });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("unreachable");
    const claim = { workerId: "worker-1", claimGeneration: claimed.run.claimGeneration };
    const lifecycleBase = { workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW };
    const validating = harness.database.authority.runs.transition({
      runId: RUN_ID, expectedVersion: claimed.run.version, claim,
      lifecycle: { state: "validating", ...lifecycleBase }, now: NOW,
    });
    assert.equal(validating.state, "applied");
    const running = harness.database.authority.runs.transition({
      runId: RUN_ID, expectedVersion: claimed.run.version + 1, claim,
      lifecycle: { state: "running", ...lifecycleBase }, now: NOW,
    });
    assert.equal(running.state, "applied");
    const parked = harness.database.authority.runs.transition({
      runId: RUN_ID, expectedVersion: claimed.run.version + 2, claim,
      lifecycle: {
        state: "parked-write",
        writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
        intentGeneration: 1,
        parkedAt: NOW,
        code: "unknown",
        message: "probe returned unknown",
      },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("unreachable");
    const fenced = harness.database.authority.writeIntents.fenceAttempt({
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    });
    assert.equal(fenced.state, "fenced");
    return { runId: RUN_ID, version: parked.run.version };
  }

  it("resolves a parked write through the typed executor seam inside the command transaction", () => {
    const harness = createHarness();
    const parked = parkOnWrite(harness);
    const result = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version,
        writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
        intentGeneration: 1,
      },
      payload: { evidenceNote: "Checked UCPath directly; the transaction is absent" },
    }));
    assert.equal(result.state, "applied");
    assert.deepEqual(harness.writeCalls, [`resolve-write-absent:${parked.runId}`]);
    assert.equal(harness.database.authority.runs.get(parked.runId)?.lifecycle.state, "queued");
  });

  it("CAS-conflicts on a stale version and rejects a stale intent generation", () => {
    const harness = createHarness();
    const parked = parkOnWrite(harness);
    const stale = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version + 3, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version + 3,
        writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
        intentGeneration: 1,
      },
      payload: { evidenceNote: "stale browser action" },
    }));
    assert.equal(stale.state, "conflict");

    const staleGeneration = harness.kernel.execute(runCommand("resolve-write-absent", parked.runId, parked.version, {
      target: {
        runId: parked.runId,
        expectedVersion: parked.version,
        writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
        intentGeneration: 4,
      },
      payload: { evidenceNote: "stale generation" },
    }));
    assert.equal(staleGeneration.state, "rejected");
    if (staleGeneration.state === "rejected") assert.equal(staleGeneration.code, "invalid-state");
    assert.deepEqual(harness.writeCalls, []);
    assert.equal(harness.database.authority.runs.get(parked.runId)?.lifecycle.state, "parked-write");
  });
});

describe("D113 gate resolution", () => {
  function stageGateRun(harness: Harness): { runId: string; version: number } {
    const plan = planStart(
      { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
      {
        descriptor: fixtureDescriptor,
        submissions: [{ eid: "10800000", mode: "write" }],
        dryRun: false,
        priority: "bulk",
        shape: "single",
        configFingerprint: HASH_B,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
    assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
    const started = harness.kernel.execute(startCommand(plan));
    assert.equal(started.state, "applied");
    const runId = singleAppliedRunId(started);
    const claimed = harness.database.authority.runs.claimNext({ workflow: "fixture-graph", workerId: "worker-1", now: NOW });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("unreachable");
    const claim = { workerId: "worker-1", claimGeneration: claimed.run.claimGeneration };
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
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "fan" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("unreachable");
    return { runId, version: parked.run.version };
  }

  function gateCommand(runId: string, expectedVersion: number, result: unknown) {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
      target: { runId, gateId: "approval", expectedVersion },
      payload: { result },
    };
  }

  it("parses the descriptor's exact gate schema, stores the result, and resumes at the parked node", () => {
    const harness = createHarness();
    const staged = stageGateRun(harness);
    const gateNode = descriptorRuntimeNodes(fixtureDescriptor)
      .find((node) => node.kind === "gate" && String(node.id) === "approval");
    assert.ok(gateNode !== undefined && gateNode.kind === "gate");
    const schemaHash = deriveSchemaHash(gateNode.result, "output");

    const wrongSchema = harness.kernel.execute(gateCommand(staged.runId, staged.version, {
      schemaHash: HASH_A,
      value: { approved: true },
    }));
    assert.equal(wrongSchema.state, "rejected");
    if (wrongSchema.state === "rejected") assert.equal(wrongSchema.code, "schema-mismatch");

    const wrongValue = harness.kernel.execute(gateCommand(staged.runId, staged.version, {
      schemaHash,
      value: { approved: "yes" },
    }));
    assert.equal(wrongValue.state, "rejected");
    if (wrongValue.state === "rejected") assert.equal(wrongValue.code, "schema-mismatch");
    assert.equal(harness.database.authority.gateResults.get(`${staged.runId}:approval`), undefined);
    assert.equal(harness.database.authority.runs.get(staged.runId)?.lifecycle.state, "parked-gate");

    const stale = harness.kernel.execute(gateCommand(staged.runId, staged.version + 2, {
      schemaHash,
      value: { approved: true },
    }));
    assert.equal(stale.state, "conflict");

    const resolved = harness.kernel.execute(gateCommand(staged.runId, staged.version, {
      schemaHash,
      value: { approved: true },
    }));
    assert.equal(resolved.state, "applied");
    const stored = harness.database.authority.gateResults.get(`${staged.runId}:approval`);
    assert.ok(stored !== undefined);
    assert.deepEqual(stored.result, { schemaHash, value: { approved: true } });
    assert.equal(stored.checkpointFingerprint, deriveGateResultCheckpointFingerprint(stored.result));
    const resumed = harness.database.authority.runs.get(staged.runId);
    assert.equal(resumed?.lifecycle.state, "queued");
    assert.equal(resumed?.envelope.startAt, "fan");
  });
});

describe("D113 worker-browser arms", () => {
  const WORKER_START = {
    workerId: "worker-1",
    workflow: "kernel-reject",
    browserSystems: [],
    processId: 4242,
    requestedBy: "local-operator",
    now: NOW,
  };

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

  it("refuses worker-pool starts after settings make this runtime stale", () => {
    const harness = createHarness();
    applySettingsRequiringRestart(harness);

    assert.throws(
      () => harness.kernel.execute(workerCommand(
        "plan-worker-count",
        { workflowId: "kernel-reject", expectedVersion: 0 },
        { desiredWorkers: 2 },
      )),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(harness.database.authority.workerPools.get("kernel-reject"), undefined);
    assert.deepEqual(harness.workerCalls, []);
  });

  it("writes durable lease directives for stop/pause/resume against current authority", () => {
    const harness = createHarness();
    const started = harness.database.authority.workerLeases.start(WORKER_START);
    assert.equal(started.state, "started");

    const paused = harness.kernel.execute(workerCommand("pause-worker", { workerId: "worker-1", expectedVersion: 999 }));
    assert.equal(paused.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get("worker-1")?.control.directive, "pause");

    const resumed = harness.kernel.execute(workerCommand("resume-worker", { workerId: "worker-1", expectedVersion: 999 }));
    assert.equal(resumed.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get("worker-1")?.control.directive, "run");

    const stopped = harness.kernel.execute(workerCommand("stop-worker", { workerId: "worker-1", expectedVersion: 999 }));
    assert.equal(stopped.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get("worker-1")?.control.directive, "stop");

    const missing = harness.kernel.execute(workerCommand("stop-worker", { workerId: "worker-9", expectedVersion: 1 }));
    assert.equal(missing.state, "rejected");
    if (missing.state === "rejected") assert.equal(missing.code, "target-not-found");
  });

  it("delegates plan/spawn/refresh/reopen to the typed runtime seam after authority validation", () => {
    const harness = createHarness();
    // D269: a workflow nobody has planned is at pool version 0 — the first
    // plan cites it and creates the row at version 1.
    const planned = harness.kernel.execute(workerCommand(
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

    const spawned = harness.kernel.execute(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId: "worker-1" },
    ));
    assert.equal(spawned.state, "applied");

    assert.equal(harness.database.authority.workerLeases.start(WORKER_START).state, "started");
    const spawnLive = harness.kernel.execute(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { workerId: "worker-1" },
    ));
    assert.equal(spawnLive.state, "rejected");
    if (spawnLive.state === "rejected") assert.equal(spawnLive.code, "invalid-state");

    const lease = harness.database.authority.workerLeases.get("worker-1");
    assert.ok(lease !== undefined);
    const refreshed = harness.kernel.execute(workerCommand(
      "refresh-browser",
      { workerId: "worker-1", browserSessionId: UUID_4, expectedVersion: lease.version },
    ));
    assert.equal(refreshed.state, "applied");
    const unknownWorkflow = harness.kernel.execute(workerCommand(
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

  it("D269: plan/spawn CAS against the durable POOL version and refuse a stale one by name, before the runtime seam", () => {
    const harness = createHarness();
    // No row yet: the basis is 0, and citing 1 is told so — with the current version.
    const unplanned = harness.kernel.execute(workerCommand(
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

    const first = harness.kernel.execute(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 1 },
    ));
    assert.equal(first.state, "applied");
    const audit = harness.database.authority.commandAudits.findByCommand(first.commandId);
    assert.ok(audit !== undefined);
    assert.deepEqual(audit.versionChanges, [{ target: { family: "worker-pool", workflowId: "kernel-reject" }, before: 0, after: 1 }]);

    // The same basis again is stale now: the row is at 1.
    const stale = harness.kernel.execute(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { desiredWorkers: 3 },
    ));
    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.currentVersion, 1);
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 1);

    const staleSpawn = harness.kernel.execute(workerCommand(
      "spawn-worker",
      { workflowId: "kernel-reject", expectedVersion: 0 },
      { workerId: "worker-1" },
    ));
    assert.equal(staleSpawn.state, "conflict");
    if (staleSpawn.state === "conflict") assert.equal(staleSpawn.currentVersion, 1);
    assert.deepEqual(harness.workerCalls, ["plan:plan-worker-count"], "only the applied plan reached the seam");

    const next = harness.kernel.execute(workerCommand(
      "plan-worker-count",
      { workflowId: "kernel-reject", expectedVersion: 1 },
      { desiredWorkers: 3 },
    ));
    assert.equal(next.state, "applied");
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.version, 2);
    assert.equal(harness.database.authority.workerPools.get("kernel-reject")?.desiredWorkers, 3);
  });
});

describe("D113 deferred arms", () => {
  const deferredKeys = new Set(
    Object.entries(
      PHASE1_DEFERRED_COMMAND_ARMS as Readonly<Record<string, readonly string[]>>,
    ).flatMap(([family, actions]) =>
      actions.map((action) => `${family}/${action}`)),
  );

  it("partitions every D95 family/action exactly once between active and deferred", () => {
    const partitioned = new Map<string, number>();
    for (const partition of [PHASE1_ACTIVE_COMMAND_ARMS, PHASE1_DEFERRED_COMMAND_ARMS]) {
      for (const [family, actions] of Object.entries(partition)) {
        for (const action of actions) {
          const key = `${family}/${action}`;
          partitioned.set(key, (partitioned.get(key) ?? 0) + 1);
        }
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned.keys()].sort(), [...registry].sort());
    for (const [key, count] of partitioned) assert.equal(count, 1, key);
  });

  it("returns typed capability-unavailable for EVERY deferred arm with zero authority side effects", () => {
    const harness = createHarness();
    const deferredFixtures = [...deferredKeys].map((key) => {
      const [family, type] = key.split("/");
      assert.ok(family !== undefined && type !== undefined);
      return commandFixture(family as CommandRequest["family"], type);
    });
    assert.equal(deferredFixtures.length, deferredKeys.size);

    for (const request of deferredFixtures) {
      const generationBefore = harness.database.getMeta().authorityGeneration;
      const result = harness.kernel.execute(request);
      assert.equal(result.state, "rejected", `${request.family}/${request.type}`);
      if (result.state !== "rejected") continue;
      assert.equal(result.code, "capability-unavailable", `${request.family}/${request.type}`);
      assert.match(result.message, /no authority state was changed/);
      assert.equal(
        harness.database.getMeta().authorityGeneration,
        generationBefore,
        `${request.family}/${request.type} advanced the authority generation`,
      );
      assert.equal(
        harness.database.authority.commands.get(request.commandId),
        undefined,
        `${request.family}/${request.type} was journaled`,
      );
      assert.equal(
        harness.database.authority.commandAudits.findByCommand(request.commandId),
        undefined,
        `${request.family}/${request.type} was audited`,
      );
    }
  });

  it("rejects the retired edit-checkpoint command at the strict schema boundary", () => {
    const fixture = RETIRED_EDIT_CHECKPOINT_COMMAND;
    assert.ok(fixture !== undefined, "the retired fixture remains as a negative control");
    assert.equal(CommandRequestSchema.safeParse(fixture).success, false);
  });
});

describe("apply-settings authority", () => {
  it.each(SettingsApplyRejectionCodeSchema.options)(
    "preserves the closed %s rejection code and rolls back the command journal",
    (code) => {
      const settings: SettingsApplicationExecutor = {
        prepare: () => undefined,
        reconcileReplay: () => {
          throw new Error("rejected settings fixture has no replay authority");
        },
        apply: () => ({ state: "rejected", code, message: `${code} { document: settings.json }` }),
      };
      const harness = createHarness(undefined, settings);
      const patch = { "browser.headless": { set: false } } as const;
      const command = {
        commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
        family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      } as const;

      const result = harness.kernel.execute(command);

      assert.equal(result.state, "rejected");
      if (result.state === "rejected") assert.equal(result.code, code);
      assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
      assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    },
  );

  it("maps candidate validation failure to a value-free rejection without changing SQLite", () => {
    const credentials = createCredentialStore({ stateRoot: databasePath("validation-credentials") });
    const harness = createHarness(undefined, createSettingsApplicationExecutor(() => {
      throw new Error("private candidate diagnostic must not cross the authority boundary");
    }, credentials));
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    const result = harness.kernel.execute(command);

    assert.deepEqual(result, {
      state: "rejected",
      commandId: command.commandId,
      code: "cross-field-invalid",
      message: "cross-field-invalid { keys: settings }",
    });
    assert.equal(JSON.stringify(result).includes("private candidate diagnostic"), false);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(harness.database.authority), {
      revision: 1,
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      settingsFingerprint: derivePersistedSettingsFingerprint({}),
      settings: {},
    });
  });

  it("recovers an ambiguous SQLite COMMIT through exact command replay", () => {
    let reported = false;
    const harness = createHarness(undefined, {}, (database, work) => {
      const result = database.withAuthorityTransaction(work);
      if (!reported) {
        reported = true;
        throw new Error("injected exception after durable COMMIT");
      }
      return result;
    });
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    } as const;

    assert.throws(() => harness.kernel.execute(command), /injected exception after durable COMMIT/u);
    const committed = readSettings(harness.database.authority);
    assert.equal(committed.revision, 2);
    assert.deepEqual(committed.settings, { browser: { headless: false } });
    assert.equal(harness.database.authority.settingsCurrent.get()?.commandId, command.commandId);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId)?.result.state, "applied");

    const replay = harness.kernel.execute(command);
    assert.deepEqual(replay, {
      state: "already-applied",
      commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: true,
      settingsRevision: 2,
      settingsFingerprint: committed.settingsFingerprint,
    });
    assert.deepEqual(readSettings(harness.database.authority), committed);
  });

  it("applies one strict multi-leaf patch at the expected settings revision", () => {
    const harness = createHarness();
    const patch = {
      "browser.headless": { set: false },
      "display.screenWidth": { set: 1920 },
      "display.screenHeight": { set: 1080 },
    } as const;
    const commandId = nextCommandId();
    const persistedSettings = {
      browser: { headless: false },
      display: { screenHeight: 1080, screenWidth: 1920 },
    };
    const settingsFingerprint = derivePersistedSettingsFingerprint(persistedSettings);

    const result = harness.kernel.execute({
      commandId,
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

    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: true,
      settingsRevision: 2,
      settingsFingerprint,
    });
    assert.deepEqual(
      harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges,
      [{ target: { family: "settings", revision: 2 }, before: 1, after: 2 }],
    );
    const audit = harness.database.authority.commandAudits.findByCommand(commandId);
    assert.ok(audit !== undefined);
    assert.deepEqual(harness.database.authority.settingsCurrent.get(), {
      revision: 2,
      settings: persistedSettings,
      settingsFingerprint,
      commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(audit.request),
      auditId: audit.auditId,
      committedAt: NOW,
    });

    const stalePatch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const staleCommandId = nextCommandId();
    const stale = harness.kernel.execute({
      commandId: staleCommandId,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(stalePatch),
        patch: stalePatch,
      },
    });
    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.currentVersion, 2);
    assert.equal(harness.database.authority.commands.get(staleCommandId), undefined);
    assert.deepEqual(readSettings(harness.database.authority).settings, persistedSettings);
  });

  it("refuses an executor outcome that does not advance exactly one revision", () => {
    const settings: SettingsApplicationExecutor = {
      prepare: () => undefined,
      reconcileReplay: () => {
        throw new Error("wrong-revision fixture has no replay authority");
      },
      apply: (command) => ({
        state: "applied",
        revision: command.target.expectedRevision + 2,
        settingsFingerprint: HASH_A,
        settings: {},
      }),
    };
    const harness = createHarness(undefined, settings);
    const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const command = {
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
    } as const;

    assert.throws(
      () => harness.kernel.execute(command),
      /settings executor did not advance exactly one revision/u,
    );

    assert.deepEqual({
      journal: harness.database.authority.commands.get(command.commandId),
      audit: harness.database.authority.commandAudits.findByCommand(command.commandId),
      current: harness.database.authority.settingsCurrent.get(),
    }, {
      journal: undefined,
      audit: undefined,
      current: undefined,
    });
  });

  it("rolls ordinary settings and journal effects back when command audit insertion fails", () => {
    let failAudit = false;
    const harness = createHarness((repositories) => ({
      ...repositories,
      commandAudits: {
        ...repositories.commandAudits,
        insert: (input: unknown) => {
          if (failAudit) throw new Error("injected settings audit failure");
          return repositories.commandAudits.insert(input);
        },
      },
    }));
    const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const commandId = nextCommandId();
    failAudit = true;

    assert.throws(() => harness.kernel.execute({
      commandId,
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
    }), /injected settings audit failure/u);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(harness.database.authority).settings, {});
  });

  it("rolls ordinary settings, command, and audit back when current-result advance fails", () => {
    let failCurrent = false;
    const harness = createHarness((repositories) => ({
      ...repositories,
      settingsCurrent: {
        ...repositories.settingsCurrent,
        advance: (input: unknown) => {
          if (failCurrent) throw new Error("injected settings current-result failure");
          return repositories.settingsCurrent.advance(input);
        },
      },
    }));
    const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const commandId = nextCommandId();
    failCurrent = true;

    assert.throws(() => harness.kernel.execute({
      commandId,
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
    }), /injected settings current-result failure/u);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(harness.database.authority).settings, {});
  });
});

describe("apply-protected-settings authority", () => {
  it("refuses a stale protected schema before reading or materializing credentials", () => {
    assert.notEqual(HASH_A, PROTECTED_SETTINGS_SCHEMA_HASH);
    const stateRoot = databasePath("invalid-credential-root");
    const credentials = createCredentialStore({ stateRoot });
    const harness = createHarness(undefined, createSettingsApplicationExecutor(() => undefined, credentials));
    const command = protectedSettingsCommand({
      protectedSchemaHash: HASH_A,
      value: "must-not-reach-authority",
    });

    assert.deepEqual(harness.kernel.execute(command), {
      state: "rejected",
      commandId: command.commandId,
      code: "schema-mismatch",
      message: "credential schema does not match the current catalog",
    });
    assert.equal(existsSync(join(stateRoot, "credentials")), false);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
  });

  it("keeps an independently committed credential across audit failure and settles exact retry", () => {
    let failAudit = true;
    const harness = createHarness((repositories) => ({
      ...repositories,
      commandAudits: {
        ...repositories.commandAudits,
        insert: (input: unknown) => {
          if (failAudit) throw new Error("injected protected audit failure");
          return repositories.commandAudits.insert(input);
        },
      },
    }));
    const protectedValue = "protected-value-before-audit";
    const command = protectedSettingsCommand({ value: protectedValue });
    const protectedPath = join(harness.stateRoot, "credentials", "protected.json");

    assert.throws(
      () => harness.kernel.execute(command),
      /credential-audit-uncertain: credentials committed; retry the exact command/u,
    );
    assert.equal(harness.credentials.read().revision, 2);
    assert.equal(harness.credentials.read().entries.ucpathPassword?.value, protectedValue);
    const committedBytes = readFileSync(protectedPath);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);

    const divergent = protectedSettingsCommand({
      commandId: command.commandId,
      value: "divergent-protected-value",
      writeId: command.payload.writeId,
    });
    const divergentResult = harness.kernel.execute(divergent);
    assert.equal(divergentResult.state, "rejected");
    if (divergentResult.state === "rejected") assert.equal(divergentResult.code, "command-divergent");
    assert.deepEqual(readFileSync(protectedPath), committedBytes);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);

    failAudit = false;
    const applied = harness.kernel.execute(command);
    assert.equal(applied.state, "applied");
    assert.deepEqual(harness.kernel.execute(command), { ...applied, state: "already-applied" });
    assert.deepEqual(readFileSync(protectedPath), committedBytes);

    const stale = protectedSettingsCommand({
      expectedRevision: 1,
      value: "stale-protected-value",
      writeId: UUID_4,
    });
    const staleResult = harness.kernel.execute(stale);
    assert.equal(staleResult.state, "conflict");
    if (staleResult.state === "conflict") assert.equal(staleResult.currentVersion, 2);
    assert.equal(harness.database.authority.commands.get(stale.commandId), undefined);
    assert.deepEqual(readFileSync(protectedPath), committedBytes);

    const reusedWrite = protectedSettingsCommand({
      expectedRevision: 2,
      value: "reused-write-protected-value",
      writeId: command.payload.writeId,
    });
    const reusedResult = harness.kernel.execute(reusedWrite);
    assert.equal(reusedResult.state, "rejected");
    if (reusedResult.state === "rejected") assert.equal(reusedResult.code, "command-divergent");
    assert.equal(harness.database.authority.commands.get(reusedWrite.commandId), undefined);
    assert.deepEqual(readFileSync(protectedPath), committedBytes);
  });

  it("journals only marked operations while the independent store owns credential values", () => {
    const harness = createHarness();
    const protectedValue = "protected-value-that-must-never-reach-sqlite";
    const command = protectedSettingsCommand({ value: protectedValue });
    const result = harness.kernel.execute(command);

    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.equal(result.restartRequired, false);
    assert.equal(result.revision, 2);
    assert.deepEqual(result.affectedTargets, [{ family: "protected-settings", revision: 2 }]);
    assert.equal(result.entries?.ucpathPassword.present, true);
    const journal = harness.database.authority.commands.get(command.commandId);
    const audit = harness.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(journal !== undefined);
    assert.ok(audit !== undefined);
    const durableBytes = JSON.stringify({ journal, audit, current: harness.database.authority.settingsCurrent.get() });
    assert.equal(durableBytes.includes(protectedValue), false);
    assert.equal(durableBytes.includes(sha256Hex(protectedValue)), false);
    assert.equal(durableBytes.includes('"set":"<set>"'), true);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    const credentialRecord = harness.credentials.read();
    assert.equal(credentialRecord.revision, 2);
    assert.equal(credentialRecord.entries.ucpathPassword?.value, protectedValue);
    assert.equal(credentialRecord.lastApplied?.commandId, command.commandId);
  });
});

/*
 * D308 — delete means delete.
 *
 * The operator ruled (2026-09-01) that a terminal run, on the queue or in the
 * Archive, leaves authority with every row it owns. These tests pin the two
 * doors, their refusals, the tombstone the cascade leaves behind, and the tree
 * rule: leaves first, nothing non-terminal.
 */
describe("D308 delete — a terminal run leaves authority behind one tombstone", () => {
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
    assert.deepEqual(tombstone.removed.filter(({ table }) => table === "tasks"), [{ table: "tasks", rows: 1 }]);
    assert.ok(harness.database.authority.commands.get(command.commandId) !== undefined, "the delete is journaled");
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore + 1);

    const again = harness.kernel.execute(runCommand("delete", runId, version));
    assert.equal(again.state, "rejected");
    if (again.state === "rejected") assert.equal(again.code, "target-deleted");
  });

  it("sends an archived run to the Archive door, which cites the exact record it removes", () => {
    const harness = createHarness();
    assert.equal(harness.database.authority.runs.enqueue(QUEUED_RUN).state, "inserted");
    const version = settle(harness, RUN_ID);
    harness.database.authority.versionPlans.insert(VERSION_PLAN_ROW);
    harness.database.authority.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
    assert.equal(harness.database.authority.archivedRuns.insert(ARCHIVED_RUN).state, "inserted");

    const queueDoor = harness.kernel.execute(runCommand("delete", RUN_ID, version));
    assert.equal(queueDoor.state, "rejected");
    if (queueDoor.state === "rejected") {
      assert.equal(queueDoor.code, "invalid-state");
      assert.match(queueDoor.message, /archived; delete it from the Archive/u);
    }
    assert.ok(harness.database.authority.archivedRuns.get(RUN_ID) !== undefined);

    const archiveDoor = (archiveFingerprint: string) => ({
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "version-archive",
      type: "delete-archived-run",
      target: { archivedRunId: RUN_ID, archiveFingerprint },
    });
    const wrongRecord = harness.kernel.execute(archiveDoor(HASH_B));
    assert.equal(wrongRecord.state, "rejected");
    if (wrongRecord.state === "rejected") assert.equal(wrongRecord.code, "schema-mismatch");
    assert.ok(harness.database.authority.archivedRuns.get(RUN_ID) !== undefined, "a mismatched digest removes nothing");

    const deleted = harness.kernel.execute(archiveDoor(archivedRunReferenceFingerprint(ARCHIVED_RUN)));
    assert.equal(deleted.state, "applied");
    assert.equal(harness.database.authority.archivedRuns.get(RUN_ID), undefined);
    assert.equal(harness.database.authority.runs.get(RUN_ID), undefined, "the retained tasks row goes with the record");
    const tombstone = harness.database.authority.deletedRuns.get(RUN_ID);
    assert.equal(tombstone?.origin, "archive");
    assert.deepEqual(
      tombstone?.removed.filter(({ table }) => table === "archived_runs" || table === "tasks"),
      [{ table: "archived_runs", rows: 1 }, { table: "tasks", rows: 1 }],
    );
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
