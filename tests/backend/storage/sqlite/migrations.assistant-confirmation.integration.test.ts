import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";

it("retires automatic grants and pending actions without changing terminal or uncertain history", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version < 11)) {
      for (const statement of migration.statements) database.exec(statement);
    }
    for (const mode of ["before-submits", "without-asking", "every-action"]) {
      for (const state of ["prepared", "approved", "claimed", "settled", "unknown", "cancelled"]) {
        const id = `${mode}-${state}`;
        database.prepare("INSERT INTO assistant_actions VALUES (?,?,?,?,?,?,?,?,?)").run(id, "chat", id, 1, state,
          JSON.stringify({ binding: { mode }, state, revision: 1, result: state === "settled" ? { state: "applied" } : null }), "created", "expires");
      }
    }
    database.prepare("INSERT INTO assistant_grants VALUES (?,?,?,?,?,?)").run("current", "profile", 1, "grant-command",
      JSON.stringify({ policy: { mode: "without-asking" } }), "created");
    const before = database.prepare("SELECT * FROM assistant_actions ORDER BY id").all();
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 11);
    assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    assert.deepEqual(database.prepare("SELECT * FROM assistant_grants").all(), []);
    for (const prior of before) {
      const current = database.prepare("SELECT * FROM assistant_actions WHERE id=?").get(prior.id);
      assert.ok(current);
      if (!String(prior.id).startsWith("every-action") && ["prepared", "approved"].includes(String(prior.state))) {
        assert.equal(current.state, "cancelled");
        assert.equal(current.revision, 2);
        assert.deepEqual(JSON.parse(String(current.payload_json)), { ...JSON.parse(String(prior.payload_json)), state: "cancelled", revision: 2 });
      } else assert.deepEqual(current, prior);
    }
  } finally { database.close(); }
});
