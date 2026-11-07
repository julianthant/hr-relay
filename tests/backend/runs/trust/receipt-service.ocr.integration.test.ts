import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { buildRunEvidenceReceipt, type ReceiptBuildInput } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { authenticateOcrSnapshotApproval } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { OcrApprovedSnapshotSchema, OcrReviewRevisionSchema } from "../../../../src/models/ocr/review.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { OperatorGateResultRecordSchema } from "../../../../src/models/workflow/gates.js";
import { findGateDecision, findSnapshotApprovalDecision } from "../../../../src/models/trust/gate-decisions.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { ocrProofReadDatabase, replaceOcrAuditRead, replaceOcrCommandRead } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("derives ordinary read-only OCR receipts under a delegated parent dry run with every authenticated delegation retained", async () => {
  const f = await world.fixture({ coordinator: true, dryRun: true, record: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  const completed = await f.canonical.step(f.parentRun, new AbortController().signal);
  assert.equal(completed.run.envelope.runId, f.run.envelope.runId);
  assert.equal(completed.outcome.state, "done");
  const descriptor = f.resolve("ocr"); assert.ok(descriptor);
  const service = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [descriptor] });
  const receipt = service.ensureReceipt(f.run.envelope.runId);
  assert.deepEqual(service.ensureReceipt(f.run.envelope.runId), receipt);
  assert.equal(receipt.warnings.some(warning => warning.code === "DRY_RUN_PREVIEW"), false);
  assert.equal(receipt.decisions.some(decision => decision.kind === "gate" && decision.outcome === "approved"), true);
});

it("derives the existing receipt format from the exact authenticated OCR snapshot approval", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const approval = f.approval();
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  await f.canonical.execute(f.run, new AbortController().signal);
  const service = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor] });
  const receipt = service.ensureReceipt(f.run.envelope.runId);
  assert.equal(receipt.composition, 5);
  assert.equal(receipt.decisions.find(decision => decision.kind === "gate" && decision.outcome === "approved")?.outcome, "approved");
  assert.deepEqual(service.ensureReceipt(f.run.envelope.runId), receipt);
  assert.equal(findGateDecision("ocr", "approve-records"), undefined);
  assert.equal(findSnapshotApprovalDecision("ocr", "approve-records")?.workflowId, "ocr");
  assert.equal(findSnapshotApprovalDecision("separations", "identity-approval"), undefined);
  const facts = receipt.observations.filter(fact => fact.source.kind === "gate-result");
  assert.equal(facts.length, 4);
  for (const field of ["snapshotId", "sourceRunId", "digest"] as const) {
    const fact = facts.find(fact => fact.field === field); assert.ok(fact);
    assert.equal(fact.state, "satisfied");
    if (fact.state !== "satisfied") assert.fail("approval observation is unresolved");
    assert.deepEqual(fact.value, { key: field, state: "allowed", classification: "sensitive-hr", transform: "allow",
      value: approval.payload.result.value[field] });
  }
  assert.equal(receipt.decisions.some(decision => decision.reason.includes(approval.payload.result.value.digest)), false);

  const repositories = f.database.authority;
  const gate = OperatorGateResultRecordSchema.parse(repositories.gateResults.get(`${f.run.envelope.runId}:approve-records`));
  const run = repositories.runs.get(f.run.envelope.runId); assert.ok(run);
  const result = repositories.runResults.get(f.run.envelope.runId); assert.ok(result);
  const delegations = [readDelegationEvidence(repositories, run.envelope.runId, "read-pages"), readDelegationEvidence(repositories, run.envelope.runId, "lookup-identities"),
    readDelegationEvidence(repositories, run.envelope.runId, "lookup-signers")];
  const input: ReceiptBuildInput = { descriptor: f.root.descriptor, run, result,
    checkpoints: repositories.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), gateResults: [gate],
    delegations,
    authenticateSnapshotApproval: row => authenticateOcrSnapshotApproval(repositories, f.canonical.lifecycle, row, f.resolve) };
  assert.deepEqual(buildRunEvidenceReceipt(input), receipt);
  const { authenticateSnapshotApproval: _authenticate, ...unproved } = input;
  assert.throws(() => buildRunEvidenceReceipt(unproved), /OCR_REVIEW_REFUSED/u);
  assert.throws(() => buildRunEvidenceReceipt({ ...input, gateResults: [] }));
  assert.throws(() => buildRunEvidenceReceipt({ ...input, delegations: [] }), /terminal-dependency-set/u);
  assert.throws(() => buildRunEvidenceReceipt({ ...input, delegations: input.delegations?.slice(1) }), /terminal-dependency-set/u);
  for (const altered of [
    [delegations[0], ...delegations],
    [{ ...delegations[0], parentRunId: randomUUID() }, ...delegations.slice(1)],
    [{ ...delegations[0], edgeId: "foreign-edge" }, ...delegations.slice(1)],
    [{ ...delegations[0], manifest: { ...delegations[0].manifest, manifestFingerprint: "f".repeat(64) } }, ...delegations.slice(1)],
  ]) assert.throws(() => buildRunEvidenceReceipt({ ...input, delegations: altered }), /evidence-graph/u);

  const snapshot = repositories.ocrReviews.snapshot(approval.commandId); assert.ok(snapshot);
  const revision = repositories.ocrReviews.latest(run.envelope.runId); assert.ok(revision);
  const command = repositories.commands.get(approval.commandId); assert.ok(command);
  const audit = repositories.commandAudits.findByCommand(approval.commandId); assert.ok(audit);
  const foreign = randomUUID();
  const variants = [
    ["missing snapshot", { ...repositories, ocrReviews: { ...repositories.ocrReviews, snapshots: () => [] } }, "ocr"],
    ["missing gate", { ...repositories, gateResults: { ...repositories.gateResults, get: () => undefined } }, "ocr"],
    ["foreign command actor", replaceOcrCommandRead(repositories, approval.commandId, CommandRequestSchema.parse({ ...command, requestedBy: "foreign-operator" })), "native"],
    ["altered audit completion", replaceOcrAuditRead(repositories, approval.commandId, CommandAuditRecordSchema.parse({ ...audit, completedAt: "2026-11-04T00:00:00.000Z" })), "native"],
    ["foreign snapshot source", { ...repositories, ocrReviews: { ...repositories.ocrReviews, snapshots: () => [OcrApprovedSnapshotSchema.parse({ ...snapshot, sourceRunId: foreign })] } }, "ocr"],
    ["altered snapshot digest", { ...repositories, ocrReviews: { ...repositories.ocrReviews, snapshots: () => [OcrApprovedSnapshotSchema.parse({ ...snapshot, reviewDigest: "f".repeat(64) })] } }, "ocr"],
    ["changed latest revision", { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      latest: () => OcrReviewRevisionSchema.parse({ ...revision, id: `${revision.sourceRunId}#${revision.revision + 1}`, revision: revision.revision + 1 }) } }, "ocr"],
  ] as const;
  const generation = f.database.getMeta().authorityGeneration;
  for (const [name, altered, failure] of variants) {
    const expected = failure === "native" ? { name: "Error", message: "delegation-gate-resume-authority-unavailable" }
      : { name: "OcrReviewRefusedError", message: "OCR_REVIEW_REFUSED" };
    assert.throws(() => buildRunEvidenceReceipt({ ...input,
      authenticateSnapshotApproval: row => authenticateOcrSnapshotApproval(altered, f.canonical.lifecycle, row, f.resolve) }), expected, name);
    const refused = createReceiptService({ database: ocrProofReadDatabase(f.database, altered), runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor] });
    assert.throws(() => refused.ensureReceipt(run.envelope.runId), expected, name);
  }
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  for (const altered of [
    { ...gate, resolvedBy: "foreign-operator" },
    { ...gate, result: { ...gate.result, value: { ...approval.payload.result.value, digest: "f".repeat(64) } } },
    { ...gate, result: { ...gate.result, value: { ...approval.payload.result.value, snapshotId: foreign } } },
  ]) {
    assert.throws(() => buildRunEvidenceReceipt({ ...input, gateResults: [altered] }));
  }
  assert.deepEqual(service.ensureReceipt(run.envelope.runId), receipt);
});
