import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { spawnSync } from "node:child_process";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../src/backend/storage/sqlite/migrations.js";
import { SettingsCurrentRecordSchema } from "../../../../../src/models/config/settings-current.js";
import { fixtureAdmission, installationAdmission, releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { WorkerProcessLockFileSchema, readRuntimeProcessLock } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS, persistCorruptJournaledSettings } from "../../../../support/fixtures/integration/settings-runtime-corruption-fixtures.js";
import { AuthorityDatabase } from "../../../../support/helpers/admission-fixture.js";

const { cleanups, composeDashboardRuntime, copyRuntimePackageFixture, cleanup } = createDashboardPortTestWorld(() => {
      vi.mocked(fsyncSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(openSync).mockReset();
      vi.mocked(mkdirSync).mockReset();
      vi.restoreAllMocks();
    }, () => releaseAdmissionFixtures());


vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: vi.fn(actual.fsyncSync),
    readFileSync: vi.fn(actual.readFileSync),
    openSync: vi.fn(actual.openSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

afterEach(cleanup);

describe("composed dashboard runtime over an owned loopback socket", () => {
  it("unwinds an initial preflight refresh rejection and keeps authority admission recoverable", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-preflight-unwind-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const path = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db");
    const primary = new Error("injected preflight clock failure");
    const baseClock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const clock = { ...baseClock, monotonicMs: () => { throw primary; } };

    await assert.rejects(composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      clock,
      repoRoot,
    }), (error: unknown) => error instanceof AggregateError && error.errors.includes(primary));

    const lock = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(lock);
    assert.equal(typeof lock.releasedAt, "string", "the server record releases after startup cleanup closes authority");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "startup-unwind-test" }, baseClock);
    try {
      assert.ok(database.getMeta().schemaVersion >= CURRENT_AUTHORITY_SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });

  it("preserves an HTTP bind rejection while unwinding the constructed dashboard", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-listen-unwind-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const primary = new Error("injected HTTP listen failure");

    await assert.rejects(composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      httpServerStarter: async () => { throw primary; },
    }), (error: unknown) => error === primary);

    const lock = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(lock);
    assert.equal(typeof lock.releasedAt, "string");
    const database = AuthorityDatabase.open({
      path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "startup-unwind-test",
    });
    database.close();
  });

  it("refuses a missing saved settings singleton when active revision proves one existed", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-evidence-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    const initial = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
    await initial.stop();
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DELETE FROM settings");
    } finally {
      raw.close();
    }

    await assert.rejects(composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /settings-current-missing-with-history/u);
    const lock = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(lock);
    assert.equal(typeof lock.releasedAt, "string");
  });

  it("admits an empty pre-created state root as a virgin authority", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-virgin-root-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    });
    await runtime.stop();
    assert.ok(existsSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db")));
  });

  it("refuses an established state root with no authority database before taking the server lock", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-missing-authority-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, "retained-evidence"), "evidence");
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");

    await assert.rejects(composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /state root is established but its authority database is missing/u);

    assert.equal(existsSync(lockPath), false, "missing established authority is refused before process-lock admission");
    assert.equal(existsSync(join(stateRoot, "state.db")), false);
  });

  it("refuses a settings-family-only root instead of regenerating its missing authority", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-only-root-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(join(stateRoot, "settings"), { recursive: true });
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");

    await assert.rejects(composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /state root is established but its authority database is missing/u);

    assert.equal(existsSync(join(stateRoot, "state.db")), false);
    assert.equal(existsSync(lockPath), false, "a non-virgin settings family blocks before process-lock admission");
  });

  it("recovers after genuine abandoned server custody and retains dead worker evidence", async () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-compose-crash-")));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    installationAdmission(repoRoot);
    const processLockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const abandon = (worker: boolean) => {
      const modulePath = join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts");
      const code = `import { acquireRuntimeProcessLock } from ${JSON.stringify(modulePath)}; const root=${JSON.stringify(processLockRoot)}; const server=acquireRuntimeProcessLock({processLockRoot:root,name:"server",pid:process.pid}); if(${String(worker)})acquireRuntimeProcessLock({processLockRoot:root,name:"workers",workerId:"orphan-worker",pid:process.pid}); console.log(server.acquisitionId); process.exit(23);`;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
      assert.equal(child.status, 23, child.stderr);
      const record = readRuntimeProcessLock(processLockRoot, "server");
      assert.ok(record); assert.equal(record.acquisitionId, child.stdout.trim());
      assert.equal(record.releasedAt, null);
      const claim = join(processLockRoot, "server-claims", `${String(record.generation)}.claim.json`);
      return { record, claim, bytes: readFileSync(claim) };
    };
    const crashed = abandon(false);
    const recovered = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, clock, repoRoot });
    assert.deepEqual(readFileSync(crashed.claim), crashed.bytes);
    await recovered.stop();
    const stopped = readRuntimeProcessLock(processLockRoot, "server");
    assert.ok(stopped); assert.equal(stopped.pid, process.pid); assert.equal(typeof stopped.releasedAt, "string");
    const secondCrash = abandon(true);
    const orphanFiles = readdirSync(join(processLockRoot, "workers")).filter(name => name.endsWith(".lock.json"));
    assert.equal(orphanFiles.length, 1);
    const orphanPath = join(processLockRoot, "workers", orphanFiles[0] ?? "");
    const orphan = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(orphanPath, "utf8")));
    assert.ok("workerId" in orphan); assert.equal(orphan.workerId, "orphan-worker"); assert.equal(orphan.releasedAt, null);
    const orphanBytes = readFileSync(orphanPath);
    const second = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, clock, repoRoot });
    try {
      const readiness = await createDashboardClient({ baseUrl: `http://127.0.0.1:${String(second.port)}` }).readiness();
      assert.equal(readiness.state, "present");
      if (readiness.state === "present") {
        const check = readiness.checks.find(({ id }) => id === "process.orphans");
        assert.equal(check?.verdict, "warning"); assert.match(check?.detail ?? "", /1 unreleased dead process owner record/u);
      }
    } finally { await second.stop(); }
    assert.deepEqual(readFileSync(orphanPath), orphanBytes);
    assert.deepEqual(readFileSync(crashed.claim), crashed.bytes);
    assert.deepEqual(readFileSync(secondCrash.claim), secondCrash.bytes);
    const current = readRuntimeProcessLock(processLockRoot, "server");
    assert.ok(current); assert.equal(current.pid, process.pid); assert.equal(typeof current.releasedAt, "string");
  });

  it("refuses a newer authority under the current build before settings opens or config resolution", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "relay-compose-newer-authority-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    const artifactRoot = join(repoRoot, rebuildRuntimeIsolation.artifactRoot);
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const path = join(stateRoot, "state.db");
    AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "native-schema-refusal-fixture" }).close();
    const admission = installationAdmission(repoRoot);
    const artifactBefore = statSync(artifactRoot);
    const newer = new DatabaseSync(path);
    newer.exec("PRAGMA user_version=2");
    newer.close();
    const before = readFileSync(path);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 2);
      assert.notEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'database_upgrades'").get(), undefined);
    } finally {
      raw.close();
    }
    // A readable planted settings file makes the early-read negative control
    // reach the same authority refusal rather than failing on ENOENT first.
    mkdirSync(join(stateRoot, "settings"), { recursive: true, mode: 0o700 });
    writeFileSync(join(stateRoot, "settings", "settings.json"), "{}", { mode: 0o600 });

    {
      const resolver = await import("../../../../../src/backend/app/config/resolve.js");
      const resolveSpy = vi.spyOn(resolver, "resolveConfigWithProvenance");
      const { composeDashboardRuntime: composeCurrentBuild } = await import("../../../../../src/backend/app/composition/dashboard/compose.js");
      vi.mocked(readFileSync).mockClear();
      vi.mocked(openSync).mockClear();
      vi.mocked(mkdirSync).mockClear();
      try {
        await assert.rejects(composeCurrentBuild({ admission,
          isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0,
          env: {}, clock: manualClock(new Date("2026-08-28T12:00:00.000Z")), repoRoot,
        }), new RegExp(`authority schema 2 does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`, "u"));

        const isSettingsPath = (value: unknown): boolean => typeof value === "string"
          && (value.startsWith(join(stateRoot, "settings", "settings.json"))
            || value.startsWith(join(stateRoot, "settings") + "/"));
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "zero settings-family openSync calls before downgrade refusal");
        assert.equal(vi.mocked(readFileSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "zero settings-family readFileSync calls before downgrade refusal");
        assert.equal(resolveSpy.mock.calls.length, 0, "zero resolveConfigWithProvenance calls before downgrade refusal");
        assert.equal(vi.mocked(mkdirSync).mock.calls.filter(([target]) => target === stateRoot).length,
          1, "native open verifies its admitted existing directory before schema refusal");
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => target === artifactRoot).length,
          1, "native open validates its admitted artifact directory before schema refusal");
        const artifactAfter = statSync(artifactRoot);
        assert.equal(artifactAfter.mode & 0o777, 0o700);
        for (const key of ["dev", "ino", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(artifactAfter[key], artifactBefore[key], `artifact directory ${key} unchanged`);
        assert.equal(existsSync(lockPath), false, "native schema refusal acquires no server process record");
        assert.deepEqual(readFileSync(path), before);
      } finally {
        resolveSpy.mockRestore();
      }
    }
  });

  it.each([29, CURRENT_AUTHORITY_SCHEMA_VERSION + 1])("releases the acquired server process record after unsupported native authority %s refuses open", async version => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-unsupported-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    installationAdmission(repoRoot);
    const path = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db");
    AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "unsupported-schema-fixture" }).close();
    const raw = new DatabaseSync(path);
    try { raw.exec(`UPDATE database_states SET schema_version=${String(version)} WHERE id=1; PRAGMA user_version=${String(version)}`); } finally { raw.close(); }
    const before = readFileSync(path);
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    await assert.rejects(composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, repoRoot, clock }), new RegExp(`authority schema ${String(version)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`, "u"));
    const released = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(released); assert.equal(released.pid, process.pid); assert.equal(released.releasedAt, "2026-08-28T12:00:00.000Z");
    assert.deepEqual(readFileSync(path), before);
    const unchanged = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), version); } finally { unchanged.close(); }
  });

  it("serves the exact editable settings command schema hash", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-schema-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const bootstrap = await client.bootstrap();

    assert.equal(bootstrap.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
  });

  it("ignores retired malformed file authority and serves the SQLite baseline", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-retired-settings-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const authorityPath = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db");
    mkdirSync(dirname(authorityPath), { recursive: true });
    AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "retired-settings-fixture" }).close();
    const path = join(repoRoot, ".tracker", "settings", "settings.json");
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "retired malformed file");
    const runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
    try {
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      const editor = await client.editableSettings();
      assert.equal(editor.revision, 1);
      assert.equal(readFileSync(path, "utf8"), "retired malformed file");
    } finally { await runtime.stop(); }
  });

  it.each(SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS)(
    "refuses valid settings bytes with corrupt $label on dashboard boot",
    async (corruption) => {
      const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-corrupt-settings-"));
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({ name: "probe", version: "0.1.0" }),
      );
      cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
      const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
      const fixture = persistCorruptJournaledSettings({
        repoRoot,
        stateRoot: join(repoRoot, rebuildRuntimeIsolation.stateRoot),
        clock,
        corruption,
        activateRuntime: false,
        admission: installationAdmission(repoRoot),
      });

      await assert.rejects(async () => {
        const runtime = await composeDashboardRuntime({
          isolation: rebuildRuntimeIsolation,
          backendPortOverride: 0,
          env: {},
          clock,
          repoRoot,
        });
        await runtime.stop();
      }, corruption.id === "command-envelope" ? /command-row-identity-mismatch/u : /command-audit-settlement-mismatch/u);

      const raw = new DatabaseSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"), { readOnly: true });
      try {
        const row = raw.prepare("SELECT payload_json FROM settings WHERE id='current'").get();
        assert.equal(typeof row?.payload_json, "string");
        if (typeof row?.payload_json !== "string") throw new Error("fixture settings row missing");
        assert.deepEqual(SettingsCurrentRecordSchema.parse(Reflect.get(JSON.parse(row.payload_json), "saved")), fixture.record);
      } finally { raw.close(); }
    },
  );
});
