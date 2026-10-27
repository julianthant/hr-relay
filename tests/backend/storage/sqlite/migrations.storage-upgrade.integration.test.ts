import assert from "node:assert/strict";
import { existsSync,readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

const cleanups: Array<() => void | Promise<void>> = [];
const clock = manualClock(new Date("2026-10-01T12:00:00.000Z"));
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fresh() {
  const f = await storageRecoveryFixture();
  cleanups.push(f.dispose);
  return f;
}
function rows(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    assert.equal(tables.length, 39);
    return Object.fromEntries(tables.map(row => {
      assert.equal(typeof row.name, "string");
      return [String(row.name), raw.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()];
    }));
  } finally { raw.close(); }
}

describe("stopped native SQLite initialization", () => {
  it("plans a fresh root without files, creates the current schema directly, and reruns without writes", async () => {
    const versionInReference = Number(readFileSync(
      new URL("../../../../docs/rebuild/reference/clock-config-secrets.md", import.meta.url), "utf8",
    ).match(/CURRENT_AUTHORITY_SCHEMA_VERSION = (\d+)/u)?.[1]);
    assert.equal(versionInReference, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const f = await fresh(); const before = storageTree(f.root);
    assert.deepEqual(await f.run(true), { state: "planned", fromSchemaVersion: 0,
      toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    assert.deepEqual(storageTree(f.root), before);
    assert.equal((await f.run()).state, "initialized");
    assert.equal(existsSync(`${f.root}/credentials`), false);
    await f.finish();
    const db = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "upgrade-readback" }, clock);
    try { assert.equal(db.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION); } finally { db.close(); }
    const bytes = readFileSync(f.path); const admitted = rows(f.path);
    assert.equal((await f.run()).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(rows(f.path), admitted);
  });
});
