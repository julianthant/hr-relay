import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { assertCanonicalRunCommandScope, withCanonicalRunCommandScope } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { authenticateRootRun, authenticateStartPlanRun } from "../../../../src/backend/storage/sqlite/delegation-root-authority.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { FingerprintSchema, PositiveIntSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { seedInitialSettingsRuntimeConfig, singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.splice(0).reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "delegation root fixture cleanup failed");
});

async function fixture() {
  const profile = await createBoundProfileFixture();
  cleanup.push(async () => await profile.close());
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(profile.admission,
    { path: profile.path, busyTimeoutMs: 500, migrationOwner: "delegation-root-test" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  cleanup.push(() => database.close());
  seedInitialSettingsRuntimeConfig(database, clock);
  const active = database.authority.runtimeConfig.get();
  assert.ok(active);
  const descriptors = { resolve: (workflow: string) => workflow === fixtureDescriptor.id ? fixtureDescriptor : undefined };
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory("a"), publishQueued: () => undefined });
  const unused = (): never => { throw new Error("unrequested process effect"); };
  const kernel = createCommandKernel({ authority: database, lifecycle, clock, ids: sequentialIdFactory("c"),
    appVersion: "0.1.0", descriptors, configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused,
      reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
  const planner = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock,
    ids: sequentialIdFactory("b"), planTtlMs: 600_000, configFingerprint: active.configFingerprint,
    configSnapshotId: active.configSnapshotId, plannedBy: "local-operator" });
  const plan = planner.plan({ workflowId: fixtureDescriptor.id, submissions: [{ eid: "10812345", mode: "write" }],
    dryRun: true, priority: "bulk", selectedStepKeys: fixtureDescriptor.timeline.map(step => step.key), browserMode: "headless",
    captureBrowserScreenshots: false });
  const result = kernel.execute({ commandId: randomUUID(), requestedAt: NOW, requestedBy: "local-operator",
    source: "dashboard", family: "start", type: "start-run", target: { workflowId: fixtureDescriptor.id,
      startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  const run = database.authority.runs.get(singleAppliedRunId(result));
  assert.ok(run);
  return { database, run, kernel, lifecycle };
}

describe("retained canonical start-plan authority for a delegation root", () => {
  it("authenticates the real operator plan, creation journal and complete root options without mutation", async () => {
    const { database, run } = await fixture();
    const generation = database.getMeta().authorityGeneration;
    database.withAuthorityTransaction(repositories => {
      const proof = authenticateStartPlanRun(repositories, run);
      assert.equal(proof.audit.result.state, "applied");
      assert.equal(proof.creation.result.kind, "run");
      assert.equal(proof.session.sessionId, run.sessionId);
      assert.equal(proof.plan.dryRun, run.envelope.dryRun);
      assert.equal(proof.plan.browserMode, run.envelope.browserMode);
      assert.equal(proof.plan.captureBrowserScreenshots, run.envelope.captureBrowserScreenshots);
    });
    assert.equal(database.getMeta().authorityGeneration, generation);
  });

  it("refuses absent plan, command, audit and native creation custody", async () => {
    const { database, run } = await fixture();
    database.withAuthorityTransaction(repositories => {
      assert.throws(() => authenticateStartPlanRun({ ...repositories,
        startPlans: { ...repositories.startPlans, get: () => undefined } }, run), /delegation-root-plan-authority-unavailable/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories,
        commands: { ...repositories.commands, get: () => undefined } }, run), /delegation-root-command-authority-unavailable/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories,
        commandAudits: { ...repositories.commandAudits, findByCommand: () => undefined } }, run), /delegation-root-command-authority-unavailable/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories,
        lifecycleJournal: { ...repositories.lifecycleJournal, findAuditByCommand: () => undefined } }, run), /delegation-root-create-authority-unavailable/u);
    });
  });

  it("refuses modified input, complete options, creation result and request identity", async () => {
    const { database, run } = await fixture();
    database.withAuthorityTransaction(repositories => {
      const proof = authenticateStartPlanRun(repositories, run);
      assert.throws(() => authenticateStartPlanRun(repositories, RunRecordSchema.parse({ ...run,
        input: { ...run.input, raw: {} } })), /delegation-root-plan-membership-unavailable/u);
      for (const envelope of [
        { ...run.envelope, dryRun: !run.envelope.dryRun },
        { ...run.envelope, browserMode: "headed" },
        { ...run.envelope, captureBrowserScreenshots: true },
      ]) assert.throws(() => authenticateStartPlanRun(repositories, RunRecordSchema.parse({ ...run, envelope })), /delegation-root-plan-binding-mismatch/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
        findAuditByCommand: () => ({ ...proof.creation, result: { kind: "run", runId: RunIdSchema.parse(randomUUID()), appliedVersion: PositiveIntSchema.parse(1) } }) } }, run),
      /delegation-root-create-authority-unavailable/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
        getCommand: () => ({ ...proof.create, requestFingerprint: FingerprintSchema.parse("a".repeat(64)) }) } }, run), /delegation-root-create-authority-unavailable/u);
    });
  });
  it("authenticates a real canonical priority bump and refuses invented or no-op-only authority", async () => {
    const { database, run, kernel } = await fixture();
    const invented = RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, priority: "interactive" } });
    database.withAuthorityTransaction(repositories => {
      assert.throws(() => authenticateStartPlanRun(repositories, invented), /delegation-priority-authority-unavailable/u);
    });
    const request = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "run", type: "bump", target: { runId: run.envelope.runId, expectedVersion: run.version } });
    assert.equal(kernel.execute(request).state, "applied");
    const bumped = database.authority.runs.get(run.envelope.runId);
    assert.ok(bumped);
    assert.equal(bumped.envelope.priority, "interactive");
    database.withAuthorityTransaction(repositories => {
      authenticateStartPlanRun(repositories, bumped);
      assert.throws(() => authenticateStartPlanRun({ ...repositories, commands: { ...repositories.commands,
        listRunBumpCommands: () => [] } }, bumped), /delegation-priority-authority-unavailable/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories, commandAudits: { ...repositories.commandAudits,
        findByCommand: id => {
          const audit = repositories.commandAudits.findByCommand(id);
          return id === request.commandId && audit !== undefined ? { ...audit, versionChanges: [] } : audit;
        } } }, bumped), /delegation-priority-authority-unavailable/u);
      const bumpId = lifecycleCommandId("operator-bump", request.commandId);
      assert.throws(() => authenticateStartPlanRun({ ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
        findAuditByCommand: id => id === bumpId ? undefined : repositories.lifecycleJournal.findAuditByCommand(id) } }, bumped), /delegation-priority-authority-unavailable/u);
      assert.throws(() => authenticateStartPlanRun({ ...repositories, commands: { ...repositories.commands,
        listRunBumpCommands: () => [CommandRequestSchema.parse({ ...request, requestedBy: "foreign-operator" })] } }, bumped), /delegation-priority-authority-unavailable/u);
    });
  });

  it("authenticates more than sixteen genuine retained canonical retry ancestors", async () => {
    const { database, run, kernel } = await fixture();
    let current = run;
    for (let index = 0; index < 20; index++) {
      const cancelled = kernel.execute({ commandId: randomUUID(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
        family: "run", type: "cancel", target: { runId: current.envelope.runId, expectedVersion: current.version } });
      assert.equal(cancelled.state, "applied");
      const settled = database.authority.runs.get(current.envelope.runId);
      assert.ok(settled);
      const retried = kernel.execute({ commandId: randomUUID(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
        family: "run", type: "retry", target: { runId: settled.envelope.runId, expectedVersion: settled.version } });
      assert.equal(retried.state, "applied");
      assert.ok(retried.state === "applied");
      const target = retried.affectedTargets.find(target => target.family === "run" && target.runId !== settled.envelope.runId);
      assert.ok(target?.family === "run");
      const next = database.authority.runs.get(target.runId);
      assert.ok(next);
      current = next;
    }
    assert.equal(current.envelope.attempt, run.envelope.attempt + 20);
    database.withAuthorityTransaction(repositories => {
      const proof = authenticateRootRun(repositories, current);
      assert.equal(proof.plan.startPlanId, authenticateStartPlanRun(repositories, run).plan.startPlanId);
    });
  });

});


describe("canonical synchronous run command custody", () => {
  it("observes the exact scope in actual canonical dispatch and revokes before returning", async () => {
    const { database, run, kernel, lifecycle } = await fixture();
    const request = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW,
      requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel",
      target: { runId: run.envelope.runId, expectedVersion: run.version } });
    const transition = lifecycle.transition.bind(lifecycle);
    let observed = 0;
    lifecycle.transition = input => {
      database.withAuthorityTransaction(repositories => {
        assertCanonicalRunCommandScope(repositories, request);
        assert.equal(repositories.commandAudits.findByCommand(request.commandId), undefined);
        observed++;
      });
      return transition(input);
    };
    const result = kernel.execute(request);
    assert.equal(result.state, "applied");
    assert.equal(observed, 1);
    assert.ok(database.authority.commandAudits.findByCommand(request.commandId));
    assert.throws(() => assertCanonicalRunCommandScope(database.authority, request), /canonical-run-command-scope-unavailable/u);
    assert.equal(kernel.execute(request).state, "already-applied");
    assert.equal(observed, 1);
  });

  it("refuses pending rows without scope, changed requests, foreign repositories, reentry and stale scopes", async () => {
    const { database, run } = await fixture(), other = await fixture();
    const request = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW,
      requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel",
      target: { runId: run.envelope.runId, expectedVersion: run.version } });
    const wrong = CommandRequestSchema.parse({ ...request, target: { runId: run.envelope.runId, expectedVersion: run.version + 1 } });
    const application = { result: CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: run.envelope.runId }] }),
      versionChanges: [], affectedDependencyIds: [] };
    const failure = new Error("controlled-scope-failure");
    database.withAuthorityTransaction(repositories => repositories.commands.insert(request));
    assert.throws(() => assertCanonicalRunCommandScope(database.authority, request), /canonical-run-command-scope-unavailable/u);
    database.withAuthorityTransaction(repositories => {
      assert.throws(() => withCanonicalRunCommandScope(repositories, wrong, () => application));
      assert.throws(() => withCanonicalRunCommandScope(repositories, request, () => {
        assertCanonicalRunCommandScope(repositories, request);
        assert.throws(() => assertCanonicalRunCommandScope(repositories, wrong), /canonical-run-command-scope-unavailable/u);
        assert.throws(() => assertCanonicalRunCommandScope(other.database.authority, request), /canonical-run-command-scope-unavailable/u);
        assert.throws(() => withCanonicalRunCommandScope(repositories, request, () => application), /canonical-run-command-scope-unavailable/u);
        throw failure;
      }), error => error === failure);
      assert.throws(() => assertCanonicalRunCommandScope(repositories, request), /canonical-run-command-scope-unavailable/u);
      assert.throws(() => withCanonicalRunCommandScope(repositories, request, () => Object.assign({}, application,
        { then: () => undefined })), /canonical-run-command-scope-must-be-synchronous/u);
      assert.throws(() => assertCanonicalRunCommandScope(repositories, request), /canonical-run-command-scope-unavailable/u);
    });
    assert.equal(database.authority.commandAudits.findByCommand(request.commandId), undefined);
    assert.throws(() => withCanonicalRunCommandScope(database.authority, request, () => application));
  });
});
