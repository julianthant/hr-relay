import type { WorkflowStartWire } from "../../../models/dashboard/bootstrap.js";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { StartRowKind, StartRowLockReason, StepOmissionField, StepOmissionForm, StepOmissionInput } from "../../../models/workflow/step-omission.js";
import { SYSTEM_NAME, type BrowserSystemId } from "../shared/status/system-chip-model.js";
import { foldStepOmissionFacts, type StepOmissionDraft, type StepOmissionFactDraft, type StepOmissionFactsFold, type StepOmissionFactValue, type StepOmissionStepView } from "./run-start-model.js";

type ServedRow = NonNullable<WorkflowStartWire["rows"]>[number];
/** One served step as the Run dialog holds it. */
export type StartStep = Readonly<{
  key: string;
  label: string;
  includedByDefault: boolean;
  systems?: readonly BrowserSystemId[];
  control:
    | { state: "selectable"; inputField: string }
    /** the step declares an omission the operator may take instead of running */
    | { state: "omittable"; form: StepOmissionForm; forces: readonly string[] }
    | { state: "required"; reason: string };
}>;

/** The served start data the Steps stage draws from. */
export interface StepRowSource {
  readonly steps: readonly StartStep[];
  readonly rows?: readonly ServedRow[] | undefined;
}

/** One row of the Steps stage, drawn from the served row list only. */
export interface StepRow {
  readonly key: string;
  readonly label: string;
  readonly kind: StartRowKind;
  readonly startWithValuesAlone?: true;
  readonly lockReason?: StartRowLockReason;
  /** The grey line under the title. */
  readonly note: string | undefined;
  /** The served step this row switches; absent on a child row and on a locked row. */
  readonly stepKey?: string;
  /** The delegated child step a typed entry for this row is filed under. */
  readonly child?: Readonly<{ workflow: string; step: string }>;
  readonly form?: StepOmissionForm;
  readonly includedByDefault: boolean;
  readonly forces: readonly string[];
  readonly selectable: boolean;
  /** The served steps whose source outcome the row's badge reports, with the child workflow they belong to. */
  readonly members: readonly Readonly<{ workflow?: string; step: string; nodes?: readonly string[] }>[];
}

const LOCK_NOTE: Readonly<Record<StartRowLockReason, string>> = {
  "form-action": "Form action · required",
  approval: "Approval required",
  "bound-read": "Required read · a later step uses what it finds",
  "guard-read": "Required read · it guards a live step",
};

const systemNote = (systems: readonly BrowserSystemId[] | undefined): string | undefined =>
  systems === undefined || systems.length === 0 ? undefined : systems.map(system => SYSTEM_NAME[system]).join(" · ");

/** The rows a workflow serves; a workflow that serves none shows one row per step. */
export function startRowsOf(source: StepRowSource): readonly StepRow[] {
  const stepOf = (key: string) => source.steps.find(step => step.key === key);
  const labelOf = (key: string) => source.rows?.find(row => row.target?.workflow === undefined && row.target?.step === key)?.label ?? stepOf(key)?.label ?? key;
  // A step done by hand is never switched off for the operator, so it is not named here.
  const forced = (key: string) => { const control = stepOf(key)?.control; return control?.state !== "omittable" || control.form.fields.length > 0; };
  const forcesNote = (forces: readonly string[]) => forces.some(forced) ? `Also omits: ${forces.filter(forced).map(labelOf).join(", ")}` : undefined;
  if (source.rows === undefined) {
    return source.steps.map((step): StepRow => {
      const control = step.control;
      const systems = systemNote(step.systems);
      const common = { key: step.key, label: step.label, stepKey: step.key, includedByDefault: step.includedByDefault, members: [{ step: step.key }] } as const;
      if (control.state === "required") return { ...common, kind: "locked", note: systems ?? "Automatic", forces: [], selectable: false };
      return control.state === "omittable"
        ? { ...common, kind: "switch", note: forcesNote(control.forces) ?? systems, form: control.form, forces: control.forces, selectable: false }
        : { ...common, kind: "switch", note: systems, forces: [], selectable: true };
    });
  }
  return source.rows.map((row): StepRow => {
    const own = row.target !== undefined && row.target.workflow === undefined ? row.target.step : undefined;
    const systems = systemNote([...new Set(row.members.flatMap(member => member.workflow === undefined ? stepOf(member.step)?.systems ?? [] : []))]);
    const workflow = row.target?.workflow;
    const childRows = source.rows?.filter(other => other.target?.workflow === workflow);
    const forces = (row.manual?.forces ?? []).map(step => workflow === undefined ? step
      : childRows?.find(other => other.target?.step === step)?.key ?? step);
    const cascadeNote = row.off !== undefined && forces.length > 0
      ? `Also skips: ${forces.map(key => workflow === undefined ? labelOf(key) : childRows?.find(other => other.key === key)?.label ?? key).join(", ")}`
      : forcesNote(forces);
    const note = row.kind === "switch" ? cascadeNote ?? systems
      : row.lockReason === undefined ? systems ?? "Automatic" : LOCK_NOTE[row.lockReason];
    return {
      key: row.key, label: row.label, kind: row.kind, note, includedByDefault: row.includedByDefault, forces, selectable: row.selection !== undefined,
      ...(row.startWithValuesAlone === undefined ? {} : { startWithValuesAlone: row.startWithValuesAlone }),
      members: row.members.map(({ workflow, step, nodes }) => ({ step, ...(workflow === undefined ? {} : { workflow }), ...(nodes === undefined ? {} : { nodes }) })),
      ...(row.lockReason === undefined ? {} : { lockReason: row.lockReason }),
      ...(own === undefined ? {} : { stepKey: own }),
      ...(row.target?.workflow === undefined ? {} : { child: { workflow: row.target.workflow, step: row.target.step } }),
      ...(row.manual === undefined ? {} : { form: row.manual.form }),
    };
  });
}

export function childStepViews(rows: readonly StepRow[]): readonly StepOmissionStepView[] {
  return rows.flatMap((row): StepOmissionStepView[] => row.child !== undefined && row.kind === "switch" && row.form !== undefined
    ? [{ key: row.key, label: row.label, control: { state: "omittable", form: row.form, forces: row.forces } }]
    : []);
}

/** Rows whose fields the operator opened without a step switch: a locked row's Enter manually and a child row switched off. */
export type ManualRows = readonly string[];

export function retainedRowSteps(row: StepRow, snapshot: RerunValuesSnapshot) {
  const retained = row.members.map(({ workflow, step }) => {
    const match = workflow === undefined ? snapshot.retainedSteps?.find(candidate => candidate.key === step) : undefined;
    return match;
  });
  return retained.every(step => step !== undefined) ? retained : [];
}

export function rowIncluded(row: StepRow, selectedStepKeys: readonly string[], manualRows: ManualRows, snapshot?: RerunValuesSnapshot | null): boolean {
  if (snapshot?.retainedSteps !== undefined) {
    const retained = retainedRowSteps(row, snapshot);
    if (retained.length > 0) return retained.some(({ key }) => selectedStepKeys.includes(key));
    if (row.members.every(member => member.workflow !== undefined)) return sourceBadge(row, snapshot) !== "completed";
  }
  if (row.kind !== "switch") return true;
  return row.stepKey === undefined ? !manualRows.includes(row.key) : selectedStepKeys.includes(row.stepKey);
}

/** The row's typed fields are showing: a switch that is off, or a locked row the operator opened. */
export function rowFieldsOpen(row: StepRow, selectedStepKeys: readonly string[], manualRows: ManualRows): boolean {
  if (row.form === undefined) return false;
  return row.kind === "switch" ? !rowIncluded(row, selectedStepKeys, manualRows) : manualRows.includes(row.key);
}

/** The count "N of M included": a switch that is off is left out; a locked row always counts. */
export function includedRowCount(rows: readonly StepRow[], selectedStepKeys: readonly string[], manualRows: ManualRows, snapshot?: RerunValuesSnapshot | null): number {
  return rows.filter(row => rowIncluded(row, selectedStepKeys, manualRows, snapshot)).length;
}

/** A single typed-values row can supply the entire run. */
export function lastIncludedSwitch(row: StepRow, rows: readonly StepRow[], selectedStepKeys: readonly string[], manualRows: ManualRows): boolean {
  if (row.startWithValuesAlone === true) return false;
  return row.kind === "switch" && rowIncluded(row, selectedStepKeys, manualRows) && includedRowCount(rows, selectedStepKeys, manualRows) === 1;
}

/** One row whose typed fields are open, with what the operator has typed and how it reads. */
export interface OpenStepRow {
  readonly row: StepRow;
  readonly form: StepOmissionForm;
  readonly draft: StepOmissionDraft;
  readonly fold: StepOmissionFactsFold;
}

export type StepEntry = Readonly<{ step: string; workflow?: string; facts: Readonly<Record<string, StepOmissionFactValue>> }>;

/** The `stepOmissions` the request carries, or null while one open row does not parse. */
export function stepEntries(open: readonly OpenStepRow[]): readonly StepEntry[] | null {
  const entries: StepEntry[] = [];
  for (const { row, fold } of open) {
    if (fold.state !== "facts") return null;
    const target = row.child ?? (row.stepKey === undefined ? undefined : { step: row.stepKey });
    if (target === undefined) throw new Error(`row "${row.key}" opened typed fields but names no step to file them under`);
    entries.push({ ...("workflow" in target ? { workflow: target.workflow } : {}), step: target.step, facts: fold.facts });
  }
  return Object.freeze(entries);
}

/** The words a field or row label takes in the middle of a sentence; acronyms such as CRM and ID stay. */
export function inSentence(label: string): string {
  const [first = "", ...rest] = label.split(" ");
  return [/^[A-Z0-9-]{2,}$/u.test(first) ? first : first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(" ");
}

const blank = (value: string | boolean | undefined): boolean => value === undefined || typeof value === "string" && value.trim() === "";

function failureText(field: StepOmissionField, row: StepRow, draft: StepOmissionDraft, message: string): string {
  const value = draft[field.key];
  if (blank(value)) return field.kind === "enum" ? `Choose ${inSentence(field.label)} for ${inSentence(row.label)}.` : `Enter ${inSentence(field.label)} for ${inSentence(row.label)}.`;
  if (field.kind === "us-date" || field.kind === "iso-date") return `${field.label} must be a valid date in MM/DD/YYYY format.`;
  if (field.kind === "eid") return `${field.label} must start with 10 and contain eight digits.`;
  if (field.kind === "enum") return `Choose ${inSentence(field.label)} for ${inSentence(row.label)}.`;
  return `${field.label}: ${message.replace(/^./u, letter => letter.toLowerCase())}`.replace(/\.?$/u, ".");
}

export interface StepsFailure { readonly text: string; readonly rowKey: string; readonly fieldKey: string }

/** The first missing or invalid field across the open rows, in row then field order. */
export function firstStepsFailure(open: readonly OpenStepRow[]): StepsFailure | null {
  for (const { row, form, draft, fold } of open) {
    if (fold.state !== "invalid") continue;
    const field = form.fields.find(candidate => candidate.key in fold.errors);
    if (field !== undefined) return { text: failureText(field, row, draft, fold.errors[field.key] ?? ""), rowKey: row.key, fieldKey: field.key };
  }
  return null;
}

/** The source outcome a row's badge shows, from the nodes of the steps it is made of. */
export type SourceBadge = "completed" | "skipped" | "failed" | "cancelled" | "not-started";

function rowSourceNodes(row: StepRow, snapshot: RerunValuesSnapshot) {
  return row.members.flatMap(member => {
    const steps = member.workflow === undefined ? snapshot.steps : snapshot.children?.find(child => child.workflow === member.workflow)?.steps ?? [];
    const step = steps.find(candidate => candidate.key === member.step);
    return step === undefined ? [] : step.nodes.filter(node => member.nodes === undefined || member.nodes.includes(node.nodeId));
  });
}

function isSettledManualOmission(nodes: ReturnType<typeof rowSourceNodes>): boolean {
  const manuallyOmitted = (node: (typeof nodes)[number]) => node.reason === "step-omitted" || node.reason === "operator-asserted";
  return nodes.some(manuallyOmitted) && nodes.every(node => node.state === "completed" || manuallyOmitted(node));
}

/** The source outcome Rerun preselection reads: a condition-skipped step counts as not run and nothing reads Cancelled, so the badge never moves the restart point. */
export function preselectionBadge(row: StepRow, snapshot: RerunValuesSnapshot): Exclude<SourceBadge, "cancelled"> | undefined {
  const nodes = rowSourceNodes(row, snapshot);
  if (nodes.length === 0) return undefined;
  if (nodes.some(node => node.state === "failed")) return "failed";
  if (isSettledManualOmission(nodes)) return "skipped";
  return nodes.every(node => node.state === "completed" && node.reason !== "condition-skipped") ? "completed" : "not-started";
}

export function sourceBadge(row: StepRow, snapshot: RerunValuesSnapshot): SourceBadge | undefined {
  const nodes = rowSourceNodes(row, snapshot);
  if (nodes.length === 0) return undefined;
  if (nodes.some(node => node.state === "failed")) return "failed";
  if (isSettledManualOmission(nodes)) return "skipped";
  if (nodes.every(node => node.state === "completed")) return "completed";
  return snapshot.source.outcome === "cancelled" && nodes.some(node => node.reason === "incomplete-execution") ? "cancelled" : "not-started";
}

/** The facts the source run typed for a row's step, offered again as typed by hand. */
export function sourceTypedFacts(row: StepRow, snapshot: RerunValuesSnapshot): Readonly<Record<string, unknown>> | undefined {
  const target = row.child ?? (row.stepKey === undefined ? undefined : { workflow: undefined, step: row.stepKey });
  if (target === undefined) return undefined;
  return snapshot.typed?.find(entry => entry.step === target.step && entry.workflow === target.workflow)?.facts;
}

export function rowOpenFold(row: StepRow, form: StepOmissionForm, draft: StepOmissionDraft, input?: StepOmissionInput): OpenStepRow {
  return { row, form, draft, fold: foldStepOmissionFacts(form, draft, input) };
}

/** A served or typed value as the field shows it: dates read MM/DD/YYYY, a list one per line. */
export function factDraft(field: StepOmissionField, value: unknown): StepOmissionFactDraft {
  if (field.kind === "boolean") return value === true;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join("\n");
  const text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
  const iso = field.kind === "iso-date" ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text) : null;
  return iso === null ? text : `${iso[2]}/${iso[3]}/${iso[1]}`;
}
