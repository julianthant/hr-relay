import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { CANONICAL_WORKER_ID as WORKER_ID, createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { CreateRunRequestSchema, RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../../src/models/write-safety/protected-input.js";
import { RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandOperationSchema, RunLifecycleCommandRecordSchema } from "../../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { COMMAND_FIXTURES, GATE_RESULT, HASH_A, NOW, UUID_5, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_SESSION, RUN_SESSION_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { boundProfileAdmission } from "../../../support/helpers/admission-fixture.js";

const {fixture, created, runningRun, parkedWriteIntent, raceConnection, closeRaceConnections, cleanup } = createRunRecordServiceTestWorld();

afterEach(cleanup);

function lifecycleCommand(
  request: unknown,
  operation: z.input<typeof RunLifecycleCommandOperationSchema>,
  fence: z.input<typeof RunLifecycleCommandRecordSchema>["fence"] = { kind: "none" },
) {
  const commandId = z.object({ commandId: z.string() }).parse(request).commandId;
  const create = CreateRunRequestSchema.parse(request);
  const fingerprintInput = valueFreeProtectedData(create, retainedRunProtectedBindings({
    envelope: { workflow: create.workflow }, input: create.input,
  }));
  return RunLifecycleCommandRecordSchema.parse({
    kind: "run-lifecycle",
    commandId,
    operation,
    request: fingerprintInput,
    requestFingerprint: sha256Hex(
      `hrauto:run-lifecycle-command:v1\0${operation}\0${canonicalJsonStringify(fingerprintInput)}`,
    ),
    fence,
    recordedAt: NOW,
  });
}

describe("canonical run-record service", () => {

  it("refuses cross-kind ids and fails loud for every partial or mismatched journal pair", () => {
    const crossKind = fixture();
    crossKind.database.withAuthorityTransaction(({ commands }) => {
      commands.insert(COMMAND_FIXTURES[0]);
    });
    const crossKindGeneration = crossKind.database.getMeta().authorityGeneration;
    assert.deepEqual(crossKind.service.create(crossKind.request), {
      state: "refused",
      refusal: { reason: "replay-divergent" },
    });
    assert.equal(crossKind.database.getMeta().authorityGeneration, crossKindGeneration);

    const commandOnly = fixture();
    const commandOnlyRecord = lifecycleCommand(commandOnly.request, "create");
    commandOnly.database.withAuthorityTransaction(({ lifecycleJournal }) => {
      lifecycleJournal.insertCommand(commandOnlyRecord);
    });
    const commandOnlyGeneration = commandOnly.database.getMeta().authorityGeneration;
    assert.throws(() => commandOnly.service.create(commandOnly.request), /has no audit/u);
    assert.equal(commandOnly.database.getMeta().authorityGeneration, commandOnlyGeneration);

    const auditOnly = fixture();
    const auditOnlyRecord = lifecycleCommand(auditOnly.request, "create");
    const audit = RunLifecycleCommandAuditRecordSchema.parse({
      kind: "run-lifecycle",
      auditId: auditOnlyRecord.commandId,
      request: auditOnlyRecord,
      result: { kind: "run", runId: UUID_5, appliedVersion: 1 },
      completedAt: NOW,
    });
    const auditOnlySqlite = new DatabaseSync(join(auditOnly.root, "state.db"));
    try {
      auditOnlySqlite.exec("PRAGMA foreign_keys = OFF");
      auditOnlySqlite.prepare(`
        INSERT INTO command_audits (id, command_id, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(audit.auditId, audit.request.commandId, canonicalJsonStringify(audit), audit.completedAt);
    } finally {
      auditOnlySqlite.close();
    }
    const auditOnlyGeneration = auditOnly.database.getMeta().authorityGeneration;
    assert.throws(() => auditOnly.service.create(auditOnly.request), /command-audit-settlement-mismatch/u);
    assert.equal(auditOnly.database.getMeta().authorityGeneration, auditOnlyGeneration);

    const mismatched = fixture();
    const matchedCommand = lifecycleCommand(mismatched.request, "create");
    const mismatchedRequest = RunLifecycleCommandRecordSchema.parse({
      ...matchedCommand,
      operation: "claim-next",
      requestFingerprint: HASH_A,
    });
    const mismatchedGeneration = mismatched.database.getMeta().authorityGeneration;
    assert.throws(()=>mismatched.database.withAuthorityTransaction(({ lifecycleJournal }) => {
      lifecycleJournal.insertCommand(matchedCommand);
      lifecycleJournal.insertAudit({
        kind: "run-lifecycle",
        auditId: matchedCommand.commandId,
        request: mismatchedRequest,
        result: { kind: "run", runId: UUID_5, appliedVersion: 1 },
        completedAt: NOW,
      });
    }),/command-audit-request-mismatch/u);
    assert.equal(mismatched.database.authority.lifecycleJournal.getCommand(matchedCommand.commandId),undefined);
    assert.equal(mismatched.database.authority.lifecycleJournal.findAuditByCommand(matchedCommand.commandId),undefined);
    assert.equal(mismatched.database.getMeta().authorityGeneration, mismatchedGeneration);
  });

  it("#8 stale CAS reports the current version and writes nothing", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const run = created(service, request);
    const claimMember1 = database.authority.workerSlots.get(WORKER_ID);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    service.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime, commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig });
    const before = database.getMeta().authorityGeneration;
    const bytes = service.read(run.envelope.runId);
    assert.deepEqual(service.transition({ commandId: "60000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }),
    { state: "refused", refusal: { reason: "conflict", currentVersion: 2 } });
    assert.deepEqual(service.read(run.envelope.runId), bytes);
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("list uses priority, enqueue time and run id, and refuses a stale cursor", () => {
    const { service, request } = fixture();
    const bulk = created(service, request);
    const interactive = created(service, { ...request, commandId: UUID_5, priority: "interactive" });
    const page = service.list({ disposition: "live", limit: 1 });
    if (page.state !== "listed") throw new Error("list refused");
    assert.deepEqual(page.rows.map((run) => run.envelope.runId), [interactive.envelope.runId]);
    assert.ok(page.cursor);
    const second = service.list({ disposition: "live", limit: 1, cursor: page.cursor });
    if (second.state !== "listed") throw new Error("second page refused");
    assert.deepEqual(second.rows.map((run) => run.envelope.runId), [bulk.envelope.runId]);
    created(service, { ...request, commandId: "70000000-0000-4000-8000-000000000001" });
    assert.deepEqual(service.list({ disposition: "live", limit: 1, cursor: page.cursor }),
      { state: "refused", refusal: { reason: "cursor-stale" } });
  });

  for (const operation of ["enqueue", "claim", "terminal"] as const) {
    it(`rolls back ${operation} state and journal when required timeline persistence fails`, () => {
      const f = fixture();
      const run = operation === "enqueue" ? undefined : created(f.service, f.request);
      const raw = new DatabaseSync(join(f.root, "state.db"));
      try {
        raw.exec("CREATE TRIGGER injected_timeline_failure BEFORE INSERT ON timeline_events BEGIN SELECT RAISE(ABORT, 'injected timeline failure'); END");
        const before = f.database.getMeta();
        const events = f.database.authority.timelineEvents.page({});
        const state = run === undefined ? undefined : f.service.read(run.envelope.runId);
        const commandId = operation === "enqueue" ? f.request.commandId : UUID_5;
        assert.throws(() => {
          if (operation === "enqueue") f.service.create(f.request);
          else if (operation === "claim") f.service.claimNext({ commandId, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig: f.runtimeConfig, workerLifetime: testWorkerLifetime(f.database, WORKFLOW_ID, 1).workerLifetime });
          else {
            assert.ok(run);
            f.service.transition({ commandId, runId: run.envelope.runId, expectedVersion: run.version,
              lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
          }
        }, /injected timeline failure/);
        assert.deepEqual(f.database.getMeta(), before);
        assert.deepEqual(f.database.authority.timelineEvents.page({}), events);
        assert.equal(f.database.authority.lifecycleJournal.getCommand(commandId), undefined);
        if (run !== undefined) assert.deepEqual(f.service.read(run.envelope.runId), state);
        else assert.equal(f.database.authority.runs.listByWorkflow(WORKFLOW_ID).length, 0);
      } finally { raw.close(); }
    });
  }

  it("keeps one gate opening when a parked run is renamed and the rename is replayed", () => {
    const f = fixture();
    const running = runningRun(f.service, f.request, f.runtimeConfig);
    const parked = f.service.workerTransition({ commandId: "83000000-0000-4000-8000-000000000077",
      runId: running.envelope.runId, claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "parked-gate", gateId: GATE_RESULT.gateId, parkedAt: NOW, resumeAt: "crm-dates" } });
    if (parked.state !== "applied") throw new Error("park refused");
    const before = f.database.authority.timelineEvents.page({});
    const request = { commandId: "83000000-0000-4000-8000-000000000078",
      runId: running.envelope.runId, expectedVersion: parked.run.version, displayName: "Reviewed parked run" };
    const renamed = f.service.transition(request);
    if (renamed.state !== "applied") throw new Error("rename refused");
    assert.equal(renamed.run.displayName, request.displayName);
    assert.equal(f.service.transition(request).state, "applied-already");
    assert.deepEqual(f.database.authority.timelineEvents.page({}), before);
    const world = makeWorld();
    try {
      world.authority.records.set(running.envelope.runId, renamed.run);
      for (const record of f.database.authority.timelineEvents.page({})) {
        if (record.payload.kind === "span") world.writer.emit(record.payload.event);
      }
      assert.equal(world.projection.runFold(running.envelope.runId)?.openGates.length, 1);
    } finally { world.dispose(); }
  });

  it("rolls back gate parking when its required opened event fails", () => {
    const f = fixture();
    const running = runningRun(f.service, f.request, f.runtimeConfig);
    const raw = new DatabaseSync(join(f.root, "state.db"));
    try {
      raw.exec("CREATE TRIGGER injected_gate_event BEFORE INSERT ON timeline_events WHEN json_extract(NEW.payload_json, '$.payload.event.t') = 'gate.opened' BEGIN SELECT RAISE(ABORT, 'injected gate event'); END");
      const before = f.database.getMeta();
      const events = f.database.authority.timelineEvents.page({});
      const commandId = "83000000-0000-4000-8000-000000000007";
      assert.throws(() => f.service.workerTransition({ commandId, runId: running.envelope.runId,
        claim: { workerId: WORKER_ID, claimGeneration: 1 },
        lifecycle: { state: "parked-gate", gateId: GATE_RESULT.gateId, parkedAt: NOW, resumeAt: "crm-dates" },
      }), /injected gate event/u);
      assert.deepEqual(f.database.authority.runs.get(running.envelope.runId), running);
      assert.deepEqual(f.database.getMeta(), before);
      assert.deepEqual(f.database.authority.timelineEvents.page({}), events);
      assert.equal(f.database.authority.lifecycleJournal.getCommand(commandId), undefined);
    } finally { raw.close(); }
  });

  it("queue-root publication waits for the outer transaction and disappears on rollback", () => {
    const { service, request, database, published } = fixture();
    let rolledBack: RunRecord | undefined;
    assert.throws(() => database.withAuthorityTransaction(() => {
      rolledBack = created(service, request);
      assert.equal(database.authority.timelineEvents.page({}).length, 1);
      assert.equal(published.length, 0);
      throw new Error("outer command refused");
    }), /outer command refused/);
    assert.equal(published.length, 0);
    assert.ok(rolledBack);
    assert.equal(service.read(rolledBack.envelope.runId).state, "absent");
    assert.deepEqual(database.authority.timelineEvents.page({}), []);
    database.withAuthorityTransaction(() => {
      created(service, { ...request, commandId: UUID_5 });
      assert.equal(published.length, 0);
    });
    assert.equal(published.length, 1);
  });

  it("#11 retry and restart create new attempts and preserve source identity", () => {
    const { service, request, runtimeConfig, database } = fixture();
    database.authority.runSessions.insert(RUN_SESSION);
    const run = created(service, { ...request, sessionId: RUN_SESSION_ID, descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint });
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const source = service.read(run.envelope.runId);
    const retry = service.retry({ commandId: "80000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 2, runtimeConfig }, personLookupDescriptor);
    assert.equal(retry.state, "applied");
    if (retry.state !== "applied") throw new Error("retry refused");
    assert.equal(retry.run.envelope.itemId, run.envelope.itemId);
    assert.equal(retry.run.envelope.attempt, 2);
    assert.equal(retry.run.envelope.retryOf, run.envelope.runId);
    assert.equal(retry.run.envelope.recovery, undefined);
    assert.equal(retry.run.sessionId, RUN_SESSION_ID);
    assert.deepEqual(retry.run.input, run.input);
    service.transition({ commandId: "80000000-0000-4000-8000-000000000002",
      runId: retry.run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const restart = service.restart({ commandId: "80000000-0000-4000-8000-000000000003",
      runId: run.envelope.runId, expectedVersion: 2, runtimeConfig }, personLookupDescriptor);
    assert.equal(restart.state, "applied");
    if (restart.state !== "applied") throw new Error("restart refused");
    assert.equal(restart.run.envelope.attempt, 3);
    assert.equal(restart.run.sessionId, RUN_SESSION_ID);
    assert.equal(restart.run.envelope.recovery, "restart-from-start");
    assert.equal(restart.run.envelope.retryOf, run.envelope.runId);
    assert.deepEqual(service.read(run.envelope.runId), source);
  });

  it("#12 refuses retry from deleted and unresolved-write sources without minting a run", () => {
    const deletedWorld = fixture();
    const deleted = created(deletedWorld.service, {
      ...deletedWorld.request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    deletedWorld.service.transition({
      commandId: "86000000-0000-4000-8000-000000000001",
      runId: deleted.envelope.runId,
      expectedVersion: deleted.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    deletedWorld.service.delete({
      commandId: "86000000-0000-4000-8000-000000000002",
      runId: deleted.envelope.runId,
      expectedVersion: 2,
    });
    const deletedGeneration = deletedWorld.database.getMeta().authorityGeneration;
    assert.deepEqual(deletedWorld.service.retry({
      commandId: "86000000-0000-4000-8000-000000000003",
      runId: deleted.envelope.runId,
      expectedVersion: 2,
      runtimeConfig: deletedWorld.runtimeConfig,
    }, personLookupDescriptor), { state: "refused", refusal: { reason: "source-deleted" } });
    assert.equal(deletedWorld.database.getMeta().authorityGeneration, deletedGeneration);

    const parkedWorld = fixture();
    const running = runningRun(parkedWorld.service, parkedWorld.request, parkedWorld.runtimeConfig);
    const intent = parkedWriteIntent(parkedWorld.database, running, {
      writeIntentId: "86000000-0000-4000-8000-000000000099", code: "unknown", message: "external outcome is unknown",
    });
    const parked = parkedWorld.service.workerTransition({
      commandId: "86000000-0000-4000-8000-000000000004",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-write",
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
        parkedAt: NOW,
        code: "unknown",
        message: "external outcome is unknown",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("parked transition refused");
    const parkedGeneration = parkedWorld.database.getMeta().authorityGeneration;
    assert.deepEqual(parkedWorld.service.retry({
      commandId: "86000000-0000-4000-8000-000000000005",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      runtimeConfig: parkedWorld.runtimeConfig,
    }, personLookupDescriptor), { state: "refused", refusal: { reason: "invalid-state" } });
    assert.equal(parkedWorld.database.getMeta().authorityGeneration, parkedGeneration);
    assert.equal(parkedWorld.database.authority.runs.listByItem({
      workflow: running.envelope.workflow,
      itemId: running.envelope.itemId,
    }).length, 1);
  });

  it("#20 returns every closed existence arm", () => {
    const { service, request } = fixture();
    const live = created(service, request);
    const deletedSource = created(service, {
      ...request,
      commandId: "88000000-0000-4000-8000-000000000004",
      matchKey: "existence-deleted",
    });
    const deleteTerminal = service.transition({
      commandId: "88000000-0000-4000-8000-000000000005",
      runId: deletedSource.envelope.runId,
      expectedVersion: deletedSource.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (deleteTerminal.state !== "applied") throw new Error("existence delete setup refused");
    const deleted = service.delete({
      commandId: "88000000-0000-4000-8000-000000000006",
      runId: deletedSource.envelope.runId,
      expectedVersion: deleteTerminal.run.version,
    });
    if (deleted.state !== "deleted" || !("tombstones" in deleted)) throw new Error("existence delete refused");
    const tombstone = deleted.tombstones[0];
    assert.ok(tombstone !== undefined);

    assert.deepEqual(service.read("88000000-0000-4000-8000-000000000099"), {
      state: "absent",
      runId: "88000000-0000-4000-8000-000000000099",
    });
    assert.deepEqual(service.read(live.envelope.runId), { state: "present", disposition: "live", run: live });
    assert.deepEqual(service.read(deletedSource.envelope.runId), { state: "deleted", tombstone });
  });

  it("#17 refuses a non-terminal root without writing a tombstone", () => {
    const { service, request, database } = fixture();
    const run = created(service, request);
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.delete({
      commandId: "89000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
    }), { state: "refused", refusal: { reason: "not-terminal" } });
    assert.equal(database.authority.deletedRuns.get(run.envelope.runId), undefined);
    assert.deepEqual(service.read(run.envelope.runId), { state: "present", disposition: "live", run });
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("#15/#17/#26 delete writes each tombstone first, removes leaves first, and settles each tally once", () => {
    const deleteSteps: { runId: string; step: string }[] = [];
    const { service, request, database } = fixture(undefined, {
      afterDeleteStep: (event) => deleteSteps.push(event),
    });
    const anchor = created(service, { ...request, shape: "operation" });
    const terminalAnchor = service.transition({
      commandId: "90000000-0000-4000-8000-000000000003",
      runId: anchor.envelope.runId,
      expectedVersion: anchor.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(terminalAnchor.state, "applied");
    if (terminalAnchor.state !== "applied") throw new Error("anchor settle refused");
    const members = [1, 2].map((n) => created(service, { ...request,
      commandId: `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      matchKey: `synthetic-member-${String(n)}`, shape: "operation-member",
      parent: { runId: anchor.envelope.runId, tracePrefix: anchor.envelope.traceId, edgeId: "members" },
    }));
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.delete({ commandId: "90000000-0000-4000-8000-000000000004",
      runId: anchor.envelope.runId, expectedVersion: terminalAnchor.run.version }),
    { state: "refused", refusal: { reason: "tree-non-terminal", runId: members[0].envelope.runId } });
    assert.equal(database.getMeta().authorityGeneration, before);
    for (const [index, member] of members.entries()) {
      service.transition({ commandId: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        runId: member.envelope.runId, expectedVersion: 1,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      assert.deepEqual(service.delete({ commandId: `b0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        runId: member.envelope.runId, expectedVersion: 2 }),
      { state: "refused", refusal: { reason: "is-member" } });
    }
    const beforeDelete = database.getMeta().authorityGeneration;
    const outcome = service.delete({ commandId: "90000000-0000-4000-8000-000000000005",
      runId: anchor.envelope.runId, expectedVersion: terminalAnchor.run.version });
    assert.equal(outcome.state, "deleted");
    if (outcome.state !== "deleted" || !("tombstones" in outcome)) throw new Error("tree delete refused");
    assert.deepEqual(outcome.tombstones.map((entry) => entry.runId),
      [...members.map((member) => member.envelope.runId), anchor.envelope.runId]);
    const deletionOrder=["tombstone","delegation_dependencies","run_delegations","diagnostic_files","diagnostic_snapshots","run_receipts","run_results","run_failures","timeline_events","gate_results","run_checkpoints","dryrun_results","run_search","runs","cascade-complete"];
    assert.deepEqual(deleteSteps, [...members, anchor].flatMap(run=>deletionOrder.map(step=>({runId:run.envelope.runId,step}))));
    for (const tombstone of outcome.tombstones) {
      assert.deepEqual(database.authority.deletedRuns.get(tombstone.runId), tombstone);
      assert.deepEqual(tombstone.removed, [{ table: "run_results", rows: 1 }, { table: "timeline_events", rows: 2 }, { table: "run_search", rows: 1 }, { table: "runs", rows: 1 }]);
      assert.equal(tombstone.tallyVersion, 3);
    }
    assert.equal(database.getMeta().authorityGeneration, beforeDelete + 1);
    for (const run of [...members, anchor]) assert.equal(service.read(run.envelope.runId).state, "deleted");
  });

  it("requests cancellation on both a claimed anchor and claimed member without settling either", () => {
    const { service, request, runtimeConfig, database, clock } = fixture();
    const anchor = runningRun(service, { ...request, shape: "operation" }, runtimeConfig);
    const member = created(service, { ...request, commandId: "99000000-0000-4000-8000-000000000001", matchKey: "claimed-member",
      shape: "operation-member", parent: { runId: anchor.envelope.runId, tracePrefix: anchor.envelope.traceId, edgeId: "member" } });
    testWorkerPorts(database, clock, { path: syntheticDatabasePath(database), descriptor: personLookupDescriptor, poolIndex: 2 });
    const claimMember2 = database.authority.workerSlots.get("person-lookup-worker-2");
    if (claimMember2 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = service.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember2.poolIndex).workerLifetime, commandId: "99000000-0000-4000-8000-000000000002", workflow: WORKFLOW_ID,
      workerId: "person-lookup-worker-2", runtimeConfig });
    assert.equal(claimed.state, "applied");
    const cancelled = service.transition({ commandId: "99000000-0000-4000-8000-000000000003", runId: anchor.envelope.runId,
      expectedVersion: anchor.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(cancelled.state, "applied");
    for (const run of [anchor, member]) {
      const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
      assert.equal(current.cancelRequested, true);
      assert.notEqual(current.lifecycle.state, "terminal");
    }
  });

  it("#23 runs a multi-member group through cancel-tree and leaves-first deletion", () => {
    const writes: RunRecord[] = [];
    const { service, request } = fixture(undefined, {
      afterRunWrite: (run) => writes.push(run),
    });
    const anchor = created(service, { ...request, shape: "operation" });
    const members = [1, 2].map((index) => created(service, {
      ...request,
      commandId: `87000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      matchKey: `group-member-${String(index)}`,
      shape: "operation-member",
      parent: {
        runId: anchor.envelope.runId,
        tracePrefix: anchor.envelope.traceId,
        edgeId: `member-${String(index)}`,
      },
    }));
    writes.length = 0;
    const cancelled = service.transition({
      commandId: "87000000-0000-4000-8000-000000000003",
      runId: anchor.envelope.runId,
      expectedVersion: anchor.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(cancelled.state, "applied");
    if (cancelled.state !== "applied") throw new Error("group cancel refused");
    assert.deepEqual(writes.map(({ envelope }) => envelope.runId), [
      ...members.map(({ envelope }) => envelope.runId),
      anchor.envelope.runId,
    ]);
    assert.equal(cancelled.run.lifecycle.state, "terminal");
    for (const member of members) {
      const existence = service.read(member.envelope.runId);
      assert.equal(existence.state, "present");
      if (existence.state !== "present") throw new Error("group member disappeared");
      assert.equal(existence.run.lifecycle.state, "terminal");
      assert.deepEqual(service.delete({
        commandId: `87000000-0000-4000-8000-${String(member.envelope.attempt + 20).padStart(12, "0")}`,
        runId: member.envelope.runId,
        expectedVersion: existence.run.version,
      }), { state: "refused", refusal: { reason: "is-member" } });
    }
    const deleted = service.delete({
      commandId: "87000000-0000-4000-8000-000000000099",
      runId: anchor.envelope.runId,
      expectedVersion: cancelled.run.version,
    });
    assert.equal(deleted.state, "deleted");
    if (deleted.state !== "deleted" || !("tombstones" in deleted)) throw new Error("group delete refused");
    assert.deepEqual(deleted.tombstones.map(({ runId }) => runId), [
      ...members.map(({ envelope }) => envelope.runId),
      anchor.envelope.runId,
    ]);
  });

  for (const kind of ["create", "claim"] as const) {
    it(`${kind === "create" ? "#1" : "#4"} ${kind} serializes independent connections across a held reservation`, async () => {
      const { root, request, service, runtimeConfig, database, clock } = fixture();
      if (kind === "claim") {
        testWorkerPorts(database, clock, { path: syntheticDatabasePath(database), descriptor: personLookupDescriptor, poolIndex: 2 });
        created(service, request);
      }
      const releases = [new SharedArrayBuffer(4), new SharedArrayBuffer(4)];
      const connections: Awaited<ReturnType<typeof raceConnection>>[] = [];
      try {
        for (const [index, release] of releases.entries()) {
          connections.push(await raceConnection({
            path: join(root, "state.db"), now: NOW, release,
            runId: `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            operation: kind === "create" ? { kind, request: { ...request,
              commandId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            } } : { kind, request: { runtimeConfig, workflow: WORKFLOW_ID,
              workerId: `person-lookup-worker-${String(index + 1)}`,
              workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, index + 1).workerLifetime,
              commandId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            } },
          }));
        }
        const [first, second] = connections;
        assert.deepEqual(first.ready, { type: "ready" });
        assert.deepEqual(second.ready, { type: "ready" });
        first.worker.postMessage("run");
        assert.deepEqual(await first.next(), { type: "reserved" });
        second.worker.postMessage("run");
        const blocked = await second.next();
        assert.equal(blocked.type, "error", "second connection crossed the reservation before first commit");
        if (blocked.type !== "error") throw new Error("second connection did not block");
        assert.match(blocked.message, /database is locked/);
        Atomics.store(new Int32Array(releases[0]), 0, 1);
        Atomics.notify(new Int32Array(releases[0]), 0);
        const firstResult = await first.next();
        assert.equal(firstResult.type, "result");
        if (firstResult.type !== "result") throw new Error("first connection did not finish");
        assert.equal(firstResult.outcome.state, "applied");
        Atomics.store(new Int32Array(releases[1]), 0, 1);
        second.worker.postMessage("run");
        if (kind === "create") assert.deepEqual(await second.next(), { type: "reserved" });
        const secondResult = await second.next();
        assert.equal(secondResult.type, "result");
        if (secondResult.type !== "result") throw new Error("second connection did not finish");
        if (kind === "claim") {
          assert.deepEqual(secondResult.outcome, { state: "refused", refusal: { reason: "none-eligible" } });
        } else {
          assert.equal(secondResult.outcome.state, "applied");
          assert.deepEqual([firstResult.outcome.run.envelope.attempt, secondResult.outcome.run.envelope.attempt], [1, 2]);
          assert.deepEqual([firstResult.outcome.run.runNumber, secondResult.outcome.run.runNumber], [1, 2]);
        }
      } finally {
        await closeRaceConnections(connections, releases);
      }
    });
  }

  it("#22 removes only the deleted run's gate records and tallies them", () => {
    const { service, request, database } = fixture();
    const source = created(service, request);
    const peer = created(service, { ...request, commandId: UUID_5, matchKey: "synthetic-peer" });
    const sourceGate = { ...GATE_RESULT, runId: source.envelope.runId };
    const peerGate = { ...GATE_RESULT, runId: peer.envelope.runId };
    database.authority.gateResults.insert(sourceGate);
    database.authority.gateResults.insert(peerGate);
    service.transition({ commandId: "e0000000-0000-4000-8000-000000000001",
      runId: source.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const deleted = service.delete({ commandId: "e0000000-0000-4000-8000-000000000002",
      runId: source.envelope.runId, expectedVersion: 2 });
    assert.equal(deleted.state, "deleted");
    assert.deepEqual(database.authority.gateResults.listByRun(source.envelope.runId), []);
    assert.deepEqual(database.authority.gateResults.listByRun(peer.envelope.runId), [peerGate]);
    assert.deepEqual(database.authority.deletedRuns.get(source.envelope.runId)?.removed
      .filter((entry) => entry.table === "gate_results"), [{ table: "gate_results", rows: 1 }]);
    assert.equal(service.transition({
      commandId: "e0000000-0000-4000-8000-000000000003",
      runId: source.envelope.runId,
      expectedVersion: 2,
      lifecycle: { state: "queued" },
    }).state, "deleted", "a tombstoned gate target cannot re-enter the lifecycle");
    assert.deepEqual(database.authority.gateResults.listByRun(source.envelope.runId), []);
  });

  it("#2 refuses a minted id already held by a tombstone without touching authority", () => {
    const { service, request, database, clock } = fixture();
    const run = created(service, request);
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    service.delete({ commandId: "f0000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 2 });
    const collision = new RunRecordService({ database, clock, ids: { uuid: () => run.envelope.runId },
      publishQueued: () => assert.fail("tombstoned id must never publish a new queue root") });
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(collision.create({ ...request, commandId: "f0000000-0000-4000-8000-000000000002" }),
      { state: "refused", refusal: { reason: "tombstoned" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(service.read(run.envelope.runId).state, "deleted");
  });

  it("#17 session membership alone permits deletion and preserves the session", () => {
    const { service, request, database } = fixture();
    database.authority.runSessions.insert(RUN_SESSION);
    const run = created(service, { ...request, sessionId: RUN_SESSION_ID });
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const session = database.authority.runSessions.get(RUN_SESSION_ID);
    const deleted = service.delete({ commandId: "90000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 2 });
    assert.equal(deleted.state, "deleted");
    assert.equal(service.read(run.envelope.runId).state, "deleted");
    assert.deepEqual(database.authority.runSessions.get(RUN_SESSION_ID), session);
  });

  it("ignores a file root in canonical reads and current storage health", async () => {
    const { service, request, root, clock } = fixture();
    const runId = UUID_5;
    const traceId = "pl-120021-0000";
    const authorityPath = join(root, "state.db");
    const countTasks = () => {
      const sqlite = new DatabaseSync(authorityPath, { readOnly: true });
      try {
        return (sqlite.prepare("SELECT count(*) AS count FROM runs").get() as { count: number }).count;
      } finally {
        sqlite.close();
      }
    };
    assert.equal(countTasks(), 0);
    assert.deepEqual(service.read(runId), { state: "absent", runId });
    writeFileSync(join(root,"unowned-span.jsonl"),JSON.stringify({
      t: "run.queued", kind: "run", ts: NOW,
      workflow: request.workflow, runId, attempt: 1, traceId, spanPath: traceId,
      itemId: UUID_6, shape: request.shape, priority: request.priority, dryRun: request.dryRun,
      actorId: "local-operator", title: "Redacted span-only run",
      descriptorVersion: request.descriptorVersion,
      contractFingerprint: request.contractFingerprint,
      resolvedInstance: request.resolvedInstance,
      configFingerprint: request.configFingerprint,
      configSnapshotId: request.configSnapshotId,
    })+"\n");
    const doctor = await doctorAuthorityStorage(boundProfileAdmission(authorityPath), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: join(root, "backups", "authority"),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 250,
    }, clock);
    assert.deepEqual(doctor.spanAuthority, { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] });
    assert.deepEqual(service.read(runId), { state: "absent", runId });
    assert.equal(countTasks(), 0);
  });

});
