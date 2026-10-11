import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import {
buildRunEvidenceReceipt,
type ReceiptBuildInput
} from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunEvidenceReceiptSchema,type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { kualiReceiptEvidence,seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor,separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";


const MOVED_CLOSURE = "9".repeat(64);

const descriptor = separationsKualiFinalizationDescriptor;


function runUnderMovedClosure(patch: Readonly<{
  envelope?: Record<string, unknown>;
  inputParsed?: Record<string, unknown>;
}> = {}): unknown {
  const run = RunRecordSchema.parse(kualiReceiptEvidence().run);
  return {
    ...run,
    envelope: { ...run.envelope, contractFingerprint: MOVED_CLOSURE, ...(patch.envelope ?? {}) },
    input: { ...run.input, parsed: { ...run.input.parsed, ...(patch.inputParsed ?? {}) } },
  };
}

function receiptFrom(overrides: Partial<ReceiptBuildInput> = {}): RunEvidenceReceipt {
  return buildRunEvidenceReceipt({ descriptor, ...kualiReceiptEvidence(), ...overrides });
}

function refusalFor(overrides: Partial<ReceiptBuildInput>): string {
  try {
    receiptFrom(overrides);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the derivation was expected to refuse and did not");
}

/* ── (a) the stranded receipt: a moved closure re-derives byte-identically ── */

describe("receipt derivation binding — a moved closure does not strand a receipt", () => {
  it("stamps the closure the RUN executed under, never the build's", () => {
    const receipt = receiptFrom({ run: runUnderMovedClosure() });
    assert.equal(receipt.descriptorFingerprint, MOVED_CLOSURE);
    assert.notEqual(
      receipt.descriptorFingerprint,
      descriptor.contractFingerprint,
      "the receipt took the current build's closure, which is exactly the stranding defect",
    );
  });

  it("is still a pure function of authority under the moved closure", () => {
    assert.equal(
      canonicalJsonStringify(receiptFrom({ run: runUnderMovedClosure() })),
      canonicalJsonStringify(receiptFrom({ run: runUnderMovedClosure() })),
    );
  });
});

/* ── (b) a genuinely moved surface refuses, naming it ────────────────────── */

describe("receipt derivation binding — a moved surface refuses by name", () => {
  it("refuses a run from another workflow's graph", () => {
    const message = refusalFor({ descriptor: personLookupDescriptor });
    assert.match(message, /workflow-identity moved/);
    assert.match(message, /refusing to explain a run with another workflow's graph/);
    assert.match(message, /\[skip] {2}descriptor-version/, "a check that could not run was not reported as skipped");
    assert.doesNotMatch(message, /\[held] {2}descriptor-version/, "an unevaluated check was reported as held");
  });

  it("refuses a descriptor version the run was not planned under", () => {
    const message = refusalFor({ run: runUnderMovedClosure({ envelope: { descriptorVersion: 2 } }) });
    assert.match(message, /descriptor-version moved/);
    assert.match(message, /planned under v2 and this build declares v1/);
  });

  it("refuses when the canonical-input schema the snapshot binds has moved", () => {
    const message = refusalFor({
      run: runUnderMovedClosure({ inputParsed: { schemaHash: "d".repeat(64) } }),
    });
    assert.match(message, /canonical-input moved/);
    assert.match(message, /redacted under a declaration authored for a different shape/);
  });

  it("refuses when a node the run's durable evidence names left the graph", () => {
    const evidence = kualiReceiptEvidence();
    const first = evidence.checkpoints[0];
    assert.ok(first !== null && typeof first === "object", "the fixture must carry a checkpoint");
    const message = refusalFor({
      run: runUnderMovedClosure(),
      checkpoints: [...evidence.checkpoints, { ...first, nodeId: "retired-node" }],
    });
    assert.match(message, /evidence-graph moved/);
    assert.match(message, /checkpoint node "retired-node" left the graph/);
  });

  it("prints the whole check table with both fingerprints and no waiver", () => {
    const message = refusalFor({ run: runUnderMovedClosure({ envelope: { descriptorVersion: 2 } }) });
    assert.ok(message.includes(`${MOVED_CLOSURE.slice(0, 12)}…`), "the run's retained closure was not printed");
    assert.ok(
      message.includes(`${descriptor.contractFingerprint.slice(0, 12)}…`),
      "this build's closure was not printed",
    );
    assert.match(message, /\[held] {2}workflow-identity/, "held rows must be shown, not only the refusal");
    assert.doesNotMatch(message, /force|override|waive/iu, "a refusal must not advertise an escape hatch");
  });
});

/* ── (c) chunk 2's shape, through the real immutable insert ──────────────── */

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A stored receipt with one field replaced, re-parsed as authority would. */
function storedVariant(
  receipt: RunEvidenceReceipt,
  mutate: (draft: Record<string, unknown>) => void,
): RunEvidenceReceipt {
  const draft = JSON.parse(canonicalJsonStringify(receipt)) as Record<string, unknown>;
  mutate(draft);
  return RunEvidenceReceiptSchema.parse(draft);
}

describe("receipt derivation binding — the stored receipt survives a moved closure", () => {

  it("keeps divergent receipt sentences out of the service and HTTP divergence error", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-receipt-binding-http-"));
    roots.push(root);
    const database = AuthorityDatabase.open(
      { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "receipt-binding-http-test" },
      manualClock(new Date("2026-08-04T00:11:13.500Z")),
    );
    testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), { path: join(root, "state.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
    const seeded = seedPersonLookupExitRun(database);
    const runId = String(seeded.run.envelope.runId);
    const authority = database.authority;
    const result = authority.runResults.get(runId);
    assert.ok(result);
    const currentReceipt = buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: seeded.run,
      result,
      checkpoints: seeded.checkpoints,
      writes: [],
      gateResults: authority.gateResults.listByRun(runId),
    });
    const rawPermanentKey = "ucpath:termination|10812345|2026-08-29";
    const divergent = storedVariant(currentReceipt, (draft) => {
      const decisions = draft.decisions as Record<string, unknown>[];
      const first = decisions[0];
      assert.ok(first !== undefined, "the current fixture must carry a decision sentence");
      decisions[0] = { ...first, reason: `divergent permanent key ${rawPermanentKey}` };
    });
    authority.evidenceReceipts.insert(divergent);

    const service = createReceiptService({ database, runReader: createTrustRunReader(database), descriptors: [personLookupDescriptor] });
    let refusal: unknown;
    try {
      service.ensureReceipt(runId);
    } catch (error) {
      refusal = error;
    }
    assert.ok(refusal instanceof Error, "the divergent immutable receipt must refuse");
    assert.equal(refusal.message.includes(rawPermanentKey), false);
    assert.match(refusal.message, /decisions\[0\]\.reason/u);
    assert.match(refusal.message, /evidence digest [a-f0-9]{12}…/u);

    const projected = failureStatus(refusal);
    assert.equal(projected.status, 500);
    assert.equal(projected.body.code, "INTERNAL_FAILURE");
    assert.equal(JSON.stringify(projected.body).includes(rawPermanentKey), false);
    assert.match(String(projected.body.message), /evidence digest [a-f0-9]{12}…/u);
  });
});
