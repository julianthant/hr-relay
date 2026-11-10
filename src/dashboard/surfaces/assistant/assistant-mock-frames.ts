
/** Design mock for the assistant plan; read only from the URL (`assistantMock=<frame id>`). People and values are fictional. */
export const OPERATOR = "Alex Rivera";

/**
 * Text markup: **bold**, {{link}} (blue, underlined on hover; only opens data: a person, a run, a log, Show in Queue), ~~old value~~, !!failure word!!, __changed or new value__ (blue); lines starting "- " are bullets.
 * Everything in the panel is conversation: a sentence, bullets for lists; links only open data and never act; more than 8 non-approval items is a count with Show in Queue.
 * Actions happen only when the operator asks, or replies yes to a question.
 * Approval is a typed short yes that Relay (never the model) recognises; anything else is a change request.
 */
export type Row = Readonly<{ primary: string; secondary?: string; value?: string }>;
export type ChatItem =
  | Readonly<{ kind: "you"; text: string; file?: string }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "session"; label: string; meta: string }>
  | Readonly<{ kind: "answered"; text: string }>;
export type FrameToast = Readonly<{ tone: "info" | "success" | "warning" | "danger"; title: string; description?: string; action?: string; sticky?: boolean }>;
export type QueueFilter = "failed" | "needsYou";
export type AssistantFrame = Readonly<{
  id: string; scenario: string; look: string; title: string; queueFilter?: readonly QueueFilter[];
  chat: readonly ChatItem[]; view?: "activity"; toasts?: readonly FrameToast[]; draft?: string; menu?: "effort";
}>;

const you = (text: string, file?: string): ChatItem => ({ kind: "you", text, file });
const text = (value: string): ChatItem => ({ kind: "text", text: value });
const session = (label: string, meta: string): ChatItem => ({ kind: "session", label, meta });
const answered = (value: string): ChatItem => ({ kind: "answered", text: value });

const ortegaPlan = "I'll file Lin Ortega's termination in UCPath (EID 10000022):\n- Effective date __04/30/2031__\n- Last day worked __04/29/2031__\n- Reason __Resignation__\nFrom Kuali SIM-50112. Reply **yes** to file it, or tell me what to change.";
const phones = "I'll save these phones in UCPath:\n- Ortega, Lin: ~~(619) 555-014~~ __(619) 555-0148__ (Scan_0412.pdf · page 2)\n- Park, Joon: ~~858-555-01~~ __(858) 555-0193__ (Contacts.xlsx · Sheet1!D14)\n- Haddad, Rami: ~~760555~~ __(760) 555-0127__ (typed by you · 13:42)\nReply **yes** to save all 3, or tell me which to skip or change.";

const frames: readonly AssistantFrame[] = [
  { id: "01-chat-basics", scenario: "Chat basics", look: "A fact is one sentence; \"open today's EC failures\" filters the Queue, opens the first, and lists each person as a bullet link.", title: "This week", queueFilter: ["failed"], chat: [
    you("How many separations did we file this week?"), text("**7** this week: 6 done, 1 waiting on you ({{Rei Nakamura}})."),
    you("Open today's EC failures"), text("3 failed today:\n- {{Ortega, Lin}}\n- {{Park, Joon}}\n- {{Haddad, Rami}}"),
  ] },
  { id: "01b-model-effort", scenario: "Chat basics: pickers", look: "Model and effort pickers are editable (Light, Medium, High, xHigh, Max).", title: "This week", queueFilter: ["failed"], draft: "Which of these can be retried?", menu: "effort", chat: [
    you("Open today's EC failures"), text("3 failed today:\n- {{Ortega, Lin}}\n- {{Park, Joon}}\n- {{Haddad, Rami}}"),
  ] },
  { id: "02-read-only-session", scenario: "Read-only session", look: "Person Lookup starts without asking: the session chip (spinner, what and who, rounded Stop); the run is in Queue and Logs.", title: "Kofi Mensah", chat: [
    you("Is Kofi Mensah still active in UCPath?"), session("Checking UCPath…", "Person Lookup · Mensah, Kofi"),
  ] },
  { id: "03-apply-undo", scenario: "Apply + Undo", look: "Edits apply at once: one sentence each, old muted and struck, new in blue; no Undo link or toast action.", title: "Tidy up", toasts: [{ tone: "success", title: "Spreadsheet updated", description: "Separations tracker · row 65" }], chat: [
    you("Rename Scan_0412.pdf to April contacts scan"), text("Renamed ~~Scan_0412.pdf~~ __April contacts scan__."),
    you("Rei's last day worked in the tracker should be 04/24"), text("Changed Separations tracker row 65, last day worked: ~~04/23/2031~~ __04/24/2031__."),
  ] },
  { id: "03b-undo-by-asking", scenario: "Undo by asking", look: "There is no Undo control: the operator asks, and the assistant finds the change in its Activity and reverts it.", title: "Tidy up", chat: [
    you("Rei's last day worked in the tracker should be 04/24"), text("Changed Separations tracker row 65, last day worked: ~~04/23/2031~~ __04/24/2031__."),
    you("Undo the tracker change"), text("Changed Separations tracker row 65 back: ~~04/24/2031~~ __04/23/2031__."),
  ] },
  { id: "04-proposal", scenario: "Start a run, approved by a typed yes", look: "Values as bullets in blue, the source, \"Reply yes to file it\"; the operator types yes; Relay records \"Filed by you\".", title: "Separate Lin Ortega", chat: [
    you("Separate Lin Ortega"), text(ortegaPlan), you("yes"), answered("Filed by you · 09:31"), session("Filing Lin Ortega's termination…", "Separations · Read request"),
  ] },
  { id: "04b-dry-run", scenario: "Dry run when asked", look: "Only when asked: the sentence says it is a dry run and saves nothing.", title: "Separate Lin Ortega", chat: [
    you("Do a dry run of Lin Ortega's separation"), text(`Dry run, saves nothing. ${ortegaPlan.replace("to file it", "to start the dry run")}`),
  ] },
  { id: "04c-change-request", scenario: "Not a yes", look: "Anything other than a short yes is a change request: the assistant re-proposes; nothing is filed.", title: "Separate Lin Ortega", chat: [
    you("Separate Lin Ortega"), text(ortegaPlan), you("make the last day 04/28"),
    text("I'll file Lin Ortega's termination in UCPath (EID 10000022):\n- Effective date __04/30/2031__\n- Last day worked ~~04/29/2031~~ __04/28/2031__ (typed by you)\n- Reason __Resignation__\nReply **yes** to file it, or tell me what to change."),
  ] },
  { id: "05-plan-stopped", scenario: "Run stopped", look: "The reason in one sentence, then a question; the operator replies yes to retry. No action link.", title: "Separate Lin Ortega", chat: [
    text("!!Stopped!! at Read timecard: Kronos shows the last punch on **04/27/2031**; the request says **04/29/2031**. Nothing was filed.\nWant me to retry from Read timecard?"),
  ] },
  { id: "06-manual-value-fixes", scenario: "Value fixes for 3 people", look: "Bullets with old -> new in blue and each source; \"Reply yes to save all 3, or tell me which to skip or change.\"", title: "EC phone fixes", chat: [
    you("Fix the 3 phones UCPath rejected and retry them"), text(phones),
  ] },
  { id: "06b-batch-retry", scenario: "Retry a batch", look: "Same failure for 3 people: bullets, then the yes line.", title: "EC retries", chat: [
    you("Retry the three that timed out"), text("UCPath didn't answer for these 3, so nothing was saved:\n- {{Brooks, Dana}}\n- {{Silva, Ines}}\n- {{Tanaka, Yui}}\nReply **yes** to save all 3 again, or tell me which to skip."),
  ] },
  { id: "06c-failure", scenario: "A failure", look: "\"Failed\" is the only red word; it ends with the question, not a link.", title: "EC retries", chat: [
    you("yes"), answered("Approved by you · 13:31"), text("!!Failed!!: UCPath didn't answer when saving Brooks, Dana's contact. Nothing was saved. Want me to try again?"),
  ] },
  { id: "07-sourceless-refused", scenario: "Sourceless value refused", look: "A toast and one sentence saying what to provide.", title: "EC phone fixes", toasts: [{ tone: "warning", title: "Value needs a source", description: "Type it, or name its page or cell." }], chat: [
    you("Just put any valid number in for Silva"), text("I need a source for Ines Silva's phone: type the number, or name the page or cell that has it."),
  ] },
  { id: "08a-evidence-resolved", scenario: "Evidence-resolved decision", look: "One sentence with the value found; Logs shows \"by assistant on behalf of Alex Rivera\".", title: "Rei Nakamura", chat: [
    you("Sort out Rei Nakamura's read-back"), text("Checked Smart HR Transactions: T00042871 is **Approved**. The run continued. {{Open log}}"),
  ] },
  { id: "08b-evidence-ambiguous", scenario: "Evidence ambiguous", look: "Two options as bullets (ids link to the transaction); the operator replies with the number; the DecisionCard stays open in Logs.", title: "Rei Nakamura", chat: [
    you("Sort out Rei Nakamura's read-back"), text("Smart HR lists two terminations for Rei Nakamura (10000023). Which one is this run's? Reply with its number.\n- {{T00042871}}: Pending, filed today 09:33 by this run\n- {{T00042905}}: Approved, filed 04/22/2031 by hand"),
  ] },
  { id: "09-waiting-on-me", scenario: "\"What's waiting on me?\"", look: "A sentence and bullets, each name a link.", title: "Waiting on me", chat: [
    you("What's waiting on me?"), text("4 runs are waiting on you:\n- {{Rei Nakamura}}: read-back failed (38 min)\n- {{Lin Ortega}}: phone rejected (31 min)\n- {{Bea Morrow}}: pick the person (4 min)\n- {{Chinedu Okafor}}: approve the hire (3 min)"),
  ] },
  { id: "10-duplicate-guard", scenario: "Duplicate guard", look: "Not started: one sentence with the reason and one link.", title: "Rei Nakamura", chat: [
    you("Separate Rei Nakamura"), text("Not started: T00042871 is already pending, filed today 09:33. {{Open log}}"),
  ] },
  { id: "11-activity", scenario: "Activity", look: "History · Activity tab: today's 8 entries (what, person, time); each opens its log.", title: "Activity", view: "activity", chat: [] },
  { id: "12-person-timeline", scenario: "Person timeline", look: "5 runs as bullets with log links.", title: "Lin Ortega", chat: [
    you("Everything we've done for Lin Ortega"), text("5 runs for Lin Ortega (10000022):\n- Today 15:21, {{Separations}}: !!stopped!!, last day worked differs\n- Today 13:20, {{Emergency Contact}}: !!failed!!, phone rejected\n- 04/12/2031, {{Person Lookup}}: Active\n- 08/02/2030, {{Onboarding}}: hire filed\n- 07/28/2030, {{I-9 Check}}: done"),
  ] },
  { id: "13-preflight", scenario: "Pre-flight before a batch", look: "Issues as bullets; the ready people as bullets; then the yes line.", title: "May separations", chat: [
    you("Separate everyone on this list", "May separations.xlsx"),
    text("I checked 8 rows. 4 can't go yet:\n- Row 6, Ari Kim: 2 people match; give me the EID\n- Row 7: same person as row 3\n- Row 4, Ines Silva: already separated 03/30/2031\n- Row 8, Dana Brooks: academic appointment, not Separations\nThese 4 are ready, effective dates from the sheet:\n- Reyes, Marco: __05/15/2031__\n- Okafor, Chinedu: __05/16/2031__\n- Tanaka, Yui: __05/20/2031__\n- Mensah, Kofi: __05/31/2031__\nReply **yes** to file all 4, or tell me which to skip or change."),
  ] },
  { id: "14-watching", scenario: "Watching runs", look: "The session chip while any run started today is active; a decision raises a sticky toast with Open.", title: "Today's runs", toasts: [{ tone: "warning", title: "Nakamura, Rei needs you", description: "Separations · read-back failed", action: "Open", sticky: true }], chat: [
    you("Tell me when you need me"), session("Watching today's runs", "3 active"),
  ] },
  { id: "15-error-patterns", scenario: "Error-pattern report", look: "Counts from run data as bullets; the full list is a count with Show in Queue.", title: "EC failures", chat: [
    you("Why does Emergency Contact keep failing?"), text("19 of 214 runs failed in the last 30 days:\n- Phone format rejected: **11**\n- Contact already exists: **4**\n- Session expired: **3**\n- Other: **1**\n9 of the 11 phones came from handwritten scans and are missing a digit. {{Show in Queue}}"),
  ] },
  { id: "16-cross-check", scenario: "Spreadsheet vs UCPath", look: "3 mismatches as bullets with the cell, the tracker value and the UCPath value; the fix is offered as a question.", title: "Tracker check", chat: [
    you("Check the separations tracker against UCPath"), text("37 of 40 agree. 3 differ:\n- Rei Nakamura, D65: tracker 04/23/2031, UCPath **04/24/2031**\n- Chinedu Okafor, E12: tracker Resignation, UCPath **Retirement**\n- Yui Tanaka, C30: tracker Active, UCPath **Terminated**\nWant me to update the 3 tracker cells to match UCPath?"),
  ] },
  { id: "17-report-saved", scenario: "Report saved to the library", look: "Saved at once: one sentence, the new file in blue; a success toast without an action.", title: "EC failures", toasts: [{ tone: "success", title: "Saved to Spreadsheets", description: "EC failures October.xlsx" }], chat: [
    you("Save that report to the library"), text("Saved __EC failures October.xlsx__ (19 rows) to Spreadsheets."),
  ] },
  { id: "18-pdf-batch-prep", scenario: "PDF batch prep", look: "OCR started in one line; after review, all 9 people as bullets, then the yes line.", title: "Scan_0503.pdf", chat: [
    you("Update emergency contacts from this scan", "Scan_0503.pdf"), text("Started OCR on Scan_0503.pdf (11 pages). {{Open review}}"),
    text(`You approved 9 records. I'll save these contacts in UCPath:\n${["Okafor, Chinedu: __Okafor, Grace__", "Tanaka, Yui: __Tanaka, Ken__", "Reyes, Marco: __Reyes, Ana__", "Mensah, Kofi: __Mensah, Ama__", "Nguyen, Thao: __Nguyen, Linh__", "Park, Joon: __Park, Mina__", "Ali, Samir: __Ali, Noor__", "Kowalski, Eva: __Kowalski, Jan__", "Brooks, Dana: __Brooks, Sam__"].map((line, index) => `- ${line} (page ${index + 1})`).join("\n")}\nReply **yes** to save all 9, or tell me which to skip or change.`),
  ] },
  { id: "19-end-of-day", scenario: "End-of-day summary", look: "A sentence and bullets; names are links.", title: "Today", chat: [
    you("Wrap up today"), text("23 runs today:\n- **19** done\n- **2** failed: {{Lin Ortega}}, {{Joon Park}}\n- **1** waiting: {{Bea Morrow}}\n- **1** running: {{Rei Nakamura}}\nI made 13 changes for you. {{See activity}}"),
  ] },
  { id: "20a-refusal", scenario: "Refusal with its real reason", look: "One sentence: what was not done, the real reason, one link.", title: "Rei Nakamura", chat: [
    you("File Rei Nakamura's termination again"), text("Not done: T00042871 is still waiting for your answer in Logs. {{Open log}}"),
  ] },
  { id: "20b-no-reply", scenario: "No reply", look: "A danger toast with Retry; the message stays in the composer.", title: "Kofi Mensah", draft: "When did Kofi Mensah start?", toasts: [{ tone: "danger", title: "No reply", description: "Your message is kept.", action: "Retry" }], chat: [
    you("Is Kofi Mensah still active in UCPath?"), text("Yes. Kofi Mensah is **Active** in Campus Dining Operations."),
  ] },
];

/** History · Activity: today's assistant actions (rows; each opens its log). */
export const ACTIVITY: readonly Row[] = [
  { primary: "Checked Smart HR", secondary: "Nakamura, Rei", value: "09:47" }, { primary: "Resolved read-back", secondary: "Nakamura, Rei", value: "09:47" },
  { primary: "Renamed run", secondary: "April contacts scan", value: "09:40" }, { primary: "Edited tracker row 65", secondary: "Nakamura, Rei", value: "09:38" },
  { primary: "Filed by you", secondary: "Separations · Ortega, Lin", value: "09:31" }, { primary: "Person Lookup", secondary: "Ortega, Lin", value: "09:20" },
  { primary: "Not started: file again", secondary: "Nakamura, Rei", value: "09:12" }, { primary: "Read EC failures", secondary: "Emergency Contact", value: "09:05" },
];

export const ASSISTANT_FRAMES: readonly AssistantFrame[] = frames;

export function assistantFrame(): AssistantFrame | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("assistantMock");
  return frames.find(frame => frame.id === value);
}
