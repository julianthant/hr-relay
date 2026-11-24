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
    const report = z.object({ pid: z.int().positive(), busyPercent: z.number().nonnegative(),
      rssStartBytes: z.int().positive(), rssEndBytes: z.int().positive(),
      stalls: z.object({ count: z.number(), longestMs: z.number() }) }).parse(JSON.parse(await probe(path, "finish", signal)));
    expect(report.pid).toBe(process.pid);
    const { stalls } = report;
    expect(stalls.count).toBeGreaterThanOrEqual(1);
    expect(stalls.longestMs).toBeGreaterThan(100);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error); }); });
    rmdirSync(directory);
  }
});
