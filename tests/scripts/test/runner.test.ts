import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { selectedTestArguments } from "../../../scripts/test/runner.js";

describe("named test project policy", () => {
  it("locks unit and integration commands to one named project and rejects widening options", () => {
    assert.deepEqual(selectedTestArguments("unit", []), ["run", "--project", "unit", "--passWithNoTests=false"]);
    assert.deepEqual(selectedTestArguments("integration", ["tests/integration/storage.test.ts"]),
      ["run", "--project", "integration", "--passWithNoTests=false", "tests/integration/storage.test.ts"]);
    for (const option of ["--project", "--config", "--workspace", "--passWithNoTests", "-c", "", "bad\0filter"]) {
      assert.throws(() => selectedTestArguments("unit", [option]), /Invalid unit test filter/u);
    }
  });
});
