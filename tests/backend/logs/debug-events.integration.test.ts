import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
  ])("persists in $mode and mirrors only in development", async ({ development, args, mirror }) => {
    const launch = productionWorkerLaunch(root, { RELAY_DEV_DEBUG_MIRROR: "1" }, development);
    const processChild = spawn(process.execPath, ["--import", testProcessImport(), child, ...args], {
      cwd: root, env: launch.environment, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    processChild.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    processChild.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    await once(processChild, "close");
    assert.equal(processChild.exitCode, 0, stderr);
    assert.equal(stdout, "1");
    if (mirror) {
      assert.equal(stderr.trim().split("\n").length, 1);
      assert.match(stderr, /"category":"duo"/u);
      assert.match(stderr, /"correlationId":"child-event"/u);
      assert.equal(stderr.includes("PRIVATE_MESSAGE_CANARY"), false);
    } else assert.equal(stderr, "");
  });
});
