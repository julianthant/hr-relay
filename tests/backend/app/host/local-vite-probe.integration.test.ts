import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach,describe,it } from "vitest";
import { probeOwnedViteServer } from "../../../../src/backend/app/host/local-vite-probe.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const roots: string[] = [];
const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));
const OWNER_NONCE = "b".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dashboard preflight runner composition", () => {
  it("returns probe-request-failed for a closed allocated loopback port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    assert.deepEqual(await probeOwnedViteServer({
      port: address.port, signal: new AbortController().signal,
      deadlineMonotonicMs: CLOCK.monotonicMs() + 1_000,
      clock: CLOCK, ownerNonce: OWNER_NONCE,
    }), { state: "not-owned", reason: "probe-request-failed" });
  });
});
