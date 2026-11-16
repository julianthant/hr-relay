
import assert from "node:assert/strict";
import { afterEach,describe,it,vi } from "vitest";
import {
HOST_PRIMARY_DISPLAY_ENV,
type HostPrimaryDisplayObservation
} from "../../../src/models/config/host-display.js";
import { hostAwareResolutionEnvironment, windowsProgramFilesRoots, windowsSystemRoot, workerBootstrapEnvironment } from "../../../src/models/config/secrets.js";
const DETECTED: HostPrimaryDisplayObservation = { state: "detected", screenWidth: 1512, screenHeight: 982, source: "system_profiler" };

describe("host display default", () => {

  it("hands compositions the SAME environment object with the host display established in it", () => {
    const env: NodeJS.ProcessEnv = { UNRELATED: "kept" };
    const resolved = hostAwareResolutionEnvironment(() => DETECTED, env);
    assert.equal(resolved, env);
    assert.equal(resolved[HOST_PRIMARY_DISPLAY_ENV], "1512x982");
    assert.equal(resolved.UNRELATED, "kept");
  });
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("Windows process mechanics", () => {
  it("reads exact program roots freshly without defaulting or adding worker inheritance", () => {
    vi.stubEnv("ProgramFiles", undefined); vi.stubEnv("ProgramFiles(x86)", undefined);
    assert.deepEqual(windowsProgramFilesRoots(), [undefined, undefined]);
    vi.stubEnv("ProgramFiles", "C:\\Program Files"); vi.stubEnv("ProgramFiles(x86)", "C:\\Program Files (x86)");
    assert.deepEqual(windowsProgramFilesRoots(), ["C:\\Program Files (x86)", "C:\\Program Files"]);
    vi.stubEnv("ProgramFiles", "invalid-root");
    assert.deepEqual(windowsProgramFilesRoots(), ["C:\\Program Files (x86)", "invalid-root"]);
    assert.deepEqual(workerBootstrapEnvironment({ ProgramFiles: "not-for-workers", "ProgramFiles(x86)": "also-not-for-workers", PATH: "synthetic-path" }), { PATH: "synthetic-path" });
  });
  it("reads the current exact SystemRoot value without defaulting or caching", () => {
    vi.stubEnv("SystemRoot", undefined);
    assert.equal(windowsSystemRoot(), undefined);
    vi.stubEnv("SystemRoot", "C:\\Windows");
    assert.equal(windowsSystemRoot(), "C:\\Windows");
    vi.stubEnv("SystemRoot", "invalid-root");
    assert.equal(windowsSystemRoot(), "invalid-root");
  });
});

it("keeps the host LOCALAPPDATA authority out of worker bootstrap inheritance", () => {
  assert.deepEqual(workerBootstrapEnvironment({ LOCALAPPDATA: "synthetic-host-path", PATH: "synthetic-path", [HOST_PRIMARY_DISPLAY_ENV]: "none" }),
    { PATH: "synthetic-path", [HOST_PRIMARY_DISPLAY_ENV]: "none" });
});
