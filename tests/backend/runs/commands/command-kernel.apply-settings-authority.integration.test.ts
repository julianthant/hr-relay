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
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import {
SETTINGS_SCHEMA_HASH,
SettingsApplyRejectionCodeSchema,
derivePersistedSettingsFingerprint,
deriveSettingsPatchFingerprint,
} from "../../../../src/models/config/settings.js";
import { ExplorerEditApplyResultSchema,ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import {
deriveSettingsCommandFingerprint
} from "../../../../src/rules/commands/commands.js";
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

describe("apply-settings authority", () => {
  it.each(SettingsApplyRejectionCodeSchema.options)(
    "preserves the closed %s rejection code and rolls back the command journal",
    (code) => {
      const settings: SettingsApplicationExecutor = {
        validateRequest: () => undefined,
        commitPrivate: () => undefined,
        reconcileReplay: () => {
          throw new Error("rejected settings fixture has no replay authority");
        },
        applyOrdinary: () => ({ state: "rejected", code, message: `${code} { document: settings.json }` }),
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
      message: "cross-field-invalid { keys: browser.headless }",
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
      restartRequired: false,
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
      restartRequired: false,
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
      validateRequest: () => undefined,
      commitPrivate: () => undefined,
      reconcileReplay: () => {
        throw new Error("wrong-revision fixture has no replay authority");
      },
      applyOrdinary: (command) => ({
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
