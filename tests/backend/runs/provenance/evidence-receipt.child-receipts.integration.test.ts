import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { buildRunEvidenceReceipt,type ReceiptBuildInput } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { deriveEvidenceEntryId } from "../../../../src/models/trust/evidence-identity.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { RunEvidenceReceiptSchema,type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { createEcMemberOnbaseWorld } from "../../../support/helpers/backend/ec-member-onbase-world.js";

const world = createEcMemberOnbaseWorld();
afterEach(world.cleanup);

type Row = RunEvidenceReceipt["verification"][number];
const NODE = "node.onbase-import";

async function setup() {
  const f = await world.savedMember();
  const service = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: f.descriptors });
  service.ensureReceipt(f.run.envelope.runId);
  const repositories = f.database.authority;
  const run = repositories.runs.get(f.run.envelope.runId); assert.ok(run);
  const result = repositories.runResults.get(run.envelope.runId); assert.ok(result);
  const input: ReceiptBuildInput = { descriptor: f.descriptors[0], run, result,
    checkpoints: repositories.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), gateResults: [],
    writes: repositories.writeIntents.listByRun(run.envelope.runId).map(intent => ({ intent, attempts: repositories.writeAttempts.listByIntent(intent.writeIntentId) })),
    delegations: [readDelegationEvidence(repositories, run.envelope.runId, "onbase-import")] };
  const child = repositories.runs.listChildren(run.envelope.runId).find(candidate => candidate.envelope.workflow === "onbase");
  assert.ok(child);
  const childReceipt = RunEvidenceReceiptSchema.parse(service.ensureReceipt(child.envelope.runId));
  const row = (receipt: RunEvidenceReceipt): Row => { const found = receipt.verification.find(candidate => candidate.obligation === NODE); assert.ok(found); return found; };
  const warning = { id: deriveEvidenceEntryId(childReceipt.receiptId, "warning", "fixture"), code: "FIXTURE_WARNING", summary: "A fixture warning", loadBearing: false, evidence: [] };
  const stub = (patch: Partial<RunEvidenceReceipt>) => RunEvidenceReceiptSchema.parse({ ...childReceipt, ...patch,
    ...patch.result === "done-with-warnings" ? { warnings: [warning] } : {} });
  const reader = (override: unknown) => (runId: string) => runId === child.envelope.runId ? override : service.ensureReceipt(runId);
  return { input, childReceipt, row, stub, reader, run };
}

it("keeps the child-run node unknown when the child's own receipt is partial", async () => {
  const { input, childReceipt, row, stub, reader } = await setup();
  assert.equal(childReceipt.result, "verified-done");
  const verified = buildRunEvidenceReceipt({ ...input, childReceipt: reader(childReceipt) });
  assert.deepEqual({ verdict: row(verified).verdict, evidence: row(verified).evidence }, { verdict: "verified", evidence: [`receipt:${childReceipt.receiptId}`] });
  const partial = buildRunEvidenceReceipt({ ...input, childReceipt: reader(stub({ result: "partial" })) });
  assert.deepEqual({ verdict: row(partial).verdict, evidence: row(partial).evidence }, { verdict: "unknown", evidence: [] });
  assertUnverifiedWarning(partial);
  // The node is a terminal dependency, so its unknown row keeps the result partial.
  assert.equal(partial.result, "partial");
});

it("verifies the node from a done-with-warnings child and carries one warning that is not load-bearing", async () => {
  const { input, childReceipt, row, stub, reader } = await setup();
  const receipt = buildRunEvidenceReceipt({ ...input, childReceipt: reader(stub({ result: "done-with-warnings" })) });
  assert.deepEqual({ verdict: row(receipt).verdict, evidence: row(receipt).evidence }, { verdict: "verified", evidence: [`receipt:${childReceipt.receiptId}`] });
  const warnings = receipt.warnings.filter(warning => warning.code === "DELEGATED_CHILD_WARNINGS");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.loadBearing, false);
  assert.deepEqual(warnings[0]?.evidence, [`receipt:${childReceipt.receiptId}`]);
  assert.equal(receipt.result, "done-with-warnings");
});

it("refuses a child receipt that belongs to another run", async () => {
  const { input, stub, reader } = await setup();
  assert.throws(() => buildRunEvidenceReceipt({ ...input, childReceipt: reader(stub({ runId: RunIdSchema.parse(randomUUID()) })) }), /receipt-delegation-child-receipt-mismatch/u);
});

it("leaves the node unknown with no reader or when the reader has no receipt for the child", async () => {
  const { input, row, reader } = await setup();
  const [unread, missing] = [buildRunEvidenceReceipt(input), buildRunEvidenceReceipt({ ...input, childReceipt: reader(undefined) })];
  for (const receipt of [unread, missing]) {
    assert.deepEqual({ verdict: row(receipt).verdict, evidence: row(receipt).evidence }, { verdict: "unknown", evidence: [] });
    assert.equal(receipt.result, "partial");
  }
  assert.equal(unread.warnings.some(warning => warning.code === "DELEGATED_CHILD_UNVERIFIED"), false, "no reader, no warning");
  assertUnverifiedWarning(missing);
});

function assertUnverifiedWarning(receipt: RunEvidenceReceipt) {
  const warnings = receipt.warnings.filter(warning => warning.code === "DELEGATED_CHILD_UNVERIFIED");
  assert.deepEqual(warnings.map(warning => ({ loadBearing: warning.loadBearing, evidence: warning.evidence, summary: warning.summary })),
    [{ loadBearing: false, evidence: [], summary: `1 of 1 child run(s) under "onbase-import" have no verified receipt; this run's result records each child's outcome` }]);
}
