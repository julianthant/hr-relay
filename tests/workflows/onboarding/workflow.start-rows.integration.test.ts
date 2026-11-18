import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "onboarding")!.descriptor;

describe("Onboarding Start run rows", () => {
  it("serves the seven rows in order, every one locked with its reason", () => {
    assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, members }) => ({ key, label, kind, lockReason: lockReason ?? null, members })), [
      { key: "crm-data", label: "Read entry sheet", kind: "locked", lockReason: "guard-read", members: [{ step: "crm-data" }] },
      { key: "ucpath-search", label: "Match existing person", kind: "locked", lockReason: "guard-read", members: [{ step: "ucpath-search" }, { step: "reference-check" }] },
      { key: "i9-search", label: "Search I-9 profiles", kind: "locked", lockReason: "guard-read", members: [{ step: "i9-search" }] },
      { key: "hire-review", label: "Review hire findings", kind: "locked", lockReason: "approval", members: [{ step: "hire-review" }] },
      { key: "i9-creation", label: "Create I-9 profile", kind: "locked", lockReason: "form-action", members: [{ step: "i9-creation" }] },
      { key: "ucpath-hire", label: "Submit hire", kind: "locked", lockReason: "form-action", members: [{ step: "ucpath-hire" }] },
      { key: "master-results", label: "Fill master results", kind: "locked", lockReason: null, members: [{ step: "master-results" }] },
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
    // Today's 23 nodes with their kinds, dependencies and dry-run stops.
    assert.equal(createHash("sha256").update(JSON.stringify(nodes)).digest("hex"), "c8c20434eb90fd2fc73516f6c864c57663c7f405c499188e9da40229010ceb7f");
  });
});
