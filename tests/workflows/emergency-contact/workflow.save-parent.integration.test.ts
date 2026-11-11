import { createEmergencyContactRetryWorld, EC_TREE_DESCRIPTORS } from "../../support/helpers/backend/emergency-contact-retry-world.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_MIGRATIONS } from "../../../src/backend/storage/sqlite/migrations.js";
import { afterAll, afterEach, it } from "vitest";
import { EmergencyContactMemberInputSchema } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { EmergencyContactResultSchema } from "../../../src/models/workflows/emergency-contact/result.js";


const world = createEmergencyContactRetryWorld();
afterEach(world.cleanup);
afterAll(world.releaseTemplates);
it("keeps the one OCR release and native member lineage while reporting one verified Save and one failed sibling without a forged output", async () => {
  const f = await world.fixture();
  const { facts, persistence } = f;
  const execution = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(execution.run?.lifecycle.state === "terminal" && execution.run.lifecycle.outcome === "done", JSON.stringify({ lifecycle: execution.run?.lifecycle, failures: f.database.authority.runs.listChildren(f.parentRun.envelope.runId).flatMap(child => f.database.authority.failures.listByRun(child.envelope.runId)).map(failure => ({ code: failure.code, summary: failure.summary })) }));
  const snapshot = f.database.authority.ocrReviews.snapshots(f.run.envelope.runId); assert.equal(snapshot.length, 1);
  const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(child => child.envelope.workflow === "emergency-contact-member");
  assert.equal(children.length, 2);
  assert.deepEqual(children.map(child => EmergencyContactMemberInputSchema.parse(child.input.parsed.value).record), snapshot[0]?.records);
  assert.ok(children.every(child => EmergencyContactMemberInputSchema.parse(child.input.parsed.value).approval.snapshotId === snapshot[0]?.snapshotId));
  const stored = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(stored);
  const result = EmergencyContactResultSchema.parse(stored.result.value);
  assert.deepEqual(result.members.map(member => member.state), ["done", "failed"]);
  const first = result.members[0], second = result.members[1]; assert.ok(first?.state === "done" && second?.state === "failed");
  assert.equal(first.output.disposition, "committed");
  assert.equal(first.output.proof.effect.name, facts[0]?.correctedContactName);
  assert.equal("output" in second, false);
  assert.equal(persistence.get("10800000")?.submissions.length, 1);
  const succeeded = children[0]; assert.ok(succeeded);
  assert.equal(f.database.authority.writeIntents.listByRun(succeeded.envelope.runId)[0]?.status, "committed");
  assert.ok(f.database.authority.runCheckpoints.latest(succeeded.envelope.workflow, succeeded.envelope.itemId, "contact-preview"));
  const date = f.clock.now().toISOString().slice(0, 10);
  assert.equal(createTransactionHistory(f.database.authority).query({ from: date, to: date, runId: succeeded.envelope.runId }).rows.length, 1);
  const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: EC_TREE_DESCRIPTORS });
  assert.equal(receipts.ensureReceipt(succeeded.envelope.runId).result, "verified-done");
  // One member failed, so the parent's members node stays unknown.
  const parentReceipt = receipts.ensureReceipt(f.parentRun.envelope.runId);
  assert.notEqual(parentReceipt.result, "verified-done");
  const membersRow = parentReceipt.verification.find(row => row.obligation === "node.members");
  assert.deepEqual(membersRow && { verdict: membersRow.verdict, evidence: membersRow.evidence }, { verdict: "unknown", evidence: [] });
  assert.equal(persistence.get("10800001")?.submissions.length, 0);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(children[1].envelope.runId), []);
  const rows = f.database.withAuthorityReadSnapshot(() => {
    const parent = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(parent);
    return readQueueRecordMembers(f.database.authority, f.canonical.lifecycle, parent,
      f.database.authority.runs.listChildren(parent.envelope.runId), f.resolve);
  });
  assert.ok(rows);
  assert.deepEqual(rows.members.map(row => row.statusLabel), ["Saved", "Failed"]);
  assert.deepEqual(rows.members.map(row => row.target.runId), children.map(child => child.envelope.runId));
  assert.ok(rows.members.every(row => row.kind === "record" && row.record.runId === f.run.envelope.runId));
});

it("verifies the parent's members node from every saved member's own receipt", async () => {
  const f = await world.fixture({ failures: 0 });
  const execution = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(execution.run?.lifecycle.state === "terminal" && execution.run.lifecycle.outcome === "done");
  const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(child => child.envelope.workflow === "emergency-contact-member");
  assert.equal(children.length, 2);
  const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: EC_TREE_DESCRIPTORS });
  const parentReceipt = receipts.ensureReceipt(f.parentRun.envelope.runId);
  const memberReceipts = children.map(child => f.database.authority.evidenceReceipts.findByRun(child.envelope.runId));
  assert.ok(memberReceipts.every(receipt => receipt?.result === "verified-done"));
  const membersRow = parentReceipt.verification.find(row => row.obligation === "node.members");
  assert.deepEqual(membersRow && { verdict: membersRow.verdict, evidence: [...membersRow.evidence].sort() },
    { verdict: "verified", evidence: memberReceipts.map(receipt => `receipt:${String(receipt?.receiptId)}`).sort() });
  assert.deepEqual(receipts.ensureReceipt(f.parentRun.envelope.runId), parentReceipt);
  const statements = SQLITE_MIGRATIONS.find(migration => migration.version === 26)?.statements; assert.ok(statements);
  {
    using raw = new DatabaseSync(f.path);
    raw.exec("BEGIN IMMEDIATE");
    for (const statement of statements) raw.exec(statement);
    raw.exec("COMMIT");
  }
  assert.equal(f.database.authority.evidenceReceipts.findByRun(f.parentRun.envelope.runId), undefined, "migration 26 deletes the delegation parent's receipt");
  const rederived = receipts.ensure(f.parentRun.envelope.runId);
  assert.deepEqual({ state: rederived.state, receipt: rederived.receipt }, { state: "derived", receipt: parentReceipt });
  assert.equal(receipts.ensure(f.parentRun.envelope.runId).state, "existing");
});
