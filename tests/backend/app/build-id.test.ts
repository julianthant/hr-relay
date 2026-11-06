import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { productionWorkerLaunch } from "../../../src/backend/app/composition/dashboard/worker-process.js";
import { BuildIdError, captureBuildId, computeBuildId, currentBuildId, packageOfSpecifier, PARENT_BUILD_ID_ENV, runtimeLockEntries } from "../../../src/backend/app/build-id.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type LockPackages = Record<string, Record<string, unknown>>;
const LOCK: LockPackages = {
  "": { name: "fixture" },
  "node_modules/zod": { version: "4.0.0", integrity: "sha512-zod" },
  "node_modules/hono": { version: "4.0.0", integrity: "sha512-hono" },
  "node_modules/react": { version: "19.0.0", integrity: "sha512-react" },
  "node_modules/tsx": { version: "4.0.0", integrity: "sha512-tsx", dependencies: { esbuild: "0.25.0" } },
  "node_modules/esbuild": { version: "0.25.0", integrity: "sha512-esbuild", optionalDependencies: { "@esbuild/win32-x64": "0.25.0", "@esbuild/sunos-x64": "0.25.0" } },
  "node_modules/@esbuild/win32-x64": { version: "0.25.0", integrity: "sha512-esbuild-win", os: ["win32"], cpu: ["x64"] },
  "node_modules/@napi-rs/keyring": { version: "2.1.0", integrity: "sha512-keyring", optionalDependencies: { "@napi-rs/keyring-win32-x64-msvc": "2.1.0" } },
  "node_modules/@napi-rs/keyring-win32-x64-msvc": { version: "2.1.0", integrity: "sha512-keyring-win", os: ["win32"] },
  "node_modules/pdf-lib": { version: "1.0.0", integrity: "sha512-pdf", dependencies: { tslib: "1.0.0" } },
  "node_modules/pdf-lib/node_modules/tslib": { version: "1.0.0", integrity: "sha512-nested-tslib" },
  "node_modules/tslib": { version: "2.0.0", integrity: "sha512-root-tslib" },
};

function fixtureTree(packages: LockPackages = LOCK): string {
  const root = mkdtempSync(join(tmpdir(), "relay-build-id-"));
  roots.push(root);
  for (const directory of ["src/backend/systems/x", "src/workflow-kit", "src/workflows", "src/models", "src/rules", "src/dashboard"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, "src/cli.ts"), 'import { z } from "zod";\n');
  writeFileSync(join(root, "src/backend/systems/x/task.ts"), [
    'import { Hono } from "hono";',
    'import { readFileSync } from "node:fs";',
    'import path from "path";',
    'const keyring = await import("@napi-rs/keyring");',
    'export { PDFDocument } from "pdf-lib/cjs";',
    "ObjC.import('AppKit');",
    'const row = ["from", "report.from"];',
  ].join("\n"));
  writeFileSync(join(root, "src/dashboard/app.tsx"), 'import React from "react";\n');
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  return root;
}

function withLock(root: string, packages: LockPackages): string {
  const copy = mkdtempSync(join(tmpdir(), "relay-build-id-"));
  roots.push(copy);
  cpSync(root, copy, { recursive: true });
  writeFileSync(join(copy, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  return copy;
}

describe("app build id", () => {
  it("covers worker code and its runtime dependency graph, not frontend code", () => {
    const root = fixtureTree();
    const id = computeBuildId(root, "v26.0.0");
    writeFileSync(join(root, "src/dashboard/app.tsx"), 'import React from "react";\nexport const edited = true;\n');
    assert.equal(computeBuildId(root, "v26.0.0"), id, "a dashboard edit must not move the build id");
    assert.equal(computeBuildId(withLock(root, { ...LOCK, "node_modules/react": { version: "19.1.0", integrity: "sha512-react-2" } }), "v26.0.0"), id,
      "a frontend-only package change must not move the build id");
    writeFileSync(join(root, "src/backend/systems/x/other.ts"), "export const changed = 1;\n");
    assert.notEqual(computeBuildId(root, "v26.0.0"), id, "a worker-code edit moves the build id");
    assert.notEqual(computeBuildId(fixtureTree(), "v26.1.0"), id, "a Node version change moves the build id");
  });

  it("moves when only a reachable native optional entry changes", () => {
    const root = fixtureTree();
    const id = computeBuildId(root, "v26.0.0");
    for (const path of ["node_modules/@napi-rs/keyring-win32-x64-msvc", "node_modules/@esbuild/win32-x64", "node_modules/pdf-lib/node_modules/tslib"]) {
      assert.notEqual(computeBuildId(withLock(root, { ...LOCK, [path]: { ...LOCK[path], integrity: "sha512-changed" } }), "v26.0.0"), id, path);
    }
    assert.equal(computeBuildId(withLock(root, { ...LOCK, "node_modules/tslib": { version: "2.0.1", integrity: "sha512-other" } }), "v26.0.0"), id,
      "the nested copy, not the root copy, is the one pdf-lib loads");
  });

  it("selects nested entries first and skips unrecorded optional platforms", () => {
    const lock = { packages: LOCK as never };
    const selected = [...runtimeLockEntries(lock, ["pdf-lib", "tsx", "@napi-rs/keyring"]).keys()].sort();
    assert.deepEqual(selected, ["node_modules/@esbuild/win32-x64", "node_modules/@napi-rs/keyring", "node_modules/@napi-rs/keyring-win32-x64-msvc",
      "node_modules/esbuild", "node_modules/pdf-lib", "node_modules/pdf-lib/node_modules/tslib", "node_modules/tsx"]);
  });

  it("fails by name on an unresolved dependency, an unclassifiable specifier or missing sources", () => {
    const { "node_modules/hono": _hono, ...withoutHono } = LOCK;
    assert.throws(() => computeBuildId(withLock(fixtureTree(), withoutHono)),
      (error: unknown) => error instanceof BuildIdError && error.code === "relay-build-id-dependency-unresolved");
    const { "node_modules/tslib": _root, "node_modules/pdf-lib/node_modules/tslib": _nested, ...withoutTslib } = LOCK;
    assert.throws(() => runtimeLockEntries({ packages: withoutTslib }, ["pdf-lib"]), /tslib \(needed by node_modules\/pdf-lib\) has no lock entry/u);
    assert.throws(() => packageOfSpecifier("virtual:module"), (error: unknown) => error instanceof BuildIdError && error.code === "relay-build-id-dependency-unresolved");
    const root = fixtureTree();
    rmSync(join(root, "src/workflows"), { recursive: true });
    assert.throws(() => computeBuildId(root), (error: unknown) => error instanceof BuildIdError && error.code === "relay-build-id-unavailable");
  });

  it("hands workers the parent's build id outside the environment allowlist", () => {
    const launch = productionWorkerLaunch("/repo", { PATH: "/usr/bin", RELAY_UNLISTED: "dropped", [PARENT_BUILD_ID_ENV]: "0".repeat(64) });
    assert.equal(launch.environment[PARENT_BUILD_ID_ENV], currentBuildId());
    assert.equal(launch.environment.RELAY_UNLISTED, undefined);
  });

  it("refuses a worker whose build differs from its parent", () => {
    const own = captureBuildId({});
    assert.equal(captureBuildId({ [PARENT_BUILD_ID_ENV]: own }), own);
    assert.throws(() => captureBuildId({ [PARENT_BUILD_ID_ENV]: "0".repeat(64) }),
      (error: unknown) => error instanceof BuildIdError && error.code === "relay-build-changed-under-running-app");
  });
});
