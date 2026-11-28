import { recordHistoricalRecover } from "../../../support/helpers/backend/record-historical-recover.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, it, vi } from "vitest";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { childPolicyModules, childSettledObservationModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1ControlledFailureStores, plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { createDelegationExecutionWorld } from "../../../support/helpers/backend/delegation-execution-world.js";
import { mappedReadDescriptor } from "../../../support/fixtures/rerun-values-fixtures.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

it("reads continuation issuance for several runs without rescanning the journal for each run", async () => {
  const h = await sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores);
  cleanups.push(h.dispose);
  const cases: { runId: string; commandId: string; version: number }[] = [];
  for (const eid of ["10800001", "10800002", "10800003"]) {
    let run = h.start(h.proposal(undefined, undefined, false, eid));
    for (let index = 0; index < 3; index++) {
      run = requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version }));
      const commandId = h.ids.uuid();
      run = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId, runId: run.envelope.runId, expectedVersion: run.version }));
      cases.push({ runId: run.envelope.runId, commandId, version: run.version });
    }
  }
  h.database.summaryWorkflows();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- forwards the native receiver.
  const original = DatabaseSync.prototype.prepare;
  const scans: string[] = [];
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    const statement = original.call(this, sql);
    if (/^SELECT/u.test(sql.trim()) && /\bcommands\b/u.test(sql)) {
      const plan = original.call(this, `EXPLAIN QUERY PLAN ${sql}`).all();
      if (/SCAN commands\b/u.test(JSON.stringify(plan))) scans.push(sql);
    }
    return statement;
  });
  try {
    h.database.withAuthorityReadSnapshot(() => {
      h.database.summaryWorkflows();
      for (const entry of cases) {
        const audit = h.database.authority.lifecycleJournal.findContinuationIssue(entry.runId, entry.version);
        assert.equal(audit?.request.commandId, entry.commandId);
        assert.ok(audit?.result.kind === "run");
        assert.equal(audit.result.runId, entry.runId);
        assert.equal(audit.result.appliedVersion, entry.version);
      }
    });
    assert.ok(scans.length <= 1, `one projection scanned commands ${scans.length} times`);
  } finally { spy.mockRestore(); }
});

it("shares one command batch while preserving retry and delegation lookup rows and order", async () => {
  const world = createDelegationExecutionWorld(childSettledObservationModules);
  cleanups.push(world.cleanup);
  let fail = true;
  const f = await world.fixture(plan1ControlledFailureStores(() => fail), "fail");
  await f.execution.execute(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  assert.equal(children.length, 2);
  assert.ok(children.every(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"));
  fail = false;
  const retryIds: string[] = [];
  for (const child of children) {
    const commandId = randomUUID();
    retryIds.push(commandId);
    assert.equal(f.execution.kernel.execute({ commandId, family: "run", type: "retry", source: "dashboard",
      requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
      target: { runId: child.envelope.runId, expectedVersion: child.version } }).state, "applied");
  }
  for (let index = 0; index < 3; index++) await f.execution.step(f.run, world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent);
  const runs = [parent, ...f.database.authority.runs.listChildren(parent.envelope.runId)];
  const manifests = f.database.authority.delegationManifests.listByParentRun(parent.envelope.runId);
  assert.ok(manifests.length > 0);
  const journal = f.database.authority.lifecycleJournal;
  assert.ok(journal.listDelegationRefreshes(parent.envelope.runId).length >= 3);
  const read = () => ({
    runs: runs.map(run => {
      const id = run.envelope.runId;
      return {
        resume: journal.findRunResume(id, run.version), continuation: journal.findContinuationIssue(id),
        origin: journal.findRunOrigin(id), gate: journal.findGatePark(id, "unmatched-gate", run.version),
        cancellation: journal.findCancellation(id), refreshes: journal.listDelegationRefreshes(id),
        invocations: journal.listDelegationInvocations(id), admissions: journal.listDelegationAdmissions(id, run.claimGeneration),
        owner: journal.findDelegationOwner(id, run.claimGeneration, run.version),
        parentHolds: retryIds.map(commandId => journal.findDelegationParentHold(id, commandId, run.version)),
      };
    }),
    invocations: manifests.map(manifest => journal.findDelegationInvocation(manifest.manifestId)),
  });
  const expected = read();
  f.database.summaryWorkflows();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- forwards the native receiver.
  const prepare = DatabaseSync.prototype.prepare;
  let commandReads = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    if (/^SELECT/u.test(sql.trim()) && /\bcommands\b/u.test(sql)) commandReads++;
    return prepare.call(this, sql);
  });
  try {
    f.database.withAuthorityReadSnapshot(() => {
      f.database.summaryWorkflows();
      const actual = read();
      assert.deepEqual(actual, expected);
      const command = actual.invocations[0]; assert.ok(command);
      assert.equal(Reflect.set(command, "recordedAt", "2000-01-01T00:00:00.000Z"), true);
      assert.deepEqual(read(), expected);
    });
    assert.equal(commandReads, 1, "one projection reads its command candidates once");
  } finally { spy.mockRestore(); }
});

it("keeps recovery issuance on the new run and respects exact resume versions", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2));
  cleanups.push(h.dispose);
  const source = h.start(h.proposal());
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source);
  const recovered = recordHistoricalRecover(h, h.descriptor, { commandId: h.ids.uuid(), family: "run", type: "recover-run", source: "dashboard",
    requestedBy: "local-operator", requestedAt: h.clock.now().toISOString(),
    target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
  assert.ok(recovered.state === "applied");
  const target = recovered.affectedTargets[0]; assert.ok(target?.family === "run");
  const initial = h.database.authority.runs.get(target.runId); assert.ok(initial);
  let run = initial;
  const id = run.envelope.runId, journal = h.database.authority.lifecycleJournal;
  assert.notEqual(id, source.envelope.runId);
  const creation = journal.findContinuationIssue(id, 1); assert.ok(creation?.result.kind === "run");
  assert.equal(creation.request.operation, "recover");
  assert.equal(creation.result.runId, id);
  assert.equal(creation.result.continuation?.sources[0]?.runId, source.envelope.runId);
  const originalIssue = journal.findContinuationIssue(source.envelope.runId);
  run = requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: id, expectedVersion: run.version }));
  const resumeId = h.ids.uuid();
  run = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: resumeId, runId: id, expectedVersion: run.version }));
  h.database.withAuthorityReadSnapshot(() => {
    h.database.summaryWorkflows();
    const retained = journal.findContinuationIssue(id, 1); assert.deepEqual(retained, creation); assert.ok(retained);
    assert.deepEqual(journal.findRunOrigin(id), creation.request);
    assert.equal(journal.findRunOrigin(source.envelope.runId)?.operation, "create");
    assert.deepEqual(journal.findContinuationIssue(source.envelope.runId), originalIssue);
    assert.equal(journal.findContinuationIssue(id, 2), undefined);
    assert.equal(journal.findContinuationIssue(id, run.version)?.request.commandId, resumeId);
    assert.equal(journal.findContinuationIssue(id)?.request.commandId, resumeId);
    assert.equal(journal.findRunResume(id, 2), undefined);
    assert.equal(journal.findRunResume(id, run.version)?.request.commandId, resumeId);
    assert.equal(journal.findContinuationIssue(randomUUID(), 1), undefined);
    assert.equal(Reflect.set(retained.request, "operation", "pause"), true);
    assert.deepEqual(journal.findContinuationIssue(id, 1), creation);
  });
});

it("retains a command snapshot and refuses a peer's changed physical command in the next read", async () => {
  const h = await sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores);
  cleanups.push(h.dispose);
  let run = h.start(h.proposal());
  run = requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version }));
  const commandId = h.ids.uuid();
  run = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId, runId: run.envelope.runId, expectedVersion: run.version }));
  const journal = h.database.authority.lifecycleJournal, expected = journal.findContinuationIssue(run.envelope.runId, run.version);
  assert.ok(expected);
  h.database.summaryWorkflows();
  const peer = new DatabaseSync(h.authorityPath);
  const row = peer.prepare("SELECT actor_id FROM commands WHERE id=?").get(commandId);
  assert.ok(typeof row?.actor_id === "string");
  const actorId = row.actor_id;
  try {
    h.database.withAuthorityReadSnapshot(() => {
      h.database.summaryWorkflows();
      assert.deepEqual(journal.findContinuationIssue(run.envelope.runId, run.version), expected);
      peer.prepare("UPDATE commands SET actor_id=? WHERE id=?").run("changed-physical-actor", commandId);
      assert.deepEqual(journal.findContinuationIssue(run.envelope.runId, run.version), expected);
    });
    assert.throws(() => h.database.summaryWorkflows(), /run-search-index-rebuild-required/u);
    assert.throws(() => journal.findContinuationIssue(run.envelope.runId, run.version), /command-row-identity-mismatch/u);
  } finally {
    peer.prepare("UPDATE commands SET actor_id=? WHERE id=?").run(actorId, commandId);
    peer.close();
  }
});

it("preserves parked gate rows, version bounds and invalid input refusals", async () => {
  const h = await sourceBoundHarness(mappedReadDescriptor(undefined, { gate: true }), sourceBoundReadStores);
  cleanups.push(h.dispose);
  const started = h.start(h.proposal());
  assert.equal((await h.execute(started)).state, "parked-gate");
  const run = h.fresh(started), journal = h.database.authority.lifecycleJournal;
  const expected = journal.findGatePark(run.envelope.runId, "approval", run.version);
  assert.ok(expected);
  assert.equal(expected.operation, "worker-transition");
  h.database.withAuthorityReadSnapshot(() => {
    h.database.summaryWorkflows();
    assert.deepEqual(journal.findGatePark(run.envelope.runId, "approval", run.version), expected);
    assert.equal(journal.findGatePark(run.envelope.runId, "approval", run.version - 1), undefined);
    assert.equal(journal.findGatePark(run.envelope.runId, "other-gate", run.version), undefined);
    assert.throws(() => journal.findGatePark(run.envelope.runId, "approval", 0));
    assert.throws(() => journal.findContinuationIssue(run.envelope.runId, 0));
    assert.throws(() => journal.findRunOrigin("invalid-run-id"));
  });
});

it("preserves the propagated child cancellation source", async () => {
  const world = createDelegationExecutionWorld(childPolicyModules("cascade"));
  cleanups.push(world.cleanup);
  const f = await world.fixture(plan1Stores);
  await f.execution.step(f.run, world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(parent);
  const children = f.database.authority.runs.listChildren(parent.envelope.runId);
  assert.equal(children.length, 1);
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
    target: { runId: parent.envelope.runId, expectedVersion: parent.version } }).state, "applied");
  const child = children[0]; assert.ok(child);
  const journal = f.database.authority.lifecycleJournal, expected = journal.findCancellation(child.envelope.runId);
  assert.ok(expected);
  assert.equal(expected.operation, "transition");
  f.database.withAuthorityReadSnapshot(() => {
    f.database.summaryWorkflows();
    assert.deepEqual(journal.findCancellation(child.envelope.runId), expected);
    assert.equal(journal.findCancellation(randomUUID()), undefined);
  });
});

it("reuses validated projection records within one snapshot without sharing caller mutations", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2));
  cleanups.push(h.dispose);
  const source = h.start(h.proposal());
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source);
  const recovery = recordHistoricalRecover(h, h.descriptor, { commandId: h.ids.uuid(), family: "run", type: "recover-run", source: "dashboard",
    requestedBy: "local-operator", requestedAt: h.clock.now().toISOString(),
    target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
  assert.ok(recovery.state === "applied");
  const target = recovery.affectedTargets[0]; assert.ok(target?.family === "run");
  const journal = h.database.authority.lifecycleJournal;
  const issue = journal.findContinuationIssue(target.runId, 1); assert.ok(issue);
  const initial = h.database.authority.runResults.getInitialSettlement(failed.envelope.runId); assert.ok(initial);
  const read = () => ({
    run: h.database.authority.runs.get(failed.envelope.runId), command: journal.getCommand(issue.request.commandId),
    audit: journal.findAuditByCommand(issue.request.commandId),
    settlement: h.database.authority.runResults.getSettlement(failed.envelope.runId, initial.run.version),
  });
  const expected = read();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- forwards the native receiver.
  const prepare = DatabaseSync.prototype.prepare;
  let reads = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    if (/^SELECT/u.test(sql.trim()) && /\b(commands|command_audits|runs|run_results)\b/u.test(sql)) reads++;
    return prepare.call(this, sql);
  });
  try {
    h.database.withAuthorityReadSnapshot(() => {
      const first = read(), firstReads = reads;
      assert.deepEqual(first, expected);
      assert.ok(first.run && first.command && first.audit && first.settlement);
      assert.ok(firstReads > 0);
      assert.equal(Reflect.set(first.run.envelope, "itemId", "changed"), true);
      assert.equal(Reflect.set(first.command, "recordedAt", "2000-01-01T00:00:00.000Z"), true);
      assert.equal(Reflect.set(first.audit.request, "operation", "pause"), true);
      assert.equal(Reflect.set(first.settlement.run.envelope, "itemId", "changed"), true);
      assert.equal(Reflect.set(first.settlement.result, "createdAt", "2000-01-01T00:00:00.000Z"), true);
      assert.deepEqual(read(), expected);
      assert.equal(reads, firstReads, "one projection does not reread and decode the same records");
    });
  } finally { spy.mockRestore(); }
});

it("shares complete authenticated parent facts only within one read snapshot", async () => {
  const world = createDelegationExecutionWorld(childSettledObservationModules);
  cleanups.push(world.cleanup);
  const f = await world.fixture(plan1ControlledFailureStores(() => true), "fail");
  await f.execution.execute(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  assert.equal(children.length, 2);
  const child = children[0]; assert.ok(child);
  const parent = child.envelope.parent; assert.ok(parent);
  const envelopes = children.map(run => run.envelope);
  const expected = f.database.authority.dependencies.parents(envelopes);
  assert.equal(expected.size, 2);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- forwards the native receiver.
  const prepare = DatabaseSync.prototype.prepare;
  let siblingReads = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    if (/SELECT\s+\*\s+FROM\s+runs\s+WHERE\s+parent_id\s*=/u.test(sql)) siblingReads++;
    return prepare.call(this, sql);
  });
  try {
    f.database.withAuthorityReadSnapshot(() => {
      const first = f.database.authority.dependencies.parents(envelopes);
      assert.deepEqual(first, expected);
      const reads = siblingReads; assert.ok(reads > 0);
      const fact = first.get(child.envelope.runId); assert.ok(fact);
      assert.equal(Reflect.set(fact, "visibility", "changed"), true);
      assert.deepEqual(f.database.authority.dependencies.parents([child.envelope]), expected);
      assert.equal(siblingReads, reads, "one physical sibling read serves every projected child");
      assert.throws(() => f.database.authority.dependencies.parents([{ ...child.envelope,
        parent: { ...parent, runId: RunIdSchema.parse(randomUUID()) } }]), /delegation-parent-unavailable/);
      assert.throws(() => f.database.authority.dependencies.parents([{ ...child.envelope,
        runId: RunIdSchema.parse(randomUUID()) }]), /queue-parent-source-unavailable/);
    });
    const reads = siblingReads;
    assert.deepEqual(f.database.authority.dependencies.parents(envelopes), expected);
    assert.ok(siblingReads > reads, "the next operation authenticates physical siblings again");
  } finally { spy.mockRestore(); }
});

it("reads admission once without journal scans and preserves quit release and later holds", async () => {
  const h = await sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores);
  cleanups.push(h.dispose);
  const runtime = h.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const runs = h.database.authority.runs;
  const counts: { reads: number; scans: number }[] = [];
  const check = () => {
    const expected = runs.admission();
    h.database.summaryWorkflows();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- forwards the native receiver.
    const prepare = DatabaseSync.prototype.prepare;
    let reads = 0;
    const scans: string[] = [];
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
      if (sql.includes("AS hold FROM commands held")) {
        reads++;
        const plan = prepare.call(this, `EXPLAIN QUERY PLAN ${sql}`).all(runtime.generation, runtime.generation, runtime.generation);
        if (/SCAN (?:commands|held|release)\b/u.test(JSON.stringify(plan))) scans.push(sql);
      }
      return prepare.call(this, sql);
    });
    try {
      h.database.withAuthorityReadSnapshot(() => {
        h.database.summaryWorkflows();
        const first = runs.admission();
        assert.deepEqual(first, expected);
        if (first.state === "draining") assert.equal(Reflect.set(first, "hold", "shutdown"), true);
        assert.deepEqual(runs.admission(), expected);
      });
      counts.push({ reads, scans: scans.length });
    } finally { spy.mockRestore(); }
  };
  assert.deepEqual(runs.admission(), { state: "open" });
  check();
  const commandId = h.ids.uuid();
  const request = { commandId, family: "application", type: "pause-all-and-quit", requestedBy: "local-operator", source: "dashboard",
    requestedAt: h.clock.now().toISOString(), target: { runtimeGeneration: runtime.generation }, payload: { confirmed: true, targets: [] } };
  h.database.withAuthorityTransaction(repositories => {
    repositories.commands.insert(request);
    repositories.commandAudits.insert({ auditId: h.ids.uuid(), request,
      result: { state: "applied", commandId, affectedTargets: [{ family: "application", runtimeGeneration: runtime.generation }] },
      completedAt: h.clock.now().toISOString(), versionChanges: [], affectedDependencyIds: [] });
  });
  assert.deepEqual(runs.admission(), { state: "draining", commandId, hold: "quit" });
  check();
  runs.releaseQuitAdmission({ commandId: h.ids.uuid(), runtimeGeneration: runtime.generation, releases: commandId });
  assert.deepEqual(runs.admission(), { state: "open" });
  check();
  const logoutId = h.ids.uuid();
  runs.holdAdmission({ commandId: logoutId, runtimeGeneration: runtime.generation, reason: "logout" });
  assert.deepEqual(runs.admission(), { state: "draining", commandId: logoutId, hold: "logout" });
  assert.throws(() => runs.releaseQuitAdmission({ commandId: h.ids.uuid(), runtimeGeneration: runtime.generation, releases: commandId }), /application-quit-admission-not-held/u);
  check();
  assert.deepEqual(counts.map(count => count.reads), [1, 1, 1, 1], "each projection reads admission once");
  assert.ok(counts.every(count => count.scans === 0), "admission uses indexed hold and release candidates");
});
