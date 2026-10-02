import { historicalFixture, withHistoricalAuthority } from "./helpers/historical-fixtures.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { NOW } from "../../helpers/database-foundation/fixtures.js";
import { ARCHIVE_RELAUNCH } from "../../fixtures/archive-fixtures.js";
import { createRunLifecycleStorage } from "../../../src/backend/storage/run-lifecycle-storage.js";
import { convertHistoricalArchives } from "../../../src/backend/storage/archive-transfer.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";

for (const step of ["captured", "verified", "cleaned", "published"] as const) it(`converts populated historical sources and resumes ${step} with original identities and custody`, () => {
  const f = historicalFixture();
  try {
    const bundle = withHistoricalAuthority(f, database => createRunLifecycleStorage(database).historicalArchiveSource());
    const original = canonicalJsonStringify(bundle);
    const transactions = bundle.source.archives[0].source.records.find(group => group.table === "archive_transactions");
    assert.ok(transactions?.rows.length);
    assert.ok(transactions.rows[0].json.includes("ucpath"), "populated immutable transaction supplement survives inspection");
    assert.equal(bundle.source.archives[0].source.records.find(group => String(group.table) === "archive_relaunches"), undefined);
    assert.throws(() => withHistoricalAuthority(f, database => convertHistoricalArchives(createRunLifecycleStorage(database), bundle, NOW, (_runId, at) => { if (at === step) throw new Error("conversion-interrupted"); })), /conversion-interrupted/u);
    withHistoricalAuthority(f, database => {
    const storage = createRunLifecycleStorage(database);
    const result = convertHistoricalArchives(storage, bundle, NOW);
    assert.equal(canonicalJsonStringify(bundle), original);
    assert.deepEqual(result.retainedVersionSources, { plans: bundle.source.plans, applications: bundle.source.applications });
    assert.deepEqual(convertHistoricalArchives(storage, bundle, NOW), result);
    const report = storage.readReport(f.run.envelope.runId); assert.ok(report);
    assert.equal(report.content.sources[0].json, canonicalJsonStringify(bundle.source.archives[0].source));
    assert.deepEqual(storage.readFile(f.run.envelope.runId, f.file.file.digest).bytes, f.file.bytes);
    assert.equal(database.authority.runs.get(f.run.envelope.runId), undefined);
    assert.equal(database.authority.deletedRuns.get(f.run.envelope.runId), undefined);
    assert.ok(database.authority.runs.get(ARCHIVE_RELAUNCH.runId));
    assert.ok(result.dispositions.some(value => value.includes("L")));
    });
  } finally { f.dispose(); }
});

it("refuses corrupted bundles and inconsistent historical pairs before source removal, then converts the valid bundle", () => {
  const f = historicalFixture();
  try {
    withHistoricalAuthority(f, database => {
    const storage = createRunLifecycleStorage(database), bundle = storage.historicalArchiveSource();
    assert.throws(() => convertHistoricalArchives(storage, { ...bundle, digest: "0".repeat(64) }, NOW), /source-digest-mismatch/u);
    const source = { ...bundle.source, applications: bundle.source.applications.map(value => ({ ...value, targetVersion: "9.0.0" })) };
    assert.throws(() => convertHistoricalArchives(storage, { source, digest: sha256Hex(canonicalJsonStringify(source)) }, NOW), /pair-mismatch/u);
    assert.ok(database.authority.runs.get(f.run.envelope.runId));
    assert.equal(database.transferredRun(f.run.envelope.runId), undefined);
    assert.equal(convertHistoricalArchives(storage, bundle, NOW).reports.length, 1);
    });
  } finally { f.dispose(); }
});
