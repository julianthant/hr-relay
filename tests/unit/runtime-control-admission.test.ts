import { afterEach, expect, it } from "vitest";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeAdmission, acquireInitialRuntimeAdmission, requireRuntimeAdmission } from "../../src/infra/runtime-control/admission.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { ArchiveDatabase } from "../../src/infra/sqlite/archive-database.js";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-admission-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("binds a synthetic capability to one temp fixture and revokes it", () => {
  const root = fixture();
  const path = join(root, "state.db");
  const admission = RuntimeAdmission.syntheticFixture(path, "authority");
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
  expect(() => RuntimeAdmission.syntheticFixture(linked, "authority")).toThrow(/unsafe synthetic fixture database/u);
  rmSync(linked);
  linkSync(target, linked);
  expect(() => RuntimeAdmission.syntheticFixture(linked, "authority")).toThrow(/unsafe synthetic fixture database/u);
});

it("rejects fixture aliases and installation witnesses", () => {
  const root = fixture();
  const external = fixture();
  const alias = join(root, "alias");
  symlinkSync(external, alias);
  expect(() => RuntimeAdmission.syntheticFixture(join(alias, "state.db"), "authority")).toThrow(/unsafe synthetic fixture ancestor/u);
  mkdirSync(join(root, ".runtime-control"));
  expect(() => RuntimeAdmission.syntheticFixture(join(root, "state.db"), "authority")).toThrow(/installation witness/u);
});

it("rechecks root shape after a capability was issued", () => {
  const root = fixture();
  const external = fixture();
  const stateRoot = join(root, "state");
  const artifactRoot = join(root, "artifacts");
  mkdirSync(stateRoot);
  mkdirSync(artifactRoot);
  const admission = RuntimeAdmission.syntheticRoots(stateRoot, artifactRoot);
  expect(() => admission.assertStorageRootsSafe()).not.toThrow();
  rmSync(artifactRoot, { recursive: true });
  symlinkSync(external, artifactRoot);
  expect(() => admission.assertStorageRootsSafe()).toThrow(/unsafe synthetic fixture ancestor/u);
});

it("limits first-adoption verification to read-only inspection", () => {
  const workspace = fixture();
  const stateRoot = join(workspace, ".tracker");
  mkdirSync(stateRoot);
  mkdirSync(join(stateRoot, "artifacts"));
  writeFileSync(join(stateRoot, "sentinel.txt"), "synthetic");
  const path = join(stateRoot, "state.db");
  expect(() => acquireInitialRuntimeAdmission(workspace, (_pair, inspection) => {
    expect(() => inspection.assertWritable()).toThrow(/adoption inspection is read-only/u);
    expect(() => AuthorityDatabase.open(inspection, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }))
      .toThrow(/adoption inspection is read-only/u);
    expect(() => new ArchiveDatabase(inspection, join(stateRoot, "archive.sqlite")))
      .toThrow(/adoption inspection is read-only/u);
    throw new Error("verified refusal");
  })).toThrow(/verified refusal/u);
  expect(existsSync(path)).toBe(false);
  expect(existsSync(join(stateRoot, "archive.sqlite"))).toBe(false);
});
