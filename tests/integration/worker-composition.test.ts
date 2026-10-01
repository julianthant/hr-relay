import { fixtureAdmission, installationAdmission, releaseAdmissionFixture, releaseAdmissionFixtures } from "../helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { SettingsFactsWireSchema } from "../../src/domain/dashboard/settings.js";
import { EditableSettingsWireSchema } from "../../src/domain/dashboard/settings-editor.js";
import { createTimelineEmitter } from "../../src/infra/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../src/server/dashboard/commands/run-queued-span.js";
import { ActorIdSchema, GateIdSchema, RunIdSchema, TraceIdSchema } from "../../src/domain/ids.js";
import { createSettingsApplicationExecutor } from "../../src/server/dashboard/commands/settings-service.js";
import { composeDashboardRuntime } from "../../src/server/dashboard/compose.js";
import { createCredentialSecretSource, readSettings } from "../../src/server/settings-runtime.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../src/domain/config/protected-settings.js";
import { RuntimeConfigClaimTokenSchema } from "../../src/domain/config/runtime-generation.js";
import { RunRecordService } from "../../src/core/run-record-service.js";
import { testRunService, testWorkerPorts } from "../fixtures/run-lifecycle-fixtures.js";
import { hostConfigFacts } from "../../src/domain/config/host-display.js";
/**
 * The Phase-1f worker composition (`src/server/worker/compose.ts`) and the
 * command kernel's worker-browser arms as the DASHBOARD process composes them.
 *
 * Everything real is real: a temp-file `AuthorityDatabase` under the isolation
 * state root, the registered person-lookup descriptor and task stores, the
 * worker lease protocol, the JSONL span writer, and the whole worker loop.
 * Only the process edges are fakes — the browser session factory, the clock,
 * ids, and the stop signal — so a pass here pins production wiring rather than
 * a parallel reimplementation.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { DESCRIPTORS, personLookupModule } from "../../src/control/workflow-registry.js";
import { createCommandKernel, executeSettingsCommand, type CommandKernel } from "../../src/core/command-kernel.js";
import { createPhase1WorkerRuntimeExecutor, phase1WorkerId, poolWorkerId, runWorkerLoop } from "../../src/core/worker-loop.js";
import { createGateSourceRuntime, type GateSourceDelivery, type GateSourceEnvelope, type GateSourcePort } from "../../src/core/gate-source-runtime.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
  initialSettingsFileRecord,
  derivePersistedSettingsFingerprint,
} from "../../src/domain/config/settings.js";
import { PositiveIntSchema, WorkflowIdSchema, WorkerIdSchema } from "../../src/domain/ids.js";
import type { PositiveInt } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../src/base/workflow.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { createCredentialStore } from "../helpers/admission-fixture.js";
import { AuthorityDatabase } from "../helpers/admission-fixture.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import {
  observeProcessIdentity,
  observeRuntimeLockSnapshot,
} from "../../src/infra/sqlite/runtime-process-locks.js";
import type { WorkerProcessSupervisor } from "../../src/core/worker-loop.js";
import {
  composeWorkerRuntime,
  createTimeoutDeadlineScheduler,
  lineTaskLogger,
  parseWorkerArguments,
} from "../../src/server/worker/compose.js";
import { UUID_7, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../fixtures/phase1c-contract-fixtures.js";
import {
  EXECUTOR_WORKER_ID,
  happySessionHarness,
  healthyCrmDriver,
  personLookupQueuedRun,
  sessionFactoryHarness,
  type SessionFactoryHarness,
} from "../helpers/phase1f-executor-harness.js";
import { sequentialIdFactory, ITEM_ID, RUN_ID, WORKFLOW_ID, QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../helpers/duo-ceremony-fixtures.js";
import { happySessionHarness as sourceSessionHarness, ManualScheduler, recordingLogger, recordingTimelineEmitter } from "../helpers/phase1f-executor-harness.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";
import { settingsSetOperations } from "../fixtures/settings-operation-fixtures.js";
import {
  SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS,
  persistCorruptJournaledSettings,
} from "./fixtures/settings-runtime-corruption-fixtures.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  releaseAdmissionFixtures();
  for (const root of roots.splice(0)) {
    releaseAdmissionFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});

const NOW = "2026-08-03T09:00:00.000Z";
const POOL_INDEX_1 = PositiveIntSchema.parse(1);
const POOL_INDEX_2 = PositiveIntSchema.parse(2);

function repoRootWithState(): { repoRoot: string; stateRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-worker-compose-"));
  roots.push(repoRoot);
  const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

/** Open the SAME database path the composition will, seed it, and close. */
function seedQueuedRun(
  stateRoot: string,
  clock: TestClock,
  run: Record<string, unknown>,
  resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }),
): void {
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  try {
    const parsedRun = RunRecordSchema.parse(run);
    const configSnapshotId = parsedRun.envelope.configSnapshotId;
    database.withAuthorityTransaction((repositories) => {
      repositories.configSnapshots.insert({
        configSnapshotId,
        revision: 1,
        fingerprint: resolved.fingerprint,
        capturedAt: clock.now().toISOString(),
        capturedBy: "local-operator",
        config: resolved.config,
        provenance: resolved.provenance,
      });
      if (repositories.runtimeConfig.get() === undefined) {
        const baseline = initialSettingsFileRecord();
        repositories.runtimeConfig.activate({
          settingsRevision: baseline.revision,
          settingsFingerprint: baseline.settingsFingerprint,
          configSnapshotId,
          configFingerprint: resolved.fingerprint,
          activatedAt: clock.now().toISOString(),
        });
      }
      assert.equal(repositories.runs.enqueue({
        ...parsedRun,
        envelope: { ...parsedRun.envelope, configFingerprint: resolved.fingerprint },
      }).state, "inserted");
    });
  } finally {
    database.close();
  }
}

function reopen(stateRoot: string, clock: TestClock): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  return database;
}

function ensureBaselineRuntimeConfig(repoRoot: string, clock: TestClock): void {
  const database = AuthorityDatabase.open(
    {
      path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "unit-test",
    },
    clock,
  );
  try {
    database.withAuthorityTransaction((repositories) => {
      if (repositories.runtimeConfig.get() !== undefined) return;
      const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, { stateRoot: join(repoRoot, rebuildRuntimeIsolation.stateRoot), artifactRoot: join(repoRoot, rebuildRuntimeIsolation.artifactRoot) });
      const baseline = initialSettingsFileRecord();
      const configSnapshotId = "66666666-6666-4666-8666-666666666666";
      repositories.configSnapshots.insert({
        configSnapshotId,
        revision: 1,
        fingerprint: resolved.fingerprint,
        capturedAt: clock.now().toISOString(),
        capturedBy: "local-operator",
        config: resolved.config,
        provenance: resolved.provenance,
      });
      repositories.runtimeConfig.activate({
        settingsRevision: baseline.revision,
        settingsFingerprint: baseline.settingsFingerprint,
        configSnapshotId,
        configFingerprint: resolved.fingerprint,
        activatedAt: clock.now().toISOString(),
      });
    });
  } finally {
    database.close();
  }
}

function persistUnjournaledWorkerSettings(repoRoot: string, clock: TestClock, patch: unknown) {
  patch = settingsSetOperations(patch);
  const patchFingerprint = deriveSettingsPatchFingerprint(patch);
  const command = {
    commandId: "33333333-3333-4333-8333-333333333333",
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
  };
  void repoRoot; void clock;
  return Object.freeze({ command, settingsFingerprint: derivePersistedSettingsFingerprint({ browser: { headless: false } }) });
}

function persistJournaledWorkerSettings(
  repoRoot: string,
  stateRoot: string,
  clock: TestClock,
  patch: unknown,
): void {
  const persisted = persistUnjournaledWorkerSettings(repoRoot, clock, patch);
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  try {
    journalWorkerSettings(database, persisted, stateRoot);
    const record = readSettings(database.authority);
    const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") });
    database.withAuthorityTransaction((repositories) => {
      const configSnapshotId = "55555555-5555-4555-8555-555555555555";
      repositories.configSnapshots.insert({
        configSnapshotId,
        revision: 1,
        fingerprint: resolved.fingerprint,
        capturedAt: clock.now().toISOString(),
        capturedBy: "local-operator",
        config: resolved.config,
        provenance: resolved.provenance,
      });
      repositories.runtimeConfig.activate({
        settingsRevision: record.revision,
        settingsFingerprint: record.settingsFingerprint,
        configSnapshotId,
        configFingerprint: resolved.fingerprint,
        activatedAt: clock.now().toISOString(),
      });
    });
  } finally {
    database.close();
  }
}

function journalWorkerSettings(
  database: AuthorityDatabase,
  persisted: ReturnType<typeof persistUnjournaledWorkerSettings>,
  stateRoot: string,
): void {
  const clock = manualClock(new Date(NOW));
  const result = executeSettingsCommand({ authority: database, clock, ids: sequentialIdFactory("4"),
    settings: createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }), createCredentialStore({ stateRoot })) }, persisted.command);
  assert.equal(result.state, "applied");
}

describe("worker-loop source gate composition", () => {
  for (const mode of ["external", "children-terminal"] as const) {
    it(`parks and source-settles a ${mode} descriptor through the production worker loop`, async () => {
      const { stateRoot } = repoRootWithState();
      const clock = manualClock(new Date(NOW));
      const database = reopen(stateRoot, clock);
      const descriptor = sourceGateDescriptor(mode);
      const workerPorts = testWorkerPorts(database, clock);
      database.authority.runs.enqueue(RunRecordSchema.parse(sourceGateQueuedRun(descriptor)));

      const sourceKind = mode === "external" ? "external" : "workflow";
      const sourceId = mode === "external" ? "source-ticket-system" : String(SOURCE_CHILD.id);
      let dispatch: ((event: GateSourceEnvelope) => Promise<GateSourceDelivery>) | undefined;
      const source: GateSourcePort = {
        kind: sourceKind,
        sourceId,
        bindCorrelation: ({ canonicalInput }) =>
          (canonicalInput as Readonly<{ ticket: string }>).ticket,
        subscribe: async (deliver, _signal) => {
          dispatch = deliver;
          return (): void => undefined;
        },
      };
      const sourceRuntime = createGateSourceRuntime({
        database,
        lifecycle: testRunService(database, clock),
        descriptors: { resolve: (id) => id === WORKFLOW_ID ? descriptor : undefined },
        ports: [source],
        clock,
      });
      const stopController = new AbortController();
      const stopSource = await sourceRuntime.start(stopController.signal);
      const sessions = sourceSessionHarness();
      const spans = recordingTimelineEmitter(database, clock);
      const workerPromise = runWorkerLoop({
        workflowId: WorkflowIdSchema.parse(WORKFLOW_ID),
        workerId: WorkerIdSchema.parse("source-gate-worker-1"),
        descriptor,
        stores: taskStoreRegistry,
        authority: database,
        lifecycle: workerPorts.lifecycle,
        gateSources: sourceRuntime,
        sessionFactory: sessions.factory,
        emitter: spans.emitter,
        clock,
        ids: sequentialIdFactory("d"),
        scheduler: new ManualScheduler(clock),
        taskDeadlineMs: 60_000,
        sessionAcquireMs: 15_000,
        duoCeremony: fixtureDuoCeremonyGates(clock),
        heartbeatIntervalMs: 60_000,
        idleRepollMs: 60_000,
        log: recordingLogger().log,
        stopSignal: stopController.signal,
        exitWhenIdle: false,
        claimNext: workerPorts.claimNext,
      });
      void workerPromise.catch(() => undefined);

      try {
        let parked = database.authority.runs.get(RUN_ID);
        const deadline = Date.now() + 5_000;
        while (parked?.lifecycle.state !== "parked-gate" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          parked = database.authority.runs.get(RUN_ID);
        }
        assert.ok(parked?.lifecycle.state === "parked-gate", "worker loop did not commit the source gate park");
        assert.ok(dispatch !== undefined, "the source port was not registered with the runtime");
        const event: GateSourceEnvelope = {
          eventId: UUID_7,
          runId: RunIdSchema.parse(RUN_ID),
          attempt: parked.envelope.attempt,
          gateId: GateIdSchema.parse("source-result"),
          expectedVersion: PositiveIntSchema.parse(parked.version),
          event: {
            ticket: "synthetic-ticket-10873698",
            complete: true,
            ...(mode === "children-terminal" ? { terminal: "done" } : {}),
          },
        };
        assert.deepEqual(await dispatch(event), {
          state: "settled",
          result: {
            schemaHash: deriveSchemaHash(SOURCE_GATE_RESULT, "output"),
            value: { complete: true },
          },
        });
        stopController.abort(new Error("source settlement proof complete"));

        const report = await workerPromise;
        assert.deepEqual(report.outcomes.map(({ state }) => state), ["parked-gate"]);
        assert.equal(report.stopped, "stop-signal");
        const settledRun = database.authority.runs.get(RUN_ID);
        assert.ok(settledRun?.lifecycle.state === "queued", "the exact parked run was not requeued");
        assert.equal(settledRun.version, parked.version + 1);

        const results = database.authority.gateResults.listByRun(RUN_ID);
        assert.equal(results.length, 1);
        const [stored] = results;
        assert.ok(stored !== undefined && "source" in stored);
        if (stored !== undefined && "source" in stored) {
          assert.deepEqual(stored.source, {
            kind: sourceKind,
            sourceId,
            eventId: UUID_7,
            eventDigest: sha256Hex(canonicalJsonStringify(event.event)),
            correlationKey: "ticket",
            correlationDigest: sha256Hex(canonicalJsonStringify("synthetic-ticket-10873698")),
            attempt: parked.envelope.attempt,
          });
          assert.deepEqual(stored.result, {
            schemaHash: deriveSchemaHash(SOURCE_GATE_RESULT, "output"),
            value: { complete: true },
          });
        }

        const sourceResolutions = database.authority.timelineEvents.page({ workflow: WORKFLOW_ID })
          .flatMap((record) => record.payload.kind === "span" ? [record.payload.event] : [])
          .filter((eventRecord) => eventRecord.t === "gate.resolved"
            && eventRecord.runId === RUN_ID && eventRecord.gate === "source-result");
        assert.equal(sourceResolutions.length, 1, "one durable gate resolution event must publish");
      } finally {
        stopController.abort(new Error("source gate test cleanup"));
        await workerPromise.catch(() => undefined);
        await stopSource();
      }
    });
  }
});

function fixtureProcessIdentityObserver(pid: number) {
  return pid === process.pid
    ? observeProcessIdentity(pid)
    : {
        state: "alive" as const,
        identity: { platform: "darwin" as const, startToken: `synthetic-${String(pid)}` },
      };
}

function composeInput(options: Readonly<{
  repoRoot: string;
  clock: TestClock;
  sessions: SessionFactoryHarness;
  poolIndex: PositiveInt;
  processId?: number;
  args?: readonly string[];
  stopSignal?: AbortSignal;
  lines?: string[];
}>) {
  ensureBaselineRuntimeConfig(options.repoRoot, options.clock);
  return {
    preflightRunnerFactory: healthyRuntimePreflightRunners,
    isolation: rebuildRuntimeIsolation,
    args: options.args ?? [WORKFLOW_ID, "--pool-index", String(options.poolIndex), "--drain"],
    env: {},
    clock: options.clock,
    ids: sequentialIdFactory("c"),
    admission: fixtureAdmission(options.repoRoot),
    repoRoot: options.repoRoot,
    processId: options.processId ?? 4242,
    processIdentityObserver: fixtureProcessIdentityObserver,
    sessionFactory: options.sessions.factory,
    duoCeremony: fixtureDuoCeremonyGates(options.clock),
    stopSignal: options.stopSignal ?? new AbortController().signal,
    // Long enough that no scheduled beat fires during a test; the boot beat is
    // synchronous, so the lease/sweep path is still exercised.
    heartbeatIntervalMs: 600_000,
    sweepIntervalMs: 600_000,
    write: (line: string): void => {
      options.lines?.push(line);
    },
  } as const;
}

const SOURCE_GATE_INPUT = z.strictObject({ ticket: z.string().min(1) });
const SOURCE_GATE_CANONICAL_INPUT = defineCanonicalInput(
  SOURCE_GATE_INPUT,
  z.strictObject({ ticket: z.string().min(1) }),
  [{ ticket: "synthetic-ticket-10873698" }],
);
const SOURCE_GATE_EVENT = z.strictObject({
  ticket: z.string().min(1),
  complete: z.boolean(),
  terminal: z.enum(["done", "failed"]).optional(),
});
const SOURCE_GATE_RESULT = z.strictObject({ complete: z.boolean() });
const SOURCE_CHILD = {
  id: WorkflowIdSchema.parse("source-child-fixture"),
  input: SOURCE_GATE_INPUT,
  result: SOURCE_GATE_RESULT,
};
type SourceGateMode = "external" | "children-terminal";

function sourceGateDescriptor(mode: SourceGateMode) {
  const registered = personLookupModule.descriptor;
  const metadata = {
    id: WORKFLOW_ID,
    version: registered.version,
    contractFingerprint: registered.contractFingerprint,
    code: registered.code,
    label: "Synthetic source gate",
    icon: registered.icon,
    category: registered.category,
    input: SOURCE_GATE_INPUT,
    canonicalInput: SOURCE_GATE_CANONICAL_INPUT,
    inputSubject: "none",
    surface: registered.surface,
    enqueue: registered.enqueue,
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    scenarios: ["person-lookup/source-gate-composition-proof"] as [string],
    identity: { matchKey: ({ ticket }: z.output<typeof SOURCE_GATE_INPUT>) => `ticket:${ticket}` },
    presentation: { title: ({ ticket }: z.output<typeof SOURCE_GATE_INPUT>) => `Source gate ${ticket}` },
  } as const;

  if (mode === "external") {
    const graph = flow(SOURCE_GATE_INPUT)
      .gate("source-result", {
        dependsOn: [],
        label: "External source result",
        resolvedBy: "external",
        subscribes: {
          kind: "external",
          sourceId: "source-ticket-system",
          event: SOURCE_GATE_EVENT,
          correlationKey: "ticket",
        },
        result: SOURCE_GATE_RESULT,
        resolve: (event: z.output<typeof SOURCE_GATE_EVENT>) => ({ complete: event.complete }),
      })
      .build({
        schema: SOURCE_GATE_RESULT,
        dependsOn: ["source-result"],
        derive: ({ outputs }) => outputs["source-result"],
      });
    return defineWorkflowDescriptor({ ...metadata, flow: graph });
  }

  const graph = flow(SOURCE_GATE_INPUT)
    .gate("source-result", {
        dependsOn: [],
        label: "Child terminal result",
        resolvedBy: "children-terminal",
        subscribes: {
          kind: "workflow",
          workflow: SOURCE_CHILD,
          event: SOURCE_GATE_EVENT,
          correlationKey: "ticket",
          terminal: ["done"],
        },
        result: SOURCE_GATE_RESULT,
        resolve: (event: z.output<typeof SOURCE_GATE_EVENT>) => ({ complete: event.complete }),
      })
      .build({
        schema: SOURCE_GATE_RESULT,
        dependsOn: ["source-result"],
        derive: ({ outputs }) => outputs["source-result"],
    });
  return defineWorkflowDescriptor({ ...metadata, flow: graph });
}

function sourceGateQueuedRun(descriptor: ReturnType<typeof sourceGateDescriptor>) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: WORKFLOW_ID,
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
    },
    input: {
      raw: { ticket: "synthetic-ticket-10873698" },
      parsed: {
        schemaHash: deriveSchemaHash(SOURCE_GATE_CANONICAL_INPUT, "output"),
        value: { ticket: "synthetic-ticket-10873698" },
      },
      ingressSchemaHash: deriveSchemaHash(SOURCE_GATE_INPUT, "input"),
    },
  };
}

function assertStoppedWorkerProcessRecord(repoRoot: string, clock: TestClock): void {
  const snapshot = observeRuntimeLockSnapshot({
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
    sourceDatabaseIdentity: "a".repeat(64),
  }, clock, {
    // Re-read through the exact identity observer that wrote this fixture
    // record. An unreleased record is therefore active, not a PID-reuse arm.
    observeProcessIdentity: fixtureProcessIdentityObserver,
  });
  assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
}

describe("worker CLI argument parsing", () => {
  it("accepts an explicit positive pool index", () => {
    assert.deepEqual(parseWorkerArguments([WORKFLOW_ID, "--pool-index", "2", "--drain"]), {
      workflowId: WORKFLOW_ID,
      poolIndex: POOL_INDEX_2,
      drain: true,
    });
  });

  it("refuses absent, malformed, zero, and duplicate pool-index flags", () => {
    assert.throws(() => parseWorkerArguments([WORKFLOW_ID]), /requires --pool-index/);
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "many"]),
      /must be a positive integer; received many/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "0"]),
      /must be a positive integer; received 0/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--pool-index", "2"]),
      /duplicate worker flag: --pool-index/,
    );
    const oversized = "999999999999999999999999999999";
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", oversized]),
      new RegExp(`--pool-index.*${oversized}`, "u"),
    );
  });

  it("refuses missing values, duplicate drain flags, and unknown flags by name", () => {
    assert.throws(() => parseWorkerArguments([]), /needs a workflow id/);
    assert.throws(() => parseWorkerArguments(["not-registered"]), /is not registered/);
    assert.throws(
      () => parseWorkerArguments(["separations-kuali-finalization", "--pool-index", "1", "--drain"]),
      /is not registered/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "--drain"]),
      /requires a positive integer value/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--drain", "--drain"]),
      /duplicate worker flag: --drain/,
    );
    assert.throws(
      () => parseWorkerArguments([WORKFLOW_ID, "--pool-index", "1", "--headed"]),
      /unknown worker flag: --headed/,
    );
  });
});

describe("composed worker runtime", () => {
  it("four workers boot, poll and claim without creating file authority", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const reports = await Promise.all([0, 1, 2, 3].map((offset) =>
      composeWorkerRuntime(composeInput({ repoRoot, clock, sessions: happySessionHarness(),
        poolIndex: PositiveIntSchema.parse(offset + 1), processId: 4300 + offset }))));
    assert.equal(reports.flatMap(({ outcomes }) => outcomes).length, 1,
      "one queued run is claimed once while other workers observe idle");
    assert.equal(existsSync(join(stateRoot, "settings")), false, "boot and polling create no file authority or lock");
  });

  it("starts and awaits shutdown of registered gate source ports", async () => {
    const { repoRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    let subscribed = 0;
    let stopped = 0;
    const port: GateSourcePort = {
      kind: "external",
      sourceId: "composition-startup-fixture",
      bindCorrelation: () => "synthetic-correlation",
      subscribe: async (_deliver, _signal) => {
        subscribed += 1;
        return async () => { stopped += 1; };
      },
    };
    const report = await composeWorkerRuntime({
      ...composeInput({ repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1 }),
      gateSourcePorts: [port],
    });
    assert.equal(report.stopped, "idle");
    assert.equal(subscribed, 1, "composeWorkerRuntime must start its registered gate source runtime");
    assert.equal(stopped, 1, "composeWorkerRuntime must await source shutdown before returning");
  });

  it("ignores retired unjournaled file bytes and claims using SQLite settings", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    const directory = join(stateRoot, "settings"); mkdirSync(directory);
    const path = join(directory, "settings.json"); writeFileSync(path, "retired invalid authority");
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.equal(readFileSync(path, "utf8"), "retired invalid authority");
    assertStoppedWorkerProcessRecord(repoRoot, clock);
  });

  it.each(SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS)(
    "refuses valid settings bytes with corrupt $label on worker boot",
    async (corruption) => {
      const { repoRoot, stateRoot } = repoRootWithState();
      const clock = manualClock(new Date(NOW));
      const fixture = persistCorruptJournaledSettings({
        repoRoot,
        stateRoot,
        clock,
        corruption,
        activateRuntime: true,
      });
      seedQueuedRun(
        stateRoot,
        clock,
        personLookupQueuedRun(),
        resolveConfigWithProvenance({ browser: { headless: false } }, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }),
      );

      await assert.rejects(
        composeWorkerRuntime(composeInput({
          repoRoot,
          clock,
          sessions: happySessionHarness(),
          poolIndex: POOL_INDEX_1,
        })),
        corruption.expected,
      );
      assert.deepEqual(reopen(stateRoot, clock).authority.settingsCurrent.get(), fixture.record);
      assert.equal(reopen(stateRoot, clock).authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
      assertStoppedWorkerProcessRecord(repoRoot, clock);
    },
  );

  it("uses persisted settings after restart for the worker session-acquisition bound", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    persistJournaledWorkerSettings(
      repoRoot,
      stateRoot,
      clock,
      { timeouts: { sessionAcquireMs: 1 } },
    );
    seedQueuedRun(
      stateRoot,
      clock,
      personLookupQueuedRun(),
      resolveConfigWithProvenance({ timeouts: { sessionAcquireMs: 1 } }, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }),
    );
    const neverOpeningSessions: SessionFactoryHarness = {
      ...happySessionHarness(),
      factory: {
        open: () => new Promise<never>(() => undefined),
      },
    };
    const stop = new AbortController();
    const stopFallback = setTimeout(() => {
      stop.abort(new Error("persisted worker config was ignored"));
    }, 5_000);

    try {
      const report = await composeWorkerRuntime(composeInput({
        repoRoot,
        clock,
        sessions: neverOpeningSessions,
        poolIndex: POOL_INDEX_1,
        stopSignal: stop.signal,
      }));
      assert.deepEqual(report.outcomes.map(({ state }) => state), ["failed"]);
      const failed = report.outcomes[0];
      assert.ok(failed?.state === "failed");
      const failure = reopen(stateRoot, clock).authority.failures.get(failed.failureId);
      assert.match(failure?.summary ?? "", /exceeded its 1ms timeouts\.sessionAcquireMs bound/u);
    } finally {
      clearTimeout(stopFallback);
    }
  });

  it("executes a retained queued run after settings change", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const original = reopen(stateRoot, clock).authority.runs.get(RUN_ID); assert.ok(original);
    persistJournaledWorkerSettings(
      repoRoot,
      stateRoot,
      clock,
      { browser: { headless: false } },
    );

    const sessions = happySessionHarness();
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(sessions.opens("ucpath") > 0);
    assert.equal(reopen(stateRoot, clock).authority.runs.get(RUN_ID)?.envelope.configFingerprint,
      original.envelope.configFingerprint);
  });

  it("rolls back a nested settings save when ownership fails at claim admission before either browser opens", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    let admissionCrossed = false;
    let admissionSettingsRecord: ReturnType<typeof readSettings> | undefined;
    let admissionDatabase: AuthorityDatabase | undefined;

    const refusal = await composeWorkerRuntime({
        ...composeInput({
          repoRoot,
          clock,
          sessions,
          poolIndex: POOL_INDEX_1,
        }),
        openDatabase: (options, openClock) => {
          const database = AuthorityDatabase.open(options, openClock);
          admissionDatabase = database;
          return database;
        },
        afterClaimAdmissionCheck: () => {
          assert.ok(admissionDatabase !== undefined, "claim admission ran before authority opened");
          const persisted = persistUnjournaledWorkerSettings(
            repoRoot,
            clock,
            { browser: { headless: false } },
          );
          // Nested settings application must roll back with failed claim admission.
          admissionSettingsRecord = readSettings(admissionDatabase.authority);
          journalWorkerSettings(admissionDatabase, persisted, stateRoot);
          admissionCrossed = true;
          throw new Error("synthetic stale owner at claim admission");
        },
      }).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.equal(admissionCrossed, true);
    assert.deepEqual(readSettings(reopen(stateRoot, clock).authority), admissionSettingsRecord);
    const database = reopen(stateRoot, clock);
    assert.equal(sessions.opens("ucpath"), 0);
    assert.equal(sessions.opens("crm"), 0);
    assert.match(
      refusal instanceof Error ? refusal.message : String(refusal),
      /synthetic stale owner at claim admission/u,
    );
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    assert.equal(database.authority.commands.get("33333333-3333-4333-8333-333333333333"), undefined);
    assert.equal(database.authority.settingsCurrent.get(), undefined);
  });

  it("releases its process record when authority open fails without masking that error", async () => {
    const { repoRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    const openFailure = new Error("injected authority open failure");
    await assert.rejects(
      composeWorkerRuntime({
        ...composeInput({
          repoRoot,
          clock,
          sessions: happySessionHarness(),
          poolIndex: POOL_INDEX_1,
          processId: process.pid,
        }),
        openDatabase: () => {
          throw openFailure;
        },
      }),
      (error: unknown) => error === openFailure,
    );
    const snapshot = observeRuntimeLockSnapshot({
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
      sourceDatabaseIdentity: "a".repeat(64),
    }, clock);
    assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
  });

  it("keeps its process record active when database closure cannot be proven", async () => {
    const { repoRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    const closeFailure = new Error("injected database close failure");
    let stillOpen: AuthorityDatabase | undefined;
    await assert.rejects(
      composeWorkerRuntime({
        ...composeInput({
          repoRoot,
          clock,
          sessions: happySessionHarness(),
          poolIndex: POOL_INDEX_1,
          processId: process.pid,
        }),
        closeDatabase: (database) => {
          stillOpen = database;
          throw closeFailure;
        },
      }),
      (error: unknown) => error === closeFailure,
    );
    assert.ok(stillOpen !== undefined);
    assert.doesNotThrow(() => stillOpen?.getMeta(), "the injected close failure left the handle usable");
    const snapshot = observeRuntimeLockSnapshot({
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
      sourceDatabaseIdentity: "a".repeat(64),
    }, clock);
    assert.deepEqual(snapshot.processLocks.workers, {
      state: "active",
      generation: 2,
      pid: process.pid,
    });
    stillOpen.close();
  });

  it("builds the whole dependency graph and drains a queued run to done", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const lines: string[] = [];

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, lines, poolIndex: POOL_INDEX_1,
    }));

    assert.equal(report.workflowId, WORKFLOW_ID);
    assert.equal(report.workerId, phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)));
    assert.equal(report.stopped, "idle");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    // The terminal result authority is the composition's, not a fixture's.
    assert.ok(database.authority.runResults.get(RUN_ID));

    // The durable lease: started by this process, settled honestly at exit.
    const lease = database.authority.workerLeases.get(report.workerId);
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
    assert.equal(lease.processId, 4242);
    assert.equal(lease.workflow, WORKFLOW_ID);

    // Composition persists its own cross-process timeline in authority.
    assert.ok(database.authority.timelineEvents.page({ workflow: WORKFLOW_ID }).length > 0);

    // One browser session per system, closed exactly once at worker stop.
    assert.equal(sessions.opens("ucpath"), 1);
    assert.deepEqual(sessions.closeReasons(), ["worker-stop", "worker-stop"]);
  });

  it("composes distinct stable identities for members of one workflow pool", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));

    const first = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    const second = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_2,
    }));

    const expected = [
      poolWorkerId(WorkflowIdSchema.parse(WORKFLOW_ID), POOL_INDEX_1),
      poolWorkerId(WorkflowIdSchema.parse(WORKFLOW_ID), POOL_INDEX_2),
    ];
    const database = reopen(stateRoot, clock);
    assert.deepEqual({
      reports: [first.workerId, second.workerId],
      authorityLeases: expected.map((workerId) => database.authority.workerLeases.get(workerId)?.workerId),
    }, {
      reports: expected,
      authorityLeases: expected,
    });
  });

  it("refuses a second process answering to the same worker id", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = poolWorkerId(WorkflowIdSchema.parse(WORKFLOW_ID), POOL_INDEX_1);
    const database = reopen(stateRoot, clock);
    assert.equal(database.authority.workerLeases.start({
      workerId,
      workflow: WORKFLOW_ID,
      browserSystems: ["crm", "ucpath"],
      processId: 999,
      requestedBy: "local-operator",
      now: NOW,
    }).state, "started");

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
      })),
      /a second process may not answer to the same worker id/,
    );
  });

  it("reclaims a lease whose process died without settling, instead of bricking the workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const seed = reopen(stateRoot, clock);
    // A worker that was SIGKILLed leaves a live `idle` lease behind whose
    // heartbeat then ages out. Only a RUNNING worker sweeps, so without a
    // reclaim-before-acquire pass no worker could ever start again.
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 999,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    }).state, "applied");
    clock.advanceWall(120_000);
    clock.advanceMonotonic(120_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
    assert.ok(lines.some((line) => line.includes("stale worker lease reclaimed before start")));
  });

  /**
   * D200. A worker whose loop throws settles its LEASE (`crashed`) on the way
   * out and leaves its claimed run row exactly where it was. The next process
   * therefore wins the lease and then finds `claimNext` refusing —
   * `worker … already holds active run …` — because the row it left behind is
   * still owned by this worker id. The maintenance boot sweep cannot help: the
   * row's heartbeat is seconds old, far inside the 60s staleness gate. Before
   * this, the only ways out were starting a DIFFERENT workflow's worker or
   * cancelling the run.
   */
  it("sweeps its own orphaned claim at startup and then claims it, same workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.equal(claimed.state, "claimed", "the crashed process must actually own the row");
    // The clock barely moves: the heartbeat this row carries is FRESH, which is
    // precisely why the staleness-gated boot sweep skips it.
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(
      lines.some((line) => line.includes("orphaned claim released before the first poll")),
      "the startup self-sweep did not report releasing the row",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    assert.equal(run.envelope.attempt, 1, "recovery preserves the immutable item attempt");
  });

  /**
   * D200 reuses the D118 sweeper rather than forking it, so the startup pass
   * inherits the gate: a run whose logical item holds an unfinished
   * `attempting` write intent PARKS and is never requeued. A startup path that
   * reimplemented "release my own rows" would have handed a possibly-landed
   * real HR write straight back to the executor.
   */
  for (const recovery of ["startup", "global"] as const) it(`${recovery} recovery publishes cancellation once without claiming or opening browsers`, async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = recovery === "startup" ? phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)) : "orphan-other-worker";
    const database = reopen(stateRoot, clock);
    const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const service = testRunService(database, clock);
    assert.equal(service.transition({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: RUN_ID, expectedVersion: claimed.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }).state, "applied");
    if (recovery === "global") clock.advanceWall(600_000);
    const sessions = happySessionHarness();
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes, []);
    assert.equal(sessions.opens("ucpath"), 0);
    assert.equal(sessions.opens("crm"), 0);
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled);
    assert.deepEqual(settled.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() });
    assert.equal(settled.envelope.attempt, claimed.run.envelope.attempt);
    assert.equal(settled.claimGeneration, claimed.run.claimGeneration);
    // A fresh process repeating startup/global maintenance must not duplicate the terminal event.
    await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    const terminal = database.authority.timelineEvents.page({ runId: RUN_ID })
      .flatMap((record) => record.payload.kind === "span" ? [record.payload.event] : [])
      .flatMap((event) => event.t === "span.ended" && event.kind === "run" && event.runId === RUN_ID ? [event] : []);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0]?.outcome, "cancelled");
    assert.equal(terminal[0]?.attempt, claimed.run.envelope.attempt);
    assert.equal(terminal[0]?.traceId, claimed.run.envelope.traceId);
  });

  it("parks — never requeues — its own orphaned claim that holds an attempting write intent", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const validating = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    });
    assert.ok(validating.state === "applied");
    const running = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "searching" },
      now: NOW,
    });
    assert.ok(running.state === "applied");
    crashed.authority.writeIntents.fenceAttempt({
      intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: WORKFLOW_ID, itemId: ITEM_ID },
      attempt: WRITE_ATTEMPT,
    });
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    // Nothing was claimable, so the drain reports idle with no outcomes at all.
    assert.deepEqual(report.outcomes, []);
    assert.equal(report.stopped, "idle");
    assert.ok(
      lines.some((line) => line.includes("orphaned claim routed to ref write-safety recovery")),
      "the startup self-sweep did not report the recovery routing",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "parked-write");
    assert.equal(run.lifecycle.writeIntentId, WRITE_INTENT_ATTEMPTING.writeIntentId);
    assert.equal(run.envelope.attempt, 1, "a parked write must never take a new attempt");
  });

  it("stops gracefully mid-run: the run is abandoned, never terminalized over a lost claim", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    let started: (() => void) | undefined;
    const driverStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          started?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const stop = new AbortController();

    const running = composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, stopSignal: stop.signal, poolIndex: POOL_INDEX_1,
    }));
    await Promise.race([driverStarted, running.then(() => { throw new Error("worker settled before driver start"); })]);
    stop.abort(new Error("operator pressed Ctrl-C"));
    const report = await running;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["abandoned"]);
    // The interrupted lease was poison-closed, and the worker-stop sweep found
    // nothing left to close — an uncertain lease is never silently reused.
    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state !== "terminal");
    const lease = database.authority.workerLeases.get(phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
  });

  it("fails loud when worker-stop cannot prove closure, and records the lease as crashed", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const unprovable: SessionFactoryHarness = {
      ...sessions,
      factory: {
        open: async (input) => {
          const resource = await sessions.factory.open(input);
          return {
            ...resource,
            // A hung/unprovable teardown: the factory contract says an
            // unproven close THROWS, and the manager's poison rule keeps the
            // resource registered rather than believing cleanup succeeded.
            close: () => Promise.reject(new Error(
              `${resource.system} context did not close within its bounded deadline`,
            )),
          };
        },
      },
    };

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: unprovable, poolIndex: POOL_INDEX_1,
      })),
      (error: unknown) => error instanceof AggregateError
        && error.errors.some((failure: unknown) => failure instanceof Error
          && /did not close within its bounded deadline/.test(failure.message)),
    );

    const database = reopen(stateRoot, clock);
    const lease = database.authority.workerLeases.get(phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID)));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    // An unprovable teardown is a crash, never a clean shutdown.
    assert.equal(lease.lifecycle.reason, "crashed");
  });

  it("starts a NEW lease generation over a settled one and drains normally", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    const seed = reopen(stateRoot, clock);
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 7,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "operator" },
      now: NOW,
    }).state, "applied");

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
  });
});

describe("D331 settings apply during a production worker claim", () => {
  it.each(["protected", "ordinary"] as const)("%s apply preserves the active run and permits the next retained run", async (kind) => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const database = reopen(stateRoot, clock);
    const spans = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
    const queued = database.authority.runs.get(RUN_ID); assert.ok(queued);
    spans.emit(runQueuedSpanEvent({ run: queued, actorId: ActorIdSchema.parse("local-operator"), title: "Synthetic claim fixture" }));
    const credentials = createCredentialStore({ stateRoot });
    const { kernel } = kernelHarness({ database, clock, settings: createSettingsApplicationExecutor(
      (settings) => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }), credentials) });
    const source = createCredentialSecretSource(credentials);
    const applyProtected = (value: string, revision: number) => kernel.execute({
      commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface",
      family: "settings", type: "apply-protected-settings", target: { expectedRevision: revision },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: nextCommandId(), entries: { timekeeperName: { set: value } } },
    });
    assert.equal(applyProtected("Synthetic Initial Keeper", 1).state, "applied");
    const gate = Promise.withResolvers<void>();
    const arrived = Promise.withResolvers<void>();
    const sessions = happySessionHarness();
    const heldSessions = { ...sessions, factory: { open: async (...args: Parameters<typeof sessions.factory.open>) => {
      arrived.resolve(); await gate.promise; return sessions.factory.open(...args);
    } } };
    const worker = composeWorkerRuntime(composeInput({ repoRoot, clock, sessions: heldSessions, poolIndex: POOL_INDEX_1 }));
    // Observe failure promptly while the first run is held at its session boundary.
    const settled = worker.then((report) => ({ report }), (error: unknown) => ({ error }));
    try {
      await Promise.race([arrived.promise, settled.then(() => { throw new Error("worker settled before claim barrier"); })]);
      const run = database.authority.runs.get(RUN_ID); assert.ok(run);
      assert.ok(run.claimGeneration > 0);
      const active = database.authority.runtimeConfig.get(); assert.ok(active);
      const token = RuntimeConfigClaimTokenSchema.parse({ generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint });
      const waitingId = "ffffffff-0001-4000-8000-000000000001";
      if (kind === "ordinary") {
        const waiting = RunRecordSchema.parse(personLookupQueuedRun({ runId: waitingId, itemId: "ffffffff-0002-4000-8000-000000000001" }));
        waiting.envelope.configSnapshotId = queued.envelope.configSnapshotId;
        waiting.envelope.configFingerprint = queued.envelope.configFingerprint;
        waiting.envelope.traceId = TraceIdSchema.parse("pl-170000-9999");
        assert.equal(database.authority.runs.enqueue(waiting).state, "inserted");
        spans.emit(runQueuedSpanEvent({ run: waiting, actorId: ActorIdSchema.parse("local-operator"), title: "Synthetic waiting fixture" }));
      }
      const waitingBefore = database.authority.runs.get(waitingId);
      const epoch = database.authority.settingsCurrent.get();
      const snapshot = database.authority.configSnapshots.get(active.configSnapshotId);
      assert.equal(source.read().entries.timekeeperName?.value, "Synthetic Initial Keeper");
      const result = kind === "protected" ? applyProtected("Synthetic Rotated Keeper", 2) : (() => {
        const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
        return kernel.execute({ commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface",
          family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
          payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
      })();
      assert.equal(result.state, "applied");
      if (kind === "protected") {
        assert.deepEqual(database.authority.runtimeConfig.get(), active);
        assert.deepEqual(database.authority.runtimeConfig.requireActive({ settingsRevision: active.settingsRevision,
          settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint }), token);
      } else {
        assert.equal(database.authority.runtimeConfig.matchesClaim(token), false, "old authorization is fenced");
        assert.equal(database.authority.runtimeConfig.get()?.generation, active.generation + 1);
      }
      assert.deepEqual(database.authority.configSnapshots.get(active.configSnapshotId), snapshot);
      assert.deepEqual(database.authority.runs.get(RUN_ID), run);
      if (kind === "protected") {
        assert.deepEqual(database.authority.settingsCurrent.get(), epoch);
        assert.equal(source.read().entries.timekeeperName?.value, "Synthetic Rotated Keeper");
      } else assert.notDeepEqual(database.authority.settingsCurrent.get(), epoch);
      gate.resolve();
      const outcome = await settled;
      const terminal = database.authority.runs.get(RUN_ID)?.lifecycle;
      assert.ok(terminal?.state === "terminal");
      assert.equal(terminal.outcome, "done");
      if (kind === "protected") {
        if ("error" in outcome) throw outcome.error;
        assert.ok("report" in outcome);
        assert.deepEqual(outcome.report.outcomes.map(({ state }) => state), ["done"]);
      } else {
        if ("error" in outcome) throw outcome.error;
        assert.ok("report" in outcome);
        assert.deepEqual(outcome.report.outcomes.map(({ state }) => state), ["done", "done"]);
        const waitingAfter = database.authority.runs.get(waitingId);
        assert.equal(waitingAfter?.lifecycle.state, "terminal");
        assert.deepEqual(waitingAfter?.envelope, waitingBefore?.envelope);
        const next = database.authority.runtimeConfig.get(); assert.ok(next);
        assert.equal(database.authority.configSnapshots.get(next.configSnapshotId)?.config.timeouts.taskMs, 240_000);
      }
    } finally { gate.resolve(); await settled; }
  });
});

describe("worker composition helpers", () => {
  it("schedules real monotonic deadlines and cancels them", async () => {
    const clock = manualClock(new Date(NOW));
    const scheduler = createTimeoutDeadlineScheduler(clock);
    const fired: string[] = [];
    const handle = scheduler.schedule(clock.monotonicMs() + 5_000, () => fired.push("late"));
    scheduler.schedule(clock.monotonicMs(), () => fired.push("now"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    handle.cancel();
    assert.deepEqual(fired, ["now"]);
  });

  it("logs structured lines rather than console output", () => {
    const clock = manualClock(new Date(NOW));
    const lines: string[] = [];
    lineTaskLogger((line) => lines.push(line), clock).warn("something", { runId: RUN_ID });
    assert.deepEqual(JSON.parse(lines[0] ?? ""), {
      ts: NOW,
      level: "warn",
      message: "something",
      runId: RUN_ID,
    });
  });
});

/* ── the kernel's SYNCHRONOUS Phase-1 worker-browser arms ────────────────── */

/**
 * The dashboard composition adopted the async pool seam as of W3 (see
 * `tests/unit/server/worker-pool-composition.test.ts` for the composed
 * truth). The synchronous Phase-1 seam remains the kernel's contract for a
 * composition WITHOUT a process supervisor, and this refusing supervisor pins
 * its fail-loud shape: a spawn effect nobody can perform refuses by name and
 * unwinds the whole command.
 */
function refusingWorkerSupervisor(): WorkerProcessSupervisor {
  return Object.freeze({
    spawnWorker: (input: Readonly<{ workflowId: string; workerId: string }>): never => {
      throw new Error(
        `this composition does not launch browser workers; start worker ${input.workerId} with: `
        + `npm run cli worker ${input.workflowId} --pool-index <positive-int>`,
      );
    },
  });
}

function kernelHarness(existing?: { database: AuthorityDatabase; clock: TestClock;
  settings: ReturnType<typeof createSettingsApplicationExecutor> }): { database: AuthorityDatabase; kernel: CommandKernel; clock: TestClock } {
  const root = mkdtempSync(join(tmpdir(), "hrauto-worker-arms-"));
  roots.push(root);
  const clock = existing?.clock ?? manualClock(new Date(NOW));
  const database = existing?.database ?? AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  if (existing === undefined) openDatabases.push(database);
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors: {
      resolve: (workflowId) => DESCRIPTORS.find((descriptor) => String(descriptor.id) === workflowId),
    },
    writeResolution: {
      resolvePresent: () => {
        throw new Error("unused in this suite");
      },
      resolveAbsent: () => {
        throw new Error("unused in this suite");
      },
    },
    workerRuntime: createPhase1WorkerRuntimeExecutor(refusingWorkerSupervisor()),
    ...(existing === undefined ? {} : { settings: existing.settings }),
  });
  return { database, kernel, clock };
}

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `cccccccc-${tail}-4000-8000-${tail}00000000`;
}

function envelope(commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

describe("dashboard-composed worker-browser command arms", () => {
  it("applies the wired arms: a one-worker plan and durable lease directives", () => {
    const harness = kernelHarness();
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));

    // D269: the pool version is the CAS basis — 0 for a workflow nobody has
    // planned; the applied plan creates the row at version 1.
    const planned = harness.kernel.execute({
      ...envelope(),
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 0 },
      payload: { desiredWorkers: 1 },
    });
    assert.equal(planned.state, "applied");
    assert.deepEqual(planned.affectedTargets, [
      { family: "worker-pool", workflowId: WORKFLOW_ID },
      { family: "worker-browser", workerId },
    ]);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID)?.version, 1);
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID)?.desiredWorkers, 1);

    assert.equal(harness.database.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 11,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    const paused = harness.kernel.execute({
      ...envelope(),
      type: "pause-worker",
      target: { workerId, expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } },
    });
    assert.equal(paused.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "pause");

    const stopped = harness.kernel.execute({
      ...envelope(),
      type: "stop-worker",
      target: { workerId, expectedVersion: 2, controlBasis: { leaseGeneration: 1, controlRevision: 2 } },
    });
    assert.equal(stopped.state, "applied");
    assert.equal(harness.database.authority.workerLeases.get(workerId)?.control.directive, "stop");
  });

  it("refuses a plan for more than one worker, unwinding the whole command", () => {
    const harness = kernelHarness();
    const commandId = nextCommandId();
    assert.throws(
      () => harness.kernel.execute({
        ...envelope(commandId),
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 0 },
        payload: { desiredWorkers: 3 },
      }),
      /exactly one worker per workflow/,
    );
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    // D269: the runtime's refusal unwinds the pool write with the command —
    // no declaration of 3 workers survives a count the runtime refused.
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID), undefined);
  });

  it("refuses a spawn the composed supervisor cannot perform, unwinding the whole command", () => {
    const harness = kernelHarness();
    const commandId = nextCommandId();
    assert.throws(
      () => harness.kernel.execute({
        ...envelope(commandId),
        type: "spawn-worker",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 0 },
        payload: { workerId: EXECUTOR_WORKER_ID },
      }),
      /does not launch browser workers.*cli worker person-lookup/s,
    );
    // A thrown supervisor error unwinds the command: no journal row, no lease.
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.workerLeases.get(EXECUTOR_WORKER_ID), undefined);
  });

  it("keeps refresh/reopen browser unavailable rather than acknowledging a non-effect", () => {
    const harness = kernelHarness();
    const workerId = phase1WorkerId(WorkflowIdSchema.parse(WORKFLOW_ID));
    assert.equal(harness.database.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 12,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");

    for (const type of ["refresh-browser", "reopen-browser"] as const) {
      const commandId = nextCommandId();
      assert.throws(
        () => harness.kernel.execute({
          ...envelope(commandId),
          type,
          target: { workerId, controlBasis: { leaseGeneration: 1, controlRevision: 1 }, browserSessionId: UUID_7, expectedVersion: 1 },
        }),
        /requires the 1g browser supervisor/,
      );
      assert.equal(harness.database.authority.commands.get(commandId), undefined);
    }
  });
});


it("F live worker selects the claim token after a later activation", async () => {
 const { repoRoot, stateRoot } = repoRootWithState();
 const clock = manualClock(new Date(NOW));
 seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
 let database: AuthorityDatabase | undefined;
 let advanced = false;
 await composeWorkerRuntime({ ...composeInput({ repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1 }),
  openDatabase: (options, openClock) => { database = AuthorityDatabase.open(options, openClock); return database; },
  afterClaimAdmissionCheck: () => {
   assert.ok(database !== undefined);
   if (advanced) return;
   const active = database.authority.runtimeConfig.get();
   assert.ok(active !== undefined);
   const { generation: _generation, ...activation } = active;
   database.authority.runtimeConfig.activate(activation);
   advanced = true;
  },
 });
 assert.equal(advanced, true);
 assert.equal(reopen(stateRoot, clock).authority.runs.get(RUN_ID)?.lifecycle.state, "terminal");
});


it("F composed dashboard reads active settings after boot through real HTTP", async () => {
 const { repoRoot, stateRoot } = repoRootWithState();
 const clock = manualClock(new Date(NOW));
 for (const name of ["package.json", "package-lock.json"])
  writeFileSync(join(repoRoot, name), readFileSync(join(process.cwd(), name)));
 const dashboard = await composeDashboardRuntime({ admission: installationAdmission(repoRoot), isolation: rebuildRuntimeIsolation, repoRoot, env: {}, clock,
  backendPortOverride: 0, frontendPortOverride: 0 });
 try {
  const database = reopen(stateRoot, clock);
  const before = database.authority.runtimeConfig.get();
  assert.ok(before !== undefined);
  const snapshot = database.authority.configSnapshots.get(before.configSnapshotId);
  assert.ok(snapshot !== undefined);
  const settings = persistUnjournaledWorkerSettings(repoRoot, clock, { display: { screenWidth: 1980, screenHeight: 1080 } });
  journalWorkerSettings(database, settings, stateRoot);
  const record = readSettings(database.authority);
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") });
  database.authority.configSnapshots.insert({ configSnapshotId: UUID_7, revision: 1,
   fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance,
   capturedAt: NOW, capturedBy: "local-operator" });
  database.authority.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
   configSnapshotId: UUID_7, configFingerprint: resolved.fingerprint, activatedAt: NOW });
  const response = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/editable`);
  assert.equal(response.status, 200);
  const editor = EditableSettingsWireSchema.parse(await response.json());
  assert.equal(editor.runtimeStatus.state, "current");
  assert.equal(editor.revision, record.revision);
  // Facts must follow the active snapshot as well; a synthetic endpoint is never contacted.
  const config = structuredClone(resolved.config);
  config.urls.crm.prod.entry = "https://synthetic.example.invalid/";
  const nextId = "83000000-0000-4000-8000-000000000098";
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
  database.authority.configSnapshots.insert({ ...snapshot, configSnapshotId: nextId, config, fingerprint });
  database.authority.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
   configSnapshotId: nextId, configFingerprint: fingerprint, activatedAt: NOW });
  const factsResponse = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/facts`);
  assert.equal(factsResponse.status, 200);
  const facts = SettingsFactsWireSchema.parse(await factsResponse.json());
  assert.equal(facts.systemHosts.find(entry => entry.system === "crm")?.production, "https://synthetic.example.invalid/");
 } finally { await dashboard.stop(); }
});
