import { z } from "zod";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { SettingsCommandRequestSchema, ProtectedSettingsCommandRequestSchema, markSettingsCommand, deriveSettingsCommandFingerprint } from "../../src/domain/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../src/domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, protectedSettingsReadback } from "../../src/domain/config/protected-settings.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { readSettings } from "../../src/server/settings-runtime.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { createSettingsFileAuthority, createProtectedSettingsFileAuthority } from "../fixtures/d331-settings-file.js";

const roots: string[] = [];
const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type Target = "ordinary" | "protected";
function fixture(target: Target, committed: boolean) {
  const root = mkdtempSync(join(tmpdir(), "upgrade-d331-")); roots.push(root);
  const directory = join(root, "settings"); mkdirSync(directory, { mode: 0o700 });
  const path = join(root, "state.db"); const ordinaryPath = join(directory, "settings.json");
  const envelope = { commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "settings-surface", family: "settings", target: { expectedRevision: 1 } };
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  const request = target === "ordinary" ? SettingsCommandRequestSchema.parse({ ...envelope, type: "apply-settings", payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } })
    : ProtectedSettingsCommandRequestSchema.parse({ ...envelope, type: "apply-protected-settings", payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-d331-private-value" } } } });
  const commandFingerprint = deriveSettingsCommandFingerprint(request);
  const publication = request.type === "apply-settings"
    ? createSettingsFileAuthority({ path: ordinaryPath, validateCandidate: () => {} }).apply({ commandId: request.commandId, commandFingerprint, expectedRevision: 1, ...request.payload })
    : createProtectedSettingsFileAuthority({ path: ordinaryPath, assertWriteIdAvailable: () => {} }).apply({ commandId: request.commandId, commandFingerprint, expectedRevision: 1, ...request.payload, updatedAt: now });
  assert.equal(publication.state, "applied");
  if (publication.state !== "applied") throw new Error("D331 fixture failed");
  const prepared = readFileSync(join(directory, "prepare.json"));
  const record = publication.record;
  publication.commit();
  writeFileSync(join(directory, "prepare.json"), prepared, { mode: 0o600 });
  const db = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 30)) for (const statement of migration.statements) db.exec(statement);
    db.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,30,7,?)").run(now);
    db.exec(`PRAGMA user_version=30; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    if (committed) {
      const marked = markSettingsCommand(request); const auditId = randomUUID();
      const affected = { family: target === "ordinary" ? "settings" : "protected-settings", revision: 2 };
      const result = "settingsFingerprint" in record
        ? { state: "applied", commandId: request.commandId, affectedTargets: [affected], restartRequired: true, settingsRevision: 2, settingsFingerprint: record.settingsFingerprint }
        : { state: "applied", commandId: request.commandId, affectedTargets: [affected], restartRequired: false, ...protectedSettingsReadback(record) };
      const audit = { auditId, request: marked, result, completedAt: now, versionChanges: [{ target: affected, before: 1, after: 2 }], affectedDependencyIds: [] };
      db.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(request.commandId, "settings", canonicalJsonStringify(marked), now);
      db.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(auditId, request.commandId, canonicalJsonStringify(audit), now);
      const current = { revision: 2, commandId: request.commandId, commandFingerprint, auditId, committedAt: now };
      if ("settingsFingerprint" in record) db.prepare("INSERT INTO settings_current VALUES ('current',?,?,?,?,?,?,?)").run(2, record.settingsFingerprint, request.commandId, commandFingerprint, auditId, canonicalJsonStringify({ ...current, settingsFingerprint: record.settingsFingerprint }), now);
      else db.prepare("INSERT INTO protected_settings_current VALUES ('current',?,?,?,?,?,?)").run(2, request.commandId, commandFingerprint, auditId, canonicalJsonStringify({ ...current, entries: Object.entries(record.entries).map(([name, value]) => ({ name, valueId: value.valueId, updatedAt: value.updatedAt })) }), now);
    }
  } finally { db.close(); }
  const snapshot = () => Object.fromEntries(readdirSync(directory).sort().map((name) => [name, readFileSync(join(directory, name)).toString("base64")]));
  return { root, directory, path, prepared, snapshot, targetPath: join(directory, target === "ordinary" ? "settings.json" : "protected.json"),
    input: { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false } };
}

describe("D331 interrupted sources through stopped upgrade", () => {
  for (const target of ["ordinary", "protected"] as const) {
    it.each([false, true])(`${target}: selects only authenticated prior/committed bytes (committed=%s)`, async (committed) => {
      const f = fixture(target, committed); const before = f.snapshot();
      await backupStoppedAuthority(f.root, clock);
      const plan = await upgradeStorage({ ...f.input, plan: true }, clock);
      assert.equal(plan.state, "planned");
      assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
      assert.deepEqual(f.snapshot(), before);
      const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "d331-proof" }, clock);
      try {
        assert.equal(readSettings(database.authority).settings.concurrency?.defaultWorkers, target === "ordinary" && committed ? 3 : undefined);
        assert.equal(createCredentialStore({ stateRoot: f.root }).read().entries.ucpathPassword?.value, target === "protected" && committed ? "synthetic-d331-private-value" : undefined);
      } finally { database.close(); }
    });
    it(`${target}: accepts exact rollback evidence without altering old source bytes`, async () => {
      const f = fixture(target, false);
      const prepare = z.record(z.string(), z.unknown()).parse(JSON.parse(f.prepared.toString("utf8")));
      const { prepareId: _prepareId, ...body } = prepare;
      writeFileSync(join(f.directory, "rollback.json"), canonicalJsonStringify({ ...body, rollbackId: randomUUID() }), { mode: 0o600 });
      const before = f.snapshot(); await backupStoppedAuthority(f.root, clock);
      assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
      assert.deepEqual(f.snapshot(), before);
      assert.equal(createCredentialStore({ stateRoot: f.root }).read().revision, 1);
    });
    it.each(["changed", "missing"])(`${target}: refuses committed %s bytes without conversion`, async (corruption) => {
      const f = fixture(target, true);
      if (corruption === "missing") rmSync(f.targetPath);
      else writeFileSync(f.targetPath, `${readFileSync(f.targetPath, "utf8")} `, { mode: 0o600 });
      const before = f.snapshot(); const databaseBytes = readFileSync(f.path);
      await backupStoppedAuthority(f.root, clock);
      await assert.rejects(upgradeStorage(f.input, clock), /settings-recovery-(?:bytes-divergent|committed-bytes-missing)/u);
      assert.deepEqual(f.snapshot(), before); assert.deepEqual(readFileSync(f.path), databaseBytes);
      assert.equal(createCredentialStore({ stateRoot: f.root }).read().revision, 1);
    });
  }
});
