import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createWorkerCompositionTestWorld } from "../../../support/helpers/backend/worker-composition-world.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createCredentialSecretSource } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../src/models/config/runtime-generation.js";
import { ActorIdSchema, TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";

import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { composeWorkerRuntime, createTimeoutDeadlineScheduler, lineTaskLogger } from "../../../../src/backend/app/composition/worker-compose.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createCommandKernel, type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createWorkerPoolRuntimeExecutor, type WorkerPoolProcessSupervisor, type WorkerSupervisorRequest } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, WORKFLOW_ID, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/admission-fixture.js";
import { happySessionHarness, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const {NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, workerLifetime, ensureBaselineRuntimeConfig, composeInput, cleanup } = createWorkerCompositionTestWorld();


afterEach(cleanup);

describe("settings apply during a production worker claim", () => {
  it.each(["protected", "ordinary"] as const)("%s apply preserves the active run and permits the next retained run", async (kind) => {
    const { repoRoot, stateRoot } = await repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const database = reopen(stateRoot, clock);
    const spans = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
    const queued = database.authority.runs.get(RUN_ID); assert.ok(queued);
    const credentials = createCredentialStore({ stateRoot });
    const { kernel } = await kernelHarness({ database, clock, settings: createSettingsApplicationExecutor(
      (settings) => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: join(stateRoot, "artifacts") }), credentials) });
    const source = createCredentialSecretSource(credentials);
    const applyProtected = (value: string, revision: number) => kernel.execute({
      commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface",
      family: "settings", type: "apply-protected-settings", target: { expectedRevision: revision },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: nextCommandId(), entries: { timekeeperName: { set: value } } },
    });
    const protectedBaseline = credentials.read().revision;
    const ordinaryBaseline = readSettings(database.authority).revision;
    assert.equal(applyProtected("Synthetic Initial Keeper", protectedBaseline).state, "applied");
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
      const result = kind === "protected" ? applyProtected("Synthetic Rotated Keeper", protectedBaseline + 1) : (() => {
        const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
        return kernel.execute({ commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface",
          family: "settings", type: "apply-settings", target: { expectedRevision: ordinaryBaseline },
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




function refusingWorkerSupervisor(): WorkerPoolProcessSupervisor {
  return Object.freeze({
    execute: (request: WorkerSupervisorRequest) => {
      if (request.command === "plan-worker-count") return { command: request.command,
        state: "acknowledged", desiredWorkers: request.desiredWorkers,
        members: request.members.map(member => ({ member, stage: "unmet", reason: "not-started" })) };
      if (request.command === "pause-worker") return { command: request.command,
        state: "acknowledged", member: request.member, ownership: "external", stage: "pause-requested" };
      if (request.command === "stop-worker") return { command: request.command,
        state: "acknowledged", member: request.member, ownership: "external",
        escalation: request.escalation,
        observed: [{ stage: "graceful-stop-requested", at: request.directive.requestedAt }] };
      throw new Error(request.command === "spawn-worker"
        ? "this composition does not launch browser workers; cli worker person-lookup"
        : "browser supervisor unavailable");
    },
  });
}

async function kernelHarness(existing?: { database: AuthorityDatabase; clock: TestClock;
  settings: ReturnType<typeof createSettingsApplicationExecutor> }): Promise<{ database: AuthorityDatabase; kernel: CommandKernel; clock: TestClock; stateRoot?: string }> {
  const clock = existing?.clock ?? manualClock(new Date(NOW));
  let database: AuthorityDatabase;
  let ownedStateRoot: string | undefined;
  if (existing === undefined) {
    const { repoRoot, stateRoot } = await repoRootWithState();
    ownedStateRoot = stateRoot;
    ensureBaselineRuntimeConfig(repoRoot, clock);
    database = reopen(stateRoot, clock);
  } else database = existing.database;
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
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
    workerRuntime: { pool: createWorkerPoolRuntimeExecutor(refusingWorkerSupervisor(), database.authority.workerSlots) },
    ...(existing === undefined ? {} : { settings: existing.settings }),
  });
  return { database, kernel, clock, ...(ownedStateRoot === undefined ? {} : { stateRoot: ownedStateRoot }) };
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
  async function plan(harness: Awaited<ReturnType<typeof kernelHarness>>, desiredWorkers = 1) {
    return harness.kernel.executeWorkerPool({ ...envelope(), type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers } });
  }
  it.each(["pause-worker", "stop-worker"] as const)("refuses %s for an external member without changing its directive", async type => {
    const harness = await kernelHarness();
    const planned = await plan(harness);
    assert.equal(planned.state, "applied");
    const slot = harness.database.authority.workerSlots.list(WORKFLOW_ID)[0]; assert.ok(slot);
    assert.deepEqual(planned.affectedTargets, [{ family: "worker-pool", workflowId: WORKFLOW_ID },
      { family: "worker-browser", workerId: slot.workerId }]);
    assert.ok(harness.stateRoot);
    const lifetime = await workerLifetime(harness.stateRoot, harness.clock, slot.workerId);
    try {
      const lease = harness.database.authority.workerLeases.get(slot.workerId); assert.ok(lease);
      const commandId = nextCommandId();
      const command = { ...envelope(commandId), type,
        target: { workerId: slot.workerId, expectedVersion: lease.version,
          ...(type === "stop-worker" ? { membershipRevision: slot.membershipRevision } : {}),
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } };
      if (type === "stop-worker") {
        const result = await harness.kernel.executeWorkerPool(command);
        assert.equal(result.state, "rejected");
        assert.ok(result.state === "rejected");
        assert.match(result.message, /worker-reset-owner-unavailable/u);
        assert.equal(harness.database.authority.commands.get(commandId), undefined);
        assert.equal(harness.database.authority.workerControls.get(commandId), undefined);
      } else {
        await assert.rejects(harness.kernel.executeWorkerPool(command), /mutating control requires durable supervisor ownership/u);
        assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
      }
      assert.deepEqual(harness.database.authority.workerLeases.get(slot.workerId)?.control, lease.control);
      assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    } finally { await lifetime.close(); }
  });
  it("admits three native members without asserting they have started", async () => {
    const harness = await kernelHarness();
    const result = await plan(harness, 3);
    assert.equal(result.state, "applied");
    assert.equal(harness.database.authority.workerPools.get(WORKFLOW_ID)?.desiredWorkers, 3);
    assert.equal(harness.database.authority.workerSlots.list(WORKFLOW_ID).length, 3);
    assert.ok(harness.database.authority.workerSlots.list(WORKFLOW_ID)
      .every(slot => harness.database.authority.workerLeases.get(slot.workerId) === undefined));
  });
  it("retains uncertain spawn evidence when the composed supervisor throws", async () => {
    const harness = await kernelHarness(); await plan(harness);
    const slot = harness.database.authority.workerSlots.list(WORKFLOW_ID)[0]; assert.ok(slot);
    const commandId = nextCommandId();
    await assert.rejects(harness.kernel.executeWorkerPool({ ...envelope(commandId), type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 }, payload: { workerId: slot.workerId } }),
      /does not launch browser workers.*cli worker person-lookup/s);
    assert.ok(harness.database.authority.commands.get(commandId));
    assert.equal(harness.database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
    assert.equal(harness.database.authority.workerLeases.get(slot.workerId), undefined);
  });
  it("keeps refresh and reopen unavailable without acknowledging a browser effect", async () => {
    const harness = await kernelHarness(); await plan(harness);
    const slot = harness.database.authority.workerSlots.list(WORKFLOW_ID)[0]; assert.ok(slot);
    assert.ok(harness.stateRoot);
    const lifetime = await workerLifetime(harness.stateRoot, harness.clock, slot.workerId);
    try {
      for (const type of ["refresh-browser", "reopen-browser"] as const) {
        const commandId = nextCommandId();
        const lease = harness.database.authority.workerLeases.get(slot.workerId); assert.ok(lease);
        const result = await harness.kernel.executeWorkerPool({ ...envelope(commandId), type,
          target: { workerId: slot.workerId,
            controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision },
            browserSessionId: UUID_7, expectedVersion: lease.version } });
        assert.equal(result.state, "rejected");
        assert.ok(result.state === "rejected");
        assert.match(result.message, /worker-browser-session-unavailable/u);
        assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
      }
    } finally { await lifetime.close(); }
  });
});

it("F live worker selects the claim token after a later activation", async () => {
 const { repoRoot, stateRoot } = await repoRootWithState();
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
