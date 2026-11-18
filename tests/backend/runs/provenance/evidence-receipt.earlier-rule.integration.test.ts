import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, isRunPreviewSchemaHash, readRunPreviewResult, RunResultRecordSchema, terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { ocrProofReadDatabase } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("reads the settled receipt after its workflow removes a delegated node", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  await f.canonical.execute(f.run, new AbortController().signal);

  const runId = f.run.envelope.runId;
  const deps = { database: f.database, runReader: f.canonical.lifecycle };
  const original = f.root.descriptor;
  const stored = createReceiptService({ ...deps, descriptors: [original] }).ensureReceipt(runId);
  const result = f.database.authority.runResults.get(runId);
  assert.ok(result);
  assert.deepEqual(f.database.authority.evidenceReceipts.findByRun(runId), stored);

  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(original.id, original.code, wiring.providersOnlyContract);
  assert.notEqual(revised.contractFingerprint, stored.descriptorFingerprint);
  const citation = result.dependencies.find(dep => dep.state === "delegation-resolved");
  assert.ok(citation);
  const dependencies = result.dependencies.map(dep => dep === citation ? { ...dep, nodeId: "foreign-node" } : dep);
  const repositories = f.database.authority;
  const conflicting = ocrProofReadDatabase(f.database, { ...repositories, runResults: { ...repositories.runResults,
    get: id => id === runId ? RunResultRecordSchema.parse({
      ...result, dependencies, dependencyDigest: deriveTerminalDependencyDigest(dependencies),
    }) : repositories.runResults.get(id),
  } });
  assert.throws(() => createReceiptService({ ...deps, database: conflicting, descriptors: [revised] }).ensure(runId),
    /receipt-delegation-citation-mismatch/);

  const reader = createReceiptService({ ...deps, descriptors: [revised] });
  assert.deepEqual(reader.ensure(runId), { state: "existing", receipt: stored });
});

it("reads a first-transaction preview under its issued schema identity", () => {
  const hash = FingerprintSchema.parse("f738e4b4f4f486242d97892b7927f1e5605823b687c59af9da799e83b2b6797b");
  const nodeId = "save";
  const preview = {
    kind: "transaction-dry-run-preview", nodeId, observedAt: "2026-01-01T00:00:00.000Z",
    probe: { state: "present", proof: { schemaHash: hash, value: {} }, output: { schemaHash: hash, value: {} } },
    outcome: { state: "already-present", proofSource: "live-probe" },
  };
  const value = { kind: "dry-run-preview", stoppedAtNodeId: nodeId, externalCommit: "none", preview };
  const read = (payload: typeof value) => readRunPreviewResult({ resultSchemaHash: hash, result: { schemaHash: hash, value: payload } });
  assert.equal(isRunPreviewSchemaHash(hash), true);
  assert.deepEqual(read(value), { kind: "dry-run-preview", externalCommit: "none",
    coverage: { state: "partial", boundaryNodeId: nodeId, reason: "historical-first-transaction-only" },
    steps: [{ nodeId, state: "transaction-preview", preview, samples: [] }] });
  assert.throws(() => read({ ...value, stoppedAtNodeId: "another-node" }));
});

it("recognizes terminal evidence under its issued hash and verifies its original owner", async () => {
  const f = await trustWorld();
  try {
    const failed = f.fail(f.create(1), 2);
    const current = f.database.authority.runResults.get(failed.envelope.runId);
    assert.ok(current);
    const hash = FingerprintSchema.parse("491980e23e4128e69e199f95f6a56ef735cc08e5419b2c5d587143e2621d18ec");
    const bound = { ...current.result, schemaHash: hash };
    const retained = RunResultRecordSchema.parse({ ...current, resultSchemaHash: hash, result: bound, resultDigest: deriveRunResultDigest(bound) });
    assert.deepEqual(terminalEvidenceResult(retained), current.result.value);
    assert.throws(() => RunResultRecordSchema.parse({ ...retained, attempt: retained.attempt + 1 }), /terminal failure evidence identity mismatch/);
  } finally {
    await f.dispose();
  }
});
