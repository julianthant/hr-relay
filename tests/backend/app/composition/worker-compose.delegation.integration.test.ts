import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import * as storageDoctor from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createCommandKernel, executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { childExecutionModules, childExecutionRoot, childExecutionStores } from "../../../support/fixtures/child-execution-workflows.js";
import { Plan1Output, plan1Contract } from "../../../support/fixtures/plan1-operation-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { childExecutionBuildManifest } from "../../../support/fixtures/child-execution-build-manifest.js";
import type { BuildManifest } from "../../../../src/models/workflow/build-manifest.js";

vi.mock("../../../../src/backend/storage/sqlite/storage-doctor.js", { spy: true });

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.splice(0).reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "child composition cleanup failed");
});

for (const kind of ["missing-task", "foreign-task-provenance", "foreign-workflow-provenance"] as const) {
  it(`refuses ${kind} in the private compiled registry before profile or worker effects`, async () => {
    let authorityReads = 0;
    const readTask = childExecutionBuildManifest.tasks.find(entry => entry.id === "ocr/extract-form-page");
    const foreignTask = childExecutionBuildManifest.tasks.find(entry => entry.id === "ucpath/submit-write-fixture");
    const foreignWorkflow = childExecutionBuildManifest.workflows.find(entry => entry.id !== childExecutionRoot.descriptor.id);
    assert.ok(readTask && foreignTask && foreignWorkflow);
    const manifest: BuildManifest = { ...childExecutionBuildManifest,
      tasks: kind === "missing-task" ? childExecutionBuildManifest.tasks.filter(entry => entry !== readTask)
        : kind === "foreign-task-provenance" ? childExecutionBuildManifest.tasks.map(entry => entry === readTask
          ? { ...entry, fingerprint: foreignTask.fingerprint, sources: foreignTask.sources } : entry) : childExecutionBuildManifest.tasks,
      workflows: kind === "foreign-workflow-provenance" ? childExecutionBuildManifest.workflows.map(entry => entry.id === childExecutionRoot.descriptor.id
        ? { ...entry, fingerprint: foreignWorkflow.fingerprint, sources: foreignWorkflow.sources } : entry) : childExecutionBuildManifest.workflows,
    };
    await assert.rejects(composeWorkerRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, env: {},
      args: [childExecutionRoot.descriptor.id, "--pool-index", "1", "--drain"],
      get admission(): never { authorityReads++; throw new Error("unrequested-fixture-authority"); },
      executionRegistry: { resolve: id => childExecutionModules.find(module => module.descriptor.id === id), stores: childExecutionStores, manifest },
      write: () => undefined }), /different build manifest/u);
    assert.equal(authorityReads, 0);
  });
}

it("keeps a synthetic compiled workflow unavailable through the ordinary production registry", async () => {
  let authorityReads = 0;
  await assert.rejects(composeWorkerRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, env: {},
    args: [childExecutionRoot.descriptor.id, "--pool-index", "1", "--drain"],
    get admission(): never { authorityReads++; throw new Error("unrequested-fixture-authority"); },
    write: () => undefined }), /not registered/u);
  assert.equal(authorityReads, 0);
});

it("executes two real children and a nested child with one actual home process and fresh parent claims", async () => {
  assert.equal(plan1Contract.effect, "read");
  for (const module of childExecutionModules) {
    assert.ok(descriptorRuntimeNodes(module.descriptor).every(node => node.kind !== "transaction"));
    assert.deepEqual(workflowProjections(module.descriptor).systems, []);
  }
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  let runtimeAttempted = false, runtimeClosureProved = false;
  cleanup.push(async () => {
    if (runtimeAttempted && !runtimeClosureProved) throw new Error("child-composition-fixture-custody-retained");
    await profile.close();
  });
  copyFileSync(join(process.cwd(), "package.json"), join(profile.workspace, "package.json"));
  copyFileSync(join(process.cwd(), "package-lock.json"), join(profile.workspace, "package-lock.json"));
  const open = () => AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 500,
    migrationOwner: "child-composition-test" }, systemClock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  const descriptors = { resolve: (id: string) => childExecutionModules.find(module => module.descriptor.id === id)?.descriptor };
  const database = open();
  let rootRunId: string;
  try {
    const settings = readSettings(database.authority);
    const resolved = resolveConfigWithProvenance(settings.settings, hostConfigFacts({}), systemClock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize({
      configSnapshotId: randomUUID(), revision: 1, fingerprint: resolved.fingerprint, capturedAt: systemClock.now().toISOString(),
      capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
    const initial = database.authority.runtimeConfig.get();
    assert.ok(initial);
    assert.equal(initial.configFingerprint, resolved.fingerprint);
    const credentials = boundProfileCredentials(profile.admission), protectedRevision = credentials.read().revision;
    const patch = { "features.duoWebAuthn": { set: false } };
    assert.equal(executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID },
      settings: createSettingsApplicationExecutor(saved => resolveConfigWithProvenance(saved, hostConfigFacts({}), systemClock,
        { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot }), credentials) }, {
      commandId: randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      family: "settings", type: "apply-settings", target: { expectedRevision: settings.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    }).state, "applied");
    assert.equal(credentials.read().revision, protectedRevision);
    const saved = readSettings(database.authority), active = database.authority.runtimeConfig.get();
    assert.ok(active);
    assert.equal(saved.revision, settings.revision + 1);
    const current = resolveConfigWithProvenance(saved.settings, hostConfigFacts({}), systemClock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    assert.equal(current.config.features.duoWebAuthn, false);
    assert.equal(active.configFingerprint, current.fingerprint);
    assert.equal(active.settingsRevision, saved.revision);
    const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock: systemClock });
    const lifecycle = new RunRecordService({ database, clock: systemClock, ids: { uuid: randomUUID },
      resolveDescriptor: descriptors.resolve, publishQueued: run => {
        const descriptor = descriptors.resolve(run.envelope.workflow); assert.ok(descriptor);
        emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: descriptor.label }));
      } });
    const unused = (): never => { throw new Error("unrequested operator effect"); };
    const kernel = createCommandKernel({ authority: database, lifecycle, clock: systemClock, ids: { uuid: randomUUID },
      appVersion: "0.1.0", descriptors, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { recheck: unused, resolveAbsent: unused },
      workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused,
        reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
    const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock: systemClock,
      ids: { uuid: randomUUID }, planTtlMs: 600_000, configFingerprint: active.configFingerprint,
      configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const plan = planner.plan({ workflowId: childExecutionRoot.descriptor.id,
      submissions: [{ emplId: "10800000", text: "same", mode: "ok" }], dryRun: false,
      selectedStepKeys: childExecutionRoot.descriptor.timeline.map(step => step.key) });
    assert.equal(plan.planned.length, 1);
    assert.equal(plan.refused.length, 0);
    rootRunId = singleAppliedRunId(kernel.execute({ commandId: randomUUID(), requestedAt: systemClock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: childExecutionRoot.descriptor.id, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }));
  } finally { database.close(); }

  const actualDoctor = await vi.importActual<typeof storageDoctor>("../../../../src/backend/storage/sqlite/storage-doctor.js");
  const health: Awaited<ReturnType<typeof storageDoctor.doctorAuthorityStorage>>[] = [];
  const observer = vi.spyOn(storageDoctor, "doctorAuthorityStorage").mockImplementation(async (...args) => {
    const report = await actualDoctor.doctorAuthorityStorage(...args);
    health.push(report);
    return report;
  });
  cleanup.push(() => observer.mockRestore());
  runtimeAttempted = true;
  const report = await composeWorkerRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine, isolation: rebuildRuntimeIsolation,
    repoRoot: profile.workspace, args: [childExecutionRoot.descriptor.id, "--pool-index", "1", "--drain"], env: {},
    executionRegistry: { resolve: id => childExecutionModules.find(module => module.descriptor.id === id), stores: childExecutionStores,
      manifest: childExecutionBuildManifest },
    write: () => undefined }).catch((error: unknown) => {
      const observations = health.map(report => ({
        authority: report.authority.state,
        authorityCode: report.authority.state === "healthy" ? null : report.authority.cause.code,
        spans: report.spanAuthority.state,
        spanCode: report.spanAuthority.state === "unavailable" ? report.spanAuthority.cause.code : null,
        protected: report.protectedSettings.state,
        protectedCode: report.protectedSettings.state === "available" ? null : report.protectedSettings.cause.code,
        upgrades: report.authorityUpgrades.state,
        latestUpgradePhase: report.authorityUpgrades.state === "available" ? report.authorityUpgrades.phases.at(-1)?.phase ?? null : null,
      }));
      throw new AggregateError([error, new Error(JSON.stringify({ observations }))], "actual child composition failed", { cause: error });
    });
  assert.ok(health.length > 0);
  assert.ok(health.every(report => report.authority.state === "healthy" && report.spanAuthority.state === "reconciled"
    && report.protectedSettings.state === "available"));
  assert.equal(report.closure, "proved");
  runtimeClosureProved = true;
  assert.equal(report.outcomes.filter(outcome => outcome.state === "done").length, 4);
  assert.equal(report.outcomes.filter(outcome => outcome.state === "yielded-delegation").length, 3);
  assert.equal(report.outcomes.length, 7);

  const retained = open();
  try {
    const custody = retained.readProfileResourceCustody();
    assert.equal(custody.slots.length, 1);
    assert.equal(custody.leases.length, 1);
    assert.equal(custody.slots[0]?.workflow, childExecutionRoot.descriptor.id);
    assert.equal(custody.slots[0]?.workerId, report.workerId);
    assert.equal(custody.leases[0]?.processId, process.pid);
    assert.equal(custody.leases[0]?.lifecycle.state, "stopped");
    assert.equal(custody.runs.length, 4);
    assert.ok(custody.runs.every(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done"));
    const root = retained.authority.runs.get(rootRunId);
    assert.ok(root);
    assert.equal(root.claimGeneration, 3);
    const result = retained.authority.runResults.get(rootRunId);
    assert.ok(result);
    assert.deepEqual(Plan1Output.parse(result.result.value), { eid: "10800000", disposition: "same/same/same/same", providerState: "same" });
    assert.deepEqual(result.dependencies.map(dependency => dependency.state), ["child-resolved", "child-resolved"]);
    for (const run of custody.runs) {
      const value = retained.authority.runResults.get(run.envelope.runId);
      assert.ok(value);
      assert.equal(value.workflowId, run.envelope.workflow);
      assert.equal(value.contractFingerprint, run.envelope.contractFingerprint);
      assert.equal(value.configFingerprint, run.envelope.configFingerprint);
      assert.equal(value.configSnapshotId, run.envelope.configSnapshotId);
    }
    assert.equal(custody.browsers.length, 0);
    assert.equal(custody.writeIntents.length, 0);
  } finally { retained.close(); }
});
