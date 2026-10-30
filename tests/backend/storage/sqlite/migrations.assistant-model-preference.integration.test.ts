import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames, auditMigrationTableCoverage, tableClassification, deriveAuthorityUpgradePlanDigest } from "../../../../src/backend/storage/sqlite/migrations.js";

describe("assistant model preference additive schema", () => {
  it("adds only the preference table at nine and preserves the complete eight-table schema and rows", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON");
      for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 8)) for (const statement of migration.statements) database.exec(statement);
      const prior = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
      const tables = migrationTableNames(8);
      const rows = tables.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
      const ninth = SQLITE_MIGRATIONS.find(value => value.version === 9);
      assert.ok(ninth);
      for (const statement of ninth.statements) database.exec(statement);
      for (const value of prior) { assert.ok(typeof value.name === "string"); assert.deepEqual(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?").get(value.name), value); }
      assert.deepEqual(tables.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), rows);
      assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 10);
      assert.deepEqual(migrationTableNames(9).filter(table => !tables.includes(table)), ["assistant_model_preference"]);
      assert.equal(tableClassification("assistant_model_preference"), 'authority');
      assert.deepEqual(database.prepare("SELECT * FROM assistant_model_preference").all(), []);
      assert.deepEqual(auditMigrationTableCoverage(), []);
    } finally { database.close(); }
  });

  it('authenticates the immutable seven-to-eight plan independently of the current destination', () => {
    const fingerprint = '1111111111111111111111111111111111111111111111111111111111111111';
    const historical = '61f8506ea8223f57ea6e272847da8cf4eb384f9b1a0de118932f277eda9d71d6';
    assert.equal(deriveAuthorityUpgradePlanDigest(7, fingerprint, 8), historical);
    assert.notEqual(deriveAuthorityUpgradePlanDigest(7, fingerprint), historical);
    assert.equal(deriveAuthorityUpgradePlanDigest(8, fingerprint), deriveAuthorityUpgradePlanDigest(8, fingerprint, CURRENT_AUTHORITY_SCHEMA_VERSION));
  });

  it.each([[7, 7], [7, 11], [8, 8], [6, 8], [7, '8'], [7, null], [7, Number.NaN]])(
    'refuses an unsupported historical plan target %s to %s', (from, to) => {
      assert.throws(() => { Reflect.apply(deriveAuthorityUpgradePlanDigest, undefined, [from, '1111111111111111111111111111111111111111111111111111111111111111', to]); },
        { message: 'authority-upgrade-plan-target-unsupported' });
    },
  );

});
