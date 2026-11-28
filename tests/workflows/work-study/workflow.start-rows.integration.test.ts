import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "work-study")!.descriptor;

describe("Work-Study Start run rows", () => {
  it("serves two switches in order, with typed PayPath values and a done-by-hand transaction", () => {
    assert.deepEqual(projectStartRows(descriptor).map(({ key, kind, lockReason, target, manual }) =>
      [key, kind, lockReason, target?.step, manual?.form.fields.map(field => field.key), manual?.forces]), [
      ["ucpath-auth", "switch", undefined, "ucpath-auth", ["emplId", "displayedName", "positionNumber", "effectiveDate", "positionChangeReason", "positionPool"], []],
      ["transaction", "switch", undefined, "transaction", [], []],
    ]);
    assert.deepEqual(descriptor.stepLocks, []);
  });

  it("requires a complete PayPath form when the read is turned off", () => {
    const selected = ["reference-check", "transaction"];
    assert.throws(() => resolveStartStepOmissions(descriptor, selected, undefined),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-missing");
    assert.throws(() => resolveStartStepOmissions(descriptor, selected, [{ step: "ucpath-auth", facts: {} }]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid");
  });

  it("plans nothing new and keeps today's node list", () => {
    assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined);
    const nodes = descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node.kind, node.dependsOn.map(String), "dryRun" in node ? node.dryRun ?? null : null]);
    // Today's 6 nodes with their kinds, dependencies and dry-run stops.
    assert.equal(createHash("sha256").update(JSON.stringify(nodes)).digest("hex"), "cb77e1a30e0591c61efd05eebcab2bd8cd8e53da8042bc729ab80c97abda9a81");
  });
});
