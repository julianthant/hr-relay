import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "work-study")!.descriptor;

describe("Work-Study Start run rows", () => {
  it("serves the two rows in order, every one locked with its reason", () => {
    assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, members }) => ({ key, label, kind, lockReason: lockReason ?? null, members })), [
      { key: "ucpath-auth", label: "Sign in to UCPath", kind: "locked", lockReason: "guard-read", members: [{ step: "ucpath-auth" }, { step: "reference-check" }] },
      { key: "transaction", label: "Submit work-study transaction", kind: "locked", lockReason: "form-action", members: [{ step: "transaction" }] },
    ]);
  });

  it("offers no switch and no typed field on any row", () => {
    for (const row of projectStartRows(descriptor)) {
      assert.equal(row.target, undefined, row.key);
      assert.equal(row.manual, undefined, row.key);
      assert.equal(row.selection, undefined, row.key);
    }
  });

  it("refuses a start that carries typed facts for any step", () => {
    const keys = projectStartSteps(descriptor).map(({ key }) => key);
    for (const step of keys) {
      assert.throws(() => resolveStartStepOmissions(descriptor, keys, [{ step, facts: { value: "typed" } }]),
        (error: unknown) => error instanceof StartStepOmissionRefusedError, step);
    }
  });

  it("plans nothing new and keeps today's node list", () => {
    assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined);
    const nodes = descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node.kind, node.dependsOn.map(String), "dryRun" in node ? node.dryRun ?? null : null]);
    // Today's 6 nodes with their kinds, dependencies and dry-run stops.
    assert.equal(createHash("sha256").update(JSON.stringify(nodes)).digest("hex"), "cb77e1a30e0591c61efd05eebcab2bd8cd8e53da8042bc729ab80c97abda9a81");
  });
});
