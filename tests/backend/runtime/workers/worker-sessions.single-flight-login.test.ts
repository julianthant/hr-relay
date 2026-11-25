import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
  healthyUcpathDriver,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";

describe("single-flight login", () => {

  it("authenticates once for two concurrent leases on one worker/system", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const manager = await sessionManagerFor(harness, manualClock(new Date("2026-08-03T09:00:00.000Z")));
    const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
    const signal = new AbortController().signal;
    const order: string[] = [];
    await Promise.all([
      manager.withDriver(need, "prod", signal, async () => {
        order.push("first");
      }),
      manager.withDriver(need, "prod", signal, async () => {
        order.push("second");
      }),
    ]);
    assert.deepEqual(order, ["first", "second"], "leases must serialize, not interleave");
    assert.equal(harness.opens("ucpath"), 1, "one session open for both leases");
    assert.equal(harness.logins(), 1, "exactly one login for both leases");
  });
});
