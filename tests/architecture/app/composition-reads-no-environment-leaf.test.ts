import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { inventoryEnvironmentAccesses } from "../runtime/helpers/environment-read-audit.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

function resolverViolations(path: string, source: string): readonly string[] {
  return inventoryEnvironmentAccesses(path, source).map(({ operation }) => `${path}: resolver environment ${operation} is forbidden`);
}

describe("composition-reads-no-environment-leaf", () => {
  it("walks every config module and rejects direct, aliased and computed process environment access", () => {
    const paths = gitVisibleFiles(["src/models/config", "src/backend/app/config"]).filter((path) => path.endsWith(".ts") && path !== "src/models/config/secrets.ts");
    assert.ok(paths.includes("src/backend/app/config/resolve.ts"));
    assert.equal(paths.includes("src/models/config/secrets.ts"), false);
    assert.ok(resolverViolations("src/models/config/future.ts", "export const value = process.env.UCPATH_PASSWORD;").length > 0);
    assert.deepEqual(paths.flatMap((path) => resolverViolations(path, readFileSync(join(REPO_ROOT, path), "utf8"))), []);
    for (const source of ["const value = process.env.HRAUTO_DEFAULT_WORKERS;", "const env = process.env; const value = env[key];", "delete process.env.UCPATH_PASSWORD;"])
      assert.ok(resolverViolations("src/backend/app/config/resolve.ts", source).length > 0, source);
  });
});
