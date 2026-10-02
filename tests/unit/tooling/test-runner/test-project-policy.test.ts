import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { selectedTestArguments } from "../../../../scripts/test-runner.js";
import { projectOwnershipViolations } from "../../../../scripts/test-project-policy.js";

describe("named test project policy", () => {
  it("locks unit and integration commands to one named project and rejects widening options", () => {
    assert.deepEqual(selectedTestArguments("unit", []), ["run", "--project", "unit", "--passWithNoTests=false"]);
    assert.deepEqual(selectedTestArguments("integration", ["tests/integration/storage.test.ts"]),
      ["run", "--project", "integration", "--passWithNoTests=false", "tests/integration/storage.test.ts"]);
    for (const option of ["--project", "--config", "--workspace", "--passWithNoTests", "-c", "", "bad\0filter"]) {
      assert.throws(() => selectedTestArguments("unit", [option]), /Invalid unit test filter/u);
    }
  });

  it("refuses an orphan, duplicate owner, empty lane, duplicate listing and undeclared collection", () => {
    const files = ["tests/unit/policy.test.ts", "tests/integration/storage.test.ts", "tests/architecture/guard.test.ts"];
    const good = [
      { name: "unit", files: [files[0]] },
      { name: "integration", files: [files[1]] },
      { name: "architecture", files: [files[2]] },
    ];
    assert.deepEqual(projectOwnershipViolations(files, good), []);
    assert.match(projectOwnershipViolations(files, good.slice(0, 2)).join("\n"), /guard\.test\.ts: expected exactly one Vitest project, found none/u);
    assert.match(projectOwnershipViolations(files, [...good, { name: "extra", files: [files[1]] }]).join("\n"),
      /storage\.test\.ts: expected exactly one Vitest project, found integration, extra/u);
    assert.match(projectOwnershipViolations(files, [...good.slice(0, 2), { name: "architecture", files: [] }]).join("\n"),
      /architecture: project collects no tests/u);
    assert.match(projectOwnershipViolations([...files, files[0]], good).join("\n"), /authored test listing contains duplicates/u);
    assert.match(projectOwnershipViolations(files, [...good.slice(0, 2), { name: "architecture", files: ["other.test.ts"] }]).join("\n"),
      /collected path is not a declared Vitest test/u);
  });
});
