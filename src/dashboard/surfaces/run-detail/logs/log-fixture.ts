import { LOG_DECISION_STATUS } from "./log-decision-model.js";
import { logDecisionExamples } from "./log-decision-fixture.js";
import type { LogEntry, LogField, LogScreenshot, LogStep } from "./log-feed-model.js";
import type { LogTimelineStage } from "./log-timeline-model.js";

type FieldInput = readonly [time: string, label: string, value: string, kind?: LogField["kind"]];
const fields = (id: string, title: string | undefined, rows: readonly FieldInput[], result?: string, screenshot?: LogScreenshot): LogEntry => ({
  id, kind: "fields", ...(title === undefined ? {} : { title }), ...(result === undefined ? {} : { result }),
  ...(screenshot === undefined ? {} : { screenshots: [screenshot] }),
  fields: rows.map(([time, label, value, kind = "read"], index) => ({ id: `${id}-${index}`, time, label, value, kind })),
});
const click = (id: string, time: string, label: string, screenshot?: LogScreenshot): LogEntry => ({ id, kind: "click", time, label, ...(screenshot === undefined ? {} : { screenshots: [screenshot] }) });
const capture = (name: string, label: string, time: string, system: string, kind: NonNullable<LogScreenshot["kind"]>, height = 300): LogScreenshot => ({
  src: `/logs-preview/${name}.svg`, alt: `${system} ${label} for Alex Morgan`, label, time, system, kind, width: 850, height,
});
const comments = "Termination eff 09/26/2026. Last Day Worked 09/25/2026. Holiday Pay on 09/25/2026. Kuali form #SIM-48216.";

/** Fictional presentation fixtures. This entry never creates a dashboard client. */
export const separationLogs: readonly LogStep[] = [
  { id: "find-document", time: "09:31:00", title: "Find the Kuali action", system: "Kuali", entries: [
    fields("action-list", "Action List", [["09:31:02", "Document number", "SIM-48216", "fill"]], undefined, capture("kuali-search", "Document search", "09:31:02", "Kuali", "fields")),
    click("find-go", "09:31:03", "Go"),
    fields("matching-action", undefined, [["09:31:04", "Matching action", "SIM-48216 · RRSS Separation Request"]]),
  ] },
  { id: "read-document", time: "09:31:06", title: "Read separation document", system: "Kuali", entries: [
    fields("separation-request", "RRSS Separation Request", [
      ["09:31:06", "Employee name", "Morgan, Alex"], ["09:31:06", "Employee ID", "Not supplied"],
      ["09:31:07", "Employee type / title code", "Student employee · 4922"], ["09:31:07", "Division / location", "Campus Services · Sample Campus"],
      ["09:31:08", "Termination type", "Accepted Another Job"], ["09:31:08", "Last day worked", "09/25/2026"], ["09:31:08", "Separation date", "09/25/2026"],
      ["09:31:09", "Additional comments", "Leaving for another position."], ["09:31:09", "Timekeeper name", "Not yet entered"], ["09:31:09", "Timekeeper comments", "Empty"],
      ["09:31:10", "Department / payroll title", "Not yet selected"], ["09:31:10", "Transaction / template submitted", "Empty · unchecked"],
      ["09:31:10", "Final pay option", "Not yet selected"], ["09:31:10", "Contact information", "Protected value · redacted"],
    ], "Separation request verified", capture("kuali-request", "Separation request", "09:31:10", "Kuali", "browser")),
  ] },
  { id: "plan", time: "09:31:11", title: "Build separation plan", entries: [fields("plan-values", undefined, [
    ["09:31:11", "Timecard window", "09/11/2026–09/25/2026", "compute"], ["09:31:12", "Template / reason", "UC_VOL_TERM · Resign – Accept Another Job", "compute"],
  ])] },
  { id: "search-person", time: "09:31:14", title: "Search employee name", system: "UCPath", entries: [
    fields("person-search", "Person Organizational Summary", [["09:31:14", "Employee name", "Alex Morgan", "fill"]], undefined, capture("ucpath-person-search", "Employee search", "09:31:14", "UCPath", "fields")),
    click("person-search-click", "09:31:15", "Search"),
    fields("person-match", "Matching employees", [["09:31:17", "Employee", "Morgan, Alex · DEMO-1042"], ["09:31:17", "Department", "Campus Services"]], "One matching employee", capture("ucpath-person", "Matching employee", "09:31:17", "UCPath", "person", 340)),
  ] },
  { id: "read-job", time: "09:31:19", title: "Read Workforce Job Summary", system: "UCPath", entries: [fields("job-summary", "Workforce Job Summary", [
    ["09:31:19", "Employee ID · name", "DEMO-1042 · Morgan, Alex"], ["09:31:20", "Employment record / status", "0 · Active"], ["09:31:20", "Effective date / action", "09/01/2026 · SAMPLE"],
    ["09:31:21", "Position", "DEMO-P0084"], ["09:31:21", "Department", "DEMO-D120 · Campus Services"], ["09:31:22", "Job code / title", "4922 · Student Assistant"],
    ["09:31:22", "Expected end date", "06/30/2027"], ["09:31:23", "FTE / employee type", "0.25 · Student"],
  ], "Employment record verified", capture("ucpath-job", "Job summary", "09:31:23", "UCPath", "browser"))] },
  { id: "timecard", time: "09:31:25", title: "Find and read the timecard", system: "Kronos", entries: [
    fields("timecard-search", "Employee search", [["09:31:25", "Employee ID", "DEMO-1042", "fill"]], undefined, capture("kronos-search", "Employee search", "09:31:25", "Kronos", "fields")),
    click("timecard-select", "09:31:27", "Select matching employee"), click("timecard-open", "09:31:29", "Go to Timecard"),
    fields("timecard-window", "Timecard", [["09:31:31", "Date range", "09/11/2026–09/25/2026", "fill"], ["09:31:34", "Employee ID · name", "DEMO-1042 · Morgan, Alex"], ["09:31:35", "Last punch", "09/25/2026 · 16:00"], ["09:31:36", "Sick pay", "None"], ["09:31:37", "Holiday pay", "09/25/2026"]], "Requested timecard window verified", capture("kronos-timecard", "Timecard", "09:31:37", "Kronos", "fields")),
  ] },
  { id: "dates", time: "09:31:41", title: "Reconcile dates", entries: [fields("reconciled-dates", undefined, [
    ["09:31:41", "Last day worked", "09/25/2026 · request agrees with last punch", "compute"], ["09:31:41", "Separation date", "09/25/2026 · latest holiday", "compute"], ["09:31:41", "Termination effective date", "09/26/2026 · day after separation", "compute"],
  ])] },
  { id: "pending", time: "09:32:09", title: "Read pending terminations", system: "UCPath", entries: [fields("pending-table", "Transactions in Progress", [
    ["09:32:09", "Employee ID · name", "DEMO-1042 · Morgan, Alex"], ["09:32:10", "Pending termination rows", "None"],
  ], "No pending terminations")] },
  { id: "existing", time: "09:32:13", title: "Check for an existing termination", system: "UCPath", entries: [fields("existing-table", "Smart HR Transactions", [
    ["09:32:13", "Employee ID", "DEMO-1042"], ["09:32:14", "Effective date", "09/26/2026"], ["09:32:15", "Matching transaction", "None"],
  ], "Create a new termination")] },
  { id: "file", time: "09:32:17", title: "File termination", system: "UCPath", entries: [
    fields("create-template", "Smart HR transaction", [["09:32:17", "Template", "UC_VOL_TERM", "fill"], ["09:32:18", "Effective date", "09/26/2026", "fill"]], undefined, capture("ucpath-template", "Transaction fields", "09:32:18", "UCPath", "fields")),
    click("create-transaction", "09:32:20", "Create Transaction"),
    fields("transaction-person", "Transaction details", [["09:32:22", "Employee ID", "DEMO-1042", "fill"]], undefined, capture("ucpath-employee", "Employee ID", "09:32:22", "UCPath", "fields")),
    click("employee-tab", "09:32:23", "Tab · resolve employee"),
    fields("transaction-identity", undefined, [["09:32:24", "Employee name / record", "Morgan, Alex · 0"], ["09:32:24", "Effective date", "09/26/2026"], ["09:32:25", "Reason", "Resign – Accept Another Job", "fill"]], undefined, capture("ucpath-reason", "Employee and reason", "09:32:25", "UCPath", "fields", 320)),
    click("continue", "09:32:27", "Continue"),
    fields("employment-info", "Employment information", [["09:32:29", "Override position data", "Checked", "fill"], ["09:32:30", "Last day worked", "09/25/2026", "fill"], ["09:32:31", "Initiator comments", comments, "fill"], ["09:32:32", "Transaction comments", comments, "fill"]], "Employee, dates, reason and both comments match", capture("ucpath-employment", "Employment fields", "09:32:32", "UCPath", "fields", 390)),
    click("submit", "09:32:38", "Save and Submit", capture("ucpath-form", "Form after Save and Submit", "09:32:38", "UCPath", "form", 1050)),
  ] },
  { id: "verify-termination", time: "09:32:41", title: "Verify termination", system: "UCPath", entries: [fields("submitted-transaction", "Smart HR Transactions", [
    ["09:32:41", "Transaction number", "SIM-042"], ["09:32:42", "Employee / effective date", "DEMO-1042 · 09/26/2026"], ["09:32:43", "Filing state", "Submitted"],
  ], "Termination filed", capture("ucpath-submitted", "Submitted transaction", "09:32:43", "UCPath", "browser"))] },
  { id: "finalize", time: "09:33:18", title: "Finalize Kuali document", system: "Kuali", entries: [
    fields("final-document", "RRSS Separation Request", [["09:33:18", "Department", "Campus Services", "fill"], ["09:33:19", "Payroll title", "4922 · Student Assistant", "fill"], ["09:33:20", "Acknowledgment", "Checked", "fill"], ["09:33:21", "Timekeeper name", "Fictional Timekeeper", "fill"], ["09:33:22", "Last day worked / separation date", "09/25/2026", "fill"], ["09:33:23", "Termination effective date", "09/26/2026", "fill"], ["09:33:24", "Template submitted", "Checked", "fill"], ["09:33:25", "Transaction number", "SIM-042", "fill"], ["09:33:26", "Final pay", "Does not need final pay · student", "fill"], ["09:33:27", "Timekeeper comments", "Termination filed on UCPath as SIM-042. Re Kuali Form #SIM-48216. -FT 09/29/2026", "fill"]], undefined, capture("kuali-filled", "Separation fields", "09:33:27", "Kuali", "fields", 850)),
    click("save-document", "09:33:29", "Save", capture("kuali-form", "Form after Save", "09:33:29", "Kuali", "form", 1150)),
  ] },
  { id: "verify-document", time: "09:33:32", title: "Verify saved document", system: "Kuali", entries: [fields("saved-document", "RRSS Separation Request", [
    ["09:33:32", "Document number", "SIM-48216"], ["09:33:33", "Transaction / template submitted", "SIM-042 · checked"], ["09:33:33", "Dates / employment / comments", "Match the approved staged values"],
  ], "Separation filed · Kuali document verified", capture("kuali-saved", "Saved document", "09:33:33", "Kuali", "browser"))] },
];

export function logTimelineSample(scenario: string): readonly LogTimelineStage[] {
  if (!["separation", "reading", "waiting", "failed", "empty"].includes(scenario)) throw new Error("log-timeline-sample-missing");
  const stages = [
    { id: "request", label: "Read request", stepId: "find-document", time: "09:31:00", durationLabel: "14s", substeps: [
      { id: "find-document", label: "Find the Kuali action", durationLabel: "6s" },
      { id: "read-document", label: "Read separation document", durationLabel: "5s" },
      { id: "plan", label: "Build separation plan", durationLabel: "3s" },
    ] },
    { id: "employee", label: "Verify employee", stepId: "search-person", time: "09:31:14", durationLabel: "11s", substeps: [
      { id: "search-person", label: "Search employee name", durationLabel: "5s" },
      { id: "read-job", label: "Read Workforce Job Summary", durationLabel: "6s" },
    ] },
    { id: "timecard", label: "Read timecard", stepId: "timecard", time: "09:31:25", durationLabel: "44s", substeps: [
      { id: "timecard", label: "Find and read the timecard", durationLabel: "16s" },
      { id: "dates", label: "Reconcile dates", durationLabel: "28s" },
    ] },
    { id: "termination", label: "File termination", stepId: "pending", time: "09:32:09", durationLabel: "1m 9s", substeps: [
      { id: "pending", label: "Read pending terminations", durationLabel: "4s" },
      { id: "existing", label: "Check for an existing termination", durationLabel: "4s" },
      { id: "file", label: "File termination", durationLabel: "24s" },
      { id: "verify-termination", label: "Verify termination", durationLabel: "37s" },
    ] },
    { id: "document", label: "Finalize document", stepId: "finalize", time: "09:33:18", durationLabel: "18s", substeps: [
      { id: "finalize", label: "Finalize Kuali document", durationLabel: "14s" },
      { id: "verify-document", label: "Verify saved document", durationLabel: "4s" },
    ] },
  ];
  return stages.map((stage, index) => {
    const state: LogTimelineStage["state"] = scenario === "empty" || ((scenario === "reading" || scenario === "waiting") && index > 2) ? "pending"
      : scenario === "reading" && index === 2 ? "active" : scenario === "waiting" && index === 2 ? "waiting"
        : scenario === "failed" && index === 4 ? "failed" : "completed";
    const substeps = stage.substeps.map((substep, substepIndex) => {
      const substepState: LogTimelineStage["state"] = state === "completed" ? "completed" : state === "pending" ? "pending"
        : state === "failed" ? substepIndex === stage.substeps.length - 1 ? "failed" : "completed"
          : substepIndex === 0 ? state : "pending";
      return { id: substep.id, label: substep.label, state: substepState, ...(substepState === "completed" ? { durationLabel: substep.durationLabel } : {}) };
    });
    return state === "pending" ? { id: stage.id, label: stage.label, state, substeps } : { ...stage, substeps, durationLabel: state === "completed" ? stage.durationLabel : undefined, state };
  });
}

export const previewScenarios = [
  { id: "separation", label: "Full separation", subject: "Alex Morgan", status: "Completed", steps: separationLogs },
  { id: "reading", label: "Reading timecard", subject: "Alex Morgan", status: "In progress", steps: separationLogs.slice(0, 6) },
  { id: "waiting", label: "Awaiting confirmation", subject: "Alex Morgan", status: "Waiting", steps: [...separationLogs.slice(0, 6), decisionStep("review-fields")] },
  { id: "failed", label: "Document read failed", subject: "Alex Morgan", status: "Failed", steps: [...separationLogs.slice(0, 12), decisionStep("failure-verified")] },
  { id: "empty", label: "Waiting for actions", subject: "Alex Morgan", status: "Starting", steps: [] },
].map(scenario => ({ ...scenario, timeline: logTimelineSample(scenario.id) }));

function decisionStep(id: string): LogStep {
  const example = logDecisionExamples.find(item => item.id === id);
  if (!example) throw new Error("log-decision-example-missing");
  return { id: `decision-${id}`, time: example.entry.time, title: "Run decision", header: false, entries: [example.entry] };
}
const decisionStepIds: Readonly<Record<string, string>> = {
  parked: "file", verification: "file", "write-absent": "file", "park-unavailable": "file", "failure-prepared": "file", "failure-attempting": "file", implementation: "file", "failure-unavailable": "file", "screenshot-unavailable": "file", "screenshot-fields": "file", "screenshot-form": "file", "screenshot-browsers": "file",
  "failure-no-write": "read-document", "document-not-found": "find-document", "review-fields": "read-document", configuration: "find-document",
  "review-identity": "search-person", "employee-not-found": "search-person", "review-candidates": "search-person", "review-employment": "read-job", "review-held": "search-person", "review-approved": "read-job", "identity-mismatch": "search-person", loading: "search-person", "authority-changed": "read-job", "transport-unknown": "search-person", cancelled: "read-job", "screenshot-person": "search-person",
  "failure-committed": "verify-termination", "failure-unknown": "verify-termination", "write-present": "verify-termination", "failure-verified": "finalize", warning: "verify-document", "screenshot-forms": "finalize",
};
export const decisionScenarios = logDecisionExamples.map(example => {
  const targetId = decisionStepIds[example.id];
  if (!targetId) throw new Error("log-decision-stage-binding-missing");
  const targetIndex = separationLogs.findIndex(step => step.id === targetId);
  if (targetIndex < 0) throw new Error("log-decision-step-missing");
  const baseTimeline = logTimelineSample("separation");
  const affectedIndex = baseTimeline.findIndex(stage => stage.substeps.some(substep => substep.id === targetId));
  if (affectedIndex < 0) throw new Error("log-decision-stage-missing");
  const state: LogTimelineStage["state"] = example.entry.kind !== "decision" ? "completed" : example.entry.decision.state === "failed" ? "failed" : example.entry.decision.state === "loading" || example.entry.decision.state === "recorded" || example.entry.decision.state === "resolved" ? "active" : "waiting";
  const steps = [...separationLogs.slice(0, targetIndex), { ...decisionStep(example.id), id: targetId }];
  const timeline = baseTimeline.map((stage, index): LogTimelineStage => {
    if (index < affectedIndex) return stage;
    if (index > affectedIndex) return { id: stage.id, label: stage.label, state: "pending", substeps: stage.substeps.map(substep => ({ id: substep.id, label: substep.label, state: "pending" })) };
    const affectedSubstep = stage.substeps.findIndex(substep => substep.id === targetId);
    return { id: stage.id, label: stage.label, state, time: example.entry.time, stepId: stage.substeps[0]?.id, substeps: stage.substeps.map((substep, subIndex) => subIndex < affectedSubstep ? substep : { id: substep.id, label: substep.label, state: subIndex === affectedSubstep ? state : "pending" }) };
  });
  return { id: example.id, label: `${example.category} · ${example.label}`, subject: "Alex Morgan", status: example.entry.kind === "decision" ? LOG_DECISION_STATUS[example.entry.decision.state].label : "Recorded", steps, timeline };
});
