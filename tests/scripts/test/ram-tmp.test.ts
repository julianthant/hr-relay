import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/test/ram-tmp.sh", import.meta.url));

it("refuses a missing or out-of-range RAM disk size before attaching one", () => {
  for (const args of [[], ["0"], ["8193"], ["eject"]]) {
    const result = spawnSync("sh", [script, ...args], { encoding: "utf8" });
    assert.notEqual(result.status, 0, args.join(" ") || "(no args)");
    assert.equal(result.stdout, "");
  }
});
