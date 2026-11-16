
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";
import {
  healthyUcpathDriver,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../../support/helpers/phase1f-executor-harness.js";

describe("single-flight login", () => {
  it("keeps session login invocation inside the worker session manager", () => {
    const violations = walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
      .map((file) => ({
        path: relative(REPO_ROOT, file).replaceAll("\\", "/"),
        content: readFileSync(file, "utf8"),
      }))
      .filter(({ path, content }) =>
        path !== "src/backend/runtime/workers/worker-sessions.ts" && content.includes("session.login("))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "a login path outside the session manager appeared");
    const manager = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-sessions.ts"), "utf8");
    assert.ok(manager.includes("session.login("), "the manager must own the one login call");
  });

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
