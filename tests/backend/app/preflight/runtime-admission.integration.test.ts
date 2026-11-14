import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import { PREFERENCES_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { randomUUID } from "node:crypto";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { createProfileFixtureSet, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { admitFixtureSlot, testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { default as assert } from "node:assert/strict";
import fs, { renameSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterAll, it, vi } from "vitest";
import { composeWorkerPool } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { scriptedWorkerSpawner, type ScriptedWorkerChild } from "../../../support/helpers/backend/fake-worker-port.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { doctorAuthorityStorage, StorageDoctorObservationChangedError } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { composeRuntimePreflight } from "../../../../src/backend/app/preflight/runtime-admission.js";
import { createRuntimePreflightRunners } from "../../../../src/backend/app/preflight/runtime-runners.js";
import { claimWithPreflight, preflightSessionFactory } from "../../../../src/backend/app/preflight/worker-admission.js";
import { createCommandKernel, type CommandKernelDependencies } from "../../../../src/backend/runs/commands/command-kernel.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { workflowPreflightScope } from "../../../../src/backend/runs/start/preflight-scope.js";
import { createPreflightReportService } from "../../../../src/backend/runtime/preflight/report-service.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord, PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { requiredPreflightChecks, type PreflightRunner, type PreflightRunnerContext } from "../../../../src/models/preflight/preflight.js";
import { type RuntimeCapability } from "../../../../src/models/preflight/preflight-contract.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { ActorIdSchema, FingerprintSchema, WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { PreflightAdmissionRefusal, PreflightAdmissionScopeSchema, PreflightObservationChangedError } from "../../../../src/rules/preflight/preflight-admission.js";
import { PreflightRunnerTimeoutError } from "../../../../src/models/preflight/preflight.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createPreflightHarness, healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { populatedProtectedRecord, runtimeFixture } from "../../../support/fixtures/preflight/runtime-fixture.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { sessionsFromDay } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { sessionCommandEffect } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";
import { AuthorityBackupService, AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase as StoreDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

/** A blocked claim refusal names each failing check with its value-free detector summary. */
function assertBlockedRefusal(result: unknown, runId: string): void {
  assert.ok(typeof result === "object" && result !== null && "summary" in result && typeof result.summary === "string", JSON.stringify(result));
  const { summary, ...refusal } = result;
  assert.deepEqual(refusal, { state: "preflight-refused", code: "PREFLIGHT_BLOCKED", runId });
  assert.match(summary, /^[a-z0-9-]+(?:\.[a-z0-9-]+)+: \S/u);
}


{

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const cleanup: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); };
const signal = (): AbortSignal => new AbortController().signal;
async function harness(configureRunners?: (runners: readonly PreflightRunner[]) => readonly PreflightRunner[]) {
  const profile = await profileFixtures.create();
  const repoRoot = profile.workspace, stateRoot = profile.stateRoot;
  const clock = manualClock(new Date("2026-09-19T12:00:00Z"));
  const database = AuthorityDatabase.open({ path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "preflight-test" }, clock);
  cleanup.push(async () => {
    releaseSeededWriteOwners(database, clock.now().toISOString());
    database.close();
    await profile.close();
  });
  const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock,
    { stateRoot, artifactRoot: profile.admission.artifactRoot });
  const identity = { configSnapshotId: "66666666-6666-4666-8666-666666666666", configFingerprint: resolved.fingerprint };
  database.authority.runtimeConfig.initialize({ ...PREFERENCES_SNAPSHOT, configSnapshotId: identity.configSnapshotId, fingerprint: resolved.fingerprint,
    config: resolved.config, provenance: resolved.provenance, revision: 1, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
  let protectedRecord = initialProtectedStoreRecord();
  const faults = new Set<string>(); const probes: string[] = []; let supportMissing = false;
  const freshPreflight = () => composeRuntimePreflight({ admission: profile.admission, credentials: boundProfileCredentials(profile.admission),
    database, clock, repoRoot, isolation: rebuildRuntimeIsolation, descriptors,
    descriptorSetHash: personLookupDescriptor.contractFingerprint, protectedSecrets: { read: () => protectedRecord }, environment: {},
    runnerFactory: input => {
      const available = healthyRuntimePreflightRunners(input);
      const missing = supportMissing ? createRuntimePreflightRunners(input).find(runner => runner.check === "browser.assets") : undefined;
      const controlled = available.map(runner => missing !== undefined && runner.check === "browser.assets" ? missing : ({ ...runner, async run(context: PreflightRunnerContext) {
        probes.push(runner.check);
        return faults.has(runner.check) ? { check: runner.check, state: "unhealthy" as const, summary: "Controlled dependency unavailable", impact: "Selected work cannot use it" } : runner.run(context);
      } }));
      return configureRunners?.(controlled) ?? controlled;
    } });
  const preflight = freshPreflight();
  let publications = 0;
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("b"), publishQueued: () => { publications += 1; },
    admitQueuedRun: run => preflight.admission.assertReady(preflight.runScope(run.envelope)) });
  const plans = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock, ids: sequentialIdFactory("a"),
    planTtlMs: 600_000, ...identity, plannedBy: "local-operator", preflight: preflight.admission });
  const unexpected = (): never => { throw new Error("Unexpected unrelated effect"); };
  let authorityDepth = 0;
  const kernelDependencies: CommandKernelDependencies = { lifecycle, authority: { withAuthorityTransaction: work => database.withAuthorityTransaction(repositories => {
    authorityDepth++;
    try { return work(repositories); } finally { authorityDepth--; }
  }) }, clock, ids: sequentialIdFactory("c"), appVersion: "0.1.0", descriptors,
    preflight: preflight.admission, configIdentity: identity, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock,
      { stateRoot, artifactRoot: profile.admission.artifactRoot }), createCredentialStore({ stateRoot })),
    writeResolution: { recheck: unexpected, resolveAbsent: unexpected },
    workerRuntime: { pool: unusedWorkerPool(unexpected) } };
  const kernel = createCommandKernel(kernelDependencies);
  let capacityCalls = 0, projections = 0;
  const serviceWithKernel = (kernel: ReturnType<typeof createCommandKernel>) => createDashboardCommandService({ kernel, projection: { ingestFromTimeline: () => { projections++; }, refreshRun: unexpected },
    startWorkerCapacity: { workflowOf: () => personLookupDescriptor.id, ensure: async () => { capacityCalls++; },
      detach: work => { void work; }, startupPending: () => false } });
  const service = serviceWithKernel(kernel);
  const ingress = { workflowId: personLookupDescriptor.id, submissions: [{ emplId: "10873698" }], dryRun: false };
  const command = (plan: ReturnType<typeof plans.plan>) => ({ commandId: "99999999-9999-4999-8999-999999999999", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  return { service, serviceWithKernel, freshPreflight, get authorityDepth() { return authorityDepth; }, get capacityCalls() { return capacityCalls; }, get projections() { return projections; }, admission: profile.admission, clock, database, stateRoot, repoRoot, identity, preflight, faults, probes, plans, kernel, lifecycle, kernelWithDependencies: (overrides: Partial<CommandKernelDependencies>) => createCommandKernel({ ...kernelDependencies, ...overrides }), kernelWith: (workerRuntime: CommandKernelDependencies["workerRuntime"]) => createCommandKernel({ ...kernelDependencies, workerRuntime }), ingress, command, get publications() { return publications; }, changeProtected() {
    protectedRecord = ProtectedStoreRecordSchema.parse({ ...protectedRecord, revision: 2,
      lastApplied: { commandId: "77777777-7777-4777-8777-777777777777", commandFingerprint: "7".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "88888888-8888-4888-8888-888888888888" } });
  }, missing() { supportMissing = true; } };
}

for (const delayMs of [60_000, 300_000]) it(`Start refreshes readiness through the command service after ${delayMs}ms`, async () => {
  try {
    const h = await harness(); await h.plans.prepare?.(h.ingress, signal());
    const plan = h.plans.plan(h.ingress), command = h.command(plan), probes = h.probes.length;
    h.clock.advanceWall(delayMs); h.clock.advanceMonotonic(delayMs);
    assert.equal((await h.service.submit(command)).state, "applied");
    assert.deepEqual(new Set(h.probes.slice(probes)), new Set(h.probes.slice(0, probes)), "Start repeats every required Preview detector");
    assert.ok(h.probes.length > probes);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.version, plan.expectedVersion + 1);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy?.commandId, command.commandId);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 1);
    assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 1);
    assert.equal(h.publications, 1); assert.equal(h.projections, 1); assert.equal(h.capacityCalls, 1);
    h.faults.add("endpoint.ucpath.prod"); const settledProbes = h.probes.length;
    assert.equal((await h.service.submit(command)).state, "already-applied");
    assert.equal(h.probes.length, settledProbes); assert.equal(h.publications, 1); assert.equal(h.projections, 1);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 1);
    await assert.rejects(h.service.submit({ ...command, requestedAt: h.clock.now().toISOString() }),
      /command id 99999999-9999-4999-8999-999999999999 was reused with different content/u);
    assert.equal(h.probes.length, settledProbes);
  } finally { await _afterEachFixture0(); }
});

for (const fault of ["unhealthy", "throw", "missing", "timeout"] as const) it(`Start freshly refuses a ${fault} detector immediately after Preview and replays without probes`, async () => {
  let armed = false, prepareError: unknown;
  let timeout: PreflightRunnerTimeoutError | undefined;
  try {
    const h = await harness(runners => {
      if (armed && fault === "missing") return runners.filter(runner => runner.check !== "browser.assets");
      return runners.map(runner => runner.check !== "endpoint.ucpath.prod" ? runner : { ...runner, async run(context) {
        if (armed && fault === "throw") throw new Error("controlled Start detector failure");
        if (armed && fault === "timeout") { timeout = new PreflightRunnerTimeoutError(runner.check, context.timeoutMs); throw timeout; }
        return runner.run(context);
      } });
    });
    await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress), command = h.command(plan);
    armed = true; if (fault === "unhealthy") h.faults.add("endpoint.ucpath.prod");
    // Keep Preview evidence intact while Start preparation sees the missing detector.
    const admission = fault === "missing" ? h.freshPreflight().admission : h.preflight.admission;
    const service = h.serviceWithKernel(h.kernelWithDependencies({ preflight: { ...h.preflight.admission, async prepare(scope, operationSignal) {
      try { return await admission.prepare(scope, operationSignal); } catch (error) { prepareError = error; throw error; }
    } } }));
    const result = await service.submit(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") {
      assert.equal(result.code, fault === "unhealthy" ? "RUN_START_READINESS_BLOCKED" : fault === "timeout" ? "PREFLIGHT_TIMEOUT" : "RUN_START_READINESS_UNAVAILABLE");
      if (fault === "missing") {
        assert.ok(prepareError instanceof Error);
        assert.match(prepareError.message, /no runner for selected checks: browser\.assets/u);
      }
      if (fault === "timeout") {
        assert.ok(prepareError instanceof PreflightAdmissionRefusal);
        assert.equal(prepareError.cause, timeout, "the refused detector preserves its original timeout cause");
      }
    }
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(command.commandId)?.result, result);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.publications, 0); assert.equal(h.projections, 0); assert.equal(h.capacityCalls, 0);
    const probes = h.probes.length;
    armed = false; h.faults.clear();
    assert.deepEqual(await service.submit(command), result);
    await assert.rejects(service.submit({ ...command, source: "other-source" }),
      /command id 99999999-9999-4999-8999-999999999999 was reused with different content/u);
    assert.equal(h.probes.length, probes); assert.equal(h.publications, 0); assert.equal(h.capacityCalls, 0);
  } finally { await _afterEachFixture0(); }
});

for (const reason of ["stale", "observation-changed", "unavailable", "scope-mismatch"] as const) it(`Start maps typed ${reason} admission refusal without enqueue effects`, async () => {
  try {
    const h = await harness(); await h.plans.prepare?.(h.ingress, signal());
    const plan = h.plans.plan(h.ingress), command = h.command(plan);
    const service = h.serviceWithKernel(h.kernelWithDependencies({ preflight: { ...h.preflight.admission,
      async prepare() { throw new PreflightAdmissionRefusal(reason, "PRIVATE_TYPED_REFUSAL"); } } }));
    const reply = await service.submit(command);
    assert.equal(reply.state, "rejected");
    if (reply.state === "rejected") {
      assert.equal(reply.code, reason === "stale" || reason === "observation-changed" ? "RUN_START_READINESS_CHANGED" : "RUN_START_READINESS_UNAVAILABLE");
      assert.equal(reply.message, "PRIVATE_TYPED_REFUSAL");
    }
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(command.commandId)?.result, reply);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.publications, 0); assert.equal(h.capacityCalls, 0);
  } finally { await _afterEachFixture0(); }
});

it("overlapping service Starts consume a retained plan once", async () => {
  try {
    const h = await harness(); await h.plans.prepare?.(h.ingress, signal());
    const plan = h.plans.plan(h.ingress), command = h.command(plan);
    let projections = 0;
    const service = createDashboardCommandService({ kernel: h.kernel, projection: { ingestFromTimeline: () => { projections++; },
      refreshRun: () => { throw new Error("unexpected projection"); } } });
    const probes = h.probes.length;
    const results = await Promise.all([service.submit(command), service.submit(command),
      service.submit({ ...command, commandId: randomUUID() })]);
    assert.deepEqual(results.slice(0, 2).map(result => result.state), ["applied", "already-applied"]);
    assert.ok(results[2].state === "rejected" || results[2].state === "conflict");
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.version, plan.expectedVersion + 1);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 1);
    assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 1);
    assert.equal(h.publications, 1); assert.equal(projections, 1);
    assert.equal(h.probes.length, probes * 2, "only the first command prepares; exact replay and spent-plan refusal do not probe");
  } finally { await _afterEachFixture0(); }
});

for (const change of ["settings", "protected-revision"] as const) it(`Start refuses ${change} changed while readiness preparation awaits`, async () => {
  let armed = false, release: () => void = () => undefined, completed: Promise<unknown> | undefined;
  let entered: () => void = () => undefined, detectorSignal: AbortSignal | undefined;
  const preview = new AbortController();
  const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  try {
    const h = await harness(runners => runners.map(runner => runner.check !== "endpoint.ucpath.prod" ? runner : { ...runner, async run(context) {
      if (armed) { detectorSignal = context.signal; entered(); await held; }
      return runner.run(context);
    } }));
    await h.plans.prepare?.(h.ingress, preview.signal); const plan = h.plans.plan(h.ingress), command = h.command(plan);
    armed = true; const operation = h.service.submit(command); completed = operation;
    await reached;
    assert.equal(h.authorityDepth, 0, "no kernel authority transaction spans the detector await");
    assert.ok(detectorSignal);
    assert.notEqual(detectorSignal, preview.signal);
    preview.abort(new Error("Preview request disconnected after dispatch"));
    assert.equal(detectorSignal.aborted, false, "the admitted operation owns its detector signal");
    assert.ok(h.database.authority.commands.get(command.commandId), "admission commits before detector awaits");
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    if (change === "protected-revision") h.changeProtected();
    else {
      const patch = { "browser.headless": { set: false } };
      assert.equal(h.kernel.execute({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
        source: "settings-surface", family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
        payload: { patch, patchFingerprint: deriveSettingsPatchFingerprint(patch), settingsSchemaHash: SETTINGS_SCHEMA_HASH } }).state, "applied");
    }
    release(); const result = await operation;
    assert.equal(result.state, "rejected");
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.publications, 0); assert.equal(h.capacityCalls, 0);
  } finally { release(); await completed; await _afterEachFixture0(); }
});

for (const change of ["profile", "assistant-grant-expiry"] as const) it(`Start revalidates ${change} after awaited readiness before effects`, async () => {
  let armed = false, current = true, release: () => void = () => undefined, completed: Promise<unknown> | undefined;
  let entered: () => void = () => undefined;
  const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const expired = new Error(`controlled ${change} authority expired`);
  try {
    const h = await harness(runners => runners.map(runner => runner.check !== "endpoint.ucpath.prod" ? runner : { ...runner, async run(context) {
      if (armed) { entered(); await held; }
      return runner.run(context);
    } }));
    const expiresAt = h.clock.now().getTime() + 1_000;
    const kernel = h.kernelWithDependencies({
      authority: { withAuthorityTransaction: work => h.database.withAuthorityTransaction(repositories => {
        if (change === "profile" && !current) throw expired;
        const result = work(repositories);
        if (change === "profile" && !current) throw expired;
        return result;
      }) },
      assistantRevalidate: () => { if (change === "assistant-grant-expiry" && h.clock.now().getTime() >= expiresAt) throw expired; },
    });
    let capacity = 0;
    const service = createDashboardCommandService({ kernel,
      projection: { ingestFromTimeline: () => { throw new Error("refused Start must not project"); }, refreshRun: () => { throw new Error("unexpected projection"); } },
      startWorkerCapacity: { workflowOf: () => h.ingress.workflowId, ensure: async () => { capacity++; },
        detach: () => { throw new Error("a refused Start detaches no worker startup"); }, startupPending: () => false } });
    await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress), command = h.command(plan);
    armed = true;
    const operation = service.submit(command).catch((error: unknown) => error); completed = operation;
    await reached;
    assert.ok(h.database.authority.commands.get(command.commandId));
    current = false; h.clock.advanceWall(1_000); h.clock.advanceMonotonic(1_000);
    release(); const error = await operation;
    if (change === "profile") {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [expired, expired], "original authority failure and failed settlement are both preserved");
      assert.equal(error.cause, expired);
    } else assert.equal(error, expired);
    assert.equal(h.database.authority.commands.get(command.commandId)?.commandId, command.commandId);
    assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId), undefined, "unknown authority failure stays admitted and unsettled");
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0);
    assert.equal(h.publications, 0); assert.equal(capacity, 0);
  } finally { release(); await completed; await _afterEachFixture0(); }
});

it("real plan/kernel/lifecycle admits healthy work and exact replay stays read-only after a fault", async () => {
try {

  const h = await harness(); await h.plans.prepare?.(h.ingress, signal());
  const plan = h.plans.plan(h.ingress); const command = h.command(plan);
  assert.equal(h.kernel.execute(command).state, "applied");
  assert.equal(h.publications, 1); assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 1);
  h.faults.add("endpoint.ucpath.prod"); await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId), signal());
  const count = h.probes.length;
  assert.equal(h.kernel.execute(command).state, "already-applied");
  assert.equal(h.probes.length, count); assert.equal(h.publications, 1);

} finally {
await _afterEachFixture0();
}
});

it("required faults and missing detector support prevent plan/enqueue effects", async () => {
try {

  for (const missing of [false, true]) {
    const h = await harness(); if (missing) h.missing(); else h.faults.add("endpoint.ucpath.prod");
    const generation = h.database.getMeta().authorityGeneration;
    await assert.rejects(h.plans.prepare?.(h.ingress, signal()) ?? Promise.reject(new Error("fixture preparation is missing")), PreflightAdmissionRefusal);
    assert.throws(() => h.plans.plan(h.ingress), PreflightAdmissionRefusal);
    assert.equal(h.publications, 0); assert.equal(h.database.authority.runs.listByWorkflow(h.ingress.workflowId).length, 0);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  }

} finally {
await _afterEachFixture0();
}
});

it("a fault after planning refuses confirmation before plan consumption or session creation", async () => {
try {

  const h = await harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  h.faults.add("endpoint.ucpath.prod"); await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId), signal());
  const result = h.kernel.execute(h.command(plan)); assert.equal(result.state, "rejected");
  assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0); assert.equal(h.publications, 0);

} finally {
await _afterEachFixture0();
}
});

it("optional or unselected faults leave unrelated valid scopes usable; instance scopes cannot substitute", async () => {
try {

  const h = await harness(); h.faults.add("provider.census"); h.faults.add("endpoint.ucpath.test");
  await h.plans.prepare?.(h.ingress, signal()); assert.equal(h.kernel.execute(h.command(h.plans.plan(h.ingress))).state, "applied");
  assert.ok(!h.probes.includes("endpoint.ucpath.test"));
  const scope = h.preflight.currentScope(h.ingress.workflowId);
  const optional = { ...scope, requestedCapabilities: [...scope.requestedCapabilities, "provider.census" as RuntimeCapability].sort() };
  const report = await h.preflight.admission.prepare(optional, signal());
  assert.equal(report.results.find(result => result.check === "provider.census")?.status, "warning"); h.preflight.admission.assertReady(optional);
  assert.throws(
    () => h.preflight.admission.assertReady(h.preflight.currentScope(h.ingress.workflowId, { ucpath: "test" })),
    (error: unknown) => error instanceof PreflightAdmissionRefusal && error.reason === "scope-mismatch",
  );

} finally {
await _afterEachFixture0();
}
});

it("wrong fingerprints and divergent scoped reruns refuse before probes; failed and in-flight replay is stable", async () => {
try {

  const h = await harness(); const dashboard = createPreflightHarness(h.clock, h.identity.configFingerprint).authority;
  const service = createPreflightReportService({ dashboard, runtime: h.preflight, clock: h.clock });
  const command = { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight", target: {
    expectedConfigFingerprint: h.identity.configFingerprint, expectedDescriptorFingerprint: personLookupDescriptor.contractFingerprint, selection: { workflowId: personLookupDescriptor.id } } };
  const wrong = { ...command, target: { ...command.target, expectedDescriptorFingerprint: "f".repeat(64) } };
  const first = await service.execute(wrong, signal()).catch((error: unknown) => error);
  assert.ok(first instanceof PreflightAdmissionRefusal); assert.equal(h.probes.length, 0);
  assert.equal(await service.execute(wrong, signal()).catch((error: unknown) => error), first);
  await assert.rejects(service.execute(command, signal()), /divergent/); assert.equal(h.probes.length, 0);
  const next = { ...command, commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
  const [a, b] = await Promise.all([service.execute(next, signal()), service.execute(next, signal())]); assert.deepEqual(a, b);
  const count = h.probes.length; assert.deepEqual(await service.execute(next, signal()), a); assert.equal(h.probes.length, count);
  h.clock.advanceWall(60_000); h.clock.advanceMonotonic(60_000); assert.equal(service.read(command.target.selection).state, "unavailable");

} finally {
await _afterEachFixture0();
}
});

it("leaves the selected run unclaimed when browser preparation refuses, then claims only after preparation completes", async () => {
try {
  const h = await harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
  const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
  const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
    workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
  const request = { commandId: randomUUID(), workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
  const refused = new Error("synthetic browser profile still closing");
  await assert.rejects(claimWithPreflight({ preflight: h.preflight, signal: signal(),
    claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async run => {
      assert.deepEqual(h.database.authority.runs.get(run.envelope.runId), original);
      assert.equal(h.database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
      throw refused;
    } }), error => error === refused);
  assert.deepEqual(h.database.authority.runs.get(original.envelope.runId), original);
  assert.equal(h.database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
  let preparations = 0;
  const claimed = await claimWithPreflight({ preflight: h.preflight, signal: signal(),
    claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async run => {
      preparations++;
      assert.deepEqual(h.database.authority.runs.get(run.envelope.runId), original);
    } });
  assert.equal(preparations, 1); assert.equal(claimed.state, "applied");
} finally { await _afterEachFixture0(); }
});

it("returns a changed observation before browser preparation or claim once every bounded re-preparation changed", async () => {
  let changed = false, observations = 0, preparations = 0;
  const seen: number[] = [];
  try {
    const h = await harness(runners => runners.map(runner => runner.check !== "authority.health" ? runner : {
      ...runner, async run(context) {
        if (changed) { observations++; throw new PreflightObservationChangedError(); }
        return runner.run(context);
      },
    }));
    await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
    const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
      workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const request = { commandId: randomUUID(), workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
    changed = true;
    const result = await claimWithPreflight({ preflight: h.preflight, signal: signal(),
      onObservationChanged: attempt => { seen.push(attempt); },
      claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async () => { preparations++; } });
    assert.deepEqual(result, { state: "preflight-refused", code: "PREFLIGHT_OBSERVATION_CHANGED", runId: original.envelope.runId });
    assert.equal(observations, 4); assert.equal(preparations, 0); assert.deepEqual(seen, [1, 2, 3]);
    assert.deepEqual(h.database.authority.runs.get(original.envelope.runId), original);
    assert.equal(h.database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
  } finally { await _afterEachFixture0(); }
});

it("returns a timeout refusal before browser preparation or claim, and does not throw", async () => {
  let armed = false, observations = 0, preparations = 0;
  try {
    const h = await harness(runners => runners.map(runner => runner.check !== "authority.health" ? runner : {
      ...runner, async run(context) {
        if (armed) { observations++; throw new PreflightRunnerTimeoutError(runner.check, 1_000); }
        return runner.run(context);
      },
    }));
    await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
    const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
      workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const request = { commandId: randomUUID(), workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
    armed = true;
    const result = await claimWithPreflight({ preflight: h.preflight, signal: signal(),
      claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async () => { preparations++; } });
    assert.deepEqual(result, { state: "preflight-refused", code: "PREFLIGHT_TIMEOUT", runId: original.envelope.runId });
    assert.equal(observations, 1); assert.equal(preparations, 0);
    assert.deepEqual(h.database.authority.runs.get(original.envelope.runId), original);
    assert.equal(h.database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
  } finally { await _afterEachFixture0(); }
});

it("claims after three changed observations when the fourth preparation succeeds", async () => {
  let armed = false, observations = 0, preparations = 0;
  const seen: number[] = [];
  try {
    const h = await harness(runners => runners.map(runner => runner.check !== "authority.health" ? runner : {
      ...runner, async run(context) {
        if (armed) { observations++; if (observations <= 3) throw new PreflightObservationChangedError(); }
        return runner.run(context);
      },
    }));
    await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
    const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
      workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const request = { commandId: randomUUID(), workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
    armed = true;
    const result = await claimWithPreflight({ preflight: h.preflight, signal: signal(),
      onObservationChanged: attempt => { seen.push(attempt); },
      claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async () => { preparations++; } });
    assert.equal(result.state, "applied"); assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(observations, 4); assert.equal(preparations, 1);
    assert.equal(h.database.authority.runs.get(original.envelope.runId)?.claimGeneration, 1);
  } finally { await _afterEachFixture0(); }
});

it("returns a refusal for a paused selected run and claims nothing", async () => {
  try {
    const h = await harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
    const paused = h.lifecycle.pause({ commandId: randomUUID(), runId: original.envelope.runId, expectedVersion: original.version });
    assert.ok(paused.state === "applied");
    const result = await claimWithPreflight({ preflight: h.preflight, signal: signal(),
      prepareRun: async () => { throw new Error("paused selection must not prepare"); },
      claim: admit => { admit(paused.run); throw new Error("paused selection must not claim"); } });
    assert.deepEqual(result, { state: "preflight-refused", code: "PREFLIGHT_OBSERVATION_CHANGED", runId: original.envelope.runId });
    const stored = h.database.authority.runs.get(original.envelope.runId); assert.ok(stored);
    assert.equal(stored.claimGeneration, 0); assert.equal(stored.lifecycle.state, "queued");
  } finally { await _afterEachFixture0(); }
});

it("returns a blocked refusal when preparation cannot verify readiness", async () => {
  let armed = false, preparations = 0;
  try {
    const h = await harness(runners => runners.map(runner => runner.check !== "authority.health" ? runner : {
      ...runner, async run(context) {
        if (armed) throw new Error("detector could not verify");
        return runner.run(context);
      },
    }));
    await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
    const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
      workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const request = { commandId: randomUUID(), workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
    armed = true;
    const result = await claimWithPreflight({ preflight: h.preflight, signal: signal(),
      claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async () => { preparations++; } });
    assert.deepEqual(result, { state: "preflight-refused", code: "PREFLIGHT_BLOCKED", runId: original.envelope.runId });
    assert.equal(preparations, 0);
    assert.deepEqual(h.database.authority.runs.get(original.envelope.runId), original);
    assert.equal(h.database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
  } finally { await _afterEachFixture0(); }
});

for (const change of ["selection", "version", "cancel", "abort"] as const) it(`rechecks ${change} changes made during async browser preparation before claiming`, async () => {
  let release: () => void = () => undefined, completed: Promise<unknown> | undefined;
  try {
    const h = await harness(), ingress = { ...h.ingress, priority: "bulk" as const, submissions: [{ emplId: "10873698" }, { emplId: "10000002" }] };
    await h.plans.prepare?.(ingress, signal()); const plan = h.plans.plan(ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const queued = h.database.authority.runs.listByWorkflow(plan.workflowId); assert.equal(queued.length, 2);
    const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
      workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const request = { commandId: randomUUID(), workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
    let entered: () => void = () => undefined;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const prepared: { runId: string; version: number }[] = [], controller = new AbortController();
    const operation = claimWithPreflight({ preflight: h.preflight, signal: controller.signal,
      claim: admit => h.lifecycle.claimNext(request, admit), prepareRun: async run => {
        prepared.push({ runId: run.envelope.runId, version: run.version });
        if (prepared.length === 1) { entered(); await held; }
      } });
    const result = operation.then(value => ({ value }), (error: unknown) => ({ error })); completed = result;
    await started;
    const first = h.database.authority.runs.get(prepared[0].runId); assert.ok(first);
    assert.equal(first.lifecycle.state, "queued"); assert.equal(first.claimGeneration, 0);
    if (change === "abort") controller.abort(new Error("operator stopped during profile preparation"));
    else if (change === "cancel") assert.equal(h.lifecycle.transition({ commandId: randomUUID(), runId: first.envelope.runId,
      expectedVersion: first.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } }).state, "applied");
    else {
      const selected = change === "version" ? first : queued.find(run => run.envelope.runId !== first.envelope.runId); assert.ok(selected);
      assert.equal(h.database.authority.runs.bumpPriority({ runId: selected.envelope.runId, expectedVersion: selected.version,
        now: h.clock.now().toISOString() }).state, "applied");
    }
    release();
    const settled = await result;
    if (change === "abort") { assert.ok("error" in settled); assert.equal(settled.error, controller.signal.reason); }
    else {
      assert.ok("value" in settled); assert.equal(settled.value.state, "applied");
      assert.ok(settled.value.state === "applied");
      const claimed = settled.value.run;
      if (change === "version") {
        assert.equal(claimed.envelope.runId, first.envelope.runId); assert.equal(prepared.length, 2);
        assert.equal(prepared[1].version, first.version + 1);
      } else {
        assert.notEqual(claimed.envelope.runId, first.envelope.runId);
        assert.equal(h.database.authority.runs.get(first.envelope.runId)?.claimGeneration, 0);
        assert.equal(prepared.at(-1)?.runId, claimed.envelope.runId);
      }
    }
  } finally { release(); await completed; await _afterEachFixture0(); }
});

it("claim checks the selected retained run before writing; browser gate refuses a new fault before open", async () => {
try {

  const h = await harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
  const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
  h.clock.advanceWall(60_000); h.clock.advanceMonotonic(60_000); h.faults.add("endpoint.ucpath.prod");
  const { workerId } = testAdmittedWorker(h.database, h.clock, { path: join(h.stateRoot, "state.db"),
    workflow: plan.workflowId, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
  const request = { commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", workflow: plan.workflowId, workerId, runtimeConfig: selectRunRuntime(h.database.authority) };
  const generation = h.database.getMeta().authorityGeneration;
  assertBlockedRefusal(await claimWithPreflight({ prepareRun: async () => undefined, preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext(request, admit) }), original.envelope.runId);
  assert.deepEqual(h.database.authority.runs.get(original.envelope.runId), original); assert.equal(h.database.getMeta().authorityGeneration, generation);
  h.faults.clear(); await h.preflight.admission.prepare(h.preflight.runScope(original.envelope), signal());
  const claimed = await claimWithPreflight({ prepareRun: async () => undefined, preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext(request, admit) }); assert.equal(claimed.state, "applied");
  let opens = 0;
  const factory = preflightSessionFactory({ probeProfile: async () => undefined, open: async () => { opens += 1; throw new Error("counted browser effect"); } }, h.preflight, h.preflight.runScope(original.envelope));
  const open = { workerId, workflowId: personLookupDescriptor.id,
    system: "ucpath" as const, instance: "prod", configFingerprint: original.envelope.configFingerprint, acceptDownloads: false, exclusive: false, signal: signal(),
    duoCeremony: {} as Parameters<typeof factory.open>[0]["duoCeremony"] };
  await assert.rejects(factory.open(open), /counted browser effect/); assert.equal(opens, 1);
  h.faults.add("endpoint.ucpath.prod"); await assert.rejects(factory.open(open), PreflightAdmissionRefusal); assert.equal(opens, 1);
  const stale = RunRecordSchema.parse({ ...original, envelope: { ...original.envelope, contractFingerprint: "f".repeat(64) } });
  assert.throws(() => h.preflight.runScope(stale.envelope), PreflightAdmissionRefusal);

} finally {
await _afterEachFixture0();
}
});

it("session readiness checks only its admitted system and freshly refuses every required prerequisite", async () => {
  try {
    const h = await harness();
    const scope = h.preflight.currentScope(personLookupDescriptor.id);
    let opens = 0;
    const reachedBrowser = new Error("session prerequisites passed");
    const factory = preflightSessionFactory({ probeProfile: async () => undefined, open: async () => { opens += 1; throw reachedBrowser; } }, h.preflight, scope);
    const open = {
      workerId: WorkerIdSchema.parse("person-lookup-worker-1"), workflowId: personLookupDescriptor.id,
      system: "crm" as const, instance: "prod", configFingerprint: scope.configFingerprint,
      acceptDownloads: false, exclusive: false, signal: signal(),
      duoCeremony: {} as Parameters<typeof factory.open>[0]["duoCeremony"],
    };
    h.faults.add("endpoint.ucpath.prod");
    await assert.rejects(factory.open(open), error => error === reachedBrowser);
    assert.equal(opens, 1);
    assert.deepEqual(new Set(h.probes), new Set(["browser.assets", "secrets.ucpath-sso", "endpoint.crm.prod"]));
    for (const check of ["browser.assets", "secrets.ucpath-sso", "endpoint.crm.prod"]) {
      h.faults.add(check);
      await assert.rejects(factory.open(open), error => error instanceof PreflightAdmissionRefusal && error.reason === "blocked" && error.message.includes(check));
      assert.equal(opens, 1);
      h.faults.delete(check);
    }
    const probes = h.probes.length;
    for (const wrong of [
      { ...open, instance: "test" }, { ...open, system: "kuali" as const },
      { ...open, configFingerprint: FingerprintSchema.parse("f".repeat(64)) },
    ]) await assert.rejects(factory.open(wrong), error => error instanceof PreflightAdmissionRefusal && error.reason === "scope-mismatch");
    assert.equal(h.probes.length, probes);
    assert.equal(opens, 1);
    await assert.rejects(h.preflight.prepareSession(scope, "kuali", signal()), error => error instanceof PreflightAdmissionRefusal && error.reason === "scope-mismatch");
    await assert.rejects(h.preflight.prepareSession({ ...scope, configFingerprint: FingerprintSchema.parse("f".repeat(64)) }, "crm", signal()), PreflightAdmissionRefusal);
    assert.equal(h.probes.length, probes);
  } finally { await _afterEachFixture0(); }
});

for (const fault of ["missing", "duplicate", "throw", "protected-revision"] as const) {
  it(`session readiness refuses ${fault} before browser effects`, async () => {
    try {
      const failure = new Error("controlled detector failure");
      let revise: () => void = () => undefined;
      const h = await harness(runners => {
        if (fault === "missing") return runners.filter(runner => runner.check !== "browser.assets");
        if (fault === "duplicate") return [...runners, ...runners.filter(runner => runner.check === "browser.assets")];
        return runners.map(runner => runner.check !== "endpoint.crm.prod" ? runner : { ...runner, async run(context) {
          if (fault === "throw") throw failure;
          const result = await runner.run(context);
          revise();
          return result;
        } });
      });
      revise = () => { h.changeProtected(); };
      let opens = 0;
      const scope = h.preflight.currentScope(personLookupDescriptor.id);
      const factory = preflightSessionFactory({ probeProfile: async () => undefined, open: async () => { opens += 1; throw new Error("browser effect"); } }, h.preflight, scope);
      await assert.rejects(factory.open({
        workerId: WorkerIdSchema.parse("person-lookup-worker-1"), workflowId: personLookupDescriptor.id,
        system: "crm", instance: "prod", configFingerprint: scope.configFingerprint,
        acceptDownloads: false, exclusive: false, signal: signal(),
        duoCeremony: {} as Parameters<typeof factory.open>[0]["duoCeremony"],
      }), error => error instanceof PreflightAdmissionRefusal
        && error.reason === (fault === "protected-revision" ? "stale" : "unavailable")
        && (fault !== "throw" || error.cause === failure));
      assert.equal(opens, 0);
      if (fault === "missing" || fault === "duplicate") assert.equal(h.probes.length, 0);
    } finally { await _afterEachFixture0(); }
  });
}

it("descriptor scope is derived from graph systems rather than a caller capability list", async () => {
try {

  const h = await harness(); const scope = workflowPreflightScope(personLookupDescriptor, h.identity);
  assert.ok(scope.requestedCapabilities.includes("system.ucpath.prod"));
  assert.throws(() => workflowPreflightScope(personLookupDescriptor, { ...h.identity, descriptorFingerprint: FingerprintSchema.parse("f".repeat(64)) }), PreflightAdmissionRefusal);

} finally {
await _afterEachFixture0();
}
});

it("production worker process composition refuses preflight before spawn and admits a healthy positive control", async () => {
try {

  const h = await harness(); const children: ScriptedWorkerChild[] = [];
  const workerId = h.database.withAuthorityTransaction(repositories =>
    admitFixtureSlot(repositories, personLookupDescriptor.id, 1, h.clock.now().toISOString())).workerId;
  const workers = composeWorkerPool({
    admission: h.admission, sessionGeneration: 1, profileRoot: join(h.repoRoot, rebuildRuntimeIsolation.browserProfileRoot), database: h.database,
    clock: h.clock, scheduler: new ManualScheduler(h.clock, 0), ids: sequentialIdFactory("e"), preflight: h.preflight,
    launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: scriptedWorkerSpawner(children), settleExit: () => undefined, onFault: error => { throw error; } });
  const kernel = h.kernelWith({ pool: workers.seam });
  const command = (id: string) => ({ commandId: id, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type: "spawn-worker", target: { workflowId: personLookupDescriptor.id, expectedVersion: 1 }, payload: { workerId } });
  h.faults.add("browser.assets");
  assert.equal((await kernel.executeWorkerPool(command("11111111-1111-4111-8111-111111111111"))).state, "rejected");
  assert.equal(children.length, 0);
  h.faults.clear(); const healthy = command("22222222-2222-4222-8222-222222222222");
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "applied"); assert.equal(children.length, 1);
  h.faults.add("browser.assets"); const probes = h.probes.length;
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "already-applied"); assert.equal(children.length, 1); assert.equal(h.probes.length, probes);
  await workers.pool.stopAll("shutdown");

} finally {
await _afterEachFixture0();
}
});

it("retries a worker an earlier dashboard lifetime started, without a child of this process", async () => {
try {

  const h = await harness(); let spawns = 0;
  const slot = h.database.withAuthorityTransaction(repositories =>
    admitFixtureSlot(repositories, personLookupDescriptor.id, 1, h.clock.now().toISOString()));
  const workers = composeWorkerPool({
    admission: h.admission, sessionGeneration: 1, profileRoot: join(h.repoRoot, rebuildRuntimeIsolation.browserProfileRoot), database: h.database,
    clock: h.clock, scheduler: new ManualScheduler(h.clock, 0), ids: sequentialIdFactory("e"), preflight: h.preflight,
    launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: () => { spawns += 1; throw new Error("fixture-spawn-reached"); }, settleExit: () => undefined, onFault: error => { throw error; } });
  const kernel = h.kernelWith({ pool: workers.seam });
  assert.equal(workers.seam.assertMember({ workerId: slot.workerId, lifetimeId: null, expectedVersion: 0 }), "absent");
  const retry = CommandRequestSchema.parse({ commandId: "66666666-6666-4666-8666-666666666666", requestedAt: h.clock.now().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "retry-worker",
    target: { workerId: slot.workerId, workflowId: personLookupDescriptor.id, lifetimeId: null, expectedVersion: 0 } });
  await assert.rejects(async () => { await kernel.executeWorkerPool(retry); }, /fixture-spawn-reached/u);
  assert.equal(spawns, 1);

} finally {
await _afterEachFixture0();
}
});
it("a protected-settings revision change invalidates admission without reusing a recent healthy report", async () => {
try {

  const h = await harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  h.changeProtected(); const count = h.probes.length;
  assert.equal(h.kernel.execute(h.command(plan)).state, "rejected"); assert.equal(h.publications, 0); assert.equal(h.probes.length, count);
  assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  await h.plans.prepare?.(h.ingress, signal()); const resumed = { ...h.command(plan), commandId: "99999999-9999-4999-8999-999999999998" }; assert.equal(h.kernel.execute(resumed).state, "applied");

} finally {
await _afterEachFixture0();
}
});
}

{

const cleanup: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); };
const signal = (): AbortSignal => new AbortController().signal;
async function harness(beforeCrmEndpoint?: () => Promise<void>) {
  const f = await runtimeFixture(["executor.run", "system.ucpath.prod", "system.crm.prod"]);
  const {root:repoRoot, clock}=f;
  const database=AuthorityDatabase.open({path:f.databasePath,busyTimeoutMs:250,migrationOwner:"setup-admission"},clock);
  cleanup.push(async () => {
    releaseSeededWriteOwners(database, clock.now().toISOString());
    database.close();
    await f.close();
  });
  const resolved = {...resolveConfigWithProvenance({},hostConfigFacts({}),clock),config:f.input.config,fingerprint:sha256Hex(canonicalJsonStringify(f.input.config))};
  const identity = { configSnapshotId: "66666666-6666-4666-8666-666666666666", configFingerprint: resolved.fingerprint };
  database.authority.runtimeConfig.initialize({ ...PREFERENCES_SNAPSHOT, configSnapshotId: identity.configSnapshotId, fingerprint: resolved.fingerprint,
    config: resolved.config, provenance: resolved.provenance, revision: 1, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
  let probes=0;
  const preflight=composeRuntimePreflight({ admission: f.admission, credentials: f.credentials,duo:f.duo,database,clock,repoRoot,isolation:rebuildRuntimeIsolation,descriptors,
    descriptorSetHash:personLookupDescriptor.contractFingerprint,protectedSecrets:f.input.protectedSecrets,environment:{},
    runnerFactory:input=>createRuntimePreflightRunners({...input,browserExecutablePath:()=>f.executable,dashboard:f.input.dashboard,providerAvailability:f.input.providerAvailability}).map(runner=>({...runner,run(context){probes++;return runner.check === "endpoint.crm.prod" && beforeCrmEndpoint !== undefined ? (beforeCrmEndpoint()).then(() => runner.run(context)) : runner.run(context);}}))});
  let publications = 0;
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("b"), publishQueued: run => { publications += 1; createTimelineEmitter({repository:database.authority.timelineEvents,clock}).emit(runQueuedSpanEvent({run,actorId:ActorIdSchema.parse("local-operator"),title:"Synthetic Setup admission proof"})); },
    admitQueuedRun: run => preflight.admission.assertReady(preflight.runScope(run.envelope)) });
  const plans = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock, ids: sequentialIdFactory("a"),
    planTtlMs: 600_000, ...identity, plannedBy: "local-operator", preflight: preflight.admission });
  const unexpected = (): never => { throw new Error("Unexpected unrelated effect"); };
  const kernelDependencies: CommandKernelDependencies = { lifecycle, authority: database, clock, ids: sequentialIdFactory("c"), appVersion: "0.1.0", descriptors,
    preflight: preflight.admission, configIdentity: identity, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { recheck: unexpected, resolveAbsent: unexpected },
    workerRuntime: { pool: unusedWorkerPool(unexpected) } };
  const kernel = createCommandKernel(kernelDependencies);
  const ingress = { workflowId: personLookupDescriptor.id, submissions: [{ emplId: "10873698" }], dryRun: false };
  const command = (plan: ReturnType<typeof plans.plan>) => ({ commandId: "99999999-9999-4999-8999-999999999999", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  return {f,clock,database,preflight,plans,kernel,lifecycle,ingress,command,kernelWith:(workerRuntime:CommandKernelDependencies["workerRuntime"])=>createCommandKernel({...kernelDependencies,workerRuntime}),get probes(){return probes;},get publications(){return publications;}};
}

it("opens CRM during authority writes while the full doctor still rejects mixed snapshots", async () => {
  const endpointReached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const backupReadReached = Promise.withResolvers<void>();
  let gateSession = false;
  const h = await harness(async () => {
    if (!gateSession) return;
    endpointReached.resolve();
    await release.promise;
  });
  let restoreRead: () => void = () => undefined;
  let doctorOutcome: Promise<unknown> | undefined;
  let openOutcome: Promise<unknown> | undefined;
  try {
    await h.plans.prepare?.(h.ingress, signal());
    const plan = h.plans.plan(h.ingress);
    assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
    const run = h.database.authority.runs.listByWorkflow(plan.workflowId)[0];
    assert.ok(run);
    const scope = h.preflight.runScope(run.envelope);
    testWorkerPorts(h.database, h.clock, { path: h.f.databasePath, descriptor: personLookupDescriptor, poolIndex: 1 });
    const workerId = h.database.authority.workerSlots.list(personLookupDescriptor.id)[0].workerId;
    assert.equal((await claimWithPreflight({ prepareRun: async () => undefined, preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext({ commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", workflow: plan.workflowId, workerId,
      runtimeConfig: selectRunRuntime(h.database.authority),
    }, admit) })).state, "applied");
    let opens = 0;
    const reachedBrowser = new Error("session prerequisites passed");
    const factory = preflightSessionFactory({ probeProfile: async () => undefined, open: async () => { opens += 1; throw reachedBrowser; } }, h.preflight, scope);
    const open = {
      workerId, workflowId: personLookupDescriptor.id,
      system: "ucpath" as const, instance: "prod", configFingerprint: run.envelope.configFingerprint,
      acceptDownloads: false, exclusive: false, signal: signal(),
      duoCeremony: {} as Parameters<typeof factory.open>[0]["duoCeremony"],
    };
    await assert.rejects(factory.open(open), error => error === reachedBrowser);
    assert.equal(opens, 1);
    const directory = h.f.doctorOptions.backupDirectory;
    await new AuthorityBackupService(h.database, { directory }, h.clock).request({
      trigger: "operator", requiredGeneration: h.database.getMeta().authorityGeneration,
    });
    const createReadStream = fs.createReadStream;
    const spy = vi.spyOn(fs, "createReadStream").mockImplementation((...args) => {
      const stream = createReadStream(...args);
      if (String(args[0]).startsWith(directory)) {
        const read = stream._read.bind(stream);
        stream._read = size => {
          backupReadReached.resolve();
          void release.promise.then(() => read(size));
        };
      }
      return stream;
    });
    syncBuiltinESMExports();
    restoreRead = () => { spy.mockRestore(); syncBuiltinESMExports(); };
    doctorOutcome = doctorAuthorityStorage(h.f.admission, h.f.doctorOptions, h.clock, h.f.credentials).catch((error: unknown) => error);
    await backupReadReached.promise;
    gateSession = true;
    openOutcome = factory.open({ ...open, system: "crm" }).catch((error: unknown) => error);
    await endpointReached.promise;
    const generation = h.database.getMeta().authorityGeneration;
    createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock }).emit({
      t: "span.started", kind: "task", ts: h.clock.now().toISOString(), workflow: run.envelope.workflow,
      runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/searching#1`, parentSpanPath: run.envelope.traceId, name: "searching",
    });
    assert.ok(h.database.getMeta().authorityGeneration > generation);
    release.resolve();
    const doctorError = await doctorOutcome;
    assert.ok(doctorError instanceof StorageDoctorObservationChangedError);
    assert.match(doctorError.message, /authority changed while the storage doctor awaited external evidence/u);
    assert.equal(await openOutcome, reachedBrowser);
    assert.equal(opens, 2);
    gateSession = false;
    // The readiness pass reads no backup and has no await, so the write lands between its span snapshot and final identity reads.
    const readSpans = StoreDatabase.inspectSpanRunAuthorityReadOnly.bind(StoreDatabase);
    const spans = vi.spyOn(StoreDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementationOnce((...args) => {
      const snapshot = readSpans(...args);
      createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock }).emit({
        t: "span.started", kind: "task", ts: h.clock.now().toISOString(), workflow: run.envelope.workflow,
        runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
        spanPath: `${run.envelope.traceId}/crm-cross-verify#1`, parentSpanPath: run.envelope.traceId, name: "crm-cross-verify",
      });
      return snapshot;
    });
    const fullError = await h.preflight.admission.prepare(scope, signal()).catch((error: unknown) => error);
    spans.mockRestore();
    assert.ok(fullError instanceof PreflightObservationChangedError && fullError.reason === "observation-changed");
    assert.ok(fullError.cause instanceof StorageDoctorObservationChangedError);
    assert.match(fullError.cause.message, /authority changed while the storage doctor awaited external evidence/u);
  } finally {
    release.resolve();
    await Promise.allSettled([doctorOutcome, openOutcome]);
    restoreRead();
    await _afterEachFixture0();
  }
});

it("real detectors block enqueue for a missing workflow secret, then admit after explicit repair; replay remains read-only",async()=>{
try {

  const h=await harness();h.f.setProtected(populatedProtectedRecord("ucpathPassword"));
  const generation=h.database.getMeta().authorityGeneration;
  await assert.rejects(h.plans.prepare?.(h.ingress,signal())??Promise.reject(new Error("missing prepare")),PreflightAdmissionRefusal);
  assert.throws(()=>h.plans.plan(h.ingress),PreflightAdmissionRefusal);
  assert.equal(h.database.getMeta().authorityGeneration,generation);assert.equal(h.publications,0);assert.equal(h.database.authority.runs.listByWorkflow(h.ingress.workflowId).length,0);
  h.f.setProtected(populatedProtectedRecord());await h.plans.prepare?.(h.ingress,signal());const plan=h.plans.plan(h.ingress),command=h.command(plan);
  assert.equal(h.kernel.execute(command).state,"applied");assert.equal(h.publications,1);
  h.f.setProtected(populatedProtectedRecord("ucpathPassword"));await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId),signal());const probes=h.probes;
  assert.equal(h.kernel.execute(command).state,"already-applied");assert.equal(h.probes,probes);assert.equal(h.publications,1);

} finally {
await _afterEachFixture0();
}
});
it("claim and browser consumers reject actual missing assets before effects, with healthy controls",async()=>{
try {

  const h=await harness();await h.plans.prepare?.(h.ingress,signal());const plan=h.plans.plan(h.ingress);assert.equal(h.kernel.execute(h.command(plan)).state,"applied");
  const original=h.database.authority.runs.listByWorkflow(plan.workflowId)[0];assert.ok(original);
  testWorkerPorts(h.database, h.clock, { path: h.f.databasePath, descriptor: personLookupDescriptor, poolIndex: 1 });
  const workerId = h.database.authority.workerSlots.list(personLookupDescriptor.id)[0].workerId;
  const request={commandId:"ffffffff-ffff-4fff-8fff-ffffffffffff",workflow:plan.workflowId,workerId,runtimeConfig:selectRunRuntime(h.database.authority)};
  renameSync(h.f.executable,`${h.f.executable}.parked`);h.clock.advanceWall(60_000);h.clock.advanceMonotonic(60_000);
  const generation=h.database.getMeta().authorityGeneration;
  assertBlockedRefusal(await claimWithPreflight({prepareRun:async()=>undefined,preflight:h.preflight,signal:signal(),claim:admit=>h.lifecycle.claimNext(request,admit)}), original.envelope.runId);
  assert.equal(h.database.getMeta().authorityGeneration,generation);assert.deepEqual(h.database.authority.runs.get(original.envelope.runId),original);
  renameSync(`${h.f.executable}.parked`,h.f.executable);await h.preflight.admission.prepare(h.preflight.runScope(original.envelope),signal());
  assert.equal((await claimWithPreflight({prepareRun:async()=>undefined,preflight:h.preflight,signal:signal(),claim:admit=>h.lifecycle.claimNext(request,admit)})).state,"applied");
  let opens=0;const factory=preflightSessionFactory({probeProfile:async()=>undefined,open:async()=>{opens++;throw new Error("counted browser effect");}},h.preflight,h.preflight.runScope(original.envelope));
  const open={workerId:workerId,workflowId:personLookupDescriptor.id,system:"ucpath" as const,instance:"prod",configFingerprint:original.envelope.configFingerprint,acceptDownloads:false,exclusive:false,signal:signal(),duoCeremony:{} as Parameters<typeof factory.open>[0]["duoCeremony"]};
  await assert.rejects(factory.open(open),/counted browser effect/u);assert.equal(opens,1);
  renameSync(h.f.executable, `${h.f.executable}.parked`);
  await assert.rejects(factory.open(open), error => error instanceof PreflightAdmissionRefusal && error.reason === "blocked");
  assert.equal(opens, 1);
  renameSync(`${h.f.executable}.parked`, h.f.executable);
  h.f.setProtected(populatedProtectedRecord("ucpathPassword"));await assert.rejects(factory.open(open),PreflightAdmissionRefusal);assert.equal(opens,1);

} finally {
await _afterEachFixture0();
}
});
it("production worker process composition refuses preflight before spawn and admits a healthy positive control", async () => {
try {

  const h = await harness(); const children: ScriptedWorkerChild[] = [];
  const workers = composeWorkerPool({
    admission: h.f.admission, sessionGeneration: 1, profileRoot: h.f.input.config.paths.browserProfileRoot, database: h.database,
    clock: h.clock, scheduler: new ManualScheduler(h.clock, 0), ids: sequentialIdFactory("e"), preflight: h.preflight,
    launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: scriptedWorkerSpawner(children), settleExit: () => undefined, onFault: error => { throw error; } });
  const kernel = h.kernelWith({ pool: workers.seam });
  renameSync(h.f.executable,`${h.f.executable}.parked`);
  assert.equal((await kernel.executeWorkerPool({ commandId: "33333333-3333-4333-8333-333333333333", requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "plan-worker-count", target: { workflowId: personLookupDescriptor.id, expectedVersion: 0 }, payload: { desiredWorkers: 1 } })).state, "applied");
  assert.equal(children.length, 0, "the plan's start is refused before spawn");
  const slot = h.database.authority.workerSlots.list(personLookupDescriptor.id)[0]; assert.ok(slot);
  const command = (id: string) => ({ commandId: id, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type: "spawn-worker", target: { workflowId: personLookupDescriptor.id, expectedVersion: h.database.authority.workerPools.get(personLookupDescriptor.id)?.version }, payload: { workerId: slot.workerId } });
  assert.equal((await kernel.executeWorkerPool(command("11111111-1111-4111-8111-111111111111"))).state, "rejected");
  assert.equal(children.length, 0);
  renameSync(`${h.f.executable}.parked`,h.f.executable); const healthy = command("22222222-2222-4222-8222-222222222222");
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "applied"); assert.equal(children.length, 1);
  renameSync(h.f.executable,`${h.f.executable}.parked`); const probes = h.probes;
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "already-applied"); assert.equal(children.length, 1); assert.equal(h.probes, probes);
  renameSync(`${h.f.executable}.parked`,h.f.executable);
  await workers.pool.stopAll("shutdown");

} finally {
await _afterEachFixture0();
}
});

it("a planned member whose start preflight refuses serves a not-started card beside its live peer, and the card's Retry starts it", async () => {
try {

  const h = await harness(); const children: ScriptedWorkerChild[] = [];
  const workers = composeWorkerPool({
    admission: h.f.admission, sessionGeneration: 1, profileRoot: h.f.input.config.paths.browserProfileRoot, database: h.database,
    clock: h.clock, scheduler: new ManualScheduler(h.clock, 0), ids: sequentialIdFactory("e"), preflight: h.preflight,
    launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: scriptedWorkerSpawner(children), settleExit: () => undefined, onFault: error => { throw error; } });
  const kernel = h.kernelWith({ pool: workers.seam });
  const projection = createOperatorProjection({ database: h.database, reader: h.lifecycle, workerMembers: () => workers.pool.snapshot(),
    descriptors: { resolve: id => id === personLookupDescriptor.id ? personLookupDescriptor : undefined },
    stateRoot: h.f.input.config.paths.stateRoot, clock: h.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  const catalog = buildWorkflowCatalog([], true, servedFixtureSources([]));
  const served = () => { projection.rebuildFromTimeline(); return projection.buildDashboardDayWire(h.clock.now().toISOString().slice(0, 10)); };
  const envelope = (commandId: string) => ({ commandId, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "worker-browser" });
  const plan = (commandId: string, desiredWorkers: number) => kernel.executeWorkerPool({ ...envelope(commandId), type: "plan-worker-count",
    target: { workflowId: personLookupDescriptor.id, expectedVersion: h.database.authority.workerPools.get(personLookupDescriptor.id)?.version ?? 0 }, payload: { desiredWorkers } });

  assert.equal((await plan("44444444-4444-4444-8444-444444444441", 1)).state, "applied"); assert.equal(children.length, 1);
  renameSync(h.f.executable, `${h.f.executable}.parked`);
  assert.equal((await plan("44444444-4444-4444-8444-444444444442", 2)).state, "applied", "the plan stays applied when its start is refused");
  assert.equal(children.length, 1, "the refused member never spawns");

  const day = served();
  assert.equal(day.workerAuthority.state, "present");
  const [peer, added] = [1, 2].map(ordinal => day.workerCards.find(card => card.member.ordinal === ordinal));
  assert.ok(peer && added);
  assert.equal(peer.state, "idle"); assert.equal(peer.controls?.basis.state, "present");
  const peerBasis = peer.controls?.basis.state === "present" ? peer.controls.basis.value : undefined; assert.notEqual(peerBasis?.lifetimeId, null);
  assert.equal(added.state, "failed"); assert.equal(added.stopReason, "not-started"); assert.equal(added.endedAt, undefined);
  assert.deepEqual(added.controls, { basis: { state: "present", value: { lifetimeId: null, version: 0 } } });
  const view = sessionsFromDay(day, catalog, h.clock.now().toISOString());
  assert.equal(view.state, "ready");
  assert.deepEqual(view.state === "ready" ? view.workers.map(worker => [worker.id, worker.state]) : [], [[peer.workerId, "idle"], [added.workerId, "failed"]]);

  // The card's own fence, exactly as the Sessions Retry sends it.
  const retry = (commandId: string) => CommandRequestSchema.parse({ ...envelope(commandId), type: "retry-worker",
    target: { workerId: added.workerId, workflowId: added.workflowId, lifetimeId: null, expectedVersion: 0 } });
  assert.equal((await kernel.executeWorkerPool(retry("55555555-5555-4555-8555-555555555551"))).state, "rejected", "Retry preflights again");
  assert.equal(children.length, 1);
  renameSync(`${h.f.executable}.parked`, h.f.executable);
  const corrected = retry("55555555-5555-4555-8555-555555555552");
  assert.equal((await kernel.executeWorkerPool(corrected)).state, "applied"); assert.equal(children.length, 2);

  const after = served();
  assert.equal(after.workerAuthority.state, "present");
  assert.ok(sessionCommandEffect(after, corrected), "the served card shows the Retry's effect");
  const restarted = after.workerCards.find(card => card.workerId === added.workerId);
  assert.ok(restarted && restarted.state !== "failed" && restarted.stopReason === undefined);
  const peerAfter = after.workerCards.find(card => card.workerId === peer.workerId);
  assert.deepEqual(peerAfter?.controls, peer.controls, "the live peer keeps its member and fence");
  await workers.pool.stopAll("shutdown");

} finally {
await _afterEachFixture0();
}
});

it("an unavailable optional executable provider leaves real unrelated admission usable; stale config refuses before probes",async()=>{
try {

  const h=await harness();const scope=h.preflight.currentScope(h.ingress.workflowId);
  Reflect.set(h.f.input.providerAvailability, "census/geocode.census", false);
  const optional={...scope,requestedCapabilities:[...scope.requestedCapabilities,"provider.census" as const]};
  const report=await h.preflight.admission.prepare(optional,signal());
  assert.equal(report.results.find(check=>check.check==="provider.census")?.status,"warning");h.preflight.admission.assertReady(optional);
  const probes=h.probes;
  await assert.rejects(h.preflight.admission.prepare({...scope,configFingerprint:"f".repeat(64) as typeof scope.configFingerprint},signal()));assert.equal(h.probes,probes);
  await h.plans.prepare?.(h.ingress,signal());assert.equal(h.kernel.execute(h.command(h.plans.plan(h.ingress))).state,"applied");assert.equal(h.publications,1);

} finally {
await _afterEachFixture0();
}
});
}


for (const capability of ["dashboard.serve", "executor.run"] as const) it(`the default runtime factory verifies actual credential-owned authority for ${capability}`, async () => {
  const f = await runtimeFixture([capability]);
  const database = AuthorityDatabase.open({ path: f.databasePath, busyTimeoutMs: 250, migrationOwner: "default-preflight-owner" }, f.clock);
  try {
    const config = f.input.config, fingerprint = sha256Hex(canonicalJsonStringify(config));
    database.authority.runtimeConfig.initialize({ ...PREFERENCES_SNAPSHOT, configSnapshotId: f.input.scope.configSnapshotId, fingerprint,
      config, provenance: resolveConfigWithProvenance({}, hostConfigFacts({}), f.clock).provenance,
      revision: 1, capturedAt: f.clock.now().toISOString(), capturedBy: "local-operator" });
    const scope = PreflightAdmissionScopeSchema.parse({ ...f.input.scope, configFingerprint: fingerprint, requestedCapabilities: [capability] });
    const preflight = composeRuntimePreflight({ admission: f.admission, credentials: f.credentials, database,
      clock: f.clock, repoRoot: f.root, isolation: rebuildRuntimeIsolation, descriptors: { resolve: () => undefined },
      descriptorSetHash: scope.descriptorFingerprint, protectedSecrets: { read: () => f.credentials.read() }, environment: {} });
    const generation = database.getMeta().authorityGeneration;
    const report = await preflight.admission.prepare(scope, new AbortController().signal);
    assert.deepEqual(report.results.map(result => result.check).sort(), [...requiredPreflightChecks([capability])].sort());
    assert.equal(report.results.find(result => result.check === "authority.health")?.status, "pass");
    assert.equal(database.getMeta().authorityGeneration, generation);
  } finally { database.close(); await f.close(); }
});

for (const fault of ["missing", "foreign", "stale"] as const) it(`the default runtime composition refuses a ${fault} credential owner before protected value reads`, async () => {
  const f = await runtimeFixture(["executor.run"]), foreign = fault === "foreign" ? await runtimeFixture(["executor.run"]) : undefined;
  const database = AuthorityDatabase.open({ path: f.databasePath, busyTimeoutMs: 250, migrationOwner: "preflight-owner-refusal" }, f.clock);
  let secretReads = 0;
  const input = { admission: f.admission, credentials: f.credentials, database, clock: f.clock, repoRoot: f.root,
    isolation: rebuildRuntimeIsolation, descriptors: { resolve: () => undefined }, descriptorSetHash: personLookupDescriptor.contractFingerprint,
    protectedSecrets: { read: () => { secretReads++; return f.credentials.read(); } }, environment: {} };
  try {
    composeRuntimePreflight(input);
    if (fault === "missing") Reflect.deleteProperty(input, "credentials");
    else if (fault === "foreign") { assert.ok(foreign); input.credentials = foreign.credentials; }
    else { database.close(); f.admission.release(); }
    assert.throws(() => composeRuntimePreflight(input), fault === "stale"
      ? /runtime-admission: missing or released admission/u : /credential-store-owner-mismatch/u);
    assert.equal(secretReads, 0);
  } finally { database.close(); await foreign?.close(); await f.close(); }
});
