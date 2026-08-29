import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../src/domain/trust/evidence.js";
import {
  compareReceiptFacts,
  defineReceiptComparisonRegistry,
} from "../../src/domain/trust/receipt-comparison.js";
import { defineSeparationsReceiptComparisonRegistry } from "../../src/domain/trust/separations-receipt-comparison.js";
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

const EMPLOYEE_EID_FACT = {
  id: "separations.document.employee-eid",
  label: "Employee identifier",
  disclosure: {
    posture: "withhold",
    classification: "direct-identifier",
    transform: "last4",
  },
  binding: {
    collection: "observations",
    sourceKinds: ["system", "checkpoint"],
    nodeId: "document",
    taskId: "kuali/read-separation-document",
    fieldPath: "employee.eid.value",
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

function receiptWithEmployeeSuffix(seed: number, value: string): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed, workflow: "separations" }),
    observations: [{
      id: `${String(seed).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      field: "value",
      mandatory: true,
      source: {
        kind: "system",
        taskId: "kuali/read-separation-document",
        observedAt: "2026-08-28T12:00:00.000Z",
      },
      state: "satisfied",
      value: {
        key: "employee.eid.value",
        state: "transformed",
        classification: "direct-identifier",
        transform: "last4",
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

  it("reports an allowed fact added by the current receipt", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });

    const comparison = compareReceiptFacts(
      registry,
      cleanReceiptOf({ seed: 303, workflow: "separations" }),
      receiptWithDocumentNumber(304, "4537"),
    );

    assert.deepEqual(comparison, [{
      state: "added",
      factId: "separations.action.document-number",
      label: "Document number",
      after: "4537",
    }]);
  });

  it("reports an allowed fact removed from the current receipt", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });

    const comparison = compareReceiptFacts(
      registry,
      receiptWithDocumentNumber(305, "4502"),
      cleanReceiptOf({ seed: 306, workflow: "separations" }),
    );

    assert.deepEqual(comparison, [{
      state: "removed",
      factId: "separations.action.document-number",
      label: "Document number",
      before: "4502",
    }]);
  });

  it("refuses when a reviewed safe fact is absent from both exact receipts", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const prior = cleanReceiptOf({ seed: 313, workflow: "separations" });
    const current = cleanReceiptOf({ seed: 314, workflow: "separations" });

    assert.throws(
      () => compareReceiptFacts(registry, prior, current),
      new RegExp(
        `comparison fact separations\\.action\\.document-number requires one exact fact in each receipt; `
        + `found 0 in ${prior.receiptId} and 0 in ${current.receiptId}`,
      ),
    );
  });

  it("refuses multiple facts at one reviewed exact coordinate", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const priorBase = receiptWithDocumentNumber(315, "4502");
    const first = priorBase.observations[0];
    assert.ok(first !== undefined);
    const prior = RunEvidenceReceiptSchema.parse({
      ...priorBase,
      observations: [
        first,
        { ...first, id: "00000316-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ],
    });
    const current = receiptWithDocumentNumber(317, "4537");

    assert.throws(
      () => compareReceiptFacts(registry, prior, current),
      new RegExp(
        `comparison fact separations\\.action\\.document-number matched multiple exact facts: `
        + `2 in ${prior.receiptId} and 1 in ${current.receiptId}`,
      ),
    );
  });

  it("refuses an exact fact whose receipt classification and transform differ from review", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const currentBase = receiptWithDocumentNumber(319, "4537");
    const currentFact = currentBase.observations[0];
    assert.ok(currentFact?.state === "satisfied");
    const current = RunEvidenceReceiptSchema.parse({
      ...currentBase,
      observations: [{
        ...currentFact,
        value: {
          key: "documentNumber",
          state: "transformed",
          classification: "direct-identifier",
          transform: "last4",
          value: "4537",
        },
      }],
    });

    assert.throws(
      () => compareReceiptFacts(
        registry,
        receiptWithDocumentNumber(318, "4502"),
        current,
      ),
      /comparison fact separations\.action\.document-number expected safe-diagnostic\/allow, .* carries direct-identifier\/last4/,
    );
  });

  it("withholds identifier equality, difference, and absence identically", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [EMPLOYEE_EID_FACT],
    });
    const expected = [{
      state: "withheld",
      factId: "separations.document.employee-eid",
      label: "Employee identifier",
    }];

    const comparisons = [
      compareReceiptFacts(
        registry,
        receiptWithEmployeeSuffix(307, "3698"),
        receiptWithEmployeeSuffix(308, "7418"),
      ),
      compareReceiptFacts(
        registry,
        receiptWithEmployeeSuffix(309, "3698"),
        receiptWithEmployeeSuffix(310, "3698"),
      ),
      compareReceiptFacts(
        registry,
        receiptWithEmployeeSuffix(311, "3698"),
        cleanReceiptOf({ seed: 312, workflow: "separations" }),
      ),
    ];

    assert.deepEqual(comparisons, [expected, expected, expected]);
    assert.doesNotMatch(JSON.stringify(comparisons), /3698|7418|before|after/);
  });

  it("registers only the reviewed current Separations source facts", () => {
    const registry = defineSeparationsReceiptComparisonRegistry(separationsDescriptor);

    assert.deepEqual(registry.facts.map(({ id }) => id), [
      "separations.action.document-number",
      "separations.document.employee-name",
      "separations.document.employee-eid",
      "separations.document.last-day-worked",
      "separations.document.separation-date",
      "separations.document.termination-type",
      "separations.name-search.results",
      "separations.name-search.status",
      "separations.job-summary.employee-eid",
      "separations.job-summary.employee-name",
      "separations.job-summary.rows",
      "separations.job-summary.row-count",
      "separations.timecard-search.query",
      "separations.timecard-search.candidates",
      "separations.timecard-search.employee-eid",
      "separations.timecard-search.employee-name",
      "separations.timecard-search.total-count",
      "separations.timecard-search.selected-count",
      "separations.timecard.employee-eid-expected",
      "separations.timecard.employee-eid-observed",
      "separations.timecard.employee-name",
      "separations.timecard.range-start",
      "separations.timecard.range-end",
      "separations.timecard.last-punch-date",
      "separations.timecard.punch-dates",
      "separations.timecard.sick-dates",
      "separations.timecard.holiday-dates",
      "separations.timecard.pay-code-days",
      "separations.timecard.unclassified-pay-codes",
    ]);
  });
});
