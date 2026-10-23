import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { childExecutionModules, childExecutionRoot, childExecutionStores } from "../../../support/fixtures/child-execution-workflows.js";
import { Plan1Output } from "../../../support/fixtures/plan1-operation-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  const failures: unknown[] = [];
  for (const close of cleanup.splice(0).reverse()) {
    try { close(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "child composition cleanup failed");
});

it("executes two real children and a nested child with one actual home process and fresh parent claims", async () => {
  const profile = createBoundProfileFixture({ sharedMachine: true });
  let runtimeAttempted = false, runtimeClosureProved = false;
  cleanup.push(() => {
    if (runtimeAttempted && !runtimeClosureProved) throw new Error("child-composition-fixture-custody-retained");
    profile.close();
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
    const active = database.authority.runtimeConfig.get();
    assert.ok(active);
    assert.equal(active.configFingerprint, resolved.fingerprint);
    const lifecycle = new RunRecordService({ database, clock: systemClock, ids: { uuid: randomUUID },
      resolveDescriptor: descriptors.resolve, publishQueued: () => undefined });
    const unused = (): never => { throw new Error("unrequested operator effect"); };
    const kernel = createCommandKernel({ authority: database, lifecycle, clock: systemClock, ids: { uuid: randomUUID },
      appVersion: "0.1.0", descriptors, configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { resolvePresent: unused, resolveAbsent: unused },
      workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused,
        reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
    const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock: systemClock,
      ids: { uuid: randomUUID }, planTtlMs: 600_000, configFingerprint: active.configFingerprint,
      configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
    const plan = planner.plan({ workflowId: childExecutionRoot.descriptor.id,
      submissions: [{ emplId: "10800000", text: "same", mode: "ok" }], dryRun: true,
      selectedStepKeys: childExecutionRoot.descriptor.timeline.map(step => step.key) });
    rootRunId = singleAppliedRunId(kernel.execute({ commandId: randomUUID(), requestedAt: systemClock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: childExecutionRoot.descriptor.id, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }));
  } finally { database.close(); }

  runtimeAttempted = true;
  const report = await composeWorkerRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation,
    repoRoot: profile.workspace, args: [childExecutionRoot.descriptor.id, "--pool-index", "1", "--drain"], env: {},
    executionRegistry: { resolve: id => childExecutionModules.find(module => module.descriptor.id === id), stores: childExecutionStores },
    write: () => undefined });
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
