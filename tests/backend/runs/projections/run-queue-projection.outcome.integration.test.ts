import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../../src/models/trust/evidence-identity.js";
import { FingerprintSchema, PositiveIntSchema, RunIdSchema, TraceIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { DAY, instantOffsetOf, receiptWithOutputOf, traceOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const { world, runRecordOf, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

function setup(options: { workflow?: string; fieldPath?: string } = {}) {
  const seed = 80;
  const workflow = options.workflow ?? "person-lookup";
  const fieldPath = options.fieldPath ?? "activeStatus.state";
  assert.ok(personLookupDescriptor.outcomeProjection);
  const descriptor = { ...personLookupDescriptor, details: [], id: WorkflowIdSchema.parse(workflow),
    outcomeProjection: { ...personLookupDescriptor.outcomeProjection, fieldPath } };
  const w = world({ descriptors: { resolve: () => descriptor } });
  queuedEventOf(w, { seed, workflow });
  const run = runRecordOf({ seed, workflow, lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 60_000) }, version: 3 });
  w.authority.put(run);
  const receipt = receiptWithOutputOf({ seed, workflow, outputs: [{ field: "state", value: "active" }] });
  receipt.configFingerprint = run.envelope.configFingerprint;
  receipt.output[0].id = deriveEvidenceEntryId(receipt.receiptId, "output", fieldPath);
  receipt.verification = [{
    id: deriveEvidenceEntryId(receipt.receiptId, "verification", "completion.terminal-result"),
    obligation: "completion.terminal-result", mandatory: true, verdict: "verified",
    evidence: [evidenceEntryRef(receipt.output[0].id)],
  }];
  const save = () => w.authority.receipts.set(uuidOf(seed), RunEvidenceReceiptSchema.parse(receipt));
  const row = () => w.projection.buildDashboardDayWire(DAY).queueSurfaces.find(entry => entry.runId === uuidOf(seed));
  save();
  return { w, run, receipt, row, save };
}

describe("declared Queue business outcomes", () => {
  it.each([
    ["active", "Active", "success"], ["inactive", "Inactive", "neutral"],
    ["crm-only", "CRM only", "warning"], ["multiple-matches", "Multiple matches", "warning"],
    ["not-found", "Not found", "neutral"], ["undetermined", "Undetermined", "warning"],
    ["found", "Found", "success"], ["not-found-in-ucpath", "Not found in UCPath", "neutral"],
  ])("projects %s from the verified receipt", (value, label, tone) => {
    const { receipt, save, row } = setup();
    const fact = receipt.output[0]; assert.ok(fact.state === "satisfied");
    fact.value = { key: "state", state: "allowed", classification: "safe-diagnostic", transform: "allow", value };
    save();
    assert.deepEqual(row()?.outcome, { label, tone });
  });

  it("uses an arbitrary workflow and exact different result path", () => {
    const { row } = setup({ workflow: "another-workflow", fieldPath: "resolution.category" });
    assert.deepEqual(row()?.outcome, { label: "Active", tone: "success" });
  });

  it("keeps a safe outcome when a protected input exists", () => {
    const { w, run, row } = setup();
    w.authority.put({ ...run, input: { ...run.input, parsed: { ...run.input.parsed,
      protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: uuidOf(99) }],
    } } });
    assert.deepEqual(row()?.outcome, { label: "Active", tone: "success" });
  });

  it("does not project a missing receipt", () => {
    const { w, row } = setup();
    w.authority.receipts.clear();
    assert.equal(row()?.outcome, undefined);
  });

  const unvalidated: ReadonlyArray<readonly [string, (receipt: RunEvidenceReceipt) => void]> = [
    ["missing verification", receipt => { receipt.verification = []; }],
    ["ambiguous verification", receipt => { receipt.verification[0].verdict = "ambiguous"; receipt.result = "partial"; receipt.confidence = "partial"; }],
    ["unknown verification", receipt => { receipt.verification[0].verdict = "unknown"; receipt.result = "partial"; receipt.confidence = "partial"; }],
    ["different verification ID", receipt => { receipt.verification[0].id = deriveEvidenceEntryId(receipt.receiptId, "verification", "other.obligation"); }],
    ["different obligation", receipt => { receipt.verification[0].obligation = "other.obligation"; }],
    ["missing output", receipt => { receipt.output = []; }],
    ["different output ID", receipt => { receipt.output[0].id = deriveEvidenceEntryId(receipt.receiptId, "output", "other.state"); }],
    ["unresolved output", receipt => { const { id, field, mandatory, source } = receipt.output[0]; receipt.output[0] = { id, field, mandatory, source, state: "unresolved", reason: "not validated" }; receipt.result = "partial"; receipt.confidence = "partial"; }],
    ["redacted output with raw value", receipt => { const fact = receipt.output[0]; assert.ok(fact.state === "satisfied"); fact.value = { key: "state", state: "redacted", classification: "sensitive-hr", transform: "drop", rawValue: "active" }; }],
    ["transformed output", receipt => { const fact = receipt.output[0]; assert.ok(fact.state === "satisfied"); fact.value = { key: "state", state: "transformed", classification: "direct-identifier", transform: "last4", value: "tive", rawValue: "active" }; }],
  ];
  it.each(unvalidated)("does not project %s", (_name, change) => {
    const { receipt, save, row } = setup();
    change(receipt); save();
    assert.equal(row()?.outcome, undefined);
  });

  const identities: ReadonlyArray<readonly [string, (receipt: RunEvidenceReceipt) => void]> = [
    ["run", receipt => { receipt.runId = RunIdSchema.parse(uuidOf(81)); }],
    ["trace", receipt => { receipt.traceId = TraceIdSchema.parse(traceOf(82)); }],
    ["attempt", receipt => { receipt.attempt = PositiveIntSchema.parse(2); }],
    ["workflow", receipt => { receipt.workflowId = WorkflowIdSchema.parse("other-workflow"); }],
    ["descriptor", receipt => { receipt.descriptorFingerprint = FingerprintSchema.parse("d".repeat(64)); }],
    ["config", receipt => { receipt.configFingerprint = FingerprintSchema.parse("e".repeat(64)); }],
  ];
  it.each(identities)("refuses a mismatched %s identity", (_name, change) => {
    const { receipt, save, row } = setup();
    change(receipt); save();
    assert.throws(row, /result-outcome-receipt-identity-mismatch/u);
  });

  it.each(["undeclared", null, 7, { state: "active" }])("refuses an undeclared authoritative output %j", value => {
    const { receipt, save, row } = setup();
    const fact = receipt.output[0]; assert.ok(fact.state === "satisfied");
    fact.value = { key: "state", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "active", rawValue: value };
    save();
    assert.throws(row, /result-outcome-value-undeclared/u);
  });

  it("keeps noncompleted rows on their lifecycle status even with a verified receipt", () => {
    const { w, run, row } = setup();
    for (const lifecycle of [
      { state: "queued" },
      { state: "running", workerId: "fixture-worker", claimedAt: instantOffsetOf(0, 1), heartbeatAt: instantOffsetOf(0, 2) },
      { state: "parked-gate", gateId: "approval", parkedAt: instantOffsetOf(0, 1), resumeAt: "searching" },
      { state: "terminal", outcome: "cancelled", endedAt: instantOffsetOf(0, 1) },
      { state: "terminal", outcome: "failed", endedAt: instantOffsetOf(0, 1), failureId: uuidOf(99) },
    ]) {
      w.authority.put(runRecordOf({ seed: 80, lifecycle, claimGeneration: 1, version: run.version }));
      assert.equal(row()?.outcome, undefined);
      assert.notEqual(row()?.status, "verified-done");
    }
  });
});
