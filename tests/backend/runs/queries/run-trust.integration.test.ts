import { default as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { projectFailureResolution } from "../../../../src/backend/runs/queries/failure-resolution.js";
import { buildRunSection } from "../../../../src/backend/runs/queries/run-detail.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { resolutionCommand, resolutionFixture, resolutionReadDeps } from "../../../support/helpers/failure-resolution/fixtures.js";

import { readGateParks } from "../../../../src/backend/app/composition/dashboard/trust.js";
import { explainRunFrom } from "../../../../src/backend/app/composition/explain-compose.js";
import { SectionUnavailableError } from "../../../../src/backend/runs/commands/refusals.js";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { buildRunGate } from "../../../../src/backend/runs/queries/run-trust.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { foldTrustGate, trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

{

describe("D capture identity and served resolution", () => {
  it("preserves populated receipt/failure/completion bytes and digest while projecting current protected notes", async () => {
    const f = await resolutionFixture();
    try {
      const deps = resolutionReadDeps(f); assert.ok(deps.trust);
      const receipt = deps.trust.ensureReceipt(f.record.runId);
      const sql = new DatabaseSync(f.path);
      try {
        const immutable = () => JSON.stringify({runs:sql.prepare("SELECT * FROM runs ORDER BY id").all(),
          failures:sql.prepare("SELECT id,payload_json FROM run_failures ORDER BY id").all(),
          receipts:sql.prepare("SELECT * FROM run_receipts ORDER BY id").all()});
        const before = immutable();
        const note = "SYNTHETIC_PROTECTED_TEXT_10999999";
        assert.equal(f.kernel.execute(resolutionCommand({ payload: { action: "resolve", note } })).state, "applied");
        assert.equal(immutable(), before);
        assert.deepEqual(deps.trust.ensureReceipt(f.record.runId), receipt);
        const raw = deps.trust.failureResolution?.read(f.record.runId, f.record.failureId); assert.ok(raw);
        assert.ok(JSON.stringify(raw).includes(note));
        const served = buildRunSection(deps, f.record.runId, "failure");
        assert.equal(JSON.stringify(served).includes(note), false);
        assert.ok(JSON.stringify(served).includes("Protected resolution note withheld."));
        assert.equal(JSON.stringify(projectFailureResolution(raw, false)).includes(note), true);
        const captured = structuredClone(served);
        f.kernel.execute(resolutionCommand({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 2 }, payload: { action: "reopen" } }));
        assert.ok(JSON.stringify(captured).includes('"status":"resolved"'));
        assert.ok(JSON.stringify(buildRunSection(deps, f.record.runId, "failure")).includes('"status":"unresolved"'));
        assert.equal(immutable(), before);
        assert.deepEqual(deps.trust.ensureReceipt(f.record.runId), receipt);
      } finally { sql.close(); }
    } finally { await f.dispose(); }
  });
  it("canonical deletion removes annotations; cached targets and new commands cannot resurrect them", async () => {
    const f = await resolutionFixture();
    try {
      f.kernel.execute(resolutionCommand());
      const run = f.db.authority.runs.get(f.record.runId); assert.ok(run);
      const outcome=f.kernel.execute({commandId:randomUUID(),requestedAt:f.clock.now().toISOString(),requestedBy:"local-operator",
        source:"dashboard",family:"run",type:"delete",target:{runId:f.record.runId,expectedVersion:run.version}});
      assert.equal(outcome.state,"applied");
      assert.ok(f.db.authority.deletedRuns.get(f.record.runId));
      assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId), undefined);
      const generation = f.db.getMeta().authorityGeneration;
      const stale = resolutionCommand({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 2 }, payload: { action: "reopen" } });
      assert.deepEqual(f.kernel.execute(stale), { state: "rejected", commandId: stale.commandId, code: "target-deleted", message: "The failure's run was deleted." });
      assert.equal(f.db.getMeta().authorityGeneration, generation);
      assert.equal(f.db.authority.commands.get(stale.commandId), undefined);
    } finally { await f.dispose(); }
  });
});

it("corrupt protected annotation JSON fails by name without echoing private text", async () => {
  const f = await resolutionFixture(); const sql = new DatabaseSync(f.path);
  try {
    sql.exec("PRAGMA ignore_check_constraints=ON");
    // Fault injection removes only this disposable fixture's immutable update trigger.
    const triggers = sql.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='run_failures'").all();
    const original = sql.prepare("SELECT resolution_json FROM run_failures WHERE id=?").get(f.record.failureId); assert.ok(original);
    for (const row of triggers) { assert.equal(typeof row.name, "string"); sql.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`); }
    sql.prepare("UPDATE run_failures SET resolution_json=? WHERE id=?").run('SYNTHETIC_PRIVATE_NOTE_INVALID_JSON', f.record.failureId);
    assert.throws(() => buildRunSection(resolutionReadDeps(f), f.record.runId, "failure"), error =>
      error instanceof Error && error.message === "failure-resolution-annotation-invalid");
    sql.prepare("UPDATE run_failures SET resolution_json=? WHERE id=?").run(original.resolution_json, f.record.failureId);
    for (const trigger of triggers) { assert.equal(typeof trigger.sql, "string"); sql.exec(String(trigger.sql)); }
  } finally { sql.close(); await f.dispose(); }
});
}

{

const worlds: Awaited<ReturnType<typeof trustWorld>>[] = [];
async function fixture() { const value = await trustWorld(); worlds.push(value); return value; }
const _afterEachFixture0 = async () => { vi.restoreAllMocks(); for (const value of worlds.splice(0).reverse()) await value.dispose(); };

function inbox(value: Awaited<ReturnType<typeof trustWorld>>) {
  let id = 7000;
  return createNotificationInbox({ authority: value.database, runReader: value.reader, clock: value.world.clock,
    ids: { uuid: () => uuidOf(id++) }, actorId: "local-operator" });
}

describe("canonical trust linkage", () => {
afterEach(_afterEachFixture0);

  it("serves a real derived receipt and Explain by run or trace without any span fold", async () => {
    const f = await fixture();
    testWorkerPorts(f.database, f.world.clock, { path: f.profile.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    const { run } = seedPersonLookupExitRun(f.database);
    assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
    const result = buildRunSection(f.deps, run.envelope.runId, "receipt");
    assert.equal(result.section, "receipt");
    const original = canonicalJsonStringify(f.receipts.ensureReceipt(run.envelope.runId));
    assert.deepEqual(explainRunFrom(f.database, run.envelope.runId), explainRunFrom(f.database, run.envelope.traceId));
    assert.equal(canonicalJsonStringify(f.receipts.ensureReceipt(run.envelope.runId)), original);
  });

  it("keeps no-fold log pages immutable and refuses retained lines after canonical deletion", async () => {
    const f = await fixture(); const run = f.create(1); const id = run.envelope.runId;
    const writer = createNoteTimelineWriter({ repository: f.database.authority.timelineEvents, clock: f.world.clock, pid: 999 });
    const append = (message: string) => writer.emitNote({ workflow: run.envelope.workflow,
      address: { runId: id, traceId: run.envelope.traceId, spanPath: run.envelope.traceId, attempt: run.envelope.attempt },
      level: "step", message });
    for (let i = 0; i < 201; i++) append(`trust note ${String(i)}`);
    const first = buildRunSection(f.deps, id, "logs");
    assert.equal(first.section, "logs"); if (first.section !== "logs") throw new Error("wrong section");
    assert.ok(first.payload.rows);
    assert.equal(first.payload.rows.length, 200);
    const cursor = first.payload.nextCursor; assert.equal(cursor.state, "present");
    if (cursor.state !== "present") throw new Error("missing next page");
    append("late note");
    const second = buildRunSection(f.deps, id, "logs", cursor.value);
    assert.equal(second.section, "logs"); if (second.section !== "logs") throw new Error("wrong section");
    assert.ok(second.payload.rows);
    assert.equal(second.payload.rows.length, 1);
    const source = f.database.authority.timelineEvents.page({ runId: run.envelope.runId });
    assert.equal(source.filter(row => row.payload.kind === "note").length, 202);
    const terminal = f.cancel(run, 2);
    assert.equal(f.service.delete({ commandId: uuidOf(3), runId: id, expectedVersion: terminal.version }).state, "deleted");
    assert.throws(() => buildRunSection(f.deps, id, "logs", cursor.value), /deleted/);
    assert.deepEqual(f.database.authority.timelineEvents.page({ runId: run.envelope.runId }), []);
    assert.throws(() => buildRunSection(f.deps, uuidOf(88), "logs"), /absent/);
  });

  it("refuses a receipt's foreign identity and leaves its immutable source untouched", async () => {
    const f = await fixture(); const a = f.cancel(f.create(20), 21); const b = f.cancel(f.create(22), 23);
    const foreign = f.receipts.ensureReceipt(b.envelope.runId);
    const deps = { ...f.deps, trust: { ...f.receipts, ensureReceipt: () => foreign } };
    assert.throws(() => buildRunSection(deps, a.envelope.runId, "receipt"), /TRUST_EVIDENCE_IDENTITY_MISMATCH/);
    assert.deepEqual(f.database.authority.evidenceReceipts.findByRun(b.envelope.runId), foreign);
    assert.equal(f.database.authority.evidenceReceipts.findByRun(a.envelope.runId), undefined);
  });

  it("uses canonical gate parks with no fold and refuses a stale list without publishing a partial set", async () => {
    const f = await fixture(); const run = f.create(30);
    const claimMember1 = f.database.authority.workerSlots.get(f.workerId);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = f.database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(f.database, run.envelope.workflow, claimMember1.poolIndex).workerLifetime, workflow: run.envelope.workflow, workerId: f.workerId, now: f.world.clock.now().toISOString() });
    assert.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("not claimed");
    let parked = claimed.run;
    for (const lifecycle of [
      { state: "validating", workerId: f.workerId, workerLifetime: testWorkerLifetime(f.database, run.envelope.workflow, claimMember1.poolIndex).workerLifetime, claimedAt: parked.lifecycle.state === "claimed" ? parked.lifecycle.claimedAt : "", heartbeatAt: f.world.clock.now().toISOString() },
      { state: "running", workerId: f.workerId, workerLifetime: testWorkerLifetime(f.database, run.envelope.workflow, claimMember1.poolIndex).workerLifetime, claimedAt: f.world.clock.now().toISOString(), heartbeatAt: f.world.clock.now().toISOString() },
      { state: "parked-gate", gateId: "identity-approval", parkedAt: f.world.clock.now().toISOString(), resumeAt: "identity-approval" },
    ]) {
      const outcome = f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: parked.version,
        claim: { workerId: f.workerId, claimGeneration: claimed.run.claimGeneration }, now: f.world.clock.now().toISOString(), lifecycle });
      assert.equal(outcome.state, "applied"); if (outcome.state !== "applied") throw new Error("park refused");
      parked = outcome.run;
    }
    assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
    assert.equal((buildRunGate(f.deps, run.envelope.runId, undefined, parked) as {state:string}).state, "open");
    assert.deepEqual(readGateParks(f.database, f.reader), [{ runId: run.envelope.runId, workflowId: run.envelope.workflow, gateId: "identity-approval" }]);
    const identity = buildRunSection(f.deps, run.envelope.runId, "identity-gate");
    assert.equal(identity.section, "identity-gate");
    assert.throws(() => buildRunGate({ ...f.deps, authority: { ...f.deps.authority,
      listGateResults: () => [{ runId: uuidOf(999) } as ReturnType<typeof f.deps.authority.listGateResults>[number]] } },
    run.envelope.runId, undefined, parked), /IDENTITY_MISMATCH/);
    let calls = 0;
    assert.throws(() => readGateParks(f.database, { ...f.reader, list: () => ++calls === 1
      ? { state: "listed", rows: [parked], cursor: { generation: 1, offset: 1, disposition: "live" } }
      : { state: "refused", refusal: { reason: "cursor-stale" } } }), /cursor-stale/);
    assert.equal(calls, 2);
    assert.equal(f.database.authority.notifications.listByActor("local-operator").length, 0);
    const resolvedFold = foldTrustGate(f.world, parked, "resolved");
    assert.equal((buildRunGate(f.deps, run.envelope.runId, resolvedFold, parked) as { state: string }).state, "open",
      "stale resolved evidence cannot close the real canonical gate");
    const queued = f.create(34); const openFold = foldTrustGate(f.world, queued, "open");
    assert.equal((buildRunGate(f.deps, queued.envelope.runId, openFold, queued) as { state: string }).state, "absent",
      "stale open evidence cannot grant a gate to a canonical queued run");
    assert.throws(() => buildRunSection(f.deps, queued.envelope.runId, "parked-write"), SectionUnavailableError);

  });

  it("refuses unconfigured admission and mismatched notification workflow before durable writes or delivery", async () => {
    const f = await fixture(); const run = f.create(40);
    const { runReader: _reader, ...unconfigured } = f.deps;
    assert.throws(() => buildRunSection(unconfigured, run.envelope.runId, "logs"), /NOT_CONFIGURED/);
    const notifications = inbox(f);
    await assert.rejects(notifications.publish({ kind: "gate-opened", runId: run.envelope.runId,
      workflowId: "separations", gateId: "identity-approval" }), /IDENTITY_MISMATCH/);
    assert.equal(notifications.list("local-operator").length, 0);
  });
});
}
