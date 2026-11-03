import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { productionWorkerLaunch } from "../../../src/backend/app/composition/dashboard/compose.js";
import { testProcessImport } from "../../support/compiled-process.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const child = fileURLToPath(new URL("../../support/processes/debug-event-child.ts", import.meta.url));

describe("debug events in backend descendants", () => {
  it.each([
    { mode: "development", development: true, args: [], mirror: true },
    { mode: "production", development: false, args: [], mirror: false },
    { mode: "production entrypoint", development: true, args: ["--prod"], mirror: false },
    { mode: "Electron", development: true, args: ["--electron"], mirror: false },
  ])("persists in $mode and mirrors only in development", ({ development, args, mirror }) => {
    const launch = productionWorkerLaunch(root, { RELAY_DEV_DEBUG_MIRROR: "1" }, development);
    const result = spawnSync(process.execPath, ["--import", testProcessImport(), child, ...args], {
      cwd: root, env: launch.environment, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "1");
    if (mirror) {
      assert.equal(result.stderr.trim().split("\n").length, 1);
      assert.match(result.stderr, /"category":"duo"/u);
      assert.match(result.stderr, /"correlationId":"child-event"/u);
      assert.equal(result.stderr.includes("PRIVATE_MESSAGE_CANARY"), false);
    } else assert.equal(result.stderr, "");
  });
});
