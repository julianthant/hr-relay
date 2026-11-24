import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeProfileAtStartup } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { parseBackupManifestFile } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { correctOcrField } from "../../../support/fixtures/ocr/source-pages.js";
import { restoreSchema40OcrSearchTerms } from "../../../support/fixtures/storage/historical-run-schema.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { scaledMs } from "../../../support/time-scale.js";

it("upgrades a stopped schema-40 profile and indexes the latest OCR review", async () => {
  const profile = await createBoundProfileFixture();
  const profileId = profile.admission.profileBinding.profileId;
  const world = createOcrReviewWorld(async () => profile);
  try {
    const before = "Example, Avery", after = "Example, Taylor", eid = "10800000";
    const f = await world.fixture({ record: true, lookupNames: [before], employeeIds: [eid] });
    const correction = f.command("correct-ocr-record", 1);
    assert.equal(f.canonical.kernel.execute(CommandRequestSchema.parse({ ...correction,
      payload: { ...correction.payload, fields: correctOcrField(f.reading.extraction, "employee.name", after), assertedEid: eid },
    })).state, "applied");
    assert.deepEqual(f.database.authority.runs.listNonTerminal(), []);
    const generation = f.database.getMeta().authorityGeneration;
    f.harness.authority.closeDatabase();
    profile.admission.release();

    const start = new DatabaseSync(f.path);
    let originalReviews;
    let originalFingerprint;
    try {
      restoreSchema40OcrSearchTerms(start);
      const inspection = inspectNativeAuthority(start, 40);
      assert.equal(inspection.schemaVersion, 40);
      originalFingerprint = inspection.authorityContentFingerprint;
      originalReviews = start.prepare("SELECT * FROM ocr_review_revisions ORDER BY id").all();
      assert.equal(originalReviews.length, 2);
    } finally { start.close(); }

    const result = await upgradeProfileAtStartup(profileBrowserClosure, profile.machine, profileId, { primaryDisplay: null }, f.clock);
    assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: 40, toSchemaVersion: 41, credentials: "unchanged" });
    const directory = join(profile.stateRoot, "backups", "authority");
    const [backup] = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
    assert.ok(backup);
    const manifest = parseBackupManifestFile(join(directory, backup));
    assert.equal(manifest.schemaVersion, 40);
    assert.equal(manifest.authorityContentFingerprint, originalFingerprint);

    using upgraded = new DatabaseSync(f.path, { readOnly: true });
    assert.equal(inspectNativeAuthority(upgraded).schemaVersion, 41);
    assert.deepEqual(upgraded.prepare("SELECT * FROM ocr_review_revisions ORDER BY id").all(), originalReviews);
    const index = createRunSearchIndex(upgraded);
    const find = (q: string) => index.search({ q, scope: "subject", facets: {}, limit: 20 }, generation).rows.map(row => row.record.envelope.runId);
    assert.deepEqual(find(before), []);
    assert.deepEqual(find(after), [f.run.envelope.runId]);
    assert.deepEqual(find(eid), [f.run.envelope.runId]);
  } finally { await world.cleanup(); }
}, scaledMs(60_000));
