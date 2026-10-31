import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createRunTerminalEvidenceResult,deriveTerminalFailureDigest,RunResultRecordSchema } from "../../../../src/models/run/result.js";
import { projectReceiptForOperator } from "../../../../src/models/trust/evidence.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { failureRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";


function derive(run = kualiReceiptEvidence().run, result = kualiReceiptEvidence().result) {
  const evidence = kualiReceiptEvidence();
  return buildRunEvidenceReceipt({ descriptor: separationsKualiFinalizationDescriptor,
    run, result, checkpoints: evidence.checkpoints, writes: evidence.writes });
}

describe("durable receipt boundaries", () => {
  it("reopens complete composition-5 bytes from isolated SQLite and projects those exact facts", async () => {
    const profile = await createBoundProfileFixture();
    const options = { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unmasked-receipt-test" };
    const clock = manualClock(new Date("2026-09-29T12:00:00.000Z"));
    let database: AuthorityDatabase | undefined;
    try {
      const admission = profile.admission;
      database = AuthorityDatabase.open(admission, options, clock);
      database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      const base = RunRecordSchema.parse(kualiReceiptEvidence().run);
      const run = RunRecordSchema.parse({ ...base, envelope: { ...base.envelope,
        configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint } });
      const result = RunResultRecordSchema.parse({ ...RunResultRecordSchema.parse(kualiReceiptEvidence().result),
        configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint });
      const receipt = derive(run, result);
      const generation = database.getMeta().authorityGeneration;
      database.close();
      const raw = new DatabaseSync(options.path);
      try {
        const search = createRunSearchIndex(raw);
        search.installTracking();
        const row = runRecordColumns(run);
        raw.prepare(`INSERT INTO runs(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(()=>"?").join(",")})`).run(...Object.values(row));
        raw.prepare("INSERT INTO run_results(run_id,workflow,attempt,result_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
          .run(result.runId,result.workflowId,result.attempt,result.resultDigest,canonicalJsonStringify(result),result.createdAt);
        search.rebuild({ restart: true, limit: 500 }, generation, run.updatedAt);
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
      await profile.close();
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
    const { resultDigest: _resultDigest, schemaVersion: _schemaVersion, ...completion } = done.completion;
    const failed = RunRecordSchema.parse({ ...done,
      lifecycle: { ...done.lifecycle, outcome: "failed", failureId: failure.failureId },
      completion: { schemaVersion: 1, ...completion, kind: "failed", failureId: failure.failureId },
    });
    const input = { descriptor: separationsKualiFinalizationDescriptor, run: failed,
      result: createRunTerminalEvidenceResult(failed, { kind: "failed-evidence",
        authorization: { ...completion, kind: "failed", failureId: failure.failureId,
          runId: failed.envelope.runId, workflowId: failed.envelope.workflow, attempt: failed.envelope.attempt,
          descriptorVersion: failed.envelope.descriptorVersion, contractFingerprint: failed.envelope.contractFingerprint },
        failureDigest: deriveTerminalFailureDigest(failure) }),
      checkpoints: evidence.checkpoints, writes: evidence.writes, failure };
    const current = buildRunEvidenceReceipt(input);
    const currentWarning = current.warnings.find(warning => warning.code === failure.code);
    assert.ok(currentWarning?.summary.includes(failure.summary));

  });
});
