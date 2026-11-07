import assert from "node:assert/strict";
import fs,{ mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { OrdinaryPathValidationError,validateOrdinaryPathChanges } from "../../../../src/backend/runs/commands/ordinary-path-validator.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import type { Config } from "../../../../src/models/config/schema.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "ordinary-paths-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const current = resolveConfigWithProvenance({}, hostConfigFacts({}),
    manualClock(new Date("2026-09-26T12:00:00.000Z"))).config;
  const previous: Config = { ...current, paths: {
    ...current.paths, stateRoot: join(root, "state"), artifactRoot: join(root, "state", "artifacts"),
    browserProfileRoot: join(root, "old-profile"), duoCredential: join(root, "old-duo.json"),
    duoExtensionDir: join(root, "old-extension"),
  } };
  return { root, previous, candidate: (paths: Partial<Config["paths"]>): Config => ({
    ...previous, paths: { ...previous.paths, ...paths },
  }) };
}

function refusal(work: () => void, key: string, reason: string) {
  assert.throws(work, (error: unknown) => error instanceof OrdinaryPathValidationError
    && error.key === key && error.reason === reason);
}

describe("ordinary browser paths", () => {
  it("refuses every browser-root change without probing a selected folder", () => {
    const f = fixture();
    const inspect = vi.spyOn(fs, "lstatSync"); syncBuiltinESMExports();
    for (const path of [join(f.root, "fresh"), join(f.root, "linked"), f.previous.paths.stateRoot, join(f.previous.paths.stateRoot, "browsers")]) {
      refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: path })), "paths.browserProfileRoot", "fixed-root");
    }
    validateOrdinaryPathChanges(f.previous, f.previous);
    assert.equal(inspect.mock.calls.length, 0);
  });

  it("refuses changes to the retired Duo path without reading it and still validates extension assets", () => {
    const f = fixture();
    for (const credential of [join(f.root, "absent.json"), join(f.root, "invalid.json")]) {
      refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoCredential: credential })), "paths.duoCredential", "retired-setting");
    }
    const extension = join(f.root, "extension"); mkdirSync(extension);
    writeFileSync(join(extension, "workflow-manifest.json"), "{}");
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoExtensionDir: extension })),
      "paths.duoExtensionDir", "unpacked-manifest-required");
    writeFileSync(join(extension, "workflow-manifest.json"), '{"manifest_version":3,"name":"Synthetic Duo"}');
    validateOrdinaryPathChanges(f.previous, f.candidate({ duoExtensionDir: extension }));
  });
});

it("refuses an extension inspection with non-ENOENT failure", () => {
  const f = fixture(), extension = join(f.root, "new-extension"), original = fs.lstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation(((path: unknown, options: unknown) => {
    if (String(path) === extension) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return original(path as string, options as never);
  })); syncBuiltinESMExports();
  refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoExtensionDir: extension })), "paths.duoExtensionDir", "directory-unavailable");
});
