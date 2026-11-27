/** Run panel fixtures for the state gallery: decisions the log fixtures do not hold, capture images and OCR review cards. Browser-safe. */
import { projectDecision, type ServedOption } from "../../../../src/backend/runs/decisions/project-decision.js";
import { RunDecisionWireSchema, type CandidateTableWire, type RunDecisionType } from "../../../../src/models/dashboard/run-decision.js";
import type { LogDecision } from "../../../../src/dashboard/surfaces/run-detail/logs/log-decision-model.js";
import type { LogEntry, LogScreenshot, LogStep } from "../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import type { RecordReviewProps, ReviewField, ReviewRecordView, ReviewSourcePage } from "../../../../src/dashboard/surfaces/run-detail/review/review-record-model.js";
import { decisionScenarios, separationLogs } from "./log-preview/log-fixture.js";
import { logDecisionExamples } from "./log-preview/log-decision-fixture.js";

const action = (id: string, extra: Partial<ServedOption> = {}): ServedOption => ({ id, send: { via: "action", actionKey: id }, ...extra });
const rowAction = (id: string, actionKey: string): ServedOption => ({ id, send: { via: "row-action", actionKey } });

const PEOPLE: CandidateTableWire = {
  title: "Matching rows",
  columns: [{ id: "name", label: "Name" }, { id: "department", label: "Department" }, { id: "row", label: "Row" }],
  rows: [
    { id: "row-4", name: "Alex Morgan · row 4", rowNumber: 4, cells: [{ columnId: "name", value: "Morgan, Alex" }, { columnId: "department", value: "Campus Services" }, { columnId: "row", value: "4" }] },
    { id: "row-9", name: "Alex Morgan · row 9", rowNumber: 9, cells: [{ columnId: "name", value: "Morgan, Alex" }, { columnId: "department", value: "Library", tone: "attention" }, { columnId: "row", value: "9" }] },
  ],
  typed: { label: "Row number", placeholder: "4", pattern: "^\\d+$" },
};

const decision = (title: string, state: LogDecision["state"], served: LogDecision["served"], message?: string): LogDecision =>
  ({ title, state, ...(message === undefined ? {} : { message }), footer: "Alex Morgan · DEMO-1042", ...(served === undefined ? {} : { served }) });

/** The decision example a log fixture already holds, by id. */
export function exampleDecision(id: string): LogDecision {
  const entry = logDecisionExamples.find(example => example.id === id)?.entry;
  if (entry?.kind !== "decision") throw new Error(`log decision example ${id} is missing`);
  return entry.decision;
}

/** One decision per served decision type; the existing examples stand for the types they already show. */
export const RUN_DECISIONS: Readonly<Record<RunDecisionType, LogDecision>> = {
  "identity-mismatch": exampleDecision("review-identity"),
  "pick-person": exampleDecision("review-candidates"),
  "pick-row": decision("Pick a row", "review", projectDecision("pick-row", [action("confirm", { input: { kind: "candidate", table: PEOPLE } })],
    { context: "Two rows match Alex Morgan in the work-study sheet." })),
  "review-before-write": decision("Review before writing", "review", projectDecision("review-before-write", [
    { id: "approve-write", label: "File the termination", send: { via: "gate-arm", gateNodeId: "review-write", expectedVersion: 3, arm: "approve" } },
    { id: "skip-write", label: "Skip this person", hint: "Files nothing.", send: { via: "gate-arm", gateNodeId: "review-write", expectedVersion: 3, arm: "skip" } },
  ], { context: "Relay will file the termination for DEMO-1042 on 09/26/2026." })),
  "write-parked": exampleDecision("parked"),
  "write-unknown": exampleDecision("parked-read-back"),
  "failed-retryable": exampleDecision("failure-no-write"),
  "failed-after-write": exampleDecision("failure-committed"),
  "member-failed": decision("Member failed", "failed", projectDecision("member-failed", [action("retry")]), "UCPath could not find Alex Morgan. The other people are unchanged."),
  "correct-value": exampleDecision("employee-not-found"),
  "workbook-row": decision("Pick the row to write", "review", projectDecision("workbook-row", [action("confirm", { input: { kind: "candidate", table: PEOPLE } })],
    { context: "Pick the row the termination date comes from." })),
  "sign-in": decision("Sign in to continue", "held", RunDecisionWireSchema.parse({ type: "sign-in", title: "Sign in to continue", choiceLabel: "Next step", options: [
    { id: "sign-in-again", label: "Sign in again", hint: "Needs Duo.", send: { via: "command", family: "worker-browser", type: "refresh-browser" } },
    { id: "reopen-browser", label: "Reopen browser", send: { via: "command", family: "worker-browser", type: "reopen-browser" } },
  ] }), "UCPath signed this browser out."),
  paused: decision("Run paused", "held", projectDecision("paused", [rowAction("resume", "resume"), rowAction("cancel-run", "cancel")])),
  stalled: decision("Run not responding", "held", projectDecision("stalled", [rowAction("rerun", "rerun"), rowAction("cancel-run", "cancel")]),
    "No step has finished in 10 minutes."),
  refused: decision("Request refused", "failed", RunDecisionWireSchema.parse({ type: "refused", title: "Request refused", options: [] }),
    "The run changed before Relay could send this. Reload and try again."),
  cancelling: decision("Cancelling", "recorded", projectDecision("cancelling", []), "Relay stops after the current step."),
};

/** A run decision entry as the last step of a run that reached it. */
export function decisionSteps(entryId: string, value: LogDecision): readonly LogStep[] {
  const entry: LogEntry = { id: entryId, kind: "decision", time: "09:32:39", decision: value };
  return [...separationLogs.slice(0, 6), { id: "run-decision", time: "09:32:39", title: "Run decision", header: false, entries: [entry] }];
}

/** The steps and timeline a log fixture scenario already pairs with its decision. */
export function exampleScenario(id: string) {
  const scenario = decisionScenarios.find(candidate => candidate.id === id);
  if (scenario === undefined) throw new Error(`log decision scenario ${id} is missing`);
  return scenario;
}

/** A capture image the gallery can decode: an SVG at the stated size. */
export function captureImage(width: number, height: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}"><rect width="100%" height="100%" fill="#eef1f6"/><rect x="24" y="24" width="${String(width - 48)}" height="56" fill="#cdd5e3"/><text x="40" y="60" font-family="sans-serif" font-size="20" fill="#273244">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function captureOf(kind: LogScreenshot["kind"], label: string, height = 300, src = captureImage(850, height, label)): LogScreenshot {
  return { src, alt: `${label} for Alex Morgan`, label, time: "09:31:17", system: "UCPath", width: 850, height, ...(kind === undefined ? {} : { kind }) };
}

export function captureStep(shot: LogScreenshot): LogStep {
  return { id: "capture", time: "09:31:17", title: "Search employee name", system: "UCPath", entries: [{ id: "capture-entry", kind: "fields", title: "Matching employees",
    fields: [{ id: "capture-field", time: "09:31:17", kind: "read", label: "Employee", value: "Morgan, Alex · DEMO-1042" }], screenshots: [shot] }] };
}

const FIELDS: readonly ReviewField[] = [
  { key: "name", label: "Employee name", value: "Example, Avery", section: "Employee" },
  { key: "eid", label: "Employee ID", value: "12345678", section: "Employee" },
  { key: "contactName", label: "Contact name", value: "Example, Robin", section: "Emergency Information" },
  { key: "relationship", label: "Relationship", value: "Parent", kind: "relationship", section: "Emergency Information" },
];
const PAGE: ReviewSourcePage = { page: 1, imageUrl: captureImage(612, 792, "Scanned form, page 1"), label: "Page 1" };

function reviewCard(name: string, record: Partial<ReviewRecordView>, disposition?: { label: string; tone: "success" | "neutral" }) {
  return { name, pages: [PAGE], ...(disposition === undefined ? {} : { disposition }),
    record: { id: `record-${name}`, page: 1, kind: "emergency-contact", fields: FIELDS, selected: true, warnings: [], ...record } satisfies ReviewRecordView };
}

export const REVIEW_CARDS = {
  ready: [reviewCard("Example, Avery", {})],
  unconfirmed: [reviewCard("Example, Avery", { unconfirmed: "Several UCPath matches", blockers: ["Several UCPath matches"] })],
  "needs-review": [reviewCard("Example, Avery", { blockers: ["Relationship needs review"], fields: FIELDS.map(field => field.key === "relationship" ? { ...field, value: "" } : field) })],
  approved: [reviewCard("Example, Avery", {}, { label: "Approved", tone: "success" })],
  empty: [],
} satisfies Record<string, RecordReviewProps["cards"]>;

const inlined = (shot: LogScreenshot): LogScreenshot => shot.src.startsWith("/logs-preview/") ? { ...shot, src: captureImage(shot.width, shot.height, shot.label ?? shot.alt) } : shot;
const inlineEntry = (entry: LogEntry): LogEntry => {
  if (entry.kind === "decision") return entry.decision.screenshots === undefined ? entry : { ...entry, decision: { ...entry.decision, screenshots: entry.decision.screenshots.map(inlined) } };
  if (entry.kind === "note" || entry.screenshots === undefined) return entry;
  return { ...entry, screenshots: entry.screenshots.map(inlined) };
};

/** Log fixtures point at images the dashboard serves; the gallery serves none, so each capture becomes an image of its own size. */
export const withInlineCaptures = (steps: readonly LogStep[]): readonly LogStep[] => steps.map(step => ({ ...step, entries: step.entries.map(inlineEntry) }));
