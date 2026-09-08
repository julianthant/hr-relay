import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../src/infra/sqlite/migrations.js";
import { QUEUED_RUN, START_PLAN, WORKER_START_REQUEST, RUN_SESSION } from "../fixtures/phase1f-run-fixtures.js";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { composeDashboardRuntime } from "../../src/server/dashboard/compose.js";
import { CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";
import { DeletedRunRecordSchema } from "../../src/domain/run/deleted-run.js";
import { SETTINGS_SCHEMA_HASH as HISTORICAL_HASH, derivePersistedSettingsFingerprint as historicalFingerprint, deriveSettingsPatchFingerprint as historicalPatchFingerprint } from "../../src/infra/compat/pre-floor-settings.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { GATE_RESULT } from "../fixtures/phase1c-contract-fixtures.js";
import { manualClock } from "../../src/domain/clock.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { doctorAuthorityStorage } from "../../src/infra/sqlite/storage-doctor.js";
import { requireSecret } from "../../src/domain/secrets.js";
import { inspectAuthorityBackupReadOnly } from "../../src/infra/compat/backup-inspection.js";
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
      const row = source.prepare("SELECT * FROM workflow_runs").get(); assert.ok(row);
      const columns = Object.keys(row);
      raw.prepare(`INSERT INTO tasks (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      prior = raw.prepare("SELECT * FROM tasks").get();
    } finally { source.close(); raw.close(); rmSync(seedPath); }
    await f.backup(); assert.equal((await f.run()).state, "converted");
    const after = new DatabaseSync(f.path);
    try { assert.deepEqual(after.prepare("SELECT * FROM workflow_runs").get(), prior); } finally { after.close(); }
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
  it("plans a fresh root without files, creates v35 directly, and reruns without writes", async () => {
    const f = fixture(); const before = readdirSync(f.root);
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(readdirSync(f.root), before);
    assert.equal((await f.run()).state, "converted");
    assert.equal(read(f).meta.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
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
    assert.equal(read(f).meta.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
  });
  it.each([29, 30, 31, 32, 33, 34])("requires a current verified backup before v%s conversion and preserves it", async (version) => {
    const f = fixture(version); const before = readFileSync(f.path);
    await assert.rejects(f.run(true), /backup-required/u);
    assert.deepEqual(readFileSync(f.path), before);
    const backup = await f.backup(); assert.equal(backup.state, "verified");
    assert.equal((await f.run(true)).fromSchemaVersion, version);
    assert.deepEqual(readFileSync(f.path), before);
    assert.equal((await f.run()).state, "converted");
    assert.equal(read(f).meta.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
  });
  it.each([32, 33, 34])("refuses to supersede an unfinished schema-%s settings conversion", async (version) => {
    const seed = fixture(); await seed.run();
    const source = new DatabaseSync(seed.path, { readOnly: true });
    let pending: Record<string, unknown>;
    try { pending = JSON.parse(String(source.prepare("SELECT record_json FROM authority_upgrades WHERE phase='committed'").get()?.record_json)) as Record<string, unknown>; }
    finally { source.close(); }
    const f = fixture(version);
    const raw = new DatabaseSync(f.path);
    try { raw.prepare("INSERT INTO authority_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)").run(String(pending.recordKey), String(pending.upgradeId), "committed", canonicalJsonStringify({ ...pending, fromSchemaVersion: 29, toSchemaVersion: version }), now); }
    finally { raw.close(); }
    const before = readFileSync(f.path);
    await assert.rejects(f.run(true), new RegExp(`upgrade-pending: finish the interrupted schema-${String(version)}`, "u"));
    assert.deepEqual(readFileSync(f.path), before);
  });
  it.each([32, 33, 34])("renames a v%s database without reimporting settings or touching independent credentials", async (version) => {
    const seed = fixture();
    writeFileSync(seed.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=3\nUCPATH_PASSWORD=synthetic-batch-upgrade\n", { mode: 0o600 });
    await seed.run();
    const f = fixture(version);
    const source = new DatabaseSync(seed.path, { readOnly: true });
    const target = new DatabaseSync(f.path);
    const tables = ["commands", "command_audits", "settings_current", "runtime_config"];
    const before = new Map<string, unknown[]>();
    try {
      for (const table of tables) {
        const rows = source.prepare(`SELECT * FROM ${table}`).all(); before.set(table, rows);
        for (const row of rows) {
          const columns = Object.keys(row);
          target.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
        }
      }
    } finally { source.close(); target.close(); }
    cpSync(join(seed.root, "credentials"), join(f.root, "credentials"), { recursive: true });
    const credentialPath = join(f.root, "credentials", "protected.json");
    const credentialBytes = readFileSync(credentialPath);
    // Retired import material must not override current SQLite settings.
    writeFileSync(f.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=9\n", { mode: 0o600 });
    await f.backup();
    const plan = await f.run(true);
    assert.deepEqual(plan.importedKeys, []);
    assert.equal(plan.credentials, "verified");
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("schema-only-interrupted"); } } }, clock), /schema-only-interrupted/u);
    assert.equal((await f.run()).credentials, "verified");
    assert.equal(read(f).settings.settings.concurrency?.defaultWorkers, 3);
    const after = new DatabaseSync(f.path, { readOnly: true });
    try { for (const table of tables) assert.deepEqual(after.prepare(`SELECT * FROM ${table}`).all(), before.get(table), table); }
    finally { after.close(); }
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    assert.equal((await f.run()).state, "already-upgraded");
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
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(readFileSync(privatePath), privateBytes);
    assert.deepEqual(readFileSync(f.path), databaseBytes);
    writeFileSync(f.input.environmentFile, "UCPATH_PASSWORD=private-upgrade-changed\n", { mode: 0o600 });
    await assert.rejects(f.run(true), /credential-import-refused/u);
    assert.deepEqual(readFileSync(privatePath), privateBytes);
    assert.deepEqual(readFileSync(f.path), databaseBytes);
    await assert.rejects(f.run(), /credential-import-refused/u);
    assert.deepEqual(readFileSync(privatePath), privateBytes);
    assert.deepEqual(readFileSync(f.path), databaseBytes);
    writeFileSync(f.input.environmentFile, original, { mode: 0o600 });
    assert.equal((await f.run()).state, "converted");
    assert.equal(store.read().revision, 2);
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(store)), "private-upgrade-original");
    assert.equal(readFileSync(f.path).includes(Buffer.from("private-upgrade-original")), false);
  });

  it.each([
    { label: "removed protected input", changed: "" },
    { label: "changed ordinary input", changed: "UCPATH_PASSWORD=private-upgrade-original\nHRAUTO_DEFAULT_WORKERS=3\n" },
  ])("refuses $label in a pre-SQL retry during read-only planning", async ({ changed }) => {
    const f = fixture(29);
    const original = "UCPATH_PASSWORD=private-upgrade-original\n";
    writeFileSync(f.input.environmentFile, original, { mode: 0o600 });
    await f.backup();
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("injected-binding-boundary"); } } }, clock), /injected-binding-boundary/u);
    const privatePath = join(f.root, "credentials", "protected.json");
    const privateBytes = readFileSync(privatePath);
    const databaseBytes = readFileSync(f.path);
    writeFileSync(f.input.environmentFile, changed, { mode: 0o600 });
    await assert.rejects(f.run(true), /credential-import-refused/u);
    await assert.rejects(f.run(), /credential-import-refused/u);
    assert.deepEqual(readFileSync(privatePath), privateBytes);
    assert.deepEqual(readFileSync(f.path), databaseBytes);
    assert.equal(readFileSync(f.input.environmentFile, "utf8"), changed);
    writeFileSync(f.input.environmentFile, original, { mode: 0o600 });
    assert.equal((await f.run(true)).state, "planned");
    assert.equal((await f.run()).state, "converted");
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
    // Retain the original before spying; call below supplies the actual database receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transaction = AuthorityDatabase.prototype.withAuthorityTransaction;
    const hooks = boundary === "rename" ? { afterCredentialRename: () => { throw new Error("injected-after-rename"); } }
      : { afterCommit: () => {
        vi.spyOn(AuthorityDatabase.prototype, "withAuthorityTransaction").mockImplementationOnce(function (this: AuthorityDatabase, work) {
          return transaction.call(this, (repositories) => { work(repositories); throw new Error("injected-audit-failure"); });
        });
      } };
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


const RENAMED_TABLES = [
  ["leases", "workflow_workers"],
  ["duo_ceremony_leases", "worker_auth"],
  ["start_plans", "workflow_run_requests"],
] as const;

/** Build historical rows through real repositories, then copy their complete SQL shape. */
async function populatedWorkerRenameFixture(version: 33 | 34) {
  const seed = fixture();
  await seed.run();
  const database = AuthorityDatabase.open({ path: seed.path, busyTimeoutMs: 250, migrationOwner: "rename-seed" }, clock);
  try {
    database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
    assert.equal(database.authority.workerLeases.start(WORKER_START_REQUEST).state, "started");
    assert.equal(database.authority.workerLeases.reportLifecycle({ workerId: WORKER_START_REQUEST.workerId,
      leaseGeneration: 1, lifecycle: { state: "stopped", startedAt: WORKER_START_REQUEST.now,
        stoppedAt: now, reason: "operator" }, now }).state, "applied");
    assert.equal(database.authority.workerLeases.start({ ...WORKER_START_REQUEST, now }).state, "started");
    assert.equal(database.authority.workerLeases.reportLifecycle({ workerId: WORKER_START_REQUEST.workerId,
      leaseGeneration: 2, lifecycle: { state: "busy", startedAt: now, heartbeatAt: now, runId: QUEUED_RUN.envelope.runId }, now }).state, "applied");
    const worker = database.authority.workerLeases.get(WORKER_START_REQUEST.workerId);
    assert.ok(worker);
    assert.equal(database.authority.workerLeases.control({ workerId: worker.workerId, expectedVersion: worker.version,
      control: { directive: "pause", requestedAt: now, requestedBy: "local-operator" }, now }).state, "applied");
    database.authority.workerPools.plan({ workflow: WORKER_START_REQUEST.workflow, desiredWorkers: 2,
      expectedVersion: 0, requestedBy: "local-operator", now });
    const auth = database.authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64),
      workerId: WORKER_START_REQUEST.workerId, system: "ucpath", now, ttlMs: 80_000 });
    assert.equal(auth.state, "acquired");
    database.authority.startPlans.create(START_PLAN);
    const consumedId = "aaaaaaaa-1111-4111-8111-111111111111";
    const unusedId = "aaaaaaaa-2222-4222-8222-222222222222";
    database.authority.startPlans.create({ ...START_PLAN, startPlanId: consumedId });
    database.authority.startPlans.create({ ...START_PLAN, startPlanId: unusedId, expiresAt: "2027-01-01T00:00:00.000Z",
      refused: [{ entry: 2, rawInput: { emplId: "invalid" }, code: "input-invalid", message: "Invalid synthetic entry" }] });
    assert.equal(database.authority.startPlans.consume({ startPlanId: consumedId,
      descriptorFingerprint: START_PLAN.descriptorFingerprint, configFingerprint: START_PLAN.configFingerprint,
      ingressSchemaHash: START_PLAN.ingressSchemaHash, canonicalInputSchemaHash: START_PLAN.canonicalInputSchemaHash,
      inputFingerprint: START_PLAN.inputFingerprint,
      expectedVersion: 1, commandId: "aaaaaaaa-3333-4333-8333-333333333333", now: START_PLAN.plannedAt }).state, "consumed");
    database.authority.runSessions.insert(RUN_SESSION);
    database.authority.runSessions.setGrouping(RUN_SESSION.sessionId, 1, true);
    database.authority.runSessions.insert({ ...RUN_SESSION, sessionId: "aaaaaaaa-4444-4444-8444-444444444444" });
    database.authority.runs.enqueue({ ...QUEUED_RUN, sessionId: RUN_SESSION.sessionId });
    assert.equal(database.authority.runs.claimNext({ workflow: QUEUED_RUN.envelope.workflow,
      workerId: WORKER_START_REQUEST.workerId, now }).state, "claimed");
  } finally { database.close(); }
  const f = fixture(version);
  const pairs = [...RENAMED_TABLES, ...["worker_pools", "config_snapshots", "workflow_run_batches", "workflow_runs"].map((name) => [name, name] as const)];
  const before = new Map<string, ReturnType<ReturnType<DatabaseSync["prepare"]>["all"]>>();
  const source = new DatabaseSync(seed.path, { readOnly: true });
  const target = new DatabaseSync(f.path);
  try {
    for (const [oldName, currentName] of pairs) {
      const rows = source.prepare(`SELECT * FROM ${currentName} ORDER BY record_key`).all();
      assert.ok(rows.length > 0, `${currentName} preservation fixture must be populated`);
      before.set(currentName, rows);
      for (const row of rows) {
        const columns = Object.keys(row);
        target.prepare(`INSERT INTO ${oldName} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      }
    }
  } finally { source.close(); target.close(); }
  return { ...f, before };
}

describe("worker/auth/request SQL rename through stopped upgrade", () => {
  it.each([33, 34] as const)("preserves complete populated v%s rows, grouping, historical backup and current readback", async (version) => {
    const f = await populatedWorkerRenameFixture(version);
    const original = readFileSync(f.path);
    const historical = inspectAuthorityBackupReadOnly(f.path);
    assert.equal(historical.counts.leases, 1);
    assert.equal(historical.authorityContentFingerprint, preRenameFingerprint(f.path));
    assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "ordinary-start" }, clock), /upgrade-required/u);
    assert.deepEqual(readFileSync(f.path), original);
    const backup = await f.backup();
    assert.equal(backup.state, "verified");
    assert.equal(backup.manifests[0]?.authorityContentFingerprint, historical.authorityContentFingerprint);
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(readFileSync(f.path), original, "rehearsal must roll back every rename");
    assert.equal((await f.run()).state, "converted");
    const after = new DatabaseSync(f.path, { readOnly: true });
    try {
      for (const [table, rows] of f.before) assert.deepEqual(after.prepare(`SELECT * FROM ${table} ORDER BY record_key`).all(), rows, table);
      for (const [oldName] of RENAMED_TABLES) assert.equal(after.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name=?").get(oldName), undefined);
      assert.equal(after.prepare("SELECT name FROM sqlite_schema WHERE name='runs_view'").get(), undefined);
      assert.deepEqual(after.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { after.close(); }
    const current = inspectAuthorityBackupReadOnly(f.path);
    assert.equal(current.schemaVersion, 35);
    assert.equal(current.counts.leases, 1);
    const currentBackup = await f.backup();
    assert.equal(currentBackup.manifests[0]?.authorityContentFingerprint, current.authorityContentFingerprint);
    const settled = readFileSync(f.path);
    assert.equal((await f.run()).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), settled);
  });

  it.each([33, 34] as const)("rolls back populated v%s before commit and resumes exactly after commit", async (version) => {
    const f = await populatedWorkerRenameFixture(version);
    await f.backup();
    const before = readFileSync(f.path);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("rename-before-commit"); } } }, clock), /rename-before-commit/u);
    assert.deepEqual(readFileSync(f.path), before);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("rename-after-commit"); } } }, clock), /rename-after-commit/u);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 35);
    assert.equal((await f.run()).state, "converted");
    const after = new DatabaseSync(f.path, { readOnly: true });
    try {
      for (const [table, rows] of f.before) assert.deepEqual(after.prepare(`SELECT * FROM ${table} ORDER BY record_key`).all(), rows, table);
      assert.equal(after.prepare("SELECT count(*) AS n FROM authority_upgrades WHERE phase='committed'").get()?.n, 1);
      assert.equal(after.prepare("SELECT count(*) AS n FROM authority_upgrades WHERE phase='settled'").get()?.n, 1);
    } finally { after.close(); }
  });

  it.each(RENAMED_TABLES)("refuses corrupt historical %s records instead of omitting their validation", async (oldName) => {
    const f = await populatedWorkerRenameFixture(34);
    const raw = new DatabaseSync(f.path);
    try { raw.exec(`UPDATE ${oldName} SET record_json='{}'`); } finally { raw.close(); }
    const before = readFileSync(f.path);
    await assert.rejects(f.backup(), /authority-record-invalid/u);
    await assert.rejects(f.run(), /authority-record-invalid/u);
    assert.deepEqual(readFileSync(f.path), before);
  });

  it.each(["leases", "duo_ceremony_leases"])("retains historical %s mirrored-column invariants", async (table) => {
    const f = await populatedWorkerRenameFixture(34);
    const raw = new DatabaseSync(f.path);
    try { raw.exec(`UPDATE ${table} SET version=version+1`); } finally { raw.close(); }
    await assert.rejects(f.backup(), /authority-invariant-invalid/u);
  });
});


/** Frozen from schema-34 release 35635a04, independent of the current registry/order. */
const PRE_RENAME_FINGERPRINT_ORDER = [
  "authority_meta", "tasks", "workflow_runs", "run_terminal_authorizations", "failures",
  "run_results", "run_terminal_outbox", "diagnostic_bundles", "diagnostic_attachments", "evidence_receipts",
  "dry_run_scenario_results", "operator_xlsx_exports", "activity_person_pseudonyms", "activity_person_pseudonym_generations", "knowledge_records",
  "fix_records", "ledger_partitions", "ledger_projections", "provider_budget_counters", "provider_admissions",
  "leases", "dependencies", "delegation_manifests", "commands", "command_audits",
  "bulk_command_acceptances", "notifications", "config_snapshots", "settings_current", "runtime_config",
  "version_plans", "checkpoint_payloads", "run_checkpoints", "start_plans", "ocr_approvals",
  "capture_sessions", "capture_photo_order", "capture_finalization_outboxes", "write_intents", "write_attempts",
  "durable_outbox", "artifact_outbox", "artifact_sink_heads", "intake_sessions", "intake_manifests",
  "ocr_extractions", "version_bump_applications", "archived_runs", "archive_relaunches", "duo_ceremony_leases",
  "worker_pools", "run_sessions", "workflow_run_batches", "deleted_runs", "protected_settings_current",
  "authority_upgrades",
] as const;
function preRenameFingerprint(path: string): string {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const present = new Set(raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name));
    const entries = PRE_RENAME_FINGERPRINT_ORDER.filter((name) => present.has(name)).map((name) => [name,
      name === "authority_meta"
        ? raw.prepare("SELECT singleton_id,schema_version,authority_generation,updated_at,migration_owner,migration_started_at FROM authority_meta").get()
        : raw.prepare(`SELECT record_key,record_json FROM ${name} ORDER BY record_key`).all(),
    ]);
    return createHash("sha256").update(canonicalJsonStringify(entries)).digest("hex");
  } finally { raw.close(); }
}
