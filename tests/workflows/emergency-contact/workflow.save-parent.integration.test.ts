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
import { TransactionOutcomeSchema } from "../../../src/rules/write-safety/write-safety-primitives.js";


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
  // One member failed, so the parent's members node stays unknown and the parent reads done-with-warnings, never verified-done.
  const parentReceipt = receipts.ensureReceipt(f.parentRun.envelope.runId);
  assert.notEqual(parentReceipt.result, "verified-done");
  assert.equal(parentReceipt.result, "done-with-warnings");
  const membersRow = parentReceipt.verification.find(row => row.obligation === "node.members");
  assert.deepEqual(membersRow && { verdict: membersRow.verdict, evidence: membersRow.evidence, mandatory: membersRow.mandatory }, { verdict: "unknown", evidence: [], mandatory: false });
  assert.deepEqual(parentReceipt.warnings.filter(warning => warning.code === "DELEGATED_CHILD_UNVERIFIED").map(warning => [warning.loadBearing, warning.summary]),
    [[false, `1 of 2 child run(s) under "members" have no verified receipt; this run's result records each child's outcome`]]);
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
  const f = await world.fixture();
  // The shared template holds one saved member and one failed before its Save; its Retry saves the second.
  const original = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(original);
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", original)).state, "applied");
  const replacement = f.children().find(child => child.envelope.retryOf === original.envelope.runId); assert.ok(replacement);
  while (f.current(replacement.envelope.runId).lifecycle.state !== "terminal") await f.canonical.step(f.parentRun, new AbortController().signal);
  if (f.current().pause?.state === "paused") assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  const execution = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(execution.run?.lifecycle.state === "terminal" && execution.run.lifecycle.outcome === "done");
  const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId)
    .filter(child => child.envelope.workflow === "emergency-contact-member" && child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done");
  assert.equal(children.length, 2); assert.ok(children.some(child => child.envelope.runId === replacement.envelope.runId));
  assert.deepEqual(["10800000", "10800001"].map(eid => f.persistence.get(eid)?.submissions.length), [1, 1]);
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

it("re-derives the parent receipt that migration 26 deletes when a member settled already-present", async () => {
  const f = await world.fixture();
  // The second member failed before its Save; UCPath now already shows its contact, so the member's Retry settles already-present and done.
  const original = f.children().find(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed"); assert.ok(original);
  f.markContactPresent("10800001");
  assert.equal(f.canonical.kernel.execute(f.runCommand("retry", original)).state, "applied");
  const presentMember = f.children().find(child => child.envelope.retryOf === original.envelope.runId); assert.ok(presentMember);
  // The Retry holds the parent paused: settle the member and its OnBase child, then resume the parent to finish.
  while (f.current(presentMember.envelope.runId).lifecycle.state !== "terminal") await f.canonical.step(f.parentRun, new AbortController().signal);
  if (f.current().pause?.state === "paused") assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  await f.canonical.execute(f.parentRun, new AbortController().signal);
  const parentNow = f.current();
  assert.ok(parentNow.lifecycle.state === "terminal" && parentNow.lifecycle.outcome === "done", JSON.stringify(parentNow.lifecycle));
  const settled = f.current(presentMember.envelope.runId);
  assert.ok(settled.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done", JSON.stringify(settled.lifecycle));
  assert.deepEqual(f.database.authority.writeIntents.listByRun(presentMember.envelope.runId), []);
  const preview = f.database.authority.runCheckpoints.listByItem(presentMember.envelope.workflow, presentMember.envelope.itemId)
    .find(row => row.runId === presentMember.envelope.runId && row.nodeId === "contact-preview"); assert.ok(preview);
  assert.equal(TransactionOutcomeSchema.parse(preview.output.value).disposition, "already-present");
  assert.deepEqual(["10800000", "10800001"].map(eid => f.persistence.get(eid)?.submissions.length), [1, 0], "exact presence needed no Save");
  const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: EC_TREE_DESCRIPTORS });
  const parentRunId = f.parentRun.envelope.runId;
  const parentReceipt = receipts.ensureReceipt(parentRunId);
  const memberReceipt = f.database.authority.evidenceReceipts.findByRun(presentMember.envelope.runId); assert.ok(memberReceipt);
  const membersRow = parentReceipt.verification.find(row => row.obligation === "node.members");
  assert.ok(membersRow?.verdict === "verified");
  assert.ok(membersRow.evidence.some(ref => ref === `receipt:${String(memberReceipt.receiptId)}`), "the already-present member's own receipt backs the node");
  const durable = () => {
    using raw = new DatabaseSync(f.path, { readOnly: true });
    return ["write_intents", "write_attempts", "run_checkpoints"].map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  };
  const before = durable();
  const statements = SQLITE_MIGRATIONS.find(migration => migration.version === 26)?.statements; assert.ok(statements);
  {
    using raw = new DatabaseSync(f.path);
    raw.exec("BEGIN IMMEDIATE");
    for (const statement of statements) raw.exec(statement);
    raw.exec("COMMIT");
  }
  assert.equal(f.database.authority.evidenceReceipts.findByRun(parentRunId), undefined, "migration 26 deletes the delegation parent's receipt");
  const rederived = receipts.ensure(parentRunId);
  assert.deepEqual({ state: rederived.state, receipt: rederived.receipt }, { state: "derived", receipt: parentReceipt });
  assert.equal(rederived.receipt.receiptId, parentReceipt.receiptId);
  assert.deepEqual(f.database.authority.evidenceReceipts.findByRun(presentMember.envelope.runId), memberReceipt);
  assert.equal(receipts.ensure(parentRunId).state, "existing");
  assert.deepEqual(durable(), before, "re-derivation reads durable intents, attempts and checkpoints and writes none");
});

