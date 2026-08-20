/**
 * Ref execution-and-sessions §4: login is bounded and single-flight within one worker/system
 * session creation — there is no cross-worker login promise, no shared
 * context, and no second code path that authenticates a session.
 *
 * - STRUCTURAL: `store.session.login(` is invoked only inside
 *   `src/core/worker-sessions.ts` (the manager's `#openAndLogin`), so no task,
 *   workflow, or service can authenticate around the ownership model.
 * - BEHAVIORAL: two concurrent driver leases for one system on one worker
 *   produce exactly ONE session open and ONE login — the second lease reuses
 *   the healthy authenticated session after the first releases cleanly.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";
import {
  healthyUcpathDriver,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../fixtures/phase1f-executor-harness.js";

describe("single-flight login", () => {
  it("keeps session login invocation inside the worker session manager", () => {
    const violations = walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
      .map((file) => ({
        path: relative(REPO_ROOT, file).replaceAll("\\", "/"),
        content: readFileSync(file, "utf8"),
      }))
      .filter(({ path, content }) =>
        path !== "src/core/worker-sessions.ts" && content.includes("session.login("))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "a login path outside the session manager appeared");
    const manager = readFileSync(join(REPO_ROOT, "src/core/worker-sessions.ts"), "utf8");
    assert.ok(manager.includes("session.login("), "the manager must own the one login call");
  });

  it("authenticates once for two concurrent leases on one worker/system", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const manager = sessionManagerFor(harness, manualClock(new Date("2026-08-03T09:00:00.000Z")));
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
