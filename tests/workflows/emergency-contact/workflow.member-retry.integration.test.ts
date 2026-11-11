import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeEach, it } from "vitest";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { aggregateMemberRetryAvailable } from "../../../src/backend/runs/queries/run-retry.js";
import { assertDelegationRetryUnwritten, delegationAccountingExecution } from "../../../src/backend/storage/sqlite/delegation-authority.js";
import { runClaim } from "../../../src/models/run/record.js";
import { DiagnosticBundleSchema } from "../../../src/models/trust/diagnostic.js";
import { CanonicalTerminalizeRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { EmergencyContactResultSchema, EmergencyContactMemberResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";
import { EmergencyContactMemberInputSchema } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { delegationEvidenceOutput, deriveRunResultDigest, deriveTerminalDependencyDigest, RunTerminalEvidenceResultSchema } from "../../../src/models/run/result.js";
import { contactSaveMember, createEmergencyContactRetryWorld } from "../../support/helpers/backend/emergency-contact-retry-world.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting } from "../../../src/workflow-kit/workflow.js";
import { runWorkerLoop } from "../../../src/backend/runtime/workers/worker-loop.js";
import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import { workerRunLifecyclePort } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createOcrApprovedSnapshotAdapter } from "../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { duoCeremonyGatesOver } from "../../support/helpers/duo-ceremony-fixtures.js";
import { testAdmittedWorker, testWorkerLifetime } from "../../support/fixtures/run-lifecycle-fixtures.js";

const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
afterAll(world.releaseTemplates);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
let fixture: Fixture;
beforeEach(async context => {
  const failedBeforeCheckpoint = context.task.name === "retries a member whose first approved-record read failed before a checkpoint";
  fixture = await world.fixture({ failApprovedRecordOnce: failedBeforeCheckpoint, failures: failedBeforeCheckpoint ? 0
    : context.task.name.startsWith("retries a settled") || context.task.name.endsWith("old accounting in a continuation")
      || context.task.name.endsWith("at typed refusal failure admission") ? 2 : 1 });
});
const signal = () => new AbortController().signal;

function failed(f: Fixture) {
  const run = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"
    && !f.children().some(replacement => replacement.envelope.retryOf === child.envelope.runId));
  assert.ok(run); return run;
}

function originalBytes(f: Fixture, runId = f.parentRun.envelope.runId) {
  const database = new DatabaseSync(f.path, { readOnly: true });
  try {
    return { results: database.prepare("SELECT id,payload_json,terminal_run_json FROM run_results WHERE run_id=? ORDER BY settlement_version").all(runId),
      receipts: database.prepare("SELECT id,settlement_version,payload_json FROM run_receipts WHERE run_id=? ORDER BY id").all(runId) };
  } finally { database.close(); }
}

function assertHistoricalRows(f: Fixture, before: ReturnType<typeof originalBytes>, runId = f.parentRun.envelope.runId) {
  const after = originalBytes(f, runId);
  for (const row of before.results) assert.deepEqual(after.results.find(current => current.id === row.id), row);
  for (const row of before.receipts) assert.deepEqual(after.receipts.find(current => current.id === row.id), row);
}

function delegationAuthorityIds(f: Fixture) {
  return f.database.authority.dependencies.groups(f.parentRun.envelope.runId).map(({ manifest, group }) => ({
    manifestId: manifest.manifestId, invocationCommandId: group.invocation.commandId,
    members: group.children.map(member => ({ dependencyId: member.dependency.dependencyId, originalRunId: member.original.envelope.runId })) }));
}

function trust(f: Fixture) {
  return createReceiptService({ database: f.database, runReader: f.canonical.lifecycle,
    descriptors: [f.root.descriptor] });
}

function ocrBytes(f: Fixture) {
  const runs = [f.run, ...f.database.authority.runs.listChildren(f.run.envelope.runId)];
  return runs.map(run => canonicalJsonStringify(f.database.authority.runs.get(run.envelope.runId)));
}

async function replaceAndResume(f: Fixture, resumeDelayMs = 0) {
  const ocrBefore = ocrBytes(f), readsBefore = f.pageReads.length;
  const replacement = await replaceAndResumeMember(f, resumeDelayMs);
  assert.equal(f.pageReads.length, readsBefore);
  assert.deepEqual(ocrBytes(f), ocrBefore);
  return replacement;
}

async function replaceAndResumeMember(f: Fixture, resumeDelayMs: number) {
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
  f.clock.advanceWall(resumeDelayMs);
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
  const originalChildren = f.children().map(child => child.envelope.runId);
  const memberAuthority = () => f.database.authority.dependencies.groups(original.envelope.runId)
    .map(({ manifest, group }) => ({ manifestId: manifest.manifestId, invocationCommandId: group.invocation.commandId,
      members: group.children.map(member => ({ dependencyId: member.dependency.dependencyId, originalRunId: member.original.envelope.runId })) }));
  const originalAuthority = memberAuthority();
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
  const snapshotReads = f.control.snapshotReads;
  const first = await replaceAndResume(f, 1_000); readOld();
  assert.equal(f.current().envelope.continuation, undefined);
  let heartbeats = 0;
  f.hooks.onSpan = event => {
    if (event.t !== "span.started" || event.kind !== "task" || !event.spanPath.includes("/read-result")
      || event.runId !== f.parentRun.envelope.runId) return;
    const before = runClaim(f.current()); assert.ok(before);
    f.clock.advanceWall(1_000);
    assert.equal(f.canonical.lifecycle.renewClaim({ commandId: randomUUID(), runId: f.parentRun.envelope.runId,
      claim: { workerId: before.workerId, claimGeneration: before.claimGeneration } }).state, "applied");
    const after = runClaim(f.current()); assert.ok(after);
    assert.equal(after.workerId, before.workerId);
    assert.equal(after.claimGeneration, before.claimGeneration);
    assert.notEqual(after.heartbeatAt, before.heartbeatAt);
    assert.equal(after.heartbeatAt, f.clock.now().toISOString());
    heartbeats += 1;
  };
  const refreshed = await f.canonical.step(f.parentRun, signal());
  assert.equal(refreshed.outcome.state, "done", refreshed.outcome.state === "failed"
    ? JSON.stringify(f.database.authority.failures.get(refreshed.outcome.failureId)) : JSON.stringify(refreshed.outcome));
  assert.equal(heartbeats, 1);
  assert.equal(f.control.snapshotReads, snapshotReads + 1);
  assert.deepEqual(memberAuthority(), originalAuthority);
  assert.deepEqual(f.children().map(child => child.envelope.runId).sort(), [...originalChildren, first.envelope.runId].sort());
  const firstAccounting = assertAccounting(f, [successful.envelope.runId, first.envelope.runId], original.claimGeneration);
  assert.deepEqual(EmergencyContactResultSchema.parse(firstAccounting.result.result.value).members.map(member => member.state), ["done", "failed"]);
  assert.equal(f.database.authority.evidenceReceipts.findByRun(original.envelope.runId), undefined);
  readOld();
  const middle = f.current(); assert.ok(middle.completion);
  const middleVersion = middle.completion.expectedVersion + 1;
  const middleRows = originalBytes(f);
  const second = await replaceAndResume(f, 1_000); readOld();
  const nextReceipt = f.database.authority.evidenceReceipts.listByRun(original.envelope.runId).find(row => row.receiptId !== receipt.receiptId); assert.ok(nextReceipt);
  const nextReceiptRow = originalBytes(f).receipts.find(row => row.id === nextReceipt.receiptId); assert.ok(nextReceiptRow);
  assert.equal(nextReceiptRow.settlement_version, middleVersion);
  assert.deepEqual(f.database.authority.runResults.getSettlement(original.envelope.runId, middleVersion)?.result, firstAccounting.result);
  const refreshedAgain = await f.canonical.step(f.parentRun, signal());
  assert.equal(refreshedAgain.outcome.state, "done", refreshedAgain.outcome.state === "failed"
    ? JSON.stringify(f.database.authority.failures.get(refreshedAgain.outcome.failureId)) : JSON.stringify(refreshedAgain.outcome));
  assert.equal(heartbeats, 2);
  assert.equal(f.control.snapshotReads, snapshotReads + 2);
  assert.deepEqual(memberAuthority(), originalAuthority);
  assert.deepEqual(f.children().map(child => child.envelope.runId).sort(), [...originalChildren, first.envelope.runId, second.envelope.runId].sort());
  const secondAccounting = assertAccounting(f, [successful.envelope.runId, second.envelope.runId], firstAccounting.accounting.claimGeneration);
  assert.notEqual(secondAccounting.result.resultDigest, firstAccounting.result.resultDigest);
  const secondMember = f.current(second.envelope.runId);
  assert.deepEqual(EmergencyContactResultSchema.parse(secondAccounting.result.result.value).members.map(member => member.state), ["done", "done"],
    secondMember.lifecycle.state === "terminal" && secondMember.lifecycle.outcome === "failed" && secondMember.lifecycle.failureId !== undefined
      ? JSON.stringify(f.database.authority.failures.get(secondMember.lifecycle.failureId)) : JSON.stringify(secondMember.lifecycle));
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

it("refuses a changed fresh approved snapshot before adopting a Retry accounting prerequisite", async () => {
  const f = fixture;
  await f.canonical.execute(f.parentRun, signal());
  trust(f).ensureReceipt(f.parentRun.envelope.runId);
  await replaceAndResume(f, 1_000);
  const before = originalBytes(f);
  const checkpoints = f.database.authority.runCheckpoints.listByItem(f.current().envelope.workflow, f.current().envelope.itemId);
  const members = canonicalJsonStringify(f.children());
  const dependencyState = () => f.database.authority.dependencies.groups(f.parentRun.envelope.runId)
    .map(({ manifest, group }) => ({ manifest, invocation: group.invocation, children: group.children }));
  const groups = canonicalJsonStringify(dependencyState());
  const snapshotReads = f.control.snapshotReads;
  f.control.changeApprovedSnapshot = true;
  const refreshed = await f.canonical.step(f.parentRun, signal());
  assert.equal(refreshed.outcome.state, "failed");
  assert.ok(refreshed.outcome.state === "failed");
  const failure = f.database.authority.failures.get(refreshed.outcome.failureId); assert.ok(failure);
  assert.equal(failure.code, "RUN_CONTINUATION_REFUSED");
  assert.ok(failure.summary.includes("delegation-accounting-upstream-checkpoint-changed"), failure.summary);
  assert.equal(f.control.snapshotReads, snapshotReads + 1);
  const refusedResult = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(refusedResult);
  const terminal = RunTerminalEvidenceResultSchema.parse(refusedResult.result.value);
  assert.ok(terminal.kind === "failed-evidence");
  assert.equal(terminal.authorization.failureId, failure.failureId);
  assert.equal(EmergencyContactResultSchema.safeParse(refusedResult.result.value).success, false);
  const after = originalBytes(f);
  assert.equal(after.results.length, before.results.length + 1);
  for (const original of before.results) assert.deepEqual(after.results.find(row => row.id === original.id), original);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(f.database.authority.runCheckpoints.listByItem(f.current().envelope.workflow, f.current().envelope.itemId), checkpoints);
  assert.equal(canonicalJsonStringify(f.children()), members);
  assert.equal(canonicalJsonStringify(dependencyState()), groups);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

it("refuses a changed fresh approved record before adopting an unwritten member Retry prerequisite", async () => {
  const f = fixture;
  await f.canonical.execute(f.parentRun, signal());
  trust(f).ensureReceipt(f.parentRun.envelope.runId);
  const previous = failed(f), originalChildren = f.children().map(child => child.envelope.runId);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", previous)).state, "applied");
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  const rows = originalBytes(f), previousRows = originalBytes(f, previous.envelope.runId);
  const checkpoints = f.database.authority.runCheckpoints.listByItem(previous.envelope.workflow, previous.envelope.itemId);
  const authorityIds = () => f.database.authority.dependencies.groups(f.parentRun.envelope.runId).map(({ manifest, group }) => ({
    manifestId: manifest.manifestId, invocationCommandId: group.invocation.commandId,
    members: group.children.map(member => ({ dependencyId: member.dependency.dependencyId,
      originalRunId: member.original.envelope.runId, currentRunId: member.child.envelope.runId })) }));
  const originalAuthority = authorityIds(), envelope = canonicalJsonStringify(f.current().envelope), recordReads = f.control.recordReads;
  f.clock.advanceWall(1_000);
  f.control.changeApprovedRecord = true;
  const refreshed = await f.canonical.step(f.parentRun, signal());
  assert.equal(refreshed.run.envelope.runId, replacement.envelope.runId);
  assert.ok(refreshed.outcome.state === "failed");
  const failure = f.database.authority.failures.get(refreshed.outcome.failureId); assert.ok(failure);
  assert.equal(failure.code, "RUN_CONTINUATION_REFUSED");
  assert.ok(failure.summary.includes("delegation-accounting-upstream-checkpoint-changed"), failure.summary);
  assert.equal(f.control.recordReads, recordReads + 1);
  const result = f.database.authority.runResults.get(replacement.envelope.runId); assert.ok(result);
  const terminal = RunTerminalEvidenceResultSchema.parse(result.result.value); assert.ok(terminal.kind === "failed-evidence");
  assert.equal(terminal.authorization.failureId, failure.failureId);
  assert.deepEqual(originalBytes(f), rows);
  assert.deepEqual(originalBytes(f, previous.envelope.runId), previousRows);
  assert.deepEqual(f.database.authority.runCheckpoints.listByItem(previous.envelope.workflow, previous.envelope.itemId), checkpoints);
  assert.deepEqual(authorityIds(), originalAuthority);
  assert.deepEqual(f.children().map(child => child.envelope.runId).sort(), [...originalChildren, replacement.envelope.runId].sort());
  assert.equal(canonicalJsonStringify(f.current().envelope), envelope);
  assert.equal(f.current().pause?.state, "paused");
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 0]);
});

it("retries a member whose first approved-record read failed before a checkpoint", async () => {
  const f = fixture;
  await f.canonical.execute(f.parentRun, signal());
  const original = f.current(); assert.ok(original.completion);
  trust(f).ensureReceipt(original.envelope.runId);
  const rows = originalBytes(f), previous = failed(f), authority = delegationAuthorityIds(f);
  const successful = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"); assert.ok(successful);
  const successfulBytes = canonicalJsonStringify(successful), successfulRows = originalBytes(f, successful.envelope.runId);
  const originalChildren = f.children().map(child => child.envelope.runId);
  assert.equal(f.database.authority.runCheckpoints.listByItem(previous.envelope.workflow, previous.envelope.itemId)
    .some(row => row.runId === previous.envelope.runId && row.nodeId === "approved-record"), false);
  const retry = f.runCommand("retry", previous);
  assert.equal(f.canonical.kernel.execute(retry).state, "applied");
  assert.equal(f.canonical.kernel.execute(retry).state, "already-applied");
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  assert.ok(replacement.envelope.continuation);
  assert.equal(replacement.envelope.continuation.checkpoints.some(row => row.nodeId === "approved-record"), false);
  const previousRows = originalBytes(f, previous.envelope.runId), reads = f.control.recordReads;
  f.clock.advanceWall(1_000);
  const completed = await f.canonical.step(f.parentRun, signal());
  assert.equal(completed.run.envelope.runId, replacement.envelope.runId);
  assert.equal(completed.outcome.state, "done", completed.outcome.state === "failed"
    ? JSON.stringify(f.database.authority.failures.get(completed.outcome.failureId)) : JSON.stringify(completed.outcome));
  assert.equal(f.control.recordReads, reads + 1);
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  assertAccounting(f, [successful.envelope.runId, replacement.envelope.runId], original.claimGeneration);
  assert.deepEqual(f.current().envelope, original.envelope);
  assert.deepEqual(delegationAuthorityIds(f), authority);
  assert.deepEqual(f.children().map(child => child.envelope.runId).sort(), [...originalChildren, replacement.envelope.runId].sort());
  assert.equal(canonicalJsonStringify(f.current(successful.envelope.runId)), successfulBytes);
  assertHistoricalRows(f, rows); assertHistoricalRows(f, previousRows, previous.envelope.runId);
  assertHistoricalRows(f, successfulRows, successful.envelope.runId);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

it("resumes the same saved member Retry after a pause without another Save", async () => {
  const f = fixture;
  await f.canonical.execute(f.parentRun, signal());
  const original = f.current(); assert.ok(original.completion);
  trust(f).ensureReceipt(original.envelope.runId);
  const rows = originalBytes(f), previous = failed(f), authority = delegationAuthorityIds(f);
  const successful = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"); assert.ok(successful);
  const successfulBytes = canonicalJsonStringify(successful), successfulRows = originalBytes(f, successful.envelope.runId);
  const originalChildren = f.children().map(child => child.envelope.runId);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", previous)).state, "applied");
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  const previousRows = originalBytes(f, previous.envelope.runId);
  let pausedAfterSave = false;
  f.hooks.onTransactionSettled = () => {
    assert.equal(f.database.authority.writeIntents.listByRun(replacement.envelope.runId)[0]?.status, "committed");
    pausedAfterSave = true;
    assert.equal(f.canonical.kernel.execute(f.runCommand("pause", f.current(replacement.envelope.runId))).state, "applied");
  };
  const parked = await f.canonical.step(f.parentRun, signal());
  assert.equal(parked.run.envelope.runId, replacement.envelope.runId);
  assert.equal(parked.outcome.state, "abandoned"); assert.equal(pausedAfterSave, true);
  const held = f.current(replacement.envelope.runId);
  assert.equal(held.lifecycle.state, "queued"); assert.equal(held.pause?.state, "paused"); assert.equal(runClaim(held), undefined);
  const checkpoints = f.database.authority.runCheckpoints.listByItem(held.envelope.workflow, held.envelope.itemId);
  assert.equal(checkpoints.filter(row => row.runId === held.envelope.runId && row.nodeId === "approved-record").length, 1);
  assert.equal(checkpoints.filter(row => row.runId === held.envelope.runId && row.nodeId === "contact-preview").length, 1);
  const intents = f.database.authority.writeIntents.listByRun(held.envelope.runId);
  assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "committed");
  f.hooks.onTransactionSettled = undefined;
  f.clock.advanceWall(1_000);
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", held)).state, "applied");
  const continuation = f.current(held.envelope.runId).envelope.continuation; assert.ok(continuation);
  assert.ok(continuation.checkpoints.some(row => row.runId === held.envelope.runId && row.nodeId === "approved-record"));
  assert.ok(continuation.checkpoints.some(row => row.runId === held.envelope.runId && row.nodeId === "contact-preview"));
  const completed = await f.canonical.step(f.parentRun, signal());
  assert.equal(completed.run.envelope.runId, held.envelope.runId);
  assert.equal(completed.outcome.state, "done", completed.outcome.state === "failed"
    ? JSON.stringify(f.database.authority.failures.get(completed.outcome.failureId)) : JSON.stringify(completed.outcome));
  assert.deepEqual(f.database.authority.runCheckpoints.listByItem(held.envelope.workflow, held.envelope.itemId), checkpoints);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(held.envelope.runId), intents);
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  assertAccounting(f, [successful.envelope.runId, replacement.envelope.runId], original.claimGeneration);
  assert.deepEqual(f.current().envelope, original.envelope);
  assert.deepEqual(delegationAuthorityIds(f), authority);
  assert.deepEqual(f.children().map(child => child.envelope.runId).sort(), [...originalChildren, replacement.envelope.runId].sort());
  assert.equal(canonicalJsonStringify(f.current(successful.envelope.runId)), successfulBytes);
  assertHistoricalRows(f, rows); assertHistoricalRows(f, previousRows, previous.envelope.runId);
  assertHistoricalRows(f, successfulRows, successful.envelope.runId);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

it("resumes a member Retry paused before its Save by reading its stale contacts again", async () => {
  const f = fixture;
  await f.canonical.execute(f.parentRun, signal());
  const previous = failed(f);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", previous)).state, "applied");
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  const approvedRows = () => f.database.authority.runCheckpoints.listByItem(replacement.envelope.workflow, replacement.envelope.itemId)
    .filter(row => row.runId === replacement.envelope.runId && row.nodeId === "approved-record");
  let paused = false;
  f.hooks.onSpan = event => {
    if (paused || event.t !== "span.started" || event.kind !== "task" || !event.spanPath.includes("/read-contacts")
      || event.runId !== replacement.envelope.runId) return;
    paused = true;
    assert.equal(f.canonical.kernel.execute(f.runCommand("pause", f.current(replacement.envelope.runId))).state, "applied");
  };
  const parked = await f.canonical.step(f.parentRun, signal());
  assert.equal(parked.run.envelope.runId, replacement.envelope.runId);
  assert.equal(parked.outcome.state, "abandoned"); assert.equal(paused, true);
  const held = f.current(replacement.envelope.runId);
  assert.equal(held.pause?.state, "paused");
  assert.equal(approvedRows().length, 1);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(held.envelope.runId), []);
  f.clock.advanceWall(1_000);
  const resumedAt = f.clock.now().getTime();
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", held)).state, "applied");
  assert.ok(f.current(held.envelope.runId).envelope.continuation);
  f.hooks.onSpan = () => f.clock.advanceWall(1);
  const completed = await f.canonical.step(f.parentRun, signal());
  assert.equal(completed.run.envelope.runId, held.envelope.runId);
  assert.equal(completed.outcome.state, "done", completed.outcome.state === "failed"
    ? JSON.stringify(f.database.authority.failures.get(completed.outcome.failureId)) : JSON.stringify(completed.outcome));
  f.hooks.onSpan = undefined;
  const rows = approvedRows(); assert.equal(rows.length, 2);
  assert.ok(Date.parse(rows[1]?.provenance[0]?.observedAt ?? "") >= resumedAt);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(held.envelope.runId).map(intent => intent.status), ["committed"]);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

for (const ownership of ["missing captured claim", "missing current claim", "replaced generation", "replaced worker"] as const)
it(`refuses accounting with a ${ownership} after manual Resume`, async () => {
  const f = fixture;
  await f.canonical.execute(f.parentRun, signal());
  trust(f).ensureReceipt(f.parentRun.envelope.runId);
  await replaceAndResume(f);
  const before = originalBytes(f);
  const checkpoints = f.database.authority.runCheckpoints.listByItem(f.current().envelope.workflow, f.current().envelope.itemId);
  const capture = () => f.database.withAuthorityTransaction(repositories =>
    delegationAccountingExecution(repositories, f.root.descriptor, f.current()));
  if (ownership === "missing captured claim") {
    assert.equal(runClaim(f.current()), undefined);
    assert.throws(capture, /delegation-accounting-owner-changed/);
  } else {
    const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
    const claim = (owner: ReturnType<typeof testWorkerLifetime>) => {
      const result = f.canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.root.descriptor.id,
        workerId: owner.workerId, runtimeConfig: {
          generation: runtime.generation, settingsRevision: runtime.settingsRevision,
          settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
      assert.equal(result.state, "applied");
      assert.ok("run" in result);
      assert.equal(result.run.envelope.runId, f.parentRun.envelope.runId);
      return runClaim(result.run);
    };
    const owner = testWorkerLifetime(f.database, f.root.descriptor.id, 1);
    const original = claim(owner); assert.ok(original);
    const accounting = capture(); assert.ok(accounting);
    accounting.assertCurrent();
    assert.equal(f.canonical.lifecycle.requeue({ commandId: randomUUID(), runId: f.parentRun.envelope.runId,
      expectedVersion: f.current().version, claim: { workerId: original.workerId, claimGeneration: original.claimGeneration },
      cause: "reassign" }).state, "applied");
    assert.equal(runClaim(f.current()), undefined);
    if (ownership !== "missing current claim") {
      const replacement = claim(ownership === "replaced worker" ? testAdmittedWorker(f.database, f.clock, {
        path: f.path, workflow: f.root.descriptor.id, poolIndex: 2, browserSystems: ["ucpath"] }) : owner);
      assert.ok(replacement);
      assert.ok(replacement.claimGeneration > original.claimGeneration);
      assert.equal(replacement.workerId === original.workerId, ownership === "replaced generation");
    }
    assert.throws(() => accounting.assertCurrent(), /delegation-accounting-owner-changed/);
  }
  assert.equal(f.database.authority.runResults.get(f.parentRun.envelope.runId), undefined);
  assert.deepEqual(originalBytes(f), before);
  assert.deepEqual(f.database.authority.runCheckpoints.listByItem(f.current().envelope.workflow, f.current().envelope.itemId), checkpoints);
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
});

for (const boundary of ["active in its child join", "already paused", "at first native success admission", "at first native failure admission", "at failure diagnostic capture", "at failure diagnostic capture after Pause", "at failure settlement after Pause", "at accounting capture", "at typed refusal failure admission"] as const)
it(`retries a member while its parent is ${boundary}`, async () => {
  const f = fixture;
  const paused = boundary === "already paused";
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
  const typedRefusal = boundary === "at typed refusal failure admission";
  if (typedRefusal) {
    await f.canonical.execute(f.parentRun, signal());
    await replaceAndResume(f);
    f.control.changeApprovedSnapshot = true;
  }
  const originalChildren = f.children().map(child => ({ runId: child.envelope.runId, bytes: canonicalJsonStringify(child) }));
  const originalEnvelope = canonicalJsonStringify(f.current().envelope), originalRows = originalBytes(f);
  const firstFailureAdmission = boundary === "at first native failure admission", failureAdmission = firstFailureAdmission || typedRefusal;
  const pauseFirst = boundary.endsWith("after Pause"), settlementRetry = boundary === "at failure settlement after Pause";
  const diagnosticCapture = pauseFirst || boundary === "at failure diagnostic capture";
  if (firstFailureAdmission || diagnosticCapture) f.control.failAccounting = true;
  const previous = failed(f), execute = f.canonical.childRuns.executeChildRuns.bind(f.canonical.childRuns);
  const retry = f.runCommand("retry", previous);
  let reached = false;
  if (boundary === "active in its child join") f.canonical.childRuns.executeChildRuns = async context => {
    const joined = await execute(context);
    if (context.leaves.some(leaf => leaf.node.id === "members")) {
      reached = true;
      assert.equal(f.current().lifecycle.state, "running");
      assert.equal(f.canonical.kernel.execute(retry).state, "applied");
    }
    return joined;
  };
  let discarded = 0, captured = false, settling = false;
  const retryHeldParent = () => {
    reached = true;
    const claim = runClaim(f.current()); assert.ok(claim);
    const writes = [...f.persistence.values()].map(value => value.submissions.length);
    const operatorPause = f.current().pause;
    assert.equal(f.canonical.kernel.execute(retry).state, "applied");
    assert.deepEqual(runClaim(f.current()), claim);
    assert.equal(f.current().pause?.state, "requested");
    if (pauseFirst) assert.deepEqual(f.current().pause, operatorPause);
    assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), writes);
  };
  const diagnostics = !diagnosticCapture ? undefined : {
    captureForFailure: async (context: { failure: { failureId: string }; configFingerprint: string; descriptorFingerprint: string }) => {
      assert.equal(captured, false);
      captured = true;
      const original = f.current(); assert.ok(runClaim(original));
      assert.equal(original.lifecycle.state, "running");
      assert.equal(original.pause, undefined);
      if (pauseFirst) {
        assert.equal(f.canonical.kernel.execute(f.runCommand("pause", original)).state, "applied");
        assert.equal(f.current().pause?.state, "requested");
      }
      if (!settlementRetry) retryHeldParent();
      settling = true;
      return DiagnosticBundleSchema.parse({ bundleId: randomUUID(), runId: original.envelope.runId,
        origin: { kind: "failure", failureId: context.failure.failureId }, createdAt: f.clock.now().toISOString(),
        contentDigest: "a".repeat(64), configFingerprint: context.configFingerprint, descriptorFingerprint: context.descriptorFingerprint,
        redaction: { fields: [], warnings: [] }, attachments: [], retention: { kind: "pinned", reason: "write-recovery" } });
    },
    persist: () => { throw new Error("a held parent must never persist its prepared failure bundle"); },
    discard: () => { discarded += 1; },
  };
  await f.harness.manager.closeAll("parked");
  const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const owner = testWorkerLifetime(f.database, f.root.descriptor.id, 1);
  const nativeLifecycle = workerRunLifecyclePort(f.canonical.lifecycle);
  const lifecycle: typeof nativeLifecycle = { ...nativeLifecycle, terminalize: (...args) => {
    const request = CanonicalTerminalizeRequestSchema.parse(args[0]);
    const admission = boundary === "at first native success admission" ? "success" : failureAdmission ? "failure" : undefined;
    if (admission === undefined || reached || (request.kind !== "success" && request.kind !== "failure") || request.kind !== admission
      || request.terminal.authorization.runId !== f.parentRun.envelope.runId) return nativeLifecycle.terminalize(...args);
    reached = true;
    const original = f.current(), claim = runClaim(original); assert.ok(claim);
    assert.equal(original.lifecycle.state, "running");
    assert.equal(original.envelope.continuation, undefined);
    if (typedRefusal) {
      assert.equal(original.delegationRefresh?.phase, "settled");
      assert.ok(request.kind === "failure");
      assert.equal(request.terminal.failure.code, "RUN_CONTINUATION_REFUSED");
      assert.ok(request.terminal.failure.summary.includes("delegation-accounting-upstream-checkpoint-changed"));
    } else {
      assert.equal(original.delegationRefresh, undefined);
      assert.equal(f.children().some(child => child.envelope.retryOf !== undefined), false);
    }
    const accounting = f.database.authority.runCheckpoints.listByAttempt(original.envelope.workflow, original.envelope.itemId,
      "read-result", original.envelope.attempt).at(-1);
    if (firstFailureAdmission) assert.equal(accounting, undefined);
    else if (typedRefusal) assert.ok(accounting === undefined || accounting.claimGeneration < original.claimGeneration);
    else { assert.ok(accounting); assert.equal(accounting.claimGeneration, original.claimGeneration); }
    assert.equal(request.terminal.authorization.expectedVersion, original.version);
    const writes = [...f.persistence.values()].map(value => value.submissions.length);
    assert.equal(f.canonical.kernel.execute(retry).state, "applied");
    assert.deepEqual(runClaim(f.current()), claim);
    assert.equal(f.current().pause?.state, "requested");
    assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), writes);
    const refused = nativeLifecycle.terminalize(...args);
    assert.ok(refused.state === "refused" && refused.refusal.reason === "lost");
    assert.equal(f.database.authority.runResults.get(original.envelope.runId), undefined);
    if (request.kind === "failure") {
      assert.equal(f.database.authority.failures.get(request.terminal.failure.failureId), undefined);
      assert.equal(f.database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
    }
    return refused;
  }, acknowledgePause: (...args) => {
    if (settlementRetry && reached && holdAcknowledged === undefined) holdAcknowledged = { transactionDepth, outerTransaction: outerTransactions };
    return nativeLifecycle.acknowledgePause(...args);
  } };
  const transaction = f.database.withAuthorityTransaction.bind(f.database);
  let transactionDepth = 0, outerTransactions = 0;
  let holdAcknowledged: { transactionDepth: number; outerTransaction: number } | undefined;
  if (boundary === "at accounting capture" || settlementRetry) f.database.withAuthorityTransaction = work => {
    if (settlementRetry && settling && transactionDepth === 0) {
      // The injected Retry's own kernel transactions are not executor transactions.
      if (!reached) { retryHeldParent(); outerTransactions = 0; }
      outerTransactions += 1;
    }
    if (!settlementRetry && !reached && transactionDepth === 0 && f.current().lifecycle.state === "validating") {
      reached = true;
      const claim = runClaim(f.current()); assert.ok(claim);
      assert.equal(f.current().pause, undefined);
      assert.equal(f.children().some(child => child.envelope.retryOf !== undefined), false);
      assert.equal(f.canonical.kernel.execute(retry).state, "applied");
      assert.deepEqual(runClaim(f.current()), claim);
      assert.equal(f.current().pause?.state, "requested");
    }
    transactionDepth += 1;
    try { return transaction(work); } finally { transactionDepth -= 1; }
  };
  const claimed: string[] = [];
  const debugEvents = createDebugEventWriter({ repository: f.database.authority.timelineEvents, clock: f.clock, build: "test" });
  const debugAfter = f.database.authority.timelineEvents.highWaterMark();
  let report: Awaited<ReturnType<typeof runWorkerLoop>>;
  try {
    report = await runWorkerLoop({ ...f.harness.deps, debugEvents, ...(diagnostics === undefined ? {} : { diagnostics }), workflowId: f.root.descriptor.id, workerId: owner.workerId, lifecycle,
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
        reader: f.approvedReader({ database: f.database, run, reader: f.canonical.lifecycle,
          resolveDescriptor: f.resolve, assertCurrent: () => f.admission.assertProfileRuntime() }) }) } } }),
    claimNext: request => {
      if (reached) {
        assert.equal(f.current().lifecycle.state, "queued");
        assert.equal(f.current().pause?.state, "paused");
        assert.equal(runClaim(f.current()), undefined);
        assert.equal(f.database.authority.runResults.get(f.parentRun.envelope.runId), undefined);
      }
      const result = f.canonical.lifecycle.claimNext({ commandId: request.commandId, workflow: request.workflow, workerId: request.workerId,
      runtimeConfig: {
      generation: runtime.generation, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint,
      configFingerprint: runtime.configFingerprint } });
      if ((result.state === "applied" || result.state === "applied-already") && "run" in result) claimed.push(result.run.envelope.runId);
      return result;
    },
    writeSequencerFor: sessions => createWriteSequencer({ lifecycle, stores: f.stores, authority: f.database, sessions,
      emitter: f.harness.deps.emitter, clock: f.clock, ids: { uuid: randomUUID }, scheduler: f.harness.scheduler,
      taskDeadlineMs: 60_000, operator: "local-operator", log: f.harness.deps.log }),
  });
  } finally { f.database.withAuthorityTransaction = transaction; }
  assert.equal(reached, true);
  assert.equal(discarded, diagnosticCapture ? 1 : 0);
  // The hold check and its acknowledgment must share the first outer transaction after capture: no Retry or Pause can commit between them.
  if (settlementRetry) assert.deepEqual(holdAcknowledged, { transactionDepth: 1, outerTransaction: 1 });
  if (diagnosticCapture) assert.deepEqual(f.database.authority.failures.listByRun(f.parentRun.envelope.runId), []);
  assert.deepEqual(report.outcomes.map(outcome => outcome.state), ["abandoned", "done"]);
  assert.deepEqual(f.database.authority.timelineEvents.page({ after: debugAfter, limit: 1000 }).filter(record => record.payload.kind === "debug"
    && record.payload.event.reason === "run-failed"), [], "a held or lost failure settlement records no failure event");
  assert.equal(report.stopped, "idle"); assert.equal(report.closure, "proved");
  assert.equal(f.current().lifecycle.state, "queued");
  assert.equal(f.current().pause?.state, "paused");
  assert.equal(runClaim(f.current()), undefined);
  assert.equal(f.database.authority.runResults.get(f.parentRun.envelope.runId), undefined);
  const replacement = f.children().find(child => child.envelope.retryOf === previous.envelope.runId); assert.ok(replacement);
  assert.deepEqual(claimed, [f.parentRun.envelope.runId, replacement.envelope.runId]);
  assert.equal(report.outcomes[1]?.runId, replacement.envelope.runId);
  assert.equal(canonicalJsonStringify(f.current().envelope), originalEnvelope);
  assert.deepEqual(originalBytes(f), originalRows);
  for (const child of originalChildren) assert.equal(canonicalJsonStringify(f.current(child.runId)), child.bytes);
  assert.deepEqual(f.children().map(child => child.envelope.runId).sort(), [...originalChildren.map(child => child.runId), replacement.envelope.runId].sort());
  assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1, 1]);
  assert.equal(f.database.authority.commandAudits.findByCommand(retry.commandId)?.result.state, "applied");
  assert.equal(f.canonical.kernel.execute(retry).state, "already-applied");
  assert.equal(f.children().filter(child => child.envelope.retryOf === previous.envelope.runId).length, 1);
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
