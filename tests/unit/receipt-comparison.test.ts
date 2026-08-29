import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../src/domain/trust/evidence.js";
import {
  compareReceiptFacts,
  defineReceiptComparisonRegistry,
} from "../../src/domain/trust/receipt-comparison.js";
import { defineSeparationsReceiptComparisonRegistry } from "../../src/domain/trust/separations-receipt-comparison.js";
import { separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
import { cleanReceiptOf, uuidOf } from "./server/helpers/dashboard-harness.js";

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

const EMPLOYEE_EID_DIGEST_FACT = {
  ...EMPLOYEE_EID_FACT,
  id: "separations.document.employee-eid-digest",
  disclosure: {
    posture: "withhold",
    classification: "direct-identifier",
    transform: "digest",
  },
} as const;

const NAME_SEARCH_RESULTS_FACT = {
  id: "separations.name-search.results",
  label: "Name-search result population",
  disclosure: {
    posture: "withhold",
    classification: "sensitive-hr",
    transform: "count",
  },
  binding: {
    collection: "observations",
    sourceKinds: ["system", "checkpoint"],
    nodeId: "name-search",
    taskId: "ucpath/search-person-org",
    fieldPath: "results",
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

function receiptWithTransformedFact(input: Readonly<{
  seed: number;
  taskId: string;
  fieldPath: string;
  classification: "direct-identifier" | "sensitive-hr";
  transform: "digest" | "count";
  value: string | number;
}>): RunEvidenceReceipt {
  const field = input.fieldPath.split(".").at(-1);
  if (field === undefined) throw new Error(`test fact ${input.fieldPath} has no leaf`);
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed: input.seed, workflow: "separations" }),
    observations: [{
      id: `${String(input.seed).padStart(8, "0")}-dddd-4ddd-8ddd-dddddddddddd`,
      field,
      mandatory: true,
      source: {
        kind: "system",
        taskId: input.taskId,
        observedAt: "2026-08-28T12:00:00.000Z",
      },
      state: "satisfied",
      value: {
        key: input.fieldPath,
        state: "transformed",
        classification: input.classification,
        transform: input.transform,
        value: input.value,
      },
    }],
  });
}

function receiptWithAllowedFacts(input: Readonly<{
  seed: number;
  facts: readonly Readonly<{
    taskId: string;
    fieldPath: string;
    value: unknown;
  }>[];
}>): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf({ seed: input.seed, workflow: "separations" }),
    observations: input.facts.map((fact, index) => {
      const field = fact.fieldPath.split(".").at(-1);
      if (field === undefined) throw new Error(`test fact ${fact.fieldPath} has no leaf`);
      return {
        id: uuidOf(input.seed + 9000 + index),
        field,
        mandatory: true,
        source: {
          kind: "system",
          taskId: fact.taskId,
          observedAt: "2026-08-28T12:00:00.000Z",
        },
        state: "satisfied",
        value: {
          key: fact.fieldPath,
          state: "allowed",
          classification: "safe-diagnostic",
          transform: "allow",
          value: fact.value,
        },
      };
    }),
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

  it("returns no comparison arm when a reviewed safe value is unchanged", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });

    const comparison = compareReceiptFacts(
      registry,
      receiptWithDocumentNumber(344, "4502"),
      receiptWithDocumentNumber(345, "4502"),
    );

    assert.deepEqual(comparison, []);
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

  it("refuses an unresolved fact at a reviewed coordinate", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const currentBase = receiptWithDocumentNumber(337, "4537");
    const currentFact = currentBase.observations[0];
    assert.ok(currentFact !== undefined);
    const current = RunEvidenceReceiptSchema.parse({
      ...currentBase,
      observations: [{
        id: currentFact.id,
        field: currentFact.field,
        mandatory: false,
        source: currentFact.source,
        state: "unresolved",
        reason: "the source did not return this reviewed fact",
      }],
    });

    assert.throws(
      () => compareReceiptFacts(
        registry,
        receiptWithDocumentNumber(336, "4502"),
        current,
      ),
      new RegExp(
        `comparison fact separations\\.action\\.document-number is unresolved in receipt ${current.receiptId}`,
      ),
    );
  });

  it("refuses receipts outside the registry workflow", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const foreign = RunEvidenceReceiptSchema.parse({
      ...receiptWithDocumentNumber(320, "4502"),
      workflowId: "person-lookup",
    });

    assert.throws(
      () => compareReceiptFacts(
        registry,
        foreign,
        receiptWithDocumentNumber(321, "4537"),
      ),
      /comparison registry separations cannot compare receipts for person-lookup and separations/,
    );
  });

  it("does not fall through to an unregistered OCR fact sharing the field path", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const currentBase = receiptWithDocumentNumber(323, "4537");
    const registeredFact = currentBase.observations[0];
    assert.ok(registeredFact?.state === "satisfied");
    const current = RunEvidenceReceiptSchema.parse({
      ...currentBase,
      observations: [
        registeredFact,
        {
          ...registeredFact,
          id: "00000324-cccc-4ccc-8ccc-cccccccccccc",
          source: { ...registeredFact.source, taskId: "ocr/read-document" },
          value: { ...registeredFact.value, value: "UNREGISTERED-OCR-VALUE" },
        },
      ],
    });

    const comparison = compareReceiptFacts(
      registry,
      receiptWithDocumentNumber(322, "4502"),
      current,
    );

    assert.deepEqual(comparison, [{
      state: "changed",
      factId: "separations.action.document-number",
      label: "Document number",
      before: "4502",
      after: "4537",
    }]);
    assert.doesNotMatch(JSON.stringify(comparison), /UNREGISTERED-OCR-VALUE/);
  });

  it("does not register same-task OCR facts with the wrong field or value key", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [DOCUMENT_NUMBER_FACT],
    });
    const currentBase = receiptWithDocumentNumber(347, "4537");
    const registeredFact = currentBase.observations[0];
    assert.ok(registeredFact?.state === "satisfied");
    const current = RunEvidenceReceiptSchema.parse({
      ...currentBase,
      observations: [
        registeredFact,
        {
          ...registeredFact,
          id: uuidOf(9348),
          field: "ocrDocumentNumber",
          value: { ...registeredFact.value, value: "WRONG-FIELD-OCR-VALUE" },
        },
        {
          ...registeredFact,
          id: uuidOf(9349),
          value: {
            ...registeredFact.value,
            key: "ocr.documentNumber",
            value: "WRONG-KEY-OCR-VALUE",
          },
        },
      ],
    });

    const comparison = compareReceiptFacts(
      registry,
      receiptWithDocumentNumber(346, "4502"),
      current,
    );

    assert.deepEqual(comparison, [{
      state: "changed",
      factId: "separations.action.document-number",
      label: "Document number",
      before: "4502",
      after: "4537",
    }]);
    assert.doesNotMatch(JSON.stringify(comparison), /WRONG-FIELD-OCR-VALUE|WRONG-KEY-OCR-VALUE/);
  });

  it("refuses a withheld declaration missing from both exact receipts", () => {
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [EMPLOYEE_EID_FACT],
    });
    const prior = cleanReceiptOf({ seed: 338, workflow: "separations" });
    const current = cleanReceiptOf({ seed: 339, workflow: "separations" });

    assert.throws(
      () => compareReceiptFacts(registry, prior, current),
      new RegExp(
        `comparison fact separations\\.document\\.employee-eid requires one exact fact in each receipt; `
        + `found 0 in ${prior.receiptId} and 0 in ${current.receiptId}`,
      ),
    );
  });

  it("withholds suffixes, sensitive counts, and digests without revealing their relation", () => {
    const suffixRegistry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [EMPLOYEE_EID_FACT],
    });
    const suffixExpected = [{
      state: "withheld",
      factId: "separations.document.employee-eid",
      label: "Employee identifier",
    }];
    const countRegistry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [NAME_SEARCH_RESULTS_FACT],
    });
    const countExpected = [{
      state: "withheld",
      factId: "separations.name-search.results",
      label: "Name-search result population",
    }];
    const digestRegistry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts: [EMPLOYEE_EID_DIGEST_FACT],
    });
    const digestExpected = [{
      state: "withheld",
      factId: "separations.document.employee-eid-digest",
      label: "Employee identifier",
    }];
    const count = (seed: number, value: number) => receiptWithTransformedFact({
      seed,
      taskId: "ucpath/search-person-org",
      fieldPath: "results",
      classification: "sensitive-hr",
      transform: "count",
      value,
    });
    const digest = (seed: number, value: string) => receiptWithTransformedFact({
      seed,
      taskId: "kuali/read-separation-document",
      fieldPath: "employee.eid.value",
      classification: "direct-identifier",
      transform: "digest",
      value,
    });
    const digestA = "a".repeat(64);
    const digestB = "b".repeat(64);

    const comparisons = [
      compareReceiptFacts(
        suffixRegistry,
        receiptWithEmployeeSuffix(307, "3698"),
        receiptWithEmployeeSuffix(308, "7418"),
      ),
      compareReceiptFacts(
        suffixRegistry,
        receiptWithEmployeeSuffix(309, "3698"),
        receiptWithEmployeeSuffix(310, "3698"),
      ),
      compareReceiptFacts(
        suffixRegistry,
        receiptWithEmployeeSuffix(311, "3698"),
        cleanReceiptOf({ seed: 312, workflow: "separations" }),
      ),
      compareReceiptFacts(countRegistry, count(325, 17), count(326, 23)),
      compareReceiptFacts(countRegistry, count(327, 17), count(328, 17)),
      compareReceiptFacts(countRegistry, count(329, 17), cleanReceiptOf({ seed: 330, workflow: "separations" })),
      compareReceiptFacts(digestRegistry, digest(331, digestA), digest(332, digestB)),
      compareReceiptFacts(digestRegistry, digest(333, digestA), digest(334, digestA)),
      compareReceiptFacts(digestRegistry, digest(335, digestA), cleanReceiptOf({ seed: 336, workflow: "separations" })),
    ];

    assert.deepEqual(comparisons, [
      suffixExpected, suffixExpected, suffixExpected,
      countExpected, countExpected, countExpected,
      digestExpected, digestExpected, digestExpected,
    ]);
    assert.doesNotMatch(
      JSON.stringify(comparisons),
      /3698|7418|17|23|aaaaaaaa|bbbbbbbb|before|after|added|removed|changed|unchanged|absent/,
    );
  });

  it("withholds reviewed sick dates and pay-code days without leaking values or relation", () => {
    const production = defineSeparationsReceiptComparisonRegistry(separationsDescriptor);
    const sensitiveIds = new Set([
      "separations.timecard.sick-dates",
      "separations.timecard.pay-code-days",
    ]);
    const facts = production.facts.filter(({ id }) => sensitiveIds.has(id));
    assert.equal(facts.length, sensitiveIds.size);
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts,
    });
    const taskId = "new-kronos/read-separation-timecard";
    const prior = receiptWithAllowedFacts({
      seed: 340,
      facts: [
        { taskId, fieldPath: "grid.sickDates", value: ["06/20/2026"] },
        {
          taskId,
          fieldPath: "grid.payCodeDays",
          value: [{ date: "06/20/2026", payCode: "Sick", amount: "8.00" }],
        },
      ],
    });
    const current = receiptWithAllowedFacts({
      seed: 341,
      facts: [
        { taskId, fieldPath: "grid.sickDates", value: ["06/21/2026"] },
        {
          taskId,
          fieldPath: "grid.payCodeDays",
          value: [{ date: "06/21/2026", payCode: "Sick", amount: "4.00" }],
        },
      ],
    });

    const comparison = compareReceiptFacts(registry, prior, current);

    assert.deepEqual(comparison, [
      { state: "withheld", factId: "separations.timecard.sick-dates", label: "Sick dates" },
      { state: "withheld", factId: "separations.timecard.pay-code-days", label: "Pay-code days" },
    ]);
    assert.doesNotMatch(
      JSON.stringify(comparison),
      /06\/20\/2026|06\/21\/2026|8\.00|4\.00|before|after|changed|unchanged/,
    );
  });

  it("withholds deterministic population-count aliases without leaking values or relation", () => {
    const production = defineSeparationsReceiptComparisonRegistry(separationsDescriptor);
    const aliasIds = new Set([
      "separations.job-summary.row-count",
      "separations.timecard-search.total-count",
    ]);
    const facts = production.facts.filter(({ id }) => aliasIds.has(id));
    assert.equal(facts.length, aliasIds.size);
    const registry = defineReceiptComparisonRegistry(separationsDescriptor, {
      workflowId: "separations",
      facts,
    });
    const prior = receiptWithAllowedFacts({
      seed: 342,
      facts: [
        { taskId: "ucpath/read-job-summary", fieldPath: "rowCount", value: 17 },
        { taskId: "new-kronos/search-employee", fieldPath: "totalCount", value: 23 },
      ],
    });
    const current = receiptWithAllowedFacts({
      seed: 343,
      facts: [
        { taskId: "ucpath/read-job-summary", fieldPath: "rowCount", value: 19 },
        { taskId: "new-kronos/search-employee", fieldPath: "totalCount", value: 29 },
      ],
    });

    const comparison = compareReceiptFacts(registry, prior, current);

    assert.deepEqual(comparison, [
      { state: "withheld", factId: "separations.job-summary.row-count", label: "Job-summary row count" },
      { state: "withheld", factId: "separations.timecard-search.total-count", label: "Timecard-search total count" },
    ]);
    assert.doesNotMatch(
      JSON.stringify(comparison),
      /17|19|23|29|before|after|changed|unchanged/,
    );
  });

  it("registers only the reviewed current Separations source facts", () => {
    const registry = defineSeparationsReceiptComparisonRegistry(separationsDescriptor);

    assert.deepEqual(registry.facts.map(({ id, label, disclosure, binding }) => [
      id,
      label,
      disclosure.posture,
      disclosure.classification,
      disclosure.transform,
      binding.collection,
      binding.sourceKinds,
      binding.nodeId,
      binding.taskId,
      binding.fieldPath,
    ]), [
      ["separations.action.document-number", "Document number", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "resolve-action", "kuali/search-separation-action", "documentNumber"],
      ["separations.document.employee-name", "Employee name on separation document", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "document", "kuali/read-separation-document", "employee.name.value"],
      ["separations.document.employee-eid", "Employee identifier on separation document", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "document", "kuali/read-separation-document", "employee.eid.value"],
      ["separations.document.last-day-worked", "Last day worked on separation document", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "document", "kuali/read-separation-document", "separation.lastDayWorked.value"],
      ["separations.document.separation-date", "Separation date on separation document", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "document", "kuali/read-separation-document", "separation.separationDate.value"],
      ["separations.document.termination-type", "Termination type on separation document", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "document", "kuali/read-separation-document", "separation.terminationType.value"],
      ["separations.name-search.results", "Name-search result population", "withhold", "sensitive-hr", "count", "observations", ["system", "checkpoint"], "name-search", "ucpath/search-person-org", "results"],
      ["separations.name-search.status", "Name-search resolution", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "name-search", "ucpath/search-person-org", "selection.status"],
      ["separations.job-summary.employee-eid", "Job-summary employee identifier", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "job-summary", "ucpath/read-job-summary", "emplId"],
      ["separations.job-summary.employee-name", "Job-summary employee name", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "job-summary", "ucpath/read-job-summary", "displayedName"],
      ["separations.job-summary.rows", "Job-summary employment population", "withhold", "sensitive-hr", "count", "observations", ["system", "checkpoint"], "job-summary", "ucpath/read-job-summary", "jobRows"],
      ["separations.job-summary.row-count", "Job-summary row count", "withhold", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "job-summary", "ucpath/read-job-summary", "rowCount"],
      ["separations.timecard-search.query", "Timecard-search identifier", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "timecard-search", "new-kronos/search-employee", "query"],
      ["separations.timecard-search.candidates", "Timecard-search candidate population", "withhold", "sensitive-hr", "count", "observations", ["system", "checkpoint"], "timecard-search", "new-kronos/search-employee", "candidates"],
      ["separations.timecard-search.employee-eid", "Matched timecard employee identifier", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "timecard-search", "new-kronos/search-employee", "matched.employeeId"],
      ["separations.timecard-search.employee-name", "Matched timecard employee name", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "timecard-search", "new-kronos/search-employee", "matched.displayName"],
      ["separations.timecard-search.total-count", "Timecard-search total count", "withhold", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard-search", "new-kronos/search-employee", "totalCount"],
      ["separations.timecard-search.selected-count", "Timecard-search selected count", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard-search", "new-kronos/search-employee", "selectedCount"],
      ["separations.timecard.employee-eid-expected", "Expected timecard employee identifier", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "subject.expectedEid"],
      ["separations.timecard.employee-eid-observed", "Observed timecard employee identifier", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "subject.observedEmployeeId"],
      ["separations.timecard.employee-name", "Observed timecard employee name", "withhold", "direct-identifier", "last4", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "subject.observedDisplayName"],
      ["separations.timecard.range-start", "Observed timecard range start", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "range.observedStart"],
      ["separations.timecard.range-end", "Observed timecard range end", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "range.observedEnd"],
      ["separations.timecard.last-punch-date", "Last punch date", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "grid.lastPunchDate"],
      ["separations.timecard.punch-dates", "Punch dates", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "grid.punchDates"],
      ["separations.timecard.sick-dates", "Sick dates", "withhold", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "grid.sickDates"],
      ["separations.timecard.holiday-dates", "Holiday dates", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "grid.holidayDates"],
      ["separations.timecard.pay-code-days", "Pay-code days", "withhold", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "grid.payCodeDays"],
      ["separations.timecard.unclassified-pay-codes", "Unclassified pay codes", "allow", "safe-diagnostic", "allow", "observations", ["system", "checkpoint"], "timecard", "new-kronos/read-separation-timecard", "grid.unclassifiedPayCodes"],
    ]);
  });
});
