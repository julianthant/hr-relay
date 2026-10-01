import { composeWorkerProcessControl } from "../../../src/backend/app/dashboard/compose.js";
import { poolWorkerId } from "../../../src/backend/runtime/worker-loop.js";
import { PositiveIntSchema } from "../../../src/domain/ids.js";
import { ManualScheduler } from "../../helpers/phase1f-executor-harness.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { initialSettingsFileRecord } from "../../../src/domain/config/settings.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { initialProtectedStoreRecord, PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedStoreRecordSchema } from "../../../src/domain/config/protected-settings.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { composeRuntimePreflight } from "../../../src/backend/app/preflight/runtime-admission.js";
import { createRuntimePreflightRunners } from "../../../src/backend/app/preflight/runtime-runners.js";
import { createStartPlanService } from "../../../src/backend/runs/dashboard/commands/start-plan-service.js";
import { createCommandKernel, type CommandKernelDependencies } from "../../../src/backend/runs/command-kernel.js";
import { RunRecordService } from "../../../src/backend/runs/run-record-service.js";
import { selectRunRuntime } from "../../../src/backend/runs/run-settings.js";
import { claimWithPreflight, preflightSessionFactory } from "../../../src/backend/app/preflight/worker-admission.js";
import { createPreflightReportService } from "../../../src/server/preflight/report-service.js";
import { PreflightAdmissionRefusal } from "../../../src/domain/preflight-admission.js";
import { healthyRuntimePreflightRunners, createPreflightHarness } from "../../fixtures/preflight-seams.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../fixtures/archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import type { RuntimeCapability } from "../../../src/domain/preflight-contract.js";
import { workflowPreflightScope } from "../../../src/backend/runs/start/preflight-scope.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
const signal = (): AbortSignal => new AbortController().signal;
function harness() {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "preflight-admission-"));
  const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot); mkdirSync(stateRoot, { recursive: true });
  const clock = manualClock(new Date("2026-09-19T12:00:00Z"));
  const database = AuthorityDatabase.open({ path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "preflight-test" }, clock);
  cleanup.push(() => { database.close(); rmSync(repoRoot, { recursive: true, force: true }); });
  const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock);
  const baseline = initialSettingsFileRecord();
  const identity = { configSnapshotId: "66666666-6666-4666-8666-666666666666", configFingerprint: resolved.fingerprint };
  database.authority.configSnapshots.insert({ configSnapshotId: identity.configSnapshotId, fingerprint: resolved.fingerprint,
    config: resolved.config, provenance: resolved.provenance, revision: 1, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  database.authority.runtimeConfig.activate({ ...identity, settingsRevision: baseline.revision, settingsFingerprint: baseline.settingsFingerprint, activatedAt: clock.now().toISOString() });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
  let protectedRecord = initialProtectedStoreRecord();
  const faults = new Set<string>(); const probes: string[] = []; let supportMissing = false;
  const preflight = composeRuntimePreflight({ admission: RuntimeAdmission.syntheticRoots(stateRoot, join(repoRoot, rebuildRuntimeIsolation.artifactRoot)),
    database, clock, repoRoot, isolation: rebuildRuntimeIsolation, descriptors,
    descriptorSetHash: personLookupDescriptor.contractFingerprint, protectedSecrets: { read: () => protectedRecord }, environment: {},
    runnerFactory: input => {
      const available = healthyRuntimePreflightRunners(input);
      const missing = supportMissing ? createRuntimePreflightRunners(input).find(runner => runner.check === "browser.assets") : undefined;
      return available.map(runner => missing !== undefined && runner.check === "browser.assets" ? missing : ({ ...runner, async run(context) {
        probes.push(runner.check);
        return faults.has(runner.check) ? { check: runner.check, state: "unhealthy" as const, summary: "Controlled dependency unavailable", impact: "Selected work cannot use it" } : runner.run(context);
      } }));
    } });
  let publications = 0;
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("b"), publishQueued: () => { publications += 1; },
    admitQueuedRun: run => preflight.admission.assertReady(preflight.runScope(run.envelope)) });
  const plans = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock, ids: sequentialIdFactory("a"),
    planTtlMs: 600_000, ...identity, plannedBy: "local-operator", preflight: preflight.admission });
  const unexpected = (): never => { throw new Error("Unexpected unrelated effect"); };
  const kernelDependencies: CommandKernelDependencies = { lifecycle, authority: database, clock, ids: sequentialIdFactory("c"), appVersion: "0.1.0", descriptors,
    preflight: preflight.admission, configIdentity: identity, archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { resolvePresent: unexpected, resolveAbsent: unexpected },
    workerRuntime: { planWorkerCount: unexpected, spawnWorker: unexpected, refreshBrowser: unexpected, reopenBrowser: unexpected } };
  const kernel = createCommandKernel(kernelDependencies);
  const ingress = { workflowId: personLookupDescriptor.id, submissions: [{ emplId: "10873698" }], dryRun: false };
  const command = (plan: ReturnType<typeof plans.plan>) => ({ commandId: "99999999-9999-4999-8999-999999999999", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  return { clock, database, identity, preflight, faults, probes, plans, kernel, lifecycle, kernelWith: (workerRuntime: CommandKernelDependencies["workerRuntime"]) => createCommandKernel({ ...kernelDependencies, workerRuntime }), ingress, command, get publications() { return publications; }, changeProtected() {
    protectedRecord = ProtectedStoreRecordSchema.parse({ ...protectedRecord, revision: 2,
      lastApplied: { commandId: "77777777-7777-4777-8777-777777777777", commandFingerprint: "7".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "88888888-8888-4888-8888-888888888888" } });
  }, missing() { supportMissing = true; } };
}

it("real plan/kernel/lifecycle admits healthy work and exact replay stays read-only after a fault", async () => {
  const h = harness(); await h.plans.prepare?.(h.ingress, signal());
  const plan = h.plans.plan(h.ingress); const command = h.command(plan);
  assert.equal(h.kernel.execute(command).state, "applied");
  assert.equal(h.publications, 1); assert.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 1);
  h.faults.add("endpoint.ucpath.prod"); await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId), signal());
  const count = h.probes.length;
  assert.equal(h.kernel.execute(command).state, "already-applied");
  assert.equal(h.probes.length, count); assert.equal(h.publications, 1);
});

it("required faults and missing detector support prevent plan/enqueue effects", async () => {
  for (const missing of [false, true]) {
    const h = harness(); if (missing) h.missing(); else h.faults.add("endpoint.ucpath.prod");
    const generation = h.database.getMeta().authorityGeneration;
    await assert.rejects(h.plans.prepare?.(h.ingress, signal()) ?? Promise.reject(new Error("fixture preparation is missing")), PreflightAdmissionRefusal);
    assert.throws(() => h.plans.plan(h.ingress), PreflightAdmissionRefusal);
    assert.equal(h.publications, 0); assert.equal(h.database.authority.runs.listByWorkflow(h.ingress.workflowId).length, 0);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  }
});

it("a fault after planning refuses confirmation before plan consumption or session creation", async () => {
  const h = harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  h.faults.add("endpoint.ucpath.prod"); await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId), signal());
  const result = h.kernel.execute(h.command(plan)); assert.equal(result.state, "rejected");
  assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  assert.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0); assert.equal(h.publications, 0);
});

it("optional or unselected faults leave unrelated valid scopes usable; instance scopes cannot substitute", async () => {
  const h = harness(); h.faults.add("provider.census"); h.faults.add("endpoint.ucpath.test");
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
});

it("wrong fingerprints and divergent scoped reruns refuse before probes; failed and in-flight replay is stable", async () => {
  const h = harness(); const dashboard = createPreflightHarness(h.clock, h.identity.configFingerprint).authority;
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
});

it("claim checks the selected retained run before writing; browser gate refuses a new fault before open", async () => {
  const h = harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
  const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert.ok(original);
  h.clock.advanceWall(60_000); h.clock.advanceMonotonic(60_000); h.faults.add("endpoint.ucpath.prod");
  const request = { commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", workflow: plan.workflowId, workerId: "preflight-worker", runtimeConfig: selectRunRuntime(h.database.authority) };
  const generation = h.database.getMeta().authorityGeneration;
  await assert.rejects(claimWithPreflight({ preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext(request, admit) }), PreflightAdmissionRefusal);
  assert.deepEqual(h.database.authority.runs.get(original.envelope.runId), original); assert.equal(h.database.getMeta().authorityGeneration, generation);
  h.faults.clear(); await h.preflight.admission.prepare(h.preflight.runScope(original.envelope), signal());
  const claimed = await claimWithPreflight({ preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext(request, admit) }); assert.equal(claimed.state, "applied");
  let opens = 0;
  const factory = preflightSessionFactory({ open: async () => { opens += 1; throw new Error("counted browser effect"); } }, h.preflight, h.preflight.runScope(original.envelope));
  const open = { workerId: "preflight-worker" as Parameters<typeof factory.open>[0]["workerId"], workflowId: personLookupDescriptor.id,
    system: "ucpath" as const, instance: "prod", configFingerprint: original.envelope.configFingerprint, acceptDownloads: false, exclusive: false, signal: signal(),
    duoCeremony: {} as Parameters<typeof factory.open>[0]["duoCeremony"] };
  await assert.rejects(factory.open(open), /counted browser effect/); assert.equal(opens, 1);
  h.faults.add("endpoint.ucpath.prod"); await assert.rejects(factory.open(open), PreflightAdmissionRefusal); assert.equal(opens, 1);
  const stale = RunRecordSchema.parse({ ...original, envelope: { ...original.envelope, contractFingerprint: "f".repeat(64) } });
  assert.throws(() => h.preflight.runScope(stale.envelope), PreflightAdmissionRefusal);
});

it("descriptor scope is derived from graph systems rather than a caller capability list", () => {
  const h = harness(); const scope = workflowPreflightScope(personLookupDescriptor, h.identity);
  assert.ok(scope.requestedCapabilities.includes("system.ucpath.prod"));
  assert.throws(() => workflowPreflightScope(personLookupDescriptor, { ...h.identity, descriptorFingerprint: FingerprintSchema.parse("f".repeat(64)) }), PreflightAdmissionRefusal);
});

it("production worker process composition refuses preflight before spawn and admits a healthy positive control", async () => {
  const h = harness(); let spawns = 0; let exit: ((code: number | null, signal: string | null) => void) | undefined;
  const workerId = poolWorkerId(personLookupDescriptor.id, PositiveIntSchema.parse(1));
  const control = composeWorkerProcessControl({ database: h.database, clock: h.clock, scheduler: new ManualScheduler(h.clock, 0),
    preflight: h.preflight, launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: () => {
      spawns += 1;
      assert.equal(h.database.authority.workerLeases.start({ workerId, workflow: personLookupDescriptor.id,
        browserSystems: ["ucpath", "crm"], processId: 4242, requestedBy: "local-operator", now: h.clock.now().toISOString() }).state, "started");
      return { pid: 4242, onExit: listener => { exit = listener; }, onError() {}, kill: () => true };
    }, birth: { pollMs: 250, timeoutMs: 10_000 }, onFault: error => { throw error; } });
  const kernel = h.kernelWith(control.workerRuntime);
  const command = (id: string) => ({ commandId: id, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type: "spawn-worker", target: { workflowId: personLookupDescriptor.id, expectedVersion: 0 }, payload: { workerId } });
  h.faults.add("browser.assets");
  assert.equal((await kernel.executeWorkerPool(command("11111111-1111-4111-8111-111111111111"))).state, "rejected");
  assert.equal(spawns, 0); assert.equal(h.database.authority.workerLeases.get(workerId), undefined);
  h.faults.clear(); const healthy = command("22222222-2222-4222-8222-222222222222");
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "applied"); assert.equal(spawns, 1);
  h.faults.add("browser.assets"); const probes = h.probes.length;
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "already-applied"); assert.equal(spawns, 1); assert.equal(h.probes.length, probes);
  assert.ok(exit); exit(0, null); control.supervisor.close();
});

it("a protected-settings revision change invalidates admission without reusing a recent healthy report", async () => {
  const h = harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  h.changeProtected(); const count = h.probes.length;
  assert.equal(h.kernel.execute(h.command(plan)).state, "rejected"); assert.equal(h.publications, 0); assert.equal(h.probes.length, count);
  assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  await h.plans.prepare?.(h.ingress, signal()); assert.equal(h.kernel.execute(h.command(plan)).state, "applied");
});
