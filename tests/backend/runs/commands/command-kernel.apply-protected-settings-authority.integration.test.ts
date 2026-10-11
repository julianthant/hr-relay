import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { explorerEditCommandFingerprint } from "../../../../src/models/dashboard/explorer-override.js";
import { testRunContinuation } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import {
WRITE_FIXTURE_IMPL_FINGERPRINT,
writeFixtureDescriptor
} from "../../../support/fixtures/write-sequencer-fixtures.js";

import assert from "node:assert/strict";
import { existsSync,mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
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
PROTECTED_SETTINGS_SCHEMA_HASH,
} from "../../../../src/models/config/protected-settings.js";
import { ExplorerEditApplyResultSchema,ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import {
ProtectedSettingsCommandRequestSchema
} from "../../../../src/rules/commands/commands.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
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

describe("apply-protected-settings authority", () => {
  it("refuses a stale protected schema before reading or materializing credentials", () => {
    assert.notEqual(HASH_A, PROTECTED_SETTINGS_SCHEMA_HASH);
    const stateRoot = databasePath("invalid-credential-root");
    const credentials = createCredentialStore({ stateRoot });
    const harness = createHarness(undefined, createSettingsApplicationExecutor(() => { throw new Error("protected fixture reached ordinary settings"); }, credentials));
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
