import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { buildRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { PersonLookupCanonicalInput, PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const SYNTHETIC_SSN = "902481357";
const PRIOR_DIGEST = createHash("sha256")
  .update(`hrauto:redaction-digest:v1\0${JSON.stringify(SYNTHETIC_SSN)}`)
  .digest("hex");

function cancelMatch(fixture: Awaited<ReturnType<typeof trustWorld>>) {
  const raw = { mode: "match", lastName: "Example", firstName: "Avery", ssn: SYNTHETIC_SSN };
  const value = PersonLookupCanonicalInput.parse(PersonLookupInput.parse(raw));
  assert.ok(value.mode === "match" && value.ssn === SYNTHETIC_SSN);
  const queued = requireLifecycleApplied(fixture.service.create({
    commandId: uuidOf(1),
    code: personLookupDescriptor.code,
    matchKey: "synthetic-ssn-receipt",
    workflow: personLookupDescriptor.id,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
    resolvedInstance: { ucpath: "prod", crm: "prod" },
    priority: "interactive",
    shape: "single",
    dryRun: true,
    input: {
      raw,
      ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
      parsed: { value, schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"), protectedBindings: [] },
    },
    runtimeConfig: fixture.runtimeConfig,
  }));
  return fixture.cancel(queued, 2);
}

function storePriorReceipt(fixture: Awaited<ReturnType<typeof trustWorld>>, digest: string) {
  const run = cancelMatch(fixture);
  const { authority } = fixture.database;
  const receipt = buildRunEvidenceReceipt({
    descriptor: personLookupDescriptor,
    run,
    result: authority.runResults.get(run.envelope.runId),
    checkpoints: [],
  });
  assert.ok(receipt.input.some(fact => fact.state === "satisfied" && fact.field === "ssn"));
  const retained = authority.evidenceReceipts.insert({
    ...receipt,
    input: receipt.input.map(fact => fact.state === "satisfied" && fact.field === "ssn" ? {
      ...fact,
      value: { state: "transformed", classification: "direct-identifier", transform: "digest", key: "ssn", value: digest },
    } : fact),
  });
  assert.equal(retained.state, "inserted");
  return retained.record;
}

it("keeps the unkeyed SSN digest out of a persisted receipt", async () => {
  const fixture = await trustWorld();
  try {
    const runId = cancelMatch(fixture).envelope.runId;
    const receipt = fixture.receipts.ensure(runId);
    assert.equal(receipt.state, "derived");
    const stored = fixture.database.authority.evidenceReceipts.findByRun(runId);
    assert.deepEqual(stored, receipt.receipt);
    const bytes = JSON.stringify(stored);
    assert.equal(bytes.includes(SYNTHETIC_SSN), false, "the receipt must omit the raw SSN");
    assert.equal(bytes.includes(PRIOR_DIGEST), false, "the receipt must omit the unkeyed digest of the SSN");
    assert.deepEqual(fixture.receipts.ensure(runId), { state: "existing", receipt: stored });
  } finally {
    await fixture.dispose();
  }
});

it("reads a stored receipt from before the SSN redaction change", async () => {
  const fixture = await trustWorld();
  try {
    const retained = storePriorReceipt(fixture, PRIOR_DIGEST);
    assert.deepEqual(fixture.receipts.ensure(retained.runId), { state: "existing", receipt: retained });
  } finally {
    await fixture.dispose();
  }
});

it("refuses a retained SSN digest that differs from run authority", async () => {
  const fixture = await trustWorld();
  try {
    const retained = storePriorReceipt(fixture, "0".repeat(64));
    assert.throws(() => fixture.receipts.ensure(retained.runId), /declared-evidence moved[\s\S]*declared-redaction/u);
  } finally {
    await fixture.dispose();
  }
});
