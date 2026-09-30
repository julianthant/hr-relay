import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { FailureRecordSchema } from "../../src/domain/trust/failure.js";
import { failureRecordOf } from "./server/helpers/dashboard-harness.js";
import { manualClock } from "../../src/domain/clock.js";
import { projectReceiptForOperator } from "../../src/domain/trust/evidence.js";
import { ArchivedRunContentSchema } from "../../src/domain/archive/model.js";
import { ARCHIVED_RUN_WITH_SECTIONS } from "../fixtures/archive-fixtures.js";
import { describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../src/core/evidence-receipt.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { kualiReceiptEvidence } from "../fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../helpers/registered-workflows.js";
import { DataClassificationSchema, redactDiagnosticFields, redactValue, RedactedValueSchema } from "../../src/domain/redaction.js";

describe("D358 complete classified evidence", () => {
  it.each(DataClassificationSchema.options)("retains the supplied %s value without a presentation transform", classification => {
    const value = { text: "synthetic-complete-value", nested: ["synthetic-identifier", 17] };
    const requested = classification === "safe-diagnostic" ? "count" : "drop";
    assert.deepEqual(redactValue(classification, requested, value), {
      state: "allowed", classification, transform: "allow", value,
    });
    assert.deepEqual(redactDiagnosticFields([{ key: "captured", classification, transform: requested, value }]), {
      fields: [{ key: "captured", state: "allowed", classification, transform: "allow", value }], warnings: [],
    });
  });

  it("keeps historical transformed and dropped records readable without inventing their source", () => {
    assert.deepEqual(RedactedValueSchema.parse({ state: "redacted", classification: "secret", transform: "drop" }), {
      state: "redacted", classification: "secret", transform: "drop",
    });
    assert.deepEqual(RedactedValueSchema.parse({ state: "transformed", classification: "direct-identifier", transform: "last4", value: "1234" }), {
      state: "transformed", classification: "direct-identifier", transform: "last4", value: "1234",
    });
  });
});


const historicalDigests = [
  "1d698f9f0326bef4de3f0386a9011127ee43cc0a4aecb2662f24cb941684ff38",
  "745636ecbf0b7a0671f5b9c5d8afdcd52ade1202886156495f15647290eb28cc",
  "7bcc88e2eb2b755b5dc3583ec5fb5da34fdb1b96a0f0798cde1fd5c547798eb2",
  "bbd2797e6dde6e6182b6c452b1a63fcd29f555bfb5fdd39721f7ad7abc612812",
];

function derive(composition: 1 | 2 | 3 | 4 | 5) {
  const evidence = kualiReceiptEvidence({ contractFingerprint: "30164dc81af7ded8c9d330308710f0c4af24c982c5c7ec9207f2aa336a468154" });
  return buildRunEvidenceReceipt({ descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run, result: evidence.result, checkpoints: evidence.checkpoints, writes: evidence.writes,
  }, composition);
}

describe("D358 receipt composition", () => {
  it.each([1, 2, 3, 4] as const)("preserves exact composition %i bytes frozen from the pre-amendment source", composition => {
    assert.equal(sha256Hex(canonicalJsonStringify(derive(composition))), historicalDigests[composition - 1]);
  });

  it("derives new composition 5 with complete classified facts and stable evidence references", () => {
    const historical = derive(4);
    const current = derive(5);
    assert.equal(current.composition, 5);
    assert.equal(current.receiptId, historical.receiptId);
    assert.deepEqual(current.observations.map(fact => fact.id), historical.observations.map(fact => fact.id));
    assert.ok(current.observations.length > 0);
    const valued = current.observations.filter(fact => fact.state === "satisfied");
    assert.ok(valued.length > 0);
    for (const fact of valued) {
      assert.equal(fact.state, "satisfied");
      assert.ok(fact.state === "satisfied");
      assert.equal(fact.value.state, "allowed");
      assert.equal(fact.value.transform, "allow");
      assert.equal(fact.value.rawValue, undefined);
      const old = historical.observations.find(candidate => candidate.id === fact.id);
      assert.ok(fact.value.state === "allowed");
      assert.ok(old?.state === "satisfied");
      assert.deepEqual(fact.value.value, old.value.rawValue);
      assert.equal(fact.value.classification, old.value.classification);
    }
    const proof = current.actions.find(action => action.kind === "commit")?.proved;
    assert.ok(proof);
    assert.notEqual(proof.idempotencyKeyDigest, "withheld-protected-input");
    assert.ok(proof.values.every(value => value.state === "allowed" && value.transform === "allow"));
  });
});

describe("D358 durable receipt boundaries", () => {
  it("reopens complete composition-5 bytes from isolated SQLite and projects those exact facts", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-unmasked-receipt-"));
    const options = { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unmasked-receipt-test" };
    const clock = manualClock(new Date("2026-09-29T12:00:00.000Z"));
    let database: AuthorityDatabase | undefined;
    try {
      const receipt = derive(5);
      database = AuthorityDatabase.open(options, clock);
      const run = RunRecordSchema.parse(kualiReceiptEvidence().run);
      const { completion: _completion, ...queued } = run;
      database.authority.runs.enqueue({ ...queued, lifecycle: { state: "queued" } });
      database.authority.evidenceReceipts.insert(receipt);
      database.close();
      database = AuthorityDatabase.open(options, clock);
      const reopened = database.authority.evidenceReceipts.get(receipt.receiptId);
      assert.deepEqual(reopened, receipt);
      const projected = projectReceiptForOperator(reopened);
      assert.ok(projected.state === "available");
      assert.deepEqual(projected.value, receipt);
    } finally {
      database?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits composition 5 through current archive readers without changing receipt bytes", () => {
    const receipt = derive(5);
    const base = ARCHIVED_RUN_WITH_SECTIONS;
    assert.ok(base.sections?.logs.state === "present");
    const { contentDigest: _digest, ...content } = base;
    const archived = ArchivedRunContentSchema.parse({ ...content,
      archiveSchemaGeneration: 6,
      workflowCode: { state: "present", value: "pl" },
      row: { ...base.row, session: { state: "absent", reason: "fixture has no session" } },
      sections: { ...base.sections, logs: { state: "present", value: { ...base.sections.logs.value, notes: [], rows: [] } } },
      receipt: { state: "present", value: receipt },
    });
    assert.ok(archived.receipt.state === "present");
    assert.equal(canonicalJsonStringify(archived.receipt.value), canonicalJsonStringify(receipt));
  });
});

describe("D358 supplied failure diagnostics", () => {
  it("retains complete supplied failure summary only in new composition 5", () => {
    const evidence = kualiReceiptEvidence();
    const done = RunRecordSchema.parse(evidence.run);
    assert.ok(done.lifecycle.state === "terminal" && done.completion?.kind === "done");
    const failure = FailureRecordSchema.parse({ ...failureRecordOf({ seed: 984, code: "SUBJECT_MISMATCH" }),
      runId: done.envelope.runId, traceId: done.envelope.traceId, workflowId: done.envelope.workflow,
      summary: "synthetic complete diagnostic for identifier 10800001 and transaction T1234567",
    });
    const { resultDigest: _resultDigest, ...completion } = done.completion;
    const failed = RunRecordSchema.parse({ ...done,
      lifecycle: { ...done.lifecycle, outcome: "failed", failureId: failure.failureId },
      completion: { ...completion, kind: "failed", failureId: failure.failureId },
    });
    const input = { descriptor: separationsKualiFinalizationDescriptor, run: failed,
      checkpoints: evidence.checkpoints, writes: evidence.writes, failure };
    const current = buildRunEvidenceReceipt(input, 5);
    const historical = buildRunEvidenceReceipt(input, 4);
    const currentWarning = current.warnings.find(warning => warning.code === failure.code);
    const historicalWarning = historical.warnings.find(warning => warning.code === failure.code);
    assert.ok(currentWarning?.summary.includes(failure.summary));
    assert.ok(historicalWarning);
    assert.ok(historicalWarning.summary.includes("Free diagnostic text remains in authority"));
    assert.ok(!historicalWarning.summary.includes(failure.summary));
  });
});
