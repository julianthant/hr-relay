import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeEach, it, vi } from "vitest";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { readRunCheckpoint, RunContinuationRefusedError } from "../../../src/backend/storage/sqlite/run-continuation.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { UcpathSaveEmergencyContact } from "../../../src/models/systems/ucpath/save-emergency-contact.js";
import { PlanApprovedEmergencyContact } from "../../../src/models/workflows/emergency-contact-member/read-contact-plan.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { TransactionOutcomeSchema } from "../../../src/rules/write-safety/write-safety-primitives.js";
import { createEmergencyContactRetryWorld, EC_TREE_DESCRIPTORS } from "../../support/helpers/backend/emergency-contact-retry-world.js";

const world = createEmergencyContactRetryWorld();
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
let fixture: Fixture;
beforeEach(async context => {
  fixture = await world.fixture({ secondMemberAlreadyPresent: context.task.name.startsWith("refuses direct Recover of already-present") });
});
afterEach(world.cleanup);
afterAll(world.releaseTemplates);
const signal = () => new AbortController().signal;
const saves = (f: Fixture) => ["10800000", "10800001"].map(eid => {
  const backend = f.persistence.get(eid); assert.ok(backend); return backend.submissions.length;
});

function failed(f: Fixture) {
  const run = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"
    && !f.children().some(next => next.envelope.retryOf === child.envelope.runId));
  assert.ok(run); return run;
}

function parentBytes(f: Fixture) {
  const raw = new DatabaseSync(f.path, { readOnly: true });
  try {
    return { results: raw.prepare("SELECT id,payload_json,terminal_run_json FROM run_results WHERE run_id=? ORDER BY settlement_version").all(f.parentRun.envelope.runId),
      receipts: raw.prepare("SELECT id,settlement_version,payload_json FROM run_receipts WHERE run_id=? ORDER BY id").all(f.parentRun.envelope.runId) };
  } finally { raw.close(); }
}

function memberIntents(f: Fixture, run: RunRecord) {
  const checkpoint = readRunCheckpoint(f.database.authority, run.envelope, "contact-plan", true); assert.ok(checkpoint);
  const plan = PlanApprovedEmergencyContact.output.parse(checkpoint.output.value);
  const key = UcpathSaveEmergencyContact.writeSafety.idempotency.key(plan.target);
  const intents = f.database.authority.writeIntents.listByBusinessKey("ucpath", deriveIdempotencyKeyDigest("ucpath", key));
  for (const intent of intents) {
    assert.equal(intent.workflowId, run.envelope.workflow);
    assert.equal(intent.itemId, run.envelope.itemId);
    assert.equal(intent.idempotencyKey, key);
  }
  return intents;
}

function unchangedState(f: Fixture) {
  const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId);
  const intents = [...new Map([...children.flatMap(child => f.database.authority.writeIntents.listByRun(child.envelope.runId)),
    ...f.children().flatMap(child => memberIntents(f, child))].map(intent => [intent.writeIntentId, intent])).values()];
  return { parent: f.current(), children, dependencies: f.database.authority.dependencies.listByParentRun(f.parentRun.envelope.runId),
    intents, attempts: intents.flatMap(intent => f.database.authority.writeAttempts.listByIntent(intent.writeIntentId)),
    bytes: parentBytes(f), saves: saves(f), generation: f.database.getMeta().authorityGeneration };
}

function refuseDirectRecover(f: Fixture, target: RunRecord) {
  const command = { ...f.runCommand("retry", target), type: "recover-run" as const }, before = unchangedState(f);
  const recover = vi.spyOn(f.canonical.lifecycle, "recover");
  const admitted = new Set<string>();
  let generation = before.generation;
  try {
    for (const request of [command, command, { ...command, commandId: randomUUID() }]) {
      const calls = recover.mock.calls.length;
      const result = f.canonical.kernel.execute(request);
      assert.ok(result.state === "rejected" && result.code === "RUN_CONTINUATION_REFUSED", JSON.stringify(result));
      const replay = admitted.has(request.commandId);
      if (!replay && target.lifecycle.state === "terminal") {
        assert.equal(recover.mock.calls.length, calls + 1, "ordinary recovery planning reached the genuine native owner");
        const refused = recover.mock.results.at(-1); assert.ok(refused?.type === "throw");
        assert.ok(refused.value instanceof RunContinuationRefusedError);
        assert.match(refused.value.message, /delegation-accounting-recovery-requires-member-retry/);
      } else if (!replay) assert.equal(recover.mock.calls.length, calls, "UNKNOWN refuses before native recovery");
      else assert.equal(recover.mock.calls.length, calls, "exact retry replays the stored refusal");
      const after = unchangedState(f);
      assert.deepEqual({ ...after, generation: before.generation }, before);
      assert.equal(after.generation, generation + (replay ? 0 : 2));
      if (!replay) {
        assert.equal(f.database.authority.commands.get(request.commandId)?.commandId, request.commandId);
        assert.equal(f.database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "rejected");
        admitted.add(request.commandId);
        generation = after.generation;
      }
    }
  } finally { recover.mockRestore(); }
}

function receipts(f: Fixture) {
  return createReceiptService({ database: f.database, runReader: f.canonical.lifecycle,
    descriptors: [...EC_TREE_DESCRIPTORS, f.root.descriptor] });
}

it("refuses direct Recover before Save under a settled parent with no receipt, then permits Retry with an exact retained receipt", async () => {
  const f = fixture, original = failed(f);
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  const parent = f.current(); assert.ok(parent.completion);
  const version = parent.completion.expectedVersion + 1;
  const settlement = f.database.authority.runResults.getSettlement(parent.envelope.runId, version); assert.ok(settlement);
  assert.equal(f.database.authority.evidenceReceipts.findByRun(parent.envelope.runId), undefined);
  assert.deepEqual(parentBytes(f).receipts, []);
  assert.deepEqual(saves(f), [1, 0]);
  refuseDirectRecover(f, original);
  const bytes = parentBytes(f);
  const command = f.runCommand("retry", original);
  assert.equal(f.canonical.kernel.execute(command).state, "applied");
  assert.equal(f.current().lifecycle.state, "queued");
  assert.equal(f.current().pause?.state, "paused");
  const replacement = f.children().filter(child => child.envelope.retryOf === original.envelope.runId);
  assert.equal(replacement.length, 1); const next = replacement[0]; assert.ok(next);
  assert.equal(next.lifecycle.state, "queued");
  assert.deepEqual(saves(f), [1, 0]);
  const retained = f.database.authority.evidenceReceipts.listByRun(parent.envelope.runId);
  assert.equal(retained.length, 1); const receipt = retained[0]; assert.ok(receipt);
  const receiptBytes = parentBytes(f).receipts;
  assert.equal(receiptBytes.length, 1);
  assert.equal(receiptBytes[0]?.settlement_version, version);
  assert.deepEqual(f.database.authority.evidenceReceipts.get(receipt.receiptId), receipt);
  assert.deepEqual(parentBytes(f).results, bytes.results);
  const executed = await f.canonical.step(f.parentRun, signal());
  assert.equal(executed.run.envelope.runId, next.envelope.runId); assert.equal(executed.outcome.state, "done");
  assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
  assert.deepEqual(f.database.authority.runResults.getSettlement(parent.envelope.runId, version), settlement);
  assert.deepEqual(settlement.run.envelope, parent.envelope);
  const currentReceipt = receipts(f).ensureReceipt(parent.envelope.runId);
  assert.notEqual(currentReceipt.receiptId, receipt.receiptId);
  assert.deepEqual(f.database.authority.evidenceReceipts.get(receipt.receiptId), receipt);
  const finalBytes = parentBytes(f);
  for (const row of bytes.results) assert.deepEqual(finalBytes.results.find(current => current.id === row.id), row);
  for (const row of receiptBytes) assert.deepEqual(finalBytes.receipts.find(current => current.id === row.id), row);
  assert.equal(f.canonical.kernel.execute(command).state, "already-applied");
  assert.equal(f.children().filter(child => child.envelope.retryOf === original.envelope.runId).length, 1);
  assert.deepEqual(saves(f), [1, 1]);
});

for (const effect of ["committed", "already-present", "UNKNOWN"] as const)
it(`refuses direct Recover of ${effect} member evidence without a replacement, parent/dependency mutation or repeated Save`, async () => {
  const f = fixture, original = failed(f);
  let target = original;
  if (effect !== "already-present") {
    assert.equal(f.canonical.kernel.execute(f.runCommand("retry", original)).state, "applied");
    f.control.unknownAfterSave = effect === "UNKNOWN";
    f.control.failAfterSave = effect !== "UNKNOWN";
    const executed = await f.canonical.step(f.parentRun, signal());
    assert.equal(executed.outcome.state, effect === "UNKNOWN" ? "parked-write" : "failed");
    target = f.current(executed.run.envelope.runId);
  } else {
    assert.equal(target.envelope.retryOf, undefined, "presence is observed on the first attempt, before any failed-write intent");
    assert.equal(target.envelope.sourceBound, undefined);
    assert.equal(f.control.failAfterSave, false, "the controlled failure ran after real transaction settlement");
  }
  const intents = memberIntents(f, target);
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.status, effect === "UNKNOWN" ? "parked" : effect === "committed" ? "committed" : "observed-present");
  if (effect !== "UNKNOWN") {
    const checkpoint = f.database.authority.runCheckpoints.listByItem(target.envelope.workflow, target.envelope.itemId)
      .find(row => row.runId === target.envelope.runId && row.nodeId === "contact-preview"); assert.ok(checkpoint);
    const outcome = TransactionOutcomeSchema.parse(checkpoint.output.value);
    assert.equal(outcome.disposition, effect);
    if (effect === "already-present") assert.equal(outcome.proofSource, "live-probe");
    if (effect !== "already-present") assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
    assert.equal((await f.canonical.step(f.parentRun, signal())).outcome.state, "done");
    assert.equal(f.database.authority.evidenceReceipts.findByRun(f.parentRun.envelope.runId), undefined);
  }
  const expectedSaves = effect === "already-present" ? [1, 0] : [1, 1];
  assert.deepEqual(saves(f), expectedSaves);
  refuseDirectRecover(f, target);
  const before = unchangedState(f);
  const request = f.runCommand("retry", target);
  const retry = f.canonical.kernel.execute(request);
  assert.equal(retry.state, "rejected");
  const after = unchangedState(f);
  assert.deepEqual({ ...after, generation: before.generation }, before);
  assert.equal(after.generation, before.generation + 2);
  assert.equal(f.database.authority.commands.get(request.commandId)?.commandId, request.commandId);
  assert.equal(f.database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "rejected");
  assert.deepEqual(saves(f), expectedSaves);
  if (effect !== "UNKNOWN") {
    const receipt = receipts(f).ensureReceipt(f.parentRun.envelope.runId);
    assert.deepEqual(f.database.authority.evidenceReceipts.get(receipt.receiptId), receipt);
    assert.deepEqual(saves(f), expectedSaves);
  }
});
