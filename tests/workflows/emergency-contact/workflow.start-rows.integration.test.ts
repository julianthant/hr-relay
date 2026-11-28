import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions } from "../../../src/backend/runs/start/step-selection.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { emergencyContactMemberModule } from "../../support/helpers/registered-workflows.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "emergency-contact")!.descriptor;
const nodeDigest = (nodes: ReturnType<typeof descriptorRuntimeNodes>): string => createHash("sha256").update(JSON.stringify(nodes.map((node) =>
  [String(node.id), node.kind, node.dependsOn.map(String), "dryRun" in node ? node.dryRun ?? null : null]))).digest("hex");

describe("Emergency Contact Start run rows", () => {
  it("serves the six rows over its own steps and its OCR and member children, every one locked", () => {
    const member = "emergency-contact-member";
    assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, members }) => ({ key, label, kind, lockReason: lockReason ?? null, members })), [
      { key: "read-emergency-contact", label: "Read emergency contact", kind: "locked", lockReason: null, members: [{ step: "read-document", nodes: ["read-document"] },
        { workflow: "ocr", step: "source-pages" }, { workflow: "ocr", step: "page-readings" }] },
      { key: "match-extracted-people", label: "Match extracted people", kind: "locked", lockReason: null, members: [{ step: "read-document", nodes: ["approved-records"] },
        { workflow: "ocr", step: "review-records" }, { workflow: "ocr", step: "identity-lookups" }, { workflow: "ocr", step: "signer-lookups" }] },
      { key: "review-extracted-records", label: "Review extracted records", kind: "locked", lockReason: "approval", members: [{ workflow: "ocr", step: "approval" }] },
      { key: "read-existing-contacts", label: "Read existing contacts", kind: "locked", lockReason: "bound-read", members: [{ workflow: member, step: "contact-plan" },
        { workflow: member, step: "reference-check" }] },
      { key: "fill-emergency-contact", label: "Fill emergency contact", kind: "locked", lockReason: "form-action", members: [{ workflow: member, step: "contact-preview", phase: "prepare" }] },
      { key: "save-emergency-contact", label: "Save emergency contact", kind: "locked", lockReason: "form-action", members: [{ workflow: member, step: "contact-preview", phase: "commit" },
        { workflow: member, step: "onbase-filing" }, { step: "members" }] },
    ]);
  });

  it("offers typed contact-plan values only on the member's own Start rows", () => {
    const memberRow = projectStartRows(emergencyContactMemberModule.descriptor).find(row => row.key === "contact-plan");
    assert.ok(memberRow);
    assert.equal(memberRow.kind, "switch");
    assert.equal(memberRow.off, "values");
    assert.ok(memberRow.manual);
    const parentRow = projectStartRows(descriptor).find(row => row.key === "read-existing-contacts");
    assert.ok(parentRow);
    assert.equal(parentRow.kind, "locked");
    assert.equal(parentRow.lockReason, "bound-read");
    assert.equal(parentRow.manual, undefined);
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

  it("plans nothing new and keeps today's node lists of the run and its member run", () => {
    assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined);
    // Today's 4 and 9 nodes with their kinds, dependencies and dry-run stops.
    assert.equal(nodeDigest(descriptorRuntimeNodes(descriptor)), "6297f780d9c773cb801aa754b71a57d97da4fa443124f9df35466e3fab9458a7");
    assert.equal(nodeDigest(descriptorRuntimeNodes(emergencyContactMemberModule.descriptor)), "4c30231da6ab1cacfe255d2e7dadec1d6187e7f486c9cb9060a33ead9aebc489");
  });
});
