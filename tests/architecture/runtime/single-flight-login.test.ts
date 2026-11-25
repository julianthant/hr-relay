import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

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
});
