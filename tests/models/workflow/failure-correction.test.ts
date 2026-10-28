import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { validateFailureCorrections } from "../../../src/models/workflow/failure-correction.js";
import { rerunInputFieldAccepts } from "../../../src/models/validation/rerun-values.js";
import { TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { classifyEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { SeparationsInput, SeparationsCanonicalInput, separationsWorkflow } from "../../../src/workflows/separations/workflow.js";
import { projectStartSteps } from "../../../src/backend/runs/start/step-selection.js";
import { KualiDocumentNumberSchema } from "../../../src/models/ui/kuali-document-identity.js";

describe("workflow failure correction declaration", () => {
  const declared = separationsWorkflow.failureCorrections?.[0];
  assert.ok(declared);
  const nodes = descriptorRuntimeNodes(separationsDescriptor);
  it("accepts the optional EID without adding it to any start or rerun form", () => {
    const original = { documentNumber: "4510", timekeeperName: "Synthetic Timekeeper" };
    assert.equal(SeparationsInput.parse(original).operatorEmployeeId, undefined);
    const parsed = SeparationsInput.parse({ ...original, operatorEmployeeId: "10800001" });
    assert.deepEqual(SeparationsCanonicalInput.parse(parsed), parsed);
    assert.equal(SeparationsInput.safeParse({ ...original, operatorEmployeeId: "12345678" }).success, false);
    assert.equal(JSON.stringify(separationsDescriptor.surfaces).includes("operatorEmployeeId"), false);
    assert.equal(JSON.stringify(projectStartSteps(separationsDescriptor)).includes("operatorEmployeeId"), false);
    assert.equal(separationsDescriptor.rerunValues?.some(value => value.targetFieldPath === "operatorEmployeeId"), false);
  });
  it("binds the actual failure and validates the value with the input schema", () => {
    assert.deepEqual(validateFailureCorrections(SeparationsInput, nodes, [declared]), [declared]);
    assert.equal(declared.code, "employee-not-found");
    assert.equal(rerunInputFieldAccepts(SeparationsInput, declared.inputField, "10800001"), true);
    for (const value of ["12345678", "1080000", "108000010", " 10800001 ", "abc"]) {
      assert.equal(rerunInputFieldAccepts(SeparationsInput, declared.inputField, value), false);
      assert.equal(new RegExp(declared.pattern ?? "", "u").test(value), false);
    }
  });
  it("refuses unknown fields, codes, nodes and duplicate declarations", () => {
    for (const invalid of [{ ...declared, inputField: "unknown" }, { ...declared, code: "unknown" }, { ...declared, nodeId: "unknown" }]) {
      assert.throws(() => validateFailureCorrections(SeparationsInput, nodes, [invalid]));
    }
    assert.throws(() => validateFailureCorrections(SeparationsInput, nodes, [declared, declared]));
  });
  it("corrects only a missing Action List document with the canonical document-number pattern", () => {
    const correction = separationsDescriptor.failureCorrections?.find(entry => entry.inputField === "documentNumber");
    assert.ok(correction);
    assert.deepEqual(validateFailureCorrections(SeparationsInput, nodes, [correction]), [correction]);
    assert.deepEqual(correction, { nodeId: "resolve-action", code: "document-not-in-action-list", inputField: "documentNumber",
      label: "Document number", actionLabel: "Enter document number", pattern: "^\\d{3,8}$" });
    for (const value of ["123", "4502", "12345678", "12", "123456789", " 4502 ", "abc", ""]) {
      const accepted = KualiDocumentNumberSchema.safeParse(value).success;
      assert.equal(rerunInputFieldAccepts(SeparationsInput, correction.inputField, value), accepted);
      assert.equal(new RegExp(correction.pattern ?? "", "u").test(value), accepted);
    }
    assert.equal(separationsDescriptor.protectedInputs?.some(binding => binding.inputPath === correction.inputField), false);
  });
});

it("classifies the entered EID as an identifier and its origin and gate requirement as decision facts", () => {
  assert.equal(classifyEvidenceLeaf({ kind: "workflow-input", workflowId: separationsDescriptor.id }, "operatorEmployeeId").classification, "direct-identifier");
  for (const path of ["packet.emplIdSource", "approvalRequired"]) {
    assert.equal(classifyEvidenceLeaf({ kind: "task-output", taskId: TaskIdSchema.parse("workflow:separations/match-identity") }, path).classification, "safe-diagnostic");
  }
});
