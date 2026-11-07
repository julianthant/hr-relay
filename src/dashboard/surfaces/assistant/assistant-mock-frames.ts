import type { DecisionAnswered, DecisionSuggestion } from "../run-detail/logs/decision-card.js";
import { EC_PEOPLE, MOCK_SCENES, decisionMock, ecGroup, ecMemberSteps, fill, page, read, sepFile, sepRequest, sepTimecard, sepTimeline, sepVerify, stage, type MockGroup, type MockSceneData, type MockStep, type MockTable } from "../run-detail/decision-mock/decision-mock-model.js";

/** Design mock for the assistant plan; read only from the URL (`assistantMock=<frame id>`). People and values are fictional. */
export const OPERATOR = "Alex Rivera";

/** One value change: label, old -> new; `source` only when it differs from the table's shared source. */
export type Change = Readonly<{ label: string; before?: string; after: string; source?: string }>;
/** Sequential steps are numbered; their state shows once the plan has run. */
export type ProposalStep = Readonly<{ title: string; detail: string; state?: "done" | "not-run" }>;
export type Proposal = Readonly<{
  title: string; state: "review" | "stopped" | "blocked" | "applied";
  steps?: readonly ProposalStep[]; changes?: Readonly<{ title: string; source?: string; rows: readonly Change[]; pick?: boolean }>;
  confirm?: string; reason?: string; evidence?: string;
}>;
export type ListRow = Readonly<{ lead: string; text: string; meta?: string; tone?: "danger" | "warning" | "positive" | "info"; icon?: "read" | "session" | "edit" | "confirm" | "refused"; link?: string }>;
export type ChatItem =
  | Readonly<{ kind: "you"; text: string; file?: string }>
  | Readonly<{ kind: "reply"; text: string }>
  | Readonly<{ kind: "nav"; text: string }>
  | Readonly<{ kind: "session"; label: string; state: "running" | "done"; meta?: string }>
  | Readonly<{ kind: "proposal"; proposal: Proposal }>
  | Readonly<{ kind: "started"; text: string }>
  | Readonly<{ kind: "list"; title: string; meta?: string; rows: readonly ListRow[] }>
  | Readonly<{ kind: "table"; table: MockTable }>
  | Readonly<{ kind: "ask"; text: string; choices: readonly string[] }>;
export type FrameToast = Readonly<{ tone: "info" | "success" | "warning" | "danger"; title: string; description?: string; action?: string; sticky?: boolean }>;
export type AssistantFrame = Readonly<{
  id: string; scenario: string; look: string; changed: string; title: string; logs: MockSceneData;
  chat: readonly ChatItem[]; view?: "activity"; toasts?: readonly FrameToast[]; draft?: string; menu?: "effort";
}>;

const answeredCard = (scene: MockSceneData, answered: DecisionAnswered): MockSceneData["decision"] => scene.decision?.kind === "card" ? { ...scene.decision, answered } : scene.decision;
const suggestedCard = (scene: MockSceneData, suggestion: DecisionSuggestion): MockSceneData["decision"] => scene.decision?.kind === "card" ? { ...scene.decision, suggestion } : scene.decision;
const table = (title: string, mode: string, columns: readonly string[], rows: readonly (readonly string[])[], danger = false): MockTable =>
  ({ title, label: title, mode, columns, rows: rows.map(cells => ({ id: cells[0], name: cells[0], cells, tone: danger ? "danger" as const : undefined })) });

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
const ecThreeGroup: MockGroup = { title: "Scan_0412.pdf", subtitle: "12 people", selected: { member: "Ortega, Lin" }, members: EC_PEOPLE.map(name => ({ name, failed: ecThree.includes(name) })) };
const ecFailures: MockSceneData = { ...MOCK_SCENES.d9, id: "a-ec3", group: ecThreeGroup };
const renamedParent: MockSceneData = { ...MOCK_SCENES.d9p, id: "a-rename", subject: "April contacts scan", group: { ...MOCK_SCENES.d9p.group!, title: "April contacts scan" } };

const verifyFailed = (blocks: MockStep["blocks"]): MockStep => ({ id: "verify", time: "09:33:50", title: "Verify termination", system: "UCPath", blocks: [page("Smart HR Transactions", "Read", [read("Transaction", "T00042871"), { label: "Status", value: "Couldn't read", kind: "read", unread: true }]), ...blocks] });
const resolved = sep("a-resolved", "Evidence resolved", "Nakamura, Rei", "running", "Finalize document", [sepRequest, sepVerify(false), sepTimecard, sepFile(false, []), verifyFailed([{ kind: "decision" }]),
  { id: "evidence", time: "09:47:12", title: "Check Smart HR Transactions", system: "UCPath", outcome: "T00042871 approved; the run continued", blocks: [
    { kind: "note", text: `Checked by the assistant for ${OPERATOR} · read only` },
    page("Smart HR Transactions", "Read", [read("Transaction", "T00042871"), read("Type", "Termination"), read("Effective date", "04/25/2031"), read("Status", "Approved")])] },
  { id: "finalize", time: "09:47:30", title: "Finalize Kuali document", system: "Kuali", current: true, blocks: [page("RRSS Separation Request", "Fill", [fill("Comments", "Termination filed on UCPath as T00042871")])] },
], [...sepTimeline("completed").slice(0, 4), stage("finalize", "Finalize document", "active", { statusLabel: "Running" })], { waited: "6s", decision: answeredCard(MOCK_SCENES.d8, { choice: "Saved, T00042871 approved", time: "09:47:12", by: `assistant on behalf of ${OPERATOR}` }) });
const sepDone = sep("a-sep-done", "Separation filed", "Nakamura, Rei", "done", "Saved as T00042871", [sepRequest, sepVerify(false), sepTimecard, sepFile(false, [])], sepTimeline("completed", undefined, "completed"));
const d8 = MOCK_SCENES.d8, d9 = MOCK_SCENES.d9, d9p = MOCK_SCENES.d9p, d2 = MOCK_SCENES.d2, d9b = MOCK_SCENES.d9b;
const ecSuggested: MockSceneData = { ...ecFailures, id: "a-ec3-suggest", decision: suggestedCard(ecFailures, { option: "(619) 555-0148", evidence: "Scan_0412.pdf, page 2" }) };
const ecSilva: MockSceneData = { ...d9, id: "a-ec-silva", subject: "Silva, Ines", headerRetry: "Retry Silva, Ines", group: ecGroup({ member: "Silva, Ines" }, ["Silva, Ines"]),
  steps: ecMemberSteps("Silva, Ines", "10027415", "555-01", ["Phone: 555-01", "Invalid phone number format"], "13:24") };
const batchSuggested: MockSceneData = { ...d9b, id: "a-batch", decision: suggestedCard(d9b, { option: "Retry", evidence: "UCPath answered again at 13:30; nothing was saved for these 3" }) };

const sepPlan = (dry?: ProposalStep["state"], real?: ProposalStep["state"]): readonly ProposalStep[] => [
  { title: "Dry run", detail: "fills, saves nothing", state: dry },
  { title: "Real run", detail: "files in UCPath · after the dry run matches", state: real },
];
const sepChanges = { title: "UCPath job", source: "From Kuali SIM-50112", rows: [
  { label: "HR status", before: "Active", after: "Terminated", source: "UCPath" },
  { label: "Effective date", after: "04/30/2031" },
  { label: "Last day worked", after: "04/29/2031" },
  { label: "Reason", after: "Resignation" },
] };

const frames: readonly AssistantFrame[] = [
  { id: "01-chat-basics", scenario: "Chat basics", look: "Answer from dashboard data; \"open today's EC failures\" navigates with one quiet line; one-line composer.", changed: "Docked panel; blue primary.", title: "This week", logs: d9, chat: [
    { kind: "you", text: "How many separations did we file this week?" },
    { kind: "reply", text: "**7**: 6 done, 1 waiting on you (Rei Nakamura)." },
    { kind: "you", text: "Open today's EC failures" },
    { kind: "nav", text: "Opened Emergency Contact · Failed · Today" },
  ] },
  { id: "01b-model-effort", scenario: "Chat basics: pickers", look: "Model and effort pickers are editable (Light, Medium, High, xHigh, Max).", changed: "Docked panel.", title: "This week", logs: d9, draft: "Which of these can be retried?", menu: "effort", chat: [
    { kind: "you", text: "Open today's EC failures" },
    { kind: "nav", text: "Opened Emergency Contact · Failed · Today" },
  ] },
  { id: "02-read-only-session", scenario: "Read-only session", look: "Person Lookup starts without asking; the session chip has a rounded Stop; the run is in Queue and Logs.", changed: "Chip spacing; Stop is a pill; no \"This is read only\" reply.", title: "Kofi Mensah", logs: lookupRunning, chat: [
    { kind: "you", text: "Is Kofi Mensah still active in UCPath?" },
    { kind: "session", label: "Checking UCPath…", state: "running", meta: "Person Lookup · Mensah, Kofi" },
  ] },
  { id: "03-apply-undo", scenario: "Apply + Undo", look: "A run rename and a spreadsheet edit apply at once, each with Undo; the latest shows an Undo toast left of the panel.", changed: "Edits use the Proposal card; toast moved left of the panel.", title: "Tidy up", logs: renamedParent, toasts: [{ tone: "success", title: "Spreadsheet updated", description: "Separations tracker · row 65", action: "Undo" }], chat: [
    { kind: "you", text: "Rename Scan_0412.pdf to April contacts scan" },
    { kind: "proposal", proposal: { title: "Renamed run", state: "applied", changes: { title: "Queue", rows: [{ label: "Name", before: "Scan_0412.pdf", after: "April contacts scan" }] } } },
    { kind: "you", text: "Rei's last day worked in the tracker should be 04/24" },
    { kind: "proposal", proposal: { title: "Updated Separations tracker", state: "applied", changes: { title: "Fall 2031 · row 65", source: "Typed by you", rows: [{ label: "Last day worked", before: "04/23/2031", after: "04/24/2031" }] } } },
  ] },
  { id: "04-plan-card", scenario: "Plan card", look: "\"Separate Lin Ortega\": numbered dry run then real run, values once with one shared source, Approve / Cancel.", changed: "One Proposal card on DecisionCard; no checkboxes for dependent steps; no footer text.", title: "Separate Lin Ortega", logs: lookupOrtega, chat: [
    { kind: "you", text: "Separate Lin Ortega" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "Person Lookup · Ortega, Lin · 38s" },
    { kind: "proposal", proposal: { title: "Separate Lin Ortega · EID 10031877", state: "review", confirm: "Approve", steps: sepPlan(), changes: sepChanges } },
  ] },
  { id: "05-plan-stopped", scenario: "Plan stopped", look: "Step 1 done, step 2 not run; the reason, then Retry from this step / Cancel plan.", changed: "Stop reason + DecisionCard actions; no follow-up question.", title: "Separate Lin Ortega", logs: ortegaDryRun, chat: [
    { kind: "proposal", proposal: { title: "Separate Lin Ortega · EID 10031877", state: "stopped", reason: "Kronos last punch 04/27/2031; the plan says 04/29/2031.", confirm: "Retry from this step", steps: sepPlan("done", "not-run") } },
  ] },
  { id: "06-manual-value-fixes", scenario: "Manual-value fixes", look: "3 rejected phones in one card; a source per value because they differ; people are checkboxes. Logs: DecisionCard with Assistant suggests.", changed: "One table, inline sources, Retry / Cancel; Logs card shows the suggestion.", title: "EC phone fixes", logs: ecSuggested, chat: [
    { kind: "you", text: "Fix the 3 phones UCPath rejected and retry them" },
    { kind: "proposal", proposal: { title: "Retry 3 emergency contacts", state: "review", confirm: "Retry", changes: { title: "Phone", pick: true, rows: [
      { label: "Ortega, Lin", before: "(619) 555-014", after: "(619) 555-0148", source: "page 2" },
      { label: "Park, Joon", before: "858-555-01", after: "(858) 555-0193", source: "Sheet1!D14" },
      { label: "Haddad, Rami", before: "760555", after: "(760) 555-0127", source: "typed by you" },
    ] } } },
  ] },
  { id: "06b-batch-retry", scenario: "Batch retry", look: "Same failure for 3 people: the Logs card suggests Retry with \"Use for all 3 similar\"; the chat proposal lists the people.", changed: "New frame.", title: "EC retries", logs: batchSuggested, chat: [
    { kind: "you", text: "Retry the three that timed out" },
    { kind: "proposal", proposal: { title: "Retry 3 emergency contacts", state: "review", confirm: "Retry", changes: { title: "Same values", pick: true, rows: [
      { label: "Brooks, Dana", after: "(619) 555-0148" }, { label: "Silva, Ines", after: "(858) 555-0112" }, { label: "Tanaka, Yui", after: "(760) 555-0190" },
    ] } } },
  ] },
  { id: "07-sourceless-refused", scenario: "Sourceless value refused", look: "No source, no value: a toast and one line saying what to provide.", changed: "Shorter reply; Logs shows Silva's own card.", title: "EC phone fixes", logs: ecSilva, toasts: [{ tone: "warning", title: "Value needs a source", description: "Type it, or name its page or cell." }], chat: [
    { kind: "you", text: "Just put any valid number in for Silva" },
    { kind: "reply", text: "Type Ines Silva's number, or name the page or cell that has it." },
  ] },
  { id: "08a-evidence-resolved", scenario: "Evidence-resolved decision", look: "The assistant checks Smart HR Transactions; Relay resolves the decision; the answered line reads \"by assistant on behalf of Alex Rivera\".", changed: "Answered DecisionCard line in Logs.", title: "Rei Nakamura", logs: resolved, chat: [
    { kind: "you", text: "Sort out Rei Nakamura's read-back" },
    { kind: "session", label: "Checked Smart HR Transactions", state: "done", meta: "UCPath · 11s" },
    { kind: "reply", text: "T00042871 is **Approved**. The run continued." },
  ] },
  { id: "08b-evidence-ambiguous", scenario: "Evidence ambiguous", look: "Two terminations found: one line with two choices; the DecisionCard stays open in Logs.", changed: "Shorter question.", title: "Rei Nakamura", logs: d8, chat: [
    { kind: "you", text: "Sort out Rei Nakamura's read-back" },
    { kind: "session", label: "Checked Smart HR Transactions", state: "done", meta: "UCPath · 12s" },
    { kind: "ask", text: "Two terminations for 10431187. Which is this run's?", choices: ["T00042871 · Pending", "T00042905 · Approved"] },
  ] },
  { id: "09-waiting-on-me", scenario: "\"What's waiting on me?\"", look: "One list, oldest first, each row opens its run.", changed: "Logs page-card grammar.", title: "Waiting on me", logs: d2, chat: [
    { kind: "you", text: "What's waiting on me?" },
    { kind: "list", title: "Waiting on you", meta: "4", rows: [
      { lead: "Nakamura, Rei", text: "Separations · read-back failed", meta: "38 min", tone: "danger", link: "Open" },
      { lead: "Scan_0412.pdf", text: "Emergency Contact · 3 failed", meta: "31 min", tone: "danger", link: "Open" },
      { lead: "Morrow, Bea", text: "Person Lookup · pick the person", meta: "4 min", tone: "warning", link: "Open" },
      { lead: "Ortega, Lin", text: "Onboarding · approve the hire", meta: "3 min", tone: "warning", link: "Open" },
    ] },
  ] },
  { id: "10-duplicate-guard", scenario: "Duplicate guard", look: "Blocked: the reason in red and one muted evidence line with its log link; no Approve.", changed: "No Evidence section title.", title: "Rei Nakamura", logs: sepDone, chat: [
    { kind: "you", text: "Separate Rei Nakamura" },
    { kind: "proposal", proposal: { title: "Separate Rei Nakamura · EID 10431187", state: "blocked", reason: "A termination is already pending.", evidence: "T00042871 · Pending · filed today 09:33" } },
  ] },
  { id: "11-activity", scenario: "Activity", look: "The history icon opens today's reads, sessions, edits, confirms and refusals, each with its log.", changed: "Opened from the history icon; no caption.", title: "Activity", logs: resolved, view: "activity", chat: [] },
  { id: "12-person-timeline", scenario: "Person timeline", look: "One person across workflows, newest first.", changed: "Logs page-card grammar.", title: "Lin Ortega", logs: d9, chat: [
    { kind: "you", text: "Everything we've done for Lin Ortega" },
    { kind: "list", title: "Ortega, Lin · EID 10031877", meta: "5 runs", rows: [
      { lead: "Today 15:21", text: "Separations · dry run", meta: "Done", tone: "positive", link: "Log" },
      { lead: "Today 13:20", text: "Emergency Contact", meta: "Failed", tone: "danger", link: "Log" },
      { lead: "04/12/2031", text: "Person Lookup · Active", meta: "Done", tone: "positive", link: "Log" },
      { lead: "08/02/2030", text: "Onboarding · hire filed", meta: "Done", tone: "positive", link: "Log" },
      { lead: "07/28/2030", text: "I-9 Check", meta: "Done", tone: "positive", link: "Log" },
    ] },
  ] },
  { id: "13-preflight", scenario: "Pre-flight before a batch", look: "Missing EIDs, duplicates, already separated, out of scope; then a proposal for the ready rows.", changed: "Ready rows go straight into a Proposal card.", title: "May separations", logs: sepDone, chat: [
    { kind: "you", text: "Separate everyone on this list", file: "May separations.xlsx" },
    { kind: "list", title: "8 rows checked", meta: "4 ready", rows: [
      { lead: "Row 6", text: "Kim, Ari · 2 people match", meta: "Missing EID", tone: "warning" },
      { lead: "Row 7", text: "Same as row 3", meta: "Duplicate", tone: "warning" },
      { lead: "Row 4", text: "Silva, Ines · 03/30/2031", meta: "Already separated", tone: "info" },
      { lead: "Row 8", text: "Brooks, Dana · academic", meta: "Out of scope", tone: "info" },
    ] },
    { kind: "proposal", proposal: { title: "Separate 4 people · dry run", state: "review", confirm: "Approve", changes: { title: "Ready rows", source: "May separations.xlsx", pick: true, rows: [
      { label: "Reyes, Marco", after: "05/15/2031" }, { label: "Okafor, Chinedu", after: "05/16/2031" }, { label: "Tanaka, Yui", after: "05/20/2031" }, { label: "Mensah, Kofi", after: "05/31/2031" },
    ] } } },
  ] },
  { id: "14-watching", scenario: "Watching runs", look: "Watching lasts while any run started today is active; a decision raises a sticky toast with Open.", changed: "Chip wording; toast left of the panel.", title: "Today's runs", logs: d8, toasts: [{ tone: "warning", title: "Nakamura, Rei needs you", description: "Separations · read-back failed", action: "Open", sticky: true }], chat: [
    { kind: "you", text: "Tell me when you need me" },
    { kind: "session", label: "Watching today's runs", state: "running", meta: "3 active" },
  ] },
  { id: "15-error-patterns", scenario: "Error-pattern report", look: "Counts from run data in a Logs-style table; the model adds one line.", changed: "Logs table; shorter explanation.", title: "EC failures", logs: d9, chat: [
    { kind: "you", text: "Why does Emergency Contact keep failing?" },
    { kind: "table", table: table("Last 30 days · 19 of 214 failed", "From run data", ["Failure", "Runs", "Share"], [["Phone format rejected", "11", "58%"], ["Contact already exists", "4", "21%"], ["Session expired", "3", "16%"], ["Other", "1", "5%"]]) },
    { kind: "reply", text: "9 of the 11 phones came from handwritten scans and are missing a digit." },
  ] },
  { id: "16-cross-check", scenario: "Spreadsheet vs UCPath", look: "Only mismatches, each with its cell and the UCPath value; then a proposal to fix the cells.", changed: "Logs table; the fix is an applied-edit offer, not a question.", title: "Tracker check", logs: sepDone, chat: [
    { kind: "you", text: "Check the separations tracker against UCPath" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "40 people · 4m 06s" },
    { kind: "table", table: table("3 mismatches", "37 of 40 agree", ["Person", "Tracker", "UCPath"], [["Nakamura, Rei", "D65 · 04/23/2031", "04/24/2031"], ["Okafor, Chinedu", "E12 · Resignation", "Retirement"], ["Tanaka, Yui", "C30 · Active", "Terminated"]], true) },
  ] },
  { id: "17-report-saved", scenario: "Report saved to the library", look: "Applied at once with Undo (card and toast).", changed: "Proposal card grammar; toast left of the panel.", title: "EC failures", logs: d9p, toasts: [{ tone: "success", title: "Saved to Spreadsheets", description: "EC failures October.xlsx", action: "Undo" }], chat: [
    { kind: "you", text: "Save that report to the library" },
    { kind: "proposal", proposal: { title: "Saved to Spreadsheets", state: "applied", changes: { title: "Library", rows: [{ label: "File", after: "EC failures October.xlsx" }, { label: "Rows", after: "19" }] } } },
  ] },
  { id: "18-pdf-batch-prep", scenario: "PDF batch prep", look: "The OCR start was a Proposal (now one started line); then one Proposal for the people approved in review.", changed: "OCR start is a Proposal; started collapses to one line.", title: "Scan_0503.pdf", logs: d9p, chat: [
    { kind: "you", text: "Update emergency contacts from this scan", file: "Scan_0503.pdf" },
    { kind: "started", text: "Started OCR · Scan_0503.pdf · 15:02" },
    { kind: "proposal", proposal: { title: "Emergency Contact · 9 people", state: "review", confirm: "Approve", steps: [{ title: "Dry run", detail: "fills, saves nothing" }, { title: "Real run", detail: "saves in UCPath · after the dry run matches" }],
      changes: { title: "Contacts", source: "From Scan_0503.pdf review", rows: [{ label: "Okafor, Chinedu", after: "Okafor, Grace · Spouse" }, { label: "Tanaka, Yui", after: "Tanaka, Ken · Parent" }, { label: "Reyes, Marco", after: "Reyes, Ana · Sibling" }, { label: "6 more", after: "pages 4-11" }] } } },
  ] },
  { id: "19-end-of-day", scenario: "End-of-day summary", look: "Today in one card: outcomes, what is open, what the assistant did.", changed: "No footer line.", title: "Today", logs: resolved, chat: [
    { kind: "you", text: "Wrap up today" },
    { kind: "list", title: "Today", meta: "23 runs", rows: [
      { lead: "19 done", text: "Separations 7 · EC 9 · Lookup 3", tone: "positive" },
      { lead: "2 failed", text: "Ortega, Lin · Park, Joon", tone: "danger", link: "Open" },
      { lead: "1 waiting", text: "Morrow, Bea", tone: "warning", link: "Open" },
      { lead: "1 running", text: "Nakamura, Rei", tone: "info" },
      { lead: "Assistant", text: "6 reads · 2 sessions · 3 edits · 2 confirmed", link: "Activity" },
    ] },
  ] },
  { id: "20a-refusal", scenario: "Refusal with its real reason", look: "Relay refuses; the card and the toast carry the real reason.", changed: "Blocked Proposal card.", title: "Rei Nakamura", logs: d8, toasts: [{ tone: "warning", title: "Refused", description: "T00042871 is waiting for your answer in Logs." }], chat: [
    { kind: "you", text: "File Rei Nakamura's termination again" },
    { kind: "proposal", proposal: { title: "File again · Nakamura, Rei", state: "blocked", reason: "T00042871 is waiting for your answer in Logs.", evidence: "Verify termination · read-back failed" } },
  ] },
  { id: "20b-no-reply", scenario: "No reply", look: "A danger toast with Retry; the message stays in the composer.", changed: "Toast left of the panel.", title: "Kofi Mensah", logs: lookupRunning, draft: "When did Kofi Mensah start?", toasts: [{ tone: "danger", title: "No reply", description: "Your message is kept.", action: "Retry" }], chat: [
    { kind: "you", text: "Is Kofi Mensah still active in UCPath?" },
    { kind: "session", label: "Checked UCPath", state: "done", meta: "Person Lookup · Mensah, Kofi · 41s" },
    { kind: "reply", text: "Yes, **Active** in Campus Dining Operations." },
  ] },
];

export const ACTIVITY: readonly ListRow[] = [
  { lead: "09:47", text: "Checked Smart HR · Nakamura, Rei", icon: "session", link: "Log" },
  { lead: "09:47", text: "Resolved read-back · T00042871", icon: "confirm", link: "Log" },
  { lead: "09:40", text: "Renamed run · April contacts scan", icon: "edit", link: "Log" },
  { lead: "09:38", text: "Separations tracker · row 65", icon: "edit", link: "Log" },
  { lead: "09:31", text: "Dry run approved · Ortega, Lin", icon: "confirm", link: "Log" },
  { lead: "09:20", text: "Person Lookup · Ortega, Lin", icon: "session", link: "Log" },
  { lead: "09:12", text: "Refused · file again · Nakamura, Rei", icon: "refused", link: "Log" },
  { lead: "09:05", text: "Read Emergency Contact failures", icon: "read", link: "Log" },
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
