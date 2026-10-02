import assert from "node:assert/strict";
import { it } from "vitest";
import { artifactOwnershipViolations } from "../../../../scripts/test-artifact-policy.js";

it("keeps generated output untracked and scratch/evidence outside the repository", () => {
  const input = {
    repositoryRoot: "/repo",
    scratchRoot: "/tmp/hrt-501",
    evidenceRoot: "/evidence/logs-backend-phase1",
    tracked: ["tests/fixtures/sample.ts", "tests/parity/references/run.png"],
    ignored: ["test-results/.last-run.json", "coverage/index.html", "tests/parity/.output/result.json"],
  };
  assert.deepEqual(artifactOwnershipViolations(input), []);
  assert.match(artifactOwnershipViolations({ ...input, tracked: [...input.tracked, "test-results/.last-run.json"] }).join("\n"),
    /generated test output is tracked: test-results\/\.last-run\.json/u);
  assert.match(artifactOwnershipViolations({ ...input, ignored: [] }).join("\n"), /generated test output is not ignored/u);
  assert.match(artifactOwnershipViolations({ ...input, scratchRoot: "/repo/test-results" }).join("\n"), /scratch must be outside/u);
  assert.match(artifactOwnershipViolations({ ...input, evidenceRoot: "/repo/evidence" }).join("\n"), /evidence must be outside/u);
});
