import { once } from "node:events";
import { mkdtempSync, realpathSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { probe, serveBackendProbe } from "../../../scripts/bench/idle-three-tab.js";

it("captures CPU and RSS endpoints and reports a stall over 100 ms on the probed thread", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "relay-probe-"));
  const path = join(directory, "probe.sock");
  const server = serveBackendProbe(path);
  try {
    await once(server, "listening");
    const signal = AbortSignal.timeout(10_000);
    expect(await probe(path, "start", signal)).toBe("started");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    const report: unknown = JSON.parse(await probe(path, "finish", signal));
    expect(report).toMatchObject({ pid: process.pid, busyPercent: expect.any(Number), rssStartBytes: expect.any(Number), rssEndBytes: expect.any(Number) });
    const { stalls } = z.object({ stalls: z.object({ count: z.number(), longestMs: z.number() }) }).parse(report);
    expect(stalls.count).toBeGreaterThanOrEqual(1);
    expect(stalls.longestMs).toBeGreaterThan(100);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error); }); });
    rmdirSync(directory);
  }
});
