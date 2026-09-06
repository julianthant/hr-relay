import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../src/infra/sqlite/storage-doctor.js";
import { AuthorityHealthPreflightRunner } from "../../src/infra/sqlite/authority-health-runner.js";
import { createProtectedSettingsFileAuthority, inspectProtectedSettingsFilesReadOnly } from "../../src/infra/config/settings-file.js";
import { ProtectedSettingsNameSchema, ProtectedStoreRecordSchema } from "../../src/domain/config/protected-settings.js";
import { journalProtectedSettings } from "./helpers/journaled-protected-settings.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0; });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hr-protected-doctor-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "state.db");
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 100, migrationOwner: "unit-test" });
  cleanups.push(() => database.close());
  const file = createProtectedSettingsFileAuthority({ path: join(root, "settings", "settings.json"), assertWriteIdAvailable: () => undefined });
  const options = { authorityPath: path, stateRoot: root, stateRootTrustAnchor: root,
    backupDirectory: join(root, "backups"), busyTimeoutMs: 100 };
  return { root, database, file, options };
}
function snapshot(root: string): unknown {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name); const stat = lstatSync(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync(path);
    // SQLite's SHM has no database content. Only its documented reader marks
    // (100..119) may change when a read-only connection joins a live WAL reader set.
    // Pin every other byte, including transaction counters/checkpoint positions.
    // https://www.sqlite.org/walformat.html#the_wal_index_header
    if (name === "state.db-shm") {
      assert.ok(bytes && bytes.length >= 136);
      bytes.fill(0, 100, 120);
    }
    return { name, mode: stat.mode, uid: stat.uid, ino: stat.ino, size: stat.size,
      mtime: stat.mtimeMs, ctime: stat.ctimeMs,
      content: stat.isDirectory() ? snapshot(path) : bytes?.toString("base64") };
  });
}
async function unchanged(f: ReturnType<typeof fixture>) {
  const before = snapshot(f.root); const meta = f.database.getMeta();
  const report = await doctorAuthorityStorage(f.options);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe("P16 protected settings doctor", () => {
  it("reports every name and presence, with no protected value, identity or mutation", async () => {
    const f = fixture();
    journalProtectedSettings(f.database, f.file, { timekeeperName: { set: "Protected Doctor Canary" },
      ucpathPassword: { set: "doctor-private-password" } });
    const report = await unchanged(f);
    assert.deepEqual(report, { state: "available", entries: ProtectedSettingsNameSchema.options.map((name) => ({
      name, present: name === "timekeeperName" || name === "ucpathPassword",
    })) });
    const serialized = JSON.stringify(report);
    const privateRecord = f.file.read();
    for (const entry of Object.values(privateRecord.entries)) {
      assert.equal(serialized.includes((typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value))), false);
      assert.equal(serialized.includes(entry.valueId), false);
      assert.equal(serialized.includes(entry.updatedAt), false);
    }
  });
  it("distinguishes a verified virgin authority from a missing root", async () => {
    const f = fixture();
    assert.equal((await unchanged(f)).state, "unavailable");
    f.file.read();
    assert.deepEqual(await unchanged(f), { state: "available", entries:
      ProtectedSettingsNameSchema.options.map((name) => ({ name, present: false })) });
  });
  it.each(["corrupt", "permissions", "missing", "unjournaled", "prepare", "rollback", "lock"])(
    "keeps %s authority unknown and untouched, with closed diagnostics", async (fault) => {
      const f = fixture();
      journalProtectedSettings(f.database, f.file, { timekeeperName: { set: "Protected Doctor Canary" } });
      const path = join(f.root, "settings", "protected.json");
      if (fault === "corrupt") writeFileSync(path, "Protected Doctor Canary");
      if (fault === "permissions") chmodSync(path, 0o644);
      if (fault === "missing") rmSync(path);
      if (fault === "unjournaled") {
        const record = ProtectedStoreRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        assert.ok(record.lastApplied);
        record.lastApplied.writeId = "00000000-0000-4000-8000-000000000099";
        writeFileSync(path, JSON.stringify(record));
      }
      if (["prepare", "rollback", "lock"].includes(fault))
        writeFileSync(join(f.root, "settings", fault === "lock" ? "settings.lock" : `${fault}.json`), "Protected Doctor Canary", { mode: 0o600 });
      const report = await unchanged(f);
      assert.deepEqual(report, { state: "unavailable", cause: { code: "authority-unavailable",
        summary: "protected settings in settings could not be verified read-only" } });
    },
  );
  it("refuses file replacement during journal authentication", () => {
    const f = fixture(); f.file.read();
    assert.throws(() => inspectProtectedSettingsFilesReadOnly(f.root, () => {
      writeFileSync(join(f.root, "settings", "protected.json"), "{}");
    }), /moved during inspection/);
  });
  it("reports the same presence facts through authority.health and fails unreadable closed", async () => {
    const f = fixture();
    journalProtectedSettings(f.database, f.file, { timekeeperName: { set: "Protected Doctor Canary" } });
    const runner = new AuthorityHealthPreflightRunner(f.options);
    const context = { signal: new AbortController().signal, timeoutMs: 10000, deadlineMonotonicMs: 10000, redaction: "presence-only" as const };
    const before = snapshot(f.root);
    const observation = await runner.run(context);
    assert.deepEqual(snapshot(f.root), before);
    for (const name of ProtectedSettingsNameSchema.options)
      assert.ok(observation.summary.includes(`${name}=${name === "timekeeperName" ? "present" : "absent"}`));
    assert.equal(observation.summary.includes("Protected Doctor Canary"), false);
    chmodSync(join(f.root, "settings", "protected.json"), 0o644);
    const unavailable = await runner.run(context);
    assert.equal(unavailable.state, "unhealthy");
    assert.ok(unavailable.summary.includes("could not be verified read-only"));
    assert.equal(unavailable.summary.includes(f.root), false);
  });
});
