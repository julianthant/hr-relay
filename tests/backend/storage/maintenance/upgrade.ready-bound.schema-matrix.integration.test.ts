import { assertUpgradedRunSettlementRows } from "../../../support/fixtures/storage/historical-run-schema.js";
import { prePreferencesSettingsRow } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";
import { insertMalformedLegacyOcrExtraction, historicalOcrExtractions } from "../../../support/fixtures/storage/ocr-extractions.js";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { upgradeProfileAtStartup, upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { hostFacts, readyBoundEight, rawEight } from "../../../support/helpers/storage/ready-bound-upgrade.js";

it.each([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const)("upgrades supported schema %s to the current version with exact source proof", async sourceVersion => {
  const f = await readyBoundEight("idle", sourceVersion);
  try {
    const before = rawEight(f.path);
    const result = await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: sourceVersion, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    const upgraded = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.ok(upgraded.prepare("PRAGMA table_info(runs)").all().some(column => column.name === "pause_state"));
      assert.equal(upgraded.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='trigger' AND name IN ('run_pause_insert','run_pause_update')").get()?.count, 2);
    } finally { upgraded.close(); }
    const after = rawEight(f.path);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, pause_state: null })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else if (table === "run_results" || table === "run_receipts") assertUpgradedRunSettlementRows(table, after[table] ?? [], before);
      else assert.deepEqual(after[table]?.map(row => sourceVersion < 16 ? prePreferencesSettingsRow(table, row) : { ...row }), rows.map(row => ({ ...row })));
    }
    const fresh = f.machine.admitProfile(f.binding.profileId);
    try { assert.equal(fresh.profileMaintenanceSchemaVersion(), CURRENT_AUTHORITY_SCHEMA_VERSION); }
    finally { fresh.release(); }
  } finally { await f.close(); }
});

it.each([11, 12] as const)('upgrades populated schema %s workbooks without replacing masters or claiming automatic revisions were operator versions', async version => {
  const f = await readyBoundEight('idle', version);
  const at = '2026-01-01T00:00:00.000Z';
  const first = { libraryId: 'migration-workbook', version: 1, createdAt: at, savedAt: at,
    workbook: { libraryId: 'migration-workbook', name: 'Before.xlsx', themes: [], hasFormulas: false,
      sheets: [{ id: 'sheet', name: 'People', width: 1, hidden: [], rows: [{ id: 'row', cells: [{ value: 'original' }] }] }] } };
  const second = { ...first, version: 2, workbook: { ...first.workbook, name: 'Master.xlsx' } };
  const raw = new DatabaseSync(f.path);
  try {
    raw.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(second.libraryId, 2, at, at, JSON.stringify(second));
    for (const record of [first, second]) raw.prepare('INSERT INTO workbook_library_history(workbook_id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, record.version, at, at, JSON.stringify(record));
    assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version);
  } finally { raw.close(); }
  try {
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock)).state, 'upgraded');
    const admission = f.machine.admitProfile(f.claim);
    try {
      const database = AuthorityDatabase.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: 'workbook-upgrade-proof' }, systemClock, undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: f.stateRoot }));
      try {
        assert.deepEqual(database.authority.workbooks.read(first.libraryId), second);
        assert.deepEqual(database.authority.workbooks.creation(first.libraryId), first);
        assert.deepEqual(database.authority.workbooks.versions(first.libraryId).map(({ name, provenance }) => ({ name, provenance })), [
          { name: 'Saved revision 1', provenance: 'migration' }, { name: 'Saved revision 2', provenance: 'migration' }]);
        assert.equal(database.authority.workbooks.metadata(first.libraryId).typeId, 'general');
        assert.equal(inspectAuthorityBackupReadOnly(admission, f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      } finally { database.close(); }
    } finally { admission.release(); }
  } finally { await f.close(); }
});

it("backs up schema-11 extraction evidence before conversion and retains both source states after restart", async () => {
  const f = await readyBoundEight("idle", 11, true);
  try {
    const extraction = donePage(sourceFixture(1).inputs[0]).output.extraction;
    const id = `${extraction.sourceSha256}#${extraction.sourcePage}#${extraction.formType}`;
    const before = rawEight(f.path).artifacts;
    assert.equal(before?.length, historicalOcrExtractions().length);
    await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    const restore = f.acquireRestore();
    try {
      const stopped = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
      try {
        const directory = join(f.stateRoot, "backups", "authority");
        const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
        assert.equal(manifests.length, 1);
        const backup = verifyStoppedBackupManifestAtPath(stopped, join(directory, manifests[0]));
        assert.equal(backup.manifest.schemaVersion, 11);
        const raw = new DatabaseSync(backup.backupPath, { readOnly: true });
        try { assert.deepEqual(raw.prepare("SELECT * FROM artifacts").all(), before); }
        finally { raw.close(); }
      } finally { stopped.release(); }
    } finally { restore.release(); }
    const admission = f.machine.admitProfile(f.claim);
    try {
      const credentials = createCredentialStore({ admission, stateRoot: f.stateRoot });
      const database = AuthorityDatabase.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
        undefined, undefined, undefined, credentials);
      try {
        assert.deepEqual(database.authority.ocrExtractions.get(id), { binding: "unbound-source", extractionId: id, extraction });
        for (const retained of historicalOcrExtractions()) {
          const extractionId = `${retained.sourceSha256}#${retained.sourcePage}#${retained.formType}`;
          assert.deepEqual(database.authority.ocrExtractions.get(extractionId), { binding: "unbound-source", extractionId, extraction: retained });
        }
        const reading = donePage(sourceFixture(1).inputs[0]).output;
        assert.equal(database.authority.ocrExtractions.insert(reading).state, "inserted");
        assert.deepEqual(database.authority.ocrExtractions.findBySource(extraction.sourceSha256).map(record => record.binding).sort(),
          ["source-bound", ...historicalOcrExtractions().map(() => "unbound-source")]);
      } finally { database.close(); }
    } finally { admission.release(); }
    const restarted = f.machine.admitProfile(f.claim);
    try {
      const database = AuthorityDatabase.open(restarted, { path: f.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
        undefined, undefined, undefined, createCredentialStore({ admission: restarted, stateRoot: f.stateRoot }));
      try { assert.equal(database.authority.ocrExtractions.findBySource(extraction.sourceSha256).length, historicalOcrExtractions().length + 1); }
      finally { database.close(); }
    } finally { restarted.release(); }
  } finally { await f.close(); }
});

it.each(["artifact-id", "source-column", "payload"] as const)("refuses a stopped schema-11 OCR upgrade with malformed %s without changing source bytes or identity", async fault => {
  const f = await readyBoundEight("idle", 11, true);
  try {
    const raw = new DatabaseSync(f.path);
    try { insertMalformedLegacyOcrExtraction(raw, fault); } finally { raw.close(); }
    const rows = rawEight(f.path), sourceBytes = readFileSync(f.path);
    const before = storageTree(f.stateRoot), machineBefore = storageTree(join(f.machine.stateRoot, "machine"));
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      /authority table artifacts failed native record validation/u);
    assert.deepEqual(rawEight(f.path), rows);
    assert.deepEqual(readFileSync(f.path), sourceBytes);
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.deepEqual(storageTree(join(f.machine.stateRoot, "machine")), machineBefore);
    const unchanged = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.equal(unchanged.prepare("PRAGMA user_version").get()?.user_version, 11);
      assert.equal(unchanged.prepare("SELECT schema_version FROM database_states").get()?.schema_version, 11);
    } finally { unchanged.close(); }
  } finally { await f.close(); }
});

it.each(([17, 18] as const).flatMap(version => (["run", "terminal-run", "plan", "consumed-plan"] as const).map(owner => ({ version, owner }))))(
  "refuses schema $version incompatible $owner references without changing authority", async ({ version, owner }) => {
    const f = await readyBoundEight(owner.includes("run") ? "queued" : "idle", version, false, { owner, schemaHash: "a".repeat(64) });
    try {
      const bytes = readFileSync(f.path), before = rawEight(f.path, version);
      await assert.rejects(owner === "run"
        ? upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, systemClock)
        : upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock), /workbook_reference_schema_upgrade_unproved/u);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.deepEqual(rawEight(f.path, version), before);
      const raw = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, version);
        assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version);
        assert.equal(raw.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='workbook_reference_upgrade_guard'").get()?.count, 0);
      } finally { raw.close(); }
    } finally { await f.close(); }
});
