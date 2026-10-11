import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { mkdirSync as mkdirSync_m0,mkdtempSync as mkdtempSync_m0,realpathSync as realpathSync_m0,renameSync as renameSync_m1,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { it as it_m0,it as it_m1 } from "vitest";
import { composeWorkerProcessControl as composeWorkerProcessControl_m0,composeWorkerProcessControl as composeWorkerProcessControl_m1 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0,resolveConfigWithProvenance as resolveConfigWithProvenance_m1 } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0,rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { composeRuntimePreflight as composeRuntimePreflight_m0,composeRuntimePreflight as composeRuntimePreflight_m1 } from "../../../../src/backend/app/preflight/runtime-admission.js";
import { createRuntimePreflightRunners as createRuntimePreflightRunners_m0,createRuntimePreflightRunners as createRuntimePreflightRunners_m1 } from "../../../../src/backend/app/preflight/runtime-runners.js";
import { claimWithPreflight as claimWithPreflight_m0,claimWithPreflight as claimWithPreflight_m1,preflightSessionFactory as preflightSessionFactory_m0,preflightSessionFactory as preflightSessionFactory_m1 } from "../../../../src/backend/app/preflight/worker-admission.js";
import { createCommandKernel as createCommandKernel_m0,createCommandKernel as createCommandKernel_m1,type CommandKernelDependencies as CommandKernelDependencies_m0,type CommandKernelDependencies as CommandKernelDependencies_m1 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { runQueuedSpanEvent as runQueuedSpanEvent_m1 } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createStartPlanService as createStartPlanService_m0,createStartPlanService as createStartPlanService_m1 } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService as RunRecordService_m0,RunRecordService as RunRecordService_m1 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime as selectRunRuntime_m0,selectRunRuntime as selectRunRuntime_m1 } from "../../../../src/backend/runs/settings/run-settings.js";
import { workflowPreflightScope as workflowPreflightScope_m0 } from "../../../../src/backend/runs/start/preflight-scope.js";
import { createPreflightReportService as createPreflightReportService_m0 } from "../../../../src/backend/runtime/preflight/report-service.js";
import { RuntimeAdmission as RuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { createTimelineEmitter as createTimelineEmitter_m1 } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { admitWorkerPoolRoster as admitWorkerPoolRoster_m0 } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { hostConfigFacts as hostConfigFacts_m0,hostConfigFacts as hostConfigFacts_m1 } from "../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord as initialProtectedStoreRecord_m0,PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m0,ProtectedStoreRecordSchema as ProtectedStoreRecordSchema_m0 } from "../../../../src/models/config/protected-settings.js";
import type { RuntimeCapability as RuntimeCapability_m0 } from "../../../../src/models/preflight/preflight-contract.js";
import { RunRecordSchema as RunRecordSchema_m0 } from "../../../../src/models/run/record.js";
import { CommandRequestSchema as CommandRequestSchema_m0 } from "../../../../src/rules/commands/commands.js";
import { ActorIdSchema as ActorIdSchema_m1,FingerprintSchema as FingerprintSchema_m0 } from "../../../../src/rules/identity/ids.js";
import { PreflightAdmissionRefusal as PreflightAdmissionRefusal_m0,PreflightAdmissionRefusal as PreflightAdmissionRefusal_m1 } from "../../../../src/rules/preflight/preflight-admission.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex as sha256Hex_m1 } from "../../../../src/rules/validation/sha256.js";
import { NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m0,NO_INTAKE_PROJECTIONS as NO_INTAKE_PROJECTIONS_m1,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m0,UNWIRED_INTAKE_PARSER as UNWIRED_INTAKE_PARSER_m1 } from "../../../support/fixtures/intake-kernel-seams.js";
import { sequentialIdFactory as sequentialIdFactory_m0,sequentialIdFactory as sequentialIdFactory_m1 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createPreflightHarness as createPreflightHarness_m0,healthyRuntimePreflightRunners as healthyRuntimePreflightRunners_m0 } from "../../../support/fixtures/preflight-seams.js";
import { populatedProtectedRecord as populatedProtectedRecord_m1,runtimeFixture as runtimeFixture_m1 } from "../../../support/fixtures/preflight/runtime-fixture.js";
import { testWorkerPorts as testWorkerPorts_m1 } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { ManualScheduler as ManualScheduler_m0,ManualScheduler as ManualScheduler_m1 } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor as personLookupDescriptor_m0,personLookupDescriptor as personLookupDescriptor_m1 } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0).reverse()) dispose(); };
const signal = (): AbortSignal => new AbortController().signal;
function harness() {
  const repoRoot = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "preflight-admission-"));
  const stateRoot = join_m0(repoRoot, rebuildRuntimeIsolation_m0.stateRoot); mkdirSync_m0(stateRoot, { recursive: true });
  const clock = manualClock_m0(new Date("2026-09-19T12:00:00Z"));
  const database = AuthorityDatabase_m0.open({ path: join_m0(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "preflight-test" }, clock);
  cleanup.push(() => { database.close(); rmSync_m0(repoRoot, { recursive: true, force: true }); });
  const resolved = resolveConfigWithProvenance_m0({}, hostConfigFacts_m0({}), clock);
  const identity = { configSnapshotId: "66666666-6666-4666-8666-666666666666", configFingerprint: resolved.fingerprint };
  database.authority.runtimeConfig.initialize({ configSnapshotId: identity.configSnapshotId, fingerprint: resolved.fingerprint,
    config: resolved.config, provenance: resolved.provenance, revision: 1, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor_m0.id ? personLookupDescriptor_m0 : undefined };
  let protectedRecord = initialProtectedStoreRecord_m0();
  const faults = new Set<string>(); const probes: string[] = []; let supportMissing = false;
  const preflight = composeRuntimePreflight_m0({ admission: RuntimeAdmission_m0.syntheticRoots(stateRoot, join_m0(repoRoot, rebuildRuntimeIsolation_m0.artifactRoot)),
    database, clock, repoRoot, isolation: rebuildRuntimeIsolation_m0, descriptors,
    descriptorSetHash: personLookupDescriptor_m0.contractFingerprint, protectedSecrets: { read: () => protectedRecord }, environment: {},
    runnerFactory: input => {
      const available = healthyRuntimePreflightRunners_m0(input);
      const missing = supportMissing ? createRuntimePreflightRunners_m0(input).find(runner => runner.check === "browser.assets") : undefined;
      return available.map(runner => missing !== undefined && runner.check === "browser.assets" ? missing : ({ ...runner, async run(context) {
        probes.push(runner.check);
        return faults.has(runner.check) ? { check: runner.check, state: "unhealthy" as const, summary: "Controlled dependency unavailable", impact: "Selected work cannot use it" } : runner.run(context);
      } }));
    } });
  let publications = 0;
  const lifecycle = new RunRecordService_m0({ database, clock, ids: sequentialIdFactory_m0("b"), publishQueued: () => { publications += 1; },
    admitQueuedRun: run => preflight.admission.assertReady(preflight.runScope(run.envelope)) });
  const plans = createStartPlanService_m0({ authority: database, authorityRead: database, descriptors, clock, ids: sequentialIdFactory_m0("a"),
    planTtlMs: 600_000, ...identity, plannedBy: "local-operator", preflight: preflight.admission });
  const unexpected = (): never => { throw new Error("Unexpected unrelated effect"); };
  const kernelDependencies: CommandKernelDependencies_m0 = { lifecycle, authority: database, clock, ids: sequentialIdFactory_m0("c"), appVersion: "0.1.0", descriptors,
    preflight: preflight.admission, configIdentity: identity, intakeParser: UNWIRED_INTAKE_PARSER_m0, intakeProjections: NO_INTAKE_PROJECTIONS_m0,
    writeResolution: { resolvePresent: unexpected, resolveAbsent: unexpected },
    workerRuntime: { pool: {planPoolWorkerCount:unexpected,spawnPoolWorker:unexpected,refreshPoolBrowser:unexpected,reopenPoolBrowser:unexpected,stopPoolWorker:unexpected,pausePoolWorker:unexpected,resumePoolWorker:unexpected} } };
  const kernel = createCommandKernel_m0(kernelDependencies);
  const ingress = { workflowId: personLookupDescriptor_m0.id, submissions: [{ emplId: "10873698" }], dryRun: false };
  const command = (plan: ReturnType<typeof plans.plan>) => ({ commandId: "99999999-9999-4999-8999-999999999999", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  return { clock, database, stateRoot, repoRoot, identity, preflight, faults, probes, plans, kernel, lifecycle, kernelWith: (workerRuntime: CommandKernelDependencies_m0["workerRuntime"]) => createCommandKernel_m0({ ...kernelDependencies, workerRuntime }), ingress, command, get publications() { return publications; }, changeProtected() {
    protectedRecord = ProtectedStoreRecordSchema_m0.parse({ ...protectedRecord, revision: 2,
      lastApplied: { commandId: "77777777-7777-4777-8777-777777777777", commandFingerprint: "7".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m0, writeId: "88888888-8888-4888-8888-888888888888" } });
  }, missing() { supportMissing = true; } };
}

it_m0("real plan/kernel/lifecycle admits healthy work and exact replay stays read-only after a fault", async () => {
try {


  const h = harness(); await h.plans.prepare?.(h.ingress, signal());
  const plan = h.plans.plan(h.ingress); const command = h.command(plan);
  assert_m0.equal(h.kernel.execute(command).state, "applied");
  assert_m0.equal(h.publications, 1); assert_m0.equal(h.database.authority.runs.listByWorkflow(plan.workflowId).length, 1);
  h.faults.add("endpoint.ucpath.prod"); await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId), signal());
  const count = h.probes.length;
  assert_m0.equal(h.kernel.execute(command).state, "already-applied");
  assert_m0.equal(h.probes.length, count); assert_m0.equal(h.publications, 1);

} finally {
_afterEachFixture0();
}
});

it_m0("required faults and missing detector support prevent plan/enqueue effects", async () => {
try {


  for (const missing of [false, true]) {
    const h = harness(); if (missing) h.missing(); else h.faults.add("endpoint.ucpath.prod");
    const generation = h.database.getMeta().authorityGeneration;
    await assert_m0.rejects(h.plans.prepare?.(h.ingress, signal()) ?? Promise.reject(new Error("fixture preparation is missing")), PreflightAdmissionRefusal_m0);
    assert_m0.throws(() => h.plans.plan(h.ingress), PreflightAdmissionRefusal_m0);
    assert_m0.equal(h.publications, 0); assert_m0.equal(h.database.authority.runs.listByWorkflow(h.ingress.workflowId).length, 0);
    assert_m0.equal(h.database.getMeta().authorityGeneration, generation);
  }

} finally {
_afterEachFixture0();
}
});

it_m0("a fault after planning refuses confirmation before plan consumption or session creation", async () => {
try {


  const h = harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  h.faults.add("endpoint.ucpath.prod"); await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId), signal());
  const result = h.kernel.execute(h.command(plan)); assert_m0.equal(result.state, "rejected");
  assert_m0.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  assert_m0.equal(h.database.authority.runSessions.listByWorkflow(plan.workflowId).length, 0); assert_m0.equal(h.publications, 0);

} finally {
_afterEachFixture0();
}
});

it_m0("optional or unselected faults leave unrelated valid scopes usable; instance scopes cannot substitute", async () => {
try {


  const h = harness(); h.faults.add("provider.census"); h.faults.add("endpoint.ucpath.test");
  await h.plans.prepare?.(h.ingress, signal()); assert_m0.equal(h.kernel.execute(h.command(h.plans.plan(h.ingress))).state, "applied");
  assert_m0.ok(!h.probes.includes("endpoint.ucpath.test"));
  const scope = h.preflight.currentScope(h.ingress.workflowId);
  const optional = { ...scope, requestedCapabilities: [...scope.requestedCapabilities, "provider.census" as RuntimeCapability_m0].sort() };
  const report = await h.preflight.admission.prepare(optional, signal());
  assert_m0.equal(report.results.find(result => result.check === "provider.census")?.status, "warning"); h.preflight.admission.assertReady(optional);
  assert_m0.throws(
    () => h.preflight.admission.assertReady(h.preflight.currentScope(h.ingress.workflowId, { ucpath: "test" })),
    (error: unknown) => error instanceof PreflightAdmissionRefusal_m0 && error.reason === "scope-mismatch",
  );

} finally {
_afterEachFixture0();
}
});

it_m0("wrong fingerprints and divergent scoped reruns refuse before probes; failed and in-flight replay is stable", async () => {
try {


  const h = harness(); const dashboard = createPreflightHarness_m0(h.clock, h.identity.configFingerprint).authority;
  const service = createPreflightReportService_m0({ dashboard, runtime: h.preflight, clock: h.clock });
  const command = { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight", target: {
    expectedConfigFingerprint: h.identity.configFingerprint, expectedDescriptorFingerprint: personLookupDescriptor_m0.contractFingerprint, selection: { workflowId: personLookupDescriptor_m0.id } } };
  const wrong = { ...command, target: { ...command.target, expectedDescriptorFingerprint: "f".repeat(64) } };
  const first = await service.execute(wrong, signal()).catch((error: unknown) => error);
  assert_m0.ok(first instanceof PreflightAdmissionRefusal_m0); assert_m0.equal(h.probes.length, 0);
  assert_m0.equal(await service.execute(wrong, signal()).catch((error: unknown) => error), first);
  await assert_m0.rejects(service.execute(command, signal()), /divergent/); assert_m0.equal(h.probes.length, 0);
  const next = { ...command, commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
  const [a, b] = await Promise.all([service.execute(next, signal()), service.execute(next, signal())]); assert_m0.deepEqual(a, b);
  const count = h.probes.length; assert_m0.deepEqual(await service.execute(next, signal()), a); assert_m0.equal(h.probes.length, count);
  h.clock.advanceWall(60_000); h.clock.advanceMonotonic(60_000); assert_m0.equal(service.read(command.target.selection).state, "unavailable");

} finally {
_afterEachFixture0();
}
});

it_m0("claim checks the selected retained run before writing; browser gate refuses a new fault before open", async () => {
try {


  const h = harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  assert_m0.equal(h.kernel.execute(h.command(plan)).state, "applied");
  const original = h.database.authority.runs.listByWorkflow(plan.workflowId)[0]; assert_m0.ok(original);
  h.clock.advanceWall(60_000); h.clock.advanceMonotonic(60_000); h.faults.add("endpoint.ucpath.prod");
  const request = { commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", workflow: plan.workflowId, workerId: "preflight-worker", runtimeConfig: selectRunRuntime_m0(h.database.authority) };
  const generation = h.database.getMeta().authorityGeneration;
  await assert_m0.rejects(claimWithPreflight_m0({ preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext(request, admit) }), PreflightAdmissionRefusal_m0);
  assert_m0.deepEqual(h.database.authority.runs.get(original.envelope.runId), original); assert_m0.equal(h.database.getMeta().authorityGeneration, generation);
  h.faults.clear(); await h.preflight.admission.prepare(h.preflight.runScope(original.envelope), signal());
  const claimed = await claimWithPreflight_m0({ preflight: h.preflight, signal: signal(), claim: admit => h.lifecycle.claimNext(request, admit) }); assert_m0.equal(claimed.state, "applied");
  let opens = 0;
  const factory = preflightSessionFactory_m0({ open: async () => { opens += 1; throw new Error("counted browser effect"); } }, h.preflight, h.preflight.runScope(original.envelope));
  const open = { workerId: "preflight-worker" as Parameters<typeof factory.open>[0]["workerId"], workflowId: personLookupDescriptor_m0.id,
    system: "ucpath" as const, instance: "prod", configFingerprint: original.envelope.configFingerprint, acceptDownloads: false, exclusive: false, signal: signal(),
    duoCeremony: {} as Parameters<typeof factory.open>[0]["duoCeremony"] };
  await assert_m0.rejects(factory.open(open), /counted browser effect/); assert_m0.equal(opens, 1);
  h.faults.add("endpoint.ucpath.prod"); await assert_m0.rejects(factory.open(open), PreflightAdmissionRefusal_m0); assert_m0.equal(opens, 1);
  const stale = RunRecordSchema_m0.parse({ ...original, envelope: { ...original.envelope, contractFingerprint: "f".repeat(64) } });
  assert_m0.throws(() => h.preflight.runScope(stale.envelope), PreflightAdmissionRefusal_m0);

} finally {
_afterEachFixture0();
}
});

it_m0("descriptor scope is derived from graph systems rather than a caller capability list", async () => {
try {


  const h = harness(); const scope = workflowPreflightScope_m0(personLookupDescriptor_m0, h.identity);
  assert_m0.ok(scope.requestedCapabilities.includes("system.ucpath.prod"));
  assert_m0.throws(() => workflowPreflightScope_m0(personLookupDescriptor_m0, { ...h.identity, descriptorFingerprint: FingerprintSchema_m0.parse("f".repeat(64)) }), PreflightAdmissionRefusal_m0);

} finally {
_afterEachFixture0();
}
});

it_m0("production worker process composition refuses preflight before spawn and admits a healthy positive control", async () => {
try {


  const h = harness(); let spawns = 0; let exit: ((code: number | null, signal: string | null) => void) | undefined;
  const plan = CommandRequestSchema_m0.parse({ commandId: "33333333-3333-4333-8333-333333333333", requestedAt: h.clock.now().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "plan-worker-count",
    target: { workflowId: personLookupDescriptor_m0.id, expectedVersion: 0 }, payload: { desiredWorkers: 1 } });
  assert_m0.equal(plan.type, "plan-worker-count");
  if (plan.type !== "plan-worker-count") assert_m0.fail("fixture plan required");
  const roster = h.database.withAuthorityTransaction(repositories => {
    repositories.commands.insert(plan);
    return admitWorkerPoolRoster_m0(repositories, plan, h.clock.now().toISOString());
  });
  const slot = roster.selected[0]; assert_m0.ok(slot);
  const workerId = slot.workerId;
  const control = composeWorkerProcessControl_m0({ processLockRoot:join_m0(h.stateRoot,"locks"),profileRoot:join_m0(h.repoRoot,rebuildRuntimeIsolation_m0.browserProfileRoot), database: h.database, clock: h.clock, scheduler: new ManualScheduler_m0(h.clock, 0),
    preflight: h.preflight, launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: () => {
      spawns += 1;
      assert_m0.equal(h.database.authority.workerLeases.start({ workerId, workflow: personLookupDescriptor_m0.id,
        browserSystems: ["ucpath", "crm"], processId: 4242, requestedBy: "local-operator", now: h.clock.now().toISOString() }).state, "started");
      return { pid: 4242, onExit: listener => { exit = listener; }, onError() {}, kill: () => true };
    }, birth: { pollMs: 250, timeoutMs: 10_000 }, onFault: error => { throw error; } });
  const kernel = h.kernelWith(control.workerRuntime);
  const command = (id: string) => ({ commandId: id, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type: "spawn-worker", target: { workflowId: personLookupDescriptor_m0.id, expectedVersion: 1 }, payload: { workerId } });
  h.faults.add("browser.assets");
  assert_m0.equal((await kernel.executeWorkerPool(command("11111111-1111-4111-8111-111111111111"))).state, "rejected");
  assert_m0.equal(spawns, 0); assert_m0.equal(h.database.authority.workerLeases.get(workerId), undefined);
  h.faults.clear(); const healthy = command("22222222-2222-4222-8222-222222222222");
  assert_m0.equal((await kernel.executeWorkerPool(healthy)).state, "applied"); assert_m0.equal(spawns, 1);
  h.faults.add("browser.assets"); const probes = h.probes.length;
  assert_m0.equal((await kernel.executeWorkerPool(healthy)).state, "already-applied"); assert_m0.equal(spawns, 1); assert_m0.equal(h.probes.length, probes);
  assert_m0.ok(exit); exit(0, null); control.supervisor.close();

} finally {
_afterEachFixture0();
}
});

it_m0("a protected-settings revision change invalidates admission without reusing a recent healthy report", async () => {
try {


  const h = harness(); await h.plans.prepare?.(h.ingress, signal()); const plan = h.plans.plan(h.ingress);
  h.changeProtected(); const count = h.probes.length;
  assert_m0.equal(h.kernel.execute(h.command(plan)).state, "rejected"); assert_m0.equal(h.publications, 0); assert_m0.equal(h.probes.length, count);
  assert_m0.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  await h.plans.prepare?.(h.ingress, signal()); assert_m0.equal(h.kernel.execute(h.command(plan)).state, "applied");

} finally {
_afterEachFixture0();
}
});
}

{


const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0).reverse()) dispose(); };
const signal = (): AbortSignal => new AbortController().signal;
function harness() {
  const f = runtimeFixture_m1(["executor.run", "system.ucpath.prod", "system.crm.prod"]);
  const {root:repoRoot, clock}=f;
  const database=AuthorityDatabase_m1.open({path:f.databasePath,busyTimeoutMs:250,migrationOwner:"setup-admission"},clock);
  cleanup.push(()=>{database.close();f.close();});
  const resolved = {...resolveConfigWithProvenance_m1({},hostConfigFacts_m1({}),clock),config:f.input.config,fingerprint:sha256Hex_m1(canonicalJsonStringify_m1(f.input.config))};
  const identity = { configSnapshotId: "66666666-6666-4666-8666-666666666666", configFingerprint: resolved.fingerprint };
  database.authority.runtimeConfig.initialize({ configSnapshotId: identity.configSnapshotId, fingerprint: resolved.fingerprint,
    config: resolved.config, provenance: resolved.provenance, revision: 1, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor_m1.id ? personLookupDescriptor_m1 : undefined };
  let probes=0;
  const preflight=composeRuntimePreflight_m1({ admission: RuntimeAdmission_m1.syntheticRoots(join_m1(repoRoot, rebuildRuntimeIsolation_m1.stateRoot), join_m1(repoRoot, rebuildRuntimeIsolation_m1.artifactRoot)),database,clock,repoRoot,isolation:rebuildRuntimeIsolation_m1,descriptors,
    descriptorSetHash:personLookupDescriptor_m1.contractFingerprint,protectedSecrets:f.input.protectedSecrets,environment:{},
    runnerFactory:input=>createRuntimePreflightRunners_m1({...input,browserExecutablePath:()=>f.executable,dashboard:f.input.dashboard,providerAvailability:f.input.providerAvailability}).map(runner=>({...runner,run(context){probes++;return runner.run(context);}}))});
  let publications = 0;
  const lifecycle = new RunRecordService_m1({ database, clock, ids: sequentialIdFactory_m1("b"), publishQueued: run => { publications += 1; createTimelineEmitter_m1({repository:database.authority.timelineEvents,clock}).emit(runQueuedSpanEvent_m1({run,actorId:ActorIdSchema_m1.parse("local-operator"),title:"Synthetic Setup admission proof"})); },
    admitQueuedRun: run => preflight.admission.assertReady(preflight.runScope(run.envelope)) });
  const plans = createStartPlanService_m1({ authority: database, authorityRead: database, descriptors, clock, ids: sequentialIdFactory_m1("a"),
    planTtlMs: 600_000, ...identity, plannedBy: "local-operator", preflight: preflight.admission });
  const unexpected = (): never => { throw new Error("Unexpected unrelated effect"); };
  const kernelDependencies: CommandKernelDependencies_m1 = { lifecycle, authority: database, clock, ids: sequentialIdFactory_m1("c"), appVersion: "0.1.0", descriptors,
    preflight: preflight.admission, configIdentity: identity, intakeParser: UNWIRED_INTAKE_PARSER_m1, intakeProjections: NO_INTAKE_PROJECTIONS_m1,
    writeResolution: { resolvePresent: unexpected, resolveAbsent: unexpected },
    workerRuntime: { pool: { planPoolWorkerCount: unexpected, spawnPoolWorker: unexpected, refreshPoolBrowser: unexpected, reopenPoolBrowser: unexpected, stopPoolWorker: unexpected, pausePoolWorker: unexpected, resumePoolWorker: unexpected } } };
  const kernel = createCommandKernel_m1(kernelDependencies);
  const ingress = { workflowId: personLookupDescriptor_m1.id, submissions: [{ emplId: "10873698" }], dryRun: false };
  const command = (plan: ReturnType<typeof plans.plan>) => ({ commandId: "99999999-9999-4999-8999-999999999999", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  return {f,clock,database,preflight,plans,kernel,lifecycle,ingress,command,kernelWith:(workerRuntime:CommandKernelDependencies_m1["workerRuntime"])=>createCommandKernel_m1({...kernelDependencies,workerRuntime}),get probes(){return probes;},get publications(){return publications;}};
}

it_m1("real detectors block enqueue for a missing workflow secret, then admit after explicit repair; replay remains read-only",async()=>{
try {


  const h=harness();h.f.setProtected(populatedProtectedRecord_m1("ucpathPassword"));
  const generation=h.database.getMeta().authorityGeneration;
  await assert_m1.rejects(h.plans.prepare?.(h.ingress,signal())??Promise.reject(new Error("missing prepare")),PreflightAdmissionRefusal_m1);
  assert_m1.throws(()=>h.plans.plan(h.ingress),PreflightAdmissionRefusal_m1);
  assert_m1.equal(h.database.getMeta().authorityGeneration,generation);assert_m1.equal(h.publications,0);assert_m1.equal(h.database.authority.runs.listByWorkflow(h.ingress.workflowId).length,0);
  h.f.setProtected(populatedProtectedRecord_m1());await h.plans.prepare?.(h.ingress,signal());const plan=h.plans.plan(h.ingress),command=h.command(plan);
  assert_m1.equal(h.kernel.execute(command).state,"applied");assert_m1.equal(h.publications,1);
  h.f.setProtected(populatedProtectedRecord_m1("ucpathPassword"));await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId),signal());const probes=h.probes;
  assert_m1.equal(h.kernel.execute(command).state,"already-applied");assert_m1.equal(h.probes,probes);assert_m1.equal(h.publications,1);

} finally {
_afterEachFixture0();
}
});
it_m1("claim and browser consumers reject actual missing assets before effects, with healthy controls",async()=>{
try {


  const h=harness();await h.plans.prepare?.(h.ingress,signal());const plan=h.plans.plan(h.ingress);assert_m1.equal(h.kernel.execute(h.command(plan)).state,"applied");
  const original=h.database.authority.runs.listByWorkflow(plan.workflowId)[0];assert_m1.ok(original);
  testWorkerPorts_m1(h.database, h.clock, { path: h.f.databasePath, descriptor: personLookupDescriptor_m1, poolIndex: 1 });
  const workerId = h.database.authority.workerSlots.list(personLookupDescriptor_m1.id)[0].workerId;
  const request={commandId:"ffffffff-ffff-4fff-8fff-ffffffffffff",workflow:plan.workflowId,workerId,runtimeConfig:selectRunRuntime_m1(h.database.authority)};
  renameSync_m1(h.f.executable,`${h.f.executable}.parked`);h.clock.advanceWall(60_000);h.clock.advanceMonotonic(60_000);
  const generation=h.database.getMeta().authorityGeneration;
  await assert_m1.rejects(claimWithPreflight_m1({preflight:h.preflight,signal:signal(),claim:admit=>h.lifecycle.claimNext(request,admit)}),PreflightAdmissionRefusal_m1);
  assert_m1.equal(h.database.getMeta().authorityGeneration,generation);assert_m1.deepEqual(h.database.authority.runs.get(original.envelope.runId),original);
  renameSync_m1(`${h.f.executable}.parked`,h.f.executable);await h.preflight.admission.prepare(h.preflight.runScope(original.envelope),signal());
  assert_m1.equal((await claimWithPreflight_m1({preflight:h.preflight,signal:signal(),claim:admit=>h.lifecycle.claimNext(request,admit)})).state,"applied");
  let opens=0;const factory=preflightSessionFactory_m1({open:async()=>{opens++;throw new Error("counted browser effect");}},h.preflight,h.preflight.runScope(original.envelope));
  const open={workerId:workerId,workflowId:personLookupDescriptor_m1.id,system:"ucpath" as const,instance:"prod",configFingerprint:original.envelope.configFingerprint,acceptDownloads:false,exclusive:false,signal:signal(),duoCeremony:{} as Parameters<typeof factory.open>[0]["duoCeremony"]};
  await assert_m1.rejects(factory.open(open),/counted browser effect/u);assert_m1.equal(opens,1);
  h.f.setProtected(populatedProtectedRecord_m1("ucpathPassword"));await assert_m1.rejects(factory.open(open),PreflightAdmissionRefusal_m1);assert_m1.equal(opens,1);

} finally {
_afterEachFixture0();
}
});
it_m1("production worker process composition refuses preflight before spawn and admits a healthy positive control", async () => {
try {


  const h = harness(); let spawns = 0; let exit: ((code: number | null, signal: string | null) => void) | undefined;
  let workerId = "";
  const control = composeWorkerProcessControl_m1({ profileRoot: h.f.input.config.paths.browserProfileRoot, processLockRoot: join_m1(h.f.stateRoot, "locks"), database: h.database, clock: h.clock, scheduler: new ManualScheduler_m1(h.clock, 0),
    preflight: h.preflight, launch: { command: "/fixture/node", prefixArgs: [], cwd: "/fixture", environment: {} },
    spawn: () => {
      spawns += 1;
      assert_m1.equal(h.database.authority.workerLeases.start({ workerId, workflow: personLookupDescriptor_m1.id,
        browserSystems: ["ucpath", "crm"], processId: 4242, requestedBy: "local-operator", now: h.clock.now().toISOString() }).state, "started");
      return { pid: 4242, onExit: listener => { exit = listener; }, onError() {}, kill: () => true };
    }, birth: { pollMs: 250, timeoutMs: 10_000 }, onFault: error => { throw error; } });
  const kernel = h.kernelWith(control.workerRuntime);
  assert_m1.equal((await kernel.executeWorkerPool({ commandId: "33333333-3333-4333-8333-333333333333", requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "plan-worker-count", target: { workflowId: personLookupDescriptor_m1.id, expectedVersion: 0 }, payload: { desiredWorkers: 1 } })).state, "applied");
  const slot = h.database.authority.workerSlots.list(personLookupDescriptor_m1.id)[0]; assert_m1.ok(slot); workerId = slot.workerId;
  const command = (id: string) => ({ commandId: id, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type: "spawn-worker", target: { workflowId: personLookupDescriptor_m1.id, expectedVersion: h.database.authority.workerPools.get(personLookupDescriptor_m1.id)?.version }, payload: { workerId } });
  renameSync_m1(h.f.executable,`${h.f.executable}.parked`);
  assert_m1.equal((await kernel.executeWorkerPool(command("11111111-1111-4111-8111-111111111111"))).state, "rejected");
  assert_m1.equal(spawns, 0); assert_m1.equal(h.database.authority.workerLeases.get(workerId), undefined);
  renameSync_m1(`${h.f.executable}.parked`,h.f.executable); const healthy = command("22222222-2222-4222-8222-222222222222");
  assert_m1.equal((await kernel.executeWorkerPool(healthy)).state, "applied"); assert_m1.equal(spawns, 1);
  renameSync_m1(h.f.executable,`${h.f.executable}.parked`); const probes = h.probes;
  assert_m1.equal((await kernel.executeWorkerPool(healthy)).state, "already-applied"); assert_m1.equal(spawns, 1); assert_m1.equal(h.probes, probes);
  assert_m1.ok(exit); exit(0, null); control.supervisor.close();

} finally {
_afterEachFixture0();
}
});

it_m1("an unavailable optional executable provider leaves real unrelated admission usable; stale config refuses before probes",async()=>{
try {


  const h=harness();const scope=h.preflight.currentScope(h.ingress.workflowId);
  Reflect.set(h.f.input.providerAvailability, "census/geocode.census", false);
  const optional={...scope,requestedCapabilities:[...scope.requestedCapabilities,"provider.census" as const]};
  const report=await h.preflight.admission.prepare(optional,signal());
  assert_m1.equal(report.results.find(check=>check.check==="provider.census")?.status,"warning");h.preflight.admission.assertReady(optional);
  const probes=h.probes;
  await assert_m1.rejects(h.preflight.admission.prepare({...scope,configFingerprint:"f".repeat(64) as typeof scope.configFingerprint},signal()));assert_m1.equal(h.probes,probes);
  await h.plans.prepare?.(h.ingress,signal());assert_m1.equal(h.kernel.execute(h.command(h.plans.plan(h.ingress))).state,"applied");assert_m1.equal(h.publications,1);

} finally {
_afterEachFixture0();
}
});
}
