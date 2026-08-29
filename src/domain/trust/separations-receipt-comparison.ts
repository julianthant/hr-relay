import {
  defineReceiptComparisonRegistry,
  type ReceiptComparisonFactDeclaration,
} from "./receipt-comparison.js";

type ComparisonDescriptor = Parameters<typeof defineReceiptComparisonRegistry>[0];
type Disclosure = ReceiptComparisonFactDeclaration["disclosure"];

const ALLOW = {
  posture: "allow",
  classification: "safe-diagnostic",
  transform: "allow",
} as const satisfies Disclosure;
const WITHHOLD_SAFE = {
  posture: "withhold",
  classification: "safe-diagnostic",
  transform: "allow",
} as const satisfies Disclosure;
const WITHHOLD_IDENTIFIER = {
  posture: "withhold",
  classification: "direct-identifier",
  transform: "last4",
} as const satisfies Disclosure;
const WITHHOLD_POPULATION = {
  posture: "withhold",
  classification: "sensitive-hr",
  transform: "count",
} as const satisfies Disclosure;

function fact(input: Readonly<{
  id: string;
  label: string;
  nodeId: string;
  taskId: string;
  fieldPath: string;
  disclosure: Disclosure;
}>): unknown {
  return {
    id: input.id,
    label: input.label,
    disclosure: input.disclosure,
    binding: {
      collection: "observations",
      sourceKinds: ["system", "checkpoint"],
      nodeId: input.nodeId,
      taskId: input.taskId,
      fieldPath: input.fieldPath,
    },
  };
}

const CURRENT_SEPARATIONS_FACTS = [
  fact({
    id: "separations.action.document-number",
    label: "Document number",
    nodeId: "resolve-action",
    taskId: "kuali/search-separation-action",
    fieldPath: "documentNumber",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.document.employee-name",
    label: "Employee name on separation document",
    nodeId: "document",
    taskId: "kuali/read-separation-document",
    fieldPath: "employee.name.value",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.document.employee-eid",
    label: "Employee identifier on separation document",
    nodeId: "document",
    taskId: "kuali/read-separation-document",
    fieldPath: "employee.eid.value",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.document.last-day-worked",
    label: "Last day worked on separation document",
    nodeId: "document",
    taskId: "kuali/read-separation-document",
    fieldPath: "separation.lastDayWorked.value",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.document.separation-date",
    label: "Separation date on separation document",
    nodeId: "document",
    taskId: "kuali/read-separation-document",
    fieldPath: "separation.separationDate.value",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.document.termination-type",
    label: "Termination type on separation document",
    nodeId: "document",
    taskId: "kuali/read-separation-document",
    fieldPath: "separation.terminationType.value",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.name-search.results",
    label: "Name-search result population",
    nodeId: "name-search",
    taskId: "ucpath/search-person-org",
    fieldPath: "results",
    disclosure: WITHHOLD_POPULATION,
  }),
  fact({
    id: "separations.name-search.status",
    label: "Name-search resolution",
    nodeId: "name-search",
    taskId: "ucpath/search-person-org",
    fieldPath: "selection.status",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.job-summary.employee-eid",
    label: "Job-summary employee identifier",
    nodeId: "job-summary",
    taskId: "ucpath/read-job-summary",
    fieldPath: "emplId",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.job-summary.employee-name",
    label: "Job-summary employee name",
    nodeId: "job-summary",
    taskId: "ucpath/read-job-summary",
    fieldPath: "displayedName",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.job-summary.rows",
    label: "Job-summary employment population",
    nodeId: "job-summary",
    taskId: "ucpath/read-job-summary",
    fieldPath: "jobRows",
    disclosure: WITHHOLD_POPULATION,
  }),
  fact({
    id: "separations.job-summary.row-count",
    label: "Job-summary row count",
    nodeId: "job-summary",
    taskId: "ucpath/read-job-summary",
    fieldPath: "rowCount",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard-search.query",
    label: "Timecard-search identifier",
    nodeId: "timecard-search",
    taskId: "new-kronos/search-employee",
    fieldPath: "query",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.timecard-search.candidates",
    label: "Timecard-search candidate population",
    nodeId: "timecard-search",
    taskId: "new-kronos/search-employee",
    fieldPath: "candidates",
    disclosure: WITHHOLD_POPULATION,
  }),
  fact({
    id: "separations.timecard-search.employee-eid",
    label: "Matched timecard employee identifier",
    nodeId: "timecard-search",
    taskId: "new-kronos/search-employee",
    fieldPath: "matched.employeeId",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.timecard-search.employee-name",
    label: "Matched timecard employee name",
    nodeId: "timecard-search",
    taskId: "new-kronos/search-employee",
    fieldPath: "matched.displayName",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.timecard-search.total-count",
    label: "Timecard-search total count",
    nodeId: "timecard-search",
    taskId: "new-kronos/search-employee",
    fieldPath: "totalCount",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard-search.selected-count",
    label: "Timecard-search selected count",
    nodeId: "timecard-search",
    taskId: "new-kronos/search-employee",
    fieldPath: "selectedCount",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard.employee-eid-expected",
    label: "Expected timecard employee identifier",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "subject.expectedEid",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.timecard.employee-eid-observed",
    label: "Observed timecard employee identifier",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "subject.observedEmployeeId",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.timecard.employee-name",
    label: "Observed timecard employee name",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "subject.observedDisplayName",
    disclosure: WITHHOLD_IDENTIFIER,
  }),
  fact({
    id: "separations.timecard.range-start",
    label: "Observed timecard range start",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "range.observedStart",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard.range-end",
    label: "Observed timecard range end",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "range.observedEnd",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard.last-punch-date",
    label: "Last punch date",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "grid.lastPunchDate",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard.punch-dates",
    label: "Punch dates",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "grid.punchDates",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard.sick-dates",
    label: "Sick dates",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "grid.sickDates",
    disclosure: WITHHOLD_SAFE,
  }),
  fact({
    id: "separations.timecard.holiday-dates",
    label: "Holiday dates",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "grid.holidayDates",
    disclosure: ALLOW,
  }),
  fact({
    id: "separations.timecard.pay-code-days",
    label: "Pay-code days",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "grid.payCodeDays",
    disclosure: WITHHOLD_SAFE,
  }),
  fact({
    id: "separations.timecard.unclassified-pay-codes",
    label: "Unclassified pay codes",
    nodeId: "timecard",
    taskId: "new-kronos/read-separation-timecard",
    fieldPath: "grid.unclassifiedPayCodes",
    disclosure: ALLOW,
  }),
] as const;

/** The D289 registry is sealed against the CURRENT Separations graph at composition. */
export function defineSeparationsReceiptComparisonRegistry(
  descriptor: ComparisonDescriptor,
) {
  return defineReceiptComparisonRegistry(descriptor, {
    workflowId: "separations",
    facts: CURRENT_SEPARATIONS_FACTS,
  });
}
