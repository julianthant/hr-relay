import assert from "node:assert/strict";
import children from "node:child_process";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { it, vi } from "vitest";
import { observeProcessIdentity } from "../../../../src/backend/storage/admission/process-identity.js";

it("keeps one live process identity stable when the caller timezone changes", () => {
  const priorTimezone = process.env["TZ"];
  try {
    process.env["TZ"] = "America/Los_Angeles";
    const first = observeProcessIdentity(process.pid);
    process.env["TZ"] = "Pacific/Honolulu";
    const second = observeProcessIdentity(process.pid);
    assert.equal(second.state, "alive");
    assert.deepEqual(second, first);
    if (process.platform === "darwin" && second.state === "alive") assert.match(second.identity.startToken, /^\d+$/u);
  } finally {
    if (priorTimezone === undefined) delete process.env["TZ"];
    else process.env["TZ"] = priorTimezone;
  }
});


it.runIf(process.platform === "darwin" || process.platform === "win32")("reports a stalled start-identity query after reaping the helper", async () => {
  const target = children.spawn(process.execPath, ["-e", "setTimeout(() => {}, 10_000);"], { stdio: "ignore" });
  const closed = once(target, "close");
  const pid = target.pid;
  const spawn = children.spawnSync;
  let childPid: number | undefined, signal: string | null = null;
  const query = vi.spyOn(children, "spawnSync").mockImplementation((_command, _args, options) => {
    const result = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 1500);"], {
      ...options, timeout: typeof options?.timeout === "number" && options.timeout > 0 ? Math.min(options.timeout, 300) : undefined,
    });
    childPid = result.pid;
    signal = result.signal;
    return result;
  });
  syncBuiltinESMExports();
  try {
    assert.ok(pid);
    assert.throws(() => observeProcessIdentity(pid), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(`could not observe (Darwin|Windows) start identity for pid ${pid}`, "u"));
      assert.match(String(error.cause), /ETIMEDOUT/u);
      return true;
    });
    if (process.platform === "darwin") assert.equal(signal, "SIGKILL");
    assert.ok(childPid);
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  } finally {
    query.mockRestore();
    syncBuiltinESMExports();
    target.kill("SIGKILL");
    await closed;
  }
});
