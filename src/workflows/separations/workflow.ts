import type { AuthoredExplorerPart as Part, FlowField, WorkflowExplorerPreview } from "../../models/workflow/explorer-preview.js";
import { z } from "zod";
import {
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../models/ui/kuali-document-identity.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { SeparationsMatchIdentity } from "../../models/workflows/separations/match-identity.js";
import { SeparationsResultSchema } from "../../models/workflows/separations/result.js";
import { EID_PATTERN, EidSchema } from "../../rules/identity/ids.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { APPROVAL_NODE, DEPARTMENT_NODE, EMPLOYMENT_NODE, JOB_SUMMARY_NODE, separationsIdentityCheckDefinition } from "./steps/identity-check/step.js";
import { DATES_NODE, separationsKronosTimecardDefinition } from "./steps/kronos-timecard/step.js";
import { ACTION_NODE, TERMINATION_TYPE_NODE, separationsKualiReadDefinition } from "./steps/kuali-extraction/step.js";
import { FINALIZE_NODE, KUALI_FINALIZATION_STEP, separationsKualiFinalizationDefinition } from "./steps/kuali-finalization/step.js";
import { RECEIPT_NODE, SWEEP_NODE, TERMINATION_NODE, UCPATH_TRANSACTION_STEP, separationsUcpathTerminationDefinition } from "./steps/ucpath-transaction/step.js";
export { KRONOS_TIMECARD_OMISSION } from "./steps/kronos-timecard/step.js";
export { KUALI_FINALIZATION_OMISSION } from "./steps/kuali-finalization/step.js";
export { UCPATH_TRANSACTION_OMISSION } from "./steps/ucpath-transaction/step.js";
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;

const SeparationReReadSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(99),
  reason: z.string().min(1).max(200),
});

const SeparationsInputShape = {
  operatorEmployeeId: EidSchema.optional(),
  documentNumber: KualiDocumentNumberSchema,
  timekeeperName: KualiTimekeeperNameSchema,
} as const;

export const SeparationsInput = z.strictObject({
  ...SeparationsInputShape,
  searchTimeoutMs: z.number().int().positive().max(120_000).default(SEARCH_TIMEOUT_DEFAULT_MS),
  reRead: SeparationReReadSchema.optional(),
});

export const SeparationsCanonicalInput = defineCanonicalInput(
  SeparationsInput,
  z.strictObject({
    ...SeparationsInputShape,
    searchTimeoutMs: z.number().int().positive().max(120_000),
    reRead: SeparationReReadSchema.optional(),
  }),
  [
    {
      documentNumber: "4510",
      timekeeperName: "Synthetic Timekeeper",
    },
    {
      operatorEmployeeId: SeparationsMatchIdentity.example.packet.emplId,
      documentNumber: "4524",
      timekeeperName: "Synthetic Timekeeper",
      searchTimeoutMs: 30_000,
      reRead: { ordinal: 1, reason: "the department corrected the last day worked" },
    },
  ],
);

function omittedOr<T, R>(
  value: T,
  step: string,
  present: (value: T) => R,
): R | Readonly<{ state: "omitted"; step: string }> {
  const widened: T | undefined = value;
  return widened === undefined ? Object.freeze({ state: "omitted" as const, step }) : present(widened);
}


const action = (text: string, icon: "click" | "read" | "verify" | "compute" | "key" | "rejoin" | "stop" = "verify"): Part => ({ kind: "action", text, icon });
const note = (text: string): Part => ({ kind: "note", text });
const rows = (mode: FlowField["mode"], fields: readonly (readonly [string, string, string, string?, FlowField["template"]?])[]): Part => ({ kind: "rows", fields: fields.map(([id, label, value, source, template]) => ({ id, label, value, mode, ...(source ? { source } : {}), ...(template ? { template } : {}) })) });
const form = (id: string, title: string, mode: string, parts: readonly Part[], result?: "pending"): Part => ({ kind: "form", id, title, mode, parts, ...(result ? { result } : {}) });
const branch = (key: string, value: string, parts: readonly Part[]): Part[] => parts.map(part => ({ ...part, when: { [key]: [value] } }));
const stop = (text: string): Part[] => [action(text, "stop"), note("Stop here. No downstream transaction or Kuali save.")];

const read = (system: string, page: string, field: string, step: number, fieldId?: string) => ({ system, page, field, step, ...(fieldId ? { fieldId } : {}) });
const kuali = (field: string, fieldId: string) => read("Kuali", "RRSS Separation Request", field, 3, fieldId);
const job = (field: string, fieldId: string) => read("UCPath", "Workforce Job Summary", field, 8, fieldId);
const chain = (step: number, title: string, detail: string) => ({ step, title, detail });
const dateReads = [kuali("Last day worked · separation date", "dates"), read("Kronos", "Timecard", "Last punch date", 12, "punch"), read("Kronos", "Timecard", "Sick dates · holiday dates", 12, "leave")];
const dateChain = [chain(13, "Reconcile dates", "Combine the request dates with the observed timecard."), chain(16, "Verify approval", "The approved write details bind these dates.")];
const identityReads = [kuali("Employee ID", "employee"), read("UCPath", "Person Organizational Summary", "Matching employee records", 6)];
const identityChain = [chain(7, "Resolve employee", "Match the document ID against the name-search results."), chain(16, "Verify approval", "Use the employee identity bound to the approved write details.")];

const separationsExplorer: WorkflowExplorerPreview = {
  choices: [
    { key: "identity", label: "Identity check", options: [["verified", "Verified"], ["review", "Review"], ["rejected", "Rejected"]] },
    { key: "pending", label: "Read result", options: [["none", "None"], ["some", "Some"], ["unknown", "Unknown"]] },
    { key: "termination", label: "Existing termination", options: [["absent", "Absent"], ["present", "Present"], ["unknown", "Unknown"]] },
  ],
  completion: "Separation filed and Kuali document verified",
  sourceVariants: [{ when: { termination: ["present"] }, sources: {
    receipt: { reads: [read("UCPath", "Existing termination", "Transaction number", 19)], chain: [chain(20, "Verify receipt", "Match employee and effective date to the approved request."), chain(21, "Verify current filing", "Confirm this transaction is still present before Kuali finalization.")] },
  } }],
  steps: [
    { nodes: [], title: "Open browser sessions", parts: [{ kind: "sessions", systems: ["Kuali", "Kronos", "UCPath"] }] },
    { nodes: ["resolve-action"], title: "Find the Kuali action", system: "Kuali", parts: [
      form("action-list", "Action List", "Fill form", [rows("fill", [["document", "Document number", "Run input", "document"]])]), action("Click Go", "click"), action("Read the matching action link", "read"),
    ] },
    { nodes: ["document"], title: "Read the separation document", system: "Kuali", parts: [
      form("request", "RRSS Separation Request", "Read only", [rows("read", [
        ["name", "Employee name", "Separation request"], ["employee", "Employee ID", "Separation request"], ["type", "Employee type · student title code", "Separation request"], ["division", "Division · location", "Separation request"], ["termination", "Termination type", "Separation request"], ["dates", "Last day worked · separation date", "Separation request"], ["comments", "Additional comments", "Separation request"],
      ]), { kind: "detail", id: "request-options", title: "Timekeeper, final transactions & option lists", parts: [rows("read", [
        ["timekeeper", "Request acknowledged · timekeeper name", "Current form values"], ["timekeeper-comments", "Timekeeper comments", "Preserve existing text"], ["effective", "Termination effective date", "Current form value"], ["job", "Department · payroll title code · payroll title", "Current form values"], ["receipt", "Submitted template · transaction number", "Current form values"], ["pay", "Final pay", "Current selection"], ["options", "All dropdown options", "Read available choices"],
      ])] }]), action("Verify document number and form type"),
    ] },
    { nodes: ["plan"], title: "Build the separation plan", system: "Local", parts: [action("Use the request’s employee name and dates to establish the timecard window.", "compute")] },
    { nodes: ["termination-type"], title: "Resolve the termination type", system: "Local", parts: [action("Map the requested termination type to the UCPath template and reason.", "compute")] },
    { nodes: ["name-search"], title: "Search the employee name", system: "UCPath", parts: [form("person", "Person Organizational Summary", "Fill form", [rows("fill", [["name", "Employee name", "Kuali separation request", "name"]])]), action("Read all matching employees", "read")] },
    { nodes: ["subject"], title: "Identify the separation subject", system: "Local", parts: [action("Match the document’s employee ID against the name-search results.", "compute")] },
    { nodes: ["job-summary"], title: "Read Workforce Job Summary", system: "UCPath", parts: [action("Expand employment instances when needed", "click"), form("job-summary", "Workforce Job Summary", "Read only", [rows("read", [
      ["employee", "Employee ID · name", "Displayed employee"], ["record", "Employee record", "Each employment row"], ["status", "HR status · effective date", "Each employment row"], ["position", "Business unit · position number", "Each employment row"], ["department", "Department ID · department", "Each employment row"], ["title", "Job code · job title", "Each employment row"], ["end", "Expected job end date", "Each employment row"], ["class", "FTE · employee class", "Each employment row"],
    ])])] },
    { nodes: ["employment"], title: "Resolve active employment", system: "Local", parts: [action("Select the active employment record. Stop if no single valid record can be established.", "compute")] },
    { nodes: ["department-option"], title: "Match the department option", system: "Local", parts: [action("Match the UCPath department to an option read from this Kuali document.", "compute")] },
    { nodes: ["timecard-search"], title: "Find the employee timecard", system: "Kronos", parts: [form("employee-search", "Employee search", "Fill form", [rows("fill", [["employee", "Employee ID", "Resolved separation subject", "identity-before-approval"]])]), action("Select the matching employee", "click")] },
    { nodes: ["timecard"], title: "Read the timecard", system: "Kronos", parts: [action("Open Go To → Timecard", "click"), form("range", "Timecard range", "Fill form", [rows("fill", [["range", "Start date · end date", "Separation plan", "window"]])]), form("timecard", "Timecard", "Read only", [rows("read", [["displayed-range", "Displayed date range", "Verify requested window"], ["punch", "Punches · last punch date", "Timecard grid"], ["leave", "Sick dates · holiday dates", "Timecard grid"], ["codes", "Other pay codes", "Timecard grid"]])])] },
    { nodes: ["dates"], title: "Reconcile the dates", system: "Local", parts: [rows("compute", [["last-worked", "Last day worked", "Request + last punch"], ["separation", "Separation date", "Request + leave dates"], ["effective", "Termination effective date", "Reconciled separation date"]])] },
    { nodes: ["comparison"], title: "Compare identity and write details", system: "Local", parts: [action("Bind the employee, employment, dates and proposed writes to the approval evidence.", "compute")] },
    { nodes: ["identity-approval"], title: "Resolve identity approval", system: "You", stopWhen: { identity: ["rejected"] }, parts: [
      { kind: "choice", choice: "identity" }, ...branch("identity", "verified", [action("Identity verified against the supplied employee ID.")]), ...branch("identity", "review", [action("Pause for operator review. Resume this path after approval."), note("Sessions close while waiting; reacquire and authenticate on resume.")]), ...branch("identity", "rejected", stop("Identity approval rejected")),
    ] },
    { nodes: ["approval"], title: "Verify the approval", system: "Local", parts: [action("Verify that the approval still matches the employee and proposed writes.", "compute")] },
    { nodes: ["pending-set"], title: "Read pending terminations", system: "UCPath", parts: [form("pending", "Transactions in Progress", "Read only", [rows("read", [["employee", "Employee ID · name", "Approved identity"], ["pending", "Pending termination rows", "Exact observed set"], ["transactions", "Transaction IDs · effective dates", "Each pending row"]])], "pending")] },
    { nodes: ["clear-pending"], title: "Clear pending terminations", system: "UCPath", stopWhen: { pending: ["unknown"] }, parts: [
      ...branch("pending", "none", [action("No pending terminations to delete."), action("Continue to the existing-termination check", "rejoin")]),
      ...branch("pending", "some", [action("Verify the exact pending set has not changed"), action("Select only the observed pending termination rows", "click"), action("Click Delete", "click"), action("Verify that the selected terminations were cleared"), action("Continue to the existing-termination check", "rejoin")]), ...branch("pending", "unknown", stop("Pending terminations could not be verified")),
    ] },
    { nodes: ["file-termination"], title: "File the termination", system: "UCPath", stopWhen: { termination: ["unknown"] }, parts: [
      { kind: "choice", choice: "termination" }, note("Match the approved employee and effective date in UCPath."),
      ...branch("termination", "absent", [
        form("template", "Smart HR · Template", "Fill form", [rows("fill", [["template", "Template", "Resolved termination type", "type"], ["transaction-date", "Transaction date", "Termination effective date", "dates"]])]), action("Click Create Transaction", "click"),
        form("transaction", "Smart HR · Transaction details", "Continue", [rows("fill", [["employee", "Employee ID", "Approved identity", "identity"]]), action("Press Tab to resolve employee", "key"), rows("read", [["employee-record", "Employee name · employee record", "Verify approved identity"], ["job-date", "Job effective date", "Verify transaction date"]]), rows("fill", [["reason", "Action reason", "Resolved reason code", "type"]])]), action("Click Continue", "click"),
        form("employment", "Smart HR · Employment information", "Continue", [rows("fill", [["override", "Override last date worked", "Checked", "override"], ["last-worked", "Last date worked", "Reconciled date", "dates"], ["initiator-comments", "Initiator comments", "Reconciled date explanation", "comments", "ucpath"], ["transaction-comments", "Transaction comments", "Same explanation", "comments", "duplicate"]])]),
        action("Read back all staged values"), action("Click Save and Submit", "click"), action("Verify the transaction number and receipt"), action("Continue with the newly filed receipt", "rejoin"),
      ]),
      ...branch("termination", "present", [action("Read the matching transaction number and receipt", "read"), action("Verify employee, effective date and transaction proof"), action("Reuse this receipt · continue at step 20", "rejoin")]), ...branch("termination", "unknown", stop("The existing-termination check is inconclusive")),
    ] },
    { nodes: ["receipt"], title: "Verify the termination receipt", system: "Local", parts: [...branch("termination", "absent", [action("Verify the new receipt against the approved employee and effective date")]), ...branch("termination", "present", [action("Verify the existing receipt against the approved employee and effective date")]), ...branch("termination", "unknown", [action("Verify the new receipt against the approved employee and effective date")])] },
    { nodes: ["filing-presence"], title: "Verify the current UCPath filing", system: "UCPath", parts: [action("Find the exact transaction and verify it is still present")] },
    { nodes: ["finalize-kuali"], title: "Finalize the Kuali document", system: "Kuali", parts: [action("Check whether this exact finalization is already saved"), note("Already saved: verify the current values and finish. Otherwise:"), form("finalize", "RRSS Separation Request", "Continue", [
      { kind: "resume", step: 3, text: "Same form · opened in step 3" }, rows("fill", [["department", "Department", "Matched department option", "department"], ["title", "Payroll title code · payroll title", "Workforce Job Summary", "title"], ["acknowledged", "Request acknowledged", "Checked", "acknowledged"], ["timekeeper", "Timekeeper name", "Configured timekeeper", "timekeeper"], ["dates", "Last day worked · separation date", "Reconciled dates", "dates"], ["effective", "Termination effective date", "Verified receipt date", "effective"], ["submitted", "Termination template submitted", "Checked", "submitted"], ["transaction", "Transaction number", "Verified UCPath receipt", "receipt"], ["pay", "Final pay", "Workflow rule", "pay"], ["comments", "Timekeeper comments", "Existing comments + filing details", "timekeeper-comments", "kuali"]]),
    ]), action("Verify every staged field and preserve existing comments"), action("Click Save", "click"), action("Reload and verify the saved document")] },
  ],
  sources: {
    document: { origin: "Run input", detail: "The document number provided when this run is started." },
    name: { reads: [kuali("Employee name", "name")], chain: [chain(4, "Build separation plan", "Use the name read from this request.")] },
    identity: { reads: identityReads, chain: identityChain },
    "identity-before-approval": { reads: identityReads, chain: identityChain.slice(0, 1) },
    dates: { reads: dateReads, chain: dateChain },
    window: { reads: [kuali("Last day worked · separation date", "dates")], chain: [chain(4, "Build timecard window", "Derive the window from the request dates and document observation time.")] },
    type: { reads: [kuali("Termination type", "termination")], chain: [chain(5, "Resolve termination type", "Map the request to the configured UCPath template and action reason.")] },
    override: { origin: "Workflow rule", detail: "Ensure the override is checked before entering the reconciled last date worked." },
    comments: { reads: dateReads, chain: [chain(13, "Build termination comments", "Explain the reconciled dates using the request and timecard evidence. Both UCPath comment fields receive identical text.")] },
    department: { reads: [job("Department ID · department", "department"), kuali("Department option list", "options")], chain: [chain(9, "Resolve active employment", "Choose the department from the selected employment record."), chain(10, "Match the Kuali option", "Resolve that department against options read from this document.")] },
    title: { reads: [job("Job code · job title", "title")], chain: [chain(9, "Resolve active employment", "Take the code and title from the selected employment record.")] },
    acknowledged: { origin: "Workflow rule", detail: "Set the request acknowledgement to checked during Kuali finalization." },
    timekeeper: { origin: "Signed-in profile", detail: "The timekeeper name is the admitted profile display name. Initials use the first letter of each word. Protected values remain hidden unless the application permits them." },
    submitted: { origin: "Verified filing", detail: "Set to checked only after the UCPath filing receipt has been verified.", reads: [read("UCPath", "Termination receipt", "Verified filing", 20)] },
    pay: { origin: "Workflow rule", detail: "Select “Does not need final pay (student)”. This is a declared constant, not a field read from a page." },
    "timekeeper-comments": { reads: [kuali("Existing timekeeper comments", "timekeeper-comments")], chain: [chain(13, "Reconcile dates", "Compose the date explanation with the configured timekeeper."), chain(20, "Verify filing receipt", "Include the filing details."), chain(22, "Append finalization comments", "Preserve the originally read comments; refuse if the current text changed.")] },
    receipt: { reads: [read("UCPath", "New termination receipt", "Transaction number", 19)], chain: [chain(20, "Verify receipt", "Match employee and effective date to the approved request."), chain(21, "Verify current filing", "Confirm this transaction is still present before Kuali finalization.")] },
    effective: { reads: dateReads, chain: [...dateChain, chain(20, "Verify receipt date", "The receipt must match the approved effective date.")] },
  },
};

export const separationsWorkflow = defineWorkflow({
  id: "separations",
  explorerPreview: separationsExplorer,
  requiredWorkbookTypeIds: [],
  version: 1,
  code: "sp",
  label: "Separations",
  summary: "The composition: ONE Kuali RRSS separation document becomes ONE terminated employee across three "
    + "systems. It reads Kuali, UCPath and Kronos, reconciles the dates against what the timecard "
    + "actually shows, establishes identity from supplied-EID read-back or the name-only gate, then clears any pending termination, "
    + "files the termination, verifies the receipt, and finalizes the Kuali document.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsCanonicalInput,
  failureCorrections: [{
    nodeId: JOB_SUMMARY_NODE, code: "employee-not-found", inputField: "operatorEmployeeId",
    label: "Employee ID", actionLabel: "Enter EID", pattern: EID_PATTERN.source
  },
  {
    nodeId: ACTION_NODE, code: "document-not-in-action-list", inputField: "documentNumber",
    label: "Document number", actionLabel: "Enter document number", pattern: z.toJSONSchema(KualiDocumentNumberSchema).pattern
  }],
  rerunValues: [
    { nodeId: DATES_NODE, fieldPath: "lastDayWorked", label: "Last day worked", targetStepKey: "kronos-timecard", targetFieldPath: "lastDayWorked" },
    { nodeId: DATES_NODE, fieldPath: "separationDate", label: "Separation date", targetStepKey: "kronos-timecard", targetFieldPath: "separationDate" },
    { nodeId: RECEIPT_NODE, fieldPath: "transactionNumber", label: "UCPath transaction number", targetStepKey: "ucpath-transaction", targetFieldPath: "transactionNumber" },
    { nodeId: RECEIPT_NODE, fieldPath: "approvalStatus", label: "Approval status", targetStepKey: "ucpath-transaction", targetFieldPath: "approvalStatus" },
  ],
  protectedInputs: [{ inputPath: "timekeeperName", name: "timekeeperName" }],
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {
    inputRun: {
      placeholder: "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [
          { when: { kind: "pattern", pattern: "document-number" }, emit: "documentNumber" },
        ],
      },
      examples: [
        {
          key: "one-document",
          label: "One document",
          text: "4502",
          note: "the ordinary case — one run for one Kuali separation document",
        },
        {
          key: "two-documents",
          label: "Two documents",
          text: "4502; 4510",
          note: "two runs from one box: each document number starts its own separation, and the "
            + "action id for each is resolved from the Kuali Action List at run time",
        },
      ],
    },
  },
  verdicts: [
    { key: "name-differs", label: "Name differs from UCPath", tone: "warning", tag: true },
    { key: "eid-name-resolved", label: "EID resolved by name", tone: "warning", tag: true },
    { key: "dates-moved", label: "Kronos moved the dates", tone: "neutral", tag: true },
    { key: "unclassified-pay-codes", label: "Unclassified pay codes", tone: "warning", tag: true },
  ],
  details: [
    {
      key: "ucpath-name",
      label: "UCPath shows",
      source: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName" },
      display: "text",
    },
    {
      key: "template",
      label: "Template",
      source: { nodeId: TERMINATION_TYPE_NODE, fieldPath: "template" },
      display: "text",
    },
    {
      key: "reason-code",
      label: "Reason code",
      source: { nodeId: TERMINATION_TYPE_NODE, fieldPath: "reasonCode" },
      display: "text",
    },
    {
      key: "last-day-worked",
      label: "Last day worked",
      source: { nodeId: DATES_NODE, fieldPath: "lastDayWorked" },
      display: "text",
    },
    {
      key: "effective-date",
      label: "Termination effective",
      source: { nodeId: DATES_NODE, fieldPath: "terminationEffectiveDate" },
      display: "text",
    },
    {
      key: "department",
      label: "Department",
      source: { nodeId: DEPARTMENT_NODE, fieldPath: "option" },
      display: "text",
    },
    {
      key: "transaction-id",
      label: "Transaction",
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.transactionId" },
      display: "text",
    },
    {
      key: "approval-status",
      label: "Transaction status",
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.approvalStatus" },
      display: "text",
    },
  ],
  subjectProjection: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName", eidFieldPath: "emplId" },
  identity: {
    matchKey: (input) => (input.reRead === undefined
      ? `separations:${input.documentNumber}`
      : `separations:${input.documentNumber}#re-read-${String(input.reRead.ordinal)}`),
  },
  presentation: {
    title: (input) => `Separation ${input.documentNumber}`,
    subtitle: (input) => (input.reRead === undefined
      ? undefined
      : `re-read ${String(input.reRead.ordinal)} — ${input.reRead.reason}`),
  },
  nodePurposes: [
    {
      nodeId: "resolve-action",
      purpose: "Turns the Kuali document number the operator typed into the action id Kuali is actually "
        + "addressed by, by filtering the Action List's own search box and reading the matched row's link. "
        + "It refuses a document nobody holds an action on, and refuses two actions for one number.",
    },
    {
      nodeId: "document",
      purpose: "Reads the entire Kuali RRSS separation request form in ONE page visit: the employee, the "
        + "separation dates, the comments, and every control's own option list as this run observed it.",
    },
    {
      nodeId: "termination-type",
      purpose: "Resolves the document's termination type to the UCPath template and reason code it files under, "
        + "refusing a type nobody has mapped. Pure: it reaches no browser.",
    },
    {
      nodeId: "name-search",
      purpose: "Searches UCPath Person Org by the document's employee name, unconditionally, so the operator "
        + "sees every person that name matches rather than only the ones a similarity threshold selected.",
    },
    {
      nodeId: "job-summary",
      purpose: "Reads the subject's whole UCPath job summary grid verbatim — every row, every status — and "
        + "classifies nothing; the disposition is a separate, pure fold.",
    },
    {
      nodeId: "department-option",
      purpose: "Resolves the subject's UCPath department to the exact option this document's OWN control offers, "
        + "refusing one the control does not carry. Pure: it reaches no browser.",
    },
    {
      nodeId: "comparison",
      purpose: "Builds the identity evidence packet — DISCONFIRMING evidence first — and the digest that "
        + "machine verification or an operator decision binds to. Pure: it reaches no browser.",
    },
    {
      nodeId: "identity-approval",
      purpose: "Requires the typed operator resolve-gate command when the packet's EID came from a name search; "
        + "a supplied-EID packet makes this declared condition false and records no human decision.",
    },
    {
      nodeId: "approval",
      purpose: "Re-derives the evidence and produces explicit machine-verification or operator-approval "
        + "authority. It re-runs on every attempt, so moved evidence or identity origin cannot reuse an old answer.",
    },
    {
      nodeId: "pending-set",
      purpose: "Reads and freezes the exact stable-ID set of eligible pending terminations plus every protected "
        + "transaction before the sweep. The run admission authorizes this machine observation; it is not another gate.",
    },
    {
      nodeId: "clear-pending",
      purpose: "Sweeps any pending termination already sitting on the subject's record, so the filing below is "
        + "not the second one. It probes before it fences, and a dry run stages without submitting.",
    },
    {
      nodeId: "file-termination",
      purpose: "Files the termination through the UCPath Smart HR wizard — the real write. It probes for a "
        + "filing that already exists, fences before the click, and a dry run stages without submitting.",
    },
    {
      nodeId: "finalize-kuali",
      purpose: "Stages every finalization field in ONE pass from the reconciled variables, saves once, and "
        + "proves the save by reloading and comparing each written field against exactly what was staged.",
    },
    {
      nodeId: "plan",
      purpose: "Derives the separation plan from the document — the employee's name, the dates to reconcile, and "
        + "the timecard window to read — as of the instant this run READ the document, never a clock.",
    },
    {
      nodeId: "subject",
      purpose: "Reduces the name-search candidates to the ONE person this separation is about, using the "
        + "document's own EID. A grid it cannot reduce to one row is a run that cannot compute what it is "
        + "about to write, so it refuses before the gate opens.",
    },
    {
      nodeId: "employment",
      purpose: "Folds the job summary into the employment facts the filing needs — empl record, department, "
        + "payroll title — and refuses a subject with no active job.",
    },
    {
      nodeId: "timecard-search",
      purpose: "Searches the New Kronos WFD panel for the employee and leaves them SELECTED — the selection is "
        + "what enables Go To, so this node's real product is browser state and it re-runs on every "
        + "attempt.",
    },
    {
      nodeId: "timecard",
      purpose: "Opens the selected employee's timecard and reads the whole separation window — last punch, sick "
        + "and holiday days, and any pay code nobody has classified — refusing a range it cannot prove the "
        + "grid was showing.",
    },
    {
      nodeId: "dates",
      purpose: "Reconciles the Kuali dates against what the timecard actually shows: the last day worked, the "
        + "separation date, the termination effective date, and the comments that explain any move.",
    },
    {
      nodeId: "receipt",
      purpose: "Checks the receipt the filing produced against the approved subject and the effective date. It "
        + "re-runs on every attempt rather than replaying its own previous answer.",
    },
    {
      nodeId: "filing-presence",
      purpose: "Freshly re-reads the exact UCPath transaction named by the durable receipt and requires its "
        + "subject, effective date, termination action, and acceptable status to survive before Kuali can prepare.",
    },
  ],
  input: SeparationsInput,
  role: defineWorkflowRole({ kind: "composition" }),
  scenarios: [
    "separations/action-resolved",
    "separations/action-not-in-action-list",
    "separations/action-ambiguous",
    "separations/plan-refusals",
    "separations/subject-resolution",
    "separations/employment-refusals",
    "separations/date-reconciliation",
    "separations/receipt-refusals",
    "separations/kronos-hard-fails",
    "separations/gate-approved",
    "separations/dry-run-preview",
    "separations/subject-mismatch",
    "separations/pending-sweep-committed",
    "separations/pending-sweep-nothing-to-do",
    "separations/termination-committed",
    "separations/termination-already-present",
    "separations/finalization-committed",
    "separations/finalization-already-present",
    "separations/finalization-parks-after-termination",
    "separations/re-read-is-a-new-item",
    "separations/gate-resume-shape",
  ],
  steps: author => {
    const { result } = author;
    const extraction = separationsKualiReadDefinition.build(author);
    const resolved = separationsIdentityCheckDefinition.resolveSubject(author, extraction);
    const jobs = separationsIdentityCheckDefinition.readJobs(author, extraction, resolved);
    const timecard = separationsKronosTimecardDefinition.build(author, extraction, resolved);
    const identity = separationsIdentityCheckDefinition.build(author, extraction, resolved, jobs, timecard);
    const termination = separationsUcpathTerminationDefinition.build(author, extraction, jobs, timecard, identity);
    const finalization = separationsKualiFinalizationDefinition.build(author, extraction, jobs, timecard, identity, termination);
    const { approval } = identity, { employment, departmentOption } = jobs, { dates } = timecard;
    const { receipt, clearPending, fileTermination } = termination, { finalizeKuali } = finalization;
    return {
      steps: [...extraction.steps, ...identity.steps, ...timecard.steps, ...termination.steps, ...finalization.steps],
      result: result(
        SeparationsResultSchema,
        [approval, employment, departmentOption, dates, receipt, clearPending, fileTermination, finalizeKuali],
        ({ input, outputs }) => ({
          documentNumber: input.documentNumber,
          approved: outputs[APPROVAL_NODE].approved,
          employment: {
            emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
            payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
            payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
          },
          department: {
            option: outputs[DEPARTMENT_NODE].option,
            departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
          },
          dates: {
            kualiLastDayWorked: outputs[DATES_NODE].kualiLastDayWorked,
            lastDayWorked: outputs[DATES_NODE].lastDayWorked,
            kualiSeparationDate: outputs[DATES_NODE].kualiSeparationDate,
            separationDate: outputs[DATES_NODE].separationDate,
            terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
            lastDayWorkedChanged: outputs[DATES_NODE].lastDayWorkedChanged,
            separationDateChanged: outputs[DATES_NODE].separationDateChanged,
          },
          pendingSweep: omittedOr(outputs[SWEEP_NODE], UCPATH_TRANSACTION_STEP.key, (sweep) => ({
            disposition: sweep.disposition,
            proof: sweep.output.cleared,
          })),
          termination: outputs[RECEIPT_NODE],
          finalization: omittedOr(outputs[FINALIZE_NODE], KUALI_FINALIZATION_STEP.key, (finalize) => ({
            disposition: finalize.disposition,
            proof: finalize.output.savedState,
          })),
        }),
      )
    };
  },
});

export { SeparationsResultSchema } from "../../models/workflows/separations/result.js";
export { COMPARISON_NODE, DEPARTMENT_NODE, GATE_NODE, JOB_SUMMARY_NODE, NAME_SEARCH_NODE } from "./steps/identity-check/step.js";
export { actionNode } from "./steps/kuali-extraction/step.js";
export { FINALIZE_NODE } from "./steps/kuali-finalization/step.js";
