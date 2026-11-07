import assert from "node:assert/strict";
import os, { userInfo } from "node:os";
import { join,resolve,win32 } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { describe,it,vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { applicationDataWorkspace,rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import * as secrets from "../../../../src/models/config/secrets.js";
import { windowsLocalApplicationData } from "../../../../src/models/config/secrets.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { NativePathPickerRequestSchema } from "../../../../src/models/dashboard/native-path-picker.js";

describe("fixed application data", () => {
  it("uses OS identity and a fixed application name independently of cwd or HOME", () => {
    const workspace = process.platform === "win32"
      ? applicationDataWorkspace({ platform: "win32", localAppData: windowsLocalApplicationData() })
      : join(userInfo().homedir, "Library", "Application Support", "Relay");
    assert.equal(applicationDataWorkspace(), workspace);
    const paths = defaultRuntimePaths();
    assert.equal(paths.stateRoot, join(workspace, rebuildRuntimeIsolation.stateRoot));
    assert.equal(paths.artifactRoot, join(paths.stateRoot, "artifacts"));
    assert.equal(paths.browserProfileRoot, join(paths.stateRoot, "browsers"));
    assert.equal(paths.duoExtensionDir, resolve(import.meta.dirname, "../../../../fast-duo"));
    assert.notEqual(paths.stateRoot, resolve(rebuildRuntimeIsolation.stateRoot));
    assert.equal(applicationDataWorkspace({ platform: "linux", homeDirectory: "/isolated-home" }), "/isolated-home/Library/Application Support/Relay");
    assert.throws(() => applicationDataWorkspace({ platform: "linux", homeDirectory: "relative-home" }), /application-data-home-invalid/u);
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

it("selects the Windows LOCALAPPDATA container instead of the OS home", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
  const identity = userInfo();
  vi.spyOn(os, "userInfo").mockReturnValue({ ...identity, homedir: "/synthetic-home" });
  vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Synthetic Operator\\AppData\\Local");
  syncBuiltinESMExports();
  let workspace: string;
  let homeReads: number;
  try {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    workspace = applicationDataWorkspace();
    homeReads = vi.mocked(os.userInfo).mock.calls.length;
  } finally { Object.defineProperty(process, "platform", platform); vi.restoreAllMocks(); vi.unstubAllEnvs(); syncBuiltinESMExports(); }
  assert.equal(homeReads, 0);
  assert.equal(workspace, "C:\\Users\\Synthetic Operator\\AppData\\Local\\Relay");
});

function assertWorkspaceRefused(localAppData: string | undefined): void {
  assert.throws(() => applicationDataWorkspace({ platform: "win32", localAppData }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "ApplicationDataWorkspaceRefusedError");
    assert.equal(Reflect.get(error, "code"), "APPLICATION_DATA_WORKSPACE_REFUSED");
    assert.equal(Reflect.get(error, "reason"), localAppData === undefined ? "missing-local-appdata" : "invalid-local-appdata");
    assert.equal(error.message, ERROR_CATALOG.APPLICATION_DATA_WORKSPACE_REFUSED.text);
    return true;
  });
}

it("keeps macOS and other POSIX home-derived containers unchanged", () => {
  for (const platform of ["darwin", "linux"] as const) {
    assert.equal(applicationDataWorkspace({ platform, homeDirectory: "/Users/Synthetic Operator" }), "/Users/Synthetic Operator/Library/Application Support/Relay");
    for (const homeDirectory of ["relative", "", "/Users/synthetic/../other", "/Users/synthetic/", "/Users//synthetic"]) {
      assert.throws(() => applicationDataWorkspace({ platform, homeDirectory }), error => {
        assert.ok(error instanceof Error); assert.equal(error.message, "application-data-home-invalid"); return true;
      });
    }
  }
});

it("reads only the POSIX home authority on a POSIX host", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
  const identity = userInfo();
  vi.spyOn(os, "userInfo").mockReturnValue({ ...identity, homedir: "/synthetic-home" });
  const local = vi.spyOn(secrets, "windowsLocalApplicationData").mockImplementation(() => { throw new Error("Windows-authority-read-on-POSIX"); });
  syncBuiltinESMExports();
  try {
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    assert.equal(applicationDataWorkspace(), "/synthetic-home/Library/Application Support/Relay");
    assert.equal(local.mock.calls.length, 0);
  } finally { Object.defineProperty(process, "platform", platform); vi.restoreAllMocks(); syncBuiltinESMExports(); }
});

it("keeps the inner authority layout inside a canonical local Windows container", () => {
  for (const localAppData of [String.raw`C:\Users\Synthetic Operator\AppData\Local`, String.raw`D:\Owned Simulation\app-data`, String.raw`c:\Users\José\AppData\Local`]) {
    const workspace = applicationDataWorkspace({ platform: "win32", localAppData });
    assert.equal(workspace, `${localAppData}\\Relay`);
    assert.equal(win32.join(workspace, ".tracker", "control"), `${workspace}\\.tracker\\control`);
    assert.equal(win32.join(workspace, rebuildRuntimeIsolation.stateRoot), `${workspace}\\.tracker\\data`);
  }
});

it("refuses missing LOCALAPPDATA without a home or cwd fallback", () => { assertWorkspaceRefused(undefined); });

for (const localAppData of ["", " ", "relative", "C:relative", "C:", "\\relative", "C:\\", "C:/Users/operator/AppData/Local",
  String.raw`\\server\share\Local`, String.raw`\\?\C:\Local`, String.raw`\\.\C:\Local`, String.raw`\??\C:\Local`,
  String.raw`C:\Users\operator\..\Local`, String.raw`C:\Users\operator\.\Local`, String.raw`C:\Users\\operator\Local`,
  "C:\\Users\\operator\\Local\\", String.raw`C:\Users\operator\Local.`, String.raw`C:\Users\operator\Local `,
  String.raw`C:\Users\ operator\Local`, String.raw`C:\Users\operator:stream\Local`, String.raw`C:\Users\oper?ator\Local`,
  "C:\\Users\\oper\u0000ator\\Local", "C:\\Users\\oper\u001fator\\Local",
  String.raw`C:\Users\NUL\Local`, String.raw`C:\Users\NUL.txt\Local`, String.raw`C:\Users\CON .txt\Local`,
  String.raw`C:\Users\COM1\Local`, String.raw`C:\Users\LPT¹.txt\Local`]) {
  it(`refuses noncanonical Windows authority ${JSON.stringify(localAppData)}`, () => { assertWorkspaceRefused(localAppData); });
}

for (const localAppData of [undefined, ""] as const) {
  it(`refuses the default Windows host when LOCALAPPDATA is ${localAppData === undefined ? "missing" : "empty"}`, () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
    const identity = userInfo();
    const home = vi.spyOn(os, "userInfo").mockReturnValue({ ...identity, homedir: "/synthetic-fallback-home" });
    vi.stubEnv("LOCALAPPDATA", localAppData); syncBuiltinESMExports();
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      assert.throws(() => applicationDataWorkspace(), error => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, "code"), "APPLICATION_DATA_WORKSPACE_REFUSED");
        assert.equal(error.message, ERROR_CATALOG.APPLICATION_DATA_WORKSPACE_REFUSED.text);
        return true;
      });
      assert.equal(home.mock.calls.length, 0);
    } finally { Object.defineProperty(process, "platform", platform); vi.restoreAllMocks(); vi.unstubAllEnvs(); syncBuiltinESMExports(); }
  });
}

it("does not resolve host workspace authority for an admitted Windows worker pair", () => {
  const pair = { stateRoot: resolve("synthetic-admitted-state"), artifactRoot: resolve("synthetic-admitted-state/artifacts") };
  const settings = { paths: { reportsDir: resolve("synthetic-chosen-reports") } };
  const baseline = resolveConfigWithProvenance(settings, { primaryDisplay: null }, undefined, pair);
  const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
  const local = vi.spyOn(secrets, "windowsLocalApplicationData").mockImplementation(() => { throw new Error("unexpected-host-workspace-read"); });
  vi.stubEnv("LOCALAPPDATA", undefined);
  try {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    const observed = resolveConfigWithProvenance(settings, { primaryDisplay: null }, undefined, pair);
    assert.deepEqual(observed, baseline);
    assert.equal(observed.config.paths.stateRoot, pair.stateRoot);
    assert.equal(observed.config.paths.artifactRoot, pair.artifactRoot);
    assert.equal(observed.provenance["paths.reportsDir"], "settings");
    assert.equal(observed.provenance["paths.stateRoot"], "default");
    assert.equal(local.mock.calls.length, 0);
  } finally { Object.defineProperty(process, "platform", platform); vi.restoreAllMocks(); vi.unstubAllEnvs(); }
});

it("observes the host authority once when deriving unadmitted default paths", () => {
  const identity = userInfo();
  const home = vi.spyOn(os, "userInfo").mockReturnValue(identity);
  const local = vi.spyOn(secrets, "windowsLocalApplicationData").mockReturnValue(String.raw`C:\Users\Synthetic Operator\AppData\Local`);
  syncBuiltinESMExports();
  try {
    defaultRuntimePaths();
    assert.equal(home.mock.calls.length, process.platform === "win32" ? 0 : 1);
    assert.equal(local.mock.calls.length, process.platform === "win32" ? 1 : 0);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
});
