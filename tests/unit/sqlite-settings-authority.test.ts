import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { composeStorageCommand } from "../../src/server/storage/compose.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync, copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { executeSettingsCommand, type CommandAuthority } from "../../src/core/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../src/server/dashboard/commands/settings-service.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { readSettings, createCredentialSecretSource } from "../../src/server/settings-runtime.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../src/domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../src/domain/config/protected-settings.js";
import { requireSecret } from "../../src/domain/secrets.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "sqlite-settings-")); roots.push(repoRoot);
  const root = join(repoRoot, rebuildRuntimeIsolation.stateRoot); mkdirSync(root);
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock(new Date("2026-09-06T12:00:00Z"));
  const path = join(root, "state.db");
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "settings-test" }, clock); databases.push(database);
  const store = createCredentialStore({ stateRoot: root });
  const settings = createSettingsApplicationExecutor(() => {}, store);
  const execute = (request: unknown, authority: CommandAuthority = database) => executeSettingsCommand({ authority, clock, ids: { uuid: randomUUID }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock };
}
function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}
function protectedCommand() {
  return { family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1 }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-private-value" } } } };
}
function failAudit(database: AuthorityDatabase): CommandAuthority {
  return { withAuthorityTransaction: (work) => database.withAuthorityTransaction((repositories) => work({ ...repositories,
    commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
  })) };
}

describe("D336 SQLite settings authority", () => {
  it("represents empty revision one without a file or current row", () => {
    const f = fixture();
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(f.database.authority).settings, {});
    assert.equal(readSettings(f.database.authority).revision, 1);
    assert.equal(existsSync(join(f.root, "settings")), false);
    assert.equal(existsSync(join(f.root, "credentials")), false);
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try { assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='protected_settings_current'").get(), undefined); }
    finally { raw.close(); }
  });
  it("commits values, revision, command, audit and one authority generation together, then replays without writes", () => {
    const f = fixture(); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.equal(f.execute(request).state, "applied");
    assert.equal(f.database.getMeta().authorityGeneration, before + 1);
    assert.equal(readSettings(f.database.authority).settings.concurrency?.defaultWorkers, 3);
    assert.equal(f.database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "applied");
    assert.equal(f.execute(request).state, "already-applied");
    assert.equal(f.database.getMeta().authorityGeneration, before + 1);
    assert.equal(existsSync(join(f.root, "settings")), false);
  });
  it("rolls ordinary values and every journal effect back on an audit failure", () => {
    const f = fixture(); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.throws(() => f.execute(request, failAudit(f.database)), /injected audit failure/u);
    assert.equal(f.database.getMeta().authorityGeneration, before);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.equal(f.execute(request).state, "applied");
  });
  it("refuses CAS conflicts without changing ordinary authority", () => {
    const f = fixture(); f.execute(ordinary()); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.equal(f.execute(request).state, "conflict");
    assert.equal(f.database.getMeta().authorityGeneration, before);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
  });
  it("retains credential commit after audit failure, verifies exact retry and rejects divergent values", () => {
    const f = fixture(); const request = protectedCommand();
    assert.throws(() => f.execute(request, failAudit(f.database)), /credential-audit-uncertain/u);
    assert.equal(f.store.read().revision, 2);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
    const divergent = structuredClone(request); divergent.payload.entries.ucpathPassword.set = "different-private-value";
    assert.equal(f.execute(divergent).state, "rejected");
    assert.equal(f.execute(request).state, "applied");
    assert.equal(f.execute(request).state, "already-applied");
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      const rows = JSON.stringify(raw.prepare("SELECT record_json FROM commands UNION ALL SELECT record_json FROM command_audits").all());
      assert.equal(rows.includes("synthetic-private-value"), false);
      assert.equal(rows.includes("different-private-value"), false);
      assert.ok(rows.includes("<set>"));
    } finally { raw.close(); }
  });
  it("after uncertain audit, real CLI restore preserves credentials and exact retry repairs the missing audit", async () => {
    const f = fixture(); const request = protectedCommand();
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], f.clock, f.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    const directory = join(f.root, "backups", "authority");
    const name = readdirSync(directory).find((entry) => entry.endsWith(".manifest.json")); assert.ok(name);
    const backupFiles = Object.fromEntries(readdirSync(directory).map((entry) => [entry, readFileSync(join(directory, entry))]));
    assert.throws(() => f.execute(request, failAudit(f.database)), /credential-audit-uncertain/u);
    const credentialPath = join(f.root, "credentials", "protected.json");
    const credentialBytes = readFileSync(credentialPath);
    assert.equal(f.store.read().revision, 2);
    f.database.close();
    const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join(directory, name), "--json"], f.clock, f.repoRoot);
    assert.equal(restore.exitCode, 0, restore.output);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    const restored = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "uncertain-restore-retry" }, f.clock); databases.push(restored);
    assert.equal(restored.authority.commands.get(request.commandId), undefined);
    const generation = restored.getMeta().authorityGeneration;
    const divergent = structuredClone(request); divergent.payload.entries.ucpathPassword.set = "divergent-after-restore";
    assert.equal(f.execute(divergent, restored).state, "rejected");
    assert.equal(restored.getMeta().authorityGeneration, generation);
    assert.equal(f.execute(request, restored).state, "applied");
    assert.equal(f.execute(request, restored).state, "already-applied");
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(f.store)), "synthetic-private-value");
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], f.clock, f.repoRoot);
    assert.equal(doctor.exitCode, 0, doctor.output);
    for (const value of ["synthetic-private-value", "divergent-after-restore"]) {
      assert.equal(doctor.output.includes(value), false); assert.equal(restore.output.includes(value), false);
      assert.equal(readFileSync(f.path).includes(Buffer.from(value)), false);
      for (const bytes of Object.values(backupFiles)) assert.equal(bytes.includes(Buffer.from(value)), false);
    }
    for (const [entry, bytes] of Object.entries(backupFiles)) assert.deepEqual(readFileSync(join(directory, entry)), bytes);
  });
  it("database restore leaves credential revision, availability and next-use value intact", async () => {
    const f = fixture(); const snapshot = join(f.root, "prior.sqlite");
    await f.database.onlineBackupTo(snapshot);
    const request = protectedCommand(); f.execute(request);
    f.database.close(); copyFileSync(snapshot, f.path);
    const restored = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-proof" }, f.clock); databases.push(restored);
    assert.equal(restored.authority.commands.get(request.commandId), undefined);
    assert.equal(f.store.read().revision, 2);
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(f.store)), "synthetic-private-value");
    assert.equal(f.execute(request, restored).state, "applied");
  });
});
