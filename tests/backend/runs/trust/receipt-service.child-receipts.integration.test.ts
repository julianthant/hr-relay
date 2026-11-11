import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { onbaseWorkflow } from "../../../../src/workflows/onbase/workflow.js";
import { createEcMemberOnbaseWorld } from "../../../support/helpers/backend/ec-member-onbase-world.js";
import { UcpathSaveEmergencyContact } from "../../../../src/models/systems/ucpath/save-emergency-contact.js";
import { deriveIdempotencyKeyDigest, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import type { RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";

const world = createEcMemberOnbaseWorld();
afterEach(world.cleanup);

async function setup() {
  const f = await world.savedMember();
  const children = f.database.authority.runs.listByWorkflow("onbase");
  const child = children.find(candidate => candidate.envelope.parent?.runId === f.run.envelope.runId);
  assert.ok(child);
  const assertNodeUnknown = (receipt: ReturnType<ReturnType<typeof createReceiptService>["ensureReceipt"]>) => {
    const row = receipt.verification.find(candidate => candidate.obligation === "node.onbase-import");
    assert.deepEqual(row && { verdict: row.verdict, evidence: row.evidence }, { verdict: "unknown", evidence: [] });
    assert.equal(receipt.result, "partial");
    assert.equal(f.database.authority.evidenceReceipts.findByRun(child.envelope.runId), undefined);
  };
  return { f, child, assertNodeUnknown };
}

it("opens the parent receipt with the node unknown when the child's registered descriptor declares another version", async () => {
  const { f, assertNodeUnknown } = await setup();
  const [member] = f.descriptors; assert.ok(member);
  const moved = compileWorkflow({ ...onbaseWorkflow, version: onbaseWorkflow.version + 1 }).descriptor;
  const service = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: [member, moved] });
  assertNodeUnknown(service.ensureReceipt(f.run.envelope.runId));
});

it("opens the parent receipt with the node unknown when the run reader returns the child as interrupted", async () => {
  const { f, child, assertNodeUnknown } = await setup();
  const runReader = { read: (runId: string) => {
    const existence = f.execution.lifecycle.read(runId);
    return runId === child.envelope.runId && existence.state === "present"
      ? { ...existence, run: { ...existence.run, lifecycle: { ...existence.run.lifecycle, state: "terminal" as const, outcome: "interrupted" as const } } } : existence;
  } };
  const service = createReceiptService({ database: f.database, runReader: runReader as typeof f.execution.lifecycle, descriptors: f.descriptors });
  assertNodeUnknown(service.ensureReceipt(f.run.envelope.runId));
});

it("throws when the child's descriptor is not registered", async () => {
  const { f } = await setup();
  const service = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: f.descriptors.slice(0, 1) });
  assert.throws(() => service.ensureReceipt(f.run.envelope.runId), /does not register/u);
});

// A database whose checkpoint reader adds or drops `contact-plan` rows; everything else is the real authority.
function withPlanRows(database: AuthorityDatabase, rows: (actual: readonly RunCheckpointRecord[]) => readonly RunCheckpointRecord[]): AuthorityDatabase {
  const checkpoints = database.authority.runCheckpoints;
  const runCheckpoints = new Proxy(checkpoints, { get: (target, key) => key === "listByAttempt"
    ? (workflowId: string, itemId: string, nodeId: string, attempt: number) => {
      const actual = target.listByAttempt(workflowId, itemId, nodeId, attempt);
      return nodeId === "contact-plan" ? rows(actual) : actual;
    } : (Reflect.get(target, key) as unknown) });
  const authority = new Proxy(database.authority, { get: (target, key) => key === "runCheckpoints" ? runCheckpoints : Reflect.get(target, key) as unknown });
  return new Proxy(database, { get: (target, key) => {
    if (key === "authority") return authority;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  } });
}

it("pairs a new item's already-present Save with its exact original permanent record from checkpoint-bounded facts", async () => {
  const f = await world.savedMember();
  const [original] = f.database.authority.writeIntents.listByRun(f.run.envelope.runId);
  assert.ok(original?.status === "committed");
  const unrelatedKey = `${original.idempotencyKey}|unrelated`;
  f.database.authority.writeIntents.recordObservedPresent(WriteIntentRecordSchema.parse({ writeIntentId: crypto.randomUUID(), workflowId: original.workflowId,
    itemId: `${original.itemId}-unrelated`, taskId: original.taskId, system: original.system, idempotencyKey: unrelatedKey,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest(original.system, unrelatedKey), generation: 1, status: "observed-present",
    observedProof: original.completionProof, observedAt: original.confirmedAt, version: 1, createdAt: original.confirmedAt, updatedAt: original.confirmedAt }));
  const second = await f.again(`${"c".repeat(64)}#emergency-contact#2`);
  assert.notEqual(second.envelope.itemId, f.run.envelope.itemId);
  assert.deepEqual(f.database.authority.writeIntents.listByRun(second.envelope.runId), []);
  const assertedEid = String(f.run.input.parsed.value && (f.run.input.parsed.value as { record: { assertedEid: string } }).record.assertedEid);
  // A later claim's planning row for another employee would derive another key; the checkpoint's bound excludes it.
  const later = withPlanRows(f.database, actual => {
    const last = actual.at(-1); assert.ok(last);
    return [...actual, { ...last, claimGeneration: last.claimGeneration + 1, writtenAt: new Date(Date.parse(last.writtenAt) + 60_000).toISOString(),
      output: { ...last.output, value: JSON.parse(JSON.stringify(last.output.value).replaceAll(assertedEid, "10899999")) as typeof last.output.value } }];
  });
  const service = createReceiptService({ database: later, runReader: f.execution.lifecycle, descriptors: f.descriptors });
  const receipt = service.ensureReceipt(second.envelope.runId);
  const commit = receipt.actions.find(action => action.kind === "commit" && action.taskId === UcpathSaveEmergencyContact.id);
  assert.deepEqual(commit && [commit.writeState, "proofRef" in commit, commit.proved?.proofSource, commit.proved?.idempotencyKeyDigest],
    ["committed", false, "durable-intent", original.idempotencyKeyDigest]);
  assert.deepEqual(service.ensure(second.envelope.runId), { state: "existing", receipt });
  assert.deepEqual(f.database.authority.writeIntents.listByRun(f.run.envelope.runId), [original]);
  const missing = createReceiptService({ database: withPlanRows(f.database, () => []), runReader: f.execution.lifecycle, descriptors: f.descriptors });
  const third = await f.again(`${"d".repeat(64)}#emergency-contact#3`);
  assert.throws(() => missing.ensureReceipt(third.envelope.runId), /commit-input re-derivation refused \(missing-evidence/u);
  assert.equal(f.persistence.submissions.length, 1, "receipt reads never Save");
});
