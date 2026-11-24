import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { it, vi } from "vitest";
import { readOwnerLine } from "./worker-lifetime-world.js";

it("drains buffered owner lines and rejects a pending read when the child closes stdout", async () => {
  const child = spawn(process.execPath, ["-e", "process.stdout.write('ready\\nqueued\\n'); process.stdin.resume();"],
    { stdio: ["pipe", "pipe", "inherit"] });
  const closed = once(child, "close");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    assert.equal(await readOwnerLine(child), "ready");
    assert.equal(await readOwnerLine(child), "queued");
    let failure: unknown;
    void readOwnerLine(child).catch((error: unknown) => { failure = error; });
    child.stdin.end();
    assert.deepEqual(await closed, [0, null]);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(failure instanceof Error, "closing stdout did not reject the pending line read");
    assert.equal(failure.message, "fence owner closed its channel");
    await assert.rejects(readOwnerLine(child), /fence owner closed its channel/u);
  } finally {
    vi.useRealTimers();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
});
