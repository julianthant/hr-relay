import { createEmergencyContactRetryWorld, contactSaveMember } from "../../support/helpers/backend/emergency-contact-retry-world.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { readQueueRecordMembers } from "../../../src/backend/runs/queries/ocr-record-members.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import assert from "node:assert/strict";
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
  const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [contactSaveMember.descriptor] });
  assert.equal(receipts.ensureReceipt(succeeded.envelope.runId).result, "verified-done");
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
