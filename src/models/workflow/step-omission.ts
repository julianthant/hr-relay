/** Manual entry: the operator types the values a step's reading would yield; produced nodes are rebuilt from them, skipped nodes do not run, and every other node of the step still runs. */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../../rules/validation/canonical-json.js";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { EID_PATTERN, type IsoInstant } from "../../rules/identity/ids.js";
import { CRM_MANUAL_RECORDS_EXAMPLE, crmManualRecordsIssue } from "../workflows/crm-doc-download/manual-records.js";
import type { RuntimeScope } from "./graph.js";
import { TimelineCategoryKeySchema } from "./presentation.js";
import { ValueFieldPathSchema } from "./rerun-values.js";

const FieldKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/u, "an omission field key is a camelCase identifier");

const FieldBase = {
  key: FieldKeySchema,
  label: z.string().min(1),
  help: z.string().min(1).optional(),
  /** Blank is stored as null. */
  optional: z.literal(true).optional(),
  requiredWhen: z.strictObject({ field: FieldKeySchema, equals: z.string().min(1) }).optional(),
  withheld: z.literal(true).optional(),
  /** The produced value this field stands for; its accepted facts parse unchanged under that leaf's schema. */
  replaces: z.strictObject({ nodeId: z.string().min(1), path: ValueFieldPathSchema }).optional(),
};

/** The closed field vocabulary the Steps screen draws; each kind owns its parser. */
export const StepOmissionFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...FieldBase, kind: z.literal("text"), format: z.literal("crm-document-records").optional() }),
  /** MM/DD/YYYY — the form every HR date in this tree is typed and staged in. */
  z.strictObject({ ...FieldBase, kind: z.literal("us-date") }),
  /** Shown and typed as MM/DD/YYYY; the server accepts and stores YYYY-MM-DD only. */
  z.strictObject({ ...FieldBase, kind: z.literal("iso-date") }),
  /** A UCPath employee id: eight digits beginning with 10. */
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
      const condition = field.requiredWhen;
      if (condition === undefined) continue;
      const choice = fields.find(candidate => candidate.key === condition.field);
      if (field.optional !== true || choice?.kind !== "enum" || choice.key === field.key || !choice.values.includes(condition.equals)) {
        ctx.addIssue({ code: "custom", message: `omission field "${field.key}" needs an optional field and an existing choice in another field` });
      }
    }
  }),
});
export type StepOmissionForm = z.infer<typeof StepOmissionFormSchema>;

const US_DATE_PATTERN = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/u;
export const UsDateFactSchema = z.string().regex(US_DATE_PATTERN, "a date fact must be MM/DD/YYYY");
export const IsoDateFactSchema = z.iso.date();
export const EidFactSchema = z.string().regex(EID_PATTERN, "an employee id fact must be eight digits beginning with 10");

export type StepOmissionInput = Readonly<{ submissions: readonly unknown[] }> | Readonly<{ canonicalInput: unknown }>;

function fieldSchema(field: StepOmissionField, input?: StepOmissionInput): z.ZodType<JsonValue> {
  switch (field.kind) {
    case "text": {
      const text = z.string().trim().min(1);
      return field.format === undefined ? text : text.superRefine((value, context) => {
        const message = crmManualRecordsIssue(value, input);
        if (message !== undefined) context.addIssue({ code: "custom", message });
      });
    }
    case "us-date": return UsDateFactSchema;
    case "iso-date": return IsoDateFactSchema;
    case "eid": return EidFactSchema;
    case "integer": return field.min === undefined ? z.number().int() : z.number().int().min(field.min);
    case "boolean": return z.boolean();
    case "enum": return z.string().refine((value) => field.values.includes(value), { message: `expected one of: ${field.values.join(", ")}` });
    case "text-list": return z.array(z.string().trim().min(1));
  }
}

/** The schema of one field's stored fact; an optional field also accepts null. */
export function stepOmissionFieldFactSchema(field: StepOmissionField, input?: StepOmissionInput): z.ZodType<JsonValue> {
  const schema = fieldSchema(field, input);
  return field.optional === true ? schema.nullable() : schema;
}

/** ONE strict facts schema per form — every key is present; absence is a refusal, not a default. */
export function stepOmissionFactsSchema(form: StepOmissionForm, input?: StepOmissionInput): z.ZodObject<Record<string, z.ZodType<JsonValue>>> {
  const { fields } = StepOmissionFormSchema.parse(form);
  const shape: Record<string, z.ZodType<JsonValue>> = {};
  for (const field of fields) shape[field.key] = stepOmissionFieldFactSchema(field, input);
  return z.strictObject(shape).superRefine((facts, ctx) => {
    for (const field of fields) {
      const condition = field.requiredWhen;
      if (condition !== undefined && facts[condition.field] === condition.equals && facts[field.key] === null) {
        ctx.addIssue({ code: "custom", path: [field.key], message: "Enter a value for the selected choice." });
      }
    }
  });
}

/** The finite set a field accepts, when it has one; the representation check parses each value. */
export function stepManualFiniteFacts(field: StepOmissionField): readonly JsonValue[] | undefined {
  if (field.kind === "boolean") return [true, false];
  if (field.kind === "enum") return field.values;
  return undefined;
}

type TextFacts = Readonly<{ min: number; max?: number; pattern?: RegExp; format?: "date" }>;

function textFacts(field: StepOmissionField): TextFacts | undefined {
  switch (field.kind) {
    case "text": return { min: 1 };
    case "us-date": return { min: 10, max: 10, pattern: US_DATE_PATTERN };
    case "iso-date": return { min: 10, max: 10, format: "date" };
    case "eid": return { min: 8, max: 8, pattern: EID_PATTERN };
    default: return undefined;
  }
}

function impliedStringFormat(facts: TextFacts, format: string, pattern: RegExp | undefined): boolean {
  if (format === "regex") return pattern !== undefined && facts.pattern !== undefined
    && pattern.source === facts.pattern.source && pattern.flags === facts.pattern.flags;
  return format === facts.format;
}

function impliedStringCheck(facts: TextFacts, check: z.core.$ZodCheckDef): boolean {
  switch (check.check) {
    case "min_length": return (check as z.core.$ZodCheckMinLengthDef).minimum <= facts.min;
    case "max_length": return facts.max !== undefined && (check as z.core.$ZodCheckMaxLengthDef).maximum >= facts.max;
    case "length_equals": return facts.max === facts.min && (check as z.core.$ZodCheckLengthEqualsDef).length === facts.min;
    case "string_format": {
      const format = check as z.core.$ZodCheckStringFormatDef;
      return impliedStringFormat(facts, format.format, format.pattern);
    }
    default: return false;
  }
}

function stringLeafTakes(facts: TextFacts, leaf: z.core.$ZodString): boolean {
  const def: z.core.$ZodStringDef & Partial<z.core.$ZodCheckStringFormatDef> = leaf._zod.def;
  if (def.check === "string_format" && def.format !== undefined && !impliedStringFormat(facts, def.format, def.pattern)) return false;
  return (def.checks ?? []).every((check) => impliedStringCheck(facts, check._zod.def));
}

function integerLeafTakes(min: number | undefined, leaf: z.core.$ZodNumber): boolean {
  const def: z.core.$ZodNumberDef & Partial<z.core.$ZodCheckNumberFormatDef> = leaf._zod.def;
  if (def.check === "number_format" && def.format !== "safeint") return false;
  return (def.checks ?? []).every(({ _zod: { def: check } }) => {
    if (check.check === "number_format") return (check as z.core.$ZodCheckNumberFormatDef).format === "safeint";
    if (check.check !== "greater_than") return false;
    const bound = check as z.core.$ZodCheckGreaterThanDef;
    return min !== undefined && typeof bound.value === "number" && (bound.inclusive ? min >= bound.value : min > bound.value);
  });
}

/**
 * True when the leaf provably takes every non-null fact an infinite-kind field accepts, unchanged: a plain
 * string, number or array whose every check the field's own constraints imply, under check-free wrappers or as a
 * check-free inclusive union's first option. Anything not established (a transform, a refinement, a catch, a narrower
 * bound, another format, an exclusive union, or a union that only a later option could satisfy) is refused.
 */
export function stepManualFieldFitsLeaf(field: StepOmissionField, leaf: z.core.$ZodType): boolean {
  const own = leaf instanceof z.core.$ZodString || leaf instanceof z.core.$ZodNumber || leaf instanceof z.core.$ZodArray;
  if (!own && (leaf._zod.def.checks ?? []).length > 0) return false;
  if (leaf instanceof z.core.$ZodOptional || leaf instanceof z.core.$ZodNullable || leaf instanceof z.core.$ZodReadonly
    || leaf instanceof z.core.$ZodNonOptional || leaf instanceof z.core.$ZodDefault) {
    return stepManualFieldFitsLeaf(field, leaf._zod.def.innerType);
  }
  // In an inclusive union the first option that parses wins, so only a first option that takes every fact proves
  // it; an exclusive union (xor) refuses a fact two options take, which a first option cannot rule out.
  if (leaf instanceof z.core.$ZodUnion) {
    if (leaf._zod.def.inclusive === false) return false;
    const [first] = leaf._zod.def.options;
    return first !== undefined && stepManualFieldFitsLeaf(field, first);
  }
  if (leaf instanceof z.core.$ZodUnknown || leaf instanceof z.core.$ZodAny) return true;
  if (field.kind === "integer") return leaf instanceof z.core.$ZodNumber && integerLeafTakes(field.min, leaf);
  if (field.kind === "text-list") {
    return leaf instanceof z.core.$ZodArray
      && (leaf._zod.def.checks ?? []).every(({ _zod: { def: check } }) => check.check === "min_length" && (check as z.core.$ZodCheckMinLengthDef).minimum === 0)
      && stepManualFieldFitsLeaf({ key: field.key, label: field.label, kind: "text" }, leaf._zod.def.element);
  }
  const facts = textFacts(field);
  return facts !== undefined && leaf instanceof z.core.$ZodString && stringLeafTakes(facts, leaf);
}

/** What a per-node producer sees: the parsed facts, the node's own dependency scope, and the instant of assertion. */
export interface StepOmissionProduceContext {
  readonly facts: JsonObject;
  readonly scope: RuntimeScope;
  readonly assertedAt: IsoInstant;
}

export interface StepManualIssue {
  readonly field: string;
  readonly message: string;
}

/** A step folder's declaration; a producer returns a COMPLETE output the executor parses with the node's own contract output schema — never a partial object or a placeholder. */
export interface StepManualDeclaration {
  readonly off?: StartRowOff;
  /** The child offers this switch only on its own Start rows. */
  readonly ownStartOnly?: true;
  readonly form: StepOmissionForm;
  readonly produces: Readonly<Record<string, (context: StepOmissionProduceContext) => unknown>>;
  /** Reading nodes that do not run when the values are typed; every node neither produced nor skipped runs. */
  readonly skips?: readonly string[];
  /** Cross-field rules checked by the server at plan time, after the form parses. */
  readonly refine?: (facts: JsonObject, submission: JsonValue | undefined) => readonly StepManualIssue[];
  /** Binds typed facts into the admitted input before any reader or child receives it. */
  readonly bindInput?: (input: JsonValue, facts: JsonObject) => JsonValue;
  /** The admitted input contains private reading values, including when bound by a parent. */
  readonly withholdsBoundInput?: (input: JsonValue) => boolean;
  /** Own facts describe the parent document, not one shared assertion applied to its child members. */
  readonly allowsChildFanOut?: true;
  /** Allows `skips` to name the step's gates and transactions: the typed values stand for their decision or write. */
  readonly skipsGatesAndTransactions?: true;
  /** Nodes in other steps that depend on a skipped member only to run after it and read none of its output. */
  readonly orderOnlyReaders?: readonly string[];
  /** Other steps that require this step to run even though they bind no output from it. */
  readonly alsoSkips?: readonly string[];
  /** Ingress checks, operator gates, local validation and input-backed readers that still run with supplied values. */
  readonly keeps?: readonly string[];
}

/** The descriptor-retained form of one declaration, bound to its step key. */
export interface StepOmissionSpec extends StepManualDeclaration {
  readonly step: string;
}

/** A reading lock the definition declares; `form-action` and `approval` are derived from the step's nodes. */
export const StepLockReasonSchema = z.enum(["bound-read", "guard-read"]);
export type StepLockReason = z.infer<typeof StepLockReasonSchema>;
export const StartRowLockReasonSchema = z.enum(["form-action", "approval", "bound-read", "guard-read"]);
export type StartRowLockReason = z.infer<typeof StartRowLockReasonSchema>;
export const StartRowKindSchema = z.enum(["switch", "locked-manual", "locked"]);
export type StartRowKind = z.infer<typeof StartRowKindSchema>;
export const StartRowOffSchema = z.enum(["manual", "values"]);
export type StartRowOff = z.infer<typeof StartRowOffSchema>;

/** What a row shows: a whole step, some of its nodes, or one phase of its transaction nodes. */
export const StartRowMemberSchema = z.strictObject({
  workflow: z.string().min(1).optional(),
  step: TimelineCategoryKeySchema,
  nodes: z.array(z.string().min(1)).min(1).optional(),
  phase: z.enum(["prepare", "commit"]).optional(),
});
export type StartRowMember = z.infer<typeof StartRowMemberSchema>;
/** The whole step a row's switch and typed values address. */
export const StartRowTargetSchema = z.strictObject({
  workflow: z.string().min(1).optional(),
  step: TimelineCategoryKeySchema,
});
export type StartRowTarget = z.infer<typeof StartRowTargetSchema>;
/** One Start run row a workflow declares; absent rows = one row per timeline step. */
export const StartRowDeclarationSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
  members: z.array(StartRowMemberSchema).min(1),
  target: StartRowTargetSchema.optional(),
});
export type StartRowDeclaration = z.infer<typeof StartRowDeclarationSchema>;

const JsonFactsSchema = z.record(z.string(), JsonValueSchema);

export const StepOmissionEntrySchema = z.strictObject({
  /** A step of this delegated child workflow; absent = the served workflow's own step. */
  workflow: z.string().min(1).optional(),
  step: TimelineCategoryKeySchema,
  facts: JsonFactsSchema,
  /** Each field's label as shown when typed. */
  labels: z.record(z.string(), z.string().min(1)).optional(),
});
export type StepOmissionEntry = z.infer<typeof StepOmissionEntrySchema>;

const uniqueSteps = (entries: readonly StepOmissionEntry[], ctx: z.RefinementCtx): void => {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.workflow ?? null, entry.step]);
    if (seen.has(key)) ctx.addIssue({ code: "custom", message: `step "${entry.step}" is omitted twice` });
    seen.add(key);
  }
};

/** The run omitted the step that skips `dependency`, and the workflow declares `reader` waits on it only for order. */
export function orderOnlyOmission(specs: readonly StepOmissionSpec[], omitted: readonly StepOmissionEntry[] | undefined, reader: string, dependency: string): boolean {
  return specs.some((spec) => spec.orderOnlyReaders?.includes(reader) === true && spec.skips?.includes(dependency) === true
    && (omitted ?? []).some((entry) => entry.workflow === undefined && entry.step === spec.step));
}

/** The envelope field: ordered, one entry per step, so fingerprints are stable; absent, never empty. */
export const StepOmissionsSchema = z.array(StepOmissionEntrySchema).min(1).superRefine(uniqueSteps);
/** The planner's input: the same entries, where "none" is a legitimate empty list. */
const RequestedOmissionsSchema = z.array(StepOmissionEntrySchema).superRefine(uniqueSteps);
export type StepOmissions = z.infer<typeof StepOmissionsSchema>;

/** A released child's own entries: the parent's entries for the child's workflow, without the workflow; absent when there are none. */
export function delegatedStepOmissions(entries: readonly StepOmissionEntry[] | undefined, workflow: string): StepOmissions | undefined {
  const own = (entries ?? []).flatMap(({ workflow: target, ...entry }) => target === workflow ? [entry] : []);
  return own.length === 0 ? undefined : StepOmissionsSchema.parse(own);
}

/** The arm a workflow RESULT carries where an omitted write step's proof would be: no disposition is invented, the step is named. */
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
  /** node id → the step completed outside Relay; nothing runs or produces proof */
  readonly manual: ReadonlyMap<string, string>;
  readonly refusals: readonly StepOmissionRefusal[];
}

/** Classify every node for one run's omissions; pure and total, and a plan with refusals must not start. */
export function planStepOmissions(graph: StepOmissionGraphView, requested: readonly StepOmissionEntry[]): StepOmissionPlan {
  const asserted = new Map<string, { step: string; facts: JsonObject; produce: (context: StepOmissionProduceContext) => unknown }>();
  const omitted = new Map<string, string>();
  const manual = new Map<string, string>();
  const refusals: StepOmissionRefusal[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const stepByNode = new Map<string, string>();
  for (const category of graph.timeline) for (const { id } of category.nodes) stepByNode.set(id, category.key);
  const specByStep = new Map(graph.stepOmissions.map((spec) => [spec.step, spec]));
  const requestedSteps = new Set<string>();

  for (const entry of RequestedOmissionsSchema.parse(requested)) {
    if (entry.workflow !== undefined) continue;
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
    requestedSteps.add(entry.step);
    const skipped = new Set(spec.skips ?? []);
    for (const { id } of category.nodes) {
      const node = nodeById.get(id);
      if (node === undefined) throw new Error(`timeline step "${entry.step}" names node "${id}", which the graph does not declare`);
      // Skipped gates record no decision; dependent running nodes must refuse.
      const produce = node.kind === "task" ? spec.produces[id] : undefined;
      if (produce !== undefined) asserted.set(id, { step: entry.step, facts: JsonFactsSchema.parse(facts.data), produce });
      else if (skipped.has(id)) (spec.off === "manual" ? manual : omitted).set(id, entry.step);
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

  for (const step of requestedSteps) {
    for (const dependent of specByStep.get(step)?.alsoSkips ?? []) {
      if (requestedSteps.has(dependent)) continue;
      refusals.push({
        code: "dependency-omitted", step: dependent,
        message: `step "${dependent}" requires step "${step}" to run; omit "${dependent}" too, or include "${step}"`,
      });
    }
  }

  for (const node of graph.nodes) {
    if (asserted.has(node.id) || omitted.has(node.id) || manual.has(node.id)) continue;
    for (const dependency of node.dependsOn) {
      const blockedBy = omitted.get(dependency) ?? manual.get(dependency);
      if (blockedBy === undefined) continue;
      if (specByStep.get(blockedBy)?.orderOnlyReaders?.includes(node.id) === true) continue;
      const ownStep = stepByNode.get(node.id);
      if (ownStep === undefined) throw new Error(`node "${node.id}" is on no timeline step; a declared timeline is exhaustive`);
      refusals.push({
        code: "dependency-omitted", step: ownStep,
        message: `node "${node.id}" (step "${ownStep}") reads "${dependency}", which omitting step "${blockedBy}" leaves unread; `
          + `omit step "${ownStep}" too, or include step "${blockedBy}"`,
      });
    }
  }
  return Object.freeze({ asserted, omitted, manual, refusals: Object.freeze(refusals) });
}

/** One step's cascade row: the other steps forced out with it, or the step that cannot be omitted and so blocks it. */
export type StepOmissionCascadeRow =
  | Readonly<{ state: "omittable"; forces: readonly string[] }>
  | Readonly<{ state: "blocked"; by: string; forces: readonly string[] }>;

/** Schema-valid probe facts establish shape only; cascade and guard share the same values. */
export function stepOmissionPlaceholderFacts(form: StepOmissionForm): JsonObject {
  const placeholder = (field: StepOmissionField): JsonValue => {
    switch (field.kind) {
      case "boolean": return false;
      case "integer": return field.min ?? 0;
      case "text-list": return [];
      case "enum": return field.values[0] ?? "";
      case "us-date": return "01/01/2000";
      case "iso-date": return "2000-01-01";
      case "eid": return "10000000";
      case "text": return field.format === "crm-document-records" ? CRM_MANUAL_RECORDS_EXAMPLE : "cascade";
    }
  };
  return JsonFactsSchema.parse(Object.fromEntries(
    StepOmissionFormSchema.parse(form).fields.map((field) => [field.key, placeholder(field)]),
  ));
}

/** The Steps screen's cascade: the OTHER steps that would have to be omitted with each one, computed to a fixpoint over the same rule the planner enforces. */
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
      // Further omissions cannot repair an unread dependency inside an already-omitted step.
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
