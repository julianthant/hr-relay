import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { selectedTestArguments, vitestCommandArguments } from "../../../scripts/test/runner.js";

describe("named test project policy", () => {
  it("locks unit and integration commands to one named project and rejects widening options", () => {
    assert.deepEqual(selectedTestArguments("unit", []), ["run", "--project", "unit", "--passWithNoTests=false"]);
    assert.deepEqual(selectedTestArguments("integration", ["tests/integration/storage.test.ts"]),
      ["run", "--project", "integration", "--passWithNoTests=false", "tests/integration/storage.test.ts"]);
    for (const option of ["--project", "--config", "--workspace", "--passWithNoTests", "-c", "", "bad\0filter"]) {
      assert.throws(() => selectedTestArguments("unit", [option]), /Invalid unit test filter/u);
    }
  });

  it("keeps a bare run on cloud and perf projects and leaves an explicit project alone", () => {
    assert.deepEqual(vitestCommandArguments(["run"]), [
      "run", "--project", "unit", "--project", "integration", "--project", "architecture", "--project", "perf",
    ]);
    assert.deepEqual(vitestCommandArguments(["run", "tests/models/owned.test.ts"]), [
      "run", "--project", "unit", "--project", "integration", "--project", "architecture", "--project", "perf",
      "tests/models/owned.test.ts",
    ]);
    assert.deepEqual(vitestCommandArguments(["run", "--project", "local", "--passWithNoTests=true"]), [
      "run", "--project", "local", "--passWithNoTests=true",
    ]);
    assert.deepEqual(vitestCommandArguments(["run", "--config", "custom.ts", "proof.test.ts"]), [
      "run", "--config", "custom.ts", "proof.test.ts",
    ]);
    assert.deepEqual(vitestCommandArguments(["run", "--config=custom.ts"]), ["run", "--config=custom.ts"]);
    assert.deepEqual(vitestCommandArguments(["run", "-c", "custom.ts"]), ["run", "-c", "custom.ts"]);
    assert.deepEqual(vitestCommandArguments(["unit", "tests/models/owned.test.ts"]), [
      "run", "--project", "unit", "--passWithNoTests=false", "tests/models/owned.test.ts",
    ]);
  });
});
