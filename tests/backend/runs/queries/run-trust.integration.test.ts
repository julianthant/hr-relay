import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { randomUUID as randomUUID_m0 } from "node:crypto";
import { join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m0 } from "node:sqlite";
import { afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1,vi } from "vitest";
import { projectFailureResolution as projectFailureResolution_m0 } from "../../../../src/backend/runs/queries/failure-resolution.js";
import { buildTrustSection as buildTrustSection_m0 } from "../../../../src/backend/runs/queries/run-trust.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { testWorkerPorts as testWorkerPorts_m1 } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { resolutionCommand as resolutionCommand_m0,resolutionFixture as resolutionFixture_m0,resolutionReadDeps as resolutionReadDeps_m0 } from "../../../support/helpers/failure-resolution/fixtures.js";

import { readGateParks as readGateParks_m1 } from "../../../../src/backend/app/composition/dashboard/trust.js";
import { explainRunFrom as explainRunFrom_m1 } from "../../../../src/backend/app/composition/explain-compose.js";
import { SectionUnavailableError as SectionUnavailableError_m1 } from "../../../../src/backend/runs/commands/refusals.js";
import { createNotificationInbox as createNotificationInbox_m1 } from "../../../../src/backend/runs/notifications/inbox.js";
import { buildRunGate as buildRunGate_m1,buildTrustSection as buildTrustSection_m1 } from "../../../../src/backend/runs/queries/run-trust.js";
import { createNoteTimelineWriter as createNoteTimelineWriter_m1 } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { seedPersonLookupExitRun as seedPersonLookupExitRun_m1 } from "../../../support/fixtures/receipt-run-fixtures.js";
import { uuidOf as uuidOf_m1 } from "../../../support/helpers/backend/dashboard-harness.js";
import { foldTrustGate as foldTrustGate_m1,trustWorld as trustWorld_m1 } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { personLookupDescriptor as personLookupDescriptor_m1 } from "../../../support/helpers/registered-workflows.js";


{


describe_m0("D capture identity and served resolution", () => {
  it_m0("preserves populated receipt/failure/completion bytes and digest while projecting current protected notes", () => {
    const f = resolutionFixture_m0();
    try {
      const deps = resolutionReadDeps_m0(f); assert_m0.ok(deps.trust);
      const receipt = deps.trust.ensureReceipt(f.record.runId);
      const sql = new DatabaseSync_m0(f.path);
      try {
        const immutable = () => JSON.stringify({runs:sql.prepare("SELECT * FROM runs ORDER BY id").all(),
          failures:sql.prepare("SELECT id,payload_json FROM run_failures ORDER BY id").all(),
          receipts:sql.prepare("SELECT * FROM run_receipts ORDER BY id").all()});
        const before = immutable();
        const note = "SYNTHETIC_PROTECTED_TEXT_10999999";
        assert_m0.equal(f.kernel.execute(resolutionCommand_m0({ payload: { action: "resolve", note } })).state, "applied");
        assert_m0.equal(immutable(), before);
        assert_m0.deepEqual(deps.trust.ensureReceipt(f.record.runId), receipt);
        const raw = deps.trust.failureResolution?.read(f.record.runId, f.record.failureId); assert_m0.ok(raw);
        assert_m0.ok(JSON.stringify(raw).includes(note));
        const served = buildTrustSection_m0(deps, f.record.runId, "failure");
        assert_m0.equal(JSON.stringify(served).includes(note), false);
        assert_m0.ok(JSON.stringify(served).includes("Protected resolution note withheld."));
        assert_m0.equal(JSON.stringify(projectFailureResolution_m0(raw, false)).includes(note), true);
        const captured = structuredClone(served);
        f.kernel.execute(resolutionCommand_m0({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 2 }, payload: { action: "reopen" } }));
        assert_m0.ok(JSON.stringify(captured).includes('"status":"resolved"'));
        assert_m0.ok(JSON.stringify(buildTrustSection_m0(deps, f.record.runId, "failure")).includes('"status":"unresolved"'));
        assert_m0.equal(immutable(), before);
        assert_m0.deepEqual(deps.trust.ensureReceipt(f.record.runId), receipt);
      } finally { sql.close(); }
    } finally { f.dispose(); }
  });
  it_m0("canonical deletion removes annotations; cached targets and new commands cannot resurrect them", () => {
    const f = resolutionFixture_m0();
    try {
      f.kernel.execute(resolutionCommand_m0());
      const run = f.db.authority.runs.get(f.record.runId); assert_m0.ok(run);
      const outcome=f.kernel.execute({commandId:randomUUID_m0(),requestedAt:f.clock.now().toISOString(),requestedBy:"local-operator",
        source:"dashboard",family:"run",type:"delete",target:{runId:f.record.runId,expectedVersion:run.version}});
      assert_m0.equal(outcome.state,"applied");
      assert_m0.ok(f.db.authority.deletedRuns.get(f.record.runId));
      assert_m0.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId), undefined);
      const generation = f.db.getMeta().authorityGeneration;
      const stale = resolutionCommand_m0({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 2 }, payload: { action: "reopen" } });
      assert_m0.deepEqual(f.kernel.execute(stale), { state: "rejected", commandId: stale.commandId, code: "target-deleted", message: "The failure's run was deleted." });
      assert_m0.equal(f.db.getMeta().authorityGeneration, generation);
      assert_m0.equal(f.db.authority.commands.get(stale.commandId), undefined);
    } finally { f.dispose(); }
  });
});

it_m0("corrupt protected annotation JSON fails by name without echoing private text", () => {
  const f = resolutionFixture_m0(); const sql = new DatabaseSync_m0(f.path);
  try {
    sql.exec("PRAGMA ignore_check_constraints=ON");
    // Fault injection removes only this disposable fixture's immutable update trigger.
    const triggers = sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='run_failures'").all();
    for (const row of triggers) { assert_m0.equal(typeof row.name, "string"); sql.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`); }
    sql.prepare("UPDATE run_failures SET resolution_json=? WHERE id=?").run('SYNTHETIC_PRIVATE_NOTE_INVALID_JSON', f.record.failureId);
    assert_m0.throws(() => buildTrustSection_m0(resolutionReadDeps_m0(f), f.record.runId, "failure"), error =>
      error instanceof Error && error.message === "failure-resolution-annotation-invalid");
  } finally { sql.close(); f.dispose(); }
});
}

{


const worlds: ReturnType<typeof trustWorld_m1>[] = [];
function fixture() { const value = trustWorld_m1(); worlds.push(value); return value; }
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const value of worlds.splice(0).reverse()) value.dispose(); };

function inbox(value: ReturnType<typeof trustWorld_m1>) {
  let id = 7000;
  return createNotificationInbox_m1({ authority: value.database, runReader: value.reader, clock: value.world.clock,
    ids: { uuid: () => uuidOf_m1(id++) }, actorId: "local-operator" });
}

describe_m1("canonical trust linkage", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("serves a real derived receipt and Explain by run or trace without any span fold", () => {
    const f = fixture();
    testWorkerPorts_m1(f.database, f.world.clock, { path: join_m1(f.world.stateRoot, "trust.sqlite"), descriptor: personLookupDescriptor_m1, poolIndex: 1 });
    const { run } = seedPersonLookupExitRun_m1(f.database);
    assert_m1.equal(f.world.projection.runFold(run.envelope.runId), undefined);
    const result = buildTrustSection_m1(f.deps, run.envelope.runId, "receipt");
    assert_m1.equal(result.section, "receipt");
    const original = canonicalJsonStringify_m1(f.receipts.ensureReceipt(run.envelope.runId));
    assert_m1.deepEqual(explainRunFrom_m1(f.database, run.envelope.runId), explainRunFrom_m1(f.database, run.envelope.traceId));
    assert_m1.equal(canonicalJsonStringify_m1(f.receipts.ensureReceipt(run.envelope.runId)), original);
  });

  it_m1("keeps no-fold log pages immutable and refuses retained lines after canonical deletion", () => {
    const f = fixture(); const run = f.create(1); const id = run.envelope.runId;
    const writer = createNoteTimelineWriter_m1({ repository: f.database.authority.timelineEvents, clock: f.world.clock, pid: 999 });
    const append = (message: string) => writer.emitNote({ workflow: run.envelope.workflow,
      address: { runId: id, traceId: run.envelope.traceId, spanPath: run.envelope.traceId, attempt: run.envelope.attempt },
      level: "step", message });
    for (let i = 0; i < 201; i++) append(`trust note ${String(i)}`);
    const first = buildTrustSection_m1(f.deps, id, "logs");
    assert_m1.equal(first.section, "logs"); if (first.section !== "logs") throw new Error("wrong section");
    assert_m1.ok(first.payload.rows);
    assert_m1.equal(first.payload.rows.length, 200);
    const cursor = first.payload.nextCursor; assert_m1.equal(cursor.state, "present");
    if (cursor.state !== "present") throw new Error("missing next page");
    append("late note");
    const second = buildTrustSection_m1(f.deps, id, "logs", cursor.value);
    assert_m1.equal(second.section, "logs"); if (second.section !== "logs") throw new Error("wrong section");
    assert_m1.ok(second.payload.rows);
    assert_m1.equal(second.payload.rows.length, 1);
    const source = f.database.authority.timelineEvents.page({ runId: run.envelope.runId });
    assert_m1.equal(source.filter(row => row.payload.kind === "note").length, 202);
    const terminal = f.cancel(run, 2);
    assert_m1.equal(f.service.delete({ commandId: uuidOf_m1(3), runId: id, expectedVersion: terminal.version }).state, "deleted");
    assert_m1.throws(() => buildTrustSection_m1(f.deps, id, "logs", cursor.value), /deleted/);
    assert_m1.deepEqual(f.database.authority.timelineEvents.page({ runId: run.envelope.runId }), []);
    assert_m1.throws(() => buildTrustSection_m1(f.deps, uuidOf_m1(88), "logs"), /absent/);
  });

  it_m1("refuses a receipt's foreign identity and leaves its immutable source untouched", () => {
    const f = fixture(); const a = f.cancel(f.create(20), 21); const b = f.cancel(f.create(22), 23);
    const foreign = f.receipts.ensureReceipt(b.envelope.runId);
    const deps = { ...f.deps, trust: { ...f.receipts, ensureReceipt: () => foreign } };
    assert_m1.throws(() => buildTrustSection_m1(deps, a.envelope.runId, "receipt"), /TRUST_EVIDENCE_IDENTITY_MISMATCH/);
    assert_m1.deepEqual(f.database.authority.evidenceReceipts.findByRun(b.envelope.runId), foreign);
    assert_m1.equal(f.database.authority.evidenceReceipts.findByRun(a.envelope.runId), undefined);
  });

  it_m1("uses canonical gate parks with no fold and refuses a stale list without publishing a partial set", () => {
    const f = fixture(); const run = f.create(30);
    const claimed = f.database.authority.runs.claimNext({ workflow: run.envelope.workflow, workerId: f.workerId, now: f.world.clock.now().toISOString() });
    assert_m1.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("not claimed");
    let parked = claimed.run;
    for (const lifecycle of [
      { state: "validating", workerId: f.workerId, claimedAt: parked.lifecycle.state === "claimed" ? parked.lifecycle.claimedAt : "", heartbeatAt: f.world.clock.now().toISOString() },
      { state: "running", workerId: f.workerId, claimedAt: f.world.clock.now().toISOString(), heartbeatAt: f.world.clock.now().toISOString() },
      { state: "parked-gate", gateId: "identity-approval", parkedAt: f.world.clock.now().toISOString(), resumeAt: "identity-approval" },
    ]) {
      const outcome = f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: parked.version,
        claim: { workerId: f.workerId, claimGeneration: claimed.run.claimGeneration }, now: f.world.clock.now().toISOString(), lifecycle });
      assert_m1.equal(outcome.state, "applied"); if (outcome.state !== "applied") throw new Error("park refused");
      parked = outcome.run;
    }
    assert_m1.equal(f.world.projection.runFold(run.envelope.runId), undefined);
    assert_m1.equal((buildRunGate_m1(f.deps, run.envelope.runId, undefined, parked) as {state:string}).state, "open");
    assert_m1.deepEqual(readGateParks_m1(f.database, f.reader), [{ runId: run.envelope.runId, workflowId: run.envelope.workflow, gateId: "identity-approval" }]);
    const identity = buildTrustSection_m1(f.deps, run.envelope.runId, "identity-gate");
    assert_m1.equal(identity.section, "identity-gate");
    assert_m1.throws(() => buildRunGate_m1({ ...f.deps, authority: { ...f.deps.authority,
      listGateResults: () => [{ runId: uuidOf_m1(999) } as ReturnType<typeof f.deps.authority.listGateResults>[number]] } },
    run.envelope.runId, undefined, parked), /IDENTITY_MISMATCH/);
    let calls = 0;
    assert_m1.throws(() => readGateParks_m1(f.database, { ...f.reader, list: () => ++calls === 1
      ? { state: "listed", rows: [parked], cursor: { generation: 1, offset: 1, disposition: "live" } }
      : { state: "refused", refusal: { reason: "cursor-stale" } } }), /cursor-stale/);
    assert_m1.equal(calls, 2);
    assert_m1.equal(f.database.authority.notifications.listByActor("local-operator").length, 0);
    const resolvedFold = foldTrustGate_m1(f.world, parked, "resolved");
    assert_m1.equal((buildRunGate_m1(f.deps, run.envelope.runId, resolvedFold, parked) as { state: string }).state, "open",
      "stale resolved evidence cannot close the real canonical gate");
    const queued = f.create(34); const openFold = foldTrustGate_m1(f.world, queued, "open");
    assert_m1.equal((buildRunGate_m1(f.deps, queued.envelope.runId, openFold, queued) as { state: string }).state, "absent",
      "stale open evidence cannot grant a gate to a canonical queued run");
    assert_m1.throws(() => buildTrustSection_m1(f.deps, queued.envelope.runId, "parked-write"), SectionUnavailableError_m1);

  });

  it_m1("refuses unconfigured admission and mismatched notification workflow before durable writes or delivery", async () => {
    const f = fixture(); const run = f.create(40);
    const { runReader: _reader, ...unconfigured } = f.deps;
    assert_m1.throws(() => buildTrustSection_m1(unconfigured, run.envelope.runId, "logs"), /NOT_CONFIGURED/);
    const notifications = inbox(f);
    await assert_m1.rejects(notifications.publish({ kind: "gate-opened", runId: run.envelope.runId,
      workflowId: "separations", gateId: "identity-approval" }), /IDENTITY_MISMATCH/);
    assert_m1.equal(notifications.list("local-operator").length, 0);
  });
});
}
