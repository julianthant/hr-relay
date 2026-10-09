import type { FieldSource, FlowField, FlowPart, FlowStep, PreviewScenario } from "./explorer-flow-model.js";

// Presentation fixture transcribed from the approved revision 5 artboard. It has no execution authority.
export const EXPLORER_PREVIEW_TITLE = "Separations";
type Field = readonly [id: string, label: string, value: string, source?: string, template?: FlowField["template"]];
const rows = (mode: FlowField["mode"], fields: readonly Field[]): FlowPart => ({ kind: "rows", fields: fields.map(([id, label, value, source, template]) => ({ id, label, value, mode, source, template })) });
const form = (id: string, title: string, mode: string, parts: readonly FlowPart[], result?: "pending"): FlowPart => ({ kind: "form", id, title, mode, parts, result });
const action = (text: string, icon: Extract<FlowPart, { kind: "action" }>["icon"] = "verify"): FlowPart => ({ kind: "action", text, icon });
const note = (text: string): FlowPart => ({ kind: "note", text });
const stop = (text: string): FlowPart[] => [action(text, "stop"), note("Stop here. No downstream transaction or Kuali save.")];
const step = (number: number, title: string, system: FlowStep["system"], ...parts: FlowPart[]): FlowStep => ({ number, title, system, parts });

const transactionWizard: readonly FlowPart[] = [
  form("template", "Smart HR · Template", "Fill form", [rows("fill", [
    ["template", "Template", "Resolved termination type", "type"], ["transaction-date", "Transaction date", "Termination effective date", "dates"],
  ])]),
  action("Click Create Transaction", "click"),
  form("transaction", "Smart HR · Transaction details", "Continue", [
    rows("fill", [["employee", "Employee ID", "Approved identity", "identity"]]),
    action("Press Tab to resolve employee", "key"),
    rows("read", [["employee-record", "Employee name · employee record", "Verify approved identity"], ["job-date", "Job effective date", "Verify transaction date"]]),
    rows("fill", [["reason", "Action reason", "Resolved reason code", "type"]]),
  ]),
  action("Click Continue", "click"),
  form("employment", "Smart HR · Employment information", "Continue", [rows("fill", [
    ["override", "Override last date worked", "Checked", "override"],
    ["last-worked", "Last date worked", "Reconciled date", "dates"],
    ["initiator-comments", "Initiator comments", "Reconciled date explanation", "comments", "ucpath"],
    ["transaction-comments", "Transaction comments", "Same explanation", "comments", "duplicate"],
  ])]),
  action("Read back all staged values"), action("Click Save and Submit", "click"),
  action("Verify the transaction number and receipt"), action("Continue with the newly filed receipt", "rejoin"),
];

export function buildExplorerPreview(scenario: PreviewScenario): FlowStep[] {
  return [
    step(1, "Open browser sessions", undefined, { kind: "sessions" }),
    step(2, "Find the Kuali action", "Kuali",
      form("action-list", "Action List", "Fill form", [rows("fill", [["document", "Document number", "Run input", "document"]])]),
      action("Click Go", "click"), action("Read the matching action link", "read")),
    step(3, "Read the separation document", "Kuali",
      form("request", "RRSS Separation Request", "Read only", [
        rows("read", [
          ["name", "Employee name", "Separation request"], ["employee", "Employee ID", "Separation request"],
          ["type", "Employee type · student title code", "Separation request"], ["division", "Division · location", "Separation request"],
          ["termination", "Termination type", "Separation request"], ["dates", "Last day worked · separation date", "Separation request"],
          ["comments", "Additional comments", "Separation request"],
        ]),
        { kind: "detail", id: "request-options", title: "Timekeeper, final transactions & option lists", parts: [rows("read", [
          ["timekeeper", "Request acknowledged · timekeeper name", "Current form values"], ["timekeeper-comments", "Timekeeper comments", "Preserve existing text"],
          ["effective", "Termination effective date", "Current form value"], ["job", "Department · payroll title code · payroll title", "Current form values"],
          ["receipt", "Submitted template · transaction number", "Current form values"], ["pay", "Final pay", "Current selection"], ["options", "All dropdown options", "Read available choices"],
        ])] },
      ]), action("Verify document number and form type")),
    step(4, "Build the separation plan", "Local", action("Use the request’s employee name and dates to establish the timecard window.", "compute")),
    step(5, "Resolve the termination type", "Local", action("Map the requested termination type to the UCPath template and reason.", "compute")),
    step(6, "Search the employee name", "UCPath", form("person", "Person Organizational Summary", "Fill form", [rows("fill", [["name", "Employee name", "Kuali separation request", "name"]])]), action("Read all matching employees", "read")),
    step(7, "Identify the separation subject", "Local", action("Match the document’s employee ID against the name-search results.", "compute")),
    step(8, "Read Workforce Job Summary", "UCPath", action("Expand employment instances when needed", "click"),
      form("job-summary", "Workforce Job Summary", "Read only", [rows("read", [
        ["employee", "Employee ID · name", "Displayed employee"], ["record", "Employee record", "Each employment row"],
        ["status", "HR status · effective date", "Each employment row"], ["position", "Business unit · position number", "Each employment row"],
        ["department", "Department ID · department", "Each employment row"], ["title", "Job code · job title", "Each employment row"],
        ["end", "Expected job end date", "Each employment row"], ["class", "FTE · employee class", "Each employment row"],
      ])])),
    step(9, "Resolve active employment", "Local", action("Select the active employment record. Stop if no single valid record can be established.", "compute")),
    step(10, "Match the department option", "Local", action("Match the UCPath department to an option read from this Kuali document.", "compute")),
    step(11, "Find the employee timecard", "Kronos", form("employee-search", "Employee search", "Fill form", [rows("fill", [["employee", "Employee ID", "Resolved separation subject", "identity"]])]), action("Select the matching employee", "click")),
    step(12, "Read the timecard", "Kronos", action("Open Go To → Timecard", "click"),
      form("range", "Timecard range", "Fill form", [rows("fill", [["range", "Start date · end date", "Separation plan", "window"]])]),
      form("timecard", "Timecard", "Read only", [rows("read", [
        ["displayed-range", "Displayed date range", "Verify requested window"], ["punch", "Punches · last punch date", "Timecard grid"],
        ["leave", "Sick dates · holiday dates", "Timecard grid"], ["codes", "Other pay codes", "Timecard grid"],
      ])])),
    step(13, "Reconcile the dates", "Local", rows("compute", [
      ["last-worked", "Last day worked", "Request + last punch"], ["separation", "Separation date", "Request + leave dates"], ["effective", "Termination effective date", "Reconciled separation date"],
    ])),
    step(14, "Compare identity and write details", "Local", action("Bind the employee, employment, dates and proposed writes to the approval evidence.", "compute")),
    step(15, "Resolve identity approval", "You", { kind: "choice", choice: "identity" },
      ...(scenario.identity === "verified" ? [action("Identity verified against the supplied employee ID.")] : scenario.identity === "review" ? [action("Pause for operator review. Resume this path after approval."), note("Sessions close while waiting; reacquire and authenticate on resume.")] : stop("Identity approval rejected"))),
    step(16, "Verify the approval", "Local", action("Verify that the approval still matches the employee and proposed writes.", "compute")),
    step(17, "Read pending terminations", "UCPath", form("pending", "Transactions in Progress", "Read only", [rows("read", [
      ["employee", "Employee ID · name", "Approved identity"], ["pending", "Pending termination rows", "Exact observed set"], ["transactions", "Transaction IDs · effective dates", "Each pending row"],
    ])], "pending")),
    step(18, "Clear pending terminations", "UCPath",
      ...(scenario.pending === "none" ? [action("No pending terminations to delete."), action("Continue to the existing-termination check", "rejoin")] : scenario.pending === "some" ? [
        action("Verify the exact pending set has not changed"), action("Select only the observed pending termination rows", "click"), action("Click Delete", "click"),
        action("Verify that the selected terminations were cleared"), action("Continue to the existing-termination check", "rejoin"),
      ] : stop("Pending terminations could not be verified"))),
    step(19, "File the termination", "UCPath", { kind: "choice", choice: "termination" }, note("Match the approved employee and effective date in UCPath."),
      ...(scenario.termination === "absent" ? transactionWizard : scenario.termination === "present" ? [action("Read the matching transaction number and receipt", "read"), action("Verify employee, effective date and transaction proof"), action("Reuse this receipt · continue at step 20", "rejoin")] : stop("The existing-termination check is inconclusive"))),
    step(20, "Verify the termination receipt", "Local", action(`Verify the ${scenario.termination === "present" ? "existing" : "new"} receipt against the approved employee and effective date`)),
    step(21, "Verify the current UCPath filing", "UCPath", action("Find the exact transaction and verify it is still present")),
    step(22, "Finalize the Kuali document", "Kuali", action("Check whether this exact finalization is already saved"), note("Already saved: verify the current values and finish. Otherwise:"),
      form("finalize", "RRSS Separation Request", "Continue", [
        { kind: "resume", step: 3, text: "Same form · opened in step 3" },
        rows("fill", [
          ["department", "Department", "Matched department option", "department"], ["title", "Payroll title code · payroll title", "Workforce Job Summary", "title"],
          ["acknowledged", "Request acknowledged", "Checked", "acknowledged"], ["timekeeper", "Timekeeper name", "Configured timekeeper", "timekeeper"],
          ["dates", "Last day worked · separation date", "Reconciled dates", "dates"], ["effective", "Termination effective date", "Verified receipt date", "effective"],
          ["submitted", "Termination template submitted", "Checked", "submitted"], ["transaction", "Transaction number", "Verified UCPath receipt", "receipt"],
          ["pay", "Final pay", "Workflow rule", "pay"], ["comments", "Timekeeper comments", "Existing comments + filing details", "timekeeper-comments", "kuali"],
        ]),
      ]), action("Verify every staged field and preserve existing comments"), action("Click Save", "click"), action("Reload and verify the saved document")),
  ];
}

const read = (system: string, page: string, field: string, step: number, fieldId?: string) => ({ system, page, field, step, fieldId });
const kuali = (field: string, fieldId: string) => read("Kuali", "RRSS Separation Request", field, 3, fieldId);
const job = (field: string, fieldId: string) => read("UCPath", "Workforce Job Summary", field, 8, fieldId);
const timecard = (field: string, fieldId: string) => read("Kronos", "Timecard", field, 12, fieldId);
const calc = (step: number, title: string, detail: string) => ({ step, title, detail });
const dates: FieldSource = {
  reads: [kuali("Last day worked · separation date", "dates"), timecard("Last punch date", "punch"), timecard("Sick dates · holiday dates", "leave")],
  chain: [calc(13, "Reconcile dates", "Combine the request dates with the observed timecard."), calc(16, "Verify approval", "The approved write details bind these dates.")],
};
const identity: FieldSource = {
  reads: [kuali("Employee ID", "employee"), read("UCPath", "Person Organizational Summary", "Matching employee records", 6)],
  chain: [calc(7, "Resolve employee", "Match the document ID against the name-search results."), calc(16, "Verify approval", "Use the employee identity bound to the approved write details.")],
};
const sources: Readonly<Record<string, FieldSource>> = {
  document: { origin: "Run input", detail: "The document number provided when this run is started." },
  name: { reads: [kuali("Employee name", "name")], chain: [calc(4, "Build separation plan", "Use the name read from this request.")] },
  identity, dates,
  window: { reads: [kuali("Last day worked · separation date", "dates")], chain: [calc(4, "Build timecard window", "Derive the window from the request dates and document observation time.")] },
  type: { reads: [kuali("Termination type", "termination")], chain: [calc(5, "Resolve termination type", "Map the request to the configured UCPath template and action reason.")] },
  override: { origin: "Workflow rule", detail: "Ensure the override is checked before entering the reconciled last date worked." },
  comments: { ...dates, chain: [calc(13, "Build termination comments", "Explain the reconciled dates using the request and timecard evidence. Both UCPath comment fields receive identical text.")] },
  department: { reads: [job("Department ID · department", "department"), kuali("Department option list", "options")], chain: [calc(9, "Resolve active employment", "Choose the department from the selected employment record."), calc(10, "Match the Kuali option", "Resolve that department against options read from this document.")] },
  title: { reads: [job("Job code · job title", "title")], chain: [calc(9, "Resolve active employment", "Take the code and title from the selected employment record.")] },
  acknowledged: { origin: "Workflow rule", detail: "Set the request acknowledgement to checked during Kuali finalization." },
  timekeeper: { origin: "Configured input", detail: "The timekeeperName input comes from runtime configuration. Protected values remain hidden unless the application permits them." },
  submitted: { origin: "Verified filing", detail: "Set to checked only after the UCPath filing receipt has been verified.", reads: [read("UCPath", "Termination receipt", "Verified filing", 20)] },
  pay: { origin: "Workflow rule", detail: "Select “Does not need final pay (student)”. This is a declared constant, not a field read from a page." },
  "timekeeper-comments": { reads: [kuali("Existing timekeeper comments", "timekeeper-comments")], chain: [calc(13, "Reconcile dates", "Compose the date explanation with the configured timekeeper."), calc(20, "Verify filing receipt", "Include the filing details."), calc(22, "Append finalization comments", "Preserve the originally read comments; refuse if the current text changed.")] },
};
export function previewFieldSource(key: string, step: number, scenario: PreviewScenario): FieldSource | undefined {
  if (key === "receipt") return { reads: [read("UCPath", scenario.termination === "present" ? "Existing termination" : "New termination receipt", "Transaction number", 19)], chain: [calc(20, "Verify receipt", "Match employee and effective date to the approved request."), calc(21, "Verify current filing", "Confirm this transaction is still present before Kuali finalization.")] };
  if (key === "effective") return { ...dates, chain: [...dates.chain!, calc(20, "Verify receipt date", "The receipt must match the approved effective date.")] };
  if (key === "identity" && step === 11) return { ...identity, chain: identity.chain!.slice(0, 1) };
  return sources[key];
}
