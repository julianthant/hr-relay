import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it } from "vitest";
import { createHistoricalFlatProfileFixture } from "../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { acquireRuntimeProcessLock } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function installation() {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "backup-bootstrap-"));
  roots.push(workspace);
  cpSync(join(repositoryRoot, "src"), join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "scripts", "dev"), { recursive: true });
  cpSync(join(repositoryRoot, "scripts", "dev", "secure-env-bootstrap.ts"), join(workspace, "scripts", "dev", "secure-env-bootstrap.ts"));
  cpSync(join(repositoryRoot, "package.json"), join(workspace, "package.json"));
  mkdirSync(join(workspace, "config"));
  cpSync(join(repositoryRoot, "config", "runtime-isolation.json"), join(workspace, "config", "runtime-isolation.json"));
  cpSync(join(repositoryRoot, "config", "test-data.json"), join(workspace, "config", "test-data.json"));
  symlinkSync(join(repositoryRoot, "node_modules"), join(workspace, "node_modules"));
  const admission = acquireEntrypointAdmission(workspace, "exclusive");
  const stateRoot = admission.stateRoot;
  try {
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admission, join(stateRoot, "state.db")).schemaVersion,
      CURRENT_AUTHORITY_SCHEMA_VERSION);
  } finally { admission.release(); }
  return { workspace, stateRoot, backupDirectory: join(stateRoot, "backups", "authority"),
    run: () => spawnSync(process.execPath, ["--import", "tsx", "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "backup"],
      { cwd: workspace, encoding: "utf8", timeout: 20_000 }) };
}

it("backs up a current installation through real bootstrap admission and persists a verifiable manifest", async () => {
  const fixture = installation();
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
  assert.ok(result.stdout.includes(manifest.backupFileName));
  const admission = acquireEntrypointAdmission(fixture.workspace, "exclusive");
  try {
    const verified = await verifyBackupManifestAtPath(admission, manifestPath,
      AuthorityDatabase.sourceDatabaseIdentity(join(fixture.stateRoot, "state.db")));
    assert.deepEqual(verified.manifest, manifest);
    assert.equal(verified.backupPath, join(fixture.backupDirectory, manifest.backupFileName));
  } finally { admission.release(); }
});

it.each(["server", "workers", "geocode"] as const)("refuses a CLI backup while %s is active without writing a backup", name => {
  const fixture = installation();
  const authorityPath = join(fixture.stateRoot, "state.db");
  const before = readFileSync(authorityPath);
  const lock = acquireRuntimeProcessLock({ processLockRoot: join(fixture.stateRoot, "locks"), name, pid: process.pid,
    ...(name === "workers" ? { admission: { kind: "unbound-worker" as const, authorityPath } } : {}) });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /runtime-active: stop server, workers and geocode/u);
    assert.equal(existsSync(fixture.backupDirectory), false);
    assert.deepEqual(readFileSync(authorityPath), before);
  } finally { lock.release(); }
});

it("runs the unchanged explicit CLI backup on a stopped adopted flat source without login or profile publication", () => {
  const f = createHistoricalFlatProfileFixture();
  try {
    cpSync(join(repositoryRoot, "src"), join(f.workspace, "src"), { recursive: true });
    mkdirSync(join(f.workspace, "scripts", "dev"), { recursive: true });
    cpSync(join(repositoryRoot, "scripts", "dev", "secure-env-bootstrap.ts"), join(f.workspace, "scripts", "dev", "secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json"]) cpSync(join(repositoryRoot, "config", name), join(f.workspace, "config", name));
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
  } finally { f.close(); }
});
