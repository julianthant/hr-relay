import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { GENERATED_OUTPUTS, generatedOnlyConflicts } from "../../../scripts/build/generated-outputs.js";

describe("generated conflict classification", () => {
  const roadmapPath = "docs/roadmap/index.html";
  it("accepts only nonempty sets of registered generated outputs", () => {
    assert.equal(generatedOnlyConflicts([roadmapPath]), true);
    assert.equal(generatedOnlyConflicts(GENERATED_OUTPUTS.flatMap(output => [...output.paths])), true);
    assert.equal(generatedOnlyConflicts([roadmapPath, "src/models/failures/error-catalog.ts"]), false);
    assert.equal(generatedOnlyConflicts(["src/workflows/unknown/generated.ts"]), false);
    assert.equal(generatedOnlyConflicts([]), false);
  });
});
