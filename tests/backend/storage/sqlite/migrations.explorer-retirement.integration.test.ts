import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";

function editorDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version < 10)) {
    for (const statement of migration.statements) database.exec(statement);
  }
  for (const [id, family, type] of [["editor-command", "explorer", "apply-explorer-edit"], ["keep-command", "notification", "notification-read"]]) {
    database.prepare("INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, family, "operator", null, null, "digest", JSON.stringify({ family, type }), "succeeded", "{}", "created", "created");
    database.prepare("INSERT INTO command_audits VALUES (?,?,?,?,?)").run(`${id}-audit`, id, null, JSON.stringify({ request: { family, type } }), "created");
  }
  database.prepare("INSERT INTO explorer_overrides VALUES (?,?,?,?)").run("person-lookup", 1, "editor-command", "{}");
  return database;
}

function retire(database: DatabaseSync) {
  const migration = SQLITE_MIGRATIONS.find(value => value.version === 10);
  assert.ok(migration);
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of migration.statements) database.exec(statement);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

it("drops exact Explorer editor records while preserving every unrelated history row", () => {
  const database = editorDatabase();
  try {
    const retained = migrationTableNames(9).filter(name => name !== "explorer_overrides");
    const before = retained.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all()
      .filter(row => table === "commands" ? row.id !== "editor-command" : table === "command_audits" ? row.command_id !== "editor-command" : true) }));
    retire(database);
    assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE name='explorer_overrides'").get(), undefined);
    assert.deepEqual(retained.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), before);
    assert.throws(() => database.exec("DELETE FROM command_audits WHERE command_id='keep-command'"), /retained-evidence-required/u);
    assert.deepEqual([...migrationTableNames(10)].sort(), retained.sort());
    assert.deepEqual(auditMigrationTableCoverage(), []);
  } finally { database.close(); }
});

it("rolls back all editor deletion when an unexpected retained row references its command", () => {
  const database = editorDatabase();
  try {
    database.prepare("INSERT INTO assistant_grants VALUES (?,?,?,?,?,?)").run("current", "profile", 1, "editor-command", "{}", "created");
    const before = migrationTableNames(9).map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
    assert.throws(() => retire(database), /FOREIGN KEY constraint failed/u);
    assert.deepEqual(migrationTableNames(9).map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), before);
    assert.throws(() => database.exec("DELETE FROM command_audits WHERE command_id='keep-command'"), /retained-evidence-required/u);
  } finally { database.close(); }
});

it("refuses an unrelated audit linked to an editor command instead of deleting it", () => {
  const database = editorDatabase();
  try {
    database.prepare("INSERT INTO command_audits VALUES (?,?,?,?,?)").run("unexpected-audit", "editor-command", null,
      JSON.stringify({ request: { family: "run", type: "retry" } }), "created");
    const before = database.prepare("SELECT * FROM command_audits").all();
    assert.throws(() => retire(database), /FOREIGN KEY constraint failed/u);
    assert.deepEqual(database.prepare("SELECT * FROM command_audits").all(), before);
    assert.ok(database.prepare("SELECT * FROM explorer_overrides").get());
  } finally { database.close(); }
});
