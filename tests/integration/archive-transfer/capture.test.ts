import { ProviderRequestStorageSchema, ProviderUsageStorageSchema } from "../../../src/domain/provider-accounting.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture, NOW, id } from "../../unit/database-foundation/fixtures.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { captureArchiveReport } from "../../../src/backend/storage/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";
import { projectArchiveReport } from "../../../src/backend/runs/dashboard/queries/archive-reports.js";
import { ArchiveFileReferenceSchema, ArchiveReportSchema } from "../../../src/domain/archive/report.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";

it("freezes stamped and adopted runtime versions while old reports keep no recorded version", () => {
  const f = foundationFixture();
  try {
    f.db.authority.runs.transition({ runId: f.run.envelope.runId, expectedVersion: f.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
    const snapshot = createRunLifecycleStorage(f.db).capture(f.run.envelope.runId);
    const stamp = { dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 2 } };
    const stamped = captureArchiveReport({ snapshot: { ...snapshot,
      run: RunRecordSchema.parse({ ...snapshot.run, runtimeVersion: stamp }),
    }, transferId: id(9308), capturedAt: NOW, files: [], sections: [] });
    assert.equal(stamped.content.schemaVersion, 2);
    assert.deepEqual(stamped.content.runtimeVersion, { state: "stamped", ...stamp });
    const adopted = captureArchiveReport({ snapshot, adoptedRuntimeVersion: stamp,
      transferId: id(9309), capturedAt: NOW, files: [], sections: [] });
    assert.equal(adopted.content.runtimeVersion?.state, "adopted");
    assert.equal(captureArchiveReport({ snapshot, transferId: id(9310), capturedAt: NOW,
      files: [], sections: [] }).content.schemaVersion, 1);
    assert.equal(projectArchiveReport(stamped).state, "available");
    assert.throws(() => captureArchiveReport({ snapshot: { ...snapshot,
      run: RunRecordSchema.parse({ ...snapshot.run, runtimeVersion: stamp }),
    }, adoptedRuntimeVersion: stamp, transferId: id(9311), capturedAt: NOW,
    files: [], sections: [] }), /attribution-conflict/u);
  } finally { f.dispose(); }
});

it("captures every source group as generic typed values or explicit absence, with separate source integrity", () => {
  const f = foundationFixture();
  try {
    f.db.authority.runs.transition({ runId: f.run.envelope.runId, expectedVersion: f.run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
    const storage = createRunLifecycleStorage(f.db);
    const snapshot = storage.capture(f.run.envelope.runId);
    const report = captureArchiveReport({ snapshot, transferId: id(9301), capturedAt: NOW, files: [], sections: [] });
    const inputSection = report.content.sections.find(section => section.title === "Inputs & settings");
    assert.equal(inputSection?.kind, "values");
    if (inputSection?.kind !== "values") throw new Error("frozen inputs section missing");
    assert.deepEqual(inputSection.values.map(row => row.label), ["Run mode", "Submitted input", "Parsed input", "Captured settings"]);
    assert.equal(inputSection.values.find(row => row.label === "Run mode")?.value, snapshot.run.envelope.dryRun ? "Dry run" : "Live run");
    for (const [dryRun, expected] of [[true, "Dry run"], [false, "Live run"]] as const) {
      const modeReport = captureArchiveReport({ snapshot: { ...snapshot, run: RunRecordSchema.parse({
        ...snapshot.run, envelope: { ...snapshot.run.envelope, dryRun },
      }) }, transferId: id(dryRun ? 9351 : 9352), capturedAt: NOW, files: [], sections: [] });
      const modeSection = modeReport.content.sections.find(section => section.title === "Inputs & settings");
      assert.equal(modeSection?.kind === "values" ? modeSection.values.find(row => row.label === "Run mode")?.value : undefined, expected);
    }
    assert.ok(inputSection.values.find(row => row.label === "Submitted input")?.value);
    assert.ok(inputSection.values.find(row => row.label === "Parsed input")?.value);
    assert.equal(JSON.stringify(inputSection).includes("10873698"), false, "protected input stays out of the public section");
    const settingsSource = snapshot.records.find(group => group.table === "settings_snapshots")?.rows[0];
    const capturedSettings = inputSection.values.find(row => row.label === "Captured settings")?.value;
    if (settingsSource === undefined) assert.deepEqual(capturedSettings, { state: "unavailable", reason: "No settings snapshot was retained for this run" });
    else {
      const stored = JSON.parse(settingsSource.json) as { config: unknown };
      assert.deepEqual(capturedSettings, stored.config);
      assert.equal(JSON.stringify(capturedSettings).includes("configSnapshotId"), false);
    }
    assert.equal(snapshot.records.length, 24);
    assert.equal(snapshot.records.some(group => group.table === "archive_relaunches"), false);
    for (const group of snapshot.records) assert.equal(report.content.sections.find(section => section.title === group.table)?.kind, group.rows.length ? "values" : "unavailable");
    assert.notEqual(report.digest, report.content.sourceDigest);
    assert.throws(() => ArchiveReportSchema.parse({ ...report, content: { ...report.content, sources: [{ ...report.content.sources[0], json: '{}' }] } }), /digest-mismatch/u);
    assert.throws(() => projectArchiveReport({ ...report, content: { ...report.content, title: "corrupt" } }), /digest-mismatch/u);
    const unpublished = projectArchiveReport(report);
    assert.equal("publicationState" in unpublished, false);
    assert.equal("reportIntegrity" in unpublished, false);
    transferArchiveReport(storage, report, snapshot.run.version);
    const publishedReport = storage.readReport(report.content.runId);
    assert.ok(publishedReport);
    f.db.close();
    const publicReport = projectArchiveReport(publishedReport);
    assert.equal(publicReport.state, "available", "generic viewing requires no live database or descriptor");
    if (publicReport.state !== "available") throw new Error("expected projected report");
    assert.equal(publicReport.transferId, report.content.transferId);
    assert.equal(publicReport.itemId, report.content.itemId);
    assert.equal(publicReport.attempt, report.content.attempt);
    assert.equal(publicReport.runNumber, report.content.runNumber);
    assert.equal(publicReport.publicationState, "published");
    assert.equal(publicReport.reportIntegrity, "verified");
    assert.notEqual(publicReport.archiveFingerprint, report.digest);
    assert.equal("sources" in projectArchiveReport(report), false);
    assert.equal("sourceDigest" in publicReport, false);
    assert.equal("digest" in publicReport, false);
  } finally { f.dispose(); }
});

it("seals a public run summary and only exact retained artifact relationships", () => {
  const f = foundationFixture();
  try {
    f.db.authority.runs.transition({ runId: f.run.envelope.runId, expectedVersion: f.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
    const snapshot = createRunLifecycleStorage(f.db).capture(f.run.envelope.runId);
    const artifactId = id(9381);
    const receipt = RunEvidenceReceiptSchema.parse({
      composition: 4, receiptId: id(9382), runId: f.run.envelope.runId, traceId: f.run.envelope.traceId,
      workflowId: f.run.envelope.workflow, attempt: f.run.envelope.attempt, generatedAt: NOW,
      descriptorFingerprint: f.run.envelope.contractFingerprint, configFingerprint: f.run.envelope.configFingerprint,
      retryOf: { state: "absent" }, failure: { state: "absent" }, input: [], observations: [], decisions: [],
      actions: [{ id: id(9383), taskId: "ucpath/search-person-org", kind: "local-projection", writeState: "not-attempted", artifactId, occurredAt: NOW }],
      verification: [], output: [], reuse: [], warnings: [], confidence: "unknown", result: "cancelled",
    });
    const records = snapshot.records.map(group => group.table === "run_receipts"
      ? { ...group, rows: [{ key: receipt.receiptId, json: JSON.stringify(receipt) }] } : group);
    const file = ArchiveFileReferenceSchema.parse({ name: "Synthetic note.txt", digest: "a".repeat(64), byteLength: 12, mediaType: "text/plain", artifactIds: [artifactId] });
    const report = captureArchiveReport({ snapshot: { ...snapshot, records }, transferId: id(9384), capturedAt: NOW, files: [file], sections: [] });
    const summary = report.content.sections.find(section => section.title === "Run summary");
    assert.equal(summary?.kind, "values");
    if (summary?.kind !== "values") throw new Error("run summary absent");
    assert.equal(summary.values.find(row => row.label === "Verification result")?.value, "Cancelled");
    assert.equal(summary.values.find(row => row.label === "Queued")?.value, snapshot.run.envelope.enqueuedAt);
    assert.equal(summary.values.find(row => row.label === "Completed")?.value, NOW);
    assert.equal(summary.values.find(row => row.label === "Total elapsed")?.value, Date.parse(NOW) - Date.parse(snapshot.run.envelope.enqueuedAt));
    assert.equal(summary.values.find(row => row.label === "Attempt")?.value, f.run.envelope.attempt);
    const links = report.content.sections.find(section => section.title === "Retained file relationships");
    assert.equal(links?.kind, "values");
    if (links?.kind !== "values") throw new Error("file relationships absent");
    assert.deepEqual(links.values, [{ label: file.digest, value: { taskId: "ucpath/search-person-org", actionId: id(9383) } }]);
    const duplicateRows = records.map(group => group.table === "run_receipts"
      ? { ...group, rows: [...group.rows, { key: id(9387), json: JSON.stringify({ ...receipt, receiptId: id(9387) }) }] } : group);
    const duplicateReport = captureArchiveReport({ snapshot: { ...snapshot, records: duplicateRows }, transferId: id(9388), capturedAt: NOW, files: [file], sections: [] });
    const duplicateSummary = duplicateReport.content.sections.find(section => section.title === "Run summary");
    assert.equal(duplicateSummary?.kind === "values" ? duplicateSummary.values.find(row => row.label === "Verification result")?.value : undefined,
      "Unavailable: multiple receipts retained");
    assert.equal(duplicateReport.content.sections.some(section => section.title === "Retained file relationships"), false);
    const publicReport = projectArchiveReport(report);
    assert.equal(publicReport.state, "available");
    if (publicReport.state !== "available") throw new Error("public report absent");
    assert.deepEqual(publicReport.sections.find(section => section.title === "Run summary"), summary);
    const unmatched = captureArchiveReport({ snapshot: { ...snapshot, records }, transferId: id(9385), capturedAt: NOW,
      files: [{ ...file, artifactIds: [id(9386)] }], sections: [] });
    assert.equal(unmatched.content.sections.some(section => section.title === "Retained file relationships"), false);
  } finally { f.dispose(); }
});

it("withholds protected values in inputs and repeated display text while retaining private originals", () => {
  const f = foundationFixture();
  try {
    const binding = { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: id(9302) } as const;
    const snapshot = createRunLifecycleStorage(f.db).capture(f.run.envelope.runId);
    snapshot.run = RunRecordSchema.parse({ ...snapshot.run, input: { ...snapshot.run.input, parsed: { ...snapshot.run.input.parsed, protectedBindings: [binding] } },
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    snapshot.records = snapshot.records.filter(group => group.table !== "workflow_runs");
    const secret = "10873698";
    const report = captureArchiveReport({ snapshot, transferId: id(9303), capturedAt: NOW, files: [],
      sections: [{ kind: "text", title: "Note", text: `Observed ${secret}` }] });
    assert.ok(report.content.sources[0].json.includes(secret));
    assert.equal(JSON.stringify(projectArchiveReport(report)).includes(secret), false);
    assert.equal("sourceDigest" in projectArchiveReport(report), false);
  } finally { f.dispose(); }
});

import { sha256Hex } from "../../../src/domain/sha256.js";
it("public display identity does not encode a changed protected value or its derived digest", () => {
  const f = foundationFixture();
  try {
    const base = createRunLifecycleStorage(f.db).capture(f.run.envelope.runId);
    const make = (secret: string) => {
      const snapshot = { ...base, records: [], run: RunRecordSchema.parse({ ...base.run,
        displayName: `Result ${secret}`, input: { ...base.run.input, raw: { emplId: secret }, parsed: { ...base.run.input.parsed, value: { emplId: secret } } },
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }) };
      return captureArchiveReport({ snapshot, transferId: id(9370), capturedAt: NOW, files: [], sections: [
        { kind: "values", title: "Captured keys", values: [{ label: "businessKeyDigest", value: sha256Hex(`salt:${secret}`) }] },
        { kind: "text", title: "Log", text: `Subject ${secret}; digest ${sha256Hex(secret)}` },
      ] });
    };
    const first = make("10873698"), second = make("10999999");
    assert.notEqual(first.digest, second.digest);
    assert.notEqual(first.content.sourceDigest, second.content.sourceDigest);
    assert.deepEqual(projectArchiveReport(first), projectArchiveReport(second));
  } finally { f.dispose(); }
});


import { generic } from "../../unit/provider-accounting/fixtures.js";
it("captures generic provider requests and their allocated usage without unrelated shared accounting", () => {
  const f = foundationFixture();
  try {
    const { request, usage } = generic(f);
    f.db.authority.providerAccounting.transaction(store => { store.writeRequest(request, null); store.writeUsage(usage, null); store.writeUsage({ ...usage, usageId: "unrelated-usage", scope: { ...usage.scope, id: "unrelated.scope" } }, null); });
    const snapshot = createRunLifecycleStorage(f.db).capture(f.run.envelope.runId);
    const requests = snapshot.records.find(group => group.table === "provider_requests");
    const usages = snapshot.records.find(group => group.table === "provider_usage");
    assert.deepEqual(requests?.rows.map(row => ProviderRequestStorageSchema.parse(JSON.parse(row.json))), [request]);
    assert.deepEqual(usages?.rows.map(row => ProviderUsageStorageSchema.parse(JSON.parse(row.json))), [usage]);
  } finally { f.dispose(); }
});
