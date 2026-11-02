import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { extractedArtifactFromRow } from "../../../../src/backend/storage/sqlite/extracted-artifact-row.js";
import { donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";

it("converts every supported source layout to explicit unbound evidence without inventing PDF or reading provenance", () => {
  for (let version = 1; version < CURRENT_AUTHORITY_SCHEMA_VERSION; version++) {
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= version)) for (const statement of migration.statements) database.exec(statement);
      const extraction = donePage(sourceFixture(1).inputs[0]).output.extraction;
      const id = `${extraction.sourceSha256}#${extraction.sourcePage}#${extraction.formType}`;
      const retained = { binding: "unbound-source", extractionId: id, extraction };
      database.prepare(`INSERT INTO artifacts (id,kind,version,form_type,source_sha256,source_page,page_kind,page_fingerprint,source_kind,payload_json,created_at)
        VALUES (?,'extracted',1,?,?,?,?,?,?,?,?)`).run(id, extraction.formType, extraction.sourceSha256, extraction.sourcePage,
        extraction.pageKind, extraction.pageFingerprint, extraction.source.kind, JSON.stringify(version < 12 ? extraction : retained), extraction.readAt);
      const columns = version < 7 ? "(id,schema_version,authority_generation,updated_at,search_generation,search_state)"
        : "(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id)";
      database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=${version}`);
      const values = [1, version, 0, extraction.readAt, null, "unbuilt", ...(version < 7 ? [] : ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])];
      database.prepare(`INSERT INTO database_states ${columns} VALUES (${values.map(() => "?").join(",")})`).run(...values);
      assert.equal(inspectNativeAuthority(database, version).schemaVersion, version);
      assert.throws(() => inspectNormalAuthority(database), /normal-authority-schema-mismatch/u);
      const before = database.prepare("SELECT * FROM artifacts").get();
      assert.ok(before);
      const remaining = SQLITE_MIGRATIONS.filter(value => value.version > version).flatMap(migration => migration.statements);
      database.exec("BEGIN EXCLUSIVE");
      for (const statement of remaining) database.exec(statement);
      database.exec("ROLLBACK");
      assert.deepEqual(database.prepare("SELECT * FROM artifacts").get(), before);
      if (version < 12) assert.throws(() => extractedArtifactFromRow(before));
      else assert.deepEqual(extractedArtifactFromRow(before), retained);
      database.exec("BEGIN EXCLUSIVE");
      for (const statement of remaining) database.exec(statement);
      if (version < 7) {
        database.prepare("INSERT INTO database_states VALUES (?,?,?,?,?,?,?,?)").run(1, CURRENT_AUTHORITY_SCHEMA_VERSION, 0, extraction.readAt,
          null, "unbuilt", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
      } else database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
      database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; COMMIT`);
      assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const row = database.prepare("SELECT * FROM artifacts").get();
      assert.ok(row);
      assert.deepEqual({ ...row, payload_json: before.payload_json }, { ...before });
      assert.deepEqual(extractedArtifactFromRow(row), { binding: "unbound-source", extractionId: id, extraction });
      assert.throws(() => database.exec("UPDATE artifacts SET payload_json='{}'"), /artifacts-extracted-immutable/u);
      assert.throws(() => database.exec("DELETE FROM artifacts"), /artifact-evidence-retained/u);
    } finally { database.close(); }
  }
});
