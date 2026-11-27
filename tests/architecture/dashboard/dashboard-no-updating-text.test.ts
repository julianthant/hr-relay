import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, it } from "vitest";

const SOURCE = join(import.meta.dirname, "../../../src/dashboard");

it("no dashboard source shows Updating text; a refresh is only a spinner", () => {
  const offenders = (readdirSync(SOURCE, { recursive: true, encoding: "utf8" }))
    .filter(file => /\.(tsx?|css)$/.test(file) && /\bUpdating\b/.test(readFileSync(join(SOURCE, file), "utf8")));
  assert.deepEqual(offenders, []);
});
