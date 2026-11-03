import { z } from "zod";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
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
import { FingerprintSchema, PositiveIntSchema, RunIdSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
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

const approvalResult = z.strictObject({ approved: z.boolean() });
const resumeDescriptor = defineWorkflowDescriptor({
  id: "resume-proof", version: 1, contractFingerprint: "c".repeat(64), code: "rp", label: "Resume proof", icon: "Search", category: "operations",
  canonicalInput: fixtureDescriptor.canonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
  actions: fixtureDescriptor.actions, surfaces: {}, details: [], identity: { matchKey: input => input.eid },
  presentation: { title: input => input.eid }, scenarios: ["resume-proof/happy"],
  timeline: [{ key: "review", label: "Review", nodes: ["approval", "resume-node", "second-approval", "after-second"] }],
  flow: flow(fixtureDescriptor.input).gate("approval", { dependsOn: [], label: "Approval", statusKey: "needsReview",
    resolvedBy: "operator", result: approvalResult })
    .step("resume-node", FixtureReadReceipt, { dependsOn: ["approval"], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .gate("second-approval", { dependsOn: [], label: "Second approval", statusKey: "needsReview", resolvedBy: "operator", result: approvalResult })
    .step("after-second", FixtureReadReceipt, { dependsOn: ["second-approval"], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .build({ schema: FixtureReadReceipt.output, dependsOn: ["after-second"], derive: ({ outputs }) => outputs["after-second"] }),
});

async function fixture(descriptor: AnyWorkflowDescriptor = fixtureDescriptor) {
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
  const descriptors = { resolve: (workflow: string) => workflow === descriptor.id ? descriptor : undefined };
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
  const plan = planner.plan({ workflowId: descriptor.id, submissions: [{ eid: "10812345", mode: "write" }],
    dryRun: true, priority: "bulk", selectedStepKeys: descriptor.timeline.map(step => step.key), browserMode: "headless",
    captureBrowserScreenshots: false });
  const result = kernel.execute({ commandId: randomUUID(), requestedAt: NOW, requestedBy: "local-operator",
    source: "dashboard", family: "start", type: "start-run", target: { workflowId: descriptor.id,
      startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
  const run = database.authority.runs.get(singleAppliedRunId(result));
  assert.ok(run);
  return { database, run, kernel, lifecycle, clock, profile };
}

async function resumedRoot() {
  const f = await fixture(resumeDescriptor);
  const ports = testWorkerPorts(f.database, f.clock, { path: f.profile.path, descriptor: resumeDescriptor, poolIndex: 1 });
  const worker = f.database.authority.workerSlots.list(resumeDescriptor.id).find(row => row.poolIndex === 1); assert.ok(worker);
  const workerId = worker.workerId;
  function parkAndResolve(gateId: "approval" | "second-approval", resumeAt: "resume-node" | "after-second", rename = false) {
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: resumeDescriptor.id, workerId: workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("fixture claim refused");
    const claim = { workerId: workerId, claimGeneration: claimed.run.claimGeneration }, now = f.clock.now().toISOString();
    for (const lifecycle of [
      { state: "validating" as const, workerId: workerId, claimedAt: now, heartbeatAt: now },
      { state: "running" as const, workerId: workerId, claimedAt: now, heartbeatAt: now },
      { state: "parked-gate" as const, gateId, parkedAt: now, resumeAt },
    ]) {
      const current = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(current);
      assert.equal(f.lifecycle.workerTransition({ commandId: lifecycleCommandId("executor-transition", { runId: current.envelope.runId,
        generation: claim.claimGeneration, version: current.version }), runId: current.envelope.runId, claim, lifecycle }).state, "applied");
    }
    f.database.assertWorkerLifecycleRelease(workerId);
    let parked = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parked);
    if (rename) {
      assert.equal(f.kernel.execute({ commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "run", type: "rename",
        target: { runId: parked.envelope.runId, expectedVersion: parked.version }, payload: { displayName: "Synthetic review" } }).state, "applied");
      parked = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parked);
    }
    const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
      target: { runId: parked.envelope.runId, expectedVersion: parked.version, gateId },
      payload: { result: { schemaHash: deriveSchemaHash(approvalResult, "output"), value: { approved: true } } } });
    assert.equal(f.kernel.execute(command).state, "applied");
    const run = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(run); assert.equal(run.envelope.startAt, resumeAt);
    return { run, command };
  }
  return { ...f, parkAndResolve };
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
  it("authenticates the latest native gate-resume node and refuses stale historical cursors", async () => {
    const f = await resumedRoot(), first = f.parkAndResolve("approval", "resume-node");
    f.database.withAuthorityTransaction(repositories => authenticateStartPlanRun(repositories, first.run));
    const second = f.parkAndResolve("second-approval", "after-second");
    f.database.withAuthorityTransaction(repositories => {
      authenticateStartPlanRun(repositories, second.run);
      assert.throws(() => authenticateStartPlanRun(repositories, RunRecordSchema.parse({ ...second.run,
        envelope: { ...second.run.envelope, startAt: "resume-node" } })), /delegation-root-resume-authority-unavailable/u);
    });
  });

  it("refuses missing, foreign, partial, ambiguous or modified native resume custody", async () => {
    const f = await resumedRoot(), { run, command } = f.parkAndResolve("approval", "resume-node");
    const operatorId = lifecycleCommandId("operator-gate", command.commandId);
    f.database.withAuthorityTransaction(repositories => {
      const rejects = (candidate: typeof repositories) => assert.throws(() => authenticateStartPlanRun(candidate, run), /delegation-root-resume-authority-unavailable|run-lifecycle-request-binding-mismatch/u);
      rejects({ ...repositories, gateResults: { ...repositories.gateResults, listByRun: () => [] } });
      rejects({ ...repositories, gateResults: { ...repositories.gateResults, listByRun: id => {
        const rows = repositories.gateResults.listByRun(id); return [...rows, ...rows];
      } } });
      rejects({ ...repositories, gateResults: { ...repositories.gateResults, listByRun: id => repositories.gateResults.listByRun(id)
        .map(row => ({ ...row, runId: RunIdSchema.parse(randomUUID()) })) } });
      for (const missing of ["park-command", "park-audit", "operator-command", "operator-audit"] as const) {
        rejects({ ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
          getCommand: id => id === operatorId && missing === "operator-command" ? undefined : (() => {
            const value = repositories.lifecycleJournal.getCommand(id);
            return missing === "park-command" && value !== undefined && "kind" in value && value.kind === "run-lifecycle" && value.operation === "worker-transition" ? undefined : value;
          })(),
          findAuditByCommand: id => id === operatorId && missing === "operator-audit" ? undefined : (() => {
            const value = repositories.lifecycleJournal.findAuditByCommand(id);
            return missing === "park-audit" && value !== undefined && "kind" in value && value.kind === "run-lifecycle" && value.request.operation === "worker-transition" ? undefined : value;
          })(),
        } });
      }
      rejects({ ...repositories, commands: { ...repositories.commands, get: id => {
        const value = repositories.commands.get(id); return id === command.commandId && value?.type === "resolve-gate"
          ? { ...value, payload: { result: { ...value.payload.result, value: { approved: false } } } } : value;
      } } });
      rejects({ ...repositories, commandAudits: { ...repositories.commandAudits, findByCommand: id => {
        const value = repositories.commandAudits.findByCommand(id); return id === command.commandId && value !== undefined
          ? { ...value, completedAt: IsoInstantSchema.parse("2026-01-01T00:00:00.000Z") } : value;
      } } });
      rejects({ ...repositories, timelineEvents: { ...repositories.timelineEvents, get: id => {
        const value = repositories.timelineEvents.get(id); return value?.payload.kind === "span" && value.payload.event.t === "gate.resolved"
          ? { ...value, payload: { ...value.payload, event: { ...value.payload.event, resultHash: "b".repeat(64) } } } : value;
      } } });
      for (const fault of ["missing", "partial", "foreign-generation"] as const) rejects({ ...repositories,
        timelineEvents: { ...repositories.timelineEvents, page: request => {
          const rows = repositories.timelineEvents.page(request);
          if (fault === "missing") return [];
          if (fault === "partial") return rows.filter(row => row.payload.kind !== "span" || row.payload.event.t !== "gate.opened");
          return rows.map(row => row.payload.kind === "span" && row.payload.event.t === "run.claimed" ? { ...row,
            payload: { ...row.payload, event: { ...row.payload.event, claimGeneration: run.claimGeneration + 1 } } } : row);
        } } });
      assert.throws(() => authenticateStartPlanRun(repositories, RunRecordSchema.parse({ ...run,
        envelope: { ...run.envelope, startAt: "forged-cursor" } })), /delegation-root-resume-authority-unavailable/u);
    });
  });

  it("fails closed when an intervening control prevents exact park-version lookup", async () => {
    const f = await resumedRoot(), { run } = f.parkAndResolve("approval", "resume-node", true);
    f.database.withAuthorityTransaction(repositories => {
      assert.throws(() => authenticateStartPlanRun(repositories, run), /delegation-root-resume-authority-unavailable/u);
    });
  });

});
