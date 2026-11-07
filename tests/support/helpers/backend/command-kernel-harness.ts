import { separationsIdentityCheckModule } from "../registered-workflows.js";
import { createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";

import { testRunContinuation } from "../../fixtures/run-lifecycle-fixtures.js";
import { writeFixtureDescriptor } from "../../fixtures/write-sequencer-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createCommandKernel, type CommandKernel, type SettingsApplicationExecutor, type WorkerPoolRuntimeAdoption, type WriteResolutionExecutor } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";

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
import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { CommandRequestSchema, type CommandRequest } from "../../../../src/rules/commands/commands.js";

export interface FakeWorkerMember { readonly lifetimeId: string; readonly version: number; readonly state: "running" | "exited" }

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

type AuthorityTransactionWrap = <Result>(
  database: AuthorityDatabase,
  work: (repositories: AuthorityRepositories) => Result,
) => Result;

interface HarnessOptions {
  readonly publishQueued?: ConstructorParameters<typeof RunRecordService>[0]["publishQueued"];
  readonly profile?: BoundProfileStorageFixture;
  readonly prepareAssistantModelPreference?: import("../../../../src/backend/runs/commands/command-kernel.js").CommandKernelDependencies["prepareAssistantModelPreference"];
  readonly failureResolution?: import("../../../../src/backend/runs/commands/command-kernel.js").CommandKernelDependencies["failureResolution"];
  readonly afterAuthorityCommit?: () => void;
  readonly descriptors?: readonly AnyWorkflowDescriptor[];
}

export interface Harness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
  readonly workerCalls: string[];
  /** The fake pool's members by worker id: a member command cites `lifetimeId` and `version` from here. */
  readonly workerMembers: Map<string, FakeWorkerMember>;
  readonly writeCalls: string[];
  readonly credentials: ReturnType<typeof createCredentialStore>;
  readonly stateRoot: string;
}

export function createCommandKernelTestWorld(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  const roots: string[] = [];

  const openDatabases: AuthorityDatabase[] = [];
  const profiles: BoundProfileStorageFixture[] = [];

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

  /** A pool that accepts every effect and keeps each member's lifetime and version in memory, as the real pool does. */
  function acceptingWorkerRuntime(calls: string[], members: Map<string, FakeWorkerMember>): WorkerPoolRuntimeAdoption {
    let lifetimes = 0;
    const state = (workerId: string) => members.get(workerId)?.state ?? "absent";
    return { pool: {
      admit: async () => undefined,
      assertMember: target => {
        const member = members.get(target.workerId);
        if ((member?.lifetimeId ?? null) !== target.lifetimeId || (member?.version ?? 0) !== target.expectedVersion) {
          throw Object.assign(new Error("WORKER_TARGET_STALE"), { code: "WORKER_TARGET_STALE" });
        }
        return state(target.workerId);
      },
      start: async member => { calls.push(`start:${member.workerId}`);
        if (state(member.workerId) === "running") throw Object.assign(new Error("WORKER_ALREADY_RUNNING"), { code: "WORKER_ALREADY_RUNNING" });
        members.set(member.workerId, { lifetimeId: `00000000-0000-4000-8000-${String(++lifetimes).padStart(12, "0")}`, version: 0, state: "running" }); },
      ensure: async member => { calls.push(`ensure:${member.workerId}`);
        if (state(member.workerId) === "absent" || state(member.workerId) === "exited") members.set(member.workerId,
          { lifetimeId: `00000000-0000-4000-8000-${String(++lifetimes).padStart(12, "0")}`, version: 0, state: "running" }); },
      stop: async (workerId, reason) => { calls.push(`stop:${workerId}:${reason}`);
        const member = members.get(workerId); if (member !== undefined) members.set(workerId, { ...member, version: member.version + 1, state: "exited" }); },
      remove: async member => { calls.push(`remove:${member.workerId}`); members.delete(member.workerId); },
      direct: async (workerId, directive) => { calls.push(`direct:${workerId}:${directive}`); },
      browser: async (target, type) => { calls.push(`${type}:${target.browserSessionId}`); },
      checkParkedWrite: async target => { calls.push(`check-parked-write:${target.workerId}`); throw new Error("fixture pool has no parked-write probe"); },
    } };
  }

  function requeueingWriteResolution(calls: string[], database: AuthorityDatabase, clock: ReturnType<typeof manualClock>): WriteResolutionExecutor {
    const executor = createWriteResolutionExecutor({ authority: database,
      continuation: testRunContinuation(database, clock), ids: sequentialIdFactory("c"),
      descriptors: { resolve: id => id === writeFixtureDescriptor.id ? writeFixtureDescriptor : undefined }  });
    return {
      recheck: (repositories, context) => { calls.push(`${context.command.type}:${context.run.envelope.runId}`); return executor.recheck(repositories, context); },
      resolveAbsent: (repositories, context) => { calls.push(`${context.command.type}:${context.run.envelope.runId}`); return executor.resolveAbsent(repositories, context); },
    };
  }

  async function createHarness(
    wrap?: RepositoryWrap,
    settingsInputOrOptions?: SettingsApplicationExecutor | HarnessOptions,
    transactionWrap?: AuthorityTransactionWrap,
  ): Promise<Harness> {
    const options = settingsInputOrOptions !== undefined && !("applyOrdinary" in settingsInputOrOptions)
      ? settingsInputOrOptions : {};
    const descriptors = options.descriptors ?? DESCRIPTOR_SET;
    const settingsOverride = settingsInputOrOptions !== undefined && "applyOrdinary" in settingsInputOrOptions
      ? settingsInputOrOptions : undefined;
    const clock = manualClock(new Date(NOW));
    const created = options.profile === undefined ? await profileFixture() : undefined;
    const profile = options.profile ?? created;
    if (profile === undefined) throw new Error("kernel fixture profile missing");
    const path = profile.path;
    const stateRoot = profile.stateRoot;
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "kernel-test" },
      clock,
    );
    if (created !== undefined) {
      profiles.push(created);
    }
    openDatabases.push(database);
    if (options.profile === undefined) seedInitialSettingsRuntimeConfig(database, clock);
    if (wrap !== undefined) {
      const transaction = database.withAuthorityTransaction.bind(database);
      database.withAuthorityTransaction = (work) => transaction((repositories) => work(wrap(repositories)));
    }

    const workerCalls: string[] = [];
    const workerMembers = new Map<string, FakeWorkerMember>();
    const writeCalls: string[] = [];
    const credentials = createCredentialStore({ stateRoot });
    const kernel = createCommandKernel({
      ...(options.profile === undefined ? {} : { authorityProfileId: options.profile.admission.profileBinding.profileId }),
      ...(options.prepareAssistantModelPreference === undefined ? {} : { prepareAssistantModelPreference: options.prepareAssistantModelPreference }),
      ...(options.failureResolution === undefined ? {} : { failureResolution: options.failureResolution }),
      lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: options.publishQueued ?? (() => {}) }),
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
      writeResolution: requeueingWriteResolution(writeCalls, database, clock),
      workbookRows: createRunWorkbookService({ database, clock }),
      workerRuntime: acceptingWorkerRuntime(workerCalls, workerMembers),
      settings: settingsOverride ?? createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), credentials),
    });
    return {
      database,
      kernel,
      clock,
      plannerIds: sequentialIdFactory("f"),
      workerCalls,
      workerMembers,
      writeCalls,
      credentials,
      stateRoot,
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

  return { roots, openDatabases, profiles, databasePath, createHarness, nextCommandId, rejectActiveDescriptor, createPlan, startCommand, commandFixture, runCommand, applyCurrentSettings, DESCRIPTOR_SET, _createPlan, identityCheckDescriptor, supersedeDescriptor, parallelDescriptor };
}
