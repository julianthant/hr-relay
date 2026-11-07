import assert from "node:assert/strict";
import { realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { it } from "vitest";

it("gives the run one private temp directory under the user temp", () => {
  const directory = realpathSync(tmpdir());
  assert.match(directory, /[/\\]hrt-[^/\\]+$/u);
  if (process.platform !== "win32") assert.equal(statSync(directory).mode & 0o777, 0o700);
});
