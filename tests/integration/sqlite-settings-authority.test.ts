import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { composeStorageCommand } from "../helpers/synthetic-storage-admission.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync, copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CommandIdentityConflictError } from "../../src/domain/commands.js";
import { afterEach, describe, it } from "vitest";
import { resolveConfigWithProvenance } from "../../src/backend/app/config/resolve.js";
import { manualClock } from "../../src/domain/clock.js";
import { createCommandKernel, executeSettingsCommand, type CommandAuthority } from "../../src/backend/runs/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../src/backend/runs/dashboard/commands/settings-service.js";
import { createCredentialStore, type CredentialStoreHooks } from "../helpers/synthetic-storage-admission.js";
import { readSettings, createCredentialSecretSource } from "../../src/backend/runtime/settings/settings-runtime.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../src/domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../src/domain/config/protected-settings.js";
import { requireSecret } from "../../src/domain/secrets.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { createProviderKeyStore } from "../helpers/synthetic-storage-admission.js";
import { createProviderKeyJournal } from "../../src/backend/runs/dashboard/commands/provider-key-journal.js";
import { providerCommandFromStore, providerMarkedFingerprint } from "../../src/backend/runs/dashboard/commands/provider-key-projection.js";
import { PROVIDER_KEYS_SCHEMA_HASH } from "../../src/domain/config/provider-keys.js";

import { RunRecordService } from "../../src/backend/runs/run-record-service.js";
import { DESCRIPTORS } from "../../src/backend/app/control/workflow-registry.js";
import { seedSyntheticRuntimeConfig } from "../fixtures/operator-command-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(hooks?: CredentialStoreHooks) {
  const repoRoot = mkdtempSync(join(tmpdir(), "sqlite-settings-")); roots.push(repoRoot);
  const root = join(repoRoot, rebuildRuntimeIsolation.stateRoot); mkdirSync(root);
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock(new Date("2026-09-06T12:00:00Z"));
  const path = join(root, "state.db");
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "settings-test" }, clock); databases.push(database);
  const store = createCredentialStore({ stateRoot: root, ...(hooks === undefined ? {} : { hooks }) });
  const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), store);
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
  it("recovers a provider SQL rollback in a fresh process from private pending evidence", () => {
    const f = fixture();
    const envPath = join(f.repoRoot, ".env.providers");
    writeFileSync(envPath, "GEMINI_API_KEY='synthetic-boot'\n", { mode: 0o600 });
    const firstStore = createProviderKeyStore({ envPath, journal: createProviderKeyJournal(f.database),
      markedFingerprint: providerMarkedFingerprint });
    const request = { commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-provider-keys",
      target: { expectedRevision: 1, sourceVersionToken: firstStore.read().sourceVersionToken },
      payload: { providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, writeId: randomUUID(),
        operations: { GROQ_API_KEY2: { set: "synthetic-child-private" } } } };
    f.database.close();
    databases.splice(databases.indexOf(f.database), 1);
    const moduleUrl = (name: string) => JSON.stringify(pathToFileURL(join(process.cwd(), name)).href);
    const childPath = join(f.repoRoot, "provider-sql-rollback.mjs");
    writeFileSync(childPath, `
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AuthorityDatabase, createProviderKeyStore, createCredentialStore } from ${moduleUrl("tests/helpers/synthetic-storage-admission.ts")};
import { createProviderKeyJournal } from ${moduleUrl("src/backend/runs/dashboard/commands/provider-key-journal.ts")};
import { providerMarkedFingerprint } from ${moduleUrl("src/backend/runs/dashboard/commands/provider-key-projection.ts")};
import { createSettingsApplicationExecutor } from ${moduleUrl("src/backend/runs/dashboard/commands/settings-service.ts")};
import { executeSettingsCommand } from ${moduleUrl("src/backend/runs/command-kernel.ts")};
import { manualClock } from ${moduleUrl("src/domain/clock.ts")};
const [root, raw] = process.argv.slice(2);
const clock = manualClock(new Date('2026-09-06T12:00:00Z'));
const database = AuthorityDatabase.open({ path: join(root, '.tracker', 'state.db'), busyTimeoutMs: 250,
  migrationOwner: 'provider-child' }, clock);
const store = createProviderKeyStore({ envPath: join(root, '.env.providers'),
  journal: createProviderKeyJournal(database), markedFingerprint: providerMarkedFingerprint });
const settings = createSettingsApplicationExecutor(() => { throw new Error('ordinary settings unavailable'); },
  createCredentialStore({ stateRoot: join(root, '.tracker') }),
  { store, bootKnown: true, restartRequired: () => true });
try {
  executeSettingsCommand({ authority: { withAuthorityTransaction: work => database.withAuthorityTransaction(repositories => {
    work(repositories); throw new Error('synthetic-sql-failure');
  }) }, clock, ids: { uuid: randomUUID }, settings }, JSON.parse(raw));
  process.exitCode = 74;
} catch (error) {
  process.exitCode = String(error).includes('provider-audit-uncertain') ? 71 : 75;
} finally { database.close(); }
`);
    const child = spawnSync(process.execPath, ["--import", "tsx", childPath, f.repoRoot, JSON.stringify(request)],
      { encoding: "utf8" });
    assert.equal(child.status, 71, child.stderr);
    const restored = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "provider-parent" }, f.clock);
    databases.push(restored);
    const store = createProviderKeyStore({ envPath, journal: createProviderKeyJournal(restored),
      markedFingerprint: providerMarkedFingerprint });
    const pending = store.read();
    assert.equal(pending.state, "pending-after-rename");
    if (pending.state !== "pending-after-rename") throw new Error("pending provider evidence missing");
    const recovered = providerCommandFromStore(store.readPendingRequest(pending.pending));
    assert.equal(recovered.requestedAt, request.requestedAt);
    const settings = createSettingsApplicationExecutor(() => { throw new Error("ordinary settings unavailable"); },
      createCredentialStore({ stateRoot: f.root }), { store, bootKnown: true, restartRequired: () => true });
    const applied = executeSettingsCommand({ authority: restored, clock: f.clock, ids: { uuid: randomUUID }, settings }, recovered);
    assert.equal(applied.state, "applied");
    assert.equal(store.read().state, "settled");
    assert.equal(restored.authority.commandAudits.findByCommand(request.commandId)?.request.requestedAt, request.requestedAt);
    assert.equal(readFileSync(f.path).includes(Buffer.from("synthetic-child-private")), false);
  });
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
  it("replays an older ordinary result from its journal and refuses divergent identity reuse", () => {
    const f = fixture(); const first = ordinary();
    const applied = f.execute(first);
    assert.equal(applied.state, "applied");
    assert.equal(f.execute(ordinary(2)).state, "applied");
    const current = f.database.authority.settingsCurrent.get();
    const generation = f.database.getMeta().authorityGeneration;
    assert.deepEqual(f.execute(first), { ...applied, state: "already-applied" });
    const changed = structuredClone(first);
    changed.payload.patch["concurrency.defaultWorkers"].set = 4;
    changed.payload.patchFingerprint = deriveSettingsPatchFingerprint(changed.payload.patch);
    const refused = f.execute(changed);
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "command-divergent");
    assert.deepEqual(f.database.authority.settingsCurrent.get(), current);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
  });
  it("refuses a foreign journal identity before committing credentials", () => {
    const f = fixture(); const existing = ordinary();
    f.execute(existing);
    const generation = f.database.getMeta().authorityGeneration;
    const audit = f.database.authority.commandAudits.findByCommand(existing.commandId);
    const before = f.store.read();
    const result = f.execute({ ...protectedCommand(), commandId: existing.commandId });
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "command-divergent");
    assert.deepEqual(f.store.read(), before);
    assert.equal(existsSync(join(f.root, "credentials", "protected.json")), false);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(f.database.authority.commandAudits.findByCommand(existing.commandId), audit);
    assert.deepEqual(f.database.authority.commands.get(existing.commandId), existing);
  });
  it("retains global ownership after credential commit and failed audit", () => {
    const f = fixture(); const pending = protectedCommand();
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const path = join(f.root, "credentials", "protected.json"); const bytes = readFileSync(path);
    const before = f.store.read(); const generation = f.database.getMeta().authorityGeneration;
    const foreign = f.execute({ ...ordinary(), commandId: pending.commandId });
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.equal(foreign.code, "command-divergent");
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.execute(pending).state, "applied");
    assert.equal(f.execute(pending).state, "already-applied");
    assert.deepEqual(readFileSync(path), bytes);
  });
  it("fences a competing process during private commit and refuses its reuse after SQL rollback", () => {
    const pending = protectedCommand();
    let contenderRan = false;
    const f = fixture({ afterRename: () => {
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(${JSON.stringify(f.path)});
        db.exec('PRAGMA busy_timeout = 50');
        try { assert.throws(() => db.exec('BEGIN IMMEDIATE'), /database is locked/); }
        finally { db.close(); }
      `], { encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr);
      contenderRan = true;
    } });
    const generation = f.database.getMeta().authorityGeneration;
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    assert.equal(contenderRan, true);
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    const foreign = { ...ordinary(), commandId: pending.commandId };
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { AuthorityDatabase } from './src/infra/sqlite/authority-database.ts';
      import { manualClock } from './src/domain/clock.ts';
      import { resolveConfigWithProvenance } from './src/backend/app/config/resolve.ts';
      import { executeSettingsCommand } from './src/backend/runs/command-kernel.ts';
      import { createCredentialStore } from '../helpers/synthetic-storage-admission.js';
      import { createSettingsApplicationExecutor } from './src/backend/runs/dashboard/commands/settings-service.ts';
      const clock = manualClock(new Date('2026-09-06T12:00:00Z'));
      const db = AuthorityDatabase.open({ path: ${JSON.stringify(f.path)}, busyTimeoutMs: 50, migrationOwner: 'r9-child' }, clock);
      try {
        const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), createCredentialStore({ stateRoot: ${JSON.stringify(f.root)} }));
        const result = executeSettingsCommand({ authority: db, clock, ids: { uuid: randomUUID }, settings }, ${JSON.stringify(foreign)});
        assert.equal(result.state, 'rejected'); assert.equal(result.code, 'command-divergent');
      } finally { db.close(); }
    `], { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.equal(f.execute(pending).state, "applied");
    assert.deepEqual(readFileSync(path), bytes);
  });
  it("protects a retained credential identity from internal lifecycle journal writers", () => {
    const f = fixture(); const pending = protectedCommand();
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const generation = f.database.getMeta().authorityGeneration;
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    assert.throws(() => f.database.withAuthorityTransaction((repositories) => repositories.lifecycleJournal.insertCommand({
      kind: "run-lifecycle", commandId: pending.commandId, operation: "create",
      requestFingerprint: "0".repeat(64), fence: { kind: "none" }, recordedAt: pending.requestedAt,
    })), CommandIdentityConflictError);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.execute(pending).state, "applied");
  });
  it("refuses a retained credential identity before async worker-pool effects", async () => {
    const f = fixture(); seedSyntheticRuntimeConfig(f.database);
    const pending = protectedCommand();
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    const before = f.store.read();
    const generation = f.database.getMeta().authorityGeneration;
    let effects = 0;
    const unused = (): never => { effects++; throw new Error("unexpected kernel seam"); };
    const ids = { uuid: randomUUID };
    const kernel = createCommandKernel({
      authority: f.database, clock: f.clock, ids,
      lifecycle: new RunRecordService({ database: f.database, clock: f.clock, ids, publishQueued: () => {} }),
      appVersion: "0.1.0", archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
      configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      descriptors: { resolve: (id) => DESCRIPTORS.find((descriptor) => String(descriptor.id) === id) },
      writeResolution: { resolvePresent: unused, resolveAbsent: unused },
      workerRuntime: { pool: {
        planPoolWorkerCount: () => { effects++; return Promise.resolve({ state: "accepted", workerIds: ["person-lookup-worker-1"] }); },
        spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
        stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused,
      } },
    });
    const command = { family: "worker-browser", type: "plan-worker-count", commandId: pending.commandId,
      requestedAt: pending.requestedAt, requestedBy: "local-operator", source: "dashboard",
      target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } };
    const result = await kernel.executeWorkerPool(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "command-divergent");
    assert.equal(effects, 0, "phase A must refuse before the external process seam, even though phase C also checks identity");
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.database.authority.workerPools.get("person-lookup"), undefined);
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.execute(pending).state, "applied");
    // Positive control: the same valid pool request reaches its effect with a fresh ID.
    assert.equal((await kernel.executeWorkerPool({ ...command, commandId: randomUUID() })).state, "applied");
    assert.equal(effects, 1);
    assert.deepEqual(readFileSync(path), bytes);
  });
  it("refuses CAS conflicts without changing ordinary authority", () => {
    const f = fixture(); f.execute(ordinary()); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.equal(f.execute(request).state, "conflict");
    assert.equal(f.database.getMeta().authorityGeneration, before);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
  });
  it.each(["schema", "fingerprint"] as const)("refuses an invalid ordinary %s before authority access", (field) => {
    const f = fixture(); const command = ordinary();
    if (field === "schema") command.payload.settingsSchemaHash = FingerprintSchema.parse("0".repeat(64));
    else command.payload.patchFingerprint = "0".repeat(64);
    const refused = f.execute(command, { withAuthorityTransaction: () => { throw new Error("forbidden authority access"); } });
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, field === "schema" ? "schema-mismatch" : "patch-fingerprint-mismatch");
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
    const foreign = f.execute({ ...ordinary(), commandId: request.commandId }, restored);
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.equal(foreign.code, "command-divergent");
    assert.equal(restored.authority.commands.get(request.commandId), undefined);
    assert.equal(restored.authority.commandAudits.findByCommand(request.commandId), undefined);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
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
