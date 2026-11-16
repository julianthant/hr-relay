import assert from "node:assert/strict";
import { it } from "vitest";
import { parseQueuedRunCancellation } from "../../../../src/backend/storage/maintenance/cancel-queued-runs.js";

it("admits only explicit plan or digest-bound apply", () => {
  assert.deepEqual(parseQueuedRunCancellation(["--plan", "--json"]), { apply: false, captureDigest: undefined, json: true });
  assert.deepEqual(parseQueuedRunCancellation(["--capture", "a".repeat(64), "--apply"]), { apply: true, captureDigest: "a".repeat(64), json: false });
  for (const args of [[], ["--apply"], ["--plan", "--apply"], ["--plan", "--capture", "a".repeat(64)],
    ["--plan", "--plan"], ["--plan", "--unknown"], ["--apply", "--capture", "bad"]]) assert.throws(() => parseQueuedRunCancellation(args));
});
