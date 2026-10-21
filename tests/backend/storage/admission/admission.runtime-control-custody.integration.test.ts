import { existsSync,linkSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,expect,it } from "vitest";
import { RuntimeAdmission, acquireInitialRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../../../src/backend/storage/admission/admission-identity.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

const roots: string[] = [];
function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-")));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("binds a synthetic capability to one temp fixture and revokes it", () => {
  const root = fixture();
  const path = join(root, "state.db");
  const admission = RuntimeAdmission.syntheticFixture(path);
  expect(Object.isFrozen(admission)).toBe(true);
  expect(admission.stateRoot).toBe(root);
  expect(() => admission.assertAuthorityDatabase(path)).not.toThrow();
  expect(() => admission.assertAuthorityDatabase(join(root, "other.db"))).toThrow(/outside admission/u);
  expect(Reflect.set(admission, "assertLive", () => undefined)).toBe(false);
  admission.release();
  expect(() => requireRuntimeAdmission(admission)).toThrow(/released admission/u);
});

it("rejects symlinked and hard-linked fixture databases before issuance", () => {
  const root = fixture();
  const external = fixture();
  const target = join(external, "external.sqlite");
  writeFileSync(target, "synthetic");
  const linked = join(root, "state.db");
  symlinkSync(target, linked);
  expect(() => RuntimeAdmission.syntheticFixture(linked)).toThrow(/unsafe synthetic fixture database/u);
  rmSync(linked);
  linkSync(target, linked);
  expect(() => RuntimeAdmission.syntheticFixture(linked)).toThrow(/unsafe synthetic fixture database/u);
});

it("rejects fixture aliases and installation witnesses", () => {
  const root = fixture();
  const external = fixture();
  const alias = join(root, "alias");
  symlinkSync(external, alias);
  expect(() => RuntimeAdmission.syntheticFixture(join(alias, "state.db"))).toThrow(/unsafe synthetic fixture ancestor/u);
  mkdirSync(join(root, ".tracker/control"), { recursive: true });
  expect(() => RuntimeAdmission.syntheticFixture(join(root, "state.db"))).toThrow(/installation witness/u);
});

it("rechecks root shape after a capability was issued", () => {
  const root = fixture();
  const external = fixture();
  const stateRoot = join(root, "state");
  const artifactRoot = join(root, "artifacts");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(artifactRoot);
  const admission = RuntimeAdmission.syntheticRoots(stateRoot, artifactRoot);
  expect(() => admission.assertStorageRootsSafe()).not.toThrow();
  rmSync(artifactRoot, { recursive: true });
  symlinkSync(external, artifactRoot);
  expect(() => admission.assertStorageRootsSafe()).toThrow(/unsafe synthetic fixture ancestor/u);
});

it("limits first-adoption verification to read-only inspection", () => {
  const workspace = fixture();
  const stateRoot = join(workspace, ".tracker/data");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(join(stateRoot, "artifacts"), { mode: 0o700 });
  writeFileSync(join(stateRoot, "sentinel.txt"), "synthetic");
  const path = join(stateRoot, "state.db");
  expect(() => acquireInitialRuntimeAdmission(workspace, (_pair, inspection) => {
    expect(() => inspection.assertWritable()).toThrow(/adoption inspection is read-only/u);
    expect(() => AuthorityDatabase.open(inspection, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }))
      .toThrow(/adoption inspection is read-only/u);
    throw new Error("verified refusal");
  }, () => { throw new Error("fresh callback must not run for existing data"); })).toThrow(/verified refusal/u);
  expect(existsSync(path)).toBe(false);
});

it("initializes a fresh authority once under adopting journal before publishing its locator", () => {
  const workspace = fixture();
  const stateRoot = join(workspace, ".tracker/data");
  const path = join(stateRoot, "state.db");
  let initialization: RuntimeAdmission | undefined;
  const admission = acquireInitialRuntimeAdmission(workspace, (pair, inspection) => {
    expect(existsSync(join(workspace, ".tracker/control", "journal.json"))).toBe(true);
    const inspected = AuthorityDatabase.inspectExistingReadOnly(inspection, path);
    return { kind: "verified-existing", pair, authorityGeneration: inspected.authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) };
  }, (pair, fresh) => {
    initialization = fresh;
    expect(pair.stateRoot).toBe(stateRoot);
    expect(existsSync(join(workspace, ".tracker/control", "journal.json"))).toBe(true);
    expect(existsSync(join(workspace, ".tracker/control", "locator.json"))).toBe(false);
    expect(() => fresh.assertWritable()).toThrow(/database-only write authority/u);
    expect(() => fresh.assertArtifactRoot(join(pair.artifactRoot, "a.artifact"))).toThrow(/cannot write artifacts/u);
    expect(() => fresh.assertStateRoot(join(pair.stateRoot, "credentials"))).toThrow(/outside database authority/u);
    expect(() => fresh.assertAuthorityDatabase(":memory:")).toThrow(/outside admission/u);
    const database = AuthorityDatabase.open(fresh, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" });
    database.close();
  });
  expect(existsSync(path)).toBe(true);
  expect(existsSync(join(workspace, ".tracker/control", "journal.json"))).toBe(false);
  expect(existsSync(join(workspace, ".tracker/control", "locator.json"))).toBe(true);
  expect(() => initialization?.assertLive()).toThrow(/released admission/u);
  admission.release();
});

it("keeps an adopting journal after an empty fresh initializer", () => {
  const workspace = fixture();
  expect(() => acquireInitialRuntimeAdmission(workspace, () => {
    throw new Error("verifier must not see missing database");
  }, () => {})).toThrow(/fresh authority database missing/u);
  expect(existsSync(join(workspace, ".tracker/control", "journal.json"))).toBe(true);
  expect(existsSync(join(workspace, ".tracker/control", "locator.json"))).toBe(false);
  expect(() => acquireInitialRuntimeAdmission(workspace, () => {
    throw new Error("not reached");
  }, () => {})).toThrow(/locator missing; offline recovery required/u);
});
