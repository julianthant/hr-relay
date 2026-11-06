import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { it } from "vitest";
import { computeBuildId } from "../../../src/backend/app/build-id.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const HASHED_ROOTS = ["src/backend", "src/workflow-kit", "src/workflows", "src/models", "src/rules"];

it("keeps worker code from importing the dashboard tree the build id excludes", () => {
  const violations: string[] = [];
  for (const root of HASHED_ROOTS) {
    for (const file of walkFiles(join(REPO_ROOT, root))) {
      for (const match of readFileSync(file, "utf8").matchAll(/from\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/gu)) {
        const target = relative(REPO_ROOT, resolve(dirname(file), match[1] ?? match[2] ?? ""));
        if (target.startsWith("src/dashboard/")) violations.push(`${relative(REPO_ROOT, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

it("computes the checkout's build id without an unresolved dependency or specifier", () => {
  assert.match(computeBuildId(REPO_ROOT), /^[0-9a-f]{64}$/u);
});
