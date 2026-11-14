/** Declared evidence classification: redaction is schema-owned, and a receipt's facts are classified where they are declared rather than at the UI. */
import { z } from "zod";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { GateIdSchema, TaskIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  RedactedFieldSchema,
  evidenceTransformAllowed,
  redactDiagnosticFields,
  redactValue,
} from "../../rules/redaction/redaction.js";

/** Where a leaf came from. A path only means something inside one of these. */
export const EvidenceValueScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-input"), workflowId: WorkflowIdSchema }),
  z.strictObject({ kind: z.literal("workflow-result"), workflowId: WorkflowIdSchema }),
  z.strictObject({ kind: z.literal("task-output"), taskId: TaskIdSchema }),
    /* A gate's stored result payload, scoped by `(workflow, gate)` and NOT by a task id, because a gate owns no contract: its result schema is declared on the gate node itself. */
  z.strictObject({
    kind: z.literal("gate-result"),
    workflowId: WorkflowIdSchema,
    gateId: GateIdSchema,
  }),
    /* A commit contract's completion proof, scoped by the COMMIT task id, not by the verify task that may have read it: the proof schema is the commit contract's own declaration. */
  z.strictObject({ kind: z.literal("write-proof"), taskId: TaskIdSchema }),
]);
export type EvidenceValueScope = z.infer<typeof EvidenceValueScopeSchema>;

/** `ContractFieldPath`'s grammar, unbranded — the same paths provenance uses. */
export const EvidenceLeafPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "evidence leaf path must be a dot-delimited camelCase object path",
);

export const EvidenceFieldClassificationSchema = z.strictObject({
  scope: EvidenceValueScopeSchema,
  path: EvidenceLeafPathSchema,
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
}).superRefine((entry, context) => {
  // Reject invalid sensitivity/transform pairings at declaration, before any run.
  if (!evidenceTransformAllowed(entry.classification, entry.transform)) {
    context.addIssue({
      code: "custom",
      path: ["transform"],
      message: `${entry.transform} is forbidden for ${entry.classification}`,
    });
  }
});
export type EvidenceFieldClassification = z.infer<typeof EvidenceFieldClassificationSchema>;

export function evidenceScopeKey(scope: EvidenceValueScope): string {
  if (scope.kind === "task-output") return `task-output:${scope.taskId}`;
  if (scope.kind === "write-proof") return `write-proof:${scope.taskId}`;
  if (scope.kind === "gate-result") return `gate-result:${scope.workflowId}/${scope.gateId}`;
  return `${scope.kind}:${scope.workflowId}`;
}

/** `safe-diagnostic` + `allow` — a value about the transaction, not the person. */
function open(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map((path) => ((["dateChangeComments", "timekeeperComments", "observedExistingComments"].includes(path.split(".").at(-1) ?? "") || path.endsWith("timekeeper.comments.value"))
    || (path.split(".").at(-1) === "evidenceDigest" && evidenceScopeKey(scope).includes("separations")))
    ? { scope, path, classification: "direct-identifier", transform: "drop" }
    : { scope, path, classification: "safe-diagnostic", transform: "allow" });
}

/** `direct-identifier` + `last4` — the widest transform ref clock-config-secrets permits for one. */
function person(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ scope, path, classification: "direct-identifier", transform: "last4" }));
}

/** `sensitive-hr` + `count` — how many, without naming anyone not selected. */
function population(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ scope, path, classification: "sensitive-hr", transform: "count" }));
}

const workflowInput = (id: string): EvidenceValueScope =>
  ({ kind: "workflow-input", workflowId: WorkflowIdSchema.parse(id) });
const workflowResult = (id: string): EvidenceValueScope =>
  ({ kind: "workflow-result", workflowId: WorkflowIdSchema.parse(id) });
const taskOutput = (id: string): EvidenceValueScope =>
  ({ kind: "task-output", taskId: TaskIdSchema.parse(id) });
const gateResult = (workflowId: string, gateId: string): EvidenceValueScope => ({
  kind: "gate-result",
  workflowId: WorkflowIdSchema.parse(workflowId),
  gateId: GateIdSchema.parse(gateId),
});
const writeProof = (id: string): EvidenceValueScope =>
  ({ kind: "write-proof", taskId: TaskIdSchema.parse(id) });

const PERSON_LOOKUP_INPUT = workflowInput("person-lookup");
const PERSON_LOOKUP_RESULT = workflowResult("person-lookup");
const SEARCH = taskOutput("ucpath/search-person-org");
const CRM_RECORD = taskOutput("crm/read-onboarding-record");
const CRM_DATES = taskOutput("crm/read-onboarding-dates");
const ACTIVE_STATUS = taskOutput("workflow:person-lookup/read-active-status");
const KRONOS_TIMECARD_INPUT = workflowInput("separations-kronos-timecard");
const KRONOS_TIMECARD_RESULT = workflowResult("separations-kronos-timecard");
const KRONOS_SEARCH = taskOutput("new-kronos/search-employee");
const KRONOS_TIMECARD = taskOutput("new-kronos/read-separation-timecard");
const KUALI_READ_INPUT = workflowInput("separations-kuali-read");
const KUALI_READ_RESULT = workflowResult("separations-kuali-read");
const KUALI_SEPARATION = taskOutput("kuali/read-separation-document");
const KUALI_ACTION_SEARCH = taskOutput("kuali/search-separation-action");
const TERMINATION_TYPE = taskOutput("workflow:separations/match-termination-type");
const IDENTITY_CHECK_INPUT = workflowInput("separations-identity-check");
const IDENTITY_CHECK_RESULT = workflowResult("separations-identity-check");
const JOB_SUMMARY = taskOutput("ucpath/read-job-summary");
const MATCH_IDENTITY = taskOutput("workflow:separations/match-identity");
const VERIFY_IDENTITY_APPROVAL = taskOutput("workflow:separations/verify-identity-approval");
const IDENTITY_APPROVAL_GATE = gateResult("separations-identity-check", "identity-approval");
const UCPATH_TERMINATION_INPUT = workflowInput("separations-ucpath-termination");
const UCPATH_TERMINATION_RESULT = workflowResult("separations-ucpath-termination");
const UCPATH_TERMINATION_GATE = gateResult("separations-ucpath-termination", "identity-approval");
const UCPATH_MATCH_TERMINATION = taskOutput("ucpath/match-existing-termination");
const UCPATH_MATCH_SWEEP = taskOutput("ucpath/match-pending-terminations");
const UCPATH_STAGE_TERMINATION = taskOutput("ucpath/stage-termination");
const UCPATH_CREATE_TERMINATION = taskOutput("ucpath/create-termination");
const UCPATH_STAGE_SWEEP = taskOutput("ucpath/stage-pending-termination-sweep");
const UCPATH_DELETE_PENDING = taskOutput("ucpath/delete-pending-terminations");
const UCPATH_VERIFY_TERMINATION = taskOutput("ucpath/verify-termination");
const UCPATH_VERIFY_SWEEP = taskOutput("ucpath/verify-pending-terminations-cleared");
const UCPATH_PENDING_SET = taskOutput("ucpath/read-pending-termination-set");
const UCPATH_FINDINGS = taskOutput("ucpath/read-transaction-findings");
const UCPATH_FILING_PRESENCE = taskOutput("ucpath/verify-termination-filing-present");
const KUALI_FINALIZATION_INPUT = workflowInput("separations-kuali-finalization");
const KUALI_FINALIZATION_RESULT = workflowResult("separations-kuali-finalization");
const KUALI_FINALIZATION_GATE = gateResult("separations-kuali-finalization", "identity-approval");
const DEPARTMENT_OPTION = taskOutput("workflow:separations/match-department-option");
const KUALI_STAGE_FINALIZATION = taskOutput("kuali/stage-separation-finalization");
const KUALI_SAVE_FINALIZATION = taskOutput("kuali/save-separation-finalization");
const KUALI_MATCH_FINALIZATION = taskOutput("kuali/match-separation-finalization");
const KUALI_VERIFY_FINALIZATION = taskOutput("kuali/verify-separation-finalization");
const SEPARATIONS_INPUT = workflowInput("separations");
const SEPARATIONS_RESULT = workflowResult("separations");
const SEPARATIONS_GATE = gateResult("separations", "identity-approval");
const OCR_FORM_PAGE = taskOutput("ocr/extract-form-page");
const SEPARATION_PLAN = taskOutput("workflow:separations/read-separation-plan");
const SEPARATION_SUBJECT = taskOutput("workflow:separations/match-separation-subject");
const ACTIVE_EMPLOYMENT = taskOutput("workflow:separations/match-active-employment");
const SEPARATION_DATES = taskOutput("workflow:separations/read-separation-dates");
const TERMINATION_RECEIPT = taskOutput("workflow:separations/verify-termination-receipt");

/** The twelve values one finalization save writes, relative to a prefix, declared once in one place so the prepare, the proof and the verifier agree. */
function finalizationFieldLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => `${prefix}.${path}`;
  return [
    ...person(scope, at("timekeeperName")),
    ...open(scope, at("department"), at("payrollTitleCode"), at("payrollTitle"),
      at("requestAcknowledged"), at("lastDayWorked"), at("separationDate"),
      at("terminationEffectiveDate"),
      at("submittedTerminationTemplate"), at("transactionNumber"), at("finalPay"),
      at("timekeeperComments")),
  ];
}

/** The reload read-back's proof: the document, the person it displayed, the twelve fields. */
function savedFinalizationLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...person(scope, at("observedEid")),
    ...open(scope, at("kind"), at("actionId"), at("documentNumber"), at("source")),
    ...finalizationFieldLeaves(scope, at("fields")),
  ];
}

/** The termination receipt PAIR — the person, plus the transaction it names. */
function terminationProofLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...person(scope, at("emplId"), at("displayedName")),
    ...open(scope, at("kind"), at("effectiveDate"), at("transactionId"),
      at("approvalStatus"), at("source")),
  ];
}

function sweepProofLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...person(scope, at("emplId")),
    ...open(
      scope,
      at("kind"),
      at("version"),
      at("selectedTransactionIds"),
      at("protectedTransactionIds"),
      at("setDigest"),
      at("scannedRowCount"),
      at("observedAt"),
      at("source"),
    ),
  ];
}

function filingPresenceLeaves(scope: EvidenceValueScope, prefix = ""): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...person(scope, at("emplId"), at("displayedName")),
    ...open(scope, at("kind"), at("transactionId"), at("effectiveDate"),
      at("approvalStatus"), at("observedAt"), at("source"), at("receiptDisposition"),
      at("authority")),
  ];
}

/** Every leaf of the Kuali separation-document read, relative to a prefix; the read is a WIDE fixed schema whose fields carry `present`/`absent` arms. */
function separationDocumentLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  const arms = (path: string, extra: readonly string[]): string[] =>
    ["state", "reason", ...extra].map((leaf) => at(`${path}.${leaf}`));
  const text = (path: string): string[] => arms(path, ["value"]);
  const date = (path: string): string[] => arms(path, ["value", "raw"]);
    /* A person field's ARM DISCRIMINATOR is not the person; the discriminator only says which arm the row took. */
  const personText = (path: string): { open: string[]; identifying: string[] } => ({
    open: [at(`${path}.state`), at(`${path}.reason`)],
    identifying: [at(`${path}.value`)],
  });
  const employeeName = personText("employee.name");
  const employeeEid = personText("employee.eid");
  const timekeeperName = personText("timekeeper.name");
  return [
    // Transaction facts: the document's identity, the page state, the instant,
    // and the form-type proof. None of them describes a person.
    ...open(scope, at("pageStateId"), at("actionId"), at("documentNumber"), at("observedAt"),
      at("formType.observed"), at("formType.matches")),
    // The PERSON: the `value` leaf only (see `personText` above).
    ...person(scope, ...employeeName.identifying, ...employeeEid.identifying,
      ...timekeeperName.identifying),
    ...open(scope, ...employeeName.open, ...employeeEid.open, ...timekeeperName.open),
    // Job codes, divisions, locations and departments describe the transaction, not the person.
    ...open(scope,
      ...text("employee.employeeType"), ...text("employee.studentTitleCode"),
      ...text("employee.division"), ...text("employee.location"),
      ...text("separation.terminationType"),
      ...date("separation.lastDayWorked"), ...date("separation.separationDate"),
      ...text("separation.additionalComments"),
      at("timekeeper.requestAcknowledged"),
      ...text("timekeeper.comments"),
      ...date("finalTransactions.terminationEffectiveDate"),
      ...text("finalTransactions.department"),
      ...text("finalTransactions.payrollTitleCode"), ...text("finalTransactions.payrollTitle"),
      at("finalTransactions.submittedTerminationTemplate"),
      ...arms("finalTransactions.transactionNumber", ["value", "raw"]),
      ...text("finalTransactions.finalPay"),
      // Option lists are ARRAYS, hence single leaves each.
      at("options.terminationType"), at("options.division"), at("options.employeeType"),
      at("options.studentTitleCode"), at("options.department"), at("options.finalPay")),
  ];
}

/** The job-summary CLASSIFICATION fold's leaves, relative to a prefix; `rows` is an array and therefore one leaf. */
function jobClassificationLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...open(scope, at("disposition"), at("rowCount"), at("activeRowCount"),
      at("inactiveRowCount"), at("unknownRowCount"), at("unreadableCells")),
    ...population(scope, at("rows")),
  ];
}

/** The identity decision packet's leaves; names and EIDs are the person, and the tiers, the shape and the disposition describe the DECISION. */
/** The gate packet's WRITE PLAN block — both arms, because which one a run takes is decided by the descriptor and a receipt may not depend on that choice to be classifiable. */
function writePlanLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => `${prefix}.${path}`;
  return [
    ...person(scope, at("document.timekeeperName")),
    ...open(scope, at("document.timekeeperName.kind"), at("document.timekeeperName.name"),
      at("document.timekeeperName.inputPath"), at("document.timekeeperName.valueId"),
      at("document.timekeeperName.profileId"), at("document.timekeeperName.sessionEpoch")),
    ...open(scope,
      at("state"), at("reason"),
      at("termination.terminationType"), at("termination.classification"),
      at("termination.template"), at("termination.reasonCode"),
      at("termination.emplRecord"), at("termination.effectiveDate"),
      at("termination.lastDateWorked"), at("termination.initiatorComments"),
      at("document.documentNumber"), at("document.department"),
      at("document.departmentCode"), at("document.ucpathDepartment"),
      at("document.payrollTitleCode"), at("document.payrollTitle"),
      at("document.terminationEffectiveDate"),
      at("dates.kualiLastDayWorked"), at("dates.lastDayWorked"),
      at("dates.lastDayWorkedChanged"), at("dates.kualiSeparationDate"),
      at("dates.separationDate"), at("dates.separationDateChanged"),
      at("dates.separationDeterminingLeave"), at("dates.unclassifiedPayCodes"), at("dates.source")),
  ];
}

/** The reconciled dates, relative to a prefix; dates, flags and pay-code names describe the TRANSACTION being filed, and the comment texts are what will be typed into UCPath and Kuali. */
function reconciledDateLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return open(scope,
    at("lastDayWorked"), at("separationDate"), at("terminationEffectiveDate"),
    at("kualiLastDayWorked"), at("kualiSeparationDate"), at("lastDayWorkedChanged"),
    at("separationDateChanged"), at("latestSickDate"), at("firstHolidayDate"),
    at("latestHolidayDate"), at("separationDeterminingLeave"), at("unclassifiedPayCodes"),
    at("terminationComments"), at("dateChangeComments"), at("source"));
}

/** §4c's receipt PAIR — the transaction it names, and the person it is about. */
function terminationReceiptLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...person(scope, at("emplId"), at("displayedName")),
    ...open(scope, at("transactionNumber"), at("approvalStatus"), at("effectiveDate"),
      at("disposition")),
  ];
}

function identityPacketLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...writePlanLeaves(scope, at("plan")),
    ...person(scope, at("emplId"), at("documentEidText"), at("documentName"), at("ucpathName"),
      at("nameSearch.candidate.eid"), at("nameSearch.candidate.name")),
    ...population(scope, at("comparisons"), at("approvableEids"), at("nameSearch.candidateEids")),
    ...open(scope, at("protectedBindings"), at("documentNumber"), at("emplIdSource"), at("nameTier"), at("approvalShape"),
      at("observedAt"), at("nameSearch.status"), at("nameSearch.candidate.department"),
      at("nameSearch.candidate.jobTitle"), at("nameSearch.candidate.employeeStatus")),
    ...jobClassificationLeaves(scope, at("jobs")),
  ];
}

/** The approved subject: one EID, one displayed name, and three decision facts. */
function approvedSubjectLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...person(scope, at("emplId"), at("ucpathName")),
    ...open(scope, at("authority"), at("chosenFrom"), at("evidenceDigest"), at("nameTier"), at("approvalShape"), at("source")),
  ];
}

function resolvedIdentityLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...open(scope,
      at("state"), at("shouldCheckCrm"), at("ucpathFound"), at("crmErrorCode"), at("selected"), at("selected.department"), at("selected.jobTitle"), at("selected.employeeStatus"), at("selected.hdh"),
      at("selected.hrStatus"), at("selected.startDate"), at("selected.effectiveDate"), at("selected.terminationDate"), at("selected.terminationReason"), at("crmRecord"),
      at("crmIdentity"), at("crmIdentity.department"), at("crmIdentity.firstDayOfService"), at("crmRecord.recordId"), at("crmRecord.recordUrl"), at("crmRecord.department"), at("crmRecord.firstDayOfService"), at("crmRecord.dateSigned"), at("crmState"), at("method")),
    ...person(scope, at("selected.emplId"), at("selected.name"), at("crmRecord.emplId"), at("crmRecord.name"), at("crmIdentity.emplId"), at("crmIdentity.name"), at("recoveryEid")),
    ...population(scope, at("candidateEids"), at("unselectedCrmRecords")),
  ];
}

function activeStatusLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...open(scope, at("ucpathSelection"), at("state"), at("reason"), at("code"), at("hdh"), at("details.search"), at("details.department"),
      at("details.hrStatus"), at("details.ucpath"), at("details.crm"), at("details.startDate"), at("details.endDate"), at("details.terminationReason"), at("details.foundInUcpath")),
    ...person(scope, at("datesEid"), at("details.name"), at("details.eid"), at("details.matchedEid"), at("details.matchedName")),
    ...population(scope, at("candidateEids")),
  ];
}

function personLookupResultLeaves(scope: EvidenceValueScope): unknown[] {
  return [
    ...open(scope, "activeStatus.ucpathSelection", "activeStatus.state", "activeStatus.reason", "activeStatus.code", "activeStatus.hdh",
      "activeStatus.details.search", "activeStatus.details.department", "activeStatus.details.hrStatus", "activeStatus.details.ucpath", "activeStatus.details.crm",
      "activeStatus.details.startDate", "activeStatus.details.endDate", "activeStatus.details.terminationReason", "activeStatus.details.foundInUcpath",
      "crmDates.state", "crmDates.dates.code", "crmDates.dates.state", "crmDates.dates.reason", "crmDates.dates.employmentDate", "crmDates.dates.oathDate"),
    ...person(scope, "activeStatus.datesEid", "activeStatus.details.name", "activeStatus.details.eid", "activeStatus.details.matchedEid", "activeStatus.details.matchedName"),
    ...population(scope, "activeStatus.candidateEids"),
    ...person(scope, "crmDates.dates.emplId"),
  ];
}

function onbaseTargetLeaves(scope: EvidenceValueScope): unknown[] {
  return [
    ...person(scope, "ucpathId", "fallback.lastName", "fallback.firstName", "fallback.middleName", "fallback.suffix"),
    ...open(scope, "sourcePage", "document.bytes", "document.mediaType", "fallback.departmentName", "fallback.departmentCode",
      "fallback.viceChancellor", "fallback.viceChancellorCode"),
    ...["document.id", "document.sha256", "pageSha256"].map(path => ({ scope, path, classification: "direct-identifier", transform: "drop" })),
  ];
}

function onbaseSavedLeaves(scope: EvidenceValueScope, prefix = ""): unknown[] {
  const at = (path: string): string => prefix.length === 0 ? path : `${prefix}.${path}`;
  return [
    ...person(scope, at("ucpathId")),
    ...open(scope, at("documentType"), at("documentName"), at("source")),
    { scope, path: at("documentId"), classification: "direct-identifier", transform: "digest" },
    { scope, path: at("pageSha256"), classification: "direct-identifier", transform: "drop" },
  ];
}

function onboardingPrivateLeaves(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map(path => ({ scope, path, classification: "direct-identifier", transform: "digest" }));
}

function i9CreationProofLeaves(scope: EvidenceValueScope, prefix: string, remote: boolean): unknown[] {
  return [...open(scope, `${prefix}kind`, `${prefix}source`),
    ...onboardingPrivateLeaves(scope, ...(remote ? ["profileId", "i9Id", "startDate", "email"]
      : ["profileId", "firstName", "lastName", "dob", "email", "departmentNumber"]).map(path => `${prefix}${path}`))];
}

function hireProofLeaves(scope: EvidenceValueScope, prefix = ""): unknown[] {
  return [...open(scope, ...["kind", "source", "action", "approvalStatus", "detailVerified"].map(path => `${prefix}${path}`)),
    ...onboardingPrivateLeaves(scope, ...["transactionId", "profileId", "displayedName", "emplId", "effectiveDate", "positionNumber", "email", "dob"].map(path => `${prefix}${path}`))];
}

function onboardingRosterLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...onboardingPrivateLeaves(scope, `${prefix}workbookId`, `${prefix}sheetId`, `${prefix}rowId`, `${prefix}rowKey.email`),
    ...open(scope, `${prefix}workbookType`, `${prefix}referenceDigest`, `${prefix}workbookVersion`, `${prefix}capturedAt`),
  ];
}

function onboardingPlanLeaves(scope: EvidenceValueScope, prefix = ""): unknown[] {
  return [
    ...onboardingPrivateLeaves(scope, `${prefix}recordId`, `${prefix}postalCodeOverride`,
      ...["firstName", "lastName", "middleName", "preferredFirstName", "preferredLastName", "preferredMiddleName",
        "ssn", "dob", "address", "addressLine2", "city", "state", "postalCode", "phone", "email", "positionNumber",
        "departmentNumber", "recruitmentNumber", "employeeClassification", "hourlyRateMinor", "effectiveDate",
        "expectedJobEndDate"].map(path => `${prefix}employee.${path}`)),
    ...onboardingRosterLeaves(scope, `${prefix}roster.`),
    ...open(scope, `${prefix}jobEndDateSource`, `${prefix}ssnState`),
  ];
}

function onboardingSubjectLeaves(scope: EvidenceValueScope, prefix = ""): unknown[] {
  return [
    ...open(scope, `${prefix}state`),
    ...onboardingPrivateLeaves(scope, `${prefix}person.emplId`, `${prefix}person.name`),
    ...population(scope, `${prefix}candidateEids`, `${prefix}candidates`),
  ];
}

function onboardingLookupLeaves(scope: EvidenceValueScope): unknown[] {
  return [
    ...open(scope, "state", "subjectState", "childRunId", "result.i9Status"),
    ...onboardingPrivateLeaves(scope, "result.signerName", "result.profileId", "result.i9Id"),
  ];
}

function onboardingProfileLeaves(scope: EvidenceValueScope, prefix = ""): unknown[] {
  return [
    ...open(scope, ...["state", "subjectState", "i9Status", "reason"].map(path => `${prefix}${path}`)),
    ...onboardingPrivateLeaves(scope, `${prefix}profileId`,
      ...["firstName", "lastName", "middleName", "ssn", "dob", "email", "departmentNumber", "startDate"].map(path => `${prefix}request.${path}`)),
  ];
}

function ocrPrivateLeaves(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map(path => ({ scope, path, classification: "sensitive-hr", transform: "drop" }));
}

function ocrArtifactLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...ocrPrivateLeaves(scope, `${prefix}id`, `${prefix}sha256`),
    ...open(scope, `${prefix}bytes`, `${prefix}mediaType`),
  ];
}

function ocrManifestHeadLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...ocrArtifactLeaves(scope, `${prefix}document.`),
    ...open(scope, `${prefix}pageCount`),
    ...ocrPrivateLeaves(scope, `${prefix}fingerprint`),
  ];
}

function ocrManifestLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrManifestHeadLeaves(scope, prefix), ...ocrPrivateLeaves(scope, `${prefix}pages`)];
}

function ocrPageInputLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...ocrArtifactLeaves(scope, `${prefix}document.`),
    ...ocrArtifactLeaves(scope, `${prefix}image.`),
    ...open(scope, `${prefix}formType`, `${prefix}sourcePage`),
    ...ocrPrivateLeaves(scope, `${prefix}manifestFingerprint`, `${prefix}readingId`),
  ];
}

function ocrExtractionLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...open(scope, ...["formType", "sourcePage", "pageKind", "readAt", "source.kind"].map(path => `${prefix}${path}`)),
    ...ocrPrivateLeaves(scope, ...["pageFingerprint", "sourceSha256", "source.actorId", "source.providerId", "source.modelId", "source.agentId", "source.invocation",
      "record", "record.answers", "record.answersFingerprint"].map(path => `${prefix}${path}`)),
    ...population(scope, `${prefix}record.blockingPaths`),
  ];
}

function ocrPageReadingLeaves(scope: EvidenceValueScope): unknown[] {
  return [
    ...ocrPageInputLeaves(scope, "input."),
    ...ocrPrivateLeaves(scope, "extractionId"),
    ...ocrExtractionLeaves(scope, "extraction."),
  ];
}

function ocrRosterLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrRosterReferenceLeaves(scope, prefix), ...ocrPrivateLeaves(scope, `${prefix}rows`)];
}

function ocrRosterReferenceLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...ocrPrivateLeaves(scope, prefix.slice(0, -1), `${prefix}workbookId`, `${prefix}referenceDigest`),
    ...ocrArtifactLeaves(scope, `${prefix}artifact.`),
    ...open(scope, `${prefix}readAt`, `${prefix}workbookType`, `${prefix}workbookVersion`),
  ];
}

function ocrReviewCheckpointLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [
    ...ocrManifestLeaves(scope, `${prefix}accounting.manifest.`),
    ...ocrRosterReferenceLeaves(scope, `${prefix}roster.`),
    ...open(scope, ...["formType", "accounting.formType", "pages", "grouping.formType",
      "grouping.unidentified", "grouping.otherForms", "grouping.dataless"].map(path => `${prefix}${path}`)),
    ...ocrPrivateLeaves(scope, ...["sourceRunId", "accounting.readingId", "accounting.outcomes",
      "grouping.subjects", "records"].map(path => `${prefix}${path}`)),
  ];
}

function ocrResultLeaves(scope: EvidenceValueScope): unknown[] {
  return [...ocrReviewCheckpointLeaves(scope, "review."), ...ocrPrivateLeaves(scope, "identities")];
}

function approvedOcrReferenceLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrPrivateLeaves(scope, `${prefix}snapshotId`, `${prefix}sourceRunId`, `${prefix}digest`), ...open(scope, `${prefix}revision`)];
}
function approvedOcrSnapshotLeaves(scope: EvidenceValueScope): unknown[] {
  return [...ocrPrivateLeaves(scope, "snapshot.snapshotId", "snapshot.sourceRunId", "snapshot.reviewDigest", "snapshot.selectedRecordIds", "snapshot.records"),
    ...open(scope, "snapshot.revision", "snapshot.approvedBy", "snapshot.approvedAt")];
}
function approvedOcrRecordLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrPrivateLeaves(scope, `${prefix}recordId`, `${prefix}assertedEid`, `${prefix}fields.answers`, `${prefix}fields.blockingPaths`, `${prefix}fields.answersFingerprint`,
    `${prefix}provenance.commandId`, `${prefix}provenance.createdAt`, `${prefix}provenance.pages`),
    ...open(scope, `${prefix}discarded`, `${prefix}provenance.kind`)];
}
function contactSetLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrPrivateLeaves(scope, `${prefix}emplId`, `${prefix}displayedName`, `${prefix}rows`),
    ...open(scope, ...["pageStateId", "observation", "viewAll", "rowCount", "observedAt"].map(path => `${prefix}${path}`))];
}
function contactAddressLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...open(scope, `${prefix}kind`), ...ocrPrivateLeaves(scope,
    ...["address1", "address2", "city", "state", "postalCode", "country"].map(path => `${prefix}fields.${path}`))];
}
function contactInputLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrPrivateLeaves(scope, `${prefix}emplId`, `${prefix}expectedName`,
    ...["name", "relationship", "primary", "cellPhone", "homePhone", "workPhone"].map(path => `${prefix}contact.${path}`)),
    ...contactAddressLeaves(scope, `${prefix}contact.address.`)];
}
function contactEffectLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...ocrPrivateLeaves(scope, ...["name", "relationship", "primary", "phone"].map(path => `${prefix}${path}`)),
    ...contactAddressLeaves(scope, `${prefix}address.`)];
}
function contactPlanLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...open(scope, `${prefix}state`, `${prefix}rowIndex`, `${prefix}demotion`, `${prefix}demotion.rowIndex`, `${prefix}target.kind`, `${prefix}target.rowIndex`),
    ...ocrPrivateLeaves(scope, `${prefix}setFingerprint`), ...contactSetLeaves(scope, `${prefix}before.`),
    ...contactEffectLeaves(scope, `${prefix}effect.`), ...contactEffectLeaves(scope, `${prefix}demotion.effect.`)];
}
function contactProofLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  return [...open(scope, `${prefix}kind`, `${prefix}source`), ...ocrPrivateLeaves(scope, `${prefix}emplId`, `${prefix}displayedName`),
    ...contactEffectLeaves(scope, `${prefix}effect.`), ...contactSetLeaves(scope, `${prefix}contacts.`)];
}
function contactPlannedOutputLeaves(scope: EvidenceValueScope): unknown[] {
  return [...contactInputLeaves(scope, "target."), ...contactPlanLeaves(scope, "target.plan."), ...ocrPrivateLeaves(scope, "changes", "demotionLine", "contactLine")];
}

function i9ReferenceLeaves(scope: EvidenceValueScope): unknown[] {
  return ocrPrivateLeaves(scope,
    ...["typeId", "libraryId", "versionId", "keys", "fields"].map(path => `reference.request.${path}`),
    ...["libraryId", "version", "versionId", "versionName", "worksheets", "rows", "type.id", "type.name", "type.keyFieldId", "type.fields", "type.defaultWorkbookId"]
      .map(path => `reference.snapshot.${path}`));
}

export const EVIDENCE_FIELD_CLASSIFICATIONS: readonly EvidenceFieldClassification[] = Object.freeze([
  ...approvedOcrRecordLeaves(taskOutput("ocr/read-approved-record"), "record."),
  ...approvedOcrSnapshotLeaves(taskOutput("ocr/read-approved-snapshot")),
  ...approvedOcrSnapshotLeaves(workflowResult("emergency-contact-read-document")),
  ...contactInputLeaves(taskOutput("workflow:emergency-contact-member/read-approved-contact"), ""),
  ...contactPlannedOutputLeaves(taskOutput("workflow:emergency-contact-member/read-contact-plan")),
  ...["ucpath/read-emergency-contacts", "ucpath/stage-emergency-contact"].flatMap(id => contactSetLeaves(taskOutput(id), "contacts.")),
  ...["ucpath/match-emergency-contact-plan", "ucpath/verify-emergency-contact-plan"].flatMap(id => [
    ...open(taskOutput(id), "state", "observedAt", "matches", "evidence.source", "evidence.sourceState", "evidence.observedAt"),
    ...ocrPrivateLeaves(taskOutput(id), "reason", "queryDigest", "evidence", "evidence.idempotencyKeyDigest", "evidence.queryDigest", "evidence.evidenceRef"),
    ...contactProofLeaves(taskOutput(id), "proof."),
  ]),
  ...open(taskOutput("ucpath/stage-emergency-contact"), "stagedPageState"),
  ...contactProofLeaves(taskOutput("ucpath/save-emergency-contact"), "proof."),
  ...contactProofLeaves(writeProof("ucpath/save-emergency-contact"), ""),
  ...["emergency-contact-member", "emergency-contact-member-contact-plan", "emergency-contact-member-contact-preview"].flatMap(id => [
    ...approvedOcrReferenceLeaves(workflowInput(id), "approval."), ...approvedOcrRecordLeaves(workflowInput(id), "record."),
  ]),
  ...["emergency-contact-member", "emergency-contact-member-contact-preview"].flatMap(id => [
    ...open(workflowResult(id), "disposition"), ...contactProofLeaves(workflowResult(id), "proof."),
  ]),
  ...contactPlannedOutputLeaves(workflowResult("emergency-contact-member-contact-plan")),
  ...["emergency-contact", "emergency-contact-read-document", "emergency-contact-members"].flatMap(id => [
    ...ocrArtifactLeaves(workflowInput(id), "document."), ...ocrRosterLeaves(workflowInput(id), "roster."),
    ...open(workflowInput(id), "reading.kind"), ...ocrPrivateLeaves(workflowInput(id), "fileName", "readingId", "reading.actorId", "reading.assertions"),
  ]),
  ...[workflowResult("emergency-contact"), workflowResult("emergency-contact-members"), taskOutput("workflow:emergency-contact/read-result")].flatMap(scope => [
    ...approvedOcrReferenceLeaves(scope, "approval."), ...ocrPrivateLeaves(scope, "members"),
  ]),
  ...ocrPrivateLeaves(taskOutput("workflow:i9-check-start/read-people"), "people"),
  ...ocrPrivateLeaves(taskOutput("workflow:i9-check-start/read-requests"), "people", "children"),
  ...i9ReferenceLeaves(taskOutput("workflow:i9-check-start/read-requests")),
  ...[taskOutput("workflow:i9-check-start/read-rows"), taskOutput("workflow:i9-check-start/read-publication"),
    workflowResult("i9-check-start"), workflowResult("i9-check-start-retention")].flatMap(scope => [
    ...open(scope, "personCount"), ...ocrPrivateLeaves(scope, "batchKey", "tracker.rows", "people"), ...i9ReferenceLeaves(scope),
  ]),
  ...[taskOutput("workflow:i9-check-start/read-publication"), workflowResult("i9-check-start"), workflowResult("i9-check-start-retention")]
    .flatMap(scope => [...ocrPrivateLeaves(scope, "workbook.libraryId", "workbook.operationId"), ...open(scope, "workbook.state", "workbook.version")]),
  ...["i9-check-start", "i9-check-start-documents", "i9-check-start-roster-reference", "i9-check-start-retention"].flatMap(id => [
    ...open(workflowInput(id), "asOf"), ...ocrPrivateLeaves(workflowInput(id), "documents", "reviewerName"),
  ]),
  ...ocrPrivateLeaves(workflowResult("i9-check-start-documents"), "people"),
  ...ocrPrivateLeaves(workflowResult("i9-check-start-roster-reference"), "people", "children"),
  ...i9ReferenceLeaves(workflowResult("i9-check-start-roster-reference")),
  ...open(taskOutput("ocr/read-approved-records"), "state", "code"),
  ...ocrPrivateLeaves(taskOutput("ocr/read-approved-records"), "sources"),
  ...open(taskOutput("workbooks/read-reference"), "state", "reference.snapshot.version", "reference.request.fields", "reference.snapshot.type.fields"),
  ...population(taskOutput("workbooks/read-reference"), "reference.snapshot.rows", "reference.snapshot.worksheets"),
  ...["referenceDigest", "sources", "reference.request.typeId", "reference.request.libraryId", "reference.request.versionId", "reference.request.keys",
    "reference.snapshot.libraryId", "reference.snapshot.versionId", "reference.snapshot.versionName", "reference.snapshot.type.id", "reference.snapshot.type.name",
    "reference.snapshot.type.keyFieldId", "reference.snapshot.type.defaultWorkbookId"].map(path =>
    ({ scope: taskOutput("workbooks/read-reference"), path, classification: "sensitive-hr", transform: "drop" })),
  { scope: taskOutput("crm/search-document-records"), path: "records", classification: "direct-identifier", transform: "digest" },
  { scope: taskOutput("crm/read-idocs"), path: "people", classification: "direct-identifier", transform: "digest" },
  ...[taskOutput("workflow:crm-doc-download/read-document-rows"), workflowResult("crm-doc-download-reference")].flatMap(scope => [
    ...population(scope, "people"), ...open(scope, "state"),
    { scope, path: "referenceDigest", classification: "sensitive-hr", transform: "drop" },
    { scope, path: "sourceDigests", classification: "sensitive-hr", transform: "drop" },
  ]),
  ...[taskOutput("workflow:crm-doc-download/read-worksheet-archives"), workflowResult("crm-doc-download"), workflowResult("crm-doc-download-package-worksheets")].flatMap(scope => [
    ...population(scope, "worksheets", "collection.files"),
    ...open(scope, "worksheetCount", "personCount", "documentCount", "collection.artifact.bytes", "collection.artifact.mediaType"),
    ...["collection.artifact.id", "collection.artifact.sha256"].map(path => ({ scope, path, classification: "sensitive-hr", transform: "drop" })),
  ]),
  { scope: workflowResult("crm-doc-download-search-records"), path: "records", classification: "direct-identifier", transform: "digest" },
  { scope: workflowResult("crm-doc-download-read-idocs"), path: "people", classification: "direct-identifier", transform: "digest" },
  ...["crm-doc-download", "crm-doc-download-search-records", "crm-doc-download-reference", "crm-doc-download-read-idocs", "crm-doc-download-package-worksheets"].map(id =>
    ({ scope: workflowInput(id), path: "people", classification: "direct-identifier", transform: "digest" })),
  ...["crm-doc-download", "crm-doc-download-reference", "crm-doc-download-package-worksheets"].flatMap(id => [
    ...open(gateResult(id, "document-row-choice"), "state", "decision"), ...population(gateResult(id, "document-row-choice"), "people"),
    { scope: gateResult(id, "document-row-choice"), path: "referenceDigest", classification: "sensitive-hr", transform: "drop" },
    { scope: gateResult(id, "document-row-choice"), path: "sourceDigests", classification: "sensitive-hr", transform: "drop" },

  ]),
  ...open(taskOutput("extraction/extract-pdf-pages"), "pageCount"),
  ...ocrPrivateLeaves(taskOutput("extraction/extract-pdf-pages"), "pages"),
  ...ocrManifestHeadLeaves(taskOutput("workflow:ocr/read-source-pages"), "manifest."),
  ...[taskOutput("workflow:ocr-page/read-page-reading"), taskOutput("workflow:ocr-page/read-manual-reading")].flatMap(ocrPageReadingLeaves),
  ...ocrReviewCheckpointLeaves(taskOutput("workflow:ocr/read-review-seed"), ""),
  ...ocrPrivateLeaves(taskOutput("workflow:ocr/read-result"), "review.digest", "identities"),
  ...["ocr", "ocr-source-pages"].flatMap(id => [
    ...ocrArtifactLeaves(workflowInput(id), "document."),
    ...ocrRosterLeaves(workflowInput(id), "roster."),
    ...open(workflowInput(id), "approval", "formType", "reading.kind"),
    ...ocrPrivateLeaves(workflowInput(id), "sourceRunId", "fileName", "readingId", "reading.actorId", "reading.assertions"),
  ]),
  ...["ocr-page", "ocr-page-reading"].flatMap(id => [
    ...ocrPageInputLeaves(workflowInput(id), "page."),
    ...open(workflowInput(id), "reading.kind"),
    ...ocrPrivateLeaves(workflowInput(id), "reading.actorId"),
    ...ocrExtractionLeaves(workflowInput(id), "reading.extraction."),
    ...ocrPageReadingLeaves(workflowResult(id)),
  ]),
  ...ocrResultLeaves(workflowResult("ocr")),
  ...ocrPrivateLeaves(workflowResult("ocr"), "approvedSnapshot", "approvedSnapshot.snapshotId", "approvedSnapshot.sourceRunId", "approvedSnapshot.digest"),
  ...open(workflowResult("ocr"), "approvedSnapshot.revision"),
  ...ocrManifestHeadLeaves(workflowResult("ocr-source-pages"), "manifest."),
  ...ocrPrivateLeaves(gateResult("ocr", "approve-records"), "snapshotId", "sourceRunId", "digest"),
  ...open(gateResult("ocr", "approve-records"), "revision"),
  ...["onboarding", "onboarding-crm-data", "onboarding-ucpath-search", "onboarding-i9-search", "onboarding-hire-writes"].flatMap(id => [
    ...open(workflowInput(id), "mode", "configuredJobEndDate", "roster.state", "roster.reason"),
    ...onboardingPrivateLeaves(workflowInput(id), "email", "postalCodeOverride", "roster.row.references.livedName",
      ...["legalName", "livedName"].flatMap(name => ["firstName", "lastName", "middleName"].map(part => `roster.row.references.${name}.${part}`))),
    ...onboardingRosterLeaves(workflowInput(id), "roster.binding."),
    ...onboardingRosterLeaves(workflowInput(id), "roster.row.binding."),
    ...open(gateResult(id, "roster-choice"), "decision"),
    ...onboardingRosterLeaves(gateResult(id, "roster-choice"), "row.binding."),
    ...onboardingPrivateLeaves(gateResult(id, "roster-choice"), "row.references.livedName",
      ...["legalName", "livedName"].flatMap(name => ["firstName", "lastName", "middleName"].map(part => `row.references.${name}.${part}`))),
  ]),
  ...[taskOutput("workflow:onboarding/read-hire-plan"), workflowResult("onboarding-crm-data")].flatMap(scope => onboardingPlanLeaves(scope)),
  ...[taskOutput("workflow:onboarding/match-hire-subject"), workflowResult("onboarding-ucpath-search")].flatMap(scope => onboardingSubjectLeaves(scope)),
  ...[taskOutput("workflow:onboarding/read-i9-lookup"), workflowResult("onboarding-i9-search")].flatMap(scope => onboardingLookupLeaves(scope)),
  ...onboardingProfileLeaves(taskOutput("workflow:onboarding/read-i9-profile-plan")),
  ...onboardingRosterLeaves(taskOutput("workflow:onboarding/read-write-plan"), "roster."),
  ...onboardingSubjectLeaves(taskOutput("workflow:onboarding/read-write-plan"), "subject."),
  ...open(taskOutput("workflow:onboarding/read-write-plan"), "hire.mode"),
  ...onboardingPrivateLeaves(taskOutput("workflow:onboarding/read-write-plan"), "hire.expectedName", "hire.emplId", "comments", "i9",
    ...["firstName", "lastName", "middleName", "preferredFirstName", "preferredLastName", "preferredMiddleName", "ssn", "dob", "address", "addressLine2", "city", "state", "postalCode", "phone", "email", "positionNumber", "departmentNumber", "recruitmentNumber", "employeeClassification", "hourlyRateMinor", "effectiveDate", "expectedJobEndDate"].map(path => `hire.employee.${path}`),
    ...["firstName", "lastName", "middleName", "ssn", "dob", "email", "departmentNumber", "expectedName"].map(path => `i9.${path}`)),
  ...["onboarding", "onboarding-hire-writes"].flatMap(id => [
    ...open(gateResult(id, "hire-review"), "decision"),
    ...onboardingPrivateLeaves(gateResult(id, "hire-review"), "emplId"),
    ...onboardingPlanLeaves(workflowResult(id), "plan."),
    ...onboardingSubjectLeaves(workflowResult(id), "subject."),
    ...open(workflowResult(id), "state", "i9.state", "hireWrite.state", "hireWrite.disposition",
      "rosterAccess.state", "rosterAccess.version", "rosterAccess.receiptState", "rosterAccess.code", "rosterAccess.message"),
    ...i9CreationProofLeaves(workflowResult(id), "i9.", true),
    ...hireProofLeaves(workflowResult(id), "hireWrite.receipt."),
    ...onboardingPrivateLeaves(workflowResult(id), "rosterAccess.operationId", "rosterAccess.libraryId"),
  ]),
  ...[false, true].flatMap(remote => {
    const suffix = remote ? "remote-record" : "profile";
    return [
      ...i9CreationProofLeaves(writeProof(`i9/create-${suffix}`), "", remote),
      ...i9CreationProofLeaves(taskOutput(`i9/create-${suffix}`), "receipt.", remote),
      ...open(taskOutput(`i9/stage-${suffix}`), "stagedPageState"),
      ...onboardingPrivateLeaves(taskOutput(`i9/stage-${suffix}`), "observedName"),
      ...["match", "verify"].flatMap(verb => {
        const scope = taskOutput(`i9/${verb}-${suffix}`);
        return [...open(scope, "state", "reason", "matches", "observedAt", "evidence.source", "evidence.sourceState", "evidence.observedAt"),
          ...onboardingPrivateLeaves(scope, "queryDigest", "evidence.idempotencyKeyDigest", "evidence.queryDigest", "evidence.evidenceRef"),
          ...population(scope, "evidence"), ...i9CreationProofLeaves(scope, "proof.", remote)];
      }),
    ];
  }),
  ...hireProofLeaves(taskOutput("ucpath/read-hire-receipt")),
  ...hireProofLeaves(writeProof("ucpath/create-hire")),
  ...hireProofLeaves(taskOutput("ucpath/create-hire"), "receipt."),
  ...open(taskOutput("ucpath/read-hire-findings"), "state", "observedAt", "source"),
  ...population(taskOutput("ucpath/read-hire-findings"), "rows"),
  ...onboardingPrivateLeaves(taskOutput("ucpath/read-hire-findings"), "queryDigest"),
  ...open(taskOutput("ucpath/stage-hire"), "stagedPageState", "template", "reason", "transactionIdDisplay"),
  ...onboardingPrivateLeaves(taskOutput("ucpath/stage-hire"), "observedName"),
  ...["match", "verify"].flatMap(verb => {
    const scope = taskOutput(`ucpath/${verb}-hire`);
    return [...open(scope, "state", "reason", "matches", "observedAt", "evidence.source", "evidence.sourceState", "evidence.observedAt"),
      ...onboardingPrivateLeaves(scope, "queryDigest", "evidence.idempotencyKeyDigest", "evidence.queryDigest", "evidence.evidenceRef"),
      ...population(scope, "evidence"), ...hireProofLeaves(scope, "proof.")];
  }),
  ...[
    "recordId", "recordUrl", "requestedEmail", "personalEmail", "workEmail", "recordFirstName", "recordLastName",
    "department", "recruitmentNumber", "fields.positionNumber", "fields.firstName", "fields.lastName", "fields.middleName",
    "fields.ssn", "fields.address", "fields.addressLine2", "fields.city", "fields.state", "fields.postalCode", "fields.wage",
    "fields.dob", "fields.phone", "fields.email", "fields.appointment", "fields.effectiveDate", "fields.expectedJobEndDate",
  ].map(path => ({ scope: taskOutput("crm/read-hire-data"), path, classification: "direct-identifier", transform: "digest" })),
  ...["onbase", "onbase-source-page", "onbase-import-document"].flatMap(id => onbaseTargetLeaves(workflowInput(id))),
  ...onbaseTargetLeaves(taskOutput("onbase/read-source-page")),
  ...onbaseTargetLeaves(workflowResult("onbase-source-page")),
  ...[workflowResult("onbase"), workflowResult("onbase-import-document"), taskOutput("onbase/upload-import")].flatMap(scope => [
    ...onbaseSavedLeaves(scope, "savedDocument"),
    ...open(scope, "disposition"),
  ]),
  ...onbaseSavedLeaves(writeProof("onbase/upload-import")),
  ...person(taskOutput("onbase/stage-import"), "observedEid", "keywords.ucpathId", "keywords.lastName", "keywords.firstName"),
  ...open(taskOutput("onbase/stage-import"), "stagedPageState", "keywords.documentName", "keywords.departmentName", "keywords.departmentCode",
    "keywords.viceChancellor", "keywords.viceChancellorCode"),
  { scope: taskOutput("onbase/stage-import"), path: "pageSha256", classification: "direct-identifier", transform: "drop" },
  ...[taskOutput("onbase/match-import"), taskOutput("onbase/verify-import")].flatMap(scope => [
    ...onbaseSavedLeaves(scope, "proof"),
    ...open(scope, "state", "reason", "matches", "observedAt", "evidence.source", "evidence.sourceState", "evidence.observedAt"),
    ...population(scope, "evidence"),
    ...["queryDigest", "evidence.idempotencyKeyDigest", "evidence.queryDigest", "evidence.evidenceRef"].map(path => ({
      scope, path, classification: "direct-identifier", transform: "drop",
    })),
  ]),
  ...open(taskOutput("workflow:i9-check/read-match-outcome"), "shouldLookup"),
  ...[taskOutput("workflow:i9-check/read-match-outcome"), taskOutput("workflow:i9-check/read-retention-row"), workflowResult("i9-check"), workflowResult("i9-check-roster-match"), workflowResult("i9-check-person-match"), workflowResult("i9-check-person-lookup")].flatMap(scope => [
    ...open(scope, "identity.status", "identity.candidateCount", "identity.reason"),
    ...person(scope, "identity.eid", "identity.name"),
    ...population(scope, "identity.candidateEids"),
  ]),
  ...[taskOutput("workflow:i9-check/read-retention-row"), workflowResult("i9-check"), workflowResult("i9-check-roster-match")].flatMap(scope => [
    ...person(scope, "row.employeeName", "row.ppsEid", "row.ucpathEmplId", "row.reviewerName"),
    { scope, path: "row.recordId", classification: "direct-identifier", transform: "digest" },
    ...open(scope, "row.hireDate", "row.separationDate", "row.foundInUcpath", "row.action", "row.notes"),
  ]),
  ...open(workflowResult("i9-check-person-match"), "shouldLookup"),
  ...open(workflowResult("i9-check-person-lookup"), "shouldLookup"),
  ...[workflowInput("i9-check"), workflowInput("i9-check-roster-match"), workflowInput("i9-check-person-match"), workflowInput("i9-check-person-lookup")].flatMap(scope => [
    ...person(scope, "person.name", "person.firstName", "person.lastName", "person.dob", "roster.seed.ppsEid", "reviewerName"),
    ...["person.ssn", "recordId", "ocrRunId"].map(path => ({ scope, path, classification: "direct-identifier", transform: "digest" })),
    ...population(scope, "roster.rows"),
    ...open(scope, "person.hireDate", "person.sourcePages", "roster.seed.separationDate", "asOf", "person.useMatch"),
  ]),
  ...open(taskOutput("workbooks/read-result"), "state", "version", "receiptState", "code", "message"),
  ...["operationId", "libraryId"].map(path => ({ scope: taskOutput("workbooks/read-result"), path, classification: "direct-identifier", transform: "digest" })),
  ...["i9-lookup", "i9-lookup-lookup"].flatMap(id => [
    ...person(workflowInput(id), "lastName", "firstName"),
    { scope: workflowInput(id), path: "ssn", classification: "direct-identifier", transform: "digest" },
  ]),
  ...[taskOutput("i9/read-section2-signer"), taskOutput("workflow:i9-lookup/read-result"), workflowResult("i9-lookup"), workflowResult("i9-lookup-lookup")].flatMap(scope => [
    ...person(scope, "signerName", "profileId", "i9Id"),
    ...open(scope, "i9Status"),
  ]),

  /* person-lookup ingress */
  ...[PERSON_LOOKUP_INPUT,
    ...["person-lookup-searching", "person-lookup-cross-verify", "person-lookup-active-status", "person-lookup-crm-dates"].map(workflowInput),
  ].flatMap(scope => [
    ...person(scope, "name", "emplId", "lastName", "firstName", "dob"),
    { scope, path: "ssn", classification: "direct-identifier", transform: "digest" },
    ...open(scope, "mode", "crmCheck", "keepNonHdh", "includeCrmDates"),
  ]),

      /* `selection.selected` is declared twice: as the `null` of the ambiguous arm and as the object the resolved arm carries. */
  ...population(SEARCH, "results", "selection.candidateEids"),
  ...person(SEARCH, "selection.selected.emplId", "selection.selected.name", "selection.searchName"),
  ...open(SEARCH, "selection.status", "selection.selected", "selection.selected.department",
    "selection.selected.jobTitle", "selection.selected.employeeStatus", "selection.selected.hdh", "selection.selected.hrStatus", "selection.selected.startDate", "selection.selected.effectiveDate", "selection.selected.terminationDate", "selection.selected.terminationReason"),

  /* crm/read-onboarding-record */
  ...person(CRM_RECORD, "record.emplId", "record.fullName", "queriedEid"),
  ...open(CRM_RECORD, "state", "record.recordId", "record.rawStage", "reason"),

  ...person(CRM_DATES, "emplId"),
  ...open(CRM_DATES, "code", "state", "employmentDate", "oathDate", "reason"),
  ...population(taskOutput("ucpath/search-person-match"), "hits", "confirmed", "dropped"),
  ...population(taskOutput("crm/read-onboarding-results"), "records"),
  ...population(taskOutput("crm/verify-onboarding-record"), "records"),
  ...open(taskOutput("crm/verify-onboarding-record"), "state", "code", "reason"),
  ...population(taskOutput("crm/search-onboarding-records"), "records"),
  ...open(taskOutput("crm/search-onboarding-records"), "state", "code", "reason"),
  ...resolvedIdentityLeaves(taskOutput("workflow:person-lookup/read-resolved-identity"), ""),
  ...activeStatusLeaves(ACTIVE_STATUS, ""),
  ...personLookupResultLeaves(PERSON_LOOKUP_RESULT),
  ...resolvedIdentityLeaves(workflowResult("person-lookup-searching"), ""),
  ...resolvedIdentityLeaves(workflowResult("person-lookup-cross-verify"), "identity"),
  ...population(workflowResult("person-lookup-cross-verify"), "verifiedCrm.records", "crmResults.records"),
  ...open(workflowResult("person-lookup-cross-verify"), "verifiedCrm.state", "verifiedCrm.code", "verifiedCrm.reason"),
  ...activeStatusLeaves(workflowResult("person-lookup-active-status"), ""),
  ...personLookupResultLeaves(workflowResult("person-lookup-crm-dates")),

        /* These describe the READ, not about the person, so they are open. */
  ...person(KRONOS_TIMECARD_INPUT, "emplId", "expectedName"),
  ...open(KRONOS_TIMECARD_INPUT, "rangeStart", "rangeEnd", "searchTimeoutMs"),

        /* Whether the search was matched decides whether it was unambiguous, and it is answerable without naming anyone who was not selected. */
  ...person(KRONOS_SEARCH, "query", "matched.displayName", "matched.employeeId"),
  ...population(KRONOS_SEARCH, "candidates"),
  ...open(KRONOS_SEARCH, "totalCount", "selectedCount", "panelContext"),

        /* The rest describes the TRANSACTION; the date arrays are arrays, hence single leaves. */
  ...person(KRONOS_TIMECARD, "subject.expectedEid", "subject.observedEmployeeId",
    "subject.observedDisplayName"),
  ...open(KRONOS_TIMECARD, "subject.observationId", "subject.matches",
    "range.requestedStart", "range.requestedEnd", "range.observedLabel",
    "range.observedStart", "range.observedEnd", "range.applied",
    "grid.columnHeaders", "grid.scrollSteps", "grid.daysCovered", "grid.populatedRows",
    "grid.lastPunchDate", "grid.punchDates", "grid.sickDates", "grid.holidayDates",
    "grid.payCodeDays", "grid.unclassifiedPayCodes"),

  /* separations-kronos-timecard terminal result */
  ...person(KRONOS_TIMECARD_RESULT, "subject.expectedEid", "subject.observedEmployeeId",
    "subject.expectedName", "subject.observedDisplayName"),
  ...population(KRONOS_TIMECARD_RESULT, "search.candidates"),
  ...open(KRONOS_TIMECARD_RESULT, "subject.nameSimilarity",
    "window.requestedStart", "window.requestedEnd", "window.observedStart",
    "window.observedEnd", "window.observedLabel", "window.daysCovered",
    "timecard.lastPunchDate", "timecard.punchDates", "timecard.sickDates",
    "timecard.holidayDates", "timecard.payCodeDays", "timecard.unclassifiedPayCodes",
    "derived.lastPunchDate", "derived.latestLeaveDate", "derived.separationDateCandidate",
    "derived.hasPunches", "search.totalCount", "search.panelContext"),

  /* separations-kuali-read ingress. A document number and an action id name a
     DOCUMENT, not a person, so both are open. */
  ...open(KUALI_READ_INPUT, "actionId", "documentNumber"),

        /* This describes the ADDRESS of a document, never a person: a document number, a workflow-step id, the link it was read from, and how many links carried it. */
  ...open(KUALI_ACTION_SEARCH, "pageStateId", "documentNumber", "actionId", "actionHref",
    "matchedLinkCount", "observedAt"),

  /* kuali/read-separation-document — the whole form, one declaration. */
  ...separationDocumentLeaves(KUALI_SEPARATION, ""),

  /* workflow:separations/match-termination-type. A template and a reason code
     describe the TRANSACTION being filed, not the person it is filed about. */
  ...open(TERMINATION_TYPE, "terminationType", "classification", "template", "reasonCode",
    "observedOptionCount"),

  /* separations-kuali-read terminal result: the same form under `document.`,
     plus the resolution under `termination.`. */
  ...separationDocumentLeaves(KUALI_READ_RESULT, "document"),
  ...open(KUALI_READ_RESULT, "termination.terminationType", "termination.classification",
    "termination.template", "termination.reasonCode", "termination.observedOptionCount"),

        /* EIDs are the PERSON; the document number, the source fork and the absent arm's own reason describe the READ, and an arm DISCRIMINATOR is not the person. */
  ...person(IDENTITY_CHECK_INPUT, "employeeName", "emplId", "documentEid.value"),
  ...open(IDENTITY_CHECK_INPUT, "documentNumber", "emplIdSource", "documentEid.state",
    "documentEid.reason"),

        /* The employment history is therefore one leaf, carried as a count with a sensitivity class rather than a redacted dump. */
  ...person(JOB_SUMMARY, "emplId", "displayedName"),
  ...population(JOB_SUMMARY, "jobRows"),
  ...open(JOB_SUMMARY, "pageStateId", "rowCount", "observedAt",
    "renderContext.entry", "renderContext.searchResultRows",
    "renderContext.employmentInstances"),

  /* workflow:separations/match-identity — the gate's decision packet. */
  ...identityPacketLeaves(MATCH_IDENTITY, "packet"),
  ...open(MATCH_IDENTITY, "evidenceDigest", "approvalRequired"),

        /* These are carried forward past the gate so the terminal result has no pre-gate ancestry. */
  ...open(VERIFY_IDENTITY_APPROVAL, "documentNumber"),
  ...approvedSubjectLeaves(VERIFY_IDENTITY_APPROVAL, "approved"),
  ...jobClassificationLeaves(VERIFY_IDENTITY_APPROVAL, "jobs"),

        /* The operator decision; both arms are declared, because which arm a run took is decided at the gate and a receipt may not depend on that choice. */
  ...person(IDENTITY_APPROVAL_GATE, "eid"),
  ...open(IDENTITY_APPROVAL_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

  /* separations-identity-check terminal result */
  ...open(IDENTITY_CHECK_RESULT, "documentNumber"),
  ...approvedSubjectLeaves(IDENTITY_CHECK_RESULT, "approved"),
  ...jobClassificationLeaves(IDENTITY_CHECK_RESULT, "jobs"),

        /* An arm DISCRIMINATOR is not the person, and the termination half is all transaction facts: the dates, the empl record and the comment text describe WHAT is being filed. */
  ...person(UCPATH_TERMINATION_INPUT, "employeeName", "emplId", "documentEid.value"),
  ...open(UCPATH_TERMINATION_INPUT, "documentNumber", "emplIdSource", "documentEid.state",
    "documentEid.reason", "terminationType.state", "terminationType.value",
    "terminationType.reason", "observedTerminationTypeOptions", "emplRecord",
    "effectiveDate", "lastDateWorked", "initiatorComments"),

        /* Scoped by `(workflow, gate)`, so one workflow's declaration does not cover another's gate even with an identical payload schema: a second workflow must state its own answer. */
  ...person(UCPATH_TERMINATION_GATE, "eid"),
  ...open(UCPATH_TERMINATION_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

        /* The answer to the typed EID is therefore the PERSON; the reason-option list is a control capture and one leaf. */
  ...person(UCPATH_STAGE_TERMINATION, "emplId", "observedName"),
  ...population(UCPATH_STAGE_TERMINATION, "observedReasonOptions"),
  ...open(UCPATH_STAGE_TERMINATION, "stagedPageState", "observedEmplRecord", "template",
    "transactionDate", "effectiveDate", "resolvedReasonOption", "lastDateWorked",
    "lastDateWorkedOverridden", "transactionIdDisplay", "observedAt"),

  /* Transaction-lane beat ① probes. These points are the probe task's own
     compact page report, not a copy of the eventual completion proof. */
  ...person(UCPATH_MATCH_TERMINATION, "emplId"),
  ...open(UCPATH_MATCH_TERMINATION, "state", "effectiveDate"),
  ...person(UCPATH_MATCH_SWEEP, "emplId"),
  ...open(UCPATH_MATCH_SWEEP, "state", "diagnostic.state", "diagnostic.banner",
    "diagnostic.oldRowCount", "diagnostic.route", "diagnostic.iframeCount",
    "diagnostic.errorRegionCount", "diagnostic.searchVisible", "diagnostic.searchEnabled",
    "diagnostic.cause"),

  /* ucpath/create-termination — the commit's own post-click read. */
  ...terminationProofLeaves(UCPATH_CREATE_TERMINATION, "receipt"),

  /* ucpath/stage-pending-termination-sweep — the ticked rows, before any click. */
  ...person(UCPATH_STAGE_SWEEP, "emplId", "observedName"),
  ...population(UCPATH_STAGE_SWEEP, "selected"),
  ...open(UCPATH_STAGE_SWEEP, "stagedPageState", "observedAt"),

  /* ucpath/delete-pending-terminations — the sweep commit's own post-click read. */
  ...sweepProofLeaves(UCPATH_DELETE_PENDING, "cleared"),

  /* Transaction-lane beat ⑥ read-backs. Separate task scopes are deliberate:
     a verifier is the landing authority and cannot borrow its probe's table. */
  ...person(UCPATH_VERIFY_TERMINATION, "emplId"),
  ...open(UCPATH_VERIFY_TERMINATION, "state", "effectiveDate"),
  ...person(UCPATH_VERIFY_SWEEP, "emplId"),
  ...open(UCPATH_VERIFY_SWEEP, "state"),

  /* Exact pending-set admission plus the fresh filing-presence precondition. */
  ...person(UCPATH_PENDING_SET, "emplId"),
  ...population(UCPATH_PENDING_SET, "eligible", "protected"),
  ...open(UCPATH_PENDING_SET, "kind", "observedAt", "source"),
  ...person(UCPATH_FINDINGS, "emplId"),
  ...population(UCPATH_FINDINGS, "rows"),
  ...open(UCPATH_FINDINGS, "state", "scannedRowCount", "completeness.state", "completeness.reason",
    "completeness.reportedRowCount", "observedAt", "source"),
  ...filingPresenceLeaves(UCPATH_FILING_PRESENCE),

  /* separations-ucpath-termination terminal result */
  ...open(UCPATH_TERMINATION_RESULT, "documentNumber", "pendingSweep.disposition",
    "termination.disposition"),
  ...approvedSubjectLeaves(UCPATH_TERMINATION_RESULT, "approved"),
  ...sweepProofLeaves(UCPATH_TERMINATION_RESULT, "pendingSweep.proof"),
  ...terminationProofLeaves(UCPATH_TERMINATION_RESULT, "termination.proof"),

        /* The same split applies: the timekeeper is a person like every other name, and the dept id and description are UNIT facts, not person facts. */
  ...person(KUALI_FINALIZATION_INPUT, "employeeName", "emplId", "documentEid.value",
    "timekeeperName"),
  ...open(KUALI_FINALIZATION_INPUT, "actionId", "documentNumber", "emplIdSource",
    "documentEid.state", "documentEid.reason", "ucpathDeptId.state", "ucpathDeptId.value",
    "ucpathDeptId.reason", "ucpathDepartment.state", "ucpathDepartment.value",
    "ucpathDepartment.reason", "observedDepartmentOptions", "payrollTitleCode", "payrollTitle",
    "lastDayWorked", "separationDate", "terminationEffectiveDate", "transactionNumber",
    "transactionApprovalStatus",
    "timekeeperComments", "observedExistingComments"),

    /* The conditional name-only gate on this workflow's own scope. */
  ...person(KUALI_FINALIZATION_GATE, "eid"),
  ...open(KUALI_FINALIZATION_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

        /* Both spellings of the department are carried because the operator compares them; nothing here is a person. */
  ...open(DEPARTMENT_OPTION, "option", "departmentCode", "optionDescription", "ucpathDepartment",
    "observedOptionCount"),

  /* kuali/stage-separation-finalization — the one staging pass, plus the
     operator's undo record and §3.2's option capture. */
  ...person(KUALI_STAGE_FINALIZATION, "observedEid"),
  ...open(KUALI_STAGE_FINALIZATION, "stagedPageState", "actionId", "documentNumber",
    "observedDepartmentOptions", "observedAt"),
  ...finalizationFieldLeaves(KUALI_STAGE_FINALIZATION, "previousFields"),
  ...finalizationFieldLeaves(KUALI_STAGE_FINALIZATION, "stagedFields"),

  /* Kuali's beat-① probe and beat-⑥ reload read-back. */
  ...open(KUALI_MATCH_FINALIZATION, "state", "documentNumber", "transactionNumber"),
  ...open(KUALI_VERIFY_FINALIZATION, "state", "documentNumber", "transactionNumber"),

  /* kuali/save-separation-finalization — the commit's CLAIM about what it
     targeted. Beat ⑥ replaces it with the reload read-back's proof. */
  ...savedFinalizationLeaves(KUALI_SAVE_FINALIZATION, "savedState"),

  /* separations-kuali-finalization terminal result */
  ...open(KUALI_FINALIZATION_RESULT, "documentNumber", "department.option",
    "department.departmentCode", "finalization.disposition"),
  ...approvedSubjectLeaves(KUALI_FINALIZATION_RESULT, "approved"),
  ...savedFinalizationLeaves(KUALI_FINALIZATION_RESULT, "finalization.proof"),

        /* This names one action id, the timekeeper who files it, the search bound, and how the document was reached — the READ, never the person. */
  ...person(SEPARATIONS_INPUT, "timekeeperName", "operatorEmployeeId"),
  ...open(SEPARATIONS_INPUT, "documentNumber", "searchTimeoutMs",
    "reRead.ordinal", "reRead.reason"),

    /* The conditional name-only gate on the composition's own scope — and here it
     dominates three real writes across two systems. */
  ...person(SEPARATIONS_GATE, "eid"),
  ...open(SEPARATIONS_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

    /* Employee names identify people; dates and windows describe the read. */
  ...person(SEPARATION_PLAN, "employeeName"),
  ...open(SEPARATION_PLAN, "documentNumber", "kualiLastDayWorked", "kualiSeparationDate",
    "asOfDate", "timecardWindow.start", "timecardWindow.end"),

    /* EIDs and searched names identify people; source and candidate count describe the decision. */
  ...person(SEPARATION_SUBJECT, "emplId", "searchedName"),
  ...open(SEPARATION_SUBJECT, "emplIdSource", "candidateCount"),

    /* Employment records and job fields describe the appointment, not the person. */
  ...open(ACTIVE_EMPLOYMENT, "rowIndex", "emplRecord", "hrStatus", "businessUnit",
    "deptId.state", "deptId.value", "deptId.reason",
    "department.state", "department.value", "department.reason",
    "payrollTitleCode", "payrollTitle",
    "effectiveDate.state", "effectiveDate.value", "effectiveDate.reason", "rowCount"),

  /* workflow:separations/read-separation-dates — the write's payload. */
  ...reconciledDateLeaves(SEPARATION_DATES, ""),

    /* workflow:separations/verify-termination-receipt — the receipt pair, checked. */
  ...terminationReceiptLeaves(TERMINATION_RECEIPT, ""),

  /* separations terminal result — the whole composition's product. */
  ...open(SEPARATIONS_RESULT, "documentNumber", "employment.emplRecord",
    "employment.payrollTitleCode", "employment.payrollTitle",
    "department.option", "department.departmentCode",
    "dates.kualiLastDayWorked", "dates.lastDayWorked", "dates.kualiSeparationDate",
    "dates.separationDate", "dates.terminationEffectiveDate",
    "dates.lastDayWorkedChanged", "dates.separationDateChanged",
    "pendingSweep.disposition", "finalization.disposition",
      // The omitted arm of a write step: a closed state and the step key.
    "pendingSweep.state", "pendingSweep.step", "finalization.state", "finalization.step"),
  ...approvedSubjectLeaves(SEPARATIONS_RESULT, "approved"),
  ...sweepProofLeaves(SEPARATIONS_RESULT, "pendingSweep.proof"),
  ...terminationReceiptLeaves(SEPARATIONS_RESULT, "termination"),
  ...savedFinalizationLeaves(SEPARATIONS_RESULT, "finalization.proof"),

    /* Completion proofs, per commit contract, on the same `write-proof` scope the
     task-output and terminal-result tables already use; the shape helpers are shared. */
  ...terminationProofLeaves(writeProof("ucpath/create-termination"), ""),
  ...sweepProofLeaves(writeProof("ucpath/delete-pending-terminations"), ""),
  ...savedFinalizationLeaves(writeProof("kuali/save-separation-finalization"), ""),

  ...open(OCR_FORM_PAGE, "formType", "source.kind", "source.providerId", "readAt",
    "sourceSha256", "sourcePage", "pageKind", "pageFingerprint", "hasRecord",
    "record", "record.answersFingerprint"),
  ...population(OCR_FORM_PAGE, "record.blockingPaths"),
  ...["record.answers", "source.modelId"].map((path) => ({
    scope: OCR_FORM_PAGE, path, classification: "sensitive-hr", transform: "drop",
  })),

    /* The executor's own fixture contracts: test-local shapes that must name a manifest-known task, DECLARED rather than exempted, so the undeclared-leaf refusal stays exercised by a composed run. */
  ...person(OCR_FORM_PAGE, "subject", "eid"),
  ...open(OCR_FORM_PAGE, "disposition", "providerState", "artifactSha", "artifactBytes", "value"),

  // Private Plan 1 form fixtures wrap their output in a namespace absent from active contracts.
  ...[KUALI_SEPARATION, OCR_FORM_PAGE, SEARCH, KUALI_MATCH_FINALIZATION, KUALI_VERIFY_FINALIZATION].flatMap((scope) => [
    ...person(scope, "fictional.employee"),
    ...open(scope, "fictional.documentNumber", "fictional.lastDayWorked", "fictional.separationDate", "fictional.holidayPay", "fictional.department", "fictional.title", "fictional.reason", "fictional.effectiveDate", "fictional.template", "fictional.pending", "fictional.transaction", "fictional.finalPay", "fictional.mode", "fictional.review"),
    { scope, path: "fictional.comments", classification: "direct-identifier", transform: "drop" },
    { scope, path: "fictional.managerComments", classification: "direct-identifier", transform: "drop" },
  ]),

  ...open(workflowResult("wiring-projection"), "done"),
  { scope: workflowInput("wiring-projection"), path: "name", classification: "direct-identifier", transform: "drop" },
  ...["archive.fileName", "archive.files", "archive.artifact.id"].map(path => ({
    scope: taskOutput("workflow:wiring-projection/read-archive"), path, classification: "direct-identifier", transform: "drop",
  })),
  ...open(taskOutput("workflow:wiring-projection/read-archive"), "archive.artifact.sha256", "archive.artifact.bytes", "archive.artifact.mediaType"),

  /* The write-sequencer's sealed transaction fixture exercises every role
     through the same declaration refusal as production; it has no bypass. */
  ...person(taskOutput("ucpath/read-write-fixture-probe"), "eid"),
  ...open(taskOutput("ucpath/read-write-fixture-probe"), "state"),
  {
    scope: taskOutput("ucpath/read-write-fixture-probe"),
    path: "secretCanary",
    classification: "secret",
    transform: "drop",
  },
  ...open(taskOutput("ucpath/fill-write-fixture"), "staged", "stagedPageState"),
  ...open(taskOutput("ucpath/submit-write-fixture"), "preClickPageState", "transactionId"),
  ...open(taskOutput("ucpath/save-write-fixture"), "preClickPageState", "transactionId"),
  ...open(writeProof("ucpath/submit-write-fixture"), "transactionId"),
  ...open(writeProof("ucpath/save-write-fixture"), "transactionId"),
  ...person(taskOutput("ucpath/read-write-fixture-verify"), "eid"),
  ...open(taskOutput("ucpath/read-write-fixture-verify"), "state"),
].map((entry) => Object.freeze(EvidenceFieldClassificationSchema.parse(entry))));

const BY_SCOPE_AND_PATH = new Map<string, EvidenceFieldClassification>();
for (const entry of EVIDENCE_FIELD_CLASSIFICATIONS) {
  const key = `${evidenceScopeKey(entry.scope)}\u0000${entry.path}`;
  const existing = BY_SCOPE_AND_PATH.get(key);
  if (existing !== undefined) {
    throw new Error(
      `evidence classification for ${evidenceScopeKey(entry.scope)} field "${entry.path}" is declared `
      + `twice (${existing.classification}/${existing.transform} and ${entry.classification}/${entry.transform})`,
    );
  }
  BY_SCOPE_AND_PATH.set(key, entry);
}

export const EvidenceLeafSchema = z.strictObject({
  /** The dotted path, in the same vocabulary `FactProvenance.path` uses. */
  path: EvidenceLeafPathSchema,
  /** The leaf's own camelCase name, which is what `EvidenceFact.field` accepts. */
  field: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  /** Strictly JSON: a value that cannot serialize cannot be evidence. */
  value: JsonValueSchema,
});
export type EvidenceLeaf = z.infer<typeof EvidenceLeafSchema>;

/** Arrays and empty objects are leaves; sorted paths keep equivalent JSON receipts byte-stable. */
export function evidenceLeaves(value: unknown, prefix = ""): readonly EvidenceLeaf[] {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return [leafOf(prefix, value)];
  }
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (entries.length === 0) return [leafOf(prefix, value)];
  return entries.flatMap(([key, child]) => evidenceLeaves(
    child,
    prefix.length === 0 ? key : `${prefix}.${key}`,
  ));
}

function leafOf(path: string, value: unknown): EvidenceLeaf {
  if (path.length === 0) {
    throw new Error("an evidence leaf must be named; a bare scalar or array has no field identity");
  }
  const field = path.split(".").at(-1);
  if (field === undefined || !/^[a-z][A-Za-z0-9]*$/.test(field)) {
    throw new Error(`evidence leaf "${path}" has no camelCase field name`);
  }
  return Object.freeze(EvidenceLeafSchema.parse({ path, field, value }));
}

/** The declared classification, or a loud refusal naming the exact gap. */
export function classifyEvidenceLeaf(
  scope: EvidenceValueScope,
  path: string,
): EvidenceFieldClassification {
  const entry = BY_SCOPE_AND_PATH.get(`${evidenceScopeKey(scope)}\u0000${path}`);
  if (entry === undefined) {
    throw new z.ZodError([{ code: "custom", path: [path], message:
      `no declared evidence classification for ${evidenceScopeKey(scope)} field "${path}"; `
      + "add it to src/models/trust/evidence-classification.ts — neither a receipt nor an "
      + "observed log ever drops a leaf silently",
    }]);
  }
  return entry;
}

/** Classified inputs use leaf names; redacted outputs use full paths. */
export function redactEvidenceLeaf(
  scope: EvidenceValueScope,
  leaf: EvidenceLeaf,
): z.infer<typeof RedactedFieldSchema> {
  const declared = classifyEvidenceLeaf(scope, leaf.path);
  if (leaf.field === "ssn") {
    return RedactedFieldSchema.parse({ key: leaf.path, ...redactValue(declared.classification, declared.transform, leaf.value) });
  }
  const redaction = redactDiagnosticFields([{
    key: leaf.field,
    classification: declared.classification,
    transform: declared.transform,
    value: leaf.value,
  }]);
  const [field] = redaction.fields;
  if (field === undefined || redaction.warnings.length > 0) {
    throw new Error(
      `evidence leaf "${leaf.path}" of ${evidenceScopeKey(scope)} could not be redacted `
      + `as ${declared.classification}/${declared.transform}: ${redaction.warnings.join("; ")}`,
    );
  }
  return RedactedFieldSchema.parse({ ...field, key: leaf.path });
}
