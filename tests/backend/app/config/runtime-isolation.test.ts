import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { join,resolve } from "node:path";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { applicationDataWorkspace,rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { NativePathPickerRequestSchema } from "../../../../src/models/dashboard/native-path-picker.js";

describe("fixed application data", () => {
  it("uses OS identity and a fixed application name independently of cwd or HOME", () => {
    const workspace = join(userInfo().homedir, "Library", "Application Support", "Relay");
    assert.equal(applicationDataWorkspace(), workspace);
    const paths = defaultRuntimePaths();
    assert.equal(paths.stateRoot, join(workspace, rebuildRuntimeIsolation.stateRoot));
    assert.equal(paths.artifactRoot, join(paths.stateRoot, "artifacts"));
    assert.equal(paths.browserProfileRoot, join(paths.stateRoot, "browsers"));
    assert.equal(paths.duoExtensionDir, resolve(import.meta.dirname, "../../../../fast-duo"));
    assert.notEqual(paths.stateRoot, resolve(rebuildRuntimeIsolation.stateRoot));
    assert.equal(applicationDataWorkspace(resolve("isolated-home")), join(resolve("isolated-home"), "Library", "Application Support", "Relay"));
    assert.throws(() => applicationDataWorkspace("relative-home"), /application-data-home-invalid/u);
  });
  it("keeps ordinary output folders separate from admitted authority", () => {
    const pair = { stateRoot: resolve("isolated-person"), artifactRoot: resolve("isolated-person/artifacts") };
    const reportsDir = resolve("chosen-reports");
    const resolved = resolveConfigWithProvenance({ paths: { reportsDir } }, { primaryDisplay: null }, undefined, pair);
    assert.equal(resolved.config.paths.reportsDir, reportsDir);
    assert.equal(resolved.config.paths.stateRoot, pair.stateRoot);
    assert.equal(resolved.config.paths.artifactRoot, pair.artifactRoot);
    assert.throws(() => resolveConfigWithProvenance({ paths: { stateRoot: reportsDir } }, { primaryDisplay: null }, undefined, pair));
    assert.throws(() => resolveConfigWithProvenance({ paths: { browserProfileRoot: reportsDir } }, { primaryDisplay: null }, undefined, pair), /fixed-person-browser-root-required/u);
    assert.equal(resolveConfigWithProvenance({ paths: { browserProfileRoot: join(pair.stateRoot, "browsers") } }, { primaryDisplay: null }, undefined, pair).config.paths.browserProfileRoot, join(pair.stateRoot, "browsers"));
  });
});

it("refuses authority folders at the native-picker boundary", () => {
  for (const field of ["paths.stateRoot", "paths.artifactRoot", "paths.browserProfileRoot"]) {
    assert.equal(NativePathPickerRequestSchema.safeParse({ field }).success, false);
  }
  for (const field of ["paths.onboardingDocsDir", "paths.downloadsDir", "paths.reportsDir"]) {
    assert.equal(NativePathPickerRequestSchema.safeParse({ field }).success, true);
  }
});
