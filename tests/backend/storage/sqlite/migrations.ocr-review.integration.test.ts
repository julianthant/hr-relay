import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { removeEmptySchema16OcrReview } from "../../../support/fixtures/storage/historical-run-schema.js";
import { NOW, UUID_1, UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

it("adds only OCR review evidence at sixteen and retains exact predecessor schema and rows", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 15)) for (const statement of migration.statements) database.exec(statement);
    database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=15`);
    database.prepare("INSERT INTO database_states VALUES(1,15,0,?,NULL,'unbuilt',?,?)").run(NOW, UUID_1, UUID_2);
    const schema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const prior = migrationTableNames(15);
    const rows = prior.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 16); assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    database.exec("PRAGMA user_version=16");
    assert.deepEqual(migrationTableNames(16).filter(table => !prior.includes(table)).sort(),
      ["ocr_approved_snapshots", "ocr_review_revisions", "ocr_source_uploads"]);
    for (const entry of schema) assert.deepEqual(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?").get(String(entry.name)), entry);
    assert.deepEqual(prior.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), rows);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    database.exec("UPDATE database_states SET schema_version=16");
    assert.equal(inspectNativeAuthority(database, 16).schemaVersion, 16);
    removeEmptySchema16OcrReview(database);
    assert.deepEqual(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(), schema);
    assert.equal(inspectNativeAuthority(database, 15).schemaVersion, 15);
  } finally { database.close(); }
});
