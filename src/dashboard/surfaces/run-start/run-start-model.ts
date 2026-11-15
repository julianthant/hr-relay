import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { WorkbookActiveSelectionSchema } from "../../../models/dashboard/workbook-library.js";
import type { WorkbookLibraryEntry } from "../../../models/dashboard/workbook-library.js";
import {
  stepOmissionFactsSchema,
  type StepOmissionField,
  type StepOmissionForm,
} from "../../../models/workflow/step-omission.js";
import { inputRunValueNoun, parseInputRunText, toRawSubmission, type InputParserSpec, type InputRunSurface, parseTypedDate, type TypedDateControl, type TypedInputSurface, type TypedInputDraft } from "../../../models/workflow/ingress.js";
import { JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { CANONICAL_FIELDS } from "../../../models/fields/registry.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";

export interface RunInputPreview {
  readonly entries: readonly Readonly<{ index: number; sourceText: string }>[];
  readonly submissions: readonly JsonValue[];
  readonly problem: string | null;
}
export function typedInputMode(surface: TypedInputSurface, draft: TypedInputDraft) {
  const value = draft[surface.modeField] ?? surface.initialMode;
  if (value === null) return undefined;
  const mode = surface.modes.find(candidate => candidate.value === value);
  if (mode === undefined) throw new Error(`Undeclared input mode: ${String(value)}`);
  return mode;
}

/** The date controls the chosen mode shows, each one shared date typed as MM/DD/YYYY. */
export function typedDateControls(surface: TypedInputSurface, mode: string): readonly TypedDateControl[] {
  return surface.controls.filter((control): control is TypedDateControl => "kind" in control && control.modes.includes(mode));
}

/** Each date as typed, refused with the control's declared wording when required and missing or not a real day. */
function typedDates(surface: TypedInputSurface, mode: string, draft: TypedInputDraft): Record<string, string> {
  return Object.fromEntries(typedDateControls(surface, mode).flatMap(control => {
    const value = draft[control.field];
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "" ? control.required : parseTypedDate(text) === undefined) throw new Error(control.refusal);
    return text === "" ? [] : [[control.field, text]];
  }));
}

/** A surface that submits no mode has one mode, so its records name none. */
function recordMode(surface: TypedInputSurface, record: Record<string, JsonValue>): string | undefined {
  if (surface.submitsMode === false) return surface.modes[0]?.value;
  const value = record[surface.modeField];
  return typeof value === "string" ? value : undefined;
}

export const usDateText = (value: string): string | undefined => {
  if (parseTypedDate(value) !== undefined) return value;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return iso === null ? undefined : `${iso[2]}/${iso[3]}/${iso[1]}`;
};

export function typedInputDefaults(surface: TypedInputSurface, mode: string | null = surface.initialMode): TypedInputDraft {
  if (mode === null) return {};
  const selected = typedInputMode(surface, { [surface.modeField]: mode });
  if (selected === undefined) throw new Error(`Choose ${surface.modeLabel}.`);
  return { [surface.modeField]: mode, ...Object.fromEntries(typedDateControls(surface, mode).map(control => [control.field, ""])), ...Object.fromEntries(selected.defaults.map(({ field, value }) => {
    if (value.kind === "count") throw new Error("Typed input controls require text or boolean defaults");
    return [field, value.kind === "text" ? value.text : value.value];
  })) };
}

export function typedControlAvailable(surface: TypedInputSurface, draft: TypedInputDraft, field: string): boolean {
  const control = surface.controls.find(candidate => candidate.field === field);
  return control !== undefined && control.modes.includes(typedInputMode(surface, draft)?.value ?? "")
    && control.requires.every(required => draft[required] === true);
}

export function changeTypedInput(surface: TypedInputSurface, draft: TypedInputDraft, field: string, value: string | boolean): TypedInputDraft {
  const next = field === surface.modeField ? { ...typedInputDefaults(surface, String(value)),
    ...Object.fromEntries(surface.controls.filter(control => control.placement === "hidden" && draft[control.field] !== undefined).map(control => [control.field, draft[control.field]])) }
    : { ...draft, [field]: value };
  for (const control of surface.controls) {
    if (!("kind" in control) && control.placement !== "hidden" && !typedControlAvailable(surface, next, control.field)) next[control.field] = false;
  }
  return next;
}

function typedRecord(input: JsonValue): Record<string, JsonValue> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Typed input must be an object");
  return Object.fromEntries(Object.entries(input));
}

export function typedInputText(surface: TypedInputSurface, input: JsonValue): string {
  const record = typedRecord(input);
  const modeValue = recordMode(surface, record);
  if (modeValue === undefined) throw new Error("Typed input source has no mode");
  const selected = typedInputMode(surface, { [surface.modeField]: modeValue });
  if (selected === undefined) throw new Error("Typed input source has no mode");
  const display = selected.display;
  if (display.kind === "first-present") {
    const value = display.fields.map(field => record[field]).find(value => value !== undefined);
    if (typeof value !== "string" || value.length === 0) throw new Error("Typed input source has no display identity");
    return value;
  }
  return display.fields.map(field => {
    const value = record[field];
    if (value === undefined) return display.missing;
    if (typeof value !== "string" || value.length === 0) throw new Error(`Typed input source field ${field} is invalid`);
    return display.masked.includes(field) ? "[masked]" : value;
  }).join(display.separator);
}

export function restoreTypedInput(surface: TypedInputSurface, input: JsonValue): TypedInputDraft {
  const record = typedRecord(input);
  const mode = recordMode(surface, record);
  if (mode === undefined) throw new Error("Typed input source has no mode");
  const draft = { ...typedInputDefaults(surface, mode) };
  const dateFields = new Set(typedDateControls(surface, mode).map(control => control.field));
  for (const field of Object.keys(draft)) {
    if (field === surface.modeField && surface.submitsMode === false) continue;
    const value = record[field];
    if (typeof value !== typeof draft[field]) throw new Error(`Typed input source field ${field} is invalid`);
    const text = dateFields.has(field) && typeof value === "string" ? usDateText(value) : value;
    if (text === undefined) throw new Error(`Typed input source field ${field} is invalid`);
    if (typeof text === "string" || typeof text === "boolean") draft[field] = text;
  }
  const selected = typedInputMode(surface, draft);
  if (selected === undefined) throw new Error("Typed input source has no mode");
  if (selected.parser.kind === "name-tuple") {
    const parser = selected.parser;
    for (const field of [parser.familyName, parser.givenName]) {
      const value = record[field];
      CANONICAL_FIELDS.fullName.schema.parse(typeof value === "string" ? value.trim() : undefined);
    }
    if (!parser.identifiers.some(identifier => record[identifier.field] !== undefined))
      throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure(parser.missingIdentifiersCode, {})).text);
    for (const identifier of parser.identifiers) {
      const value = record[identifier.field];
      if (value === undefined) continue;
      if (identifier.canonicalField === "ssn") CANONICAL_FIELDS.ssn.schema.parse(value);
      else if (typeof value !== "string" || value.trim().length === 0 || value.toLowerCase() === parser.missing.toLowerCase()) throw new Error(`Typed input source field ${identifier.field} is invalid`);
    }
  }
  for (const control of surface.controls) {
    if (draft[control.field] === true && !typedControlAvailable(surface, draft, control.field)) throw new Error(`${control.label} requires its declared mode and options`);
  }
  typedInputText(surface, input);
  return draft;
}

function parseTypedEntries(surface: TypedInputSurface, text: string, draft: TypedInputDraft): readonly JsonValue[] {
  const mode = typedInputMode(surface, draft);
  if (mode === undefined) throw new Error(`Choose ${surface.modeLabel}.`);
  const options = { ...Object.fromEntries(mode.defaults.map(({ field }) => [field, draft[field]])), ...typedDates(surface, mode.value, draft) };
  const named = surface.submitsMode === false ? {} : { [surface.modeField]: mode.value };
  for (const control of surface.controls) {
    if (options[control.field] === true && !typedControlAvailable(surface, draft, control.field)) throw new Error(`${control.label} requires its declared mode and options`);
  }
  const parser = mode.parser;
  if (parser.kind === "entries") return parseInputRunText(parser.spec, text).map(entry => JsonValueSchema.parse({ ...toRawSubmission(entry), ...named, ...options }));
  return text.split(parser.delimiter).map(entry => entry.trim()).filter(Boolean).map(entry => {
    const fields = entry.split(",").map(field => field.trim());
    const fail = () => new Error(formatErrorCatalogFailure(createErrorCatalogFailure(parser.missingIdentifiersCode, {})).text);
    if (fields.length < parser.identifiers.length + 1) throw fail();
    const identifiers = fields.splice(-parser.identifiers.length);
    const legalName = fields.join(", ");
    const parts = legalName.split(",").map(part => part.trim());
    const family = parts.length > 1 ? parts[0] : legalName.split(/\s+/u).at(-1);
    const given = parts.length > 1 ? parts.slice(1).join(", ").trim() : legalName.split(/\s+/u).slice(0, -1).join(" ");
    const values = Object.fromEntries(parser.identifiers.flatMap((identifier, index) => {
      const value = identifiers[index];
      if (!value || value.toLowerCase() === parser.missing.toLowerCase()) return [];
      return [[identifier.field, identifier.canonicalField === "ssn" ? CANONICAL_FIELDS.ssn.schema.parse(value) : value]];
    }));
    if (Object.keys(values).length === 0) throw fail();
    return JsonValueSchema.parse({ ...named,
      [parser.familyName]: CANONICAL_FIELDS.fullName.schema.parse(family), [parser.givenName]: CANONICAL_FIELDS.fullName.schema.parse(given), ...values, ...options });
  });
}

export function previewRunInput(surface: InputRunSurface, text: string, draft: TypedInputDraft = {}, sourceInput?: JsonValue): RunInputPreview {
  if (text.trim().length === 0) return { entries: [], submissions: [], problem: null };
  try {
    if (surface.typedInput !== undefined) {
      const declaration = surface.typedInput;
      const mode = typedInputMode(declaration, draft);
      if (mode === undefined) throw new Error(`Choose ${declaration.modeLabel}.`);
      const values = { ...typedInputDefaults(declaration, mode.value), ...draft };
      if (sourceInput !== undefined) restoreTypedInput(declaration, sourceInput);
      const source = sourceInput === undefined ? undefined : typedRecord(sourceInput);
      const people = source !== undefined && recordMode(declaration, source) === mode.value && text === typedInputText(declaration, source)
        ? [JsonValueSchema.parse({ ...source, ...Object.fromEntries(mode.defaults.map(({ field }) => [field, values[field]])), ...typedDates(declaration, mode.value, values) })]
        : parseTypedEntries(declaration, text, values);
      const unique = new Map<string, JsonValue>();
      for (const person of people) {
        const record = typedRecord(person);
        const key = JSON.stringify(mode.identityFields.map(field => record[field] ?? null)).toLowerCase().replace(/\s+/gu, " ");
        if (!unique.has(key)) unique.set(key, person);
      }
      const submissions = [...unique.values()];
      return { entries: submissions.map((person, index) => ({ index, sourceText: typedInputText(declaration, person) })), submissions, problem: null };
    }
    const entries = parseInputRunText(surface.parser, text);
    return { entries, submissions: entries.map(entry => JsonValueSchema.parse(toRawSubmission(entry))), problem: null };
  } catch (caught) {
    return { entries: [], submissions: [], problem: caught instanceof Error ? caught.message : String(caught) };
  }
}

export function inputRunFieldLabel(parser: InputParserSpec): string {
  const noun = inputRunValueNoun(parser);
  return noun === "Kuali document numbers" ? "Kuali ID" : noun.charAt(0).toUpperCase() + noun.slice(1);
}

export function inputRunDelimiterHint(parser: InputParserSpec): string {
  if (parser.split.kind === "whole-text") return "Enter one value.";
  const delimiters = parser.split.delimiters.map(delimiter => delimiter === "\n" ? "a new line" : delimiter === ";" ? "a semicolon" : delimiter === "," ? "a comma" : JSON.stringify(delimiter));
  return `Separate values with ${delimiters.join(" or ")}.`;
}

/** State this dialog’s missing input surface, not an unsupported claim that all start routes refuse. */
export const START_DOOR_ABSENCE = Object.freeze({
  "no-typed-input": "This workflow declares no typed-input surface, so this dialog has no box for it.",
});
export type StartDoorAbsenceCode = keyof typeof START_DOOR_ABSENCE;

/** the two queue priorities `StartPlanIngress` accepts */
export type StartPriority = "interactive" | "bulk";
export type BrowserMode = "headless" | "headed";



/** Offer start methods only from descriptor and intake declarations; absent producers create no control. */
export type StartMethod = "typed" | "spreadsheet";

export const START_METHOD_LABEL: Readonly<Record<StartMethod, string>> = Object.freeze({
  typed: "Type values",
  spreadsheet: "Import a spreadsheet",
});

/* Upload creates a durable session only; mapping, validation and enqueue remain in the workspace. */

/** Missing spreadsheet support is the module’s absent intake declaration, not a client-invented restriction. */
export const SPREADSHEET_METHOD_ABSENCE =
  "This workflow declares no intake projection, so it is not spreadsheet-capable.";



/** Invalidate plans from one complete request identity so newly added controls cannot leave stale receipts. */
export interface StartRequestShape {
  workflowId: string;
  text: string;
  dryRun: boolean;
  browserMode: BrowserMode;
  captureBrowserScreenshots: boolean;
  priority: StartPriority;
  selectedStepKeys: readonly string[];
  /** Raw omission drafts identify the request; partially typed edits must invalidate plans before parsing succeeds. */
  stepOmissionDrafts: readonly Readonly<{ step: string; draft: StepOmissionDraft }>[];
}

/** Fingerprints match only when the server would receive the same complete question. */
export function startRequestFingerprint(request: StartRequestShape): string {
  return JSON.stringify([
    request.workflowId,
    request.text,
    request.dryRun,
    request.browserMode,
    request.captureBrowserScreenshots,
    request.priority,
    [...request.selectedStepKeys].sort(),
    request.stepOmissionDrafts.map(({ step, draft }) => [
      step,
      // Key order is a property of how the draft object was built, not of the
      // request; sorting keeps two identical forms one identity.
      Object.keys(draft).sort().map((key) => [key, draft[key]]),
    ]),
  ]);
}



export type RunControlGroupKey = "queue" | "safety";

export interface RunControlGroupSpec {
  key: RunControlGroupKey;
  /** the chip the group carries — `01`-based, contiguous, in reading order */
  step: string;
  title: string;
  description: string;
}

const RUN_CONTROL_GROUP_COPY: Readonly<Record<RunControlGroupKey, { title: string; description: string }>> =
  Object.freeze({
    queue: {
      title: "Queue behavior",
      description: "Choose how this work enters the browser queue.",
    },
    safety: {
      title: "Safety & mode",
      description: "Apply optional limits before the run starts.",
    },
  });

/** Draw only declared control groups and number the visible groups without gaps. */
export function runControlGroups(supportsDryRun: boolean): readonly RunControlGroupSpec[] {
  const keys: readonly RunControlGroupKey[] = supportsDryRun
    ? ["queue", "safety"]
    : ["queue"];
  return keys.map((key, index) => ({
    key,
    step: String(index + 1).padStart(2, "0"),
    ...RUN_CONTROL_GROUP_COPY[key],
  }));
}



/** Keep typed drafts raw; unchecked booleans are actual false answers, not unanswered fields. */
export type StepOmissionFactDraft = string | boolean;

/** one omitted step's whole form, keyed by field key */
export type StepOmissionDraft = Readonly<Record<string, StepOmissionFactDraft>>;

/** Never seed real-person facts; only checkbox false is an explicit resting answer. */
export function initialStepOmissionDraft(form: StepOmissionForm): StepOmissionDraft {
  const draft: Record<string, StepOmissionFactDraft> = {};
  for (const field of form.fields) draft[field.key] = field.kind === "boolean" ? false : "";
  return Object.freeze(draft);
}

/** Convert draft shape here; declared schemas own date, identifier, range and vocabulary validity. */
export type StepOmissionFieldRead =
  | Readonly<{ state: "value"; value: StepOmissionFactValue }>
  | Readonly<{ state: "unreadable"; message: string }>;

/** Narrow draft facts to declared form shapes before the shared JSON submission boundary. */
export type StepOmissionFactValue = string | number | boolean | readonly string[];

/** the parsed value of one declared field, or a loud refusal — never a widened `unknown` */
function asFactValue(field: string, value: unknown): StepOmissionFactValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return Object.freeze([...value]);
  throw new Error(`omission field "${field}" parsed to a value no declared kind produces`);
}

export function readStepOmissionField(
  field: StepOmissionField,
  draft: StepOmissionFactDraft | undefined,
): StepOmissionFieldRead {
  if (draft === undefined) return { state: "unreadable", message: "Type a value." };
  if (field.kind === "boolean") {
    // A string here means the row is drawing the wrong control for the kind.
    // Coercing it would let a checkbox-shaped fact reach the wire as text.
    if (typeof draft !== "boolean") return { state: "unreadable", message: "This field is a yes/no answer." };
    return { state: "value", value: draft };
  }
  if (typeof draft !== "string") return { state: "unreadable", message: "This field is typed, not a yes/no answer." };
  switch (field.kind) {
    case "integer": {
      const typed = draft.trim();
      if (typed.length === 0) return { state: "unreadable", message: "Type a whole number." };
      if (!/^-?\d+$/u.test(typed)) return { state: "unreadable", message: "Type a whole number, digits only." };
      return { state: "value", value: Number(typed) };
    }
    case "text-list":
      // Blank lines are not values; an empty box is an empty list, which the
      // field's own schema accepts or refuses. Nothing is filled in for it.
      return {
        state: "value",
        value: draft.split("\n").map((line) => line.trim()).filter((line) => line.length > 0),
      };
    default:
      return { state: "value", value: draft };
  }
}

/** Show per-field schema refusals; do not duplicate domain regex rules. */
export type StepOmissionFactsFold =
  | Readonly<{ state: "facts"; facts: Readonly<Record<string, StepOmissionFactValue>> }>
  | Readonly<{ state: "invalid"; errors: Readonly<Record<string, string>> }>;

export function foldStepOmissionFacts(form: StepOmissionForm, draft: StepOmissionDraft): StepOmissionFactsFold {
  const errors: Record<string, string> = {};
  const candidate: Record<string, StepOmissionFactValue> = {};
  for (const field of form.fields) {
    const read = readStepOmissionField(field, draft[field.key]);
    if (read.state === "unreadable") errors[field.key] = read.message;
    else candidate[field.key] = read.value;
  }
  const parsed = stepOmissionFactsSchema(form).safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String)[0];
      // Preserve actionable shape errors instead of replacing them with later generic required messages.
      if (key === undefined || errors[key] !== undefined) continue;
      errors[key] = issue.message;
    }
  }
  if (Object.keys(errors).length > 0) return { state: "invalid", errors: Object.freeze(errors) };
  if (!parsed.success) {
    // Unexpected schema paths are defects; never return candidate facts the schema refused.
    throw new Error("a step omission form refused without naming a field");
  }
  // Submit parsed transformed facts so confirmed and transmitted bytes are identical.
  const facts: Record<string, StepOmissionFactValue> = {};
  for (const [key, value] of Object.entries(parsed.data)) facts[key] = asFactValue(key, value);
  return { state: "facts", facts: Object.freeze(facts) };
}

/** the Steps screen's view of one step — the bootstrap projection, narrowed to what the folds read */
export interface StepOmissionStepView {
  readonly key: string;
  readonly label: string;
  readonly control:
    | Readonly<{ state: "selectable"; inputField: string }>
    | Readonly<{ state: "omittable"; form: StepOmissionForm; forces: readonly string[] }>
    | Readonly<{ state: "required"; reason: string }>;
}

/** the steps the operator has left OUT and that declare an omission, in timeline order */
export function omittedStepViews<T extends StepOmissionStepView>(
  steps: readonly T[],
  selectedStepKeys: readonly string[],
): readonly T[] {
  return steps.filter((step) => step.control.state === "omittable" && !selectedStepKeys.includes(step.key));
}

/** Lock exactly the omissions forced by the descriptor’s fixpoint, never another client rule. */
export function forcedStepOmissions(
  steps: readonly StepOmissionStepView[],
  selectedStepKeys: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const declared = new Set(steps.map((step) => step.key));
  const forcedBy = new Map<string, string[]>();
  for (const step of omittedStepViews(steps, selectedStepKeys)) {
    if (step.control.state !== "omittable") continue;
    for (const forced of step.control.forces) {
      if (!declared.has(forced)) {
        throw new Error(`step "${step.key}" forces "${forced}", which this workflow does not declare`);
      }
      const owners = forcedBy.get(forced) ?? [];
      owners.push(step.key);
      forcedBy.set(forced, owners);
    }
  }
  return new Map([...forcedBy].map(([key, owners]) => [key, Object.freeze(owners)]));
}

/** Apply the shared cascade while retaining other forcing omissions and timeline order. */
export function toggleStepSelection(
  steps: readonly StepOmissionStepView[],
  selectedStepKeys: readonly string[],
  key: string,
  next: boolean,
): readonly string[] {
  const step = steps.find((candidate) => candidate.key === key);
  if (step === undefined) throw new Error(`the Steps screen toggled "${key}", which this workflow does not declare`);
  if (step.control.state === "required") return selectedStepKeys;
  if (forcedStepOmissions(steps, selectedStepKeys).has(key)) return selectedStepKeys;
  const selected = new Set(selectedStepKeys);
  const forces = step.control.state === "omittable" ? step.control.forces : [];
  if (next) {
    selected.add(key);
    // Only the step this press let back in is offered a return; whether it
    // GETS one is the cascade's answer, below.
    for (const forced of forces) selected.add(forced);
  } else {
    selected.delete(key);
  }
  // Apply forces to the new selection once; another omitted step may still hold a target out.
  const stillForced = forcedStepOmissions(steps, [...selected]);
  for (const forced of stillForced.keys()) selected.delete(forced);
  return Object.freeze(steps.filter((candidate) => selected.has(candidate.key)).map((candidate) => candidate.key));
}

export function launchWorkbookReferences(requiredTypes: readonly string[], catalog: readonly WorkbookLibraryEntry[],
  selections: Readonly<Record<string, { libraryId: string; versionId: string; sheetId: string }>>, submissionCount: number,
  eligibleSources: readonly Readonly<{ libraryId: string; versionId: string; sheetId: string }>[], writable: boolean,
  selectedRows?: { typeId: string; rows: readonly { sheetId: string; rowId: string }[] }) {
  if (requiredTypes.length > 1 || selectedRows !== undefined && (selectedRows.rows.length !== submissionCount || !requiredTypes.includes(selectedRows.typeId))) throw new Error(ERROR_CATALOG.WORKBOOK_INVALID.text);
  return Array.from({ length: submissionCount }, (_, index) => requiredTypes.map(typeId => {
    const selection = selections[typeId];
    const entry = catalog.find(entry => entry.libraryId === selection?.libraryId);
    if (!entry || entry.state.removed || entry.state.origin.kind !== 'local'
      || !entry.state.versions.some(version => version.id === selection.versionId)
      || writable && entry.state.selectedVersionId !== selection.versionId
      || !eligibleSources.some(source => source.libraryId === selection.libraryId && source.versionId === selection.versionId && source.sheetId === selection.sheetId))
      throw new Error(ERROR_CATALOG.WORKBOOK_INVALID.text);
    return WorkbookActiveSelectionSchema.parse({ entry: index + 1, libraryId: entry.libraryId, versionId: selection.versionId,
      sheetId: selection.sheetId, expectedVersion: entry.version,
      ...(selectedRows?.typeId === typeId ? { selectedRow: { sheetId: selectedRows.rows[index].sheetId, rowId: selectedRows.rows[index].rowId } } : {}) });
  })).flat();
}
