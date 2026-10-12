import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture(failAfterWork = false) {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  const repositories = createSettingsActivationRepositories({ database: db,
    mutate(work) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        if (failAfterWork) throw new Error("injected-before-commit");
        db.exec("COMMIT"); return result.result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    readRecord(table, key, schema) {
      const raw = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key);
      if (raw === undefined) return undefined;
      if (table === "commands") return schema.parse(commandFromRow(raw));
      return schema.parse(JSON.parse(String(raw.payload_json)));
    },
  });
  return { db, repositories };
}

describe("native settings initialization", () => {
  it("persists genuine internal command, snapshot, audit and current links while keeping never-applied UI state", () => {
    const f = fixture(); const active = f.repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const app = readAppSettings(f.db);
    expect(app?.saved).toBeNull();
    expect(app?.initialization.settings.revision).toBe(1);
    expect(app?.initialization.settings.settings).toEqual({});
    expect(app?.initialization.settings.lastApplied).toBeUndefined();
    expect(f.repositories.settingsCurrent.get()).toBeUndefined();
    expect(f.repositories.settingsCurrent.hasHistory()).toBe(false);
    expect(f.repositories.settingsCurrent.hasAuditHistory()).toBe(false);
    expect(f.repositories.runtimeConfig.get()).toEqual(active);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const command = commandFromRow(f.db.prepare("SELECT * FROM commands").get());
    expect(CommandRequestSchema.safeParse(command).success).toBe(false);
    expect(command).toMatchObject({ kind: "settings-initialization", revision: 1 });
    expect(() => f.repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT)).toThrow(/not-fresh/u);
  });

  it("rolls back the complete chain when initialization fails before commit", () => {
    const f = fixture(true);
    expect(() => f.repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT)).toThrow("injected-before-commit");
    for (const table of ["commands", "settings_snapshots", "command_audits", "settings"]) {
      expect(f.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
  });

  it("refuses initialization when snapshot evidence survives without current settings", () => {
    const f = fixture(); f.repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    f.db.exec("DELETE FROM settings");
    expect(() => f.repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT)).toThrow(/settings-current-missing-with-history/u);
  });
});
