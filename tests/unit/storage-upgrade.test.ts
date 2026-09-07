import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { composeDashboardRuntime } from "../../src/server/dashboard/compose.js";
import { CONFIG_SNAPSHOT } from "./fixtures/phase1c-contract-fixtures.js";
import { DeletedRunRecordSchema } from "../../src/domain/run/deleted-run.js";
import { SETTINGS_SCHEMA_HASH as HISTORICAL_HASH, derivePersistedSettingsFingerprint as historicalFingerprint, deriveSettingsPatchFingerprint as historicalPatchFingerprint } from "../../src/infra/compat/pre-floor-settings.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GATE_RESULT } from "./fixtures/phase1c-contract-fixtures.js";
import { manualClock } from "../../src/domain/clock.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { doctorAuthorityStorage } from "../../src/infra/sqlite/storage-doctor.js";
import { requireSecret } from "../../src/domain/secrets.js";
import { readSettings, createCredentialSecretSource } from "../../src/server/settings-runtime.js";

const roots: string[] = [];
const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(version?: number) {
  const repoRoot = mkdtempSync(join(tmpdir(), "storage-upgrade-")); roots.push(repoRoot);
  const root = join(repoRoot, rebuildRuntimeIsolation.stateRoot); mkdirSync(root, { mode: 0o700 });
  copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
  copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
  const path = join(root, "state.db");
  if (version !== undefined) {
    const raw = new DatabaseSync(path);
    try {
      for (const migration of SQLITE_MIGRATIONS.filter((entry) => entry.version <= version)) for (const statement of migration.statements) raw.exec(statement);
      raw.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,?,7,?)").run(version, now);
      raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=${String(version)}`);
    } finally { raw.close(); }
  }
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { repoRoot, root, path, input, backup: () => backupStoppedAuthority(root, clock), run: (plan = false) => upgradeStorage({ ...input, plan }, clock) };
}
function read(f: ReturnType<typeof fixture>) {
  const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "upgrade-fixture-readback" }, clock);
  try { return { meta: database.getMeta(), settings: readSettings(database.authority) }; }
  finally { database.close(); }
}

describe("D336 stopped SQLite upgrade", () => {
  it("M2 preserves a stale claimed lifecycle row byte-for-byte without performing recovery", async () => {
    const f = fixture(29); const seedPath = join(f.root, "seed.db");
    const seed = AuthorityDatabase.open({ path: seedPath, busyTimeoutMs: 500, migrationOwner: "historical-claim-fixture" }, clock);
    try {
      seed.authority.runs.enqueue(QUEUED_RUN);
      assert.equal(seed.authority.runs.claimNext({ workflow: QUEUED_RUN.envelope.workflow, workerId: "stale-worker", now: "2026-09-01T12:00:00.000Z" }).state, "claimed");
    } finally { seed.close(); }
    const source = new DatabaseSync(seedPath); const raw = new DatabaseSync(f.path);
    let prior: unknown;
    try {
      const row = source.prepare("SELECT * FROM tasks").get(); assert.ok(row);
      const columns = Object.keys(row);
      raw.prepare(`INSERT INTO tasks (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      prior = raw.prepare("SELECT * FROM tasks").get();
    } finally { source.close(); raw.close(); rmSync(seedPath); }
    await f.backup(); assert.equal((await f.run()).state, "converted");
    const after = new DatabaseSync(f.path);
    try { assert.deepEqual(after.prepare("SELECT * FROM tasks").get(), prior); } finally { after.close(); }
  });
  it("M13 preserves historical snapshot bytes and reports retained exposure without disclosing its value", async () => {
    const f = fixture(29);
    const config = { ...CONFIG_SNAPSHOT.config, operator: { timekeeperName: "synthetic-retained-historical-name" } };
    const snapshot = { ...CONFIG_SNAPSHOT, config, fingerprint: sha256Hex(canonicalJsonStringify(config)) };
    const bytes = canonicalJsonStringify(snapshot);
    const raw = new DatabaseSync(f.path);
    try { raw.prepare("INSERT INTO config_snapshots VALUES (?,?,?)").run(snapshot.configSnapshotId, bytes, snapshot.capturedAt); } finally { raw.close(); }
    await f.backup();
    const plan = await f.run(true); assert.deepEqual(plan.historicalExposure, ["operator.timekeeperName"]);
    assert.equal(JSON.stringify(plan).includes(config.operator.timekeeperName), false);
    assert.deepEqual((await f.run()).historicalExposure, ["operator.timekeeperName"]);
    const after = new DatabaseSync(f.path);
    try { assert.equal(after.prepare("SELECT record_json FROM config_snapshots").get()?.record_json, bytes); } finally { after.close(); }
  });
  it("M25 activates the converted ordinary revision at the next real dashboard boot", async () => {
    const f = fixture(29);
    writeFileSync(f.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=3\n", { mode: 0o600 });
    await f.backup(); await f.run();
    const before = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "before-activation" }, clock);
    try { assert.equal(before.authority.runtimeConfig.get(), undefined); assert.equal(readSettings(before.authority).revision, 2); } finally { before.close(); }
    const runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, repoRoot: f.repoRoot, env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 });
    try {
      const after = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "after-activation" }, clock);
      try { assert.equal(after.authority.runtimeConfig.get()?.settingsRevision, 2); assert.equal(readSettings(after.authority).settings.concurrency?.defaultWorkers, 3); } finally { after.close(); }
    } finally { await runtime.stop(); }
    assert.equal(readFileSync(f.input.environmentFile, "utf8"), "HRAUTO_DEFAULT_WORKERS=3\n");
  });
  it("plans a fresh root without files, creates v32 directly, and reruns without writes", async () => {
    const f = fixture(); const before = readdirSync(f.root);
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(readdirSync(f.root), before);
    assert.equal((await f.run()).state, "converted");
    assert.equal(read(f).meta.schemaVersion, 32);
    assert.equal(read(f).settings.revision, 1);
    assert.equal(existsSync(join(f.root, "credentials")), false);
    const bytes = readFileSync(f.path);
    assert.equal((await f.run()).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), bytes);
  });
  it("removes only its fresh uncommitted database after failure and permits exact rerun", async () => {
    const f = fixture();
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("injected-before-commit"); } } }, clock), /injected-before-commit/u);
    assert.equal(existsSync(f.path), false);
    assert.equal(createCredentialStore({ stateRoot: f.root }).read().revision, 1);
    assert.equal((await f.run()).state, "converted");
    assert.equal(read(f).meta.schemaVersion, 32);
  });
  it.each([29, 30, 31])("requires a current verified backup before v%s conversion and preserves it", async (version) => {
    const f = fixture(version); const before = readFileSync(f.path);
    await assert.rejects(f.run(true), /backup-required/u);
    assert.deepEqual(readFileSync(f.path), before);
    const backup = await f.backup(); assert.equal(backup.state, "verified");
    assert.equal((await f.run(true)).fromSchemaVersion, version);
    assert.deepEqual(readFileSync(f.path), before);
    assert.equal((await f.run()).state, "converted");
    assert.equal(read(f).meta.schemaVersion, 32);
  });
  it("settles credentials separately and resumes after the SQLite commit without editing sources", async () => {
    const f = fixture(29); const environment = "HRAUTO_DEFAULT_WORKERS=3\nUCPATH_PASSWORD=synthetic-upgrade-password\n";
    writeFileSync(f.input.environmentFile, environment, { mode: 0o600 });
    await f.backup();
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("interrupted-after-sqlite-commit"); } } }, clock), /interrupted-after-sqlite-commit/u);
    assert.equal(read(f).settings.settings.concurrency?.defaultWorkers, 3);
    assert.equal(createCredentialStore({ stateRoot: f.root }).read().revision, 1);
    assert.equal((await f.run()).state, "converted");
    assert.equal(createCredentialStore({ stateRoot: f.root }).read().revision, 2);
    assert.equal(readFileSync(f.input.environmentFile, "utf8"), environment);
    const dbBytes = readFileSync(f.path);
    assert.equal(dbBytes.includes(Buffer.from("synthetic-upgrade-password")), false);
    assert.equal((await f.run()).state, "already-upgraded");
  });
  it.each(["beforeCommit", "afterCommit"] as const)("binds private source bytes across a %s interruption before any credential application", async (boundary) => {
    const f = fixture(29);
    const original = "UCPATH_PASSWORD=private-upgrade-original\n";
    writeFileSync(f.input.environmentFile, original, { mode: 0o600 });
    await f.backup();
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { [boundary]: () => { throw new Error("injected-binding-boundary"); } } }, clock), /injected-binding-boundary/u);
    const store = createCredentialStore({ stateRoot: f.root });
    assert.equal(store.read().revision, 1);
    const privatePath = join(f.root, "credentials", "protected.json");
    const privateBytes = readFileSync(privatePath);
    const databaseBytes = readFileSync(f.path);
    assert.equal(databaseBytes.includes(Buffer.from("private-upgrade-original")), false);
    writeFileSync(f.input.environmentFile, "UCPATH_PASSWORD=private-upgrade-changed\n", { mode: 0o600 });
    await assert.rejects(f.run(), /credential-import-refused/u);
    assert.deepEqual(readFileSync(privatePath), privateBytes);
    assert.deepEqual(readFileSync(f.path), databaseBytes);
    writeFileSync(f.input.environmentFile, original, { mode: 0o600 });
    assert.equal((await f.run()).state, "converted");
    assert.equal(store.read().revision, 2);
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(store)), "private-upgrade-original");
    assert.equal(readFileSync(f.path).includes(Buffer.from("private-upgrade-original")), false);
  });

  it("refuses a missing private binding after SQLite commit instead of rebinding current source bytes", async () => {
    const f = fixture(29);
    writeFileSync(f.input.environmentFile, "UCPATH_PASSWORD=private-binding-required\n", { mode: 0o600 });
    await f.backup();
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("injected-binding-boundary"); } } }, clock), /injected-binding-boundary/u);
    const privatePath = join(f.root, "credentials", "protected.json");
    rmSync(privatePath);
    const bytes = readFileSync(f.path);
    await assert.rejects(f.run(true), /credential-import-refused/u);
    await assert.rejects(f.run(), /credential-import-refused/u);
    assert.equal(existsSync(privatePath), false);
    assert.deepEqual(readFileSync(f.path), bytes);
  });

  it.each(["rename", "audit"] as const)("keeps the committed credential after %s interruption and settles only exact retry", async (boundary) => {
    const f = fixture(29);
    const value = "synthetic-upgrade-boundary-secret";
    const environment = `UCPATH_PASSWORD=${value}\n`;
    writeFileSync(f.input.environmentFile, environment, { mode: 0o600 });
    await f.backup();
    const hooks = boundary === "rename" ? { afterCredentialRename: () => { throw new Error("injected-after-rename"); } }
      : { afterCommit: () => { vi.spyOn(AuthorityDatabase.prototype, "withAuthorityTransaction").mockImplementationOnce(() => { throw new Error("injected-audit-failure"); }); } };
    try {
      await assert.rejects(upgradeStorage({ ...f.input, hooks }, clock), /credential-(?:commit|audit)-uncertain/u);
    } finally { vi.restoreAllMocks(); }
    const store = createCredentialStore({ stateRoot: f.root });
    assert.equal(store.read().revision, 2);
    const credentialBytes = readFileSync(join(f.root, "credentials", "protected.json"));
    const before = read(f).meta.authorityGeneration;
    writeFileSync(f.input.environmentFile, "UCPATH_PASSWORD=divergent-boundary-value\n", { mode: 0o600 });
    await assert.rejects(f.run(), /credential-import-refused/u);
    assert.deepEqual(readFileSync(join(f.root, "credentials", "protected.json")), credentialBytes);
    assert.equal(read(f).meta.authorityGeneration, before);
    writeFileSync(f.input.environmentFile, environment, { mode: 0o600 });
    assert.equal((await f.run()).state, "converted");
    assert.equal(store.read().revision, 2);
    assert.deepEqual(readFileSync(join(f.root, "credentials", "protected.json")), credentialBytes);
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(store)), value);
    const doctor = await doctorAuthorityStorage({ stateRootTrustAnchor: f.root, stateRoot: f.root,
      authorityPath: f.path, backupDirectory: join(f.root, "backups", "authority"), busyTimeoutMs: 250 }, clock);
    assert.equal(doctor.protectedSettings.state, "available");
    assert.equal(JSON.stringify(doctor).includes(value), false);
    assert.equal(readFileSync(f.path).includes(Buffer.from(value)), false);
    assert.equal((await f.run()).state, "already-upgraded");
    assert.equal(readFileSync(f.input.environmentFile, "utf8"), environment);
  });

  it("removes only tombstoned gate records, preserves settled tallies, and keeps the delete trigger", async () => {
    const f = fixture(29);
    const deleted = { runId: GATE_RESULT.runId, workflow: "person-lookup", traceId: "pl-120000-2222", origin: "queue", commandId: randomUUID(),
      deletedAt: now, removed: [{ table: "tasks", rows: 1 }] };
    const raw = new DatabaseSync(f.path);
    const tally = JSON.stringify(deleted);
    const retained = { ...GATE_RESULT, runId: randomUUID() };
    try {
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_master WHERE name='deleted_runs_require_live_run_insert'").get()?.sql);
      raw.exec("DROP TRIGGER deleted_runs_require_live_run_insert");
      raw.prepare("INSERT INTO deleted_runs VALUES (?,?,?,?,?,?,?,?)").run(deleted.runId, deleted.workflow, deleted.traceId, deleted.origin, deleted.commandId, now, tally, now);
      raw.exec(trigger);
      for (const gate of [GATE_RESULT, retained]) raw.prepare("INSERT INTO checkpoint_payloads VALUES (?,?,?)").run(`${gate.runId}:${gate.gateId}`, JSON.stringify(gate), now);
    } finally { raw.close(); }
    await f.backup();
    assert.equal((await f.run(true)).orphanGateRecordsRemoved, 1);
    assert.equal((await f.run()).orphanGateRecordsRemoved, 1);
    const after = new DatabaseSync(f.path);
    try {
      assert.deepEqual(after.prepare("SELECT record_json FROM checkpoint_payloads").all().map((row) => row.record_json), [JSON.stringify(retained)]);
      assert.deepEqual(DeletedRunRecordSchema.parse(JSON.parse(String(after.prepare("SELECT record_json FROM deleted_runs").get()?.record_json))).removed, deleted.removed);
      assert.throws(() => after.prepare("UPDATE deleted_runs SET attempt=1").run(), /immutable/u);
      assert.throws(() => after.prepare("DELETE FROM checkpoint_payloads").run(), /never deleted/u);
      const journal = after.prepare("SELECT record_json FROM authority_upgrades WHERE phase='committed'").get();
      assert.equal(z.object({ orphanGateRecordsRemoved: z.number() }).parse(JSON.parse(String(journal?.record_json))).orphanGateRecordsRemoved, 1);
    } finally { after.close(); }
  });

  it("preserves an applied empty v29 revision and authenticates its immutable historical journal after conversion", async () => {
    const f = fixture(29); const commandId = randomUUID(); const auditId = randomUUID();
    const request = { family: "settings", type: "apply-settings", commandId, requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision: 1 }, payload: { settingsSchemaHash: HISTORICAL_HASH, patchFingerprint: historicalPatchFingerprint({}), patch: {} } };
    const commandFingerprint = sha256Hex(`hrauto:settings-command:v1\0${canonicalJsonStringify(request)}`);
    const settingsFingerprint = historicalFingerprint({});
    const lastApplied = { commandId, commandFingerprint, expectedRevision: 1, settingsSchemaHash: HISTORICAL_HASH, patchFingerprint: request.payload.patchFingerprint };
    const source = canonicalJsonStringify({ revision: 2, settingsSchemaHash: HISTORICAL_HASH, settingsFingerprint, settings: {}, lastApplied });
    writeFileSync(join(f.root, "settings.json"), source, { mode: 0o600 });
    writeFileSync(join(f.root, "settings.json.authority.json"), canonicalJsonStringify({ schemaVersion: 1, settingsPathFingerprint: sha256Hex(join(f.root, "settings.json")), settingsSchemaHash: HISTORICAL_HASH, state: "initialized" }), { mode: 0o600 });
    const raw = new DatabaseSync(f.path);
    try {
      const target = { family: "settings", revision: 2 };
      raw.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(commandId, "settings", canonicalJsonStringify(request), now);
      raw.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(auditId, commandId, canonicalJsonStringify({ auditId, request,
        result: { state: "applied", commandId, affectedTargets: [target], restartRequired: true, settingsRevision: 2, settingsFingerprint },
        completedAt: now, versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [] }), now);
      raw.prepare("INSERT INTO settings_current VALUES ('current',?,?,?,?,?,?,?)").run(2, settingsFingerprint, commandId, commandFingerprint, auditId, canonicalJsonStringify({ revision: 2, settingsFingerprint, commandId, commandFingerprint, auditId, committedAt: now }), now);
    } finally { raw.close(); }
    await f.backup();
    assert.equal((await f.run()).state, "converted");
    assert.equal(read(f).settings.revision, 2);
    assert.deepEqual(read(f).settings.settings, {});
    assert.equal(readFileSync(join(f.root, "settings.json"), "utf8"), source);
  });

});
