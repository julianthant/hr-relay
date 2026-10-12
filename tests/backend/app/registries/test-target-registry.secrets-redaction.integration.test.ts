import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { runTestTargetDocumentNumberSmoke } from "../../../../scripts/verify/test-target-document-number.js";
import { TestTargetRegistryDefectError } from "../../../../src/backend/app/registries/test-target-registry.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";

describe("closed secret access", () => {

  it("records a known registry defect as defect", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: testDataInputSource(),
      resolveSubject: () => Promise.reject(new TestTargetRegistryDefectError("known registry defect")),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=not-attempted",
      "workflow=separations label=finalization-canary resolution=defect",
    ]);
  });
});
