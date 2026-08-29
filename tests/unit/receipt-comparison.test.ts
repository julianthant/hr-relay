import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../src/domain/trust/evidence.js";
import {
  compareReceiptFacts,
  defineReceiptComparisonRegistry,
} from "../../src/domain/trust/receipt-comparison.js";
import { separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
import { cleanReceiptOf } from "./server/helpers/dashboard-harness.js";

const DOCUMENT_NUMBER_FACT = {
  id: "separations.action.document-number",
  label: "Document number",
  disclosure: {
    posture: "allow",
    classification: "safe-diagnostic",
    transform: "allow",
  },
  binding: {
    collection: "observations",
    sourceKinds: ["system", "checkpoint"],
    nodeId: "resolve-action",
    taskId: "kuali/search-separation-action",
    fieldPath: "documentNumber",
  },
} as const;

function receiptWithDocumentNumber(seed: number, value: string): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed, workflow: "separations" }),
    observations: [{
      id: `${String(seed).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      field: "documentNumber",
      mandatory: true,
      source: {
        kind: "system",
        taskId: "kuali/search-separation-action",
        observedAt: "2026-08-28T12:00:00.000Z",
      },
      state: "satisfied",
      value: {
        key: "documentNumber",
        state: "allowed",
        classification: "safe-diagnostic",
        transform: "allow",
        value,
      },
    }],
  });
}

describe("receipt comparison registry", () => {
  it("refuses a fact whose declared task is not owned by its declared node", () => {
    assert.throws(
      () => defineReceiptComparisonRegistry(separationsDescriptor, {
        workflowId: "separations",
        facts: [{
          id: "separations.document.number",
          label: "Document number",
          disclosure: {
            posture: "allow",
            classification: "safe-diagnostic",
            transform: "allow",
          },
          binding: {
            collection: "observations",
            sourceKinds: ["system", "checkpoint"],
            nodeId: "document",
            taskId: "workflow:separations/read-separation-plan",
            fieldPath: "documentNumber",
          },
        }],
      }),
      /comparison fact separations\.document\.number binds node document to task workflow:separations\/read-separation-plan, but the current separations descriptor binds that node to kuali\/read-separation-document/,
    );
  });

  it("reports an allowed fact whose exact value changed", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });

    const comparison = compareReceiptFacts(
      registry,
      receiptWithDocumentNumber(301, "4502"),
      receiptWithDocumentNumber(302, "4537"),
    );

    assert.deepEqual(comparison, [{
      state: "changed",
      factId: "separations.action.document-number",
      label: "Document number",
      before: "4502",
      after: "4537",
    }]);
  });
});
