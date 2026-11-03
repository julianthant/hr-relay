import { BUILD_MANIFEST_PATH } from "../../../src/models/workflow/build-manifest.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { it } from "vitest";
import { artifactOwnershipViolations } from "../../../scripts/test/artifact-policy.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

it("keeps generated output ignored and external evidence outside the checkout", () => {
  const tracked = execFileSync("git", ["ls-files", "--", "test-results/", "coverage/", BUILD_MANIFEST_PATH],
    { cwd: REPO_ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const ignored = ["test-results/.last-run.json", "coverage/index.html", BUILD_MANIFEST_PATH]
    .filter((path) => {
      try {
        execFileSync("git", ["check-ignore", "--no-index", "-q", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
        return true;
      } catch { return false; }
    });
  assert.deepEqual(artifactOwnershipViolations({
    repositoryRoot: REPO_ROOT,
    scratchRoot: tmpdir(),
    evidenceRoot: resolve(REPO_ROOT, "..", "..", "hr-automation-rebuild-evidence", "2026-09-30", "logs-backend-phase1"),
    tracked,
    ignored,
  }), []);
});
