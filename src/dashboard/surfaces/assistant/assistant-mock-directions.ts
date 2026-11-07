/**
 * Scenario sheets (v3 item 9): the same content in three directions, one panel per direction.
 * Text markup: **bold**, [[token]] (pill; "spin:", "ok:", "x:" prefixes add a state icon), {{link}}, ~~old~~, !!failure word!!, __filled value__; lines starting "- " are bullets.
 */
export type DirectionId = "d1" | "d2" | "d3";
export const DIRECTIONS: Readonly<Record<DirectionId, string>> = { d1: "D1 · Conversational text", d2: "D2 · Borderless rows", d3: "D3 · Inline tokens" };
export type SheetRow = Readonly<{ primary: string; secondary?: string; value?: string; before?: string; source?: string; state?: "spin" | "ok" | "fail" | "blocked"; pick?: boolean; trailing?: "open" | "undo" | "stop" }>;
export type SheetItem =
  | Readonly<{ kind: "label"; text: string }>
  | Readonly<{ kind: "you"; text: string }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "rows"; title?: string; single?: boolean; rows: readonly SheetRow[] }>
  | Readonly<{ kind: "buttons"; primary?: string; secondary?: readonly string[] }>;
export type Scenario = Readonly<{ id: string; name: string; recommend: DirectionId; why: string; directions: Readonly<Record<DirectionId, readonly SheetItem[]>> }>;

const you = (text: string): SheetItem => ({ kind: "you", text });
const label = (text: string): SheetItem => ({ kind: "label", text });
const text = (value: string): SheetItem => ({ kind: "text", text: value });
const rows = (list: readonly SheetRow[], title?: string, single?: boolean): SheetItem => ({ kind: "rows", title, single, rows: list });
const buttons = (primary: string | undefined, ...secondary: string[]): SheetItem => ({ kind: "buttons", primary, secondary });

const WAITING = [
  { name: "Rei Nakamura", what: "Separations · read-back failed", since: "38 min" },
  { name: "Lin Ortega", what: "Emergency Contact · phone rejected", since: "31 min" },
  { name: "Bea Morrow", what: "Person Lookup · pick the person", since: "4 min" },
  { name: "Chinedu Okafor", what: "Onboarding · approve the hire", since: "3 min" },
];
const ACTIVITY = [
  { time: "09:47", what: "Checked Smart HR", who: "Rei Nakamura" }, { time: "09:47", what: "Resolved read-back", who: "Rei Nakamura" },
  { time: "09:40", what: "Renamed run", who: "Scan_0412.pdf" }, { time: "09:38", what: "Edited tracker row 65", who: "Rei Nakamura" },
  { time: "09:31", what: "Separation approved", who: "Lin Ortega" }, { time: "09:20", what: "Person Lookup", who: "Lin Ortega" },
  { time: "09:12", what: "Not started: file again", who: "Rei Nakamura" }, { time: "09:05", what: "Read EC failures", who: "Emergency Contact" },
];
const PHONES = [
  { name: "Lin Ortega", before: "(619) 555-014", after: "(619) 555-0148", source: "Scan_0412.pdf · page 2" },
  { name: "Joon Park", before: "858-555-01", after: "(858) 555-0193", source: "Contacts.xlsx · Sheet1!D14" },
  { name: "Rami Haddad", before: "760555", after: "(760) 555-0127", source: "Typed by you · 13:42" },
];

const s1: Scenario = { id: "s1-show-data", name: "S1 Show data", recommend: "d2", why: "Sets stay scannable without a box, and every row opens its run; facts and records read as sentences.", directions: {
  d1: [
    label("One fact"), you("Is Kofi Mensah still active?"), text("Yes. Kofi Mensah is **Active** in Campus Dining Operations."),
    label("One record"), you("Who is Lin Ortega?"), text("Lin Ortega (**10031877**) is a student assistant in Housing Operations.\n- HR status **Active** since 08/02/2030\n- Emergency contact **Maya Ortega**, (619) 555-0148\n{{Open in Person Lookup}}"),
    label("A set"), you("What's waiting on me?"), text(`4 runs are waiting on you:\n${WAITING.map(item => `- {{${item.name}}}: ${item.what.split(" · ")[1]} (${item.since})`).join("\n")}`),
    you("What did you do today?"), text(`8 actions today:\n${ACTIVITY.map(item => `- ${item.time} ${item.what}, ${item.who}`).join("\n")}`),
    label("Many"), you("Show today's Emergency Contact runs"), text("**42** Emergency Contact runs today: 39 done, 3 failed. {{Show in Queue}}"),
  ],
  d2: [
    label("One fact"), you("Is Kofi Mensah still active?"), text("Yes. Kofi Mensah is **Active** in Campus Dining Operations."),
    label("One record"), you("Who is Lin Ortega?"), text("Lin Ortega is a student assistant in Housing Operations."),
    rows([{ primary: "Employee ID", value: "10031877" }, { primary: "HR status", value: "Active" }, { primary: "Started", value: "08/02/2030" }, { primary: "Emergency contact", value: "Maya Ortega", source: "(619) 555-0148" }]),
    label("A set"), you("What's waiting on me?"), text("4 runs are waiting on you."), rows(WAITING.map(item => ({ primary: item.name, secondary: item.what, value: item.since, trailing: "open" as const }))),
    you("What did you do today?"), text("8 actions today."), rows(ACTIVITY.map(item => ({ primary: item.what, secondary: item.who, value: item.time, trailing: "open" as const }))),
    label("Many"), you("Show today's Emergency Contact runs"), text("42 Emergency Contact runs today: 39 done, 3 failed."), rows([{ primary: "Show in Queue", secondary: "Emergency Contact · today", value: "42", trailing: "open" }]),
  ],
  d3: [
    label("One fact"), you("Is Kofi Mensah still active?"), text("Yes. [[Kofi Mensah]] is **Active** in Campus Dining Operations."),
    label("One record"), you("Who is Lin Ortega?"), text("[[Lin Ortega · 10031877]] is **Active** in Housing Operations since 08/02/2030. Emergency contact: [[Maya Ortega · (619) 555-0148]]."),
    label("A set"), you("What's waiting on me?"), text(`4 runs are waiting on you: ${WAITING.map(item => `[[${item.name}]]`).join(" ")}`),
    you("What did you do today?"), text("8 actions today: checked and resolved [[Rei Nakamura]], renamed [[Scan_0412.pdf]], edited [[tracker row 65]], approved [[Lin Ortega]], looked up [[Lin Ortega]], refused [[Rei Nakamura]], read [[EC failures]]."),
    label("Many"), you("Show today's Emergency Contact runs"), text("[[42 Emergency Contact runs]] today: 39 done, 3 failed."),
  ],
} };

const s2: Scenario = { id: "s2-start-a-run", name: "S2 Start a run", recommend: "d2", why: "Values line up for checking before Approve, and running/done reuse the same row.", directions: {
  d1: [
    label("One person"), you("Separate Lin Ortega"), text("I'll file Lin Ortega's termination in UCPath:\n- Effective date __04/30/2031__\n- Last day worked __04/29/2031__\n- Reason __Resignation__\nFrom Kuali SIM-50112."), buttons("Approve", "Cancel"),
    label("A batch"), you("Retry the 3 rejected phones"), text(`I'll save these phones in UCPath:\n${PHONES.map(item => `- ${item.name}: ~~${item.before}~~ __${item.after}__ (${item.source})`).join("\n")}`), buttons("Retry", "Cancel"),
    label("Running"), text("Separating Lin Ortega: **Read timecard**, step 3 of 5. {{Stop}}"),
    label("Done"), text("Done. Lin Ortega's termination is saved as **T00042871**. {{Open log}}"),
  ],
  d2: [
    label("One person"), you("Separate Lin Ortega"), text("Separate Lin Ortega in UCPath."),
    rows([{ primary: "Effective date", value: "04/30/2031" }, { primary: "Last day worked", value: "04/29/2031" }, { primary: "Reason", value: "Resignation" }], "Smart HR Template · from Kuali SIM-50112"), buttons("Approve", "Cancel"),
    label("A batch"), you("Retry the 3 rejected phones"), text("Retry 3 phones in UCPath."),
    rows(PHONES.map(item => ({ primary: item.name, before: item.before, value: item.after, source: item.source, pick: true }))), buttons("Retry", "Cancel"),
    label("Running"), rows([{ primary: "Lin Ortega", secondary: "Separations · Read timecard · 3 of 5", state: "spin", trailing: "stop" }]),
    label("Done"), rows([{ primary: "Lin Ortega", secondary: "Separations · saved as T00042871", state: "ok", trailing: "open" }]),
  ],
  d3: [
    label("One person"), you("Separate Lin Ortega"), text("File [[Lin Ortega · 10031877]]'s termination: effective __04/30/2031__, last day worked __04/29/2031__, reason __Resignation__. From Kuali SIM-50112."), buttons("Approve", "Cancel"),
    label("A batch"), you("Retry the 3 rejected phones"), text(`Retry ${PHONES.map(item => `[[${item.name} → ${item.after}]]`).join(" ")}. Sources: page 2, Sheet1!D14, typed by you.`), buttons("Retry", "Cancel"),
    label("Running"), text("[[spin:Lin Ortega · Read timecard]] {{Stop}}"),
    label("Done"), text("[[ok:Lin Ortega · T00042871]] saved. {{Open log}}"),
  ],
} };

const s3: Scenario = { id: "s3-see-edits", name: "S3 See edits", recommend: "d1", why: "An applied edit is one sentence with its before and after; Undo sits where the eye ends.", directions: {
  d1: [
    label("Spreadsheet row"), you("Rei's last day worked should be 04/24"), text("Changed Separations tracker row 65, last day worked: ~~04/23/2031~~ **04/24/2031**. {{Undo}}"),
    label("Setting"), you("Email me when a run fails"), text("Run failure emails: ~~Off~~ **On**. {{Undo}}"),
    label("Rename"), you("Rename Scan_0412.pdf to April contacts scan"), text("Renamed ~~Scan_0412.pdf~~ **April contacts scan**. {{Undo}}"),
  ],
  d2: [
    label("Spreadsheet row"), you("Rei's last day worked should be 04/24"), rows([{ primary: "Last day worked", secondary: "Separations tracker · row 65", before: "04/23/2031", value: "04/24/2031", trailing: "undo" }]),
    label("Setting"), you("Email me when a run fails"), rows([{ primary: "Run failure emails", secondary: "Settings · Notifications", before: "Off", value: "On", trailing: "undo" }]),
    label("Rename"), you("Rename Scan_0412.pdf to April contacts scan"), rows([{ primary: "Run name", secondary: "Emergency Contact", before: "Scan_0412.pdf", value: "April contacts scan", trailing: "undo" }]),
  ],
  d3: [
    label("Spreadsheet row"), you("Rei's last day worked should be 04/24"), text("Updated [[tracker row 65]]: [[04/23/2031 → 04/24/2031]] {{Undo}}"),
    label("Setting"), you("Email me when a run fails"), text("[[Run failure emails]] [[Off → On]] {{Undo}}"),
    label("Rename"), you("Rename Scan_0412.pdf to April contacts scan"), text("Renamed [[Scan_0412.pdf → April contacts scan]] {{Undo}}"),
  ],
} };

const s4: Scenario = { id: "s4-choose", name: "S4 Choose", recommend: "d2", why: "Options as rows give each choice its facts and a clear target; the question stays one sentence.", directions: {
  d1: [
    you("Sort out Rei Nakamura's read-back"), text("Smart HR lists two terminations for Rei Nakamura (10431187). Which one is this run's?\n- {{T00042871}}: Pending, filed today 09:33 by this run\n- {{T00042905}}: Approved, filed 04/22/2031 by hand"),
  ],
  d2: [
    you("Sort out Rei Nakamura's read-back"), text("Smart HR lists two terminations for Rei Nakamura. Which one is this run's?"),
    rows([{ primary: "T00042871", secondary: "Pending · filed today 09:33 by this run", pick: true }, { primary: "T00042905", secondary: "Approved · filed 04/22/2031 by hand", pick: true }], undefined, true), buttons("Confirm", "Cancel"),
  ],
  d3: [
    you("Sort out Rei Nakamura's read-back"), text("Two terminations for [[Rei Nakamura]]. Is this run's [[T00042871 · Pending]] or [[T00042905 · Approved]]?"),
  ],
} };

const s5: Scenario = { id: "s5-cant-do-it", name: "S5 Can't do it", recommend: "d1", why: "A refusal is a sentence with its reason and one link; only the failure word is red.", directions: {
  d1: [
    label("Blocked"), you("Separate Rei Nakamura"), text("Not started: T00042871 is already pending, filed today 09:33. {{Open log}}"),
    label("Failure"), you("Retry Lin Ortega's contact"), text("!!Failed!!: UCPath didn't answer when saving Lin Ortega's contact. Nothing was saved. {{Retry}}"),
  ],
  d2: [
    label("Blocked"), you("Separate Rei Nakamura"), rows([{ primary: "Not started", secondary: "T00042871 already pending · filed today 09:33", state: "blocked", trailing: "open" }]),
    label("Failure"), you("Retry Lin Ortega's contact"), rows([{ primary: "Failed", secondary: "Lin Ortega · UCPath didn't answer · nothing saved", state: "fail", trailing: "open" }]), buttons("Retry"),
  ],
  d3: [
    label("Blocked"), you("Separate Rei Nakamura"), text("[[Rei Nakamura]] not started: [[T00042871 · Pending]] already filed today 09:33."),
    label("Failure"), you("Retry Lin Ortega's contact"), text("[[x:Lin Ortega]] !!Failed!! at Save. Nothing was saved. {{Retry}}"),
  ],
} };

export const SCENARIOS: readonly Scenario[] = [s1, s2, s3, s4, s5];

/** `assistantSheet=<scenario id>:<direction>` renders that scenario's direction in the assistant panel. */
export function assistantSheet(): { scenario: Scenario; direction: DirectionId } | undefined {
  if (typeof window === "undefined") return undefined;
  const [id, direction] = (new URLSearchParams(window.location.search).get("assistantSheet") ?? "").split(":");
  const scenario = SCENARIOS.find(item => item.id === id);
  return scenario && (direction === "d1" || direction === "d2" || direction === "d3") ? { scenario, direction } : undefined;
}
