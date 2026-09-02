/**
 * Step omission (D307) — the operator omits a timeline step at start and types
 * the facts the rest of the run would have read from it.
 *
 * Three closed things live here, and nothing that executes:
 *
 * 1. The **form** a step folder declares: a closed field vocabulary the Steps
 *    screen can draw and one strict facts schema derived from it, so the wire,
 *    the plan and the run envelope all parse the SAME object.
 * 2. The **envelope entry** — `{ step, facts }` — that rides the run like
 *    `dryRun` does (never the canonical input: an omission changes which
 *    nodes execute, not what the item is).
 * 3. The **plan** — given a graph's nodes and its timeline, which nodes are
 *    `asserted` (a task the step's producers rebuild from the typed facts),
 *    which are `omitted` (a transaction in an omitted step, or a task the step
 *    cannot honestly rebuild), and which executing node would read an omitted
 *    one and therefore refuses BY NAME before anything starts.
 *
 * An omission never removes a gate node. A conditional gate still evaluates
 * its own descriptor evidence; omission is not another way to suppress it.
 * Transactions in an omitted step never run and mint no envelope:
 * the write sequencer's row is the only thing that may say a write happened
 * (D144), so a typed transaction number is a typed FACT a fold consumes, not
 * a substitute outcome.
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../canonical-json.js";
import { JsonValueSchema } from "../canonical-json.js";
import type { IsoInstant } from "../ids.js";
import type { RuntimeScope } from "./graph.js";
import { TimelineCategoryKeySchema } from "./presentation.js";

const FieldKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/u, "an omission field key is a camelCase identifier");

const FieldBase = {
  key: FieldKeySchema,
  label: z.string().min(1),
  help: z.string().min(1).optional(),
};

/** The closed field vocabulary the Steps screen draws; each kind owns its parser. */
export const StepOmissionFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...FieldBase, kind: z.literal("text") }),
  /** MM/DD/YYYY — the form every HR date in this tree is typed and staged in. */
  z.strictObject({ ...FieldBase, kind: z.literal("us-date") }),
  /** A UCPath employee id: eight digits, exactly. */
  z.strictObject({ ...FieldBase, kind: z.literal("eid") }),
  z.strictObject({ ...FieldBase, kind: z.literal("integer"), min: z.number().int().optional() }),
  z.strictObject({ ...FieldBase, kind: z.literal("boolean") }),
  z.strictObject({ ...FieldBase, kind: z.literal("enum"), values: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ ...FieldBase, kind: z.literal("text-list") }),
]);
export type StepOmissionField = z.infer<typeof StepOmissionFieldSchema>;

export const StepOmissionFormSchema = z.strictObject({
  fields: z.array(StepOmissionFieldSchema).superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field.key)) ctx.addIssue({ code: "custom", message: `omission field "${field.key}" is declared twice` });
      seen.add(field.key);
    }
  }),
});
export type StepOmissionForm = z.infer<typeof StepOmissionFormSchema>;

export const UsDateFactSchema = z.string().regex(
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/u,
  "a date fact must be MM/DD/YYYY",
);
export const EidFactSchema = z.string().regex(/^\d{8}$/u, "an employee id fact must be exactly eight digits");

function fieldSchema(field: StepOmissionField): z.ZodType {
  switch (field.kind) {
    case "text": return z.string().trim().min(1);
    case "us-date": return UsDateFactSchema;
    case "eid": return EidFactSchema;
    case "integer": return field.min === undefined ? z.number().int() : z.number().int().min(field.min);
    case "boolean": return z.boolean();
    case "enum": return z.string().refine((value) => field.values.includes(value), { message: `expected one of: ${field.values.join(", ")}` });
    case "text-list": return z.array(z.string().trim().min(1));
  }
}

/** ONE strict facts schema per form — every field is required; absence is a refusal, not a default. */
export function stepOmissionFactsSchema(form: StepOmissionForm): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of StepOmissionFormSchema.parse(form).fields) shape[field.key] = fieldSchema(field);
  return z.strictObject(shape);
}

/** What a per-node producer sees: the parsed facts, the node's own dependency scope, and the instant of assertion. */
export interface StepOmissionProduceContext {
  readonly facts: JsonObject;
  readonly scope: RuntimeScope;
  readonly assertedAt: IsoInstant;
}

/**
 * A step folder's declaration. `produces` is keyed by the TASK node ids the
 * step can honestly rebuild; every other node of the step is `omitted` when
 * the step is. A producer returns a COMPLETE output the executor parses with
 * the node's own contract output schema — never a partial object, never a
 * placeholder for a page fact nobody observed.
 */
export interface StepOmissionDeclaration {
  readonly form: StepOmissionForm;
  readonly produces: Readonly<Record<string, (context: StepOmissionProduceContext) => unknown>>;
}

/** The descriptor-retained form of one declaration, bound to its step key. */
export interface StepOmissionSpec extends StepOmissionDeclaration {
  readonly step: string;
}

const JsonFactsSchema = z.record(z.string(), JsonValueSchema);

export const StepOmissionEntrySchema = z.strictObject({
  step: TimelineCategoryKeySchema,
  facts: JsonFactsSchema,
});
export type StepOmissionEntry = z.infer<typeof StepOmissionEntrySchema>;

const uniqueSteps = (entries: readonly StepOmissionEntry[], ctx: z.RefinementCtx): void => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.step)) ctx.addIssue({ code: "custom", message: `step "${entry.step}" is omitted twice` });
    seen.add(entry.step);
  }
};

/** The envelope field: ordered, one entry per step, so fingerprints are stable; absent, never empty. */
export const StepOmissionsSchema = z.array(StepOmissionEntrySchema).min(1).superRefine(uniqueSteps);
/** The planner's input: the same entries, where "none" is a legitimate empty list. */
const RequestedOmissionsSchema = z.array(StepOmissionEntrySchema).superRefine(uniqueSteps);
export type StepOmissions = z.infer<typeof StepOmissionsSchema>;

export const StepOmissionNotRunReasonSchema = z.enum(["operator-asserted", "step-omitted"]);

/**
 * The arm a workflow RESULT carries where an omitted write step's proof would
 * be: no disposition is invented, the step is named. Owned here so a descriptor
 * and any authority that mirrors its result schema parse the same bytes.
 */
export const OmittedStepResultArmSchema = z.strictObject({
  state: z.literal("omitted"),
  step: TimelineCategoryKeySchema,
});
export type OmittedStepResultArm = z.infer<typeof OmittedStepResultArmSchema>;

/** The graph facts the planner needs — a projection any descriptor can supply without importing the base layer. */
export interface StepOmissionGraphView {
  readonly nodes: readonly Readonly<{ id: string; kind: string; dependsOn: readonly string[] }>[];
  readonly timeline: readonly Readonly<{ key: string; nodes: readonly Readonly<{ id: string }>[] }>[];
  readonly stepOmissions: readonly StepOmissionSpec[];
}

export interface StepOmissionRefusal {
  readonly code: "unknown-step" | "step-not-omittable" | "facts-invalid" | "dependency-omitted";
  readonly step: string;
  readonly message: string;
}

export interface StepOmissionPlan {
  /** node id → the omitted step whose producer rebuilds it */
  readonly asserted: ReadonlyMap<string, Readonly<{ step: string; facts: JsonObject; produce: (context: StepOmissionProduceContext) => unknown }>>;
  /** node id → the omitted step it belongs to; nothing runs and nothing is produced */
  readonly omitted: ReadonlyMap<string, string>;
  readonly refusals: readonly StepOmissionRefusal[];
}

/**
 * Classify every node for one run's omissions. Pure and total: a refusal is a
 * value, and a plan with refusals must not start.
 */
export function planStepOmissions(graph: StepOmissionGraphView, requested: readonly StepOmissionEntry[]): StepOmissionPlan {
  const asserted = new Map<string, { step: string; facts: JsonObject; produce: (context: StepOmissionProduceContext) => unknown }>();
  const omitted = new Map<string, string>();
  const refusals: StepOmissionRefusal[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const stepByNode = new Map<string, string>();
  for (const category of graph.timeline) for (const { id } of category.nodes) stepByNode.set(id, category.key);
  const specByStep = new Map(graph.stepOmissions.map((spec) => [spec.step, spec]));

  for (const entry of RequestedOmissionsSchema.parse(requested)) {
    const category = graph.timeline.find(({ key }) => key === entry.step);
    if (category === undefined) {
      refusals.push({ code: "unknown-step", step: entry.step, message: `step "${entry.step}" is not on this workflow's timeline` });
      continue;
    }
    const spec = specByStep.get(entry.step);
    if (spec === undefined) {
      refusals.push({ code: "step-not-omittable", step: entry.step, message: `step "${entry.step}" declares no omission; it must run` });
      continue;
    }
    const facts = stepOmissionFactsSchema(spec.form).safeParse(entry.facts);
    if (!facts.success) {
      const fields = facts.error.issues.map((issue) => issue.path.map(String).join(".") || "(form)");
      refusals.push({
        code: "facts-invalid", step: entry.step,
        message: `step "${entry.step}" omission facts are invalid at: ${[...new Set(fields)].join(", ")}`,
      });
      continue;
    }
    for (const { id } of category.nodes) {
      const node = nodeById.get(id);
      if (node === undefined) throw new Error(`timeline step "${entry.step}" names node "${id}", which the graph does not declare`);
      if (node.kind === "gate") continue;
      const produce = node.kind === "task" ? spec.produces[id] : undefined;
      if (produce === undefined) omitted.set(id, entry.step);
      else asserted.set(id, { step: entry.step, facts: JsonFactsSchema.parse(facts.data), produce });
    }
    for (const producedId of Object.keys(spec.produces)) {
      const owner = stepByNode.get(producedId);
      if (owner !== entry.step) {
        throw new Error(`step "${entry.step}" omission produces node "${producedId}", which belongs to step "${owner ?? "(none)"}"`);
      }
      if (nodeById.get(producedId)?.kind !== "task") {
        throw new Error(`step "${entry.step}" omission produces node "${producedId}", which is not a task node; gates and transactions are never substituted`);
      }
    }
  }

  for (const node of graph.nodes) {
    if (asserted.has(node.id) || omitted.has(node.id)) continue;
    for (const dependency of node.dependsOn) {
      const blockedBy = omitted.get(dependency);
      if (blockedBy === undefined) continue;
      const ownStep = stepByNode.get(node.id);
      if (ownStep === undefined) throw new Error(`node "${node.id}" is on no timeline step; a declared timeline is exhaustive (D225)`);
      refusals.push({
        code: "dependency-omitted", step: ownStep,
        message: `node "${node.id}" (step "${ownStep}") reads "${dependency}", which omitting step "${blockedBy}" leaves unread; `
          + `omit step "${ownStep}" too, or include step "${blockedBy}"`,
      });
    }
  }
  return Object.freeze({ asserted, omitted, refusals: Object.freeze(refusals) });
}

/** One step's cascade row: the other steps forced out with it, or the step that cannot be omitted and so blocks it. */
export type StepOmissionCascadeRow =
  | Readonly<{ state: "omittable"; forces: readonly string[] }>
  | Readonly<{ state: "blocked"; by: string; forces: readonly string[] }>;

/**
 * One schema-valid value per field kind — the SHAPE of a step's facts without
 * claiming anything about a real run. `stepOmissionCascade` plans with these to
 * answer "could this step be omitted at all", and the D307 architecture guard
 * imports the same function so its sweep drives `planStepOmissions` with
 * EXACTLY the cascade's own values rather than a hand-copied second generator
 * that could drift out of agreement with this one.
 *
 * These values are never an operator's facts and never reach a run: the planner
 * re-parses whatever the envelope actually carries through
 * `stepOmissionFactsSchema`, so a placeholder can only ever answer a
 * hypothetical question this module asks itself.
 */
export function stepOmissionPlaceholderFacts(form: StepOmissionForm): JsonObject {
  const placeholder = (field: StepOmissionField): JsonValue => {
    switch (field.kind) {
      case "boolean": return false;
      case "integer": return field.min ?? 0;
      case "text-list": return [];
      case "enum": return field.values[0] ?? "";
      case "us-date": return "01/01/2000";
      case "eid": return "00000000";
      case "text": return "cascade";
    }
  };
  return JsonFactsSchema.parse(Object.fromEntries(
    StepOmissionFormSchema.parse(form).fields.map((field) => [field.key, placeholder(field)]),
  ));
}

/**
 * The Steps screen's cascade: for each omittable step, the OTHER steps that
 * would have to be omitted with it — computed to a fixpoint over the same rule
 * the planner enforces, so the screen locks exactly what the plan would refuse.
 * A forced step that declares no omission blocks the whole choice.
 */
export function stepOmissionCascade(graph: StepOmissionGraphView): ReadonlyMap<string, StepOmissionCascadeRow> {
  const result = new Map<string, StepOmissionCascadeRow>();
  const specByStep = new Map(graph.stepOmissions.map((spec) => [spec.step, spec]));
  for (const spec of graph.stepOmissions) {
    const omittedSteps = new Set<string>([spec.step]);
    let blockedBy: string | undefined;
    for (;;) {
      const plan = planStepOmissions(graph, [...omittedSteps].map((step) => {
        const own = specByStep.get(step);
        if (own === undefined) throw new Error(`cascade reached step "${step}", which declares no omission`);
        return { step, facts: stepOmissionPlaceholderFacts(own.form) };
      }));
      const other = plan.refusals.find((refusal) => refusal.code !== "dependency-omitted");
      if (other !== undefined) throw new Error(`cascade for step "${spec.step}" hit ${other.code}: ${other.message}`);
      // A refusal inside a step already in the omitted set cannot be cured by
      // omitting more: a gate of that step reads a node the omission leaves
      // unread. The choice is blocked by that very step.
      const selfBlocked = plan.refusals.find((refusal) => omittedSteps.has(refusal.step));
      if (selfBlocked !== undefined) { blockedBy = selfBlocked.step; break; }
      const forced = plan.refusals.map((refusal) => refusal.step);
      const unomittable = forced.find((step) => !specByStep.has(step));
      if (unomittable !== undefined) { blockedBy = unomittable; break; }
      if (forced.length === 0) break;
      for (const step of forced) omittedSteps.add(step);
    }
    omittedSteps.delete(spec.step);
    const forces = Object.freeze([...omittedSteps]);
    result.set(spec.step, blockedBy === undefined ? { state: "omittable", forces } : { state: "blocked", by: blockedBy, forces });
  }
  return result;
}
