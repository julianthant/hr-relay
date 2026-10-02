/**
 * Bundle-safe operation/action declaration vocabulary.
 *
 * An operation describes the stable UI semantics a task owns. A workflow only
 * instantiates that operation at a concrete task occurrence and binds its
 * values; it never retypes the driver's action tree or creates execution
 * edges. `compileWorkflowOperationDisplay` projects the existing workflow
 * graph's dependencies unchanged, so presentation order cannot become a
 * scheduler.
 */
import type { AnyReadTaskContract } from "../task/task-contract.js";
import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "../../rules/validation/canonical-json.js";
import {
  BrowserSystemIdSchema,
  ElementIdSchema,
  NodeIdSchema,
  ScreenIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
  slugSchema,
} from "../../rules/identity/ids.js";
import type { BrowserSystemId } from "../../rules/identity/ids.js";
import {
  assertSchemaOffersPath,
  assertSchemaOwnsPath,
} from "../validation/contract-boundary.js";

export const OPERATION_DISPLAY_FORMAT_VERSION = 1 as const;

export const OperationIdSchema = slugSchema("operation id must be kebab-case").brand<"OperationId">();
export const OperationActionIdSchema = slugSchema("operation action id must be kebab-case")
  .brand<"OperationActionId">();
export const OperationOutcomeIdSchema = slugSchema("operation outcome id must be kebab-case")
  .brand<"OperationOutcomeId">();
export const OperationOccurrenceSegmentSchema = slugSchema(
  "operation occurrence path segments must be kebab-case",
).brand<"OperationOccurrenceSegment">();
export const OperationSessionIdSchema = slugSchema("logical session id must be kebab-case")
  .brand<"OperationSessionId">();
export const OperationFormIdSchema = slugSchema("logical form id must be kebab-case")
  .brand<"OperationFormId">();
export const OperationValueIdSchema = slugSchema("operation value id must be kebab-case")
  .brand<"OperationValueId">();
export const OperationTransformIdSchema = slugSchema("operation transform id must be kebab-case")
  .brand<"OperationTransformId">();
export const ConfigurationReferenceKeySchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/,
  "configuration reference key must be a dot-delimited path",
).brand<"ConfigurationReferenceKey">();

const DisplayFieldPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "operation field path must be a dot-delimited object path",
);

export const OPERATION_ACTION_KINDS = [
  "open-page",
  "resume-page",
  "click",
  "keypress",
  "read-field",
  "fill-field",
  "select-field",
  "check-field",
  "compute",
  "verify",
  "branch",
  "join",
  "operator-gate",
  "delegate",
  "session-lifecycle",
] as const;
export type OperationActionKind = typeof OPERATION_ACTION_KINDS[number];

/** Workflow composition can order operation references but cannot recreate task browser actions. */
export const WORKFLOW_COMPOSITION_ACTION_KINDS = [
  "branch",
  "join",
  "operator-gate",
  "delegate",
  "session-lifecycle",
  "compute",
  "verify",
] as const;
export type WorkflowCompositionActionKind = typeof WORKFLOW_COMPOSITION_ACTION_KINDS[number];

export interface LogicalSessionReference {
  readonly kind: "browser" | "local";
  readonly id: string;
  readonly system?: BrowserSystemId;
}

export interface LogicalPageReference {
  readonly screen: string;
  readonly form?: string;
}

export interface TaskOperationValueSlot {
  readonly id: string;
  readonly presentation?: "local-operator" | "withhold";
  readonly source: Readonly<{
    kind: "contract-input" | "contract-output";
    path: string;
    /** One arm of a discriminated contract schema may provide this value. */
    availability?: "owned" | "offered";
  }>;
}

export interface TemplateVariable {
  readonly id: string;
  readonly slot: string;
}

export interface TemplateCondition {
  readonly kind: "is-present" | "is-absent" | "equals" | "not-equals";
  readonly variable: string;
  readonly value?: string;
}

export type OperationTemplateSegment =
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{ kind: "variable"; variable: string }>
  | Readonly<{
    kind: "optional";
    when: TemplateCondition;
    segments: readonly OperationTemplateSegment[];
  }>;

export interface OperationTemplate {
  readonly id: string;
  readonly variables: readonly TemplateVariable[];
  readonly segments: readonly OperationTemplateSegment[];
  readonly join: Readonly<{
    separator: string;
    trim: "none" | "segments" | "outer";
  }>;
}

export interface OperationTransformDeclaration {
  readonly id: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  readonly example: unknown;
  /** Pure, schema-bound calculation; the display compiler never interprets it. */
  readonly derive: (input: unknown) => unknown;
}

export interface OperationOutcomeCase {
  readonly id: string;
  readonly label: string;
  readonly when: TemplateCondition;
  readonly continuation?: string;
}

export interface TaskOperationAction {
  readonly id: string;
  readonly kind: OperationActionKind;
  readonly label?: string;
  /** Semantic driver element identity, never a selector. */
  readonly target?: string;
  readonly valueSlot?: string;
  /** Exact task-owned template used to produce this fill field's text. */
  readonly templateId?: string;
  readonly transform?: string;
  readonly page?: LogicalPageReference;
  /** Only `resume-page` may continue an existing page occurrence. */
  readonly continuedFrom?: string;
  readonly confirmationActionId?: string;
  readonly outcomes?: readonly OperationOutcomeCase[];
  /** Ordered presentation only; execution derives from the workflow graph. */
  readonly children?: readonly TaskOperationAction[];
}

/**
 * A reusable task-level operation. It is attached to the exact sealed task
 * contract and references the same semantic UI identities that a driver uses.
 */
export interface TaskOperationDeclaration {
  readonly version: typeof OPERATION_DISPLAY_FORMAT_VERSION;
  readonly id: string;
  readonly system: BrowserSystemId | "local";
  readonly session: LogicalSessionReference;
  readonly page?: LogicalPageReference;
  readonly values?: readonly TaskOperationValueSlot[];
  readonly templates?: readonly OperationTemplate[];
  readonly transforms?: readonly OperationTransformDeclaration[];
  readonly actions: readonly TaskOperationAction[];
}

interface TaskContractDisplayView {
  readonly id: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
}

function operationError(contract: TaskContractDisplayView, operation: TaskOperationDeclaration, message: string): Error {
  return new Error(`task ${contract.id} operation "${operation.id}": ${message}`);
}

function fieldPath(
  schema: z.ZodType,
  path: string,
  availability: "owned" | "offered" | undefined,
  owner: string,
): void {
  DisplayFieldPathSchema.parse(path);
  if (availability === "offered") assertSchemaOffersPath(schema, path, owner);
  else assertSchemaOwnsPath(schema, path, owner);
}

function samePage(left: LogicalPageReference | undefined, right: LogicalPageReference | undefined): boolean {
  return left !== undefined
    && right !== undefined
    && left.screen === right.screen
    && left.form === right.form;
}

function validatePage(
  contract: TaskContractDisplayView,
  operation: TaskOperationDeclaration,
  page: LogicalPageReference,
): void {
  const screen = ScreenIdSchema.parse(page.screen);
  if (operation.system === "local") throw operationError(contract, operation, "local operations cannot declare a page");
  if (!String(screen).startsWith(`${operation.system}.`)) {
    throw operationError(contract, operation, `page ${screen} belongs to another system`);
  }
  if (page.form !== undefined) OperationFormIdSchema.parse(page.form);
}

function validateSession(contract: TaskContractDisplayView, operation: TaskOperationDeclaration): void {
  OperationSessionIdSchema.parse(operation.session.id);
  if (operation.system === "local") {
    if (operation.session.kind !== "local" || operation.session.system !== undefined) {
      throw operationError(contract, operation, "a local operation requires a local logical session");
    }
    if (operation.page !== undefined) throw operationError(contract, operation, "local operations cannot declare a page");
    return;
  }
  if (operation.session.kind !== "browser" || operation.session.system !== operation.system) {
    throw operationError(contract, operation, `requires a ${operation.system} browser logical session`);
  }
  if (operation.page !== undefined) validatePage(contract, operation, operation.page);
}

function validateTemplateCondition(
  condition: TemplateCondition,
  variables: ReadonlyMap<string, TemplateVariable>,
  owner: string,
): void {
  if (!["is-present", "is-absent", "equals", "not-equals"].includes(condition.kind)) {
    throw new Error(`${owner} has an unknown condition kind "${String(condition.kind)}"`);
  }
  if (!variables.has(condition.variable)) throw new Error(`${owner} references missing template variable "${condition.variable}"`);
  const compares = condition.kind === "equals" || condition.kind === "not-equals";
  if (compares && condition.value === undefined) throw new Error(`${owner} requires a comparison value`);
  if (!compares && condition.value !== undefined) throw new Error(`${owner} cannot carry a comparison value`);
}

function validateTemplate(
  contract: TaskContractDisplayView,
  operation: TaskOperationDeclaration,
  template: OperationTemplate,
  slots: ReadonlyMap<string, TaskOperationValueSlot>,
): void {
  OperationIdSchema.parse(template.id);
  if (!["none", "segments", "outer"].includes(template.join.trim)) {
    throw operationError(contract, operation, `template "${template.id}" has an unknown trim rule`);
  }
  const variables = new Map<string, TemplateVariable>();
  for (const variable of template.variables) {
    OperationValueIdSchema.parse(variable.id);
    if (variables.has(variable.id)) throw operationError(contract, operation, `template "${template.id}" repeats variable "${variable.id}"`);
    if (!slots.has(variable.slot)) {
      throw operationError(contract, operation, `template "${template.id}" references missing value slot "${variable.slot}"`);
    }
    variables.set(variable.id, variable);
  }
  const visiting = new Set<object>();
  const visit = (segments: readonly OperationTemplateSegment[], path: string): void => {
    if (segments.length === 0) throw operationError(contract, operation, `${path} has no segments`);
    for (const [index, segment] of segments.entries()) {
      if (segment === null || typeof segment !== "object") {
        throw operationError(contract, operation, `${path}[${String(index)}] is not a template segment`);
      }
      if (visiting.has(segment)) throw operationError(contract, operation, `${path}[${String(index)}] contains a segment cycle`);
      visiting.add(segment);
      if (segment.kind === "literal") {
        if (typeof segment.value !== "string") throw operationError(contract, operation, `${path}[${String(index)}] literal is not text`);
      } else if (segment.kind === "variable") {
        if (!variables.has(segment.variable)) {
          throw operationError(contract, operation, `${path}[${String(index)}] references missing template variable "${segment.variable}"`);
        }
      } else if (segment.kind === "optional") {
        validateTemplateCondition(segment.when, variables, `${path}[${String(index)}]`);
        visit(segment.segments, `${path}[${String(index)}].segments`);
      } else {
        throw operationError(contract, operation, `${path}[${String(index)}] has an unknown segment kind`);
      }
      visiting.delete(segment);
    }
  };
  visit(template.segments, `template "${template.id}"`);
}

function validateTransform(
  contract: TaskContractDisplayView,
  operation: TaskOperationDeclaration,
  transform: OperationTransformDeclaration,
  seen: Set<string>,
): void {
  OperationTransformIdSchema.parse(transform.id);
  if (seen.has(transform.id)) throw operationError(contract, operation, `repeats transform "${transform.id}"`);
  seen.add(transform.id);
  if (!(transform.input instanceof z.ZodType) || !(transform.output instanceof z.ZodType)) {
    throw operationError(contract, operation, `transform "${transform.id}" requires input and output schemas`);
  }
  if (typeof transform.derive !== "function") throw operationError(contract, operation, `transform "${transform.id}" requires a pure derive function`);
  const input = transform.input.parse(transform.example);
  const first = transform.output.parse(transform.derive(input));
  const second = transform.output.parse(transform.derive(input));
  if (canonicalJsonStringify(first) !== canonicalJsonStringify(second)) {
    throw operationError(contract, operation, `transform "${transform.id}" is not deterministic for its declared example`);
  }
}

/** Validate a task operation as part of sealing its exact task contract. */
export function assertTaskOperationDeclaration(
  operation: TaskOperationDeclaration,
  contract: TaskContractDisplayView,
): void {
  if (operation.version !== OPERATION_DISPLAY_FORMAT_VERSION) {
    throw new Error(`task ${contract.id} operation format ${String(operation.version)} is unsupported`);
  }
  OperationIdSchema.parse(operation.id);
  const namespace = contract.id.slice(0, contract.id.lastIndexOf("/"));
  const browser = BrowserSystemIdSchema.safeParse(namespace);
  const expectedSystem = browser.success ? browser.data : "local";
  if (operation.system !== expectedSystem) {
    throw operationError(contract, operation, `declares system "${operation.system}", but its task belongs to "${expectedSystem}"`);
  }
  validateSession(contract, operation);

  const slots = new Map<string, TaskOperationValueSlot>();
  for (const slot of operation.values ?? []) {
    OperationValueIdSchema.parse(slot.id);
    if (slot.presentation !== undefined && !["local-operator", "withhold"].includes(slot.presentation)) throw operationError(contract, operation, `value slot "${slot.id}" has an invalid presentation classification`);
    if (slots.has(slot.id)) throw operationError(contract, operation, `repeats value slot "${slot.id}"`);
    if (slot.source.kind !== "contract-input" && slot.source.kind !== "contract-output") {
      throw operationError(contract, operation, `value slot "${slot.id}" has an unknown source`);
    }
    fieldPath(
      slot.source.kind === "contract-input" ? contract.input : contract.output,
      slot.source.path,
      slot.source.availability,
      `task ${contract.id} operation "${operation.id}" value slot "${slot.id}"`,
    );
    slots.set(slot.id, slot);
  }

  const transforms = new Set<string>();
  for (const transform of operation.transforms ?? []) validateTransform(contract, operation, transform, transforms);
  const templates = new Set<string>();
  for (const template of operation.templates ?? []) {
    if (templates.has(template.id)) throw operationError(contract, operation, `repeats template "${template.id}"`);
    templates.add(template.id);
    validateTemplate(contract, operation, template, slots);
  }

  if (operation.actions.length === 0) throw operationError(contract, operation, "requires at least one action");
  const actions = new Map<string, Readonly<{ action: TaskOperationAction; page?: LogicalPageReference }>>();
  const visiting = new Set<object>();
  const visit = (action: TaskOperationAction, inheritedPage: LogicalPageReference | undefined): void => {
    if (action === null || typeof action !== "object") throw operationError(contract, operation, "contains a non-object action");
    if (visiting.has(action)) throw operationError(contract, operation, `action "${action.id}" creates a child cycle`);
    visiting.add(action);
    OperationActionIdSchema.parse(action.id);
    if (!OPERATION_ACTION_KINDS.includes(action.kind)) {
      throw operationError(contract, operation, `action "${action.id}" has an unknown kind "${String(action.kind)}"`);
    }
    if (actions.has(action.id)) throw operationError(contract, operation, `repeats action id "${action.id}"`);
    const page = action.page ?? inheritedPage;
    if (action.page !== undefined) validatePage(contract, operation, action.page);
    const needsTarget = operation.system !== "local" && ["click", "keypress", "read-field", "fill-field", "select-field", "check-field"].includes(action.kind);
    if (operation.system === "local" && ["click", "keypress", "fill-field", "select-field", "check-field", "open-page", "resume-page"].includes(action.kind)) throw operationError(contract, operation, `local action "${action.id}" cannot declare a browser gesture`);
    const needsValue = ["keypress", "read-field", "fill-field", "select-field", "check-field"].includes(action.kind);
    if (needsTarget) {
      if (action.target === undefined) throw operationError(contract, operation, `action "${action.id}" requires a semantic target`);
      const target = ElementIdSchema.parse(action.target);
      if (operation.system === "local" || !String(target).startsWith(`${operation.system}.`)) {
        throw operationError(contract, operation, `action "${action.id}" target belongs to another system`);
      }
    } else if (action.target !== undefined) {
      throw operationError(contract, operation, `action "${action.id}" cannot declare a semantic target`);
    }
    if (needsTarget && page === undefined) throw operationError(contract, operation, `action "${action.id}" requires a logical page`);
    if (["open-page", "resume-page"].includes(action.kind) && page === undefined) {
      throw operationError(contract, operation, `action "${action.id}" requires a logical page`);
    }
    if (needsValue) {
      if (action.valueSlot === undefined) throw operationError(contract, operation, `action "${action.id}" requires a value slot`);
      if (!slots.has(action.valueSlot)) throw operationError(contract, operation, `action "${action.id}" references missing value slot "${action.valueSlot}"`);
    } else if (action.kind === "compute" && action.valueSlot !== undefined) {
      const slot = slots.get(action.valueSlot);
      if (slot === undefined || slot.source.kind !== "contract-output") throw operationError(contract, operation, `compute action "${action.id}" requires a declared contract-output value slot`);
    } else if (action.valueSlot !== undefined) {
      throw operationError(contract, operation, `action "${action.id}" cannot declare a value slot`);
    }
    if (action.templateId !== undefined) {
      OperationIdSchema.parse(action.templateId);
      if (action.kind !== "fill-field") throw operationError(contract, operation, `action "${action.id}" cannot declare a fill template`);
      if (!templates.has(action.templateId)) throw operationError(contract, operation, `action "${action.id}" references missing template "${action.templateId}"`);
    }
    if (action.kind === "compute") {
      if (action.transform === undefined || !transforms.has(action.transform)) {
        throw operationError(contract, operation, `compute action "${action.id}" references an unavailable transform`);
      }
    } else if (action.transform !== undefined) {
      throw operationError(contract, operation, `action "${action.id}" cannot declare a transform`);
    }
    if (action.kind === "branch" && (action.outcomes === undefined || action.outcomes.length === 0)) {
      throw operationError(contract, operation, `branch action "${action.id}" requires outcome cases`);
    }
    actions.set(action.id, Object.freeze({ action, ...(page === undefined ? {} : { page }) }));
    for (const child of action.children ?? []) visit(child, page);
    visiting.delete(action);
  };
  for (const action of operation.actions) visit(action, operation.page);

  const continuationEdges = new Map<string, readonly string[]>();
  for (const [id, { action, page }] of actions) {
    if (action.confirmationActionId !== undefined) {
      const verification = actions.get(action.confirmationActionId);
      if (verification?.action.kind !== "verify" || (page !== undefined || verification.page !== undefined) && !samePage(page, verification.page)) throw operationError(contract, operation, `action "${id}" has an invalid expected-effect verification "${action.confirmationActionId}"`);
    }
    if (action.continuedFrom !== undefined) {
      if (action.kind !== "resume-page") throw operationError(contract, operation, `action "${id}" only resume-page may continue a page`);
      const source = actions.get(action.continuedFrom);
      if (source === undefined || !["open-page", "resume-page"].includes(source.action.kind) || !samePage(page, source.page)) {
        throw operationError(contract, operation, `resume-page action "${id}" has an invalid page continuation "${action.continuedFrom}"`);
      }
    }
    const outcomes = action.outcomes ?? [];
    const caseIds = new Set<string>();
    const targets: string[] = [];
    for (const outcome of outcomes) {
      OperationOutcomeIdSchema.parse(outcome.id);
      if (caseIds.has(outcome.id)) throw operationError(contract, operation, `action "${id}" repeats outcome case "${outcome.id}"`);
      caseIds.add(outcome.id);
      if (outcome.label.trim().length === 0) throw operationError(contract, operation, `action "${id}" outcome "${outcome.id}" has no label`);
      const variables = new Map<string, TemplateVariable>();
      for (const slot of slots.values()) variables.set(slot.id, { id: slot.id, slot: slot.id });
      validateTemplateCondition(outcome.when, variables, `task ${contract.id} operation "${operation.id}" action "${id}" outcome "${outcome.id}"`);
      if (outcome.continuation !== undefined) {
        if (!actions.has(outcome.continuation)) {
          throw operationError(contract, operation, `action "${id}" outcome "${outcome.id}" targets unknown action "${outcome.continuation}"`);
        }
        targets.push(outcome.continuation);
      }
    }
    continuationEdges.set(id, Object.freeze(targets));
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visitContinuation = (id: string, path: readonly string[]): void => {
    if (visited.has(id)) return;
    if (active.has(id)) throw operationError(contract, operation, `outcome continuation cycle: ${[...path, id].join(" -> ")}`);
    active.add(id);
    for (const target of continuationEdges.get(id) ?? []) visitContinuation(target, [...path, id]);
    active.delete(id);
    visited.add(id);
  };
  for (const id of actions.keys()) visitContinuation(id, []);
}

function matchesTemplateCondition(condition: TemplateCondition, values: Readonly<Record<string, string | undefined>>): boolean {
  const value = values[condition.variable];
  switch (condition.kind) {
    case "is-present": return value !== undefined && value !== "";
    case "is-absent": return value === undefined || value === "";
    case "equals": return value === condition.value;
    case "not-equals": return value !== condition.value;
  }
}

/** Render the exact declaration a UI previews; no second template language exists. */
export function renderOperationTemplate(
  template: OperationTemplate,
  values: Readonly<Record<string, string | undefined>>,
): string {
  const render = (segments: readonly OperationTemplateSegment[]): readonly string[] => segments.flatMap((segment) => {
    if (segment.kind === "literal") return [segment.value];
    if (segment.kind === "variable") {
      const value = values[segment.variable];
      if (value === undefined) throw new Error(`template "${template.id}" cannot render missing variable "${segment.variable}"`);
      return [value];
    }
    return matchesTemplateCondition(segment.when, values) ? render(segment.segments) : [];
  });
  const segments = render(template.segments);
  const joined = template.join.trim === "segments"
    ? segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0).join(template.join.separator)
    : segments.join(template.join.separator);
  return template.join.trim === "outer" ? joined.trim() : joined;
}

export type WorkflowValueReference =
  | Readonly<{ kind: "run-input"; path: string; availability?: "owned" | "offered" }>
  | Readonly<{ kind: "configuration"; key: string; schema: z.ZodType; example: unknown }>
  | Readonly<{ kind: "constant"; value: unknown }>
  | Readonly<{ kind: "task-output"; entryId: string; path: string; availability?: "owned" | "offered" }>
  | Readonly<{ kind: "transformation"; transformId: string; path: string; availability?: "owned" | "offered" }>
  | Readonly<{ kind: "child-output"; entryId: string; path: string; availability?: "owned" | "offered" }>;

export interface WorkflowDisplayTransformDeclaration {
  readonly id: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  readonly inputs: readonly Readonly<{
    id: string;
    /** Exact schema path the source supplies to the transform's input. */
    inputPath: string;
    value: WorkflowValueReference;
  }>[];
  readonly example: unknown;
  readonly derive: (input: unknown) => unknown;
}

export interface WorkflowOutcomePredicate {
  readonly kind: "is-present" | "is-absent" | "equals" | "not-equals";
  readonly value: WorkflowValueReference;
  readonly expected?: unknown;
}

export interface WorkflowOutcomeCase {
  readonly id: string;
  readonly label: string;
  readonly when: WorkflowOutcomePredicate;
  readonly continuation?: string;
}

export interface OperationInvocationDeclaration {
  readonly id: string;
  readonly entryId: string;
  readonly contractRole: "task" | "probe" | "prepare" | "commit" | "verify";
  readonly occurrencePath: readonly string[];
  readonly bindings?: readonly Readonly<{ slot: string; value: WorkflowValueReference }>[];
  readonly outcomes?: readonly WorkflowOutcomeCase[];
}

export interface WorkflowOperationPresentationNode {
  readonly id: string;
  /** `operation` references task-owned browser action structure; other kinds are composition-only. */
  readonly kind: "operation" | WorkflowCompositionActionKind;
  readonly invocationId?: string;
  readonly entryId?: string;
  readonly targetWorkflowId?: string;
  readonly transform?: string;
  readonly outcomes?: readonly WorkflowOutcomeCase[];
  /** Ordered presentation only; no execution dependencies are accepted here. */
  readonly children?: readonly WorkflowOperationPresentationNode[];
}

export interface WorkflowResultSourceBinding {
  readonly path: string;
  readonly source: Readonly<{ kind: "task-output" | "child-output"; entryId: string; path: string }>
    | Readonly<{ kind: "derived"; inputs: readonly Readonly<{ id: string; source: Readonly<{ kind: "task-output" | "child-output"; entryId: string; path: string }> }>[] }>;
}

export interface WorkflowOperationDisplayDeclaration {
  readonly capability: "complete";
  readonly version: typeof OPERATION_DISPLAY_FORMAT_VERSION;
  readonly transforms?: readonly WorkflowDisplayTransformDeclaration[];
  readonly transactionReads?: readonly Readonly<{ entryId: string; role: "probe" | "verify"; contract: AnyReadTaskContract }>[];
  readonly invocations: readonly OperationInvocationDeclaration[];
  readonly presentation: readonly WorkflowOperationPresentationNode[];
}

export interface WorkflowOperationContractProjection {
  readonly role: "task" | "probe" | "prepare" | "commit" | "verify";
  readonly contract: TaskContractDisplayView & Readonly<{ operation?: TaskOperationDeclaration }>;
}

export interface WorkflowOperationEntryProjection {
  readonly label?: string;
  readonly id: string;
  readonly kind: "task" | "transaction" | "gate" | "parallel" | "delegate";
  readonly dependsOn: readonly string[];
  readonly contracts: readonly WorkflowOperationContractProjection[];
  readonly output?: z.ZodType;
  readonly child?: Readonly<{ workflowId: string; result: z.ZodType }>;
}

export interface WorkflowOperationDisplayCompileInput {
  readonly workflowId: string;
  readonly input: z.ZodType;
  readonly entries: readonly WorkflowOperationEntryProjection[];
  readonly declaration?: WorkflowOperationDisplayDeclaration;
  readonly result?: Readonly<{ schema: z.ZodType; dependsOn: readonly string[]; sources?: readonly WorkflowResultSourceBinding[] }>;
}

export interface LegacyWorkflowOperationDisplay {
  readonly capability: "legacy";
  readonly version: 0;
}

export interface CompleteWorkflowOperationDisplay {
  readonly resultSources?: readonly WorkflowResultSourceBinding[];
  readonly capability: "complete";
  readonly version: typeof OPERATION_DISPLAY_FORMAT_VERSION;
  readonly transforms: readonly WorkflowDisplayTransformDeclaration[];
  readonly invocations: readonly (OperationInvocationDeclaration & Readonly<{
    operation: TaskOperationDeclaration;
    /** Exact sealed task contract that owns the reusable operation. */
    taskId: string;
    label?: string;
  }>)[];
  readonly presentation: readonly WorkflowOperationPresentationNode[];
  /** Derived from the existing graph only; presentation is never an edge source. */
  readonly execution: readonly Readonly<{ entryId: string; dependsOn: readonly string[] }>[];
}

export type WorkflowOperationDisplay = LegacyWorkflowOperationDisplay | CompleteWorkflowOperationDisplay;

const COMPILED_COMPLETE_DISPLAYS = new WeakSet<object>();

/** A descriptor may carry a complete display only when this compiler produced it. */
export function assertCompiledWorkflowOperationDisplay(
  display: WorkflowOperationDisplay,
): asserts display is CompleteWorkflowOperationDisplay {
  if (display.capability !== "complete" || !COMPILED_COMPLETE_DISPLAYS.has(display)) {
    throw new Error("workflow operation display must be a compiler-produced complete projection");
  }
}

function validateWorkflowReference(
  value: WorkflowValueReference,
  context: string,
  input: z.ZodType,
  entries: ReadonlyMap<string, WorkflowOperationEntryProjection>,
  transforms: ReadonlyMap<string, WorkflowDisplayTransformDeclaration>,
): z.ZodType | undefined {
  if (value.kind === "run-input") {
    fieldPath(input, value.path, value.availability, context);
    return input;
  }
  if (value.kind === "configuration") {
    ConfigurationReferenceKeySchema.parse(value.key);
    if (!(value.schema instanceof z.ZodType)) throw new Error(`${context} configuration reference requires a schema`);
    value.schema.parse(value.example);
    return value.schema;
  }
  if (value.kind === "constant") {
    JsonValueSchema.parse(value.value);
    return undefined;
  }
  if (value.kind === "transformation") {
    const transform = transforms.get(value.transformId);
    if (transform === undefined) throw new Error(`${context} references unavailable transform "${value.transformId}"`);
    fieldPath(transform.output, value.path, value.availability, context);
    return transform.output;
  }
  const entry = entries.get(value.entryId);
  if (entry === undefined) throw new Error(`${context} references unavailable entry "${value.entryId}"`);
  if (value.kind === "task-output") {
    if (entry.kind !== "task" || entry.output === undefined) {
      throw new Error(`${context} references task output from non-task entry "${value.entryId}"`);
    }
    fieldPath(entry.output, value.path, value.availability, context);
    return entry.output;
  }
  if (entry.kind !== "delegate" || entry.child === undefined) {
    throw new Error(`${context} references unavailable child output "${value.entryId}"`);
  }
  fieldPath(entry.child.result, value.path, value.availability, context);
  return entry.child.result;
}

function validateWorkflowTransform(
  transform: WorkflowDisplayTransformDeclaration,
  seen: Set<string>,
): void {
  OperationTransformIdSchema.parse(transform.id);
  if (seen.has(transform.id)) throw new Error(`workflow operation display repeats transform "${transform.id}"`);
  seen.add(transform.id);
  if (!(transform.input instanceof z.ZodType) || !(transform.output instanceof z.ZodType)) {
    throw new Error(`workflow operation display transform "${transform.id}" requires input and output schemas`);
  }
  if (typeof transform.derive !== "function") throw new Error(`workflow operation display transform "${transform.id}" requires a pure derive function`);
  const input = transform.input.parse(transform.example);
  const first = transform.output.parse(transform.derive(input));
  const second = transform.output.parse(transform.derive(input));
  if (canonicalJsonStringify(first) !== canonicalJsonStringify(second)) {
    throw new Error(`workflow operation display transform "${transform.id}" is not deterministic for its declared example`);
  }
}

function validateWorkflowOutcomes(
  outcomes: readonly WorkflowOutcomeCase[] | undefined,
  context: string,
  input: z.ZodType,
  entries: ReadonlyMap<string, WorkflowOperationEntryProjection>,
  transforms: ReadonlyMap<string, WorkflowDisplayTransformDeclaration>,
): void {
  const ids = new Set<string>();
  for (const outcome of outcomes ?? []) {
    OperationOutcomeIdSchema.parse(outcome.id);
    if (ids.has(outcome.id)) throw new Error(`${context} repeats outcome case "${outcome.id}"`);
    ids.add(outcome.id);
    if (outcome.label.trim().length === 0) throw new Error(`${context} outcome "${outcome.id}" has no label`);
    validateWorkflowReference(outcome.when.value, `${context} outcome "${outcome.id}"`, input, entries, transforms);
    const compares = outcome.when.kind === "equals" || outcome.when.kind === "not-equals";
    if (compares && outcome.when.expected === undefined) throw new Error(`${context} outcome "${outcome.id}" requires an expected value`);
    if (!compares && outcome.when.expected !== undefined) throw new Error(`${context} outcome "${outcome.id}" cannot carry an expected value`);
    if (compares) JsonValueSchema.parse(outcome.when.expected);
    if (!["is-present", "is-absent", "equals", "not-equals"].includes(outcome.when.kind)) {
      throw new Error(`${context} outcome "${outcome.id}" has an unknown predicate`);
    }
  }
}

function freezePresentation(nodes: readonly WorkflowOperationPresentationNode[]): readonly WorkflowOperationPresentationNode[] {
  return Object.freeze(nodes.map((node) => Object.freeze({
    ...node,
    ...(node.outcomes === undefined ? {} : { outcomes: Object.freeze([...node.outcomes]) }),
    ...(node.children === undefined ? {} : { children: freezePresentation(node.children) }),
  })));
}

/**
 * Compile the optional complete format. The caller supplies graph projections
 * from the one workflow compiler; this function deliberately has no builder
 * and cannot synthesize runtime scheduling authority.
 */
export function compileWorkflowOperationDisplay(input: WorkflowOperationDisplayCompileInput): WorkflowOperationDisplay {
  WorkflowIdSchema.parse(input.workflowId);
  if (input.declaration === undefined) return Object.freeze({ capability: "legacy", version: 0 });
  const declaration = input.declaration;
  if (declaration.capability !== "complete" || declaration.version !== OPERATION_DISPLAY_FORMAT_VERSION) {
    throw new Error(`workflow ${input.workflowId} operation display requires complete format v${String(OPERATION_DISPLAY_FORMAT_VERSION)}`);
  }
  const entries = new Map<string, WorkflowOperationEntryProjection>();
  for (const entry of input.entries) {
    NodeIdSchema.parse(entry.id);
    if (entries.has(entry.id)) throw new Error(`workflow ${input.workflowId} operation display repeats entry "${entry.id}"`);
    entries.set(entry.id, entry);
  }
  const transforms = new Map<string, WorkflowDisplayTransformDeclaration>();
  const transformIds = new Set<string>();
  for (const transform of declaration.transforms ?? []) {
    validateWorkflowTransform(transform, transformIds);
    transforms.set(transform.id, transform);
  }
  for (const transform of declaration.transforms ?? []) {
    const inputIds = new Set<string>();
    for (const source of transform.inputs) {
      OperationValueIdSchema.parse(source.id);
      if (inputIds.has(source.id)) throw new Error(`workflow operation display transform "${transform.id}" repeats input "${source.id}"`);
      inputIds.add(source.id);
      fieldPath(
        transform.input,
        source.inputPath,
        undefined,
        `workflow operation display transform "${transform.id}" input "${source.id}"`,
      );
      validateWorkflowReference(source.value, `workflow operation display transform "${transform.id}" input "${source.id}"`, input.input, entries, transforms);
    }
  }

  const activeTransforms = new Set<string>();
  const visitedTransforms = new Set<string>();
  const visitTransform = (id: string): void => {
    if (activeTransforms.has(id)) throw new Error(`workflow operation display transformation cycle at "${id}"`);
    if (visitedTransforms.has(id)) return;
    activeTransforms.add(id);
    for (const source of transforms.get(id)?.inputs ?? []) {
      if (source.value.kind === "transformation") visitTransform(source.value.transformId);
    }
    activeTransforms.delete(id);
    visitedTransforms.add(id);
  };
  for (const id of transforms.keys()) visitTransform(id);

  const expected = new Map<string, WorkflowOperationContractProjection>();
  for (const entry of input.entries) {
    for (const contract of entry.contracts) {
      const key = `${entry.id}/${contract.role}`;
      if (contract.contract.operation === undefined) {
        throw new Error(
          `workflow ${input.workflowId} complete operation display entry "${entry.id}" uses contract ${contract.contract.id} without an operation declaration`,
        );
      }
      expected.set(key, contract);
    }
  }
  const invocationIds = new Set<string>();
  const invocationPaths = new Set<string>();
  const invoked = new Set<string>();
  const compiledInvocations: (OperationInvocationDeclaration & Readonly<{
    operation: TaskOperationDeclaration;
    taskId: string;
    label?: string;
  }>)[] = [];
  for (const invocation of declaration.invocations) {
    OperationIdSchema.parse(invocation.id);
    if (invocationIds.has(invocation.id)) throw new Error(`workflow ${input.workflowId} operation display repeats invocation "${invocation.id}"`);
    invocationIds.add(invocation.id);
    const key = `${invocation.entryId}/${invocation.contractRole}`;
    const expectedContract = expected.get(key);
    if (expectedContract === undefined) {
      throw new Error(`workflow ${input.workflowId} operation display invocation "${invocation.id}" references unavailable contract occurrence ${key}`);
    }
    if (invoked.has(key)) throw new Error(`workflow ${input.workflowId} operation display repeats contract occurrence ${key}`);
    invoked.add(key);
    if (invocation.occurrencePath.length === 0) throw new Error(`workflow ${input.workflowId} operation display invocation "${invocation.id}" requires an occurrence path`);
    const occurrencePath = invocation.occurrencePath.map((segment) => OperationOccurrenceSegmentSchema.parse(segment));
    if (occurrencePath[0] !== invocation.entryId) {
      throw new Error(`workflow ${input.workflowId} operation display invocation "${invocation.id}" occurrence path must begin with its entry id`);
    }
    const pathKey = occurrencePath.join("/");
    if (invocationPaths.has(pathKey)) throw new Error(`workflow ${input.workflowId} operation display repeats occurrence path "${pathKey}"`);
    invocationPaths.add(pathKey);
    const operation = expectedContract.contract.operation;
    if (operation === undefined) throw new Error(`workflow ${input.workflowId} operation display lost operation declaration for ${expectedContract.contract.id}`);
    const slots = new Map((operation.values ?? []).map((slot) => [slot.id, slot]));
    const bindingSlots = new Set<string>();
    for (const binding of invocation.bindings ?? []) {
      if (bindingSlots.has(binding.slot)) throw new Error(`workflow ${input.workflowId} invocation "${invocation.id}" repeats binding "${binding.slot}"`);
      bindingSlots.add(binding.slot);
      const slot = slots.get(binding.slot);
      if (slot === undefined) throw new Error(`workflow ${input.workflowId} invocation "${invocation.id}" references missing value slot "${binding.slot}"`);
      if (slot.source.kind !== "contract-input") {
        throw new Error(`workflow ${input.workflowId} invocation "${invocation.id}" cannot bind contract-output slot "${binding.slot}"`);
      }
      validateWorkflowReference(binding.value, `workflow ${input.workflowId} invocation "${invocation.id}" binding "${binding.slot}"`, input.input, entries, transforms);
    }
    for (const slot of slots.values()) {
      if (slot.source.kind === "contract-input" && !bindingSlots.has(slot.id)) {
        throw new Error(`workflow ${input.workflowId} invocation "${invocation.id}" is missing binding for value slot "${slot.id}"`);
      }
    }
    validateWorkflowOutcomes(invocation.outcomes, `workflow ${input.workflowId} invocation "${invocation.id}"`, input.input, entries, transforms);
    compiledInvocations.push(Object.freeze({
      ...invocation,
      taskId: TaskIdSchema.parse(expectedContract.contract.id),
      ...(entries.get(invocation.entryId)?.label === undefined ? {} : { label: z.string().trim().min(1).parse(entries.get(invocation.entryId)?.label) }),
      occurrencePath: Object.freeze(occurrencePath),
      ...(invocation.bindings === undefined ? {} : { bindings: Object.freeze([...invocation.bindings]) }),
      ...(invocation.outcomes === undefined ? {} : { outcomes: Object.freeze([...invocation.outcomes]) }),
      operation,
    }));
  }
  for (const key of expected.keys()) {
    if (!invoked.has(key)) throw new Error(`workflow ${input.workflowId} complete operation display is missing contract occurrence ${key}`);
  }

  const nodes = new Map<string, WorkflowOperationPresentationNode>();
  const invocationNodes = new Set<string>();
  const continuationEdges = new Map<string, readonly string[]>();
  const visiting = new Set<object>();
  const visitNode = (node: WorkflowOperationPresentationNode): void => {
    if (node === null || typeof node !== "object") throw new Error(`workflow ${input.workflowId} operation display contains a non-object presentation node`);
    if (visiting.has(node)) throw new Error(`workflow ${input.workflowId} operation display presentation contains a child cycle`);
    visiting.add(node);
    OperationActionIdSchema.parse(node.id);
    if (nodes.has(node.id)) throw new Error(`workflow ${input.workflowId} operation display repeats presentation action "${node.id}"`);
    if (node.kind === "operation") {
      if (node.invocationId === undefined || !invocationIds.has(node.invocationId)) {
        throw new Error(`workflow ${input.workflowId} operation display node "${node.id}" references unavailable invocation`);
      }
      if (invocationNodes.has(node.invocationId)) throw new Error(`workflow ${input.workflowId} operation display renders invocation "${node.invocationId}" more than once`);
      invocationNodes.add(node.invocationId);
    } else if (!WORKFLOW_COMPOSITION_ACTION_KINDS.includes(node.kind)) {
      throw new Error(`workflow ${input.workflowId} operation display node "${node.id}" cannot redeclare a task action`);
    }
    if (node.kind === "operator-gate") {
      const entry = node.entryId === undefined ? undefined : entries.get(node.entryId);
      if (entry?.kind !== "gate") throw new Error(`workflow ${input.workflowId} operation display gate "${node.id}" references unavailable gate entry`);
    }
    if (node.kind === "join") {
      const entry = node.entryId === undefined ? undefined : entries.get(node.entryId);
      if (entry?.kind !== "parallel") throw new Error(`workflow ${input.workflowId} operation display join "${node.id}" references unavailable parallel entry`);
    }
    if (node.kind === "delegate") {
      const entry = node.entryId === undefined ? undefined : entries.get(node.entryId);
      if (entry?.kind !== "delegate" || entry.child === undefined || node.targetWorkflowId === undefined) {
        throw new Error(`workflow ${input.workflowId} operation display delegate "${node.id}" references unavailable child`);
      }
      if (WorkflowIdSchema.parse(node.targetWorkflowId) !== entry.child.workflowId) {
        throw new Error(`workflow ${input.workflowId} operation display delegate "${node.id}" targets unavailable child "${node.targetWorkflowId}"`);
      }
    }
    if (node.kind === "compute") {
      if (node.transform === undefined || !transforms.has(node.transform)) {
        throw new Error(`workflow ${input.workflowId} operation display compute node "${node.id}" references an unavailable transform`);
      }
    } else if (node.transform !== undefined) {
      throw new Error(`workflow ${input.workflowId} operation display node "${node.id}" cannot declare a transform`);
    }
    if (node.kind === "branch" && (node.outcomes === undefined || node.outcomes.length === 0)) {
      throw new Error(`workflow ${input.workflowId} operation display branch "${node.id}" requires outcome cases`);
    }
    nodes.set(node.id, node);
    validateWorkflowOutcomes(node.outcomes, `workflow ${input.workflowId} operation display node "${node.id}"`, input.input, entries, transforms);
    for (const child of node.children ?? []) visitNode(child);
    visiting.delete(node);
  };
  for (const node of declaration.presentation) visitNode(node);
  for (const invocation of invocationIds) {
    if (!invocationNodes.has(invocation)) throw new Error(`workflow ${input.workflowId} operation display does not present invocation "${invocation}"`);
  }
  for (const [id, node] of nodes) {
    const targets: string[] = [];
    for (const outcome of node.outcomes ?? []) {
      if (outcome.continuation !== undefined) {
        if (!nodes.has(outcome.continuation)) {
          throw new Error(`workflow ${input.workflowId} operation display node "${id}" has an invalid branch target "${outcome.continuation}"`);
        }
        targets.push(outcome.continuation);
      }
    }
    continuationEdges.set(id, Object.freeze(targets));
  }
  for (const invocation of compiledInvocations) {
    for (const outcome of invocation.outcomes ?? []) {
      if (outcome.continuation !== undefined && !nodes.has(outcome.continuation)) {
        throw new Error(`workflow ${input.workflowId} invocation "${invocation.id}" has an invalid branch target "${outcome.continuation}"`);
      }
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visitContinuation = (id: string, path: readonly string[]): void => {
    if (visited.has(id)) return;
    if (active.has(id)) throw new Error(`workflow ${input.workflowId} operation display continuation cycle: ${[...path, id].join(" -> ")}`);
    active.add(id);
    for (const target of continuationEdges.get(id) ?? []) visitContinuation(target, [...path, id]);
    active.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visitContinuation(id, []);

  const resultPaths = new Set<string>();
  for (const binding of input.result?.sources ?? []) {
    if (resultPaths.has(binding.path)) throw new Error(`workflow operation display repeats result source "${binding.path}"`);
    resultPaths.add(binding.path);
    fieldPath(input.result!.schema, binding.path, undefined, "workflow result source");
    const sources = binding.source.kind === "derived" ? binding.source.inputs.map((item) => item.source) : [binding.source];
    if (binding.source.kind === "derived" && (sources.length === 0 || new Set(binding.source.inputs.map((item) => item.id)).size !== sources.length)) throw new Error("workflow result lineage inputs must be nonempty and unique");
    for (const source of sources) {
      if (!input.result!.dependsOn.includes(source.entryId)) throw new Error("workflow result source is not a declared result dependency");
      validateWorkflowReference(source, "workflow result source", input.input, entries, transforms);
    }
  }
  const compiled: CompleteWorkflowOperationDisplay = Object.freeze({
    capability: "complete",
    version: OPERATION_DISPLAY_FORMAT_VERSION,
    ...(input.result?.sources === undefined ? {} : { resultSources: Object.freeze([...input.result.sources]) }),
    transforms: Object.freeze([...(declaration.transforms ?? [])]),
    invocations: Object.freeze(compiledInvocations),
    presentation: freezePresentation(declaration.presentation),
    execution: Object.freeze(input.entries.map((entry) => Object.freeze({
      entryId: entry.id,
      dependsOn: Object.freeze([...entry.dependsOn]),
    }))),
  });
  COMPILED_COMPLETE_DISPLAYS.add(compiled);
  return compiled;
}
