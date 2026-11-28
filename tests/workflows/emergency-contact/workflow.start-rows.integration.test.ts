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
  it("serves the OCR switches and keeps the Emergency Contact member rows locked", () => {
    const member = "emergency-contact-member";
    assert.deepEqual(projectStartRows(descriptor).map(({ key, label, kind, lockReason, members }) => ({ key, label, kind, lockReason: lockReason ?? null, members })), [
      { key: "ocr-source-pages", label: "Prepare source pages", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "source-pages" }] },
      { key: "read-emergency-contact", label: "Read emergency contact", kind: "switch", lockReason: null, members: [{ step: "read-document", nodes: ["read-document"] },
        { workflow: "ocr", step: "page-readings" }] },
      { key: "ocr-group-records", label: "Group records for review", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "review-records" }] },
      { key: "match-extracted-people", label: "Match extracted people", kind: "switch", lockReason: null, members: [{ step: "read-document", nodes: ["approved-records"] },
        { workflow: "ocr", step: "identity-lookups" }] },
      { key: "ocr-signer-lookups", label: "Look up official signers", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "signer-lookups" }] },
      { key: "review-extracted-records", label: "Review extracted records", kind: "switch", lockReason: null, members: [{ workflow: "ocr", step: "approval" }] },
      { key: "read-existing-contacts", label: "Read existing contacts", kind: "locked", lockReason: "bound-read", members: [{ workflow: member, step: "contact-plan" },
        { workflow: member, step: "reference-check" }] },
      { key: "fill-emergency-contact", label: "Fill emergency contact", kind: "locked", lockReason: "form-action", members: [{ workflow: member, step: "contact-preview", phase: "prepare" }] },
      { key: "save-emergency-contact", label: "Save emergency contact", kind: "locked", lockReason: "form-action", members: [{ workflow: member, step: "contact-preview", phase: "commit" },
        { workflow: member, step: "onbase-filing" }, { step: "members" }] },
    ]);
  });

  it("offers the member's contact plan values only in the member's own Start", () => {
    assert.equal(emergencyContactMemberModule.descriptor.stepOmissions.find(({ step }) => step === "contact-plan")?.ownStartOnly, true);
  });

  it("offers typed fields only for OCR child steps", () => {
    for (const row of projectStartRows(descriptor)) {
      assert.deepEqual(row.target, row.kind === "switch" ? row.members.find(({ workflow }) => workflow === "ocr") : undefined, row.key);
      assert.equal(row.manual !== undefined, row.kind === "switch", row.key);
      assert.equal(row.selection, undefined, row.key);
    }
  });

  it("refuses typed facts for the parent's own steps", () => {
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
