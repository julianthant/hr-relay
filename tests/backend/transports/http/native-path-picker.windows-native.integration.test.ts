import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { describe,it,vi } from "vitest";
import { createNativePathPicker } from "../../../../src/backend/transports/http/native-path-picker.js";

const launched = vi.hoisted(() => [] as ChildProcess[]);
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: unknown[]) => {
    const child = Reflect.apply(actual.execFile, actual, args) as ChildProcess;
    launched.push(child);
    return child;
  } };
});

describe.runIf(process.platform === "win32")("Windows native picker process", () => {
  it("launches the actual helper and closes its process on request abort", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const result = await createNativePathPicker().pick({ field: "paths.reportsDir" }, controller.signal);
      assert.equal(launched.length, 1, "Windows picker must launch the native helper");
      assert.equal(controller.signal.aborted, true, "helper must remain alive until request abort");
      assert.deepEqual(result, { state: "unavailable", field: "paths.reportsDir", reason: "dialog-failed" });
      const child = launched[0];
      assert.ok(child?.pid);
      assert.ok(child.exitCode !== null || child.signalCode !== null, "helper must have exited before picker settles");
      assert.throws(() => process.kill(child.pid ?? 0, 0), { code: "ESRCH" });
    } finally {
      clearTimeout(timer);
      controller.abort();
      for (const child of launched) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
});
