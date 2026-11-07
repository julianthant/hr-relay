import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { ASSISTANT_GRANT_RETIREMENT_VERSION, assertNoAssistantGrantHistory } from "../../../../src/backend/storage/sqlite/assistant-grant-retirement.js";

function predecessor(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version < ASSISTANT_GRANT_RETIREMENT_VERSION)) {
    for (const statement of migration.statements) database.exec(statement);
  }
  return database;
}
const tables = (database: DatabaseSync) => database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_grants'").all();

it("drops the grant table from a store that holds no grant history", () => {
  const database = predecessor();
  try {
    assert.equal(tables(database).length, 1);
    assertNoAssistantGrantHistory(database);
    const migration = SQLITE_MIGRATIONS.find(value => value.version === ASSISTANT_GRANT_RETIREMENT_VERSION); assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    assert.deepEqual(tables(database), []);
  } finally { database.close(); }
});

it.each([
  ["a grant", "INSERT INTO assistant_grants VALUES ('current','profile',1,'command','{}','created')"],
  ["an assistant action", "INSERT INTO assistant_actions VALUES ('action','chat','command',1,'cancelled','{}','created','expires')"],
  ["a permission command", `INSERT INTO commands VALUES ('command','settings','operator',NULL,NULL,'digest','{"payload":{"assistantPermission":{"mode":"every-action"}}}','succeeded','{}','created','created')`],
  ["a permission audit", `INSERT INTO command_audits VALUES ('audit','command',NULL,'{"request":{"payload":{"assistantPermission":{"mode":"every-action"}}}}','created')`],
])("refuses the upgrade when the store holds %s", (_label, insert) => {
  const database = predecessor();
  try {
    database.exec("INSERT INTO assistant_chats VALUES ('chat','profile',1,'{}','created','expires')");
    database.exec(`INSERT INTO commands VALUES ('plain','settings','operator',NULL,NULL,'digest','{"payload":{}}','succeeded','{}','created','created')`);
    assertNoAssistantGrantHistory(database);
    database.exec(insert);
    assert.throws(() => assertNoAssistantGrantHistory(database), /assistant-grant-history-unsupported/u);
  } finally { database.close(); }
});
