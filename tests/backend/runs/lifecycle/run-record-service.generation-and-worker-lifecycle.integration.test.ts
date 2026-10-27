import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { seedCorruptWriteFenceFixture } from "../../../support/helpers/write-fence-fixture.js";
import { CANONICAL_WORKER_ID as WORKER_ID, createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { afterEach, describe, it } from "vitest";
import { RunLifecycleRefusedError, lifecycleCommandId, requireLifecycleApplied, runContinuationPort, workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { LATER, NOW, UUID_1, UUID_5, UUID_6, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { planDelegationFanOut } from "../../../../src/models/workflow/delegation.js";
import { plan1Parent, Plan1Input } from "../../../support/fixtures/plan1-operation-workflows.js";

const {fixture, created, runningRun, raceConnection, closeRaceConnections, failureTerminalRequest, cleanup } = createRunRecordServiceTestWorld();

afterEach(cleanup);

describe("canonical run-record service", () => {

  it("refuses a new claim without physical lifetime before journal or publication", async () => {
    const { service, request, runtimeConfig, database, published } = await fixture();
    const run = created(service, { ...request, descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint });
    const commandId = "99000000-0000-4000-8000-000000000099";
    const before = database.getMeta().authorityGeneration, publications = published.length;
    assert.deepEqual(service.claimNext({ commandId, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig }),
      { state: "refused", refusal: { reason: "none-eligible" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(database.authority.lifecycleJournal.getCommand(commandId), undefined);
    assert.equal(database.authority.lifecycleJournal.findAuditByCommand(commandId), undefined);
    assert.equal(published.length, publications);
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), run);
    assert.equal(runClaim(run), undefined);
    assert.throws(() => database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW }),
      /worker-claim-membership-unavailable/);
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), run);
  });

  it("table-class coverage drives every public service method and generation class", async () => {
    const { service, request, runtimeConfig, database } = await fixture();
    const covered = new Set<string>();
    let commandSequence = 100;
    const commandId = () => `99000000-0000-4000-8000-${String(commandSequence++).padStart(12, "0")}`;
    const measure = <T,>(method: string, delta: 0 | 1, call: () => T): T => {
      const before = database.getMeta().authorityGeneration;
      const result = call();
      assert.equal(database.getMeta().authorityGeneration, before + delta, method);
      covered.add(method);
      return result;
    };

    const sourceResult = measure("create", 1, () => service.create({
      ...request,
      commandId: commandId(),
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    }));
    if (sourceResult.state !== "applied") throw new Error("coverage create refused");
    const source = sourceResult.run;
    assert.deepEqual(measure("withRunTreeSnapshot", 0, () => service.withRunTreeSnapshot([source.envelope.runId], runs => runs.map(run => run.envelope.runId))), [source.envelope.runId]);
    measure("read", 0, () => service.read(source.envelope.runId));
    measure("list", 0, () => service.list({ disposition: "live", limit: 10 }));
    const terminal = measure("transition", 1, () => service.transition({
      commandId: commandId(), runId: source.envelope.runId, expectedVersion: source.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    }));
    if (terminal.state !== "applied") throw new Error("coverage transition refused");
    const retry = measure("retry", 1, () => service.retry({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version, runtimeConfig,
    }, personLookupDescriptor));
    if (retry.state !== "applied") throw new Error("coverage retry refused");
    const settledRetry = service.transition({
      commandId: commandId(), runId: retry.run.envelope.runId, expectedVersion: retry.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRetry.state !== "applied") throw new Error("coverage retry setup refused");
    const restart = measure("restart", 1, () => service.restart({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version, runtimeConfig,
    }, personLookupDescriptor));
    if (restart.state !== "applied") throw new Error("coverage restart refused");
    const settledRestart = service.transition({
      commandId: commandId(), runId: restart.run.envelope.runId, expectedVersion: restart.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRestart.state !== "applied") throw new Error("coverage restart setup refused");

    const workerRun = created(service, {
      ...request,
      commandId: commandId(),
      matchKey: "coverage-worker",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const claim = measure("claimNext", 1, () => service.claimNext({
      commandId: commandId(), workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig,
      workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime,
    }));
    if (claim.state !== "applied" || claim.run.envelope.runId !== workerRun.envelope.runId) {
      throw new Error("coverage claim refused or selected the wrong run");
    }
    measure("assertCurrentExecution", 0, () => service.assertCurrentExecution({ runId: claim.run.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration } }));
    const childNode = descriptorRuntimeNodes(plan1Parent.descriptor).find(node => node.kind === "child-run");
    assert.ok(childNode?.kind === "child-run");
    const input = Plan1Input.parse({ emplId: "10800000", text: "same", mode: "ok" });
    const plan = planDelegationFanOut({ edgeId: childNode.edgeId, target: childNode.target, cardinality: childNode.cardinality,
      join: childNode.join, policy: childNode.policy, bound: input, deriveChildItemId: () => source.envelope.itemId });
    const activeClaim = runClaim(claim.run);
    assert.ok(activeClaim);
    const retainedLifetime = testWorkerLifetime(database, claim.run.envelope.workflow, 1).workerLifetime;
    measure("workerTransition", 0, () => assert.throws(() => service.workerTransition({ commandId: commandId(),
      runId: claim.run.envelope.runId, claim: { workerId: activeClaim.workerId, claimGeneration: activeClaim.claimGeneration },
      lifecycle: { state: "validating", workerId: activeClaim.workerId, claimedAt: NOW, heartbeatAt: NOW,
        workerLifetime: { ...retainedLifetime, membershipRevision: retainedLifetime.membershipRevision + 1 } },
    }), /run-claim-lifetime-immutable/u));
    measure("admitDelegation", 0, () => assert.throws(() => service.admitDelegation({
      descriptor: plan1Parent.descriptor, node: childNode, run: source,
      claim: { workerId: activeClaim.workerId, claimGeneration: activeClaim.claimGeneration },
      scope: { input, outputs: {} }, signal: new AbortController().signal,
    }, plan), (error: unknown) => {
      assert.ok(error instanceof RunLifecycleRefusedError);
      assert.deepEqual(error.outcome, { state: "refused", refusal: { reason: "lost" } });
      return true;
    }));
    const renewed = measure("renewClaim", 1, () => service.renewClaim({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
    }));
    if (renewed.state !== "applied") throw new Error("coverage renew refused");
    const validating = measure("workerTransition", 1, () => service.workerTransition({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    }));
    if (validating.state !== "applied") throw new Error("coverage worker transition refused");
    const running = service.workerTransition({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
      lifecycle: {
        state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW,
        currentNodeId: "crm-dates",
      },
    });
    if (running.state !== "applied") throw new Error("coverage running transition refused");
    const terminalized = measure("terminalize", 1, () => service.terminalize(
      failureTerminalRequest(running.run, commandId()),
      personLookupDescriptor,
    ));
    if (terminalized.state !== "applied") throw new Error("coverage terminalize refused");

    const recoverable = created(service, { ...request, commandId: commandId(), matchKey: "coverage-requeue" });
    const recoveryClaim = service.claimNext({
      commandId: commandId(), workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig,
      workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime,
    });
    if (recoveryClaim.state !== "applied" || recoveryClaim.run.envelope.runId !== recoverable.envelope.runId) {
      throw new Error("coverage recovery claim refused or selected the wrong run");
    }
    const requeued = measure("requeue", 1, () => service.requeue({
      commandId: commandId(), runId: recoverable.envelope.runId,
      expectedVersion: recoveryClaim.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: recoveryClaim.run.claimGeneration },
      cause: "recovery",
    }));
    if (requeued.state !== "applied") throw new Error("coverage requeue refused");

    const deleted = measure("delete", 1, () => service.delete({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version,
    }));
    assert.equal(deleted.state, "deleted");
    const purged = measure("purge", 1, () => service.purge({
      commandId: commandId(), evidenceClass: "diagnostic-bundle", bundleId: UUID_6,
    }));
    assert.deepEqual(purged, { state: "purged", evidenceClass: "diagnostic-bundle", purged: 0 });

    const slot = database.authority.workerSlots.get(WORKER_ID), lease = database.authority.workerLeases.get(WORKER_ID);
    assert.ok(slot !== undefined && lease !== undefined);
    const reset = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
      commandId: commandId(), family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: NOW,
      target: { workerId: WORKER_ID, membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } },
    }, commandId(), NOW));
    database.authority.workerControls.transition(reset.commandId, "admitted", { state: "executing", startedAt: NOW });
    measure("settleResetWork", 0, () => { service.settleResetWork(reset.reset); });

    const sourceText = readFileSync(join(process.cwd(), "src/backend/runs/lifecycle/run-record-service.ts"), "utf8");
    const sourceFile = ts.createSourceFile("run-record-service.ts", sourceText, ts.ScriptTarget.Latest, true);
    const serviceClass = sourceFile.statements.find((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === "RunRecordService");
    assert.ok(serviceClass !== undefined);
    const publicMethods = serviceClass.members
      .filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && !member.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword))
      .map((method) => {
        assert.ok(ts.isIdentifier(method.name), "service public method names remain static identifiers");
        return method.name.text;
      })
      .sort();
    assert.deepEqual([...covered].sort(), publicMethods);
  });

});


describe("worker lifecycle service capability", () => {
  it("separates command authority and stable nested identities", async () => {
    const { service } = await fixture();
    assert.deepEqual(Object.keys(workerRunLifecyclePort(service)).sort(),
      ["admitDelegation", "assertCurrentExecution", "claimNext", "renewClaim", "requeue", "terminalize", "workerTransition"].sort());
    assert.deepEqual(Object.keys(runContinuationPort(service)), ["transition"]);
    assert.equal(lifecycleCommandId("worker", UUID_1), lifecycleCommandId("worker", UUID_1));
    assert.notEqual(lifecycleCommandId("worker", UUID_1), lifecycleCommandId("continuation", UUID_1));
    assert.notEqual(lifecycleCommandId("continuation", UUID_1), UUID_1);
  });

  it("settles admitted cancellation under both fences; outer rollback removes journal and lifecycle", async () => {
    const { database, service, request, runtimeConfig } = await fixture();
    const run = created(service, request);
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID,
      workerId: WORKER_ID, runtimeConfig, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime }));
    const requested = requireLifecycleApplied(service.transition({ commandId: UUID_6,
      runId: run.envelope.runId, expectedVersion: claimed.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
    const terminal = { kind: "cancelled", commandId: lifecycleCommandId("cancel", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version,
      claim: { workerId: WORKER_ID, claimGeneration: claimed.claimGeneration }, endedAt: NOW };
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => database.withAuthorityTransaction(() => {
      assert.equal(service.terminalize(terminal, personLookupDescriptor).state, "applied");
      throw new Error("outer cancellation rollback");
    }), /outer cancellation rollback/);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), requested);
    const settled = requireLifecycleApplied(service.terminalize(terminal, personLookupDescriptor));
    assert.deepEqual(settled.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: NOW });
    const after = database.getMeta().authorityGeneration;
    assert.equal(service.terminalize(terminal, personLookupDescriptor).state, "applied-already");
    assert.deepEqual(service.terminalize({ ...terminal, endedAt: LATER }, personLookupDescriptor),
      { state: "refused", refusal: { reason: "replay-divergent" } });
    assert.equal(database.getMeta().authorityGeneration, after);
  });

  it("finds attempting evidence from an absent run before releasing or cancelling the same item", async () => {
    const { database, service, request, runtimeConfig } = await fixture();
    const run = created(service, request);
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID,
      workerId: WORKER_ID, runtimeConfig, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime }));
    const requested = requireLifecycleApplied(service.transition({ commandId: UUID_6,
      runId: run.envelope.runId, expectedVersion: claimed.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
    const absentRunId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: absentRunId };
    const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
    const injectedIntent = { ...WRITE_INTENT_ATTEMPTING, workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
      runId: absentRunId, bindingProof, bindingProofDigest };
    const injectedAttempt = { ...WRITE_ATTEMPT, runId: absentRunId, bindingProof, bindingProofDigest };
    seedCorruptWriteFenceFixture(database, { intent: injectedIntent, attempt: injectedAttempt }, DatabaseSync);
    assert.equal(database.authority.writeIntents.listByRun(run.envelope.runId).length, 0);
    const generation = database.getMeta().authorityGeneration;
    assert.equal(database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId }).length, 1);
    assert.equal(database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: UUID_1 }).length, 0);
    assert.throws(() => database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, extra: true }));
    const result = service.requeue({ commandId: lifecycleCommandId("recovery", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version, cause: "recovery", staleBefore: LATER });
    assert.equal(result.state, "recovery-required");
    if (result.state !== "recovery-required") throw new Error("Unfinished write intent did not refuse release");
    assert.equal(result.parked, false);
    assert.deepEqual(result.run, requested);
    assert.equal(database.getMeta().authorityGeneration, generation);

    const raw = new DatabaseSync(syntheticDatabasePath(database));
    try {
      raw.exec("BEGIN IMMEDIATE");
      try {
        assert.deepEqual({ ...raw.prepare("SELECT * FROM write_intents WHERE id=?").get(injectedIntent.writeIntentId) }, {
          id: injectedIntent.writeIntentId, system: injectedIntent.system, idempotency_key: injectedIntent.idempotencyKey,
          idempotency_key_digest: injectedIntent.idempotencyKeyDigest, status: injectedIntent.status,
          generation: injectedIntent.generation, run_id: injectedIntent.runId, payload_json: canonicalJsonStringify(injectedIntent),
          publication_json: null, created_at: injectedIntent.createdAt, updated_at: injectedIntent.updatedAt,
        });
        assert.deepEqual({ ...raw.prepare("SELECT * FROM write_attempts WHERE id=?").get(injectedAttempt.writeAttemptId) }, {
          id: injectedAttempt.writeAttemptId, intent_id: injectedAttempt.writeIntentId, generation: injectedAttempt.generation,
          run_id: injectedAttempt.runId, payload_json: canonicalJsonStringify(injectedAttempt), created_at: injectedAttempt.recordedAt,
        });
        assert.throws(() => raw.prepare("DELETE FROM write_attempts WHERE id=?").run(injectedAttempt.writeAttemptId),
          { message: "retained-evidence-required", code: "ERR_SQLITE_ERROR" });
        assert.throws(() => raw.prepare("DELETE FROM write_intents WHERE id=?").run(injectedIntent.writeIntentId),
          { message: "write-identity-retained", code: "ERR_SQLITE_ERROR" });
        const triggers = [
          { name: "write_attempts_retained", table: "write_attempts" },
          { name: "write_intents_retained", table: "write_intents" },
        ].map(({ name, table }) => {
          const definitions = SQLITE_MIGRATIONS.flatMap(migration => migration.statements.flatMap(statement =>
            [...statement.matchAll(new RegExp(`CREATE TRIGGER ${name} BEFORE DELETE ON ${table}\\n[\\s\\S]*? END;`, "gu"))].map(match => match[0].slice(0, -1))));
          assert.equal(definitions.length, 1);
          const sql = definitions[0]; assert.ok(sql);
          const expected = { type: "trigger", name, tbl_name: table, sql };
          assert.deepEqual({ ...raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?").get(name) }, expected);
          return expected;
        });
        raw.exec("DROP TRIGGER write_attempts_retained");
        raw.exec("DROP TRIGGER write_intents_retained");
        assert.equal(raw.prepare("DELETE FROM write_attempts WHERE id=?").run(injectedAttempt.writeAttemptId).changes, 1);
        assert.equal(raw.prepare("DELETE FROM write_intents WHERE id=?").run(injectedIntent.writeIntentId).changes, 1);
        for (const trigger of triggers) {
          raw.exec(trigger.sql);
          assert.deepEqual({ ...raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?").get(trigger.name) }, trigger);
        }
        raw.exec("COMMIT");
      } catch (error) {
        const rollbackFailures: unknown[] = [];
        try { raw.exec("ROLLBACK"); }
        catch (rollbackError) { rollbackFailures.push(rollbackError); }
        if (rollbackFailures.length !== 0) throw new AggregateError([error, ...rollbackFailures], "write-fence-fixture-restoration-unproved", { cause: error });
        throw error;
      }
    } finally { raw.close(); }
    assert.equal(database.getMeta().authorityGeneration, generation);
    const claim = runClaim(requested); assert.ok(claim);
    const terminal = requireLifecycleApplied(service.terminalize({ kind: "cancelled", commandId: lifecycleCommandId("cancel", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, endedAt: NOW }, personLookupDescriptor));
    assert.deepEqual(terminal.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: NOW });
    assert.equal(database.authority.runs.listByWorker(WORKER_ID).some(owned => runClaim(owned) !== undefined), false);
    assert.doesNotThrow(() => database.assertWorkerLifecycleRelease(WORKER_ID));
  });
});


for (const finishingGeneration of [2, 3]) {
  it(`rejects generation1 after reassignment; generation${finishingGeneration} finishes and Retry preserves completion`, async () => {
    const f = await fixture(); let next = 20;
    testWorkerPorts(f.database, f.clock, { path: syntheticDatabasePath(f.database), descriptor: personLookupDescriptor, poolIndex: 2 });
    const id = () => `99000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    let running = runningRun(f.service, f.request, f.runtimeConfig);
    const stale = failureTerminalRequest(running, id());
    for (let generation = 2; generation <= finishingGeneration; generation++) {
      assert.equal(f.service.requeue({ commandId: id(), runId: running.envelope.runId,
        expectedVersion: running.version, cause: "recovery", staleBefore: LATER }).state, "applied");
      const workerId = generation === 2 ? "person-lookup-worker-2" : WORKER_ID;
      const claimed = requireLifecycleApplied(f.service.claimNext({ commandId: id(), workflow: WORKFLOW_ID, workerId, runtimeConfig: f.runtimeConfig,
        workerLifetime: testWorkerLifetime(f.database, WORKFLOW_ID, generation === 2 ? 2 : 1).workerLifetime }));
      assert.equal(claimed.claimGeneration, generation);
      const claim = { workerId, claimGeneration: generation };
      requireLifecycleApplied(f.service.workerTransition({ commandId: id(), runId: claimed.envelope.runId,
        claim, lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW } }));
      running = requireLifecycleApplied(f.service.workerTransition({ commandId: id(), runId: claimed.envelope.runId,
        claim, lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "crm-dates" } }));
      const before = f.database.getMeta();
      assert.deepEqual(f.service.terminalize(stale, personLookupDescriptor), { state: "refused", refusal: { reason: "lost" } });
      assert.deepEqual(f.database.getMeta(), before);
      assert.equal(f.database.authority.runs.get(running.envelope.runId)?.completion, undefined);
    }
    const current = failureTerminalRequest(running, id());
    current.terminal.authorization.claim = { workerId: finishingGeneration === 2 ? "person-lookup-worker-2" : WORKER_ID, claimGeneration: finishingGeneration };
    const terminal = requireLifecycleApplied(f.service.terminalize(current, personLookupDescriptor));
    assert.equal(terminal.completion?.claim.claimGeneration, finishingGeneration);
    const retry = requireLifecycleApplied(f.service.retry({ commandId: id(), runId: terminal.envelope.runId,
      expectedVersion: terminal.version, runtimeConfig: f.runtimeConfig }, personLookupDescriptor));
    assert.notEqual(retry.envelope.runId, terminal.envelope.runId);
    assert.equal(retry.envelope.retryOf, terminal.envelope.runId);
    assert.equal(retry.completion, undefined);
    assert.deepEqual(f.database.authority.runs.get(terminal.envelope.runId), terminal);
    assert.equal(f.service.terminalize(current, personLookupDescriptor).state, "applied-already");
    const claims = f.database.authority.timelineEvents.page({}).filter((record) => record.payload.kind === "span" && record.payload.event.t === "run.claimed");
    assert.equal(claims.length, finishingGeneration);
    claims.forEach((record, index) => {
      assert.ok(record.payload.kind === "span" && record.payload.event.t === "run.claimed");
      assert.equal(record.payload.event.claimGeneration, index + 1);
    });
  });
}

it("competing connections cannot accept conflicting failure settlements", async () => {
  const f = await fixture(); const running = runningRun(f.service, f.request, f.runtimeConfig);
  const firstRequest = failureTerminalRequest(running, "99000000-0000-4000-8000-000000000051");
  const secondRequest = failureTerminalRequest(running, "99000000-0000-4000-8000-000000000052");
  secondRequest.terminal.failure.failureId = UUID_5;
  secondRequest.terminal.authorization.failureId = UUID_5;
  const releases = [new SharedArrayBuffer(4), new SharedArrayBuffer(4)];
  const connections: Awaited<ReturnType<typeof raceConnection>>[] = [];
  try {
    for (const [index, request] of [firstRequest, secondRequest].entries()) {
      connections.push(await raceConnection({
        path: join(f.root, "state.db"), now: NOW, release: releases[index], runId: running.envelope.runId,
        operation: { kind: "terminal-failure", request: { commandId: request.commandId, terminal: request.terminal } },
      }));
    }
    const [first, second] = connections; assert.ok(first && second && releases[0] && releases[1]);
    assert.deepEqual(first.ready, { type: "ready" }); assert.deepEqual(second.ready, { type: "ready" });
    first.worker.postMessage("run"); assert.deepEqual(await first.next(), { type: "reserved" });
    second.worker.postMessage("run"); const busy = await second.next(); assert.equal(busy.type, "error");
    if (busy.type !== "error") throw new Error("competing settlement did not encounter held transaction");
    assert.match(busy.message, /locked|busy/);
    assert.deepEqual(f.database.authority.runs.get(running.envelope.runId), running);
    Atomics.store(new Int32Array(releases[0]), 0, 1); Atomics.notify(new Int32Array(releases[0]), 0);
    const accepted = await first.next(); assert.equal(accepted.type, "result");
    if (accepted.type !== "result") throw new Error("winning settlement missing");
    assert.equal(accepted.outcome.state, "applied");
    Atomics.store(new Int32Array(releases[1]), 0, 1); second.worker.postMessage("run");
    assert.deepEqual(await second.next(), { type: "result", outcome: { state: "refused", refusal: { reason: "lost" } } });
    assert.equal(f.database.authority.failures.listByRun(running.envelope.runId).length, 1);
    assert.equal(f.database.authority.failures.get(UUID_5), undefined);
    assert.equal(f.database.authority.lifecycleJournal.getCommand(secondRequest.commandId), undefined);
  } finally {
    await closeRaceConnections(connections, releases);
  }
});


describe("current settings selection",()=>{
  for(const operation of ["retry","restart"] as const)it(`${operation} selects active settings and preserves source and journal replay`,async ()=>{
    const f=await settingsFixture();
    try{
      const source=f.create(),terminal=requireLifecycleApplied(f.service.transition({commandId:UUID_5,
        runId:source.envelope.runId,expectedVersion:source.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW}}));
      assert.equal(f.save({"timeouts.taskMs":{set:90000}}).state,"applied");
      const selected=f.database.authority.runtimeConfig.get();assert.ok(selected);
      const request={commandId:"83000000-0000-4000-8000-000000000091",runId:terminal.envelope.runId,
        expectedVersion:terminal.version,runtimeConfig:selectRunRuntime(f.database.authority)};
      const next=requireLifecycleApplied(f.service[operation](request,personLookupDescriptor));
      assert.equal(next.envelope.configSnapshotId,selected.configSnapshotId);
      assert.equal(next.envelope.configFingerprint,selected.configFingerprint);
      assert.notEqual(next.envelope.configSnapshotId,terminal.envelope.configSnapshotId);
      assert.deepEqual(next.input,terminal.input);
      assert.deepEqual(f.database.authority.runs.get(terminal.envelope.runId),terminal);
      assert.equal(f.save({"timeouts.taskMs":{clear:true}}).state,"applied");
      const generation=f.database.getMeta().authorityGeneration;
      assert.deepEqual(requireLifecycleApplied(f.service[operation](request,personLookupDescriptor)),next);
      assert.equal(f.database.getMeta().authorityGeneration,generation);
    }finally{await f.close();}
  });
});

it("direct creation selects current settings while exact replay retains the original snapshot",async ()=>{
  const f=await settingsFixture();
  try{
    assert.equal(f.save({"timeouts.taskMs":{set:90000}}).state,"applied");
    const selected=f.database.authority.runtimeConfig.get();assert.ok(selected);
    const request=f.request(),next=created(f.service,request);
    assert.equal(next.envelope.configSnapshotId,selected.configSnapshotId);
    assert.equal(next.envelope.configFingerprint,selected.configFingerprint);
    assert.equal(f.save({"timeouts.taskMs":{clear:true}}).state,"applied");
    const generation=f.database.getMeta().authorityGeneration;
    assert.deepEqual(requireLifecycleApplied(f.service.create(request)),next);
    assert.equal(f.database.getMeta().authorityGeneration,generation);
  }finally{await f.close();}
});
