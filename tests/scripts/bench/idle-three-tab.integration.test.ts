import { once } from "node:events";
import { mkdtempSync, realpathSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { probe, serveBackendProbe } from "../../../scripts/bench/idle-three-tab.js";

it("subtracts timer CPU, captures RSS endpoints, and reports a stall over 100 ms on the probed thread", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "relay-probe-"));
  const path = join(directory, "probe.sock");
  const server = serveBackendProbe(path);
  try {
    await once(server, "listening");
    const signal = AbortSignal.timeout(10_000);
    expect(await probe(path, "start", signal)).toBe("started");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    await delay(50, undefined, { signal });
    const report = z.object({ pid: z.int().positive(), busyPercent: z.number().nonnegative(),
      elapsedMs: z.number().positive(), threadCpuMicros: z.int().positive(), probeCpuMicros: z.int().positive(),
      rssStartBytes: z.int().positive(), rssEndBytes: z.int().positive(),
      stalls: z.object({ count: z.number(), longestMs: z.number() }) }).parse(JSON.parse(await probe(path, "finish", signal)));
    expect(report.pid).toBe(process.pid);
    expect(report.probeCpuMicros).toBeLessThan(report.threadCpuMicros);
    expect(report.busyPercent).toBe((report.threadCpuMicros - report.probeCpuMicros) / (report.elapsedMs * 10));
    const { stalls } = report;
    expect(stalls.count).toBeGreaterThanOrEqual(1);
    expect(stalls.longestMs).toBeGreaterThan(100);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error); }); });
    rmdirSync(directory);
  }
});
