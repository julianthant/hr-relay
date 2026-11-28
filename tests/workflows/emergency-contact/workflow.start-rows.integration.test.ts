import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions, startRowWire } from "../../../src/backend/runs/start/step-selection.js";
import { rowFieldsOpen, rowIncluded, startRowsOf } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { emergencyContactMemberModule } from "../../support/helpers/registered-workflows.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "emergency-contact")!.descriptor;
const nodeDigest = (nodes: ReturnType<typeof descriptorRuntimeNodes>): string => createHash("sha256").update(JSON.stringify(nodes.map((node) =>
  [String(node.id), node.kind, node.dependsOn.map(String), "dryRun" in node ? node.dryRun ?? null : null]))).digest("hex");

describe("Emergency Contact Start run rows", () => {
  it("serves every OCR and Emergency Contact row as a switch", () => {
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
      { key: "read-existing-contacts", label: "Read existing contacts", kind: "switch", lockReason: null, members: [{ workflow: member, step: "contact-plan" },
        { workflow: member, step: "reference-check" }, { step: "members" }] },
      { key: "fill-emergency-contact", label: "Fill and save emergency contact", kind: "switch", lockReason: null, members: [{ workflow: member, step: "contact-preview" }] },
      { key: "file-to-onbase", label: "File to OnBase", kind: "switch", lockReason: null, members: [{ workflow: member, step: "onbase-filing" }] },
    ]);
  });

  it("offers typed contact-plan values only on the member's own Start rows", () => {
    assert.equal(emergencyContactMemberModule.descriptor.stepOmissions.find(({ step }) => step === "contact-plan")?.ownStartOnly, true);
    const memberRow = projectStartRows(emergencyContactMemberModule.descriptor).find(row => row.key === "contact-plan");
    assert.ok(memberRow);
    assert.equal(memberRow.kind, "switch");
    assert.equal(memberRow.off, "values");
    assert.ok(memberRow.manual);
    const parentRow = projectStartRows(descriptor).find(row => row.key === "read-existing-contacts");
    assert.ok(parentRow);
    assert.deepEqual(parentRow.target, { step: "members" });
    assert.ok(parentRow.stop);
    assert.deepEqual(parentRow.manual?.form.fields, []);
  });

  it("offers typed fields only for OCR child steps", () => {
    for (const row of projectStartRows(descriptor)) {
      const ocr = row.members.find(({ workflow }) => workflow === "ocr");
      if (ocr !== undefined) assert.deepEqual(row.target, ocr, row.key);
      assert.equal((row.manual?.form.fields.length ?? 0) > 0, ocr !== undefined, row.key);
      assert.equal(row.selection, undefined, row.key);
    }
  });

  it("switches off both member actions when reading existing contacts is off", () => {
    const steps = projectStartSteps(descriptor);
    const rows = startRowsOf({ steps, rows: projectStartRows(descriptor).map(startRowWire) });
    const selected = steps.map(({ key }) => key).filter(key => key !== "members");
    assert.equal(rows.find(({ key }) => key === "read-existing-contacts")?.note,
      "Also skips: Fill and save emergency contact, File to OnBase");
    for (const row of rows.filter(({ child }) => child?.workflow === "emergency-contact-member")) {
      assert.equal(rowIncluded(row, selected, []), false, row.key);
      assert.equal(rowFieldsOpen(row, selected, []), false, row.key);
      assert.ok(row.child);
      assert.throws(() => resolveStartStepOmissions(descriptor, selected, [{ step: "members", facts: {} }, { ...row.child, facts: {} }]),
        (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "cascade-refused", row.key);
    }
    assert.deepEqual(resolveStartStepOmissions(descriptor, selected, [{ step: "members", facts: {} }]), [{ step: "members", facts: {}, labels: {} }]);
  });

  it("refuses typed facts for the parent's own steps", () => {
    const keys = projectStartSteps(descriptor).map(({ key }) => key);
    for (const step of keys) {
      assert.throws(() => resolveStartStepOmissions(descriptor, keys, [{ step, facts: { value: "typed" } }]),
        (error: unknown) => error instanceof StartStepOmissionRefusedError, step);
    }
  });

  it("accepts a manual omission without letting the parent supply shared contact facts", () => {
    const selected = projectStartSteps(descriptor).map(({ key }) => key);
    const workflow = "emergency-contact-member";
    for (const step of ["contact-preview", "onbase-filing"]) {
      assert.deepEqual(resolveStartStepOmissions(descriptor, selected, [{ workflow, step, facts: {} }]),
        [{ workflow, step, facts: {}, labels: {} }]);
      assert.throws(() => resolveStartStepOmissions(descriptor, selected, [{ workflow, step, facts: { value: "typed" } }]),
        (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid", step);
    }
    assert.throws(() => resolveStartStepOmissions(descriptor, selected, [{ workflow, step: "contact-plan", facts: {} }]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "unknown-step");
  });

  it("plans nothing new and keeps today's node lists of the run and its member run", () => {
    assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined);
    // Today's 4 and 9 nodes with their kinds, dependencies and dry-run stops.
    assert.equal(nodeDigest(descriptorRuntimeNodes(descriptor)), "6297f780d9c773cb801aa754b71a57d97da4fa443124f9df35466e3fab9458a7");
    assert.equal(nodeDigest(descriptorRuntimeNodes(emergencyContactMemberModule.descriptor)), "4c30231da6ab1cacfe255d2e7dadec1d6187e7f486c9cb9060a33ead9aebc489");
  });
});
