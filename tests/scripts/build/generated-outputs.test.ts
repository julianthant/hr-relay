import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { clearGeneratedSection, GENERATED_OUTPUTS, generatedOnlyConflicts } from "../../../scripts/build/generated-outputs.js";
import { workflowRegistrySources } from "../../../scripts/build/generate-workflow-registries.js";

describe("generated conflict classification", () => {
  const registryPath = "src/workflows/generated-descriptors.ts";
  it("accepts only nonempty sets of registered generated outputs", () => {
    assert.equal(generatedOnlyConflicts([registryPath]), true);
    assert.equal(generatedOnlyConflicts(GENERATED_OUTPUTS.flatMap(output => [...output.paths])), true);
    assert.equal(generatedOnlyConflicts([registryPath, "src/models/failures/error-catalog.ts"]), false);
    assert.equal(generatedOnlyConflicts(["src/workflows/unknown/generated.ts"]), false);
    assert.equal(generatedOnlyConflicts([]), false);
    assert.equal(generatedOnlyConflicts(["src/workflow-kit/validation/generated-build-manifest.ts"]), false);
    const registry = GENERATED_OUTPUTS.find(output => output.script === "build:registries");
    assert.deepEqual(registry?.paths.toSorted(), [...workflowRegistrySources(process.cwd()).keys()].toSorted());
  });

  const section = { start: "<!-- store-catalog:start -->", end: "<!-- store-catalog:end -->" };
  const conflict = "<<<<<<< HEAD\nold catalog\n=======\nnew catalog\n>>>>>>> staging\n";
  it("clears generated catalog conflicts while preserving merged authored text", () => {
    const content = `Authored introduction\n${section.start}\n${conflict}${section.end}\nAuthored ending\n`;
    assert.equal(clearGeneratedSection(content, section), `Authored introduction\n${section.start}\n\n${section.end}\nAuthored ending\n`);
  });
  it("refuses authored conflicts and missing, duplicated or reversed section markers", () => {
    const valid = `${section.start}\n${conflict}${section.end}\n`;
    assert.throws(() => clearGeneratedSection(conflict + valid, section), /authored-section-conflict/u);
    assert.throws(() => clearGeneratedSection(valid + conflict, section), /authored-section-conflict/u);
    for (const content of [conflict, valid + section.start, valid + section.end, section.end + section.start]) {
      assert.throws(() => clearGeneratedSection(content, section), /generated-section-markers-invalid/u);
    }
  });
});
