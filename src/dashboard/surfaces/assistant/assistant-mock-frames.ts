import { EC_PEOPLE, MOCK_SCENES, decisionMock, fill, page, read, sepFile, sepRequest, sepTimecard, sepTimeline, sepVerify, stage, type MockGroup, type MockSceneData, type MockStep } from "../run-detail/decision-mock/decision-mock-model.js";

/** Design mock for the assistant plan; read only from the URL (`assistantMock=<frame id>`). People and values are fictional. */
export const OPERATOR = "Dana Whitfield";

export type ChatValue = Readonly<{ label: string; before?: string; after: string; source?: string }>;
export type PlanStep = Readonly<{ title: string; mode: string; subject?: string; values: readonly ChatValue[]; note?: string; state: "ready" | "running" | "done" | "stopped" | "not-run" | "blocked"; checked?: boolean }>;
export type ListRow = Readonly<{ lead: string; text: string; meta?: string; tone?: "danger" | "warning" | "positive" | "info"; icon?: "read" | "session" | "edit" | "confirm" | "refused"; link?: string }>;
export type ChatItem =
  | Readonly<{ kind: "you"; text: string; file?: string }>
  | Readonly<{ kind: "reply"; text: string }>
  | Readonly<{ kind: "nav"; text: string }>
  | Readonly<{ kind: "session"; label: string; state: "running" | "done" | "stopped"; meta?: string }>
  | Readonly<{ kind: "applied"; title: string; values: readonly ChatValue[]; undone?: boolean }>
  | Readonly<{ kind: "plan"; title: string; steps: readonly PlanStep[]; state: "review" | "running" | "stopped" | "blocked" | "started"; status?: string; evidence?: readonly ChatValue[]; primary?: string }>
  | Readonly<{ kind: "list"; title: string; meta?: string; rows: readonly ListRow[]; footer?: string }>
  | Readonly<{ kind: "table"; title: string; meta?: string; columns: readonly string[]; rows: readonly (readonly string[])[]; danger?: number; footer?: string }>
  | Readonly<{ kind: "ask"; text: string; choices: readonly string[] }>
  | Readonly<{ kind: "line"; text: string }>;
export type FrameToast = Readonly<{ tone: "info" | "success" | "warning" | "danger"; title: string; description?: string; action?: string; sticky?: boolean }>;
export type AssistantFrame = Readonly<{
  id: string; scenario: string; look: string; title: string; logs: MockSceneData;
  chat: readonly ChatItem[]; view?: "activity"; toasts?: readonly FrameToast[]; draft?: string; menu?: "effort";
}>;

const sep = (id: string, name: string, subject: string, state: MockSceneData["state"], queueMessage: string, steps: readonly MockStep[], timeline: MockSceneData["timeline"], extra: Partial<MockSceneData> = {}): MockSceneData =>
  ({ id, name, workflow: "separations", subject, state, queueMessage, steps, timeline, ...extra });

const lookupRunning: MockSceneData = { id: "a-lookup", name: "Read-only lookup", workflow: "person-lookup", subject: "Mensah, Kofi", state: "running", waited: "14s", queueMessage: "Read only · started by the assistant",
  steps: [
    { id: "search", time: "14:02:10", title: "Search for person", system: "UCPath", outcome: "Found Mensah, Kofi", blocks: [{ kind: "note", text: `Started by the assistant for ${OPERATOR} · read only` }, page("Person Organizational Summary", "Fill", [fill("Last name", "Mensah"), fill("First name", "Kofi")]), { kind: "click", label: "Search" }, page("Search results", "Read", [read("Employee ID", "10034736"), read("Name", "Mensah, Kofi")])] },
    { id: "status", time: "14:02:24", title: "Read employment status", system: "UCPath", current: true, blocks: [page("Workforce Job Summary", "Read", [read("Department", "Campus Dining Operations"), read("Job", "Food service worker")])] },
  ],
  timeline: [stage("search", "Search for person", "completed", { durationLabel: "14s" }), stage("crm", "Cross-check identity", "pending"), stage("status", "Read employment status", "active", { statusLabel: "Running" })] };

const lookupOrtega: MockSceneData = { id: "a-lookup-ortega", name: "Lookup done", workflow: "person-lookup", subject: "Ortega, Lin", state: "done", queueMessage: "Active · read only",
  steps: [
    { id: "search", time: "15:10:02", title: "Search for person", system: "UCPath", outcome: "Found Ortega, Lin", blocks: [{ kind: "note", text: `Started by the assistant for ${OPERATOR} · read only` }, page("Search results", "Read", [read("Employee ID", "10031877"), read("Name", "Ortega, Lin")])] },
    { id: "status", time: "15:10:19", title: "Read employment status", system: "UCPath", outcome: "Active", blocks: [page("Workforce Job Summary", "Read", [read("HR status", "Active"), read("Department", "Housing Operations"), read("Job", "Student assistant")])] },
  ],
  timeline: [stage("search", "Search for person", "completed", { durationLabel: "17s" }), stage("crm", "Cross-check identity", "completed", { durationLabel: "12s" }), stage("status", "Read employment status", "completed", { durationLabel: "9s" })] };

const ortegaDryRun = sep("a-dry", "Dry run stopped", "Ortega, Lin", "done", "Dry run · nothing filed", [
  { id: "request", time: "15:21:00", title: "Read separation request", system: "Kuali", outcome: "Request found", blocks: [{ kind: "note", text: `Dry run confirmed by ${OPERATOR} · started by the assistant` }, page("RRSS Separation Request", "Read", [read("Employee", "Ortega, Lin"), read("Employee ID", "10031877"), read("Last day worked", "04/29/2031"), read("Separation date", "04/30/2031")])] },
  { id: "employee", time: "15:21:13", title: "Verify employee", system: "UCPath", outcome: "Matches the request", blocks: [page("Workforce Job Summary", "Read", [read("Name", "Ortega, Lin"), read("HR status", "Active")])] },
  { id: "timecard", time: "15:21:24", title: "Read timecard", system: "Kronos", outcome: "Last punch differs from the request", blocks: [page("Timecard", "Read", [read("Last punch", "04/27/2031"), read("Sick or holiday leave", "None")])] },
  { id: "file", time: "15:21:40", title: "File termination", system: "UCPath", outcome: "Dry run: filled, not submitted", blocks: [page("Smart HR Template", "Fill", [fill("Template", "Termination"), fill("Effective date", "04/30/2031"), fill("Last day worked", "04/29/2031"), fill("Reason", "Resignation")])] },
], [stage("request", "Read request", "completed", { durationLabel: "13s" }), stage("employee", "Verify employee", "completed", { durationLabel: "11s" }), stage("timecard", "Read timecard", "completed", { durationLabel: "16s" }), stage("file", "File termination", "completed", { durationLabel: "38s" }), stage("finalize", "Finalize document", "completed", { durationLabel: "4s" })]);

const ecThree = ["Ortega, Lin", "Park, Joon", "Haddad, Rami"];
const ecThreeGroup: MockGroup = { title: "Scan_0412.pdf", subtitle: "12 people", selected: "member", members: EC_PEOPLE.map(name => ({ name, failed: ecThree.includes(name) })) };
const ecFailures: MockSceneData = { ...MOCK_SCENES.d9, id: "a-ec3", group: ecThreeGroup };
const renamedParent: MockSceneData = { ...MOCK_SCENES.d9p, id: "a-rename", group: { ...MOCK_SCENES.d9p.group!, title: "April contacts scan" } };

const verifyFailed = (blocks: MockStep["blocks"]): MockStep => ({ id: "verify", time: "09:33:50", title: "Verify termination", system: "UCPath", blocks: [page("Smart HR Transactions", "Read", [read("Transaction", "T00042871"), { label: "Status", value: "Couldn't read", kind: "read", unread: true }]), ...blocks] });
const resolved = sep("a-resolved", "Evidence resolved", "Nakamura, Rei", "running", "Finalize document", [sepRequest, sepVerify(false), sepTimecard, sepFile(false, []), { ...verifyFailed([]), outcome: "Termination confirmed from Smart HR Transactions" },
  { id: "evidence", time: "09:47:12", title: "Check Smart HR Transactions", system: "UCPath", outcome: "T00042871 approved; the run continued", blocks: [
    { kind: "note", text: `Checked by the assistant for ${OPERATOR} · read only` },
    page("Smart HR Transactions", "Read", [read("Transaction", "T00042871"), read("Type", "Termination"), read("Effective date", "04/25/2031"), read("Status", "Approved")])] },
  { id: "finalize", time: "09:47:30", title: "Finalize Kuali document", system: "Kuali", current: true, blocks: [page("RRSS Separation Request", "Fill", [fill("Comments", "Termination filed on UCPath as T00042871")])] },
], [...sepTimeline("completed").slice(0, 4), stage("finalize", "Finalize document", "active", { statusLabel: "Running" })], { waited: "6s" });
const sepDone = sep("a-sep-done", "Separation filed", "Nakamura, Rei", "done", "Saved as T00042871", [sepRequest, sepVerify(false), sepTimecard, sepFile(false, [])], sepTimeline("completed", undefined, "completed"));
const d8 = MOCK_SCENES.d8, d9 = MOCK_SCENES.d9, d9p = MOCK_SCENES.d9p, d2 = MOCK_SCENES.d2;

const sepPlanValues: readonly ChatValue[] = [
  { label: "HR status", before: "Active", after: "Terminated", source: "UCPath, read 15:10" },
  { label: "Effective date", after: "04/30/2031", source: "Kuali request SIM-50112" },
  { label: "Last day worked", after: "04/29/2031", source: "Kuali request SIM-50112" },
  { label: "Reason", after: "Resignation", source: "Kuali request SIM-50112" },
];
const sepPlanSteps = (dry: PlanStep["state"], real: PlanStep["state"]): readonly PlanStep[] => [
  { title: "Dry run", mode: "Separations · fills, saves nothing", subject: "Ortega, Lin  EID 10031877", values: sepPlanValues, state: dry, checked: true },
  { title: "Real run", mode: "Separations · files in UCPath, saves Kuali", subject: "Ortega, Lin  EID 10031877", values: [], note: "Same values. Runs only if the dry run matches them.", state: real, checked: true },
];

const frames: readonly AssistantFrame[] = [
  { id: "01-chat-basics", scenario: "Chat basics", look: "Answer from dashboard data; \"open today's EC failures\" just navigates (one quiet line, no card); fixed composer.", title: "This week", logs: d9, chat: [
    { kind: "you", text: "How many separations did we file this week?" },
    { kind: "reply", text: "**7 separations** this week: 6 done, 1 waiting on you (Rei Nakamura, the read-back failed after T00042871 saved)." },
    { kind: "you", text: "Open today's EC failures" },
    { kind: "nav", text: "Opened Emergency Contact · Failed · Today" },
    { kind: "reply", text: "1 failed today: **Lin Ortega**. UCPath rejected the phone number; nothing was saved." },
  ] },
  { id: "01b-model-effort", scenario: "Chat basics: pickers", look: "Model and effort pickers are editable; the effort menu lists Light, Medium, High, xHigh, Max.", title: "This week", logs: d9, draft: "Which of these can be retried today?", menu: "effort", chat: [
    { kind: "you", text: "Open today's EC failures" },
    { kind: "nav", text: "Opened Emergency Contact · Failed · Today" },
    { kind: "reply", text: "1 failed today: **Lin Ortega**. UCPath rejected the phone number; nothing was saved." },
  ] },
  { id: "02-read-only-session", scenario: "Read-only session", look: "Person Lookup starts without asking; \"Checking UCPath…\" chip with Stop; the run is in Queue and Logs, marked as started by the assistant.", title: "Kofi Mensah status", logs: lookupRunning, chat: [
    { kind: "you", text: "Is Kofi Mensah still active in UCPath?" },
    { kind: "reply", text: "I'll check UCPath. This is read only." },
    { kind: "session", label: "Checking UCPath…", state: "running", meta: "Person Lookup · Mensah, Kofi" },
  ] },
  { id: "03-apply-undo", scenario: "Apply + Undo", look: "A queue row rename and a library spreadsheet edit apply at once; each has an Undo line, and the latest shows an Undo toast.", title: "Tidy up", logs: renamedParent, toasts: [{ tone: "success", title: "Spreadsheet updated", description: "Separations tracker · row 65", action: "Undo" }], chat: [
    { kind: "you", text: "Rename Scan_0412.pdf to April contacts scan" },
    { kind: "applied", title: "Renamed run", values: [{ label: "Name", before: "Scan_0412.pdf", after: "April contacts scan" }] },
    { kind: "you", text: "In the separations tracker, Rei's last day worked should be 04/24, not 04/23" },
    { kind: "applied", title: "Updated Separations tracker", values: [{ label: "Fall 2031 · row 65", before: "04/23/2031", after: "04/24/2031", source: "Typed by you" }] },
  ] },
  { id: "04-plan-card", scenario: "Plan card", look: "\"separate Lin Ortega\": dry run then real run; exact values with before -> after and sources; approve all or one step.", title: "Separate Lin Ortega", logs: lookupOrtega, chat: [
    { kind: "you", text: "Separate Lin Ortega" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "Person Lookup · Ortega, Lin · 38s" },
    { kind: "reply", text: "Lin Ortega (EID 10031877) is Active. The Kuali request SIM-50112 asks for a resignation effective 04/30/2031. Here's the plan:" },
    { kind: "plan", title: "Separate Lin Ortega", steps: sepPlanSteps("ready", "ready"), state: "review", status: "Runs one step at a time and stops on anything unexpected." },
  ] },
  { id: "05-plan-stopped", scenario: "Plan running, then stopped", look: "Step 1 done, step 2 not run; the stop reason names the unexpected value and its source.", title: "Separate Lin Ortega", logs: ortegaDryRun, chat: [
    { kind: "plan", title: "Separate Lin Ortega", steps: sepPlanSteps("done", "not-run"), state: "stopped", status: "Stopped before step 2. Kronos shows a last punch on 04/27/2031; the plan says 04/29/2031. Nothing was filed." },
    { kind: "reply", text: "I stopped before the real run. Should the last day worked be **04/27/2031** (Kronos) or **04/29/2031** (Kuali request)?" },
  ] },
  { id: "06-manual-value-fixes", scenario: "Manual-value fixes", look: "3 rejected phones in one card; every new value names its source (PDF page, spreadsheet cell, typed by you); pick all or single people.", title: "EC phone fixes", logs: ecFailures, chat: [
    { kind: "you", text: "Fix the 3 phone numbers UCPath rejected and retry them" },
    { kind: "reply", text: "I found new numbers for two people. Haddad, Rami's scan is unreadable, so I used the number you typed earlier." },
    { kind: "plan", title: "Retry 3 emergency contacts", state: "review", primary: "Retry 3", status: "Nothing was saved for these people, so a retry files once.", steps: [
      { title: "Ortega, Lin", mode: "EID 10031877", values: [{ label: "Phone", before: "(619) 555-014", after: "(619) 555-0148", source: "Scan_0412.pdf · page 2" }], state: "ready", checked: true },
      { title: "Park, Joon", mode: "EID 10024056", values: [{ label: "Phone", before: "858-555-01", after: "(858) 555-0193", source: "Contacts.xlsx · Sheet1!D14" }], state: "ready", checked: true },
      { title: "Haddad, Rami", mode: "EID 10029175", values: [{ label: "Phone", before: "760555", after: "(760) 555-0127", source: "Typed by you · 13:42" }], state: "ready", checked: true },
    ] },
  ] },
  { id: "07-sourceless-refused", scenario: "Sourceless value refused", look: "Relay refuses a value with no source: a toast, and one line saying what to provide.", title: "EC phone fixes", logs: ecFailures, toasts: [{ tone: "warning", title: "Value needs a source", description: "Type the number, or name its PDF page or cell." }], chat: [
    { kind: "you", text: "Just put any valid number in for Silva" },
    { kind: "reply", text: "Relay won't file a phone number without a source. Type Ines Silva's number here, or tell me which PDF page or spreadsheet cell has it." },
  ] },
  { id: "08a-evidence-resolved", scenario: "Evidence-resolved decision", look: "Read-back failed -> the assistant checks Smart HR Transactions (chip) -> T00042871 found -> Relay resolves it; the evidence step sits in the log.", title: "Rei Nakamura", logs: resolved, chat: [
    { kind: "you", text: "Can you sort out Rei Nakamura's read-back?" },
    { kind: "session", label: "Checked Smart HR Transactions", state: "done", meta: "UCPath · read only · 11s" },
    { kind: "reply", text: "T00042871 is in Smart HR Transactions: termination, effective 04/25/2031, **Approved**. Relay accepted that as the read-back and the run is finalizing the Kuali document." },
  ] },
  { id: "08b-evidence-ambiguous", scenario: "Evidence ambiguous", look: "Two terminations found, so the assistant asks one line and leaves the decision in Logs.", title: "Rei Nakamura", logs: d8, chat: [
    { kind: "you", text: "Can you sort out Rei Nakamura's read-back?" },
    { kind: "session", label: "Checked Smart HR Transactions", state: "done", meta: "UCPath · read only · 12s" },
    { kind: "ask", text: "I found two terminations for 10431187. Which one is this run's?", choices: ["T00042871 · Pending", "T00042905 · Approved"] },
  ] },
  { id: "09-waiting-on-me", scenario: "\"What's waiting on me?\"", look: "One list, oldest first, each row opens its run.", title: "Waiting on me", logs: d2, chat: [
    { kind: "you", text: "What's waiting on me?" },
    { kind: "list", title: "Waiting on you", meta: "4", rows: [
      { lead: "Nakamura, Rei", text: "Separations · read-back failed", meta: "38 min", tone: "danger", link: "Open" },
      { lead: "Scan_0412.pdf", text: "Emergency Contact · 3 failed", meta: "31 min", tone: "danger", link: "Open" },
      { lead: "Morrow, Bea", text: "Person Lookup · pick the person", meta: "4 min", tone: "warning", link: "Open" },
      { lead: "Ortega, Lin", text: "Onboarding · approve the hire", meta: "3 min", tone: "warning", link: "Open" },
    ] },
  ] },
  { id: "10-duplicate-guard", scenario: "Duplicate guard", look: "A pending termination already exists, so the proposal is blocked with the evidence; Confirm is not offered.", title: "Rei Nakamura", logs: sepDone, chat: [
    { kind: "you", text: "Separate Rei Nakamura" },
    { kind: "plan", title: "Separate Rei Nakamura", state: "blocked", status: "Blocked: a termination for 10431187 is already pending.", steps: [{ title: "Real run", mode: "Separations", subject: "Nakamura, Rei  EID 10431187", values: [], state: "blocked" }],
      evidence: [{ label: "Transaction", after: "T00042871", source: "Smart HR Transactions" }, { label: "Status", after: "Pending" }, { label: "Filed", after: "Today 09:33 by Relay" }] },
  ] },
  { id: "11-activity", scenario: "Activity list", look: "Everything the assistant did today: reads, sessions, edits, confirms; each opens its log.", title: "Activity", logs: resolved, view: "activity", chat: [] },
  { id: "12-person-timeline", scenario: "Person timeline", look: "One person across workflows, newest first, each row opens its run.", title: "Lin Ortega", logs: d9, chat: [
    { kind: "you", text: "Show me everything we've done for Lin Ortega" },
    { kind: "list", title: "Ortega, Lin  EID 10031877", meta: "5 runs", rows: [
      { lead: "Today 15:21", text: "Separations · dry run", meta: "Done", tone: "positive", link: "Log" },
      { lead: "Today 13:20", text: "Emergency Contact · phone rejected", meta: "Failed", tone: "danger", link: "Log" },
      { lead: "04/12/2031", text: "Person Lookup · Active", meta: "Done", tone: "positive", link: "Log" },
      { lead: "08/02/2030", text: "Onboarding · hire filed", meta: "Done", tone: "positive", link: "Log" },
      { lead: "07/28/2030", text: "I-9 Check · section 2", meta: "Done", tone: "positive", link: "Log" },
    ] },
  ] },
  { id: "13-preflight", scenario: "Pre-flight before a batch", look: "Before proposing runs: missing EIDs, duplicates, already separated, out of scope; only the ready rows go forward.", title: "May separations", logs: sepDone, chat: [
    { kind: "you", text: "Separate everyone on this list", file: "May separations.xlsx" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "8 people · read only · 1m 12s" },
    { kind: "list", title: "Before I plan 8 separations", meta: "4 ready", rows: [
      { lead: "Row 6", text: "Kim, Ari · no EID, 2 people match", meta: "Missing EID", tone: "warning" },
      { lead: "Row 7", text: "Same person as row 3 (Reyes, Marco)", meta: "Duplicate", tone: "warning" },
      { lead: "Row 4", text: "Silva, Ines · terminated 03/30/2031", meta: "Already separated", tone: "info" },
      { lead: "Row 8", text: "Brooks, Dana · academic appointment", meta: "Out of scope", tone: "info" },
    ], footer: "Rows 1, 2, 3 and 5 are ready." },
    { kind: "reply", text: "Should I plan dry runs for the 4 ready people? Give me Ari Kim's EID and I'll add row 6." },
  ] },
  { id: "14-watching", scenario: "Watching runs", look: "The assistant watches a batch; a sticky toast with Open appears when a decision needs you.", title: "Separations batch", logs: d8, toasts: [{ tone: "warning", title: "Nakamura, Rei needs you", description: "Separations · the read-back failed", action: "Open", sticky: true }], chat: [
    { kind: "you", text: "Watch the separations batch and tell me when you need me" },
    { kind: "session", label: "Watching 3 Separations runs", state: "running", meta: "Read only" },
    { kind: "reply", text: "**Rei Nakamura** needs you: T00042871 saved, but Relay couldn't read its status back." },
  ] },
  { id: "15-error-patterns", scenario: "Workflow gap / error-pattern report", look: "Counts come from run data (labelled); the model only explains them.", title: "EC failures", logs: d9, chat: [
    { kind: "you", text: "Why does Emergency Contact keep failing?" },
    { kind: "table", title: "Emergency Contact · last 30 days", meta: "From run data", columns: ["Failure", "Runs", "Share"], rows: [["Phone format rejected", "11", "58%"], ["Contact already exists", "4", "21%"], ["UCPath session expired", "3", "16%"], ["Other", "1", "5%"]], footer: "19 of 214 runs failed" },
    { kind: "reply", text: "Most rejected phones are missing a digit: 9 of 11 came from handwritten scans read by OCR. Checking the phone length during PDF review would catch them before the run." },
  ] },
  { id: "16-cross-check", scenario: "Spreadsheet vs UCPath cross-check", look: "Only mismatches are listed, each with its cell and the UCPath value.", title: "Tracker check", logs: sepDone, chat: [
    { kind: "you", text: "Check the separations tracker against UCPath" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "40 people · read only · 4m 06s" },
    { kind: "table", title: "3 mismatches", meta: "37 of 40 agree", columns: ["Person", "Tracker", "UCPath"], rows: [["Nakamura, Rei", "D65 · 04/23/2031", "04/24/2031"], ["Okafor, Chinedu", "E12 · Resignation", "Retirement"], ["Tanaka, Yui", "C30 · Active", "Terminated"]], danger: 2 },
    { kind: "reply", text: "Want me to update the 3 tracker cells to match UCPath? That's a local edit you can undo." },
  ] },
  { id: "17-report-saved", scenario: "Report saved into the library", look: "The report lands in the Spreadsheets library at once, with Undo (line and toast).", title: "EC failures", logs: d9p, toasts: [{ tone: "success", title: "Saved to Spreadsheets", description: "EC failures October.xlsx", action: "Undo" }], chat: [
    { kind: "you", text: "Save that failure report to the library" },
    { kind: "applied", title: "Saved to Spreadsheets library", values: [{ label: "File", after: "EC failures October.xlsx" }, { label: "Rows", after: "19 failed runs" }] },
  ] },
  { id: "18-pdf-batch-prep", scenario: "PDF batch prep", look: "The assistant proposes the OCR start (never reads the PDF itself), then one proposal for the people you approved in review.", title: "Scan_0503.pdf", logs: d9p, chat: [
    { kind: "you", text: "Update emergency contacts from this scan", file: "Scan_0503.pdf" },
    { kind: "plan", title: "Read Scan_0503.pdf", state: "started", steps: [{ title: "OCR", mode: "Reads the PDF; you review the records", values: [{ label: "File", after: "Scan_0503.pdf · 11 pages" }], state: "done" }] },
    { kind: "reply", text: "You approved 9 of 10 records in review. Here's the update:" },
    { kind: "plan", title: "Emergency Contact for 9 people", state: "review", primary: "Approve dry run", status: "A dry run first; the real run is a second step.", steps: [{ title: "Dry run", mode: "Emergency Contact", values: [
      { label: "Okafor, Chinedu", after: "Okafor, Grace · Spouse", source: "page 1" }, { label: "Tanaka, Yui", after: "Tanaka, Ken · Parent", source: "page 2" }, { label: "Reyes, Marco", after: "Reyes, Ana · Sibling", source: "page 3" }, { label: "+ 6 more", after: "pages 4-11" }], state: "ready", checked: true }] },
  ] },
  { id: "19-end-of-day", scenario: "End-of-day summary", look: "Today in one card: runs by outcome, what is still open, what the assistant did.", title: "Today", logs: resolved, chat: [
    { kind: "you", text: "Wrap up today" },
    { kind: "list", title: "Today", meta: "23 runs", rows: [
      { lead: "19 done", text: "Separations 7 · Emergency Contact 9 · Person Lookup 3", tone: "positive" },
      { lead: "2 failed", text: "Ortega, Lin · Park, Joon (Emergency Contact)", tone: "danger", link: "Open" },
      { lead: "1 waiting", text: "Morrow, Bea · pick the person", tone: "warning", link: "Open" },
      { lead: "1 running", text: "Nakamura, Rei · finalizing", tone: "info" },
      { lead: "Assistant", text: "6 reads · 2 sessions · 3 edits · 2 confirmed", link: "Activity" },
    ], footer: "3 items carry over to tomorrow." },
  ] },
  { id: "20a-refusal", scenario: "Refusal with its real reason", look: "Relay refuses the Confirm; the toast and the resolved line give the real reason, not a generic error.", title: "Rei Nakamura", logs: d8, toasts: [{ tone: "warning", title: "Confirm refused", description: "T00042871 is still waiting for your answer in Logs." }], chat: [
    { kind: "you", text: "File Rei Nakamura's termination again" },
    { kind: "plan", title: "File termination again", state: "blocked", status: "Not done: T00042871 is still waiting for your answer in Logs.", steps: [{ title: "Real run", mode: "Separations · re-file", subject: "Nakamura, Rei  EID 10431187", values: [], state: "blocked" }] },
  ] },
  { id: "20b-no-reply", scenario: "No reply", look: "A message with no reply: a failure toast with Retry; the message stays in the composer.", title: "Kofi Mensah status", logs: lookupRunning, draft: "When did Kofi Mensah start?", toasts: [{ tone: "danger", title: "No reply", description: "Your message is kept.", action: "Retry" }], chat: [
    { kind: "you", text: "Is Kofi Mensah still active in UCPath?" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "Person Lookup · Mensah, Kofi · 41s" },
    { kind: "reply", text: "Yes. Kofi Mensah (EID 10034736) is **Active** in Campus Dining Operations." },
    { kind: "you", text: "When did Kofi Mensah start?" },
  ] },
];

export const ACTIVITY: readonly ListRow[] = [
  { lead: "09:47", text: "Checked Smart HR Transactions · Nakamura, Rei", icon: "session", link: "Log" },
  { lead: "09:46", text: "Resolved read-back · T00042871 approved", icon: "confirm", link: "Log" },
  { lead: "09:40", text: "Renamed run · Scan_0412.pdf → April contacts scan", icon: "edit", link: "Log" },
  { lead: "09:38", text: "Updated Separations tracker · row 65", icon: "edit", link: "Log" },
  { lead: "09:31", text: "Confirmed by you · Separations dry run · Ortega, Lin", icon: "confirm", link: "Log" },
  { lead: "09:20", text: "Person Lookup · Ortega, Lin · read only", icon: "session", link: "Log" },
  { lead: "09:12", text: "Refused · file again · Nakamura, Rei", icon: "refused", link: "Log" },
  { lead: "09:05", text: "Read Queue · Emergency Contact failures", icon: "read", link: "Log" },
];

export const ASSISTANT_FRAMES: readonly AssistantFrame[] = frames;

export function assistantFrame(): AssistantFrame | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("assistantMock");
  return frames.find(frame => frame.id === value);
}

/** The Logs scene for a decision or assistant mock frame. */
export function mockLogsScene(): MockSceneData | undefined {
  return assistantFrame()?.logs ?? decisionMock()?.scene;
}
