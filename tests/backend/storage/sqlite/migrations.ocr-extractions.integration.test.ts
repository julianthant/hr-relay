import { AUTHORITY_DERIVED_TABLES } from "../../../../src/models/config/authority.js";
import { encodeSavedWorkbook } from "../../../../src/models/dashboard/workbooks.js";
import { createWorkbookLibraryRepository } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { extractedArtifactFromRow } from "../../../../src/backend/storage/sqlite/extracted-artifact-row.js";
import { insertMalformedLegacyOcrExtraction, historicalOcrExtractions, insertUnboundOcrExtraction } from "../../../support/fixtures/storage/ocr-extractions.js";
import { donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";

it("converts every supported source layout to explicit unbound evidence without inventing PDF or reading provenance", () => {
  for (let version = 1; version < CURRENT_AUTHORITY_SCHEMA_VERSION; version++) {
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= version)) for (const statement of migration.statements) database.exec(statement);
      const extractions = historicalOcrExtractions();
      const stored = extractions.map(extraction => insertUnboundOcrExtraction(database, extraction, version < 12));
      const extraction = extractions[0];
      assert.ok(extraction);
      const columns = version < 7 ? "(id,schema_version,authority_generation,updated_at,search_generation,search_state)"
        : "(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id)";
      database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=${version}`);
      const values = [1, version, 0, extraction.readAt, null, "unbuilt", ...(version < 7 ? [] : ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])];
      database.prepare(`INSERT INTO database_states ${columns} VALUES (${values.map(() => "?").join(",")})`).run(...values);
      assert.equal(inspectNativeAuthority(database, version).schemaVersion, version);
      assert.throws(() => inspectNormalAuthority(database), /normal-authority-schema-mismatch/u);
      const before = database.prepare("SELECT * FROM artifacts ORDER BY id").all();
      assert.equal(before.length, extractions.length);
      const remaining = SQLITE_MIGRATIONS.filter(value => value.version > version).flatMap(migration => migration.statements);
      database.exec("BEGIN EXCLUSIVE");
      for (const statement of remaining) database.exec(statement);
      database.exec("ROLLBACK");
      assert.deepEqual(database.prepare("SELECT * FROM artifacts ORDER BY id").all(), before);
      if (version < 12) for (const row of before) assert.throws(() => extractedArtifactFromRow(row));
      else assert.deepEqual(before.map(extractedArtifactFromRow), [...stored].sort((a, b) => a.extractionId.localeCompare(b.extractionId)));
      database.exec("BEGIN EXCLUSIVE");
      for (const statement of remaining) database.exec(statement);
      if (version < 7) {
        database.prepare("INSERT INTO database_states VALUES (?,?,?,?,?,?,?,?)").run(1, CURRENT_AUTHORITY_SCHEMA_VERSION, 0, extraction.readAt,
          null, "unbuilt", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
      } else database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
      database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; COMMIT`);
      assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const rows = database.prepare("SELECT * FROM artifacts ORDER BY id").all();
      assert.deepEqual(rows.map((row, index) => ({ ...row, payload_json: before[index]?.payload_json })), before.map(row => ({ ...row })));
      if (version >= 12) assert.deepEqual(rows, before);
      assert.deepEqual(rows.map(extractedArtifactFromRow), [...stored].sort((a, b) => a.extractionId.localeCompare(b.extractionId)));
      assert.equal(stored[3].extraction.record, null);
      assert.ok(stored[4].extraction.record?.answers.some(answer => answer.state === "unreadable"));
      assert.throws(() => database.exec("UPDATE artifacts SET payload_json='{}'"), /artifacts-extracted-immutable/u);
      assert.throws(() => database.exec("DELETE FROM artifacts"), /artifact-evidence-retained/u);
    } finally { database.close(); }
  }
});

it.each(["artifact-id", "source-column", "payload"] as const)("refuses malformed OCR %s and rolls back failed conversion validation", fault => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 11)) for (const statement of migration.statements) database.exec(statement);
    const extraction = historicalOcrExtractions()[0];
    insertUnboundOcrExtraction(database, extraction, true);
    database.prepare("INSERT INTO database_states VALUES(?,?,?,?,?,?,?,?)").run(1, 11, 0, extraction.readAt, null, "unbuilt",
      "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=11`);
    insertMalformedLegacyOcrExtraction(database, fault);
    const before = database.prepare("SELECT * FROM artifacts").all();
    const schema = database.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
    assert.throws(() => inspectNativeAuthority(database, 11), /authority table artifacts failed native record validation/u);
    assert.throws(() => {
      database.exec("BEGIN EXCLUSIVE");
      try {
        for (const migration of SQLITE_MIGRATIONS.filter(value => value.version > 11)) for (const statement of migration.statements) database.exec(statement);
        database.exec(`UPDATE database_states SET schema_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}`);
        inspectNormalAuthority(database);
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }, /authority table artifacts failed native record validation/u);
    assert.deepEqual(database.prepare("SELECT * FROM artifacts").all(), before);
    assert.deepEqual(database.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(), schema);
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 11);
    assert.equal(database.prepare("SELECT schema_version FROM database_states").get()?.schema_version, 11);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM database_upgrades").get()?.count, 0);
  } finally { database.close(); }
});

it("upgrades populated OCR schema twelve to workbook masters without rewriting stored readings or claiming manual versions", () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON');
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 12)) for (const statement of migration.statements) database.exec(statement);
    const reading = donePage(sourceFixture(1).inputs[0]).output;
    const extraction = reading.extraction, stored = { ...reading, binding: 'source-bound' };
    database.prepare(`INSERT INTO artifacts(id,kind,version,form_type,source_sha256,source_page,page_kind,page_fingerprint,source_kind,payload_json,created_at)
      VALUES(?,'extracted',1,?,?,?,?,?,?,?,?)`).run(reading.extractionId, extraction.formType, extraction.sourceSha256, extraction.sourcePage,
        extraction.pageKind, extraction.pageFingerprint, extraction.source.kind, JSON.stringify(stored), extraction.readAt);
    const first = encodeSavedWorkbook({ libraryId: 'historical-roster', version: 1, createdAt: extraction.readAt, savedAt: extraction.readAt,
      workbook: { libraryId: 'historical-roster', name: 'Roster.xlsx', themes: [], hasFormulas: false,
        sheets: [{ id: 'people', name: 'People', width: 1, hidden: [], rows: [{ id: 'one', cells: [{ value: 'preserved' }] }] }] } });
    const second = { ...first, version: 2, workbook: { ...first.workbook, name: 'Updated.xlsx' } };
    database.prepare('INSERT INTO workbook_library VALUES(?,?,?,?,?)').run(second.libraryId, 2, second.createdAt, second.savedAt, JSON.stringify(second));
    for (const record of [first, second]) database.prepare('INSERT INTO workbook_library_history VALUES(?,?,?,?,?)')
      .run(record.libraryId, record.version, record.createdAt, record.savedAt, JSON.stringify(record));
    database.prepare('INSERT INTO database_states VALUES(?,?,?,?,?,?,?,?)').run(1, 12, 0, extraction.readAt, null, 'unbuilt',
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=12`);
    assert.equal(inspectNativeAuthority(database, 12).schemaVersion, 12);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.count, 39);
    assert.throws(() => inspectNormalAuthority(database), /normal-authority-schema-mismatch/u);
    const before = database.prepare('SELECT * FROM artifacts').all();
    const master = SQLITE_MIGRATIONS.find(value => value.version === 13); assert.ok(master);
    database.exec('BEGIN EXCLUSIVE');
    for (const statement of master.statements) database.exec(statement);
    database.exec('UPDATE database_states SET schema_version=13; PRAGMA user_version=13; COMMIT');
    assert.equal(inspectNativeAuthority(database, 13).schemaVersion, 13);
    assert.throws(() => inspectNormalAuthority(database), /normal-authority-schema-mismatch/u);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.count, 42);
    assert.deepEqual(database.prepare('SELECT * FROM artifacts').all(), before);
    database.exec('BEGIN EXCLUSIVE');
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version > 13)) for (const statement of migration.statements) database.exec(statement);
    database.exec(`UPDATE database_states SET schema_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; COMMIT`);
    assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.count, 49 + AUTHORITY_DERIVED_TABLES.length);
    assert.deepEqual(database.prepare('SELECT * FROM artifacts').all(), before);
    assert.deepEqual(extractedArtifactFromRow(before[0]), stored);
    const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error('migration-read-only-proof'); } });
    assert.deepEqual(repository.read(first.libraryId), second);
    assert.deepEqual(repository.creation(first.libraryId), first);
    assert.deepEqual(repository.versions(first.libraryId).map(({ name, provenance }) => ({ name, provenance })), [
      { name: 'Saved revision 1', provenance: 'migration' }, { name: 'Saved revision 2', provenance: 'migration' },
    ]);
    assert.throws(() => database.exec("UPDATE artifacts SET payload_json='{}'"), /artifacts-extracted-immutable/u);
    assert.throws(() => database.exec('DELETE FROM artifacts'), /artifact-evidence-retained/u);
  } finally { database.close(); }
});
