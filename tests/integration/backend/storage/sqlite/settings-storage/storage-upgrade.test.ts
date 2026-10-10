import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { AuthorityDatabase, upgradeStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { foundationFixture } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { storageTree } from "../../../../../support/helpers/integration/storage-recovery-fixture.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { TimelineAppendSchema } from "../../../../../../src/models/events/timeline.js";

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
    assert.equal(tables.length, 34);
    return Object.fromEntries(tables.map(row => {
      assert.equal(typeof row.name, "string");
      return [String(row.name), raw.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()];
    }));
  } finally { raw.close(); }
}

describe("stopped native SQLite initialization", () => {
  it("plans a fresh root without files, creates the current schema directly, and reruns without writes", async () => {
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
  it("leaves a fresh root untouched when exclusive restore admission fails and permits exact rerun", async () => {
    const f = fresh(); const before = storageTree(f.root);
    await assert.rejects(upgradeStorage(f.input, clock, () => { throw new Error("injected-admission-failure"); }),
      /injected-admission-failure/u);
    assert.equal(existsSync(f.path), false);
    assert.deepEqual(storageTree(f.root), before);
    assert.equal((await f.run()).state, "initialized");
  });
  it("preserves complete populated current authority and stale claimed lifecycle bytes without recovery", async () => {
    const f = foundationFixture();
    try {
      const run = f.db.authority.runs.get(f.run.envelope.runId);
      assert.ok(run); assert.equal(run.lifecycle.state, "running");
      const generation = f.db.getMeta().authorityGeneration;
      f.db.close();
      const before = rows(f.path); const bytes = readFileSync(f.path);
      const input = { stateRoot: f.root, processLockRoot: join(f.root, "locks"), plan: true };
      assert.equal((await upgradeStorage(input, clock)).state, "planned");
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal((await upgradeStorage({ ...input, plan: false }, clock)).state, "already-upgraded");
      assert.deepEqual(rows(f.path), before); assert.deepEqual(readFileSync(f.path), bytes);
      const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "stale-current-readback" }, clock);
      try { assert.deepEqual(reopened.authority.runs.get(run.envelope.runId), run);
        assert.equal(reopened.getMeta().authorityGeneration, generation); }
      finally { reopened.close(); }
    } finally { f.dispose(); }
  });
  it.each([2, 29, 46, 999])("refuses schema %s without conversion or source I/O repair", async version => {
    const f = fresh(); await f.run();
    const raw = new DatabaseSync(f.path);
    try { raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`); }
    finally { raw.close(); }
    const before = storageTree(f.root);
    for (const plan of [true, false]) await assert.rejects(f.run(plan), /authority-schema-mismatch/u);
    assert.deepEqual(storageTree(f.root), before);
  });
  it("refuses a missing selected snapshot before healthy open or upgrade with all bytes unchanged", async () => {
    const f = foundationFixture();
    try {
      const snapshotId = f.snapshot.configSnapshotId; f.db.close();
      const raw = new DatabaseSync(f.path);
      try {
        raw.exec("PRAGMA foreign_keys=OFF");
        const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
        assert.ok(triggers.length > 0);
        for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
        try { assert.equal(raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(snapshotId).changes, 1); }
        finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
      } finally { raw.close(); }
      const before = storageTree(f.root);
      assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "missing-snapshot-boot" }, clock));
      for (const plan of [true, false]) await assert.rejects(upgradeStorage({
        stateRoot: f.root, processLockRoot: join(f.root, "locks"), plan }, clock));
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });
  it("preserves exact native multi-day events and immutable replay through stopped no-op upgrade", async () => {
    const f = foundationFixture();
    try {
      const inputs = ["2026-07-31", "2026-07-31", "2026-07-31", "2026-08-01"].map((day, i) =>
        TimelineAppendSchema.parse({ schemaVersion: 1, eventId: randomUUID(), scope: { kind: "client", clientId: "upgrade-fixture" },
          occurredAt: `${day}T12:00:00.000Z`, recordedAt: `${day}T12:00:00.000Z`, retentionDate: day,
          payload: { kind: "debug", event: { category: "client", phase: "settled", correlationId: `native-${String(i)}`,
            build: "fixture", pid: process.pid } }, source: { kind: "native" } }));
      const retained = inputs.map(input => f.db.authority.timelineEvents.append(input).record);
      assert.equal(retained.length, 4); assert.equal(new Set(retained.map(event => event.eventId)).size, 4);
      assert.deepEqual(retained.map(event => event.retentionDate), ["2026-07-31", "2026-07-31", "2026-07-31", "2026-08-01"]);
      f.db.close(); const before = rows(f.path);
      assert.equal((await upgradeStorage({ stateRoot: f.root, processLockRoot: join(f.root, "locks"), plan: false }, clock)).state, "already-upgraded");
      assert.deepEqual(rows(f.path), before);
      const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "native-timeline-replay" }, clock);
      try {
        assert.deepEqual(db.authority.timelineEvents.page({}), retained);
        const generation = db.getMeta().authorityGeneration;
        for (const [i, input] of inputs.entries()) {
          assert.deepEqual(db.authority.timelineEvents.append(input), { state: "existing", record: retained[i] });
          assert.throws(() => db.authority.timelineEvents.append({ ...input, recordedAt: "2026-10-01T12:00:00.000Z" }), /timeline-event-identity-conflict/u);
        }
        assert.equal(db.getMeta().authorityGeneration, generation);
      } finally { db.close(); }
    } finally { f.dispose(); }
  });
});
