import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createAssistantAuthorizationRepository } from "../../../../src/backend/storage/sqlite/assistant-authorization.js";

it("retires automatic grants and pending actions without changing terminal or uncertain history", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version < 11)) {
      for (const statement of migration.statements) database.exec(statement);
    }
    database.prepare("INSERT INTO assistant_chats VALUES (?,?,?,?,?,?)").run("chat", "profile", 1, "{}", "created", "expires");
    for (const mode of ["before-submits", "without-asking", "every-action"]) {
      for (const state of ["prepared", "approved", "claimed", "settled", "unknown", "cancelled"]) {
        const id = `${mode}-${state}`;
        database.prepare("INSERT INTO assistant_actions VALUES (?,?,?,?,?,?,?,?)").run(id, "chat", id, 1, state,
          JSON.stringify({ binding: { mode }, state, revision: 1, result: state === "settled" ? { state: "applied" } : null }), "created", "expires");
      }
    }
    database.prepare("INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("grant-command", "settings", "operator", null, null, "digest",
      JSON.stringify({ payload: { assistantPermission: { mode: "without-asking" } } }), "succeeded", "{}", "created", "created");
    database.prepare("INSERT INTO assistant_grants VALUES (?,?,?,?,?,?)").run("current", "profile", 1, "grant-command",
      JSON.stringify({ policy: { mode: "without-asking" } }), "created");
    database.prepare("INSERT INTO command_audits VALUES (?,?,?,?,?)").run("grant-audit", "grant-command", null,
      JSON.stringify({ historicalMode: "without-asking" }), "created");
    const history = ["commands", "command_audits"].map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
    const before = database.prepare("SELECT * FROM assistant_actions ORDER BY id").all();
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 11);
    assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    assert.deepEqual(database.prepare("SELECT * FROM assistant_grants").all(), []);
    const repository = createAssistantAuthorizationRepository({ database, mutate: () => { throw new Error("read-only proof"); } });
    assert.equal(repository.grant(), undefined);
    assert.deepEqual(["commands", "command_audits"].map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), history);
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

it("keeps an existing every-action grant byte-for-byte", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version < 11)) {
      for (const statement of migration.statements) database.exec(statement);
    }
    database.prepare("INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("grant-command", "settings", "operator", null, null, "digest",
      JSON.stringify({ payload: { assistantPermission: { mode: "every-action" } } }), "succeeded", "{}", "created", "created");
    database.prepare("INSERT INTO assistant_grants VALUES (?,?,?,?,?,?)").run("current", "profile", 2, "grant-command",
      JSON.stringify({ policy: { mode: "every-action" } }), "created");
    const before = database.prepare("SELECT * FROM assistant_grants").all();
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 11);
    assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    assert.deepEqual(database.prepare("SELECT * FROM assistant_grants").all(), before);
  } finally { database.close(); }
});

it.each(["before-submits", "without-asking", "every-action", "unexpected", null, undefined])("permits missing grant history only for an exact retired mode: %s", mode => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
    database.prepare("INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("grant-command", "settings", "operator", null, null, "digest",
      JSON.stringify({ payload: { assistantPermission: { mode } } }), "succeeded", "{}", "created", "created");
    const repository = createAssistantAuthorizationRepository({ database, mutate: () => { throw new Error("read-only proof"); } });
    if (mode === "before-submits" || mode === "without-asking") assert.equal(repository.grant(), undefined);
    else assert.throws(() => repository.grant(), /assistant-grant-missing-with-history/u);
  } finally { database.close(); }
});
