import { DatabaseSync } from "node:sqlite";
import { runRecordColumns } from "../../../../../../src/backend/storage/sqlite/run-record-row.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { RunResultRecordSchema } from "../../../../../../src/models/run/result.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { CONFIG_SNAPSHOT } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { FailureRecordSchema } from "../../../../../../src/models/trust/failure.js";
import { failureRecordOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { projectReceiptForOperator } from "../../../../../../src/models/trust/evidence.js";
import { describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../../../../src/backend/runs/provenance/evidence-receipt.js";
import { kualiReceiptEvidence } from "../../../../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { DataClassificationSchema, redactDiagnosticFields, retainLocalEvidenceValue } from "../../../../../../src/rules/redaction/redaction.js";

describe("complete classified evidence", () => {
  it.each(DataClassificationSchema.options)("retains the supplied %s value without a presentation transform", classification => {
    const value = { text: "synthetic-complete-value", nested: ["synthetic-identifier", 17] };
    const requested = classification === "safe-diagnostic" ? "count" : "drop";
    assert.deepEqual(retainLocalEvidenceValue(classification, requested, value), {
      state: "allowed", classification, transform: "allow", value,
    });
    assert.deepEqual(redactDiagnosticFields([{ key: "captured", classification, transform: requested, value }]), {
      fields: [{ key: "captured", state: "allowed", classification, transform: "allow", value }], warnings: [],
    });
  });


});


function derive(run = kualiReceiptEvidence().run, result = kualiReceiptEvidence().result) {
  const evidence = kualiReceiptEvidence();
  return buildRunEvidenceReceipt({ descriptor: separationsKualiFinalizationDescriptor,
    run, result, checkpoints: evidence.checkpoints, writes: evidence.writes });
}

describe("durable receipt boundaries", () => {
  it("reopens complete composition-5 bytes from isolated SQLite and projects those exact facts", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-unmasked-receipt-"));
    const options = { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unmasked-receipt-test" };
    const clock = manualClock(new Date("2026-09-29T12:00:00.000Z"));
    let database: AuthorityDatabase | undefined;
    try {
      const admission = RuntimeAdmission.syntheticFixture(options.path);
      database = AuthorityDatabase.open(admission, options, clock);
      database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      const base = RunRecordSchema.parse(kualiReceiptEvidence().run);
      const run = RunRecordSchema.parse({ ...base, envelope: { ...base.envelope,
        configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint } });
      const result = RunResultRecordSchema.parse({ ...RunResultRecordSchema.parse(kualiReceiptEvidence().result),
        configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint });
      const receipt = derive(run, result);
      database.close();
      const raw = new DatabaseSync(options.path);
      try {
        const row = runRecordColumns(run);
        raw.prepare(`INSERT INTO runs(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(()=>"?").join(",")})`).run(...Object.values(row));
        raw.prepare("INSERT INTO run_results(run_id,workflow,attempt,result_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
          .run(result.runId,result.workflowId,result.attempt,result.resultDigest,canonicalJsonStringify(result),result.createdAt);
      } finally { raw.close(); }
      database = AuthorityDatabase.open(admission, options, clock);
      database.authority.evidenceReceipts.insert(receipt);
      database.close();
      database = AuthorityDatabase.open(admission, options, clock);
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


});

describe("supplied failure diagnostics", () => {
  it("retains the complete supplied failure summary in current receipts", () => {
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
    const current = buildRunEvidenceReceipt(input);
    const currentWarning = current.warnings.find(warning => warning.code === failure.code);
    assert.ok(currentWarning?.summary.includes(failure.summary));

  });
});
