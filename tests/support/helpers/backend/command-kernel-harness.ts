import { createBoundProfileFixture } from "../admission-fixture.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { explorerEditCommandFingerprint } from "../../../../src/models/dashboard/explorer-override.js";
import { testRunContinuation } from "../../fixtures/run-lifecycle-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT, writeFixtureDescriptor } from "../../fixtures/write-sequencer-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { separationsIdentityCheckModule } from "../../../../src/backend/app/registries/step-proof-modules.js";
import { createCommandKernel, type CommandKernel, type ExplorerEditExecutor, type SettingsApplicationExecutor, type WorkerPoolRuntimeAdoption, type WriteResolutionExecutor } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { ExplorerEditApplyResultSchema, ExplorerWorkflowOverrideSchema } from "../../../../src/models/dashboard/explorer.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt, fixtureDescriptor } from "../../fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { seedInitialSettingsRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import { NOW, UUID_4, COMMAND_FIXTURES } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase, createCredentialStore, type AuthorityRepositories } from "../synthetic-storage-admission.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { CommandRequestSchema, type CommandRequest } from "../../../../src/rules/commands/commands.js";

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

type AuthorityTransactionWrap = <Result>(
  database: AuthorityDatabase,
  work: (repositories: AuthorityRepositories) => Result,
) => Result;

interface HarnessOptions {
  readonly profile?: ReturnType<typeof createBoundProfileFixture>;
  readonly prepareAssistantModelPreference?: import("../../../../src/backend/runs/commands/command-kernel.js").CommandKernelDependencies["prepareAssistantModelPreference"];
  readonly failureResolution?: import("../../../../src/backend/runs/commands/command-kernel.js").CommandKernelDependencies["failureResolution"];
  readonly explorerEdits?: ExplorerEditExecutor;
  readonly afterAuthorityCommit?: () => void;
  readonly descriptors?: readonly AnyWorkflowDescriptor[];
}

export interface Harness {
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

export function createCommandKernelTestWorld() {
  const roots: string[] = [];

  const openDatabases: AuthorityDatabase[] = [];

  function databasePath(name: string): string {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-command-kernel-"));
    roots.push(root);
    return join(root, name);
  }

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
      assertResetOwner: () => undefined,
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
    const created = options.profile === undefined ? createBoundProfileFixture() : undefined;
    const profile = options.profile ?? created;
    if (profile === undefined) throw new Error("kernel fixture profile missing");
    const path = profile.path;
    const stateRoot = profile.stateRoot;
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "kernel-test" },
      clock,
    );
    if (created !== undefined) {
      roots.push(created.workspace);
      const close = database.close.bind(database);
      let closed = false;
      database.close = () => {
        if (closed) return;
        closed = true;
        close();
        created.close();
      };
    }
    openDatabases.push(database);
    if (options.profile === undefined) seedInitialSettingsRuntimeConfig(database, clock);
    if (wrap !== undefined) {
      const transaction = database.withAuthorityTransaction.bind(database);
      database.withAuthorityTransaction = (work) => transaction((repositories) => work(wrap(repositories)));
    }

    const workerCalls: string[] = [];
    const writeCalls: string[] = [];
    const credentials = createCredentialStore({ stateRoot });
    const explorerCalls: unknown[] = [];
    const kernel = createCommandKernel({
      ...(options.profile === undefined ? {} : { authorityProfileId: options.profile.admission.profileBinding.profileId }),
      ...(options.prepareAssistantModelPreference === undefined ? {} : { prepareAssistantModelPreference: options.prepareAssistantModelPreference }),
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

  function commandFixture(family: CommandRequest["family"], type: string): CommandRequest {
    const fixture = COMMAND_FIXTURES.find((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return false;
      const record = candidate as Readonly<Record<string, unknown>>;
      return record.family === family && record.type === type;
    });
    assert.ok(fixture !== undefined, `${family}/${type} fixture exists`);
    return CommandRequestSchema.parse(fixture);
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

  const _createPlan = createPlan;

  return { roots, openDatabases, databasePath, createHarness, nextCommandId, rejectActiveDescriptor, createPlan, startCommand, commandFixture, runCommand, applyCurrentSettings, DESCRIPTOR_SET, _createPlan, identityCheckDescriptor, supersedeDescriptor, parallelDescriptor };
}
