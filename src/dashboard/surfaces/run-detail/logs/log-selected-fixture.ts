import type { LogDecision } from "./log-decision-model.js";
import type { LogEntry, LogField, LogScreenshot, LogStep } from "./log-feed-model.js";
import { queueRowTitle, type QueueSurfaceWire } from "../../queue/queue-model.js";
import { decisionScenarios, previewScenarios } from "./log-fixture.js";
import type { LogSelection } from "./log-selection-model.js";
import type { LogTimelineStage, LogTimelineState } from "./log-timeline-model.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";

export type SelectedLogMock = Readonly<{
  id: string; label: string; subject: string; workflowLabel: string; status: string;
  steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; initialStepId?: string;
}>;
type CaptureRow = readonly [label: string, value: string];
const escapeXml = (value: string) => value.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
function captureLines(value: string): readonly string[] {
  const lines: string[] = [];
  while (value.length > 68) {
    const space = value.lastIndexOf(" ", 68);
    const end = space > 0 ? space : 68;
    lines.push(value.slice(0, end));
    value = value.slice(end).trimStart();
  }
  return [...lines, value];
}

/** Authored sample images contain the same fictional values as their associated log rows. */
function capture(system: string, label: string, time: string, kind: NonNullable<LogScreenshot["kind"]>, rows: readonly CaptureRow[], height = 300): LogScreenshot {
  const groups = rows.map(([name, value]) => ({ name, lines: captureLines(value) }));
  height = Math.max(height, 145 + groups.reduce((total, row) => total + 44 + (row.lines.length - 1) * 18, 0) + (kind === "form" ? 90 : 0));
  let y = 112;
  const content = groups.map(({ name, lines }) => {
    const top = y;
    const rowHeight = 30 + (lines.length - 1) * 18;
    y += rowHeight + 14;
    return `<text x="38" y="${top + 20}" font-size="13" fill="#586576">${escapeXml(name)}</text><rect x="275" y="${top}" width="515" height="${rowHeight}" rx="3" fill="#f8fafc" stroke="#bbc5d0"/><text font-size="13" fill="#263348">${lines.map((line, index) => `<tspan x="285" y="${top + 20 + index * 18}">${escapeXml(line)}</tspan>`).join("")}</text>`;
  }).join("");
  const formEnd = kind === "form" ? `<rect x="38" y="${height - 100}" width="754" height="1" fill="#cbd0d7"/><rect x="640" y="${height - 75}" width="152" height="34" rx="4" fill="#263d63"/><text x="662" y="${height - 53}" font-size="13" fill="white">Save and Submit</text>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${height}" viewBox="0 0 850 ${height}"><rect width="850" height="${height}" fill="#f3f5f7"/><rect width="850" height="34" fill="#263d63"/><g font-family="Arial"><text x="20" y="23" fill="white" font-size="13">FICTIONAL SAMPLE · ${escapeXml(system)}</text><rect x="20" y="50" width="810" height="${height - 70}" rx="4" fill="white" stroke="#cbd0d7"/><text x="38" y="81" fill="#253348" font-size="19">${escapeXml(label)}</text>${content}${formEnd}</g></svg>`;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: 850, height, system, label, time, kind, alt: `Fictional ${system} ${label} · sample data` };
}
export { capture as logSampleCapture };
const at = (seconds: number) => `09:${String(40 + Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
function fields(id: string, seconds: number, title: string, rows: readonly CaptureRow[], kind: LogField["kind"] = "read", screenshot?: LogScreenshot, result?: string): LogEntry {
  return { id, kind: "fields", title, fields: rows.map(([label, value], index) => ({ id: `${id}-${index}`, time: at(seconds), kind, label, value })), ...(screenshot ? { screenshots: [screenshot] } : {}), ...(result ? { result } : {}) };
}
const click = (id: string, seconds: number, label: string): LogEntry => ({ id, time: at(seconds), kind: "click", label });
const note = (id: string, seconds: number, message: string, tone?: "info" | "positive" | "danger"): LogEntry => ({ id, time: at(seconds), kind: "note", message, tone });
const decisionStep = (id: string, seconds: number, decision: LogDecision): LogStep => ({ id, time: at(seconds), title: decision.title, header: false, entries: [{ id: `${id}-decision`, kind: "decision", time: at(seconds), decision }] });

const LOOKUP_STAGES = [
  { id: "searching", label: "Searching", start: 0, substeps: [
    { id: "lookup-open", label: "Open Person Organizational Summary", seconds: 3 },
    { id: "lookup-search", label: "Enter employee search", seconds: 2 },
    { id: "lookup-matches", label: "Read matching employees", seconds: 6 },
  ] },
  { id: "cross-verify", label: "Cross Verification", start: 11, substeps: [
    { id: "lookup-crm", label: "Search CRM employee record", seconds: 4 },
    { id: "lookup-compare", label: "Compare employee identity", seconds: 3 },
    { id: "lookup-confirm", label: "Confirm employee match", seconds: 2 },
  ] },
  { id: "active-status", label: "Active Status", start: 20, substeps: [
    { id: "lookup-job", label: "Read employment record", seconds: 3 },
    { id: "lookup-status", label: "Confirm active employment", seconds: 2 },
  ] },
  { id: "crm-dates", label: "CRM Dates", start: 25, substeps: [
    { id: "lookup-dates", label: "Read CRM appointment dates", seconds: 4 },
    { id: "lookup-dates-confirm", label: "Compare appointment dates", seconds: 2 },
  ] },
] as const;

function lookupMock({ row, workflowLabel }: LogSelection): SelectedLogMock {
  const subject = queueRowTitle(row);
  const eid = `DEMO-${row.runId.slice(-4)}`;
  const identity: readonly CaptureRow[] = [["Employee", subject], ["Employee ID", eid], ["Department", "Campus Services"]];
  const completed: readonly LogStep[] = [
    { id: "lookup-open", time: at(0), title: "Open Person Organizational Summary", system: "UCPath", entries: [click("open-summary", 0, "Person Organizational Summary")] },
    { id: "lookup-search", time: at(3), title: "Enter employee search", system: "UCPath", entries: [fields("lookup-search-fields", 3, "Employee search", [["Employee", subject]], "fill", capture("UCPath", "Employee search", at(3), "fields", [["Employee", subject]])), click("lookup-search-button", 4, "Search")] },
    { id: "lookup-matches", time: at(5), title: "Read matching employees", system: "UCPath", entries: [fields("lookup-match-fields", 5, "Matching employee", identity, "read", capture("UCPath", "Matching employee", at(5), "person", identity, 340), "One matching employee")] },
    { id: "lookup-crm", time: at(11), title: "Search CRM employee record", system: "CRM", entries: [fields("lookup-crm-search", 11, "Employee search", [["Employee ID", eid]], "fill", capture("CRM", "Employee search", at(11), "fields", [["Employee ID", eid]])), click("lookup-crm-button", 13, "Search")] },
    { id: "lookup-compare", time: at(15), title: "Compare employee identity", system: "CRM", entries: [fields("lookup-crm-identity", 15, "CRM employee record", identity, "read", capture("CRM", "Employee record", at(15), "person", identity, 340), "Employee ID and department match UCPath")] },
    { id: "lookup-confirm", time: at(18), title: "Confirm employee match", entries: [note("identity-confirmed", 18, `Employee match confirmed for ${subject} · ${directIdentifierDisplay(eid)}.`, "positive")] },
    { id: "lookup-job", time: at(20), title: "Read employment record", system: "UCPath", entries: [fields("lookup-job-fields", 20, "Workforce Job Summary", [...identity, ["Employment record", "0"], ["Job title", "Student Assistant"]], "read", capture("UCPath", "Workforce Job Summary", at(20), "browser", [...identity, ["Employment record", "0"], ["Job title", "Student Assistant"]], 390))] },
    { id: "lookup-status", time: at(23), title: "Confirm active employment", system: "UCPath", entries: [fields("lookup-status-fields", 23, "Employment status", [["Record", "0"], ["Status", "Active"], ["Effective date", "08/01/2026"]], "read", undefined, "Active employment confirmed")] },
    { id: "lookup-dates", time: at(25), title: "Read CRM appointment dates", system: "CRM", entries: [fields("lookup-date-fields", 25, "Appointment", [["Start date", "08/01/2026"], ["Expected end date", "06/30/2027"]], "read", capture("CRM", "Appointment dates", at(25), "fields", [["Start date", "08/01/2026"], ["Expected end date", "06/30/2027"]]))] },
    { id: "lookup-dates-confirm", time: at(29), title: "Compare appointment dates", entries: [note("dates-confirmed", 29, "Appointment dates agree with the UCPath employment record.", "positive")] },
  ];
  let steps: readonly LogStep[] = completed;
  let affectedId: string | undefined;
  let affectedState: LogTimelineState | undefined;
  let stoppedBefore: string | undefined;
  let status = "Completed";
  let label = "Employee lookup completed";
  switch (row.status) {
    case "queued":
      steps = []; stoppedBefore = "lookup-open"; status = "Queued"; label = "Employee lookup queued"; break;
    case "cancelling":
    case "cancelled":
      steps = [...completed.slice(0, 2), { id: "lookup-matches", time: at(5), title: row.status === "cancelled" ? "Run cancelled" : "Stopping run", entries: [note("lookup-stopped", 5, row.status === "cancelled" ? "Employee lookup cancelled after the search. No changes were made." : "Stopping the employee search. No changes were made.")] }];
      affectedId = "lookup-matches"; affectedState = "cancelled"; status = row.status === "cancelled" ? "Cancelled" : "Stopping"; label = "Employee lookup stopped"; break;
    case "running":
      steps = [...completed.slice(0, 2), { id: "lookup-matches", time: at(5), title: "Read matching employees", system: "UCPath", entries: [note("lookup-search-pending", 5, `Waiting for UCPath search results for ${subject}.`, "info")] }];
      affectedId = "lookup-matches"; affectedState = "active"; status = "Running"; label = "Searching for employee"; break;
    case "failed": {
      const decision: LogDecision = { title: "Search CRM employee record", state: "failed", message: "The CRM Search button could not be clicked.", attemptedAction: "Click Search after entering the employee ID", lastCompleted: "Employee ID entered in CRM", field: { label: "Employee ID", value: eid, outcome: "Entered" }, footer: "No changes were made", screenshots: [capture("UCPath", "Matching employee", at(14), "browser", identity, 340), capture("CRM", "Failed Search action", at(14), "browser", [["Employee ID", eid], ["Search button", "Not responding"]])], actions: [{ id: "retry-crm", label: "Retry search", primary: true, result: { title: "CRM search retry started", message: "Continued at Search CRM employee record.", tone: "info", continues: true } }] };
      const crm = completed[3];
      steps = [...completed.slice(0, 3), { ...crm, id: "lookup-crm-fields", entries: crm.entries.filter(entry => entry.kind === "fields") }, decisionStep("lookup-crm", 14, decision)];
      affectedId = "lookup-crm"; affectedState = "failed"; status = "Failed"; label = "CRM search failed"; break;
    }
    case "awaiting-approval": {
      const decision: LogDecision = { title: "Confirm the employee match", state: "review", message: `Confirm that ${subject} is the intended employee.`, comparison: [{ label: "Employee", expected: subject, observed: subject }, { label: "Employee ID", expected: "Not supplied", observed: eid }, { label: "Department", expected: "Campus Services", observed: "Campus Services" }], screenshots: [capture("UCPath", "Possible employee", at(18), "person", identity, 340)], footer: "Employee lookup is waiting for your decision", actions: [{ id: "approve-lookup-match", label: "Confirm match", primary: true, result: { title: "Employee match approved", message: `Continued to read employment for ${subject} · ${directIdentifierDisplay(eid)}.`, tone: "positive", continues: true } }, { id: "reject-lookup-match", label: "Reject match", result: { title: "Employee match rejected", message: "Returned to employee search.", tone: "info", continues: true } }] };
      steps = [...completed.slice(0, 5), decisionStep("lookup-confirm", 18, decision)];
      affectedId = "lookup-confirm"; affectedState = "waiting"; status = "Review"; label = "Employee match review"; break;
    }
    case "partial":
      steps = [...completed.slice(0, 8), { id: "lookup-dates", time: at(25), title: "Read CRM appointment dates", system: "CRM", entries: [fields("lookup-warning-dates", 25, "Appointment", [["Start date", "08/01/2026"], ["Expected end date", "Not supplied"]], "read", capture("CRM", "Appointment dates", at(25), "fields", [["Start date", "08/01/2026"], ["Expected end date", "Not supplied"]]))] }, decisionStep("lookup-dates-confirm", 29, { title: "Compare appointment dates", state: "held", message: "The expected end date is missing in CRM. Employee identity and active status are confirmed.", attemptedAction: "Compare the expected end date with UCPath", lastCompleted: "Read CRM appointment start date", field: { label: "Expected end date", value: "06/30/2027 in UCPath · not supplied in CRM", outcome: "Could not compare" }, screenshots: [capture("CRM", "Appointment dates", at(29), "browser", [["Start date", "08/01/2026"], ["Expected end date", "Not supplied"]])], footer: "Lookup completed with an appointment-date warning" })];
      affectedId = "lookup-dates-confirm"; affectedState = "waiting"; status = "Done with warnings"; label = "Appointment date warning"; break;
    case "done": break;
    case "blocked": throw new Error("log-lookup-write-parked-invalid");
  }
  const allIds: readonly string[] = LOOKUP_STAGES.flatMap(stage => stage.substeps.map(step => step.id));
  const affectedIndex = affectedId ? allIds.indexOf(affectedId) : stoppedBefore ? allIds.indexOf(stoppedBefore) : allIds.length;
  const timeline: readonly LogTimelineStage[] = LOOKUP_STAGES.map(stage => {
    const substeps = stage.substeps.map(step => {
      const index = allIds.indexOf(step.id);
      const state: LogTimelineState = index < affectedIndex ? "completed" : index === affectedIndex && affectedState ? affectedState : "pending";
      return { id: step.id, label: step.label, state, ...(state === "completed" ? { durationLabel: `${step.seconds}s` } : {}) };
    });
    const state: LogTimelineState = substeps.every(step => step.state === "completed") ? "completed" : substeps.find(step => !["completed", "pending"].includes(step.state))?.state ?? "pending";
    const destination = substeps.find(step => step.id === affectedId && steps.some(log => log.id === step.id)) ?? substeps.find(step => steps.some(log => log.id === step.id));
    return { id: stage.id, label: stage.label, state, time: at(stage.start), ...(state === "completed" ? { durationLabel: `${stage.substeps.reduce((sum, step) => sum + step.seconds, 0)}s` } : {}), ...(destination ? { stepId: destination.id } : {}), substeps };
  });
  return { id: `lookup-${row.status}`, label, subject, workflowLabel, status, steps, timeline, ...(affectedId && steps.some(step => step.id === affectedId) && ["failed", "awaiting-approval", "partial"].includes(row.status) ? { initialStepId: affectedId } : {}) };
}

const STATUS_SAMPLE: Record<QueueSurfaceWire["status"], string> = {
  queued: "empty", running: "reading", cancelling: "empty", done: "separation", failed: "failure-prepared",
  "awaiting-approval": "review-identity", blocked: "parked", cancelled: "cancelled", partial: "warning",
};
function separationMock({ row }: LogSelection): SelectedLogMock {
  const id = STATUS_SAMPLE[row.status];
  const sample = [...previewScenarios, ...decisionScenarios].find(item => item.id === id);
  if (!sample) throw new Error("log-selected-sample-missing");
  const subject = queueRowTitle(row);
  const replace = (value: string) => value.replaceAll("Alex Morgan", subject).replaceAll("Morgan, Alex", subject).replaceAll("DEMO-1042", `DEMO-${row.runId.slice(-4)}`);
  const formRows: readonly CaptureRow[] = [["Employee", subject], ["Employee ID", `DEMO-${row.runId.slice(-4)}`], ["Employment record", "0"], ["Effective date", "09/26/2026"], ["Last day worked", "09/25/2026"], ["Reason", "Resign – Accept Another Job"], ["Submission result", "Not confirmed"]];
  const screenshot = (shot: LogScreenshot, rows = formRows) => capture(shot.system ?? "UCPath", shot.label ?? "Captured page", shot.time, shot.kind ?? "browser", rows, shot.height);
  const steps = sample.steps.map(step => ({ ...step, entries: step.entries.map((entry): LogEntry => {
    if (entry.kind === "fields") return { ...entry, result: entry.result && replace(entry.result), fields: entry.fields.map(field => ({ ...field, value: replace(field.value) })), screenshots: entry.screenshots?.map(shot => screenshot(shot, entry.fields.map(field => [field.label, replace(field.value)]))) };
    if (entry.kind === "click") return { ...entry, screenshots: entry.screenshots?.map(shot => screenshot(shot)) };
    if (entry.kind === "note") return { ...entry, message: replace(entry.message) };
    const decision = entry.decision;
    return { ...entry, decision: { ...decision, message: decision.message && replace(decision.message), footer: decision.footer && replace(decision.footer), screenshots: decision.screenshots?.map(shot => screenshot(shot)), comparison: decision.comparison?.map(item => ({ ...item, expected: replace(item.expected), observed: replace(item.observed) })), actions: decision.actions?.map(action => ({ ...action, label: action.label.replace("with Alex", "with employee"), result: { ...action.result, message: replace(action.result.message) }, ...(action.input?.kind === "verification" ? { input: { ...action.input, question: replace(action.input.question) } } : {}) })) } };
  }) }));
  const initialStepId = steps.find(step => step.entries.some(entry => entry.kind === "decision"))?.id;
  const timeline: readonly LogTimelineStage[] = sample.timeline.map(stage => stage.substeps.some(step => step.id === initialStepId) ? { ...stage, stepId: initialStepId } : stage);
  return { ...sample, subject, workflowLabel: "Separations sample", steps, timeline, ...(initialStepId ? { initialStepId } : {}) };
}

/** Queue status chooses a fictional history; it never projects or records browser execution. */
export function selectedLogMock(selection: LogSelection): SelectedLogMock {
  const lookup = LOOKUP_STAGES.every(stage => selection.row.pipeline.some(node => node.id === stage.id));
  return lookup && selection.row.status !== "blocked" ? lookupMock(selection) : separationMock(selection);
}

export function continuedLookupTimeline(timeline: readonly LogTimelineStage[], actionId: string): readonly LogTimelineStage[] {
  if (!["approve-lookup-match", "retry-crm", "reject-lookup-match"].includes(actionId)) return timeline;
  const target = actionId === "approve-lookup-match" ? "lookup-job" : actionId === "retry-crm" ? "lookup-crm" : "lookup-search";
  const ordered = LOOKUP_STAGES.flatMap<{ id: string; label: string; seconds: number }>(stage => stage.substeps);
  const index = ordered.findIndex(step => step.id === target);
  return timeline.map(stage => {
    const substeps = stage.substeps.map(step => {
      const position = ordered.findIndex(item => item.id === step.id);
      const state: LogTimelineState = position < index ? "completed" : position === index ? "active" : "pending";
      return { id: step.id, label: step.label, state, ...(state === "completed" ? { durationLabel: `${ordered[position].seconds}s` } : {}) };
    });
    const state: LogTimelineState = substeps.every(step => step.state === "completed") ? "completed" : substeps.some(step => step.state === "active") ? "active" : "pending";
    return { ...stage, state, substeps, stepId: state === "pending" ? undefined : state === "active" ? target : stage.stepId, durationLabel: state === "completed" ? `${substeps.reduce((total, step) => total + Number.parseInt(step.durationLabel ?? "0", 10), 0)}s` : undefined };
  });
}
