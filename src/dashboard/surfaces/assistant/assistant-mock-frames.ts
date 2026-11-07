import type { DecisionAnswered } from "../run-detail/logs/decision-card.js";
import { EC_PEOPLE, MOCK_SCENES, decisionMock, ecGroup, ecMemberSteps, fill, page, read, sepFile, sepRequest, sepTimecard, sepTimeline, sepVerify, stage, type MockDecision, type MockGroup, type MockSceneData, type MockStep } from "../run-detail/decision-mock/decision-mock-model.js";

/** Design mock for the assistant plan; read only from the URL (`assistantMock=<frame id>`). People and values are fictional. */
export const OPERATOR = "Alex Rivera";

/**
 * Text markup: **bold**, {{link}}, ~~old value~~, !!failure word!!, __filled value__; lines starting "- " are bullets.
 * Volume rule: one fact is a sentence; 2-4 items are bullets; 5-8 items or a batch of 3+ people are rows; more than 8 is a count with Show in Queue.
 */
export type Row = Readonly<{ primary: string; secondary?: string; value?: string; before?: string; source?: string; fill?: boolean; pick?: boolean; open?: boolean }>;
export type ChatItem =
  | Readonly<{ kind: "you"; text: string; file?: string }>
  | Readonly<{ kind: "text"; text: string; running?: boolean }>
  | Readonly<{ kind: "rows"; rows: readonly Row[]; single?: boolean }>
  | Readonly<{ kind: "buttons"; primary: string; secondary?: readonly string[] }>
  | Readonly<{ kind: "decision"; title: string; confirm: string }>;
export type FrameToast = Readonly<{ tone: "info" | "success" | "warning" | "danger"; title: string; description?: string; action?: string; sticky?: boolean }>;
export type QueueFilter = "failed" | "needsYou";
export type AssistantFrame = Readonly<{
  id: string; scenario: string; look: string; title: string; logs: MockSceneData; queueFilter?: readonly QueueFilter[];
  chat: readonly ChatItem[]; view?: "activity"; toasts?: readonly FrameToast[]; draft?: string; menu?: "effort";
}>;

const answeredCard = (scene: MockSceneData, answered: DecisionAnswered): MockSceneData["decision"] => scene.decision?.kind === "card" ? { ...scene.decision, answered } : scene.decision;
const you = (text: string, file?: string): ChatItem => ({ kind: "you", text, file });
const text = (value: string, running = false): ChatItem => ({ kind: "text", text: value, running });
const rows = (list: readonly Row[], single?: boolean): ChatItem => ({ kind: "rows", rows: list, single });
const buttons = (primary: string, ...secondary: string[]): ChatItem => ({ kind: "buttons", primary, secondary });

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

const d8 = MOCK_SCENES.d8, d9 = MOCK_SCENES.d9, d9p = MOCK_SCENES.d9p, d2 = MOCK_SCENES.d2;
const ecSilva: MockSceneData = { ...d9, id: "a-ec-silva", subject: "Silva, Ines", headerRetry: "Retry Silva, Ines", group: ecGroup({ member: "Silva, Ines" }, ["Silva, Ines"]),
  steps: ecMemberSteps("Silva, Ines", "10027415", "555-01", ["Phone: 555-01", "Invalid phone number format"], "13:24") };
const timedOut: MockDecision = { kind: "card", tone: "danger", title: "Emergency contact could not be saved", context: "UCPath did not respond to Save. Nothing was saved.", confirm: "Retry" };
const batch: MockSceneData = { ...d9, id: "a-batch", subject: "Brooks, Dana", headerRetry: "Retry Brooks, Dana", queueMessage: "UCPath did not respond", group: ecGroup({ member: "Brooks, Dana" }, ["Brooks, Dana", "Silva, Ines", "Tanaka, Yui"]),
  steps: ecMemberSteps("Brooks, Dana", "10027802", "(619) 555-0148", ["Saving, please wait", "The server did not respond"], "13:22"), decision: timedOut };
const timecardDiffers: MockDecision = { kind: "card", tone: "danger", title: "Last day worked differs", context: "Kronos shows the last punch on 04/27/2031; the request says 04/29/2031. Nothing was filed.", confirm: "Retry" };
const ortegaStopped = sep("a-stopped", "Plan stopped", "Ortega, Lin", "failed", "Last day worked differs", [
  { id: "request", time: "15:21:00", title: "Read separation request", system: "Kuali", outcome: "Request found", blocks: [{ kind: "note", text: `Approved by ${OPERATOR} · started by the assistant` }, page("RRSS Separation Request", "Read", [read("Employee", "Ortega, Lin"), read("Employee ID", "10031877"), read("Last day worked", "04/29/2031"), read("Separation date", "04/30/2031")])] },
  { id: "employee", time: "15:21:13", title: "Verify employee", system: "UCPath", outcome: "Matches the request", blocks: [page("Workforce Job Summary", "Read", [read("Name", "Ortega, Lin"), read("HR status", "Active")])] },
  { id: "timecard", time: "15:21:24", title: "Read timecard", system: "Kronos", current: true, blocks: [page("Timecard", "Read", [read("Last punch", "04/27/2031"), read("Sick or holiday leave", "None")]), { kind: "decision" }] },
], [stage("request", "Read request", "completed", { durationLabel: "13s" }), stage("employee", "Verify employee", "completed", { durationLabel: "11s" }), stage("timecard", "Read timecard", "failed", { statusLabel: "Failed" }), stage("file", "File termination", "pending"), stage("finalize", "Finalize document", "pending")], { decision: timecardDiffers });

const ortegaPlan = "I'll file Lin Ortega's termination in UCPath (EID 10031877):\n- Effective date __04/30/2031__\n- Last day worked __04/29/2031__\n- Reason __Resignation__\nFrom Kuali SIM-50112.";

const frames: readonly AssistantFrame[] = [
  { id: "01-chat-basics", scenario: "Chat basics", look: "A fact is one sentence; \"open today's EC failures\" filters the Queue to the 3 failures, opens the first, and names each person as a link.", title: "This week", logs: ecFailures, queueFilter: ["failed"], chat: [
    you("How many separations did we file this week?"), text("**7** this week: 6 done, 1 waiting on you (Rei Nakamura)."),
    you("Open today's EC failures"), text("3 failed today: {{Ortega, Lin}} · {{Park, Joon}} · {{Haddad, Rami}}"),
  ] },
  { id: "01b-model-effort", scenario: "Chat basics: pickers", look: "Model and effort pickers are editable (Light, Medium, High, xHigh, Max).", title: "This week", logs: ecFailures, queueFilter: ["failed"], draft: "Which of these can be retried?", menu: "effort", chat: [
    you("Open today's EC failures"), text("3 failed today: {{Ortega, Lin}} · {{Park, Joon}} · {{Haddad, Rami}}"),
  ] },
  { id: "02-read-only-session", scenario: "Read-only session", look: "Person Lookup starts without asking: one running line with Stop; the run is in Queue and Logs.", title: "Kofi Mensah", logs: lookupRunning, chat: [
    you("Is Kofi Mensah still active in UCPath?"), text("Checking UCPath for Kofi Mensah. {{Stop}}", true),
  ] },
  { id: "03-apply-undo", scenario: "Apply + Undo", look: "Edits apply at once: one sentence each with old and new; the toast's Undo is an icon beside the close X.", title: "Tidy up", logs: renamedParent, toasts: [{ tone: "success", title: "Spreadsheet updated", description: "Separations tracker · row 65", action: "Undo" }], chat: [
    you("Rename Scan_0412.pdf to April contacts scan"), text("Renamed ~~Scan_0412.pdf~~ **April contacts scan**. {{Undo}}"),
    you("Rei's last day worked in the tracker should be 04/24"), text("Changed Separations tracker row 65, last day worked: ~~04/23/2031~~ **04/24/2031**. {{Undo}}"),
  ] },
  { id: "04-proposal", scenario: "Start a run", look: "A real run by default: the values as bullets in blue, one shared source, Approve and Cancel.", title: "Separate Lin Ortega", logs: lookupOrtega, chat: [
    you("Separate Lin Ortega"), text(ortegaPlan), buttons("Approve", "Cancel"),
  ] },
  { id: "04b-dry-run", scenario: "Start a dry run", look: "Only when asked: the sentence says it is a dry run and saves nothing.", title: "Separate Lin Ortega", logs: lookupOrtega, chat: [
    you("Do a dry run of Lin Ortega's separation"), text(`Dry run, saves nothing. ${ortegaPlan}`), buttons("Approve", "Cancel"),
  ] },
  { id: "05-plan-stopped", scenario: "Run stopped", look: "The reason in one sentence, then the shared DecisionCard (Retry / Cancel run), the same card as in Logs.", title: "Separate Lin Ortega", logs: ortegaStopped, chat: [
    text("!!Stopped!! at Read timecard: Kronos shows the last punch on **04/27/2031**; the request says **04/29/2031**. Nothing was filed."),
    { kind: "decision", title: "Retry Lin Ortega's separation?", confirm: "Retry" },
  ] },
  { id: "06-manual-value-fixes", scenario: "Value fixes for 3 people", look: "A batch of 3+ people is rows: checkbox, name, old -> new in blue, the full source on a muted line.", title: "EC phone fixes", logs: ecFailures, chat: [
    you("Fix the 3 phones UCPath rejected and retry them"), text("I'll save these phones in UCPath:"),
    rows([
      { primary: "Ortega, Lin", before: "(619) 555-014", value: "(619) 555-0148", source: "Scan_0412.pdf · page 2", pick: true },
      { primary: "Park, Joon", before: "858-555-01", value: "(858) 555-0193", source: "Contacts.xlsx · Sheet1!D14", pick: true },
      { primary: "Haddad, Rami", before: "760555", value: "(760) 555-0127", source: "Typed by you · 13:42", pick: true },
    ]), buttons("Retry", "Cancel"),
  ] },
  { id: "06b-batch-retry", scenario: "Retry a batch", look: "Same failure for 3 people: rows with checkboxes, Retry and Cancel; Logs shows the plain v8 DecisionCard.", title: "EC retries", logs: batch, chat: [
    you("Retry the three that timed out"), text("UCPath didn't answer for these 3. Nothing was saved, so I'll save them again:"),
    rows(["Brooks, Dana", "Silva, Ines", "Tanaka, Yui"].map(name => ({ primary: name, secondary: "Emergency Contact · same values", pick: true }))), buttons("Retry", "Cancel"),
  ] },
  { id: "07-sourceless-refused", scenario: "Sourceless value refused", look: "A toast and one sentence saying what to provide.", title: "EC phone fixes", logs: ecSilva, toasts: [{ tone: "warning", title: "Value needs a source", description: "Type it, or name its page or cell." }], chat: [
    you("Just put any valid number in for Silva"), text("I need a source for Ines Silva's phone: type the number, or name the page or cell that has it."),
  ] },
  { id: "08a-evidence-resolved", scenario: "Evidence-resolved decision", look: "One sentence with the value found; Logs shows the answered line \"by assistant on behalf of Alex Rivera\".", title: "Rei Nakamura", logs: resolved, chat: [
    you("Sort out Rei Nakamura's read-back"), text("Checked Smart HR Transactions: T00042871 is **Approved**. The run continued. {{Open log}}"),
  ] },
  { id: "08b-evidence-ambiguous", scenario: "Evidence ambiguous", look: "Two options are bullets with links; the DecisionCard stays open in Logs.", title: "Rei Nakamura", logs: d8, chat: [
    you("Sort out Rei Nakamura's read-back"), text("Smart HR lists two terminations for Rei Nakamura (10431187). Which one is this run's?\n- {{T00042871}}: Pending, filed today 09:33 by this run\n- {{T00042905}}: Approved, filed 04/22/2031 by hand"),
  ] },
  { id: "09-waiting-on-me", scenario: "\"What's waiting on me?\"", look: "4 items: a sentence and bullets, each name a link.", title: "Waiting on me", logs: d2, chat: [
    you("What's waiting on me?"), text("4 runs are waiting on you:\n- {{Rei Nakamura}}: read-back failed (38 min)\n- {{Lin Ortega}}: phone rejected (31 min)\n- {{Bea Morrow}}: pick the person (4 min)\n- {{Chinedu Okafor}}: approve the hire (3 min)"),
  ] },
  { id: "10-duplicate-guard", scenario: "Duplicate guard", look: "Not started: one sentence with the reason and one link.", title: "Rei Nakamura", logs: sepDone, chat: [
    you("Separate Rei Nakamura"), text("Not started: T00042871 is already pending, filed today 09:33. {{Open log}}"),
  ] },
  { id: "11-activity", scenario: "Activity", look: "History · Activity tab: 8 entries as rows (what, person, time); each row opens its log.", title: "Activity", logs: resolved, view: "activity", chat: [] },
  { id: "12-person-timeline", scenario: "Person timeline", look: "5 runs: rows (workflow, outcome, date); each opens its log.", title: "Lin Ortega", logs: d9, chat: [
    you("Everything we've done for Lin Ortega"), text("5 runs for Lin Ortega (10031877):"),
    rows([
      { primary: "Separations", secondary: "Stopped · last day worked differs", value: "Today 15:21", open: true },
      { primary: "Emergency Contact", secondary: "Failed · phone rejected", value: "Today 13:20", open: true },
      { primary: "Person Lookup", secondary: "Done · Active", value: "04/12/2031", open: true },
      { primary: "Onboarding", secondary: "Done · hire filed", value: "08/02/2030", open: true },
      { primary: "I-9 Check", secondary: "Done", value: "07/28/2030", open: true },
    ]),
  ] },
  { id: "13-preflight", scenario: "Pre-flight before a batch", look: "Issues as bullets; the ready people (a batch) as rows with checkboxes, Approve and Cancel.", title: "May separations", logs: sepDone, chat: [
    you("Separate everyone on this list", "May separations.xlsx"),
    text("I checked 8 rows. 4 can't go yet:\n- Row 6, Ari Kim: 2 people match; give me the EID\n- Row 7: same person as row 3\n- Row 4, Ines Silva: already separated 03/30/2031\n- Row 8, Dana Brooks: academic appointment, not Separations\nThe other 4 are ready:"),
    rows([
      { primary: "Reyes, Marco", value: "05/15/2031", source: "Row 1", fill: true, pick: true }, { primary: "Okafor, Chinedu", value: "05/16/2031", source: "Row 2", fill: true, pick: true },
      { primary: "Tanaka, Yui", value: "05/20/2031", source: "Row 3", fill: true, pick: true }, { primary: "Mensah, Kofi", value: "05/31/2031", source: "Row 5", fill: true, pick: true },
    ]), buttons("Approve", "Cancel"),
  ] },
  { id: "14-watching", scenario: "Watching runs", look: "One running line while any run started today is active; a decision raises a sticky toast with Open.", title: "Today's runs", logs: d8, toasts: [{ tone: "warning", title: "Nakamura, Rei needs you", description: "Separations · read-back failed", action: "Open", sticky: true }], chat: [
    you("Tell me when you need me"), text("Watching today's runs: 3 active. {{Stop}}", true),
  ] },
  { id: "15-error-patterns", scenario: "Error-pattern report", look: "Counts from run data as bullets; the full list is a count with Show in Queue.", title: "EC failures", logs: d9, chat: [
    you("Why does Emergency Contact keep failing?"), text("19 of 214 runs failed in the last 30 days:\n- Phone format rejected: **11**\n- Contact already exists: **4**\n- Session expired: **3**\n- Other: **1**\n9 of the 11 phones came from handwritten scans and are missing a digit. {{Show in Queue}}"),
  ] },
  { id: "16-cross-check", scenario: "Spreadsheet vs UCPath", look: "3 mismatches as bullets with the cell, the tracker value and the UCPath value.", title: "Tracker check", logs: sepDone, chat: [
    you("Check the separations tracker against UCPath"), text("37 of 40 agree. 3 differ:\n- Rei Nakamura, D65: tracker 04/23/2031, UCPath **04/24/2031**\n- Chinedu Okafor, E12: tracker Resignation, UCPath **Retirement**\n- Yui Tanaka, C30: tracker Active, UCPath **Terminated**\n{{Update the tracker to match}}"),
  ] },
  { id: "17-report-saved", scenario: "Report saved to the library", look: "Saved at once: one sentence with Undo; the toast's Undo is an icon.", title: "EC failures", logs: d9p, toasts: [{ tone: "success", title: "Saved to Spreadsheets", description: "EC failures October.xlsx", action: "Undo" }], chat: [
    you("Save that report to the library"), text("Saved **EC failures October.xlsx** (19 rows) to Spreadsheets. {{Undo}}"),
  ] },
  { id: "18-pdf-batch-prep", scenario: "PDF batch prep", look: "OCR starts as a one-line Approve; after review, the 9 people are rows with checkboxes.", title: "Scan_0503.pdf", logs: d9p, chat: [
    you("Update emergency contacts from this scan", "Scan_0503.pdf"), text("Started OCR on Scan_0503.pdf (11 pages). {{Open review}}"),
    text("You approved 9 records. I'll save these contacts in UCPath:"),
    rows(["Okafor, Chinedu · Okafor, Grace", "Tanaka, Yui · Tanaka, Ken", "Reyes, Marco · Reyes, Ana", "Mensah, Kofi · Mensah, Ama", "Nguyen, Thao · Nguyen, Linh", "Park, Joon · Park, Mina", "Ali, Samir · Ali, Noor", "Kowalski, Eva · Kowalski, Jan", "Brooks, Dana · Brooks, Sam"]
      .map((pair, index) => { const [person, contact] = pair.split(" · "); return { primary: person, value: contact, source: `page ${index + 1}`, fill: true, pick: true }; })),
    buttons("Approve", "Cancel"),
  ] },
  { id: "19-end-of-day", scenario: "End-of-day summary", look: "A sentence and bullets; names are links.", title: "Today", logs: resolved, chat: [
    you("Wrap up today"), text("23 runs today:\n- **19** done\n- **2** failed: {{Lin Ortega}}, {{Joon Park}}\n- **1** waiting: {{Bea Morrow}}\n- **1** running: {{Rei Nakamura}}\nI made 13 changes for you. {{See activity}}"),
  ] },
  { id: "20a-refusal", scenario: "Refusal with its real reason", look: "One sentence: what was not done, the real reason, one link.", title: "Rei Nakamura", logs: d8, chat: [
    you("File Rei Nakamura's termination again"), text("Not done: T00042871 is still waiting for your answer in Logs. {{Open log}}"),
  ] },
  { id: "20b-no-reply", scenario: "No reply", look: "A danger toast with Retry; the message stays in the composer.", title: "Kofi Mensah", logs: lookupRunning, draft: "When did Kofi Mensah start?", toasts: [{ tone: "danger", title: "No reply", description: "Your message is kept.", action: "Retry" }], chat: [
    you("Is Kofi Mensah still active in UCPath?"), text("Yes. Kofi Mensah is **Active** in Campus Dining Operations."),
  ] },
];

/** History · Activity: today's assistant actions (rows; each opens its log). */
export const ACTIVITY: readonly Row[] = [
  { primary: "Checked Smart HR", secondary: "Nakamura, Rei", value: "09:47", open: true }, { primary: "Resolved read-back", secondary: "Nakamura, Rei", value: "09:47", open: true },
  { primary: "Renamed run", secondary: "April contacts scan", value: "09:40", open: true }, { primary: "Edited tracker row 65", secondary: "Nakamura, Rei", value: "09:38", open: true },
  { primary: "Separation approved", secondary: "Ortega, Lin", value: "09:31", open: true }, { primary: "Person Lookup", secondary: "Ortega, Lin", value: "09:20", open: true },
  { primary: "Not started: file again", secondary: "Nakamura, Rei", value: "09:12", open: true }, { primary: "Read EC failures", secondary: "Emergency Contact", value: "09:05", open: true },
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
