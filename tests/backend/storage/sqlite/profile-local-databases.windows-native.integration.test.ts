import assert from "node:assert/strict";
import children from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import paths, { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, vi } from "vitest";
import { assertLiveProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { createReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWindowsPrivateFixture, setWindowsFixtureAcl } from "../../../support/helpers/windows-private-path-fixture.js";

function databaseFixture() {
  const fixture = createWindowsPrivateFixture(), path = join(fixture.root, "authority.sqlite");
  const binding = { installationId: randomUUID(), profileId: randomUUID() };
  const database = new DatabaseSync(path);
  try {
    database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; PRAGMA application_id=${AUTHORITY_APPLICATION_ID};
      CREATE TABLE database_states(id INTEGER PRIMARY KEY, installation_id TEXT, profile_id TEXT)`);
    database.prepare("INSERT INTO database_states VALUES(1, ?, ?)").run(binding.installationId, binding.profileId);
  } finally { database.close(); }
  return { ...fixture, path, binding };
}

function isolatedPolicyArtifact() {
  const shared = resolve(import.meta.dirname, "../../../../node_modules/.cache/relay/windows-observer-policy.cjs");
  const sharedBytes = readFileSync(shared), sharedMetadata = readFileSync(`${shared}.json`);
  const directory = mkdtempSync(join(dirname(shared), "observer-fixture-")), artifact = join(directory, "policy.cjs");
  copyFileSync(shared, artifact); copyFileSync(`${shared}.json`, `${artifact}.json`);
  const resolvePath = paths.resolve;
  const locator = vi.spyOn(paths, "resolve").mockImplementation((...args) =>
    args.length === 2 && args[1] === "node_modules/.cache/relay/windows-observer-policy.cjs" ? artifact : resolvePath(...args));
  syncBuiltinESMExports();
  return { artifact, close() {
    locator.mockRestore(); syncBuiltinESMExports();
    try {
      assert.ok(readFileSync(shared).equals(sharedBytes));
      assert.ok(readFileSync(`${shared}.json`).equals(sharedMetadata));
    } finally { rmSync(directory, { recursive: true }); }
  } };
}

describe.skipIf(process.platform !== "win32")("isolated SQLite observers use native private-path policy", () => {
  it("loads the shared native policy in both actual observer children", () => {
    const f = databaseFixture();
    try {
      const before = readFileSync(f.path);
      assert.doesNotThrow(() => assertLiveProfileDatabaseBinding(f.path, f.binding));
      const snapshot = createReadonlyAuthoritySnapshot(f.path);
      try {
        assert.ok(readFileSync(snapshot.path).equals(before));
        snapshot.assertUnchanged();
      } finally { snapshot.dispose(); }
      assert.ok(readFileSync(f.path).equals(before));
    } finally { f.close(); }
  });

  for (const observer of ["binding", "snapshot"] as const) {
    it(`refuses newly broad access inside the ${observer} child`, () => {
      const f = databaseFixture(), spawn = children.spawnSync;
      let changed = false;
      vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
        assert.ok(Array.isArray(args));
        assert.equal(args[0], "--input-type=commonjs");
        assert.match(String(args[2]), /windows-observer-policy\.cjs/u);
        assert.doesNotMatch(String(args[2]), /--import|await import/u);
        setWindowsFixtureAcl(f.root, true); changed = true;
        return spawn(command, args, options);
      });
      syncBuiltinESMExports();
      try {
        const before = readFileSync(f.path);
        assert.throws(() => observer === "binding"
          ? assertLiveProfileDatabaseBinding(f.path, f.binding) : createReadonlyAuthoritySnapshot(f.path),
        /profile-database-identity-invalid|authority-readonly-source-unsafe|Windows storage/u);
        assert.equal(changed, true);
        assert.ok(readFileSync(f.path).equals(before));
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); f.close(); }
    });
  }
});

for (const observer of ["binding", "snapshot"] as const) {
  for (const fault of ["missing-metadata", "stale-metadata", "unsafe-metadata", "missing-artifact", "changed-artifact", "child-changed-artifact"] as const) {
    it.skipIf(process.platform !== "win32")(`${observer} refuses ${fault} without source effects`, () => {
      const f = databaseFixture();
      const policy = isolatedPolicyArtifact(), { artifact } = policy;
      const target = fault.endsWith("metadata") ? `${artifact}.json` : artifact;
      const original = readFileSync(target), before = readFileSync(f.path);
      const spawn = children.spawnSync;
      let called = false, missing = false;
      const change = () => {
        if (fault.startsWith("missing")) { renameSync(target, `${target}.held`); missing = true; }
        else if (fault.endsWith("metadata")) {
          const metadata = JSON.parse(original.toString("utf8")) as { inputs: Array<{ path: string; digest: string }> };
          const input = metadata.inputs[0]; assert.ok(input);
          if (fault === "unsafe-metadata") input.path = f.path;
          else input.digest = "0".repeat(64);
          writeFileSync(target, JSON.stringify(metadata));
        } else writeFileSync(target, Buffer.concat([original, Buffer.from("\nthrow new Error('synthetic changed artifact');\n")]));
      };
      vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
        called = true;
        if (fault === "child-changed-artifact") change();
        return spawn(command, args, options);
      });
      syncBuiltinESMExports();
      try {
        if (fault !== "child-changed-artifact") change();
        assert.throws(() => observer === "binding"
          ? assertLiveProfileDatabaseBinding(f.path, f.binding) : createReadonlyAuthoritySnapshot(f.path),
        error => {
          assert.ok(error instanceof Error);
          if (fault === "child-changed-artifact") assert.equal(error.message, "windows-observer-policy-refused");
          else { assert.equal(error.name, "WindowsPrivatePathError"); assert.match(String(Reflect.get(error, "reason")), /^observer-policy-unavailable:/u); }
          return true;
        });
        assert.equal(called, fault === "child-changed-artifact");
        assert.ok(readFileSync(f.path).equals(before));
      } finally {
        vi.restoreAllMocks(); syncBuiltinESMExports();
        if (missing) renameSync(`${target}.held`, target); else writeFileSync(target, original);
        policy.close(); f.close();
      }
    });
  }
}

for (const observer of ["binding", "snapshot"] as const) {
  it.skipIf(process.platform !== "win32")(`${observer} executes the verified bytes after an artifact substitution`, () => {
    const f = databaseFixture(), spawn = children.spawnSync;
    const policy = isolatedPolicyArtifact(), { artifact } = policy;
    const original = readFileSync(artifact), before = readFileSync(f.path);
    let called = false;
    vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
      assert.ok(Array.isArray(args)); assert.equal(args[0], "--input-type=commonjs");
      const argumentsList: readonly unknown[] = args;
      const childArgs = argumentsList.map(argument => { assert.ok(typeof argument === "string"); return argument; });
      const script = childArgs[2]; assert.ok(typeof script === "string");
      const substitute = `
const fixtureFs = require("node:fs"), fixtureRead = fixtureFs.readFileSync;
fixtureFs.readFileSync = function(path, ...options) {
  const bytes = fixtureRead.call(this, path, ...options);
  if (path === ${JSON.stringify(artifact)}) fixtureFs.writeFileSync(path, "throw new Error('unverified-artifact-executed');");
  return bytes;
};
`;
      called = true;
      return spawn(command, [...childArgs.slice(0, 2), substitute + script, ...childArgs.slice(3)], options);
    });
    syncBuiltinESMExports();
    try {
      if (observer === "binding") assertLiveProfileDatabaseBinding(f.path, f.binding);
      else {
        const snapshot = createReadonlyAuthoritySnapshot(f.path);
        try { assert.ok(readFileSync(snapshot.path).equals(before)); snapshot.assertUnchanged(); }
        finally { snapshot.dispose(); }
      }
      assert.equal(called, true);
      assert.equal(readFileSync(artifact, "utf8"), "throw new Error('unverified-artifact-executed');");
      assert.ok(readFileSync(f.path).equals(before));
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); writeFileSync(artifact, original); policy.close(); f.close(); }
  });
}
