import type { LogScreenshot } from "../logs/log-feed-model.js";
import type { LogTimelineStage } from "../logs/log-timeline-model.js";
import type { DecisionChoiceOption } from "../logs/decision-card.js";

/** Design mock for the run-decision rules; read only from the URL (`decisionMock=d1`…`d16`, or `decisionMock=explorer`). */
export const DECISION_IDS = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d9p", "d10", "d11", "d12", "d13", "d14", "d15", "d16"] as const;
export type DecisionId = (typeof DECISION_IDS)[number];

export function decisionMock(): { scene?: MockSceneData } | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("decisionMock");
  if (value === "explorer") return {};
  const id = DECISION_IDS.find(item => item === value);
  return id ? { scene: MOCK_SCENES[id] } : undefined;
}

export type MockRow = Readonly<{ label: string; value: string; kind: "read" | "fill"; unread?: boolean }>;

/** Running counts the design mock shows in the workflow rail. */
export const MOCK_RAIL_RUNNING: Readonly<Record<string, number>> = { separations: 2, "emergency-contact": 1 };
export type MockTableRow = Readonly<{ id: string; cells: readonly string[]; name: string; tone?: "danger" }>;
export type MockTable = Readonly<{ title: string; label: string; columns: readonly string[]; rows: readonly MockTableRow[] }>;
export type MockBlock =
  | Readonly<{ kind: "page"; title: string; mode: "Fill" | "Read"; rows: readonly MockRow[] }>
  | Readonly<{ kind: "table"; mode: "Read"; table: MockTable }>
  | Readonly<{ kind: "click"; label: string }>
  | Readonly<{ kind: "capture"; shots: readonly LogScreenshot[]; submit?: boolean }>
  | Readonly<{ kind: "decision" }>;
export type MockStep = Readonly<{ id: string; time: string; title: string; system?: string; blocks: readonly MockBlock[]; outcome?: string; current?: boolean }>;

/** "None of these": the last pick option, with an input for the operator's own value. */
export type MockOther = Readonly<{ label: string; placeholder: string; sample: string; valid: (value: string) => boolean }>;
const otherEmployeeId: MockOther = { label: "Enter employee ID", placeholder: "8 digits", sample: "10000123", valid: value => /^\d{8}$/u.test(value) };
const otherRow: MockOther = { label: "Enter row number", placeholder: "Row", sample: "120", valid: value => /^[1-9]\d{0,4}$/u.test(value) };

export type MockInput = Readonly<{ label: string; value?: string; placeholder?: string; valid?: (value: string) => boolean }>;
export type MockChoiceOption = DecisionChoiceOption & Readonly<{ input?: MockInput }>;
/** The card's control: the candidate list stays a table; short choice lists are a dropdown; a typed value is an input. */
export type MockControl =
  | Readonly<{ kind: "pick"; table: MockTable; other: MockOther; extras?: readonly Readonly<{ id: string; label: string }>[] }>
  | Readonly<{ kind: "compare"; title: string; rows: readonly Readonly<{ label: string; requested: string; found: string }>[] }>
  | Readonly<{ kind: "choice"; label: string; value: string; options: readonly MockChoiceOption[] }>
  | Readonly<{ kind: "input"; input: MockInput }>;
/** Every manual choice is one card; `confirm` names the action only when no control holds the answer. */
export type MockDecision =
  | Readonly<{ kind: "card"; title: string; context?: string; tone?: "danger"; confirm?: string; control?: MockControl}>
  | Readonly<{ kind: "line"; text: string; icon: "cancelling" | "paused" }>;

export type MockState = "review" | "parked" | "failed" | "paused" | "stalled" | "cancelling";
export type MockSceneData = Readonly<{
  id: DecisionId; name: string; workflow: string; subject: string; state: MockState; waited?: string; queueMessage: string;
  steps: readonly MockStep[]; timeline: readonly LogTimelineStage[]; decision?: MockDecision; toast?: Readonly<{ title: string; description: string }>;
  headerRetry?: string; group?: MockGroup;
}>;
/** One parent run (the PDF) with one member run per person; `selected` is the run the Logs panel shows. */
export type MockGroup = Readonly<{ title: string; subtitle: string; selected: "parent" | Readonly<{ member: string }>; members: readonly Readonly<{ name: string; failed?: boolean }>[] }>;

const svg = (label: string, rows: readonly string[]) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#f4f6f8"/><rect width="800" height="64" fill="#1f4e79"/><text x="32" y="42" font-family="Arial,sans-serif" font-size="26" fill="#fff">${label}</text>${rows.map((row, index) => `<rect x="32" y="${100 + index * 80}" width="736" height="60" rx="4" fill="#fff" stroke="#c9d1d9"/><text x="52" y="${139 + index * 80}" font-family="Arial,sans-serif" font-size="24" fill="#2b3640">${row}</text>`).join("")}</svg>`)}`;
const shot = (logId: string, label: string, time: string, system: string, title: string, rows: readonly string[], boundary?: LogScreenshot["boundary"]): LogScreenshot => ({
  logId, label, time, boundary, src: svg(`${title} (fictional)`, rows), alt: `Fictional ${title} page`, width: 800, height: 450, kind: "browser", system,
});
const read = (label: string, value: string): MockRow => ({ label, value, kind: "read" });
const fill = (label: string, value: string): MockRow => ({ label, value, kind: "fill" });
const page = (title: string, mode: "Fill" | "Read", rows: readonly MockRow[]): MockBlock => ({ kind: "page", title, mode, rows });
const stage = (id: string, label: string, state: LogTimelineStage["state"], extra: Partial<LogTimelineStage> = {}): LogTimelineStage => ({ id, label, state, stepId: state === "pending" ? undefined : id, substeps: [], ...extra });
const decision: MockBlock = { kind: "decision" };

const PEOPLE: MockTable = { title: "Search results", label: "People found", columns: ["Name", "Employee ID", "Department", "HR status"], rows: [
  { id: "10000001", name: "Morrow, Bea A.", cells: ["Morrow, Bea A.", "10000001", "Campus Dining Operations", "Active"] },
  { id: "10000042", name: "Morrow, Bea", cells: ["Morrow, Bea", "10000042", "Housing Operations", "Active"] },
  { id: "10000077", name: "Morrow, Beatrice", cells: ["Morrow, Beatrice", "10000077", "HDH Catering", "On leave"] },
] };

const lookupSearch = (current: boolean): MockStep => ({ id: "search", time: "10:10:14", title: "Search for person", system: "UCPath", current, outcome: current ? undefined : "Found Morrow, Bea A.", blocks: [
  page("Person Organizational Summary", "Fill", [fill("Last name", "Morrow"), fill("First name", "Bea")]),
  { kind: "click", label: "Search" },
  ...(current ? [{ kind: "capture" as const, shots: [shot("search", "Search results", "10:10:21", "UCPath", "Search results", PEOPLE.rows.map(row => `${row.id}   ${row.name}`))] }, decision] : [page("Search results", "Read", [read("Employee ID", "10000001"), read("Name", "Morrow, Bea A."), read("Department", "Campus Dining Operations")])]),
] });
const lookupCrm = (current: boolean, blocks: readonly MockBlock[] = []): MockStep => ({ id: "crm", time: "10:14:02", title: "Cross-check identity", system: "CRM", current, outcome: current ? undefined : "Records agree", blocks: [
  page("CRM onboarding search", "Fill", [fill("Name", "Morrow, Bea A.")]), ...blocks,
] });
const lookupTimeline = (states: readonly LogTimelineStage["state"][], label?: string): readonly LogTimelineStage[] => [
  stage("search", "Search for person", states[0], { statusLabel: states[0] === "completed" ? undefined : label, durationLabel: states[0] === "completed" ? "18s" : undefined }),
  stage("crm", "Cross-check identity", states[1], { statusLabel: states[1] === "completed" ? undefined : label, durationLabel: states[1] === "completed" ? "18s" : undefined }),
  stage("status", "Read employment status", states[2], { statusLabel: states[2] === "completed" ? undefined : label }),
];

const sepRequest: MockStep = { id: "request", time: "09:31:00", title: "Read separation request", system: "Kuali", outcome: "Request found", blocks: [
  page("RRSS Separation Request", "Read", [read("Employee", "Nakamura, Rei"), read("Employee ID", "10431187"), read("Last day worked", "04/24/2031"), read("Separation date", "04/25/2031")]),
] };
const sepVerify = (current: boolean): MockStep => ({ id: "employee", time: "09:31:14", title: "Verify employee", system: "UCPath", current, outcome: current ? undefined : "Matches the request", blocks: [
  page("Workforce Job Summary", "Read", [read("Name", current ? "Nakamura, Rei J." : "Nakamura, Rei"), read("Department", current ? "Student Housing" : "Housing Operations"), read("HR status", "Active")]), ...(current ? [decision] : []),
] });
const sepTimecard: MockStep = { id: "timecard", time: "09:31:25", title: "Read timecard", system: "Kronos", outcome: "Last day worked confirmed", blocks: [page("Timecard", "Read", [read("Last punch", "04/24/2031"), read("Sick or holiday leave", "None")])] };
const sent = [fill("Template", "Termination"), fill("Effective date", "04/25/2031"), fill("Last day worked", "04/24/2031"), fill("Reason", "Appointment ended")];
const sepFile = (current: boolean, after: readonly MockBlock[]): MockStep => ({ id: "file", time: "09:32:17", title: "File termination", system: "UCPath", current, outcome: current ? undefined : "Saved as T00042871", blocks: [
  page("Smart HR Template", "Fill", sent), { kind: "click", label: "Save and submit" },
  { kind: "capture", submit: true, shots: [
    shot("before", "Before submit", "09:32:39", "UCPath", "Smart HR Template", ["Template: Termination", "Effective date: 04/25/2031", "Reason: Appointment ended"], "before-submit"),
    shot("after", "After submit", "09:33:41", "UCPath", "Smart HR Template", current ? ["Processing, please wait"] : ["Saved. Transaction T00042871"], "after-submit"),
  ] }, ...after,
] });
const sepTimeline = (fileState: LogTimelineStage["state"], label?: string, later: LogTimelineStage["state"] = "pending", laterLabel?: string): readonly LogTimelineStage[] => [
  stage("request", "Read request", "completed", { durationLabel: "14s" }), stage("employee", "Verify employee", "completed", { durationLabel: "11s" }),
  stage("timecard", "Read timecard", "completed", { durationLabel: "44s" }), stage("file", "File termination", fileState, { statusLabel: label, durationLabel: fileState === "completed" ? "1m 24s" : undefined }),
  stage("finalize", "Finalize document", later, { statusLabel: laterLabel }),
];
const parkedAnswer: MockDecision = { kind: "card", title: "Did the termination save in UCPath?", context: "Submit did not confirm. Check Smart HR Transactions for 10431187.", control: { kind: "choice", label: "Answer", value: "saved", options: [
  { value: "saved", label: "Saved in UCPath", hint: "Enter its transaction number; the run continues", input: { label: "Transaction number", placeholder: "T00000000", valid: value => /^T\d{8}$/u.test(value) } },
  { value: "again", label: "Not saved, file it again", hint: "Relay files the termination once more" },
] } };
const readBackFailed: MockDecision = { kind: "card", tone: "danger", title: "Termination saved, but the read-back failed", context: "UCPath accepted T00042871, but Relay could not read its status in Smart HR Transactions.", control: { kind: "choice", label: "Next step", value: "check", options: [
  { value: "check", label: "Check again", hint: "Reads Smart HR Transactions again; files nothing" },
  { value: "by-hand", label: "Checked by hand, continue", hint: "You saw T00042871 in UCPath; the run finishes" },
  { value: "withdrawn", label: "Withdrawn in UCPath, file again", hint: "Relay proves T00042871 is gone, then files once" },
  { value: "failed", label: "Mark as failed", hint: "Ends this person's run as failed; files nothing" },
] } };

const EC_PEOPLE = ["Ali, Samir", "Ortega, Lin", "Park, Joon", "Nguyen, Thao", "Brooks, Dana", "Haddad, Rami", "Silva, Ines", "Kowalski, Eva", "Mensah, Kofi", "Tanaka, Yui", "Reyes, Marco", "Okafor, Chinedu"];
const ecGroup = (selected: MockGroup["selected"], failed: readonly string[] = ["Ortega, Lin"]): MockGroup => ({ title: "Scan_0412.pdf", subtitle: "12 people", selected, members: EC_PEOPLE.map(name => ({ name, failed: failed.includes(name) })) });
const ecMemberSteps = (name: string, eid: string, phone: string, result: readonly string[], time = "13:20"): readonly MockStep[] => [
  { id: "navigation", time: `${time}:11`, title: "Read existing contacts", system: "UCPath", outcome: "No matching contact", blocks: [page("Emergency Contacts", "Read", [read("Employee", name), read("Employee ID", eid), read("Existing contacts", "1")])] },
  { id: "fill-form", time: `${time}:24`, title: "Fill emergency contact", system: "UCPath", outcome: "Contact filled", blocks: [page("Emergency Contact", "Fill", [fill("Contact", `${name.split(",")[0]}, Maya`), fill("Relationship", "Parent"), fill("Phone", phone)])] },
  { id: "save", time: `${time}:40`, title: "Save emergency contact", system: "UCPath", current: true, blocks: [{ kind: "click", label: "Save" },
    { kind: "capture", shots: [shot("save", "After save", `${time}:42`, "UCPath", "Emergency Contact", result, "after-submit")] }, decision] },
];
const ecMemberTimeline = [stage("navigation", "Read existing contacts", "completed", { durationLabel: "13s" }), stage("fill-form", "Fill emergency contact", "completed", { durationLabel: "16s" }), stage("save", "Save emergency contact", "failed", { statusLabel: "Failed" })];

const scenes: readonly MockSceneData[] = [
  { id: "d1", name: "Identity mismatch", workflow: "separations", subject: "Nakamura, Rei", state: "review", waited: "6 min", queueMessage: "Waiting on identity review",
    steps: [sepRequest, sepVerify(true)], timeline: [stage("request", "Read request", "completed", { durationLabel: "14s" }), stage("employee", "Verify employee", "waiting", { statusLabel: "Waiting for you" }), stage("timecard", "Read timecard", "pending"), stage("file", "File termination", "pending"), stage("finalize", "Finalize document", "pending")],
    decision: { kind: "card", title: "Is this the right person?", context: "The name and department in UCPath differ from the request.", confirm: "Approve match", control: { kind: "compare", title: "Request and UCPath", rows: [{ label: "Name", requested: "Nakamura, Rei", found: "Nakamura, Rei J." }, { label: "Employee ID", requested: "10431187", found: "10431187" }, { label: "Department", requested: "Housing Operations", found: "Student Housing" }] } } },
  { id: "d2", name: "Pick one of N people", workflow: "person-lookup", subject: "Morrow, Bea", state: "review", waited: "4 min", queueMessage: "Waiting for you to pick the person",
    steps: [lookupSearch(true)], timeline: lookupTimeline(["waiting", "pending", "pending"], "Waiting for you"),
    decision: { kind: "card", title: "Which Bea Morrow is this run about?", context: "UCPath found 3 people with this name.", control: { kind: "pick", table: PEOPLE, other: otherEmployeeId } } },
  { id: "d3", name: "Pick a record row", workflow: "onboarding", subject: "Ortega, Lin", state: "review", waited: "2 min", queueMessage: "Waiting for you to choose the roster row",
    steps: [{ id: "crm", time: "11:02:40", title: "Read CRM roster", system: "CRM", current: true, blocks: [page("Onboarding roster", "Read", [read("Rows read", "212"), read("Rows for Ortega, Lin", "2")]), decision] }],
    timeline: [stage("crm", "Read CRM roster", "waiting", { statusLabel: "Waiting for you" }), stage("hire", "Prepare hire", "pending"), stage("submit", "Submit hire", "pending")],
    decision: { kind: "card", title: "Which roster row is Lin Ortega's hire?", context: "The roster has 2 rows for Lin Ortega.", control: { kind: "pick", table: { title: "Onboarding roster", label: "Roster rows", columns: ["Row", "Department", "Start date", "Position"], rows: [
      { id: "14", name: "row 14", cells: ["14", "Housing Operations", "08/02/2031", "Student assistant"] },
      { id: "87", name: "row 87", cells: ["87", "Campus Dining", "09/01/2031", "Food service worker"] },
    ] }, other: otherRow } } },
  { id: "d4", name: "Review before write", workflow: "onboarding", subject: "Ortega, Lin", state: "review", waited: "3 min", queueMessage: "Waiting for you to approve the hire",
    steps: [{ id: "crm", time: "11:02:40", title: "Read CRM roster", system: "CRM", outcome: "Row 14 chosen", blocks: [page("Onboarding roster", "Read", [read("Row", "14"), read("Start date", "08/02/2031")])] },
      { id: "hire", time: "11:04:05", title: "Prepare hire", system: "UCPath", current: true, blocks: [page("Hire template", "Fill", [fill("Employee", "Ortega, Lin"), fill("Effective date", "08/02/2031"), fill("Job code", "004722"), fill("Department", "Housing Operations")]), decision] }],
    timeline: [stage("crm", "Read CRM roster", "completed", { durationLabel: "22s" }), stage("hire", "Prepare hire", "waiting", { statusLabel: "Waiting for you" }), stage("submit", "Submit hire", "pending")],
    decision: { kind: "card", title: "Submit this hire?", context: "Nothing is sent to UCPath until you approve.", confirm: "Approve and submit" } },
  { id: "d5", name: "Write parked", workflow: "separations", subject: "Nakamura, Rei", state: "parked", waited: "12 min", queueMessage: "The termination submit did not confirm",
    steps: [sepRequest, sepVerify(false), sepTimecard, sepFile(true, [decision])], timeline: sepTimeline("parked"), decision: parkedAnswer },
  { id: "d6", name: "Uncertain submit after a crash", workflow: "separations", subject: "Nakamura, Rei", state: "parked", waited: "9 min", queueMessage: "The Kuali save may have gone through",
    steps: [sepRequest, sepVerify(false), sepTimecard, sepFile(false, []), { id: "finalize", time: "09:34:02", title: "Finalize Kuali document", system: "Kuali", current: true, blocks: [page("RRSS Separation Request", "Fill", [fill("Final pay", "Workflow routed"), fill("Comments", "Termination filed on UCPath as T00042871")]), { kind: "click", label: "Save" }, decision] }],
    timeline: sepTimeline("completed", undefined, "parked"),
    decision: { kind: "card", title: "Did the separation document save in Kuali?", context: "Save did not confirm. Check document SIM-48216 in Kuali.", control: { kind: "choice", label: "Answer", value: "saved", options: [
      { value: "saved", label: "Saved in Kuali", hint: "The run continues to the next step" },
      { value: "again", label: "Not saved, save it again", hint: "Relay saves the document once more" },
    ] } } },
  { id: "d7", name: "Failed, safe to retry", workflow: "person-lookup", subject: "Morrow, Bea", state: "failed", queueMessage: "CRM search could not be completed",
    steps: [lookupSearch(false), lookupCrm(true, [decision])], timeline: lookupTimeline(["completed", "failed", "pending"], "Failed"),
    decision: { kind: "card", tone: "danger", title: "CRM search could not be completed", context: "The CRM search page did not load after one retry. Nothing was written.", confirm: "Retry step" } },
  { id: "d8", name: "Failed after a confirmed write", workflow: "separations", subject: "Nakamura, Rei", state: "failed", queueMessage: "Termination saved, read-back failed",
    steps: [sepRequest, sepVerify(false), sepTimecard, sepFile(false, []), { id: "verify", time: "09:33:50", title: "Verify termination", system: "UCPath", current: true, blocks: [page("Smart HR Transactions", "Read", [read("Transaction", "T00042871"), { label: "Status", value: "Couldn't read", kind: "read", unread: true }]), decision] }],
    timeline: sepTimeline("failed", "Failed"),
    decision: readBackFailed },
  { id: "d9", name: "Emergency Contact member failed", workflow: "emergency-contact", subject: "Ortega, Lin", state: "failed", queueMessage: "Phone number rejected", headerRetry: "Retry Ortega, Lin", group: ecGroup({ member: "Ortega, Lin" }),
    steps: ecMemberSteps("Ortega, Lin", "10031877", "(619) 555-014", ["Phone: (619) 555-014", "Invalid phone number format"]), timeline: ecMemberTimeline,
    decision: { kind: "card", tone: "danger", title: "Emergency contact could not be saved", context: "UCPath rejected the phone number format. Nothing was saved.", control: { kind: "input", input: { label: "Phone to retry with", value: "(619) 555-014" } } } },
  { id: "d9p", name: "Emergency Contact PDF parent", workflow: "emergency-contact", subject: "Scan_0412.pdf", state: "failed", queueMessage: "Member runs finished", group: ecGroup("parent"),
    steps: [
      { id: "read", time: "13:02:05", title: "Read document", system: "OCR", outcome: "12 records read", blocks: [page("Scan_0412.pdf", "Read", [read("Pages", "14"), read("Records found", "12")])] },
      { id: "review", time: "13:06:30", title: "Review records", outcome: "12 records approved", blocks: [] },
      { id: "members", time: "13:06:31", title: "Start member runs", outcome: "12 member runs started", blocks: [{ kind: "table", mode: "Read", table: { title: "Approved records", label: "Approved records", columns: ["Person", "Employee ID", "Page"],
        rows: EC_PEOPLE.map((name, index) => ({ id: String(index), name, cells: [name, String(10022310 + index * 1373), String(index + 1 + (index > 5 ? 2 : 0))] })) } }] },
    ],
    timeline: [stage("read", "Read document", "completed", { durationLabel: "4m 25s" }), stage("review", "Review records", "completed", { durationLabel: "3m 10s" }), stage("members", "Member runs", "failed", { statusLabel: "1 failed" })] },
  { id: "d10", name: "Correct a value", workflow: "emergency-contact", subject: "Ortega, Lin", state: "review", waited: "1 min", queueMessage: "Waiting for you to correct a value",
    steps: [{ id: "read", time: "13:04:33", title: "Read scanned form", system: "OCR", current: true, blocks: [page("Scanned page 3", "Read", [read("Employee name", "Ortega, Lin"), read("Employee ID", "1003187"), read("Contact", "Ortega, Maya")]), { kind: "capture", shots: [shot("scan", "Page 3", "13:04:35", "OCR", "Emergency contact form", ["Employee ID: 1003187?", "Contact: Ortega, Maya"])] }, decision] }],
    timeline: [stage("read", "Read forms", "waiting", { statusLabel: "Waiting for you" }), stage("members", "Update contacts", "pending"), stage("report", "Report", "pending")],
    decision: { kind: "card", title: "What is Lin Ortega's employee ID?", context: "The scan shows 7 digits; employee IDs have 8.", control: { kind: "input", input: { label: "Employee ID", value: "1003187", valid: value => /^\d{8}$/u.test(value) } } } },
  { id: "d11", name: "Workbook row ambiguous", workflow: "separations", subject: "Nakamura, Rei", state: "review", waited: "2 min", queueMessage: "Waiting for you to choose the workbook row",
    steps: [sepRequest, { id: "workbook", time: "09:35:10", title: "Write results to workbook", system: "SharePoint", current: true, blocks: [page("Separations tracker", "Read", [read("Sheet", "Fall 2031"), read("Rows for 10431187", "2")]), decision] }],
    timeline: [stage("request", "Read request", "completed", { durationLabel: "14s" }), stage("workbook", "Write workbook", "waiting", { statusLabel: "Waiting for you" }), stage("finalize", "Finalize document", "pending")],
    decision: { kind: "card", title: "Which row should Relay update?", context: "The tracker has 2 rows for 10431187.", control: { kind: "pick", table: { title: "Separations tracker", label: "Workbook rows", columns: ["Row", "Name", "Last updated"], rows: [
      { id: "12", name: "row 12", cells: ["12", "Nakamura, Rei", "04/01/2031"] },
      { id: "65", name: "row 65", cells: ["65", "Nakamura, Rei J.", "04/20/2031"] },
    ] }, extras: [{ id: "new", label: "Add a new row" }], other: otherRow } } },
  { id: "d12", name: "Sign-in or Duo needed", workflow: "person-lookup", subject: "Morrow, Bea", state: "review", waited: "1 min", queueMessage: "Waiting for you to sign in to CRM",
    steps: [lookupSearch(false), lookupCrm(true, [decision])], timeline: lookupTimeline(["completed", "waiting", "pending"], "Sign in"),
    decision: { kind: "card", title: "Sign in to CRM to continue", context: "The CRM session expired. The run continues after you approve Duo.", confirm: "Open CRM sign-in" } },
  { id: "d13", name: "Run paused", workflow: "person-lookup", subject: "Morrow, Bea", state: "paused", queueMessage: "Paused after Cross-check identity",
    steps: [lookupSearch(false), { ...lookupCrm(false, [decision]), current: true }], timeline: lookupTimeline(["completed", "completed", "pending"]),
    decision: { kind: "card", title: "Paused after Cross-check identity", context: "Read employment status starts when you resume.", confirm: "Resume" } },
  { id: "d14", name: "Run stalled", workflow: "person-lookup", subject: "Morrow, Bea", state: "stalled", waited: "6 min", queueMessage: "No progress for 6 minutes",
    steps: [lookupSearch(false), lookupCrm(false), { id: "status", time: "10:14:20", title: "Read employment status", system: "UCPath", current: true, blocks: [decision] }], timeline: lookupTimeline(["completed", "completed", "failed"], "No progress"),
    decision: { kind: "card", tone: "danger", title: "The worker stopped answering", context: "Recover restarts from Read employment status. Nothing was written.", confirm: "Recover" } },
  { id: "d15", name: "Command refused", workflow: "separations", subject: "Nakamura, Rei", state: "parked", waited: "13 min", queueMessage: "The termination submit did not confirm",
    steps: [sepRequest, sepVerify(false), sepTimecard, sepFile(true, [decision])], timeline: sepTimeline("parked"), decision: parkedAnswer,
    toast: { title: "Rerun refused", description: "Answer the parked termination first." } },
  { id: "d16", name: "Cancel requested", workflow: "person-lookup", subject: "Morrow, Bea", state: "cancelling", queueMessage: "Cancelling",
    steps: [lookupSearch(false), lookupCrm(true, [decision])], timeline: lookupTimeline(["completed", "cancelling", "pending"]),
    decision: { kind: "line", icon: "cancelling", text: "Cancelling. The run stops when the CRM page closes." } },
];
export const MOCK_SCENES = Object.fromEntries(scenes.map(scene => [scene.id, scene])) as Readonly<Record<DecisionId, MockSceneData>>;
