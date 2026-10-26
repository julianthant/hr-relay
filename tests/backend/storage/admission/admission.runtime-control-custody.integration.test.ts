import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { DatabaseSync } from "node:sqlite";
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
  expect(() => admission.assertStateRoot(stateRoot)).not.toThrow();
  expect(() => admission.assertReadOnlyAuthorityDatabase(":memory:")).not.toThrow();
  expect(() => admission.assertArtifactRoot(artifactRoot)).not.toThrow();
  expect(() => admission.assertWritable()).not.toThrow();
  rmSync(artifactRoot, { recursive: true });
  symlinkSync(external, artifactRoot);
  expect(() => admission.assertStorageRootsSafe()).toThrow(/unsafe synthetic fixture ancestor/u);
  expect(() => admission.assertStateRoot(stateRoot)).toThrow(/unsafe synthetic fixture ancestor/u);
  expect(() => admission.assertReadOnlyAuthorityDatabase(":memory:")).toThrow(/unsafe synthetic fixture ancestor/u);
  expect(() => admission.assertArtifactRoot(artifactRoot)).toThrow(/unsafe synthetic fixture ancestor/u);
  admission.release();
  expect(() => admission.assertStateRoot("relative")).toThrow(/released admission/u);
  expect(() => admission.assertCredentialRead()).toThrow(/released admission/u);
  expect(() => admission.assertWritable()).toThrow(/released admission/u);
  expect(() => admission.assertReadOnlyAuthorityDatabase("relative")).toThrow(/released admission/u);
  expect(() => admission.assertArtifactRoot("relative")).toThrow(/released admission/u);
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
      .toThrow(/profile-bound-authority-required/u);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(join(stateRoot, "credentials"))).toBe(false);
    throw new Error("verified refusal");
  }, () => { throw new Error("fresh callback must not run for existing data"); })).toThrow(/verified refusal/u);
  expect(existsSync(path)).toBe(false);
});

it("initializes only one canonical pending profile before real ready publication and issued runtime custody", () => {
  const profile = createBoundProfileFixture({ pending: true });
  try {
    const machineRoot = profile.machine.stateRoot, path = profile.path;
    expect(existsSync(join(machineRoot, "state.db"))).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect(() => AuthorityDatabase.open(profile.machine, { path: join(machineRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "test" })).toThrow(/profile-bound-authority-required/u);
    expect(() => profile.machine.assertProfileRuntime()).toThrow(/profile-bound-authority-required/u);
    expect(() => profile.admission.assertAuthorityDatabase(":memory:")).toThrow(/outside admission/u);
    expect(() => profile.admission.assertArtifactRoot(join(machineRoot, "artifacts", "foreign"))).toThrow(/outside admission/u);
    const claim = profile.machine.readProfileRegistry();
    expect(claim.profiles).toHaveLength(0);
    const pendingClaim = createProfileRegistry(profile.machine).storageClaim(profile.admission.profileBinding.profileId);
    expect(() => profile.machine.admitProfile({ ...pendingClaim })).toThrow(/profile-storage-claim-unissued/u);
    AuthorityDatabase.initializeProfile(profile.admission);
    expect(() => AuthorityDatabase.initializeProfile(profile.admission)).toThrow(/profile-database-initialization-already-exists/u);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      expect(raw.prepare("SELECT schema_version,installation_id,profile_id FROM database_states WHERE id=1").get()).toMatchObject({
        schema_version: 7, installation_id: profile.machine.locator.installationId, profile_id: profile.admission.profileBinding.profileId,
      });
    } finally { raw.close(); }
    const setup = profile.admission;
    profile.finish();
    expect(() => setup.assertLive()).toThrow(/released admission/u);
    expect(() => AuthorityDatabase.initializeProfile(profile.admission)).toThrow(/profile-initialization-authority-required/u);
    expect(profile.machine.readProfileRegistry().profiles[0]?.lifecycle).toBe("ready");
    expect(existsSync(join(profile.workspace, ".tracker/control", "profile-publication.json"))).toBe(false);
    expect(existsSync(join(machineRoot, "state.db"))).toBe(false);
    const database = AuthorityDatabase.open(profile.admission, { path, busyTimeoutMs: 250, migrationOwner: "test" });
    try { expect(database.getMeta().schemaVersion).toBe(7); } finally { database.close(); }
  } finally { profile.close(); }
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
