/**
 * Declared evidence classification — ref clock-config-secrets §6's "redaction is schema-owned"
 * applied to ref operator-trust §2.3's receipt facts (D140).
 *
 * A receipt is the surface an operator uses to finish a double-check WITHOUT
 * opening the source system, so it carries real values. Which values, and in
 * what form, is a DECLARATION here — never a guess made from a field's name at
 * projection time. Two rules follow from the charter:
 *
 * 1. **A leaf with no declared classification is a loud failure, not a silent
 *    drop.** `redactDiagnosticFields` drops an unclassified *diagnostic* field
 *    with a warning because that channel accepts free-form payloads. A receipt
 *    is different: its leaves come from schemas this repository owns, so an
 *    unclassified leaf is a missing declaration in THIS file — a code gap the
 *    author closes, exactly like `config/pending-impl-bindings.json`. Dropping
 *    it would make a receipt look complete while hiding what the run actually
 *    read or wrote.
 * 2. **The transform is the one the classification allows, and no wider.**
 *    `redactDiagnosticFields` owns the whole transform implementation; this
 *    module only chooses (classification, transform) per leaf and widens the
 *    produced field's `key` from the leaf name to its full dotted path. There
 *    is deliberately no second redaction implementation to drift.
 *
 * ## The leaf rule is the one the provenance collector already uses
 *
 * `src/core/task-provenance.ts` defines an output leaf as: an ARRAY is a leaf,
 * an empty object is a leaf, a populated object recurses, and everything else
 * is a leaf. This module uses exactly that rule so a receipt fact and the
 * `FactProvenance` row that dates it share one path vocabulary. Inventing a
 * second, finer rule here (`results[3].emplId`) would produce facts that no
 * stored provenance row could ever date, and the receipt would have to guess
 * the observation instant — which is the failure mode this whole program
 * exists to prevent.
 *
 * ## Why business values are `safe-diagnostic` and person identifiers are not
 *
 * Ref clock-config-secrets's closed enum has no "operator-visible HR value" arm, so the mapping
 * is stated rather than assumed. A UCPath employee status, a CRM process
 * stage, a Kuali document number, an onboarding date, a page-state id, a proof
 * source: these describe the TRANSACTION, not the person, and the operator
 * already sees them on the queue row and the context rail. They are
 * `safe-diagnostic`.
 *
 * A person's EID or name is a `direct-identifier`, whose widest permitted
 * transform is `last4`. That is deliberately NOT weaker than it looks: the
 * receipt never asks the operator to eyeball two names and decide whether they
 * agree. It carries the SERVER's verdict on the identity obligation with the
 * digest that proves the comparison, which is a stronger double-check than
 * printing the identifier twice would be. `timekeeperName` is classified
 * `direct-identifier` here because `src/domain/secrets.ts` already classifies
 * the `TIMEKEEPER_NAME` environment value that way, and one field cannot carry
 * two classifications. A LIST of people (`results`, `selection.candidateEids`)
 * is `sensitive-hr`/`count`: "one candidate matched" is the fact that decides
 * whether the search was unambiguous, and it is answerable without naming
 * anybody who was not selected.
 */
import { z } from "zod";
import { JsonValueSchema } from "../canonical-json.js";
import { GateIdSchema, TaskIdSchema, WorkflowIdSchema } from "../ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  RedactedFieldSchema,
  evidenceTransformAllowed,
  redactDiagnosticFields,
  redactHistoricalValue,
} from "../redaction.js";

/** Where a leaf came from. A path only means something inside one of these. */
export const EvidenceValueScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-input"), workflowId: WorkflowIdSchema }),
  z.strictObject({ kind: z.literal("workflow-result"), workflowId: WorkflowIdSchema }),
  z.strictObject({ kind: z.literal("task-output"), taskId: TaskIdSchema }),
  /**
   * A gate's stored result payload (D204). It is scoped by `(workflow, gate)`
   * and NOT by a task id, because a gate owns no contract: its result schema is
   * declared on the gate node itself, so two workflows can name a gate the same
   * thing and mean different payloads.
   */
  z.strictObject({
    kind: z.literal("gate-result"),
    workflowId: WorkflowIdSchema,
    gateId: GateIdSchema,
  }),
  /**
   * A commit contract's completion proof (Track F, ledger 2 D16–D22). It is
   * scoped by the COMMIT task id, not by the verify task that may have read
   * it: the proof schema is the commit contract's own declaration, the same
   * value whichever of `proofFromOutput` / `proofFromPresentProbe` produced
   * it, and the receipt's action entry carries it beside the write it proves.
   */
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
  // The pairing is refused HERE, at declaration time — not only when a value
  // is eventually pushed through the transform. A `secret`/`allow` line in the
  // table below would otherwise sit in the tree looking reviewed until the
  // first run that happened to carry that field.
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

/**
 * The twelve values one Kuali finalization save writes, relative to a prefix.
 *
 * They appear four times over — the prepare's `previousFields` and
 * `stagedFields`, the commit's claimed `savedState.fields`, and the terminal
 * result's proof — and declaring them from one list is what keeps those copies
 * from drifting apart. Only the timekeeper is a PERSON; the rest describe WHAT
 * is being recorded, which is chunk 4's rule for `initiatorComments` applied to
 * the same kind of field.
 */
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

/**
 * Every leaf of the Kuali separation-document read, relative to a prefix.
 *
 * The read is a WIDE fixed schema whose fields carry `present`/`absent` arms,
 * so each field contributes up to four paths (`state`, `value`, `raw`,
 * `reason`) and the arm a run takes decides which ones exist. Declaring them
 * from one list is what keeps the task output and the terminal result — which
 * carries the identical shape under `document.` — from drifting apart: an
 * undeclared leaf fails loud at receipt time, and two hand-written copies of a
 * 60-path table would drift on the first field anybody added.
 */
function separationDocumentLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  const arms = (path: string, extra: readonly string[]): string[] =>
    ["state", "reason", ...extra].map((leaf) => at(`${path}.${leaf}`));
  const text = (path: string): string[] => arms(path, ["value"]);
  const date = (path: string): string[] => arms(path, ["value", "raw"]);
  /**
   * A person field's ARM DISCRIMINATOR is not the person.
   *
   * The live proof run on document 4502 (2026-08-12) is why this is split
   * rather than declared wholesale: classifying `employee.name.state` as a
   * `direct-identifier` put its value through `last4`, so a receipt that should
   * read `present` read **`sent`** — and `employee.name.reason` read `alue`.
   * That is not redaction, it is a receipt telling the operator something
   * false. Only the `value` leaf carries the identifier; `state` and `reason`
   * describe the READ, and the read is a transaction fact.
   */
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
    // Everything else about the appointment describes the TRANSACTION: a title
    // code, a division, a work location, a department. The operator already
    // sees these on the queue row.
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

/**
 * The job-summary CLASSIFICATION fold's leaves, relative to a prefix.
 *
 * `rows` is an array and therefore one leaf, and it is `sensitive-hr`/`count`
 * rather than open: the classified rows restate a person's whole employment
 * history with department and title per row, and "how many rows" is the fact a
 * receipt owes. `unreadableCells` is likewise one array leaf — it names CELLS,
 * not people, but it is only meaningful beside the rows it describes.
 */
function jobClassificationLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => (prefix.length === 0 ? path : `${prefix}.${path}`);
  return [
    ...open(scope, at("disposition"), at("rowCount"), at("activeRowCount"),
      at("inactiveRowCount"), at("unknownRowCount"), at("unreadableCells")),
    ...population(scope, at("rows")),
  ];
}

/**
 * The identity decision packet's leaves.
 *
 * Names and EIDs are the person; the tiers, the shape, the disposition and the
 * comparison table describe the DECISION. `comparisons` is an array leaf whose
 * members restate the two names verbatim, so it is `sensitive-hr` with a count —
 * a receipt says "four fields were compared, two disagreed" through the counts
 * around it rather than reprinting both people's names.
 */
/**
 * The gate packet's WRITE PLAN block — both arms, because which one a run takes
 * is decided by the descriptor and a receipt may not depend on that choice to be
 * classifiable (the same rule the gate's own two arms follow).
 *
 * Nothing in it is a person. A template, a reason code, an empl record, a
 * department option, a payroll title, a date and a comment text all describe the
 * TRANSACTION being filed — which is chunk 4's call for `initiatorComments` and
 * chunk 5's for the ten finalization fields, applied to the block that shows an
 * operator what those two writes are about to consume. The one name in it, the
 * timekeeper, is a `direct-identifier` here for the reason the module header
 * gives: `src/domain/secrets.ts` already classifies `TIMEKEEPER_NAME` that way,
 * and one field cannot carry two classifications.
 */
function writePlanLeaves(scope: EvidenceValueScope, prefix: string): unknown[] {
  const at = (path: string): string => `${prefix}.${path}`;
  return [
    ...person(scope, at("document.timekeeperName")),
    ...open(scope, at("document.timekeeperName.kind"), at("document.timekeeperName.name"),
      at("document.timekeeperName.inputPath"), at("document.timekeeperName.valueId")),
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

/**
 * The reconciled dates, relative to a prefix. Dates, flags and pay-code names
 * describe the TRANSACTION being filed; the comment texts are what will be
 * typed into UCPath and Kuali, which is the same call chunk 4 makes for
 * `initiatorComments`.
 */
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

export const EVIDENCE_FIELD_CLASSIFICATIONS: readonly EvidenceFieldClassification[] = Object.freeze([
  /* person-lookup ingress */
  ...person(PERSON_LOOKUP_INPUT, "name", "emplId"),
  ...open(PERSON_LOOKUP_INPUT, "keepNonHdh", "includeCrmDates"),

  /* ucpath/search-person-org — every arm of the selection union, not only the
     one the contract example happens to show. `selection.selected` is declared
     twice over: as a leaf (the `null` of the ambiguous/not-found arms) and as
     the object whose fields the resolved arm carries. */
  ...population(SEARCH, "results", "selection.candidateEids"),
  ...person(SEARCH, "selection.selected.emplId", "selection.selected.name", "selection.searchName"),
  ...open(SEARCH, "selection.status", "selection.selected", "selection.selected.department",
    "selection.selected.jobTitle", "selection.selected.employeeStatus", "selection.selected.hdh"),

  /* crm/read-onboarding-record */
  ...person(CRM_RECORD, "record.emplId", "record.fullName", "queriedEid"),
  ...open(CRM_RECORD, "state", "record.recordId", "record.rawStage", "reason"),

  /* crm/read-onboarding-dates */
  ...person(CRM_DATES, "emplId"),
  ...open(CRM_DATES, "invitedOn.state", "invitedOn.value", "invitedOn.reason",
    "startsOn.state", "startsOn.value", "startsOn.reason",
    "completedOn.state", "completedOn.value", "completedOn.reason"),

  /* workflow:person-lookup/read-active-status */
  ...open(ACTIVE_STATUS, "state", "reason", "hdh"),

  /* person-lookup terminal result */
  ...open(PERSON_LOOKUP_RESULT, "activeStatus.state", "activeStatus.reason", "activeStatus.hdh",
    "crmDates.state", "crmDates.dates.invitedOn.state", "crmDates.dates.invitedOn.value",
    "crmDates.dates.invitedOn.reason", "crmDates.dates.startsOn.state",
    "crmDates.dates.startsOn.value", "crmDates.dates.startsOn.reason",
    "crmDates.dates.completedOn.state", "crmDates.dates.completedOn.value",
    "crmDates.dates.completedOn.reason"),
  ...person(PERSON_LOOKUP_RESULT, "crmDates.dates.emplId"),

  /* separations-kronos-timecard ingress. The window bounds are dates ABOUT the
     read, not about the person, so they are open; the EID and the expected
     name are the person. */
  ...person(KRONOS_TIMECARD_INPUT, "emplId", "expectedName"),
  ...open(KRONOS_TIMECARD_INPUT, "rangeStart", "rangeEnd", "searchTimeoutMs"),

  /* new-kronos/search-employee. `candidates` is a LIST OF PEOPLE — "twelve rows
     matched" is the fact that decides whether the search was unambiguous, and
     it is answerable without naming anyone who was not selected. */
  ...person(KRONOS_SEARCH, "query", "matched.displayName", "matched.employeeId"),
  ...population(KRONOS_SEARCH, "candidates"),
  ...open(KRONOS_SEARCH, "totalCount", "selectedCount", "panelContext"),

  /* new-kronos/read-separation-timecard. Every date, count and label describes
     the TRANSACTION; only the two identities and the displayed name are the
     person. `payCodeDays` and the date arrays are arrays, hence single leaves. */
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

  /* kuali/search-separation-action — D261's Action-List resolve. Every leaf
     describes the ADDRESS of a document, never a person: a document number, a
     workflow-step id, the link it was read from, and how many links carried it.
     Nothing here is about the employee, which is exactly why the resolve can
     run before the identity gate has anything to show. */
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

  /* separations-identity-check ingress (chunk 3). The document's name and both
     EIDs are the PERSON; the document number, the source fork and the absent
     arm's own reason describe the READ. D197's rule applies verbatim: an arm
     DISCRIMINATOR is not the person, so `documentEid.state`/`.reason` are open
     and only `documentEid.value` is an identifier. */
  ...person(IDENTITY_CHECK_INPUT, "employeeName", "emplId", "documentEid.value"),
  ...open(IDENTITY_CHECK_INPUT, "documentNumber", "emplIdSource", "documentEid.state",
    "documentEid.reason"),

  /* ucpath/read-job-summary — D194's whole-grid read. `jobRows` is an ARRAY and
     therefore one leaf; it carries a person's whole employment history, so it is
     `sensitive-hr` with a count rather than a redacted dump. Everything else on
     the read describes the PAGE VISIT. */
  ...person(JOB_SUMMARY, "emplId", "displayedName"),
  ...population(JOB_SUMMARY, "jobRows"),
  ...open(JOB_SUMMARY, "pageStateId", "rowCount", "observedAt",
    "renderContext.entry", "renderContext.searchResultRows",
    "renderContext.employmentInstances"),

  /* workflow:separations/match-identity — the gate's decision packet. */
  ...identityPacketLeaves(MATCH_IDENTITY, "packet"),
  ...open(MATCH_IDENTITY, "evidenceDigest"),

  /* workflow:separations/verify-identity-approval — the run's whole product,
     carried forward past the gate so the terminal result has no pre-gate
     ancestry (ref write-safety §14.6 #2). */
  ...open(VERIFY_IDENTITY_APPROVAL, "documentNumber"),
  ...approvedSubjectLeaves(VERIFY_IDENTITY_APPROVAL, "approved"),
  ...jobClassificationLeaves(VERIFY_IDENTITY_APPROVAL, "jobs"),

  /* separations-identity-check / identity-approval — the name-only gate's stored
     operator decision (D204). Both arms of `IdentityApprovalResultSchema` are
     declared, because which arm a run took is decided at the gate and a receipt
     may not depend on that choice to be classifiable.

     `eid` is the approved person and takes `last4` like every other identifier
     here. Everything else describes the DECISION — which arm, where the EID was
     chosen from, the digest of the exact packet the approver was looking at, and
     the operator's own rejection reason — and a receipt whose whole job is to
     show the human in the loop cannot redact the human's reasoning out of it. */
  ...person(IDENTITY_APPROVAL_GATE, "eid"),
  ...open(IDENTITY_APPROVAL_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

  /* separations-identity-check terminal result */
  ...open(IDENTITY_CHECK_RESULT, "documentNumber"),
  ...approvedSubjectLeaves(IDENTITY_CHECK_RESULT, "approved"),
  ...jobClassificationLeaves(IDENTITY_CHECK_RESULT, "jobs"),

  /* separations-ucpath-termination ingress (chunk 4). The identity half repeats
     chunk 3's split verbatim — an arm DISCRIMINATOR is not the person — and the
     termination half is all transaction facts: the dates, the empl record and
     the comment text describe WHAT is being filed, not WHO. */
  ...person(UCPATH_TERMINATION_INPUT, "employeeName", "emplId", "documentEid.value"),
  ...open(UCPATH_TERMINATION_INPUT, "documentNumber", "emplIdSource", "documentEid.state",
    "documentEid.reason", "terminationType.state", "terminationType.value",
    "terminationType.reason", "observedTerminationTypeOptions", "emplRecord",
    "effectiveDate", "lastDateWorked", "initiatorComments"),

  /* The conditional name-only gate again, on this workflow's own scope. Its redaction is
     scoped by `(workflow, gate)` (D204), so chunk 3's declaration does not
     cover chunk 4's gate even though the payload schema is identical — which is
     the point: a second workflow must state its own answer. */
  ...person(UCPATH_TERMINATION_GATE, "eid"),
  ...open(UCPATH_TERMINATION_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

  /* ucpath/stage-termination — the staged wizard. `observedName` is UCPath's own
     answer to the typed EID and is therefore the PERSON; the reason-option list
     is a control capture (§3.2) and is one leaf. */
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
  ...filingPresenceLeaves(UCPATH_FILING_PRESENCE),

  /* separations-ucpath-termination terminal result */
  ...open(UCPATH_TERMINATION_RESULT, "documentNumber", "pendingSweep.disposition",
    "termination.disposition"),
  ...approvedSubjectLeaves(UCPATH_TERMINATION_RESULT, "approved"),
  ...sweepProofLeaves(UCPATH_TERMINATION_RESULT, "pendingSweep.proof"),
  ...terminationProofLeaves(UCPATH_TERMINATION_RESULT, "termination.proof"),

  /* separations-kuali-finalization ingress (chunk 5). The identity half repeats
     chunk 3's split verbatim; the timekeeper is a person like every other name.
     The dept id and the department description are UNIT facts, not person facts,
     and the two comment fields describe what is being recorded — the same call
     chunk 4 makes for `initiatorComments`. */
  ...person(KUALI_FINALIZATION_INPUT, "employeeName", "emplId", "documentEid.value",
    "timekeeperName"),
  ...open(KUALI_FINALIZATION_INPUT, "actionId", "documentNumber", "emplIdSource",
    "documentEid.state", "documentEid.reason", "ucpathDeptId.state", "ucpathDeptId.value",
    "ucpathDeptId.reason", "ucpathDepartment.state", "ucpathDepartment.value",
    "ucpathDepartment.reason", "observedDepartmentOptions", "payrollTitleCode", "payrollTitle",
    "lastDayWorked", "separationDate", "terminationEffectiveDate", "transactionNumber",
    "transactionApprovalStatus",
    "timekeeperComments", "observedExistingComments"),

  /* The conditional name-only gate on this workflow's own scope (D204). */
  ...person(KUALI_FINALIZATION_GATE, "eid"),
  ...open(KUALI_FINALIZATION_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

  /* workflow:separations/match-department-option — S55's upstream fold. Both
     spellings of the department are carried because the operator compares them;
     nothing here is a person. */
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

  /* separations ingress (chunk 6, the composition). One typed document number,
     one action id, the timekeeper who files it, the search bound, and the
     operator's explicit re-read — a document and a decision, not a person,
     except the timekeeper's own name. */
  ...person(SEPARATIONS_INPUT, "timekeeperName"),
  ...open(SEPARATIONS_INPUT, "documentNumber", "searchTimeoutMs",
    "reRead.ordinal", "reRead.reason"),

  /* The conditional name-only gate on the composition's own scope (D204) — and
     here it dominates three real writes across two systems. */
  ...person(SEPARATIONS_GATE, "eid"),
  ...open(SEPARATIONS_GATE, "decision", "chosenFrom", "evidenceDigest", "reason"),

  /* workflow:separations/read-separation-plan — the document's own facts,
     validated. The employee name is the PERSON; the dates, the window and the
     as-of day describe the read. */
  ...person(SEPARATION_PLAN, "employeeName"),
  ...open(SEPARATION_PLAN, "documentNumber", "kualiLastDayWorked", "kualiSeparationDate",
    "asOfDate", "timecardWindow.start", "timecardWindow.end"),

  /* workflow:separations/match-separation-subject — S18/S19's fork. The EID and
     the searched name are the person; WHERE the EID came from and how many
     candidates the search resolved describe the decision, and ref write-safety §14.4
     calls the count decisive. */
  ...person(SEPARATION_SUBJECT, "emplId", "searchedName"),
  ...open(SEPARATION_SUBJECT, "emplIdSource", "candidateCount"),

  /* workflow:separations/match-active-employment — one employment row. Nothing
     here is a person: an empl record, an HR status, a business unit, a title
     and a department describe the APPOINTMENT being ended. */
  ...open(ACTIVE_EMPLOYMENT, "rowIndex", "emplRecord", "hrStatus", "businessUnit",
    "deptId.state", "deptId.value", "deptId.reason",
    "department.state", "department.value", "department.reason",
    "payrollTitleCode", "payrollTitle",
    "effectiveDate.state", "effectiveDate.value", "effectiveDate.reason", "rowCount"),

  /* workflow:separations/read-separation-dates — the write's payload. */
  ...reconciledDateLeaves(SEPARATION_DATES, ""),

  /* workflow:separations/verify-termination-receipt — D130's pair, checked. */
  ...terminationReceiptLeaves(TERMINATION_RECEIPT, ""),

  /* separations terminal result — the whole composition's product. */
  ...open(SEPARATIONS_RESULT, "documentNumber", "employment.emplRecord",
    "employment.payrollTitleCode", "employment.payrollTitle",
    "department.option", "department.departmentCode",
    "dates.kualiLastDayWorked", "dates.lastDayWorked", "dates.kualiSeparationDate",
    "dates.separationDate", "dates.terminationEffectiveDate",
    "dates.lastDayWorkedChanged", "dates.separationDateChanged",
    "pendingSweep.disposition", "finalization.disposition",
    // D307 — the omitted arm of a write step: a closed state and the step key.
    "pendingSweep.state", "pendingSweep.step", "finalization.state", "finalization.step"),
  ...approvedSubjectLeaves(SEPARATIONS_RESULT, "approved"),
  ...sweepProofLeaves(SEPARATIONS_RESULT, "pendingSweep.proof"),
  ...terminationReceiptLeaves(SEPARATIONS_RESULT, "termination"),
  ...savedFinalizationLeaves(SEPARATIONS_RESULT, "finalization.proof"),

  /*
   * Completion proofs, per commit contract (Track F, ledger 2 D16–D22).
   *
   * The receipt's action entry carries the completion proof's leaves beside
   * the write it proves, and each leaf goes through THIS table — the same
   * shapes already declared where the proof rides a task output or a terminal
   * result, restated on the `write-proof` scope so the action entry cannot
   * borrow a table that was declared for a different surface. The shape
   * helpers are shared, which is what keeps the copies from drifting.
   */
  ...terminationProofLeaves(writeProof("ucpath/create-termination"), ""),
  ...sweepProofLeaves(writeProof("ucpath/delete-pending-terminations"), ""),
  ...savedFinalizationLeaves(writeProof("kuali/save-separation-finalization"), ""),

  /*
   * The executor's own fixture contracts (D270).
   *
   * These six paths are NOT in `AdmittedExtractionSchema`, which is what
   * `ocr/extract-form-page` really outputs. They are the test-local shapes the
   * executor's fixture contracts borrow that id with — and they borrow it for a
   * structural reason rather than convenience: `interpret` resolves every task
   * node's impl fingerprint through `resolveTaskImplFingerprint`, which fails
   * loud on an id the generated build manifest does not carry, so a fixture
   * that composes a real run MUST name a manifest-known task.
   *
   * They are DECLARED rather than exempted. D270 emits every recorded point on
   * the span redacted by declaration and refuses an undeclared leaf by name; a
   * fixture bypass would mean that refusal is never exercised by a composed
   * run, and the executor's fixtures are the only composed runs the unit lane
   * has. `subject` and `eid` are person identifiers and carry the same
   * `last4` the rest of this table gives one, so a fixture cannot be the
   * surface that proves a raw identifier reaches a stream.
   *
   * `ocr/extract-form-page`'s own output leaves are deliberately still absent:
   * the task is wired into no descriptor, so no run can reach it, and its
   * recordData names two fields (`pageFingerprint`, `hasRecord`) that the
   * contract's output does not carry — declaring a shape nobody has validated
   * would be a guess. `reference/operator-trust.md` §2.3.2 owns the list.
   */
  ...person(OCR_FORM_PAGE, "subject", "eid"),
  ...open(OCR_FORM_PAGE, "disposition", "providerState", "artifactSha", "artifactBytes"),

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

/**
 * Every leaf of a JSON value, by the provenance collector's rule: an array is
 * a leaf, an empty object is a leaf, a populated object recurses.
 *
 * Keys are visited in SORTED order, which is what makes a receipt a pure
 * function of authority rather than of how a value happened to be built. A
 * stored record round-trips through `canonicalJsonStringify` (sorted keys)
 * while an in-memory value keeps its authored key order; walking insertion
 * order would emit the same facts in two different orders — and therefore two
 * byte-different receipts — for one run.
 */
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
    throw new Error(
      `no declared evidence classification for ${evidenceScopeKey(scope)} field "${path}"; `
      + "add it to src/domain/trust/evidence-classification.ts — neither a receipt nor an "
      + "observed log ever drops a leaf silently",
    );
  }
  return entry;
}

/**
 * Redact one leaf through the ONE shared transform implementation. The produced
 * field's `key` is widened from the leaf name to its full path, which
 * `RedactedFieldSchema` accepts and `ClassifiedDiagnosticValueSchema` does not
 * — the classified INPUT is per-field, the redacted OUTPUT names where it sat.
 */
export function redactEvidenceLeaf(
  scope: EvidenceValueScope,
  leaf: EvidenceLeaf,
): z.infer<typeof RedactedFieldSchema> {
  const declared = classifyEvidenceLeaf(scope, leaf.path);
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

/** Immutable receipt compositions 1–4 retain their exact original value representation. */
export function historicalReceiptEvidenceLeaf(
  scope: EvidenceValueScope,
  leaf: EvidenceLeaf,
): z.infer<typeof RedactedFieldSchema> {
  const declared = classifyEvidenceLeaf(scope, leaf.path);
  return RedactedFieldSchema.parse({
    key: leaf.path,
    ...redactHistoricalValue(declared.classification, declared.transform, leaf.value),
    rawValue: leaf.value,
  });
}
