import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, it } from "vitest";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { aggregateMemberRetryAvailable } from "../../../src/backend/runs/queries/run-retry.js";
import { assertDelegationRetryUnwritten } from "../../../src/backend/storage/sqlite/delegation-authority.js";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { EmergencyContactResultSchema, EmergencyContactMemberResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import { EmergencyContactMemberInputSchema } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { delegationEvidenceOutput, deriveRunResultDigest, deriveTerminalDependencyDigest } from "../../../src/models/run/result.js";
import { contactSaveMember, createEmergencyContactRetryWorld } from "../../support/helpers/backend/emergency-contact-retry-world.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting } from "../../../src/workflow-kit/workflow.js";
import { runWorkerLoop } from "../../../src/backend/runtime/workers/worker-loop.js";
import { workerRunLifecyclePort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createOcrApprovedSnapshotAdapter } from "../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import { createApprovedOcrRecordReader } from "../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { duoCeremonyGatesOver } from "../../support/helpers/duo-ceremony-fixtures.js";
import { testWorkerLifetime } from "../../support/fixtures/run-lifecycle-fixtures.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
let fixture: Fixture;
beforeEach(async context => {
  fixture = await world.fixture({ failures: context.task.name.startsWith("retries a settled")
    || context.task.name.endsWith("old accounting in a continuation") ? 2 : 1 });
});
const signal = () => new AbortController().signal;

function failed(f: Fixture) {
  const run = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"
    && !f.children().some(replacement => replacement.envelope.retryOf === child.envelope.runId));
  assert.ok(run); return run;
}

function originalBytes(f: Fixture) {
  const database = new DatabaseSync(f.path, { readOnly: true });
  try {
    return { results: database.prepare("SELECT id,payload_json,terminal_run_json FROM run_results WHERE run_id=? ORDER BY settlement_version").all(f.parentRun.envelope.runId),
      receipts: database.prepare("SELECT id,settlement_version,payload_json FROM run_receipts WHERE run_id=? ORDER BY id").all(f.parentRun.envelope.runId) };
  } finally { database.close(); }
}

function trust(f: Fixture) {
  return createReceiptService({ database: f.database, runReader: f.canonical.lifecycle,
    descriptors: [f.root.descriptor] });
}

async function replaceAndResume(f: Fixture) {
  const previous = failed(f), command = f.runCommand("retry", previous);
  const previousHold = f.current().pause;
  const applied = f.canonical.kernel.execute(command); assert.equal(applied.state, "applied", JSON.stringify(applied));
  if (previousHold !== undefined) assert.deepEqual(f.current().pause, previousHold);
  assert.deepEqual(f.canonical.kernel.execute(command), { ...applied, state: "already-applied" });
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  const completed = await f.canonical.step(f.parentRun, signal());
  assert.equal(completed.run.envelope.runId, replacement.envelope.runId);
  assert.ok(completed.outcome.state === "done" || completed.outcome.state === "failed");
  assert.equal(f.current().pause?.state, "paused");
  const envelope = canonicalJsonStringify(f.current().envelope);
  const resume = f.runCommand("resume", f.current());
  const resumed = f.canonical.kernel.execute(resume); assert.equal(resumed.state, "applied", JSON.stringify(resumed));
  assert.equal(canonicalJsonStringify(f.current().envelope), envelope);
  assert.deepEqual(f.canonical.kernel.execute(resume), { ...resumed, state: "already-applied" });
  assert.equal(f.database.authority.dependencies.readiness(f.parentRun.envelope.runId, "join").state, "ready");
  return replacement;
}

function assertAccounting(f: Fixture, expectedIds: readonly string[], previousGeneration: number) {
  const parent = f.current(); assert.ok(parent.completion?.kind === "done");
  const result = f.database.authority.runResults.get(parent.envelope.runId); assert.ok(result);
  const accounting = f.database.authority.runCheckpoints.listByAttempt(parent.envelope.workflow, parent.envelope.itemId,
    "read-result", parent.envelope.attempt).filter(row => row.runId === parent.envelope.runId).at(-1); assert.ok(accounting);
  assert.equal(accounting.claimGeneration, parent.claimGeneration);
  assert.ok(accounting.claimGeneration > previousGeneration);
  const output = EmergencyContactResultSchema.parse(accounting.output.value);
  assert.deepEqual(output.members.map(member => member.runId), expectedIds);
  assert.deepEqual(EmergencyContactResultSchema.parse(result.result.value), output);
  const dependency = result.dependencies.find(entry => entry.state === "resolved" && entry.nodeId === "read-result");
  assert.ok(dependency?.state === "resolved");
  assert.equal(dependency.checkpoint.claimGeneration, accounting.claimGeneration);
  assert.equal(result.dependencyDigest, deriveTerminalDependencyDigest(result.dependencies));
  const firstChild = f.children()[0]; assert.ok(firstChild);
  const expected = { approval: EmergencyContactMemberInputSchema.parse(firstChild.input.parsed.value).approval,
    members: delegationEvidenceOutput(f.database.authority.dependencies.evidence(parent.envelope.runId, "members"), EmergencyContactMemberResultSchema) };
  assert.deepEqual(output, expected);
  assert.equal(result.resultDigest, deriveRunResultDigest({ schemaHash: result.result.schemaHash, value: expected }));
  return { result, accounting };
}

for (const parentFailure of [false, true]) it(`retries a settled ${parentFailure ? "failed" : "done"} parent through manual Resume with immutable readable receipts and fresh accounting`, async () => {
  const f = fixture;
  f.control.failAccounting = parentFailure;
  await f.canonical.execute(f.parentRun, signal());
  const original = f.current(); assert.ok(original.completion);
  const authorization = authorizeWorkflowDelegationRefresh(f.root.descriptor, original); assert.ok(authorization);
  const plan = workflowDelegationAccounting(authorization, original); assert.ok(plan);
  assert.deepEqual(plan.recompute, ["read-result"]);
  assert.deepEqual(plan.retain, ["read-document", "approved-records"]);
  assert.throws(() => workflowDelegationAccounting({ ...authorization }, original), /delegation-refresh-factory-authorization-unavailable/);
  assert.equal(original.lifecycle.state === "terminal" ? original.lifecycle.outcome : "active", parentFailure ? "failed" : "done");
  const originalVersion = original.completion.expectedVersion + 1;
  const receipt = trust(f).ensureReceipt(original.envelope.runId);
  const originalRows = originalBytes(f);
  const successful = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"); assert.ok(successful);
  const successfulReceipt = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle,
    descriptors: [contactSaveMember.descriptor] }).ensureReceipt(successful.envelope.runId);
  assert.equal(aggregateMemberRetryAvailable(f.database.authority, f.canonical.lifecycle, failed(f), f.resolve), true);
  const successfulBytes = canonicalJsonStringify({ run: successful, result: f.database.authority.runResults.get(successful.envelope.runId),
    checkpoints: f.database.authority.runCheckpoints.listByItem(successful.envelope.workflow, successful.envelope.itemId) });
  const readOld = () => {
    const old = f.database.authority.runResults.getSettlement(original.envelope.runId, originalVersion); assert.ok(old);
    assert.deepEqual(old.run.envelope, original.envelope);
    assert.deepEqual(f.database.authority.evidenceReceipts.get(receipt.receiptId), receipt);
    assert.deepEqual(f.database.authority.evidenceReceipts.get(successfulReceipt.receiptId), successfulReceipt);
    const rows = originalBytes(f);
    for (const before of originalRows.results) assert.deepEqual(rows.results.find(row => row.id === before.id), before);
    for (const before of originalRows.receipts) assert.deepEqual(rows.receipts.find(row => row.id === before.id), before);
  };
  f.control.failAccounting = false;
  const first = await replaceAndResume(f); readOld();
  assert.equal(f.current().envelope.continuation, undefined);
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  const firstAccounting = assertAccounting(f, [successful.envelope.runId, first.envelope.runId], original.claimGeneration);
  assert.deepEqual(EmergencyContactResultSchema.parse(firstAccounting.result.result.value).members.map(member => member.state), ["done", "failed"]);
  assert.equal(f.database.authority.evidenceReceipts.findByRun(original.envelope.runId), undefined);
  readOld();
  const middle = f.current(); assert.ok(middle.completion);
  const middleVersion = middle.completion.expectedVersion + 1;
  const middleRows = originalBytes(f);
  const second = await replaceAndResume(f); readOld();
  const nextReceipt = f.database.authority.evidenceReceipts.listByRun(original.envelope.runId).find(row => row.receiptId !== receipt.receiptId); assert.ok(nextReceipt);
  const nextReceiptRow = originalBytes(f).receipts.find(row => row.id === nextReceipt.receiptId); assert.ok(nextReceiptRow);
  assert.equal(nextReceiptRow.settlement_version, middleVersion);
  assert.deepEqual(f.database.authority.runResults.getSettlement(original.envelope.runId, middleVersion)?.result, firstAccounting.result);
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  const secondAccounting = assertAccounting(f, [successful.envelope.runId, second.envelope.runId], firstAccounting.accounting.claimGeneration);
  assert.notEqual(secondAccounting.result.resultDigest, firstAccounting.result.resultDigest);
  assert.deepEqual(EmergencyContactResultSchema.parse(secondAccounting.result.result.value).members.map(member => member.state), ["done", "done"]);
  assert.equal(canonicalJsonStringify({ run: f.current(successful.envelope.runId), result: f.database.authority.runResults.get(successful.envelope.runId),
    checkpoints: f.database.authority.runCheckpoints.listByItem(successful.envelope.workflow, successful.envelope.itemId) }), successfulBytes);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
  readOld();
  assert.deepEqual(f.current().envelope, original.envelope);
  assert.ok(f.database.authority.evidenceReceipts.listByRun(original.envelope.runId).length >= 2);
  assert.deepEqual(f.database.authority.evidenceReceipts.get(nextReceipt.receiptId), nextReceipt);
  const finalRows = originalBytes(f);
  const notes = f.database.authority.timelineEvents.page({ runId: original.envelope.runId, limit: 1000 }).filter(row =>
    row.payload.kind === "note" && row.payload.note.message === "Member retry updated this outcome. The earlier receipt is retained.");
  assert.equal(notes.length, 2);
  const members = readQueueRecordMembers(f.database.authority, f.canonical.lifecycle, f.current(),
    f.database.authority.runs.listChildren(original.envelope.runId), f.resolve); assert.ok(members);
  assert.deepEqual(members.members.map(member => member.statusLabel), ["Saved", "Saved"]);
  assert.deepEqual(members.members.map(member => member.target.runId), [successful.envelope.runId, second.envelope.runId]);
  for (const before of middleRows.results) assert.deepEqual(finalRows.results.find(row => row.id === before.id), before);
  for (const before of middleRows.receipts) assert.deepEqual(finalRows.receipts.find(row => row.id === before.id), before);
  assert.deepEqual(finalRows.receipts.find(row => row.id === nextReceiptRow.id), nextReceiptRow);
});

for (const paused of [false, true]) it(`retries a member while its parent is ${paused ? "already paused" : "active in its child join"}`, async () => {
  const f = fixture;
  if (paused) assert.equal(f.canonical.kernel.execute(f.runCommand("pause", f.current())).state, "applied");
  const held = f.current().pause;
  if (paused) {
    const replacement = await replaceAndResume(f);
    assert.ok(held?.state === "paused");
    assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
    const first = f.children()[0]; assert.ok(first);
    assertAccounting(f, [first.envelope.runId, replacement.envelope.runId], 1);
    return;
  }
  const previous = failed(f), execute = f.canonical.childRuns.executeChildRuns.bind(f.canonical.childRuns);
  let reached = false;
  f.canonical.childRuns.executeChildRuns = async context => {
    const joined = await execute(context);
    if (context.leaves.some(leaf => leaf.node.id === "members")) {
      reached = true;
      assert.equal(f.current().lifecycle.state, "running");
      assert.equal(f.canonical.kernel.execute(f.runCommand("retry", previous)).state, "applied");
    }
    return joined;
  };
  await f.harness.manager.closeAll("parked");
  const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const owner = testWorkerLifetime(f.database, f.root.descriptor.id, 1);
  const lifecycle = workerRunLifecyclePort(f.canonical.lifecycle);
  const report = await runWorkerLoop({ ...f.harness.deps, workflowId: f.root.descriptor.id, workerId: owner.workerId, lifecycle,
    sessionFactory: f.harness.sessions.factory, sessionAcquireMs: 20_000,
    browserScreenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } },
    duoCeremony: duoCeremonyGatesOver(f.database, f.clock, f.harness.scheduler),
    heartbeatIntervalMs: 500, idleRepollMs: 1_000, stopSignal: signal(), exitWhenIdle: true,
    childRuns: f.canonical.childRuns, artifacts: f.artifacts,
    taskNotes: createNoteTimelineWriter({ repository: f.database.authority.timelineEvents, clock: f.clock }),
    resolveExecution: run => { const descriptor = f.resolve(run.envelope.workflow); return descriptor === undefined ? undefined : { descriptor, stores: f.stores }; },
    resourcesForRun: run => ({ sessionFactory: f.harness.sessions.factory, sessionAcquireMs: 20_000, taskDeadlineMs: 60_000,
      defaultBrowserMode: "headless", duoCeremony: duoCeremonyGatesOver(f.database, f.clock, f.harness.scheduler),
      providers: { configSnapshots: f.database.authority.configSnapshots, idFactory: { next: randomUUID }, adapters: {
      "ocr.approved-snapshot": createOcrApprovedSnapshotAdapter({ clock: f.clock,
        reader: createApprovedOcrRecordReader({ database: f.database, run, reader: f.canonical.lifecycle,
          resolveDescriptor: f.resolve, assertCurrent: () => f.admission.assertProfileRuntime() }) }) } } }),
    claimNext: request => f.canonical.lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow, workerId: request.workerId,
      workerLifetime: owner.workerLifetime, runtimeConfig: {
      generation: runtime.generation, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint,
      configFingerprint: runtime.configFingerprint } }),
    writeSequencerFor: sessions => createWriteSequencer({ lifecycle, stores: f.stores, authority: f.database, sessions,
      emitter: f.harness.deps.emitter, clock: f.clock, ids: { uuid: randomUUID }, scheduler: f.harness.scheduler,
      taskDeadlineMs: 60_000, operator: "local-operator", log: f.harness.deps.log }),
  });
  assert.equal(reached, true);
  assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["abandoned", "done"]);
  assert.equal(report.stopped, "idle"); assert.equal(report.closure, "proved");
  assert.equal(f.current().lifecycle.state, "queued");
  assert.equal(f.current().pause?.state, "paused");
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  assert.equal(report.outcomes[1]?.runId, replacement.envelope.runId);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

for (const existing of [false, true]) it(`recomputes accounting after Retry wins at publication with ${existing ? "old accounting in a continuation" : "no continuation"}`, async () => {
  const f = fixture;
  if (existing) {
    let paused = false;
    f.hooks.onSpan = event => {
      if (!paused && event.t === "span.ended" && event.kind === "task" && event.outcome === "done"
        && event.spanPath.includes("/read-result") && event.runId === f.parentRun.envelope.runId) {
        paused = true;
        assert.equal(f.canonical.kernel.execute(f.runCommand("pause", f.current())).state, "applied");
      }
    };
    assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "abandoned");
    assert.equal(paused, true);
    assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
    assert.ok(f.current().envelope.continuation?.checkpoints.some(row => row.nodeId === "read-result"));
    f.hooks.onSpan = undefined;
    assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
    await replaceAndResume(f);
  }
  const continuation = canonicalJsonStringify(f.current().envelope.continuation ?? null);
  const retrySource = failed(f);
  let oldGeneration = 0, replaced = false;
  f.hooks.onSpan = event => {
    if (!replaced && event.t === "span.ended" && event.kind === "task" && event.outcome === "done"
      && event.spanPath.includes("/read-result") && event.runId === f.parentRun.envelope.runId) {
      const checkpoint = f.database.authority.runCheckpoints.listByAttempt(f.current().envelope.workflow, f.current().envelope.itemId,
        "read-result", f.current().envelope.attempt).at(-1); assert.ok(checkpoint);
      oldGeneration = checkpoint.claimGeneration; replaced = true;
      assert.equal(f.canonical.kernel.execute(f.runCommand("retry", retrySource)).state, "applied");
    }
  };
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "abandoned");
  assert.equal(replaced, true);
  assert.equal(f.database.authority.runResults.get(f.parentRun.envelope.runId), undefined);
  const replacement = f.children().find(child => child.envelope.retryOf === retrySource.envelope.runId); assert.ok(replacement);
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  assert.equal(canonicalJsonStringify(f.current().envelope.continuation ?? null), continuation);
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  const successful = f.children()[0]; assert.ok(successful);
  assertAccounting(f, [successful.envelope.runId, replacement.envelope.runId], oldGeneration);
  assert.equal(canonicalJsonStringify(f.current().envelope.continuation ?? null), continuation);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

for (const unknown of [false, true]) it(`refuses another member Retry after a ${unknown ? "fenced UNKNOWN" : "committed Save followed by local failure"}`, async () => {
  const f = fixture;
  const original = failed(f);
  assert.equal(aggregateMemberRetryAvailable(f.database.authority, f.canonical.lifecycle, original, f.resolve), true);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", original)).state, "applied");
  f.control.unknownAfterSave = unknown;
  f.control.failAfterSave = !unknown;
  const executed = await f.canonical.step(f.parentRun, signal());
  assert.equal(executed.outcome.state, unknown ? "parked-write" : "failed");
  const target = f.current(executed.run.envelope.runId), before = canonicalJsonStringify(f.children());
  const intents = f.database.authority.writeIntents.listByRun(target.envelope.runId); assert.equal(intents.length, 1);
  assert.equal(intents[0]?.status, unknown ? "parked" : "committed");
  assert.equal(aggregateMemberRetryAvailable(f.database.authority, f.canonical.lifecycle, target, f.resolve), false);
  const refusal = f.canonical.kernel.execute(f.runCommand("retry", target));
  assert.equal(refusal.state, "rejected");
  assert.equal(canonicalJsonStringify(f.children()), before);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(target.envelope.runId), intents);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
  if (!unknown) {
    const checkpoint = f.database.authority.runCheckpoints.listByItem(target.envelope.workflow, target.envelope.itemId)
      .find(row => row.runId === target.envelope.runId && row.nodeId === "contact-preview"); assert.ok(checkpoint);
    const missingIntent = { ...f.database.authority, writeIntents: { ...f.database.authority.writeIntents,
      listByRun: () => [], listByBusinessKey: () => [] } };
    assert.throws(() => assertDelegationRetryUnwritten(missingIntent, target, contactSaveMember.descriptor), /delegation-accounting-write-checkpoint-present/);
  }
  const rows = readQueueRecordMembers(f.database.authority, f.canonical.lifecycle, f.current(),
    f.database.authority.runs.listChildren(f.parentRun.envelope.runId), f.resolve); assert.ok(rows);
  assert.equal(rows.members[0]?.statusLabel, "Saved");
});
