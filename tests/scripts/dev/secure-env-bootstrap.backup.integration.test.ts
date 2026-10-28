import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import nativeFs, { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it, vi } from "vitest";
import { createHistoricalFlatProfileFixture } from "../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { acquireRuntimeProcessLock } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { composeStorageCommand } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthoritySourceClosureUnprovedError } from "../../../src/backend/storage/source-closure.js";
import { runSecureEnvironmentBootstrap } from "../../../src/backend/app/bootstrap/secure-env-bootstrap.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];
const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
afterEach(async () => {
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function installation(options: { pending?: "storage" } = {}) {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "backup-bootstrap-"));
  roots.push(workspace);
  cpSync(join(repositoryRoot, "src"), join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "scripts", "dev"), { recursive: true });
  cpSync(join(repositoryRoot, "scripts", "dev", "secure-env-bootstrap.ts"), join(workspace, "scripts", "dev", "secure-env-bootstrap.ts"));
  cpSync(join(repositoryRoot, "package.json"), join(workspace, "package.json"));
  mkdirSync(join(workspace, "config"));
  cpSync(join(repositoryRoot, "config", "runtime-isolation.json"), join(workspace, "config", "runtime-isolation.json"));
  cpSync(join(repositoryRoot, "config", "test-data.json"), join(workspace, "config", "test-data.json"));
  cpSync(join(repositoryRoot, "config", "dashboard-workflow-sources.json"), join(workspace, "config", "dashboard-workflow-sources.json"));
  symlinkSync(join(repositoryRoot, "node_modules"), join(workspace, "node_modules"));
  const profile = await createBoundProfileFixture({ workspace, ...options }); profiles.push(profile);
  const stateRoot = profile.stateRoot, profileId = profile.admission.profileBinding.profileId;
  if (options.pending !== "storage") assert.equal(AuthorityDatabase.inspectExistingReadOnly(profile.admission, profile.path).schemaVersion,
    CURRENT_AUTHORITY_SCHEMA_VERSION);
  const processLockRoot = join(profile.machine.stateRoot, "locks");
  profile.admission.release(); profile.machine.release();
  return { workspace, lifetime: profile.lifetime, stateRoot, profileId, processLockRoot, backupDirectory: join(stateRoot, "backups", "authority"),
    run: () => spawnSync(process.execPath, ["--import", "tsx", "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "backup"],
      { cwd: workspace, encoding: "utf8", timeout: 20_000 }) };
}

it("backs up a current installation through real bootstrap admission and persists a verifiable manifest", async () => {
  const fixture = await installation();
  const source = readFileSync(join(fixture.stateRoot, "state.db"));
  const result = fixture.run();
  assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /backup: verified — authority-g\d+-/u);
  const files = readdirSync(fixture.backupDirectory);
  assert.equal(files.length, 2);
  const manifestName = files.find(name => name.endsWith(".manifest.json"));
  assert.ok(manifestName);
  const manifestPath = join(fixture.backupDirectory, manifestName);
  const manifest = parseBackupManifestFile(manifestPath);
  assert.equal(manifest.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
  assert.equal(manifest.profileId, fixture.profileId);
  assert.deepEqual(readFileSync(join(fixture.stateRoot, "state.db")), source);
  assert.ok(result.stdout.includes(manifest.backupFileName));
  const machine = acquireEntrypointAdmission(fixture.workspace, "exclusive", fixture.lifetime);
  const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(fixture.profileId));
  try {
    const verified = await verifyBackupManifestAtPath(admission, manifestPath,
      AuthorityDatabase.sourceDatabaseIdentity(join(fixture.stateRoot, "state.db")));
    assert.deepEqual(verified.manifest, manifest);
    assert.equal(verified.backupPath, join(fixture.backupDirectory, manifest.backupFileName));
  } finally { admission.release(); machine.release(); }
});

for (const change of ["no-selection", "unfinished", "foreign-binding"] as const) {
  it(`refuses a current CLI backup for ${change} without creating or changing authority`, async () => {
    const fixture = await installation(change === "unfinished" ? { pending: "storage" } : {});
    if (change === "no-selection") {
      const machine = acquireEntrypointAdmission(fixture.workspace, "exclusive", fixture.lifetime);
      try { createProfileRegistry(machine).advanceSession(null); } finally { machine.release(); }
    }
    const path = join(fixture.stateRoot, "state.db");
    if (change === "foreign-binding") {
      const database = new DatabaseSync(path);
      try {
        const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'database_states_binding_immutable'").get()?.sql;
        assert.ok(typeof trigger === "string");
        database.exec("DROP TRIGGER database_states_binding_immutable");
        assert.equal(database.prepare("UPDATE database_states SET profile_id = ? WHERE id = 1").run(randomUUID()).changes, 1);
        database.exec(trigger);
        assert.equal(database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'database_states_binding_immutable'").get()?.sql, trigger);
      }
      finally { database.close(); }
    }
    const source = existsSync(path) ? readFileSync(path) : undefined;
    const registryPath = join(fixture.workspace, ".tracker", "control", "profile-registry.json"), registry = readFileSync(registryPath);
    const result = fixture.run();
    assert.equal(result.status, 1, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, change === "foreign-binding" ? /profile-database-binding-mismatch/u : /profile-session-stale/u);
    assert.equal(existsSync(fixture.backupDirectory), false);
    assert.deepEqual(existsSync(path) ? readFileSync(path) : undefined, source);
    assert.deepEqual(readFileSync(registryPath), registry);
  });
}

it("refuses a selected profile generation change during backup instead of reporting success", async () => {
  const fixture = await installation(), machine = acquireEntrypointAdmission(fixture.workspace, "exclusive", fixture.lifetime);
  const registry = createProfileRegistry(machine), rename = nativeFs.renameSync.bind(nativeFs);
  const path = join(fixture.stateRoot, "state.db"), before = readFileSync(path); let changed = false;
  const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    if (!changed && String(target).startsWith(`${fixture.backupDirectory}/`) && String(target).endsWith(".manifest.json")) {
      changed = true; registry.advanceSession(fixture.profileId);
    }
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], systemClock, fixture.workspace, machine),
      /profile-session-stale|profile-storage-claim-generation-changed/u);
    assert.equal(changed, true); assert.deepEqual(readFileSync(path), before);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); machine.release(); }
});

for (const uncertain of [false, true]) {
  it(`keeps actual selected backup child and bootstrap parent custody correct after source closure uncertainty ${uncertain}`, async () => {
    const fixture = await installation(), machine = acquireEntrypointAdmission(fixture.workspace, "exclusive", fixture.lifetime);
    const inspect = AuthorityDatabase.inspectStoppedUpgrade.bind(AuthorityDatabase);
    const open = nativeFs.openSync.bind(nativeFs), close = nativeFs.closeSync.bind(nativeFs), argv = process.argv.slice();
    let issued: RuntimeAdmission | undefined, armed = false, fired = false;
    const retained: { descriptor?: number; device?: number; inode?: number } = {};
    try {
      const path = join(fixture.stateRoot, "state.db"), before = readFileSync(path);
      const registryPath = join(fixture.workspace, ".tracker", "control", "profile-registry.json"), registry = readFileSync(registryPath);
      const fault = new Error("fixture-backup-source-close-refused");
      vi.spyOn(AuthorityDatabase, "inspectStoppedUpgrade").mockImplementation((...args) => {
        assert.equal(args[1], path); assert.notEqual(args[0], machine);
        if (issued === undefined) {
          assert.equal(args[0].profileBinding.profileId, fixture.profileId);
          assert.equal(args[0].readInstallationContext()?.workspace, fixture.workspace);
          assert.equal(args[0].locator.installationId, machine.locator.installationId);
          issued = args[0]; armed = true;
        } else assert.equal(args[0], issued);
        return inspect(...args);
      });
      vi.spyOn(nativeFs, "openSync").mockImplementation((target, flags, mode) => {
        const descriptor = open(target, flags, mode);
        if (uncertain && armed && retained.descriptor === undefined && String(target) === registryPath) {
          const info = nativeFs.fstatSync(descriptor); retained.descriptor = descriptor; retained.device = info.dev; retained.inode = info.ino;
        }
        return descriptor;
      });
      vi.spyOn(nativeFs, "closeSync").mockImplementation(descriptor => {
        if (descriptor === retained.descriptor) { fired = true; throw fault; }
        close(descriptor);
      });
      syncBuiltinESMExports();
      let failure: unknown;
      try {
        await runSecureEnvironmentBootstrap(["cli", "storage", "backup"], {
          acquireAdmission: mode => { assert.equal(mode, "exclusive"); return machine; },
          runCli: async parent => {
            assert.equal(parent, machine);
            const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], systemClock, fixture.workspace, parent);
            assert.equal(outcome.exitCode, 0, outcome.output);
          },
        });
      } catch (error) { failure = error; }
      const child = issued; assert.ok(child);
      if (uncertain) {
        assert.equal(fired, true); assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
        let cause: unknown = failure;
        while (cause instanceof AuthoritySourceClosureUnprovedError) cause = cause.cause;
        assert.equal(cause, fault); const descriptor = retained.descriptor; assert.ok(descriptor !== undefined);
        assert.equal(nativeFs.fstatSync(descriptor).dev, retained.device);
        assert.equal(nativeFs.fstatSync(descriptor).ino, retained.inode);
        assert.equal(nativeFs.statSync(registryPath).dev, retained.device); assert.equal(nativeFs.statSync(registryPath).ino, retained.inode);
        assert.doesNotThrow(() => child.assertLive()); assert.doesNotThrow(() => machine.assertLive());
        assert.equal(existsSync(fixture.backupDirectory), false);
      } else {
        assert.equal(failure, undefined); assert.equal(fired, false);
        assert.throws(() => child.assertLive(), /released admission/u); assert.throws(() => machine.assertLive(), /released admission/u);
        assert.equal(existsSync(fixture.backupDirectory), true);
      }
      assert.deepEqual(readFileSync(path), before); assert.deepEqual(readFileSync(registryPath), registry);
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports(); process.argv.splice(0, process.argv.length, ...argv);
      if (retained.descriptor !== undefined) close(retained.descriptor);
      issued?.release(); machine.release();
    }
  });
}

it.each(["server", "workers", "geocode"] as const)("refuses a CLI backup while %s is active without writing a backup", async name => {
  const fixture = await installation();
  const authorityPath = join(fixture.stateRoot, "state.db");
  const before = readFileSync(authorityPath);
  const lock = acquireRuntimeProcessLock({ processLockRoot: fixture.processLockRoot, name, pid: process.pid,
    ...(name === "workers" ? { admission: { kind: "unbound-worker" as const, authorityPath } } : {}) });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /runtime-active: stop server, workers and geocode/u);
    assert.equal(existsSync(fixture.backupDirectory), false);
    assert.deepEqual(readFileSync(authorityPath), before);
  } finally { lock.release(); }
});

it("runs the unchanged explicit CLI backup on a stopped adopted flat source without login or profile publication", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    cpSync(join(repositoryRoot, "src"), join(f.workspace, "src"), { recursive: true });
    mkdirSync(join(f.workspace, "scripts", "dev"), { recursive: true });
    cpSync(join(repositoryRoot, "scripts", "dev", "secure-env-bootstrap.ts"), join(f.workspace, "scripts", "dev", "secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json", "dashboard-workflow-sources.json"]) cpSync(join(repositoryRoot, "config", name), join(f.workspace, "config", name));
    symlinkSync(join(repositoryRoot, "node_modules"), join(f.workspace, "node_modules"));
    const paths = [f.databasePath, f.protectedPath, f.artifact, f.reportPath], before = paths.map(path => readFileSync(path));
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "backup"],
      { cwd: f.workspace, encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /backup: verified/u); assert.match(result.stdout, /private coupled companions/u);
    const manifests = readdirSync(join(f.stateRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json"));
    assert.equal(manifests.length, 1);
    assert.equal(parseBackupManifestFile(join(f.stateRoot, "backups", "authority", manifests[0] ?? "")).schemaVersion, 6);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    for (const path of [join(f.stateRoot, "profiles"), join(f.stateRoot, "machine"), join(f.workspace, ".tracker", "control", "profile-registry.json"),
      join(f.workspace, ".tracker", "control", "profile-owner-claims"), join(f.workspace, ".tracker", "control", "profile-flat-claim.json")]) assert.equal(existsSync(path), false);
  } finally { await f.close(); }
});
