import { BUILD_MANIFEST_PATH } from "../../../src/models/workflow/build-manifest.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { artifactOwnershipViolations } from "../../../scripts/test/artifact-policy.js";

it("keeps generated output untracked and scratch/evidence outside the repository", () => {
  const input = {
    repositoryRoot: "/repo",
    scratchRoot: "/tmp/hrt-501",
    evidenceRoot: "/evidence/logs-backend-phase1",
    tracked: ["tests/support/fixtures/sample.ts"],
    ignored: ["test-results/.last-run.json", "coverage/index.html", BUILD_MANIFEST_PATH],
  };
  assert.deepEqual(artifactOwnershipViolations(input), []);
  assert.match(artifactOwnershipViolations({ ...input, tracked: [...input.tracked, BUILD_MANIFEST_PATH] }).join("\n"),
    /generated build manifest is tracked: src\/workflow-kit\/validation\/generated-build-manifest\.ts/u);
  assert.match(artifactOwnershipViolations({ ...input, ignored: input.ignored.filter(path => path !== BUILD_MANIFEST_PATH) }).join("\n"),
    /generated build manifest is not ignored: src\/workflow-kit\/validation\/generated-build-manifest\.ts/u);
  assert.deepEqual(artifactOwnershipViolations({ ...input, tracked: [...input.tracked, `${BUILD_MANIFEST_PATH}.other`] }), []);
  assert.match(artifactOwnershipViolations({ ...input, tracked: [...input.tracked, "test-results/.last-run.json"] }).join("\n"),
    /generated test output is tracked: test-results\/\.last-run\.json/u);
  assert.match(artifactOwnershipViolations({ ...input, ignored: [] }).join("\n"), /generated test output is not ignored/u);
  assert.match(artifactOwnershipViolations({ ...input, scratchRoot: "/repo/test-results" }).join("\n"), /scratch must be outside/u);
  assert.match(artifactOwnershipViolations({ ...input, evidenceRoot: "/repo/evidence" }).join("\n"), /evidence must be outside/u);
});
