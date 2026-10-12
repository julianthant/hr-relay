import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach,describe,it } from "vitest";
import { probeOwnedViteServer } from "../../../../src/backend/app/host/local-vite-probe.js";
import { DASHBOARD_FRONTEND_OWNER_PATH } from "../../../../src/backend/transports/http/frontend-owner.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const roots: string[] = [];
const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));
const OWNER_NONCE = "b".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const OWNED_VITE_INDEX = '<title>Relay</title><script type="module" src="/app/main.tsx"></script>';
const OWNED_VITE_CLIENT = 'const name = "Vite"; export function createHotContext() {}';

async function probeViteIdentity(fixture: Readonly<{
  owner: string;
  index: string;
  client: string;
}>) {
  const requestedPaths: string[] = [];
  const server = createServer((request, response) => {
    requestedPaths.push(request.url ?? "<missing>");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH
      ? fixture.owner
      : request.url === "/"
        ? fixture.index
        : fixture.client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
    const result = await probeOwnedViteServer({
      port: address.port,
      signal: new AbortController().signal,
      deadlineMonotonicMs: CLOCK.monotonicMs() + 1_000,
      clock: CLOCK,
      ownerNonce: OWNER_NONCE,
    });
    return { result, requestedPaths };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describe("dashboard preflight runner composition", () => {

  it("accepts only the exact owned Vite owner, index, and client identity path", async () => {
    const { result, requestedPaths } = await probeViteIdentity({
      owner: OWNER_NONCE,
      index: OWNED_VITE_INDEX,
      client: OWNED_VITE_CLIENT,
    });

    assert.deepEqual(result, { state: "owned" });
    assert.deepEqual(requestedPaths, [DASHBOARD_FRONTEND_OWNER_PATH, "/", "/@vite/client"]);
  });

  it("refuses an owner response too large to be a launch nonce", async () => {
    const { result, requestedPaths } = await probeViteIdentity({
      owner: `${OWNER_NONCE}${"x".repeat(1024)}`,
      index: OWNED_VITE_INDEX,
      client: OWNED_VITE_CLIENT,
    });

    assert.deepEqual(result, { state: "not-owned", reason: "probe-response-too-large" });
    assert.deepEqual(requestedPaths, [DASHBOARD_FRONTEND_OWNER_PATH]);
  });
});
