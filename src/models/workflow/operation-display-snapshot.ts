/** The durable, browser-safe projection of a compiler-produced complete operation display; it copies declaration semantics, never Zod schemas, derives, examples, or run values. */
import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "../../rules/validation/canonical-json.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  NodeIdSchema,
  ScreenIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import {
  ConfigurationReferenceKeySchema,
  OPERATION_ACTION_KINDS,
  OPERATION_DISPLAY_FORMAT_VERSION,
  OperationActionIdSchema,
  OperationFormIdSchema,
  OperationIdSchema,
  OperationOccurrenceSegmentSchema,
  OperationOutcomeIdSchema,
  OperationSessionIdSchema,
  OperationTransformIdSchema,
  OperationValueIdSchema,
  WORKFLOW_COMPOSITION_ACTION_KINDS,
  assertCompiledWorkflowOperationDisplay,
  type CompleteWorkflowOperationDisplay,
  type LogicalPageReference,
  type OperationOutcomeCase,
  type OperationTemplate,
  type OperationTemplateSegment,
  type TaskOperationAction,
  type TaskOperationDeclaration,
  type TemplateCondition,
  type WorkflowOperationDisplay,
  type WorkflowOperationPresentationNode,
  type WorkflowOutcomeCase,
  type WorkflowOutcomePredicate,
  type WorkflowValueReference,
} from "./operation-display.js";

/** Bump only when the serializable payload grammar changes. */
export const OPERATION_DISPLAY_SNAPSHOT_VERSION = 2 as const;

const FieldPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "operation field path must be a dot-delimited object path",
);
const AvailabilitySchema = z.enum(["owned", "offered"]);
const TemplateConditionKindSchema = z.enum(["is-present", "is-absent", "equals", "not-equals"]);
const PublicStaticComparisonLiteralSchema = z.union([
  z.null(),
  z.boolean(),
  z.string()
    .max(80)
    .regex(/^[a-z]+(?:-[a-z]+)*$/, "public comparison literal must be a kebab-case declaration symbol"),
]);

const SnapshotTemplateConditionSchema = z.strictObject({
  kind: TemplateConditionKindSchema,
  variable: OperationValueIdSchema,
  /** Public declaration grammar needed to render the archived conditional clause. */
  value: PublicStaticComparisonLiteralSchema.optional(),
  valueDigest: FingerprintSchema.optional(),
}).superRefine((condition, context) => {
  const compares = condition.kind === "equals" || condition.kind === "not-equals";
  const hasLiteral = condition.value !== undefined;
  const hasDigest = condition.valueDigest !== undefined;
  if (compares !== hasLiteral || compares !== hasDigest) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: compares
        ? "comparison condition requires a public literal and digest"
        : "presence condition cannot carry a comparison literal or digest",
    });
  } else if (hasLiteral && hasDigest && snapshotValueDigest(condition.value) !== condition.valueDigest) {
    context.addIssue({
      code: "custom",
      path: ["valueDigest"],
      message: "comparison condition literal digest does not match",
    });
  }
});
type SnapshotTemplateCondition = z.infer<typeof SnapshotTemplateConditionSchema>;

type SnapshotTemplateSegment =
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{ kind: "variable"; variable: string }>
  | Readonly<{ kind: "optional"; when: SnapshotTemplateCondition; segments: readonly SnapshotTemplateSegment[] }>;

const SnapshotTemplateSegmentSchema: z.ZodType<SnapshotTemplateSegment> = z.lazy(() => z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({ kind: z.literal("variable"), variable: OperationValueIdSchema }),
  z.strictObject({
    kind: z.literal("optional"),
    when: SnapshotTemplateConditionSchema,
    segments: z.array(SnapshotTemplateSegmentSchema).min(1),
  }),
]));

const SnapshotPageSchema = z.strictObject({
  screen: ScreenIdSchema,
  form: OperationFormIdSchema.optional(),
});

const SnapshotTaskValueSlotSchema = z.strictObject({
  id: OperationValueIdSchema,
  presentation: z.enum(["local-operator", "withhold"]).optional(),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("contract-input"), path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
    z.strictObject({ kind: z.literal("contract-output"), path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  ]),
});

const SnapshotTemplateSchema = z.strictObject({
  id: OperationIdSchema,
  variables: z.array(z.strictObject({ id: OperationValueIdSchema, slot: OperationValueIdSchema })),
  segments: z.array(SnapshotTemplateSegmentSchema).min(1),
  join: z.strictObject({ separator: z.string(), trim: z.enum(["none", "segments", "outer"]) }),
});

const SnapshotTaskOutcomeCaseSchema = z.strictObject({
  id: OperationOutcomeIdSchema,
  label: z.string().min(1),
  when: SnapshotTemplateConditionSchema,
  continuation: OperationActionIdSchema.optional(),
});

type SnapshotTaskAction = Readonly<{
  id: string;
  kind: (typeof OPERATION_ACTION_KINDS)[number];
  label?: string;
  target?: string;
  valueSlot?: string;
  templateId?: string;
  transform?: string;
  page?: z.infer<typeof SnapshotPageSchema>;
  continuedFrom?: string;
  confirmationActionId?: string;
  outcomes?: readonly z.infer<typeof SnapshotTaskOutcomeCaseSchema>[];
  children?: readonly SnapshotTaskAction[];
}>;

const SnapshotTaskActionSchema: z.ZodType<SnapshotTaskAction> = z.lazy(() => z.strictObject({
  id: OperationActionIdSchema,
  kind: z.enum(OPERATION_ACTION_KINDS),
  label: z.string().optional(),
  target: z.string().optional(),
  valueSlot: OperationValueIdSchema.optional(),
  templateId: OperationIdSchema.optional(),
  transform: OperationTransformIdSchema.optional(),
  page: SnapshotPageSchema.optional(),
  continuedFrom: OperationActionIdSchema.optional(),
  confirmationActionId: OperationActionIdSchema.optional(),
  outcomes: z.array(SnapshotTaskOutcomeCaseSchema).optional(),
  children: z.array(SnapshotTaskActionSchema).min(1).optional(),
}));

const SnapshotTaskOperationSchema = z.strictObject({
  version: z.literal(OPERATION_DISPLAY_FORMAT_VERSION),
  id: OperationIdSchema,
  system: z.union([BrowserSystemIdSchema, z.literal("local")]),
  session: z.strictObject({
    kind: z.enum(["browser", "local"]),
    id: OperationSessionIdSchema,
    system: BrowserSystemIdSchema.optional(),
  }),
  page: SnapshotPageSchema.optional(),
  values: z.array(SnapshotTaskValueSlotSchema),
  templates: z.array(SnapshotTemplateSchema),
  transforms: z.array(z.strictObject({
    id: OperationTransformIdSchema,
    inputSchemaHash: FingerprintSchema,
    outputSchemaHash: FingerprintSchema,
  })),
  actions: z.array(SnapshotTaskActionSchema).min(1),
}).superRefine((operation, context) => {
  const templates = new Set<string>(operation.templates.map((template) => template.id));
  const visit = (actions: readonly SnapshotTaskAction[], path: (string | number)[]): void => {
    for (const [index, action] of actions.entries()) {
      if (action.templateId !== undefined && (action.kind !== "fill-field" || !templates.has(action.templateId))) {
        context.addIssue({ code: "custom", path: [...path, index, "templateId"], message: "Fill template must reference an exact declared template on a fill-field action" });
      }
      if (action.children !== undefined) visit(action.children, [...path, index, "children"]);
    }
  };
  visit(operation.actions, ["actions"]);
});
type SnapshotTaskOperation = z.infer<typeof SnapshotTaskOperationSchema>;

export const SnapshotWorkflowValueReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run-input"), path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  z.strictObject({ kind: z.literal("configuration"), key: ConfigurationReferenceKeySchema, schemaHash: FingerprintSchema }),
  /** A static constant is bound by digest rather than copied into a durable display payload. */
  z.strictObject({ kind: z.literal("constant"), valueDigest: FingerprintSchema }),
  z.strictObject({ kind: z.literal("task-output"), entryId: NodeIdSchema, path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  z.strictObject({ kind: z.literal("transformation"), transformId: OperationTransformIdSchema, path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
  z.strictObject({ kind: z.literal("child-output"), entryId: NodeIdSchema, path: FieldPathSchema, availability: AvailabilitySchema.optional() }),
]);
type SnapshotWorkflowValueReference = z.infer<typeof SnapshotWorkflowValueReferenceSchema>;

const SnapshotWorkflowOutcomePredicateSchema = z.strictObject({
  kind: TemplateConditionKindSchema,
  value: SnapshotWorkflowValueReferenceSchema,
  /** Public declaration grammar needed to render the archived conditional clause. */
  expected: PublicStaticComparisonLiteralSchema.optional(),
  expectedDigest: FingerprintSchema.optional(),
}).superRefine((predicate, context) => {
  const compares = predicate.kind === "equals" || predicate.kind === "not-equals";
  const hasLiteral = predicate.expected !== undefined;
  const hasDigest = predicate.expectedDigest !== undefined;
  if (compares !== hasLiteral || compares !== hasDigest) {
    context.addIssue({
      code: "custom",
      path: ["expected"],
      message: compares
        ? "comparison predicate requires a public literal and digest"
        : "presence predicate cannot carry a comparison literal or digest",
    });
  } else if (hasLiteral && hasDigest && snapshotValueDigest(predicate.expected) !== predicate.expectedDigest) {
    context.addIssue({
      code: "custom",
      path: ["expectedDigest"],
      message: "comparison predicate literal digest does not match",
    });
  }
});
type SnapshotWorkflowOutcomePredicate = z.infer<typeof SnapshotWorkflowOutcomePredicateSchema>;

const SnapshotWorkflowOutcomeCaseSchema = z.strictObject({
  id: OperationOutcomeIdSchema,
  label: z.string().min(1),
  when: SnapshotWorkflowOutcomePredicateSchema,
  continuation: OperationActionIdSchema.optional(),
});

const SnapshotWorkflowTransformSchema = z.strictObject({
  id: OperationTransformIdSchema,
  inputSchemaHash: FingerprintSchema,
  outputSchemaHash: FingerprintSchema,
  inputs: z.array(z.strictObject({
    id: OperationValueIdSchema,
    inputPath: FieldPathSchema,
    value: SnapshotWorkflowValueReferenceSchema,
  })),
});

const SnapshotInvocationSchema = z.strictObject({
  label: z.string().min(1).optional(),
  id: OperationIdSchema,
  entryId: NodeIdSchema,
  taskId: TaskIdSchema,
  contractRole: z.enum(["task", "probe", "prepare", "commit", "verify"]),
  occurrencePath: z.array(OperationOccurrenceSegmentSchema).min(1),
  bindings: z.array(z.strictObject({ slot: OperationValueIdSchema, value: SnapshotWorkflowValueReferenceSchema })),
  outcomes: z.array(SnapshotWorkflowOutcomeCaseSchema),
  operation: SnapshotTaskOperationSchema,
});

type SnapshotPresentationNode = Readonly<{
  id: string;
  kind: "operation" | (typeof WORKFLOW_COMPOSITION_ACTION_KINDS)[number];
  invocationId?: string;
  entryId?: string;
  targetWorkflowId?: string;
  transform?: string;
  outcomes?: readonly z.infer<typeof SnapshotWorkflowOutcomeCaseSchema>[];
  children?: readonly SnapshotPresentationNode[];
}>;

const SnapshotPresentationNodeSchema: z.ZodType<SnapshotPresentationNode> = z.lazy(() => z.strictObject({
  id: OperationActionIdSchema,
  kind: z.union([z.literal("operation"), z.enum(WORKFLOW_COMPOSITION_ACTION_KINDS)]),
  invocationId: OperationIdSchema.optional(),
  entryId: NodeIdSchema.optional(),
  targetWorkflowId: WorkflowIdSchema.optional(),
  transform: OperationTransformIdSchema.optional(),
  outcomes: z.array(SnapshotWorkflowOutcomeCaseSchema).optional(),
  children: z.array(SnapshotPresentationNodeSchema).min(1).optional(),
}));

const SnapshotWorkflowResultOutputReferenceSchema = z.strictObject({
  kind: z.enum(["task-output", "child-output"]),
  entryId: NodeIdSchema,
  path: FieldPathSchema,
});

const SnapshotWorkflowResultSourceSchema = z.strictObject({
  path: FieldPathSchema,
  source: z.union([
    SnapshotWorkflowResultOutputReferenceSchema,
    z.strictObject({
      kind: z.literal("derived"),
      inputs: z.array(z.strictObject({
        id: OperationValueIdSchema,
        source: SnapshotWorkflowResultOutputReferenceSchema,
      })).min(1),
    }),
  ]),
});

/** A content-addressed, strict JSON document for the immutable run envelope, with no executable display code, so an archived run can be read without today's descriptor module. */
export const WorkflowOperationDisplaySnapshotSchema = z.strictObject({
  capability: z.literal("complete"),
  declarationVersion: z.literal(OPERATION_DISPLAY_FORMAT_VERSION),
  snapshotVersion: z.literal(OPERATION_DISPLAY_SNAPSHOT_VERSION),
  workflowId: WorkflowIdSchema,
  definitionFingerprint: FingerprintSchema,
  transforms: z.array(SnapshotWorkflowTransformSchema),
  resultSources: z.array(SnapshotWorkflowResultSourceSchema).optional(),
  invocations: z.array(SnapshotInvocationSchema),
  presentation: z.array(SnapshotPresentationNodeSchema),
  execution: z.array(z.strictObject({ entryId: NodeIdSchema, dependsOn: z.array(NodeIdSchema) })),
  contentDigest: FingerprintSchema,
});
export type WorkflowOperationDisplaySnapshot = z.infer<typeof WorkflowOperationDisplaySnapshotSchema>;

export interface OperationDisplaySnapshotIdentity {
  readonly workflowId: string;
  readonly definitionFingerprint: string;
}

function snapshotValueDigest(value: unknown): z.infer<typeof FingerprintSchema> {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:operation-display-static-value:v1\0${canonicalJsonStringify(JsonValueSchema.parse(value))}`,
  ));
}

function snapshotTemplateCondition(condition: TemplateCondition): SnapshotTemplateCondition {
  return SnapshotTemplateConditionSchema.parse({
    kind: condition.kind,
    variable: condition.variable,
    ...(condition.value === undefined ? {} : {
      value: PublicStaticComparisonLiteralSchema.parse(condition.value),
      valueDigest: snapshotValueDigest(condition.value),
    }),
  });
}

function snapshotTemplateSegment(segment: OperationTemplateSegment): SnapshotTemplateSegment {
  if (segment.kind === "literal") return { kind: "literal", value: segment.value };
  if (segment.kind === "variable") return { kind: "variable", variable: segment.variable };
  return {
    kind: "optional",
    when: snapshotTemplateCondition(segment.when),
    segments: segment.segments.map(snapshotTemplateSegment),
  };
}

function snapshotTemplate(template: OperationTemplate): z.infer<typeof SnapshotTemplateSchema> {
  return SnapshotTemplateSchema.parse({
    id: template.id,
    variables: template.variables.map((variable) => ({ id: variable.id, slot: variable.slot })),
    segments: template.segments.map(snapshotTemplateSegment),
    join: template.join,
  });
}

function snapshotTaskOutcome(outcome: OperationOutcomeCase): z.infer<typeof SnapshotTaskOutcomeCaseSchema> {
  return SnapshotTaskOutcomeCaseSchema.parse({
    id: outcome.id,
    label: outcome.label,
    when: snapshotTemplateCondition(outcome.when),
    ...(outcome.continuation === undefined ? {} : { continuation: outcome.continuation }),
  });
}

function snapshotPage(page: LogicalPageReference): z.infer<typeof SnapshotPageSchema> {
  return SnapshotPageSchema.parse(page);
}

function snapshotTaskAction(action: TaskOperationAction): SnapshotTaskAction {
  return SnapshotTaskActionSchema.parse({
    id: action.id,
    kind: action.kind,
    ...(action.label === undefined ? {} : { label: action.label }),
    ...(action.target === undefined ? {} : { target: action.target }),
    ...(action.valueSlot === undefined ? {} : { valueSlot: action.valueSlot }),
    ...(action.templateId === undefined ? {} : { templateId: action.templateId }),
    ...(action.transform === undefined ? {} : { transform: action.transform }),
    ...(action.page === undefined ? {} : { page: snapshotPage(action.page) }),
    ...(action.confirmationActionId === undefined ? {} : { confirmationActionId: action.confirmationActionId }),
    ...(action.continuedFrom === undefined ? {} : { continuedFrom: action.continuedFrom }),
    ...(action.outcomes === undefined ? {} : { outcomes: action.outcomes.map(snapshotTaskOutcome) }),
    ...(action.children === undefined ? {} : { children: action.children.map(snapshotTaskAction) }),
  });
}

function snapshotTaskOperation(operation: TaskOperationDeclaration): SnapshotTaskOperation {
  return SnapshotTaskOperationSchema.parse({
    version: operation.version,
    id: operation.id,
    system: operation.system,
    session: operation.session,
    ...(operation.page === undefined ? {} : { page: snapshotPage(operation.page) }),
    values: (operation.values ?? []).map((slot) => ({ id: slot.id, source: slot.source, ...(slot.presentation === undefined ? {} : { presentation: slot.presentation }) })),
    templates: (operation.templates ?? []).map(snapshotTemplate),
    transforms: (operation.transforms ?? []).map((transform) => ({
      id: transform.id,
      inputSchemaHash: deriveSchemaHash(transform.input, "input"),
      outputSchemaHash: deriveSchemaHash(transform.output, "output"),
    })),
    actions: operation.actions.map(snapshotTaskAction),
  });
}

function snapshotWorkflowReference(reference: WorkflowValueReference): SnapshotWorkflowValueReference {
  switch (reference.kind) {
    case "run-input":
      return SnapshotWorkflowValueReferenceSchema.parse(reference);
    case "configuration":
      return SnapshotWorkflowValueReferenceSchema.parse({
        kind: reference.kind,
        key: reference.key,
        schemaHash: deriveSchemaHash(reference.schema, "input"),
      });
    case "constant":
      return SnapshotWorkflowValueReferenceSchema.parse({ kind: reference.kind, valueDigest: snapshotValueDigest(reference.value) });
    case "task-output":
    case "transformation":
    case "child-output":
      return SnapshotWorkflowValueReferenceSchema.parse(reference);
  }
}

function snapshotWorkflowPredicate(predicate: WorkflowOutcomePredicate): SnapshotWorkflowOutcomePredicate {
  return SnapshotWorkflowOutcomePredicateSchema.parse({
    kind: predicate.kind,
    value: snapshotWorkflowReference(predicate.value),
    ...(predicate.expected === undefined ? {} : {
      expected: PublicStaticComparisonLiteralSchema.parse(predicate.expected),
      expectedDigest: snapshotValueDigest(predicate.expected),
    }),
  });
}

function snapshotWorkflowOutcome(outcome: WorkflowOutcomeCase): z.infer<typeof SnapshotWorkflowOutcomeCaseSchema> {
  return SnapshotWorkflowOutcomeCaseSchema.parse({
    id: outcome.id,
    label: outcome.label,
    when: snapshotWorkflowPredicate(outcome.when),
    ...(outcome.continuation === undefined ? {} : { continuation: outcome.continuation }),
  });
}

function snapshotPresentation(node: WorkflowOperationPresentationNode): SnapshotPresentationNode {
  return SnapshotPresentationNodeSchema.parse({
    id: node.id,
    kind: node.kind,
    ...(node.invocationId === undefined ? {} : { invocationId: node.invocationId }),
    ...(node.entryId === undefined ? {} : { entryId: node.entryId }),
    ...(node.targetWorkflowId === undefined ? {} : { targetWorkflowId: node.targetWorkflowId }),
    ...(node.transform === undefined ? {} : { transform: node.transform }),
    ...(node.outcomes === undefined ? {} : { outcomes: node.outcomes.map(snapshotWorkflowOutcome) }),
    ...(node.children === undefined ? {} : { children: node.children.map(snapshotPresentation) }),
  });
}

function displaySnapshotDigest(snapshot: Omit<WorkflowOperationDisplaySnapshot, "contentDigest">): z.infer<typeof FingerprintSchema> {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:operation-display-snapshot:v2\0${canonicalJsonStringify(snapshot)}`,
  ));
}

/** Freeze a complete compiler projection for a newly minted run; legacy displays deliberately return no payload. */
export function freezeWorkflowOperationDisplaySnapshot(input: Readonly<{
  workflowId: string;
  definitionFingerprint: string;
  display: WorkflowOperationDisplay | undefined;
}>): WorkflowOperationDisplaySnapshot | undefined {
  const workflowId = WorkflowIdSchema.parse(input.workflowId);
  const definitionFingerprint = FingerprintSchema.parse(input.definitionFingerprint);
  if (input.display === undefined || input.display.capability === "legacy") return undefined;
  assertCompiledWorkflowOperationDisplay(input.display);
  const display: CompleteWorkflowOperationDisplay = input.display;
  const payload = {
    capability: "complete" as const,
    declarationVersion: OPERATION_DISPLAY_FORMAT_VERSION,
    snapshotVersion: OPERATION_DISPLAY_SNAPSHOT_VERSION,
    workflowId,
    definitionFingerprint,
    ...(display.resultSources === undefined ? {} : {
      resultSources: z.array(SnapshotWorkflowResultSourceSchema).parse(display.resultSources),
    }),
    transforms: display.transforms.map((transform) => SnapshotWorkflowTransformSchema.parse({
      id: transform.id,
      inputSchemaHash: deriveSchemaHash(transform.input, "input"),
      outputSchemaHash: deriveSchemaHash(transform.output, "output"),
      inputs: transform.inputs.map((source) => ({
        id: source.id,
        inputPath: source.inputPath,
        value: snapshotWorkflowReference(source.value),
      })),
    })),
    invocations: display.invocations.map((invocation) => SnapshotInvocationSchema.parse({
      id: invocation.id,
      entryId: invocation.entryId,
      taskId: invocation.taskId,
      ...(invocation.label === undefined ? {} : { label: invocation.label }),
      contractRole: invocation.contractRole,
      occurrencePath: invocation.occurrencePath,
      bindings: (invocation.bindings ?? []).map((binding) => ({
        slot: binding.slot,
        value: snapshotWorkflowReference(binding.value),
      })),
      outcomes: (invocation.outcomes ?? []).map(snapshotWorkflowOutcome),
      operation: snapshotTaskOperation(invocation.operation),
    })),
    presentation: display.presentation.map(snapshotPresentation),
    execution: display.execution.map((entry) => ({
      entryId: NodeIdSchema.parse(entry.entryId),
      dependsOn: entry.dependsOn.map((dependency) => NodeIdSchema.parse(dependency)),
    })),
  };
  return WorkflowOperationDisplaySnapshotSchema.parse({
    ...payload,
    contentDigest: displaySnapshotDigest(payload),
  });
}

/** Parse and integrity-check a stored complete snapshot; an absent payload is a named historical-integrity failure rather than a fallback to today's registry. */
export function requireWorkflowOperationDisplaySnapshot(
  stored: unknown,
  identity: OperationDisplaySnapshotIdentity,
): WorkflowOperationDisplaySnapshot {
  const workflowId = WorkflowIdSchema.parse(identity.workflowId);
  const definitionFingerprint = FingerprintSchema.parse(identity.definitionFingerprint);
  if (stored === undefined) {
    throw new Error(`complete run ${workflowId} is missing its frozen operation display snapshot`);
  }
  const parsed = WorkflowOperationDisplaySnapshotSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(`complete run ${workflowId} has a corrupt frozen operation display snapshot`);
  }
  const snapshot = parsed.data;
  if (snapshot.workflowId !== workflowId || snapshot.definitionFingerprint !== definitionFingerprint) {
    throw new Error(`complete run ${workflowId} frozen operation display snapshot identity does not match its envelope`);
  }
  const { contentDigest, ...payload } = snapshot;
  if (contentDigest !== displaySnapshotDigest(payload)) {
    throw new Error(`complete run ${workflowId} has a corrupt frozen operation display snapshot digest`);
  }
  return snapshot;
}
