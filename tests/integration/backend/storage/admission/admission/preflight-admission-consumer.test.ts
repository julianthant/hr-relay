import { join } from "node:path";
import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { renameSync } from "node:fs";
import { runtimeFixture, populatedProtectedRecord } from "../../../../../support/fixtures/preflight/runtime-fixture.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../../src/backend/runs/commands/run-queued-span.js";
import { composeWorkerProcessControl } from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import { poolWorkerId } from "../../../../../../src/backend/runtime/workers/worker-loop.js";
import { PositiveIntSchema } from "../../../../../../src/rules/identity/ids.js";
import { ManualScheduler } from "../../../../../support/helpers/phase1f-executor-harness.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { initialSettingsFileRecord } from "../../../../../../src/models/config/settings.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { composeRuntimePreflight } from "../../../../../../src/backend/app/preflight/runtime-admission.js";
import { createRuntimePreflightRunners } from "../../../../../../src/backend/app/preflight/runtime-runners.js";
import { createStartPlanService } from "../../../../../../src/backend/runs/commands/start-plan-service.js";
import { createCommandKernel, type CommandKernelDependencies } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../../../src/backend/runs/settings/run-settings.js";
import { claimWithPreflight, preflightSessionFactory } from "../../../../../../src/backend/app/preflight/worker-admission.js";
import { PreflightAdmissionRefusal } from "../../../../../../src/rules/preflight/preflight-admission.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../../../../support/fixtures/archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../../../support/fixtures/intake-kernel-seams.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
const signal = (): AbortSignal => new AbortController().signal;
function harness() {
  const f = runtimeFixture(["executor.run", "system.ucpath.prod", "system.crm.prod"]);
  const {root:repoRoot, clock}=f;
  const database=AuthorityDatabase.open({path:f.databasePath,busyTimeoutMs:250,migrationOwner:"setup-admission"},clock);
  cleanup.push(()=>{database.close();f.close();});
  const resolved = {...resolveConfigWithProvenance({},hostConfigFacts({}),clock),config:f.input.config,fingerprint:sha256Hex(canonicalJsonStringify(f.input.config))};
  const baseline = initialSettingsFileRecord();
  const identity = { configSnapshotId: "66666666-6666-4666-8666-666666666666", configFingerprint: resolved.fingerprint };
  database.authority.configSnapshots.insert({ configSnapshotId: identity.configSnapshotId, fingerprint: resolved.fingerprint,
    config: resolved.config, provenance: resolved.provenance, revision: 1, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  database.authority.runtimeConfig.activate({ ...identity, settingsRevision: baseline.revision, settingsFingerprint: baseline.settingsFingerprint, activatedAt: clock.now().toISOString() });
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
  let probes=0;
  const preflight=composeRuntimePreflight({ admission: RuntimeAdmission.syntheticRoots(join(repoRoot, rebuildRuntimeIsolation.stateRoot), join(repoRoot, rebuildRuntimeIsolation.artifactRoot)),database,clock,repoRoot,isolation:rebuildRuntimeIsolation,descriptors,
    descriptorSetHash:personLookupDescriptor.contractFingerprint,protectedSecrets:f.input.protectedSecrets,environment:{},
    runnerFactory:input=>createRuntimePreflightRunners({...input,browserExecutablePath:()=>f.executable,dashboard:f.input.dashboard}).map(runner=>({...runner,run(context){probes++;return runner.run(context);}}))});
  let publications = 0;
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("b"), publishQueued: run => { publications += 1; createTimelineEmitter({repository:database.authority.timelineEvents,clock}).emit(runQueuedSpanEvent({run,actorId:ActorIdSchema.parse("local-operator"),title:"Synthetic Setup admission proof"})); },
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
  return {f,clock,database,preflight,plans,kernel,lifecycle,ingress,command,kernelWith:(workerRuntime:CommandKernelDependencies["workerRuntime"])=>createCommandKernel({...kernelDependencies,workerRuntime}),get probes(){return probes;},get publications(){return publications;}};
}

it("real detectors block enqueue for a missing workflow secret, then admit after explicit repair; replay remains read-only",async()=>{
  const h=harness();h.f.setProtected(populatedProtectedRecord("ucpathPassword"));
  const generation=h.database.getMeta().authorityGeneration;
  await assert.rejects(h.plans.prepare?.(h.ingress,signal())??Promise.reject(new Error("missing prepare")),PreflightAdmissionRefusal);
  assert.throws(()=>h.plans.plan(h.ingress),PreflightAdmissionRefusal);
  assert.equal(h.database.getMeta().authorityGeneration,generation);assert.equal(h.publications,0);assert.equal(h.database.authority.runs.listByWorkflow(h.ingress.workflowId).length,0);
  h.f.setProtected(populatedProtectedRecord());await h.plans.prepare?.(h.ingress,signal());const plan=h.plans.plan(h.ingress),command=h.command(plan);
  assert.equal(h.kernel.execute(command).state,"applied");assert.equal(h.publications,1);
  h.f.setProtected(populatedProtectedRecord("ucpathPassword"));await h.preflight.admission.prepare(h.preflight.currentScope(plan.workflowId),signal());const probes=h.probes;
  assert.equal(h.kernel.execute(command).state,"already-applied");assert.equal(h.probes,probes);assert.equal(h.publications,1);
});
it("claim and browser consumers reject actual missing assets before effects, with healthy controls",async()=>{
  const h=harness();await h.plans.prepare?.(h.ingress,signal());const plan=h.plans.plan(h.ingress);assert.equal(h.kernel.execute(h.command(plan)).state,"applied");
  const original=h.database.authority.runs.listByWorkflow(plan.workflowId)[0];assert.ok(original);
  const request={commandId:"ffffffff-ffff-4fff-8fff-ffffffffffff",workflow:plan.workflowId,workerId:"setup-worker",runtimeConfig:selectRunRuntime(h.database.authority)};
  renameSync(h.f.executable,`${h.f.executable}.parked`);h.clock.advanceWall(60_000);h.clock.advanceMonotonic(60_000);
  const generation=h.database.getMeta().authorityGeneration;
  await assert.rejects(claimWithPreflight({preflight:h.preflight,signal:signal(),claim:admit=>h.lifecycle.claimNext(request,admit)}),PreflightAdmissionRefusal);
  assert.equal(h.database.getMeta().authorityGeneration,generation);assert.deepEqual(h.database.authority.runs.get(original.envelope.runId),original);
  renameSync(`${h.f.executable}.parked`,h.f.executable);await h.preflight.admission.prepare(h.preflight.runScope(original.envelope),signal());
  assert.equal((await claimWithPreflight({preflight:h.preflight,signal:signal(),claim:admit=>h.lifecycle.claimNext(request,admit)})).state,"applied");
  let opens=0;const factory=preflightSessionFactory({open:async()=>{opens++;throw new Error("counted browser effect");}},h.preflight,h.preflight.runScope(original.envelope));
  const open={workerId:"setup-worker" as Parameters<typeof factory.open>[0]["workerId"],workflowId:personLookupDescriptor.id,system:"ucpath" as const,instance:"prod",configFingerprint:original.envelope.configFingerprint,acceptDownloads:false,exclusive:false,signal:signal(),duoCeremony:{} as Parameters<typeof factory.open>[0]["duoCeremony"]};
  await assert.rejects(factory.open(open),/counted browser effect/u);assert.equal(opens,1);
  h.f.setProtected(populatedProtectedRecord("ucpathPassword"));await assert.rejects(factory.open(open),PreflightAdmissionRefusal);assert.equal(opens,1);
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
  renameSync(h.f.executable,`${h.f.executable}.parked`);
  assert.equal((await kernel.executeWorkerPool(command("11111111-1111-4111-8111-111111111111"))).state, "rejected");
  assert.equal(spawns, 0); assert.equal(h.database.authority.workerLeases.get(workerId), undefined);
  renameSync(`${h.f.executable}.parked`,h.f.executable); const healthy = command("22222222-2222-4222-8222-222222222222");
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "applied"); assert.equal(spawns, 1);
  renameSync(h.f.executable,`${h.f.executable}.parked`); const probes = h.probes;
  assert.equal((await kernel.executeWorkerPool(healthy)).state, "already-applied"); assert.equal(spawns, 1); assert.equal(h.probes, probes);
  assert.ok(exit); exit(0, null); control.supervisor.close();
});

it("an unavailable optional executable provider leaves real unrelated admission usable; stale config refuses before probes",async()=>{
  const h=harness();const scope=h.preflight.currentScope(h.ingress.workflowId);
  const optional={...scope,requestedCapabilities:[...scope.requestedCapabilities,"provider.groq" as const]};
  const report=await h.preflight.admission.prepare(optional,signal());
  assert.equal(report.results.find(check=>check.check==="provider.groq")?.status,"warning");h.preflight.admission.assertReady(optional);
  const probes=h.probes;
  await assert.rejects(h.preflight.admission.prepare({...scope,configFingerprint:"f".repeat(64) as typeof scope.configFingerprint},signal()));assert.equal(h.probes,probes);
  await h.plans.prepare?.(h.ingress,signal());assert.equal(h.kernel.execute(h.command(h.plans.plan(h.ingress))).state,"applied");assert.equal(h.publications,1);
});
