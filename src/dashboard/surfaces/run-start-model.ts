/**
 * The Run Modal's pure half — its vocabularies and its one fold (ref frontend-backend-integration §8.14).
 *
 * It lives beside `run-start.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 *
 * Everything here is D251: three facts the modal already held and did not draw.
 */
import type { EnqueuePolicy } from "../../domain/workflow/presentation.js";
import {
  stepOmissionFactsSchema,
  type StepOmissionField,
  type StepOmissionForm,
} from "../../domain/workflow/step-omission.js";
import type { InputParserSpec } from "../../domain/workflow/ingress.js";

export function inputRunDelimiterHint(parser: InputParserSpec): string {
  if (parser.split.kind === "whole-text") return "Enter one value.";
  const delimiters = parser.split.delimiters.map(delimiter => delimiter === "\n" ? "a new line" : delimiter === ";" ? "a semicolon" : delimiter === "," ? "a comma" : JSON.stringify(delimiter));
  return `Separate values with ${delimiters.join(" or ")}.`;
}

/**
 * Why THIS DIALOG cannot start a workflow.
 *
 * The set is the MODAL's own preconditions, and the wording says so, because
 * the modal must never spell a refusal the server would not make: `POST
 * /start-plans` takes JSON submissions and parses them with `descriptor.input`,
 * so a caller that composes its own submission can start a workflow that
 * declares no typed-input surface. What this dialog lacks is a box to type into.
 *
 * There is exactly one arm today, and `availability` is deliberately not a
 * second: `buildBootstrap` serves every workflow `{state:"available"}`
 * unconditionally and no start path reads it, so an arm keyed on it would be a
 * reason nothing produces and nothing enforces.
 */
export const START_DOOR_ABSENCE = Object.freeze({
  "no-typed-input": "This workflow declares no typed-input surface, so this dialog has no box for it.",
});
export type StartDoorAbsenceCode = keyof typeof START_DOOR_ABSENCE;

/**
 * What the descriptor's declared `enqueue` policy MEANS — stated as what the
 * planner does, never as what the arm's name suggests (D251).
 *
 * `services/start/plan.ts` runs its active-run check under exactly one arm.
 * `allow-parallel` therefore runs no check at all, which the text says; and
 * **`supersede-active` supersedes nothing** — no planner path implements it and
 * no registered descriptor declares it. Writing "supersedes the running one"
 * here would put a claim on screen that the server does not honour, which is
 * the same defect as offering the policy as an operator choice.
 */
export const ENQUEUE_POLICY_MEANING: Readonly<Record<EnqueuePolicy, string>> = Object.freeze({
  "reject-active": "Refuse overlapping subject runs",
  "supersede-active": "Replace the active runs shown in the final review",
  "allow-parallel": "Starts regardless of what is already running for the same subject",
});

/**
 * Why the policy is not a control. The demo offers a `Select`; this tree reads
 * `descriptor.enqueue` in the planner and accepts no per-start override, so a
 * select would let an operator choose an answer the server would ignore.
 */
export const ENQUEUE_POLICY_REASON = "Fixed by this workflow.";

/** the two queue priorities `StartPlanIngress` accepts */
export type StartPriority = "interactive" | "bulk";
export type BrowserMode = "headless" | "headed";

// ---------------------------------------------------------------------------
// D296 — the two ways work enters this queue, inside the dialog that starts it
// ---------------------------------------------------------------------------

/**
 * HOW the operator is starting this run.
 *
 * The demo's `LauncherStartMethodKind` has four arms (`typed`, `upload`,
 * `spreadsheet`, `bare`); this tree serves two, and serves them from
 * DECLARATIONS rather than from a fixture: `typed` exists when the descriptor
 * declares `surfaces.inputRun`, and `spreadsheet` exists when the module
 * declares an intake projection. `upload` and `bare` are deliberately absent
 * for the reason `WorkflowStartWireSchema` gives about `uploadRun` — no
 * registered workflow produces one, and an arm nothing can produce is the
 * D181/`degraded` shape.
 */
export type StartMethod = "typed" | "spreadsheet";

export const START_METHOD_LABEL: Readonly<Record<StartMethod, string>> = Object.freeze({
  typed: "Type values",
  spreadsheet: "Import a spreadsheet",
});

/*
 * D298 — the spreadsheet arm IS the dropzone, and it has no primary.
 *
 * D296 shipped this arm as an explanatory panel over an `Open the intake…`
 * primary, on the reading that a file picker here would be "a door into the
 * middle of the workspace, past the mapping". That reading was wrong about its
 * own workspace: the workspace's FIRST screen is that same dropzone
 * (`intake.tsx`'s `resource.state === "empty"` arm), and dropping a file there
 * skips no mapping — it opens the session and lands on the mapping grid. So
 * what D296 actually drew was a paragraph describing a zone, above a button
 * whose only job was to reach that zone one screen later.
 *
 * The panel is now the zone itself, drawn from the workspace's own
 * `INTAKE_ACCEPT` / `INTAKE_DROPZONE_HINT` / `intakeDropzoneLabel` so the two
 * doors cannot describe different caps. The upload IS the press: the dialog
 * closes on `?intake=<sessionId>` with the file already read. Nothing here
 * maps, validates or enqueues — those stay in the workspace, because the
 * session is durable and a modal would trap a task that takes minutes
 * (D170/D173).
 *
 * There is consequently NO `SPREADSHEET_HANDOFF_TITLE`/`_BODY` any more, and
 * no handoff primary; the arm's footer carries `Cancel` alone. The hint the
 * zone already prints — "Nothing runs until you map its columns and review what
 * it rejects" — says what the deleted paragraph said, on the control it is
 * about.
 */

/**
 * Why a workflow shows no spreadsheet method.
 *
 * Stated as the MODULE's own missing declaration, in the same words
 * `command-kernel.ts` refuses an intake commit with, so the dialog never spells
 * a refusal the server would not make.
 */
export const SPREADSHEET_METHOD_ABSENCE =
  "This workflow declares no intake projection, so it is not spreadsheet-capable.";

// ---------------------------------------------------------------------------
// C109 — a plan, and the result behind it, outlive nothing that shaped them
// ---------------------------------------------------------------------------

/**
 * Everything the operator can change that changes what `POST /start-plans`
 * would answer. The demo cleared its result from inside every control's own
 * `onChange` (`DemoRunStart.tsx:882,893`); this tree derives the same thing
 * from ONE identity instead, because a control added tomorrow that forgets the
 * line leaves a settled result standing over a request that no longer exists —
 * exactly the shape the queue's `bulkPlans` bug had (`src/dashboard/CLAUDE.md`,
 * 2026-08-26).
 *
 * D272 item 8 (`ref dashboard-surfaces` §10, ledger 1 row C109).
 */
export interface StartRequestShape {
  workflowId: string;
  text: string;
  dryRun: boolean;
  browserMode: BrowserMode;
  captureBrowserScreenshots: boolean;
  priority: StartPriority;
  selectedStepKeys: readonly string[];
  /**
   * D307 — the operator's omission DRAFTS, in timeline order, exactly as typed.
   *
   * The raw draft is the identity rather than the parsed facts because a plan
   * has to stop describing the request the moment the request moves, and a
   * half-typed date is a moved request: parsed facts would leave a settled plan
   * standing over `06/3` on its way to `06/30/2026`, which is the very state
   * C109 exists to make unrepresentable.
   */
  stepOmissionDrafts: readonly Readonly<{ step: string; draft: StepOmissionDraft }>[];
}

/**
 * The identity of the request a plan was made for. Two requests share a
 * fingerprint exactly when the server would be asked the same question.
 */
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

// ---------------------------------------------------------------------------
// C83 / C84 — the run-control rail is numbered by what it DRAWS
// ---------------------------------------------------------------------------

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

/**
 * The run-control groups this workflow actually draws, numbered in reading
 * order (C83/C84, D272 item 9).
 *
 * D293 removes Destination from this dashboard form: the planner resolves
 * every declared browser system to production when the request carries no
 * override. A workflow that declares no dry run draws NO Safety group:
 * `DESIGN.md:305`'s
 * rule for a declaration-driven control is "a workflow that declares none shows
 * none: no empty scaffolding", and its offer-disabled rule is written for an
 * OPTION inside a control, not for the group around it. The numbers then have
 * to close up — a frozen `03` beside a two-group rail leaves a gap in the
 * reading path the numbers exist to give.
 */
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

// ---------------------------------------------------------------------------
// D307 — the Steps screen's omission half, as folds
// ---------------------------------------------------------------------------

/**
 * One control's raw draft.
 *
 * Every kind but `boolean` is typed into a text control, so its draft is the
 * string the operator has actually typed — never a value coerced early. A
 * checkbox has no "not yet answered" state, so `boolean` is the one kind whose
 * draft IS its value: `false` is the operator's own unchecked answer, not a
 * default substituted for something missing.
 */
export type StepOmissionFactDraft = string | boolean;

/** one omitted step's whole form, keyed by field key */
export type StepOmissionDraft = Readonly<Record<string, StepOmissionFactDraft>>;

/**
 * The draft a form starts on: EMPTY for every typed kind.
 *
 * A seeded date, id, number, enum choice or list would be a fabricated fact
 * about a real person the moment the operator did not touch it — the exact
 * substitution this tree bans. The only seeded value is a checkbox's `false`,
 * which is an answer rather than an absence.
 */
export function initialStepOmissionDraft(form: StepOmissionForm): StepOmissionDraft {
  const draft: Record<string, StepOmissionFactDraft> = {};
  for (const field of form.fields) draft[field.key] = field.kind === "boolean" ? false : "";
  return Object.freeze(draft);
}

/**
 * A control's draft, read as the JSON shape the field's kind declares — or the
 * reason it cannot be read as one yet.
 *
 * This step is only the SHAPE. Whether `06/31/2026` is a date, whether an id is
 * eight digits, whether an integer clears its declared `min` and whether an
 * enum value is one of the declared ones are all decided by
 * `stepOmissionFactsSchema`, the same schema the plan service and the run
 * envelope parse with — so the screen cannot accept a fact the server refuses,
 * or refuse one it accepts.
 */
export type StepOmissionFieldRead =
  | Readonly<{ state: "value"; value: StepOmissionFactValue }>
  | Readonly<{ state: "unreadable"; message: string }>;

/**
 * What a fact IS before it reaches the wire — exactly the four shapes the seven
 * declared kinds produce. The shared `StartPlanRequestSchema` admits any
 * `JsonValue` fact (the descriptor's forms prove content server-side); the
 * narrowing lives HERE and in `asFactValue`, on purpose: an open value at this
 * seam is a value the form would submit without saying so.
 */
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

/**
 * One omitted step's facts, or the per-field reasons they are not facts yet.
 *
 * `invalid` carries a message per FIELD KEY so the row can draw the refusal on
 * the control it is about. The messages come from the declared schema wherever
 * the schema has one; nothing here restates a regex the domain already owns.
 */
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
      // A key already refused for its SHAPE keeps that message: it is the one
      // the operator can act on, and the schema's follow-on "required" for the
      // same key would replace it with a vaguer sentence.
      if (key === undefined || errors[key] !== undefined) continue;
      errors[key] = issue.message;
    }
  }
  if (Object.keys(errors).length > 0) return { state: "invalid", errors: Object.freeze(errors) };
  if (!parsed.success) {
    // Unreachable by construction — a strict object over the declared fields
    // can only fail at one of them. Saying so beats returning facts the schema
    // refused.
    throw new Error("a step omission form refused without naming a field");
  }
  // `parsed.data` — never `candidate` — because the declared schemas TRANSFORM
  // (a `text` fact is trimmed), and what the operator confirms and the server
  // receives has to be the same bytes.
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

/**
 * step key → the omitted steps currently forcing it out.
 *
 * A forced row is UNCHECKED and LOCKED while its forcing step is unchecked,
 * because the planner refuses the pair otherwise — the screen must lock exactly
 * what the plan would refuse, and `forces` is the descriptor's own fixpoint of
 * that rule.
 */
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

/**
 * One checkbox press, folded — and the ONE place the cascade is applied.
 *
 * Unchecking an omittable step takes its `forces` out with it; re-checking it
 * puts back only those its own choice was holding out. A `required` step, and a
 * step another omitted step is still forcing, do not move at all. The result is
 * always in TIMELINE order, which is the order `stepOmissions` and
 * `selectedStepKeys` both ride the wire in.
 */
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
  // The cascade, applied to the NEW selection, is the only rule that removes a
  // step: it takes out everything any omitted step forces — the one this press
  // omitted included — and it keeps out a step another omission still holds.
  // Deleting `forces` in the branch above as well would be a line no test could
  // make fail.
  const stillForced = forcedStepOmissions(steps, [...selected]);
  for (const forced of stillForced.keys()) selected.delete(forced);
  return Object.freeze(steps.filter((candidate) => selected.has(candidate.key)).map((candidate) => candidate.key));
}
