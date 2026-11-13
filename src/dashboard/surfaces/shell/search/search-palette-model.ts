import type { NavbarSearchResult } from "./navbar-view-model.js";

export type PaletteFilter = "all" | "actions" | "runs" | "workflows" | "spreadsheets";
export const PALETTE_FILTERS: readonly { id: PaletteFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "actions", label: "Actions" }, { id: "runs", label: "Runs" }, { id: "workflows", label: "Workflows" }, { id: "spreadsheets", label: "Spreadsheets" },
];
export type PaletteAction = "start" | "spreadsheets" | "settings";
export type PaletteSheet = Readonly<{ id: string; name: string; detail: string }>;
export type PaletteRow =
  | Readonly<{ kind: "action"; id: PaletteAction; label: string }>
  | Readonly<{ kind: "run"; id: string; label: string; tag: string; tone: RunTone; result: NavbarSearchResult }>
  | Readonly<{ kind: "workflow"; id: string; label: string }>
  | Readonly<{ kind: "sheet"; id: string; label: string; tag: string }>;
export type PaletteSection = Readonly<{ id: Exclude<PaletteFilter, "all">; label: string; rows: readonly PaletteRow[] }>;
export type RunTone = "danger" | "warning" | "positive" | "info" | "neutral";

/** Synthetic library list until the Spreadsheets library feeds the palette. */
export const PALETTE_SPREADSHEETS: readonly PaletteSheet[] = [
  { id: "roster", name: "Contact roster", detail: "v6 · Updated Nov 8" },
  { id: "i9", name: "I-9 tracker", detail: "v3 · Updated Nov 7" },
  { id: "hires", name: "Onboarding hires", detail: "v4 · Updated Nov 6" },
  { id: "parking", name: "Parking permits", detail: "v2 · Updated Oct 22" },
];

const ACTIONS: readonly Extract<PaletteRow, { kind: "action" }>[] = [
  { kind: "action", id: "start", label: "Start a run" }, { kind: "action", id: "spreadsheets", label: "Spreadsheets" }, { kind: "action", id: "settings", label: "Settings" },
];
/** Rows shown per section under the All chip; each other chip shows its full list. */
const ALL_LIMIT = { actions: 3, runs: 5, workflows: 3, spreadsheets: 3 } as const;

export function runTone(state: string): RunTone {
  const text = state.toLocaleLowerCase("en-US");
  if (/fail|error|unknown|parked/u.test(text)) return "danger";
  if (/review|wait|attention|need/u.test(text)) return "warning";
  if (/done|complete|success/u.test(text)) return "positive";
  if (/run|start|queue/u.test(text)) return "info";
  return "neutral";
}

const matches = (query: string, text: string) => query.split(/\s+/u).filter(Boolean).every(word => text.toLocaleLowerCase("en-US").includes(word));

/** The sections that survive the query and the chip, each trimmed to a few rows while idle. */
export function paletteSections(input: { query: string; filter: PaletteFilter; runs: readonly NavbarSearchResult[]; runsMatched?: boolean; workflows: readonly { id: string; label: string }[]; sheets: readonly PaletteSheet[] }): readonly PaletteSection[] {
  const query = input.query.toLocaleLowerCase("en-US").trim();
  const trim = <T,>(id: keyof typeof ALL_LIMIT, rows: readonly T[]) => input.filter === "all" ? rows.slice(0, ALL_LIMIT[id]) : rows;
  const sections: PaletteSection[] = [
    { id: "actions", label: "Quick actions", rows: trim("actions", ACTIONS.filter(row => matches(query, row.label))) },
    { id: "runs", label: "Runs", rows: trim("runs", input.runs.filter(run => input.runsMatched || matches(query, `${run.subject} ${run.workflow} ${run.state} ${run.publicId ?? ""} ${run.id}`)).map((result): PaletteRow => ({ kind: "run", id: result.id, label: result.subject, tag: `${result.workflow} · ${result.state.charAt(0).toLocaleUpperCase("en-US")}${result.state.slice(1)}`, tone: runTone(result.state), result }))) },
    { id: "workflows", label: "Workflows", rows: trim("workflows", input.workflows.filter(flow => matches(query, flow.label)).map((flow): PaletteRow => ({ kind: "workflow", id: flow.id, label: flow.label }))) },
    { id: "spreadsheets", label: "Spreadsheets", rows: trim("spreadsheets", input.sheets.filter(sheet => matches(query, sheet.name)).map((sheet): PaletteRow => ({ kind: "sheet", id: sheet.id, label: sheet.name, tag: sheet.detail }))) },
  ];
  return sections.filter(section => (input.filter === "all" || section.id === input.filter) && section.rows.length > 0);
}

export const paletteRowValue = (row: PaletteRow) => `${row.kind}:${row.id}`;
