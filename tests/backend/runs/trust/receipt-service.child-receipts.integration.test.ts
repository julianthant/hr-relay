import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { onbaseWorkflow } from "../../../../src/workflows/onbase/workflow.js";
import { createEcMemberOnbaseWorld } from "../../../support/helpers/backend/ec-member-onbase-world.js";

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
