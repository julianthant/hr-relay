import { createOwnedViteProbeFixtures } from "../../../support/helpers/backend/owned-vite-probe-fixtures.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { afterEach,describe,it } from "vitest";

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

const { probeViteIdentity } = createOwnedViteProbeFixtures(CLOCK, OWNER_NONCE);

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
