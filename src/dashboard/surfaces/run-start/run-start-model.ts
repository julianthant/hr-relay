/** The Run Modal's pure half — its vocabularies and its
 * one fold (ref frontend-backend-integration §8.14). */
import type { EnqueuePolicy } from "../../../models/workflow/presentation.js";
import {
  stepOmissionFactsSchema,
  type StepOmissionField,
  type StepOmissionForm,
} from "../../../models/workflow/step-omission.js";
import { inputRunValueNoun, type InputParserSpec } from "../../../models/workflow/ingress.js";

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

/** Describe implemented enqueue behavior; an unsupported supersede policy must not claim it replaces running work. */
export const ENQUEUE_POLICY_MEANING: Readonly<Record<EnqueuePolicy, string>> = Object.freeze({
  "reject-active": "Refuse overlapping subject runs",
  "supersede-active": "Replace the active runs shown in the final review",
  "allow-parallel": "Starts regardless of what is already running for the same subject",
});

/** Enqueue policy has no per-start override; a selector would offer an ignored choice. */
export const ENQUEUE_POLICY_REASON = "Fixed by this workflow.";

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
