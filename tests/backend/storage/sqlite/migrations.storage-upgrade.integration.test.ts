import assert from "node:assert/strict";
import { existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase,upgradeStorage } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const clock = manualClock(new Date("2026-10-01T12:00:00.000Z"));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fresh() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "storage-upgrade-"));
  roots.push(root);
  mkdirSync(join(root, "artifacts"), { mode: 0o700 });
  const path = join(root, "state.db");
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), plan: false };
  return { root, path, input, run: (plan = false) => upgradeStorage({ ...input, plan }, clock) };
}
function rows(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    assert.equal(tables.length, 36);
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
    const f = fresh(); const before = storageTree(f.root);
    assert.deepEqual(await f.run(true), { state: "planned", fromSchemaVersion: 0,
      toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    assert.deepEqual(storageTree(f.root), before);
    assert.equal((await f.run()).state, "initialized");
    const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "upgrade-readback" }, clock);
    try { assert.equal(db.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION); } finally { db.close(); }
    assert.equal(existsSync(join(f.root, "credentials")), false);
    const bytes = readFileSync(f.path); const admitted = rows(f.path);
    assert.equal((await f.run()).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(rows(f.path), admitted);
  });
});
