/** The plain-data presentation/policy vocabularies a descriptor carries; every one of these is a CLOSED union, never a free string. */
import { z } from "zod";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { NodeIdSchema, slugSchema, TaskIdSchema } from "../../rules/identity/ids.js";

/** Compile-time icon union; the dashboard's icon map is exhaustive, so a name added here without a component fails to compile rather than rendering a hole. */
export const ICON_NAMES = [
  "Search", "Users", "UserMinus", "UserPlus", "FileScan", "FileText",
  "ClipboardCheck", "Upload", "CalendarClock", "ShieldCheck", "Building2",
] as const;
export const IconNameSchema = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconNameSchema>;

export const WorkflowCategorySchema = z.enum([
  "search", "onboarding", "separation", "documents", "timekeeping", "operations",
]);
export type WorkflowCategory = z.infer<typeof WorkflowCategorySchema>;

/** The workflow's SHORT CODE — the operator-facing handle that fits in a column, with exactly ONE declaration site. */
export const WorkflowCodeSchema = z.string().regex(
  /^[a-z]{2,4}$/,
  "workflow code must be two to four lowercase letters",
);
export type WorkflowCode = z.infer<typeof WorkflowCodeSchema>;

/** What a run is *about* — drives the subject column and the delegation subject. */
export const InputSubjectSchema = z.enum(["eid", "name", "email", "document", "none"]);
export type InputSubject = z.infer<typeof InputSubjectSchema>;

/** Ref dashboard-surfaces's queue row model. `by-input` defers the shape to a per-run resolution. */
export const RowShapeSchema = z.enum(["single", "preview", "operation", "operation-member"]);
export type RowShape = z.infer<typeof RowShapeSchema>;

export const SurfaceShapeSchema = z.union([
  z.strictObject({ shape: RowShapeSchema }),
  z.strictObject({ resolveShape: z.literal("by-input") }),
]);
export type SurfaceShape = z.infer<typeof SurfaceShapeSchema>;

/** Verdict mappings as plain data over `span.ended.verdict`, and the run-span arm may emit only this descriptor-derived union. */
/** Deliberately unbranded: a verdict key is authored as a literal in the descriptor and validated there, and branding would add a `parse` call to every site without closing a hole. */
export const VerdictKeySchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "verdict key must be kebab-case",
);
export type VerdictKey = z.infer<typeof VerdictKeySchema>;

export const VerdictDefinitionSchema = z.strictObject({
  key: VerdictKeySchema,
  label: z.string().min(1),
  tone: z.enum(["success", "warning", "danger", "neutral"]),
  /** Renders as an inline tag beside the status rather than replacing it. */
  tag: z.boolean().optional(),
});
export type VerdictDefinition = z.infer<typeof VerdictDefinitionSchema>;

/* ── command / action policy (ref dashboard-surfaces ) ───────────────────────────────── */

export const EnqueuePolicySchema = z.enum(["reject-active", "supersede-active", "allow-parallel"]);
export type EnqueuePolicy = z.infer<typeof EnqueuePolicySchema>;

export const CommandActionIdSchema = z.enum([
  "retry", "restart", "cancel", "bump", "rename", "delete",
  "edit-checkpoint", "resolve-write-present", "resolve-write-absent",
]);
export const NavigationActionIdSchema = z.enum(["open-review", "open-evidence"]);
export const WorkflowActionIdSchema = z.enum([
  ...CommandActionIdSchema.options,
  ...NavigationActionIdSchema.options,
]);
export type WorkflowActionId = z.infer<typeof WorkflowActionIdSchema>;

/** A condition is a closed rule over projected run state, never a callback: the client must be able to decide whether an action is offered without executing descriptor code. */
export const ActionConditionRuleSchema = z.strictObject({
  action: WorkflowActionIdSchema,
  requires: z.enum(["gate-open", "write-parked", "failed", "terminal", "has-review-panel"]),
});
export type ActionConditionRule = z.infer<typeof ActionConditionRuleSchema>;

export const WorkflowActionPolicySchema = z.strictObject({
  enabled: z.array(WorkflowActionIdSchema).min(1),
  conditions: z.array(ActionConditionRuleSchema).optional(),
});
export type WorkflowActionPolicy = z.infer<typeof WorkflowActionPolicySchema>;

/** The action set every ordinary workflow gets; a descriptor opts into more, never fewer by accident, and the narrowing that keeps `delete` safe is the kernel's own. */
export const STANDARD_WORKFLOW_ACTIONS: WorkflowActionPolicy = Object.freeze(
  WorkflowActionPolicySchema.parse({
    enabled: ["retry", "restart", "cancel", "bump", "rename", "delete"],
  }),
);

/** The descriptor names EXACTLY which node+field paths an operator may correct; the default is read-only — `true` keeps the Data section visible with ZERO editable fields. */
export const EditDataFieldSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ContractFieldPathSchema,
  label: z.string().min(1),
});
export const EditDataPolicySchema = z.union([
  z.boolean(),
  z.strictObject({ fields: z.array(EditDataFieldSchema).min(1) }),
]);

export const WorkflowCapabilitiesSchema = z.strictObject({
  /** A Review panel exists for this workflow's rows. */
  review: z.boolean(),
  /** Checkpoint fields may be corrected from the Context rail (ref data-intake-and-edit-data ). */
  editData: EditDataPolicySchema,
  /** How this workflow's children render when it delegates. */
  delegationDisplay: z.enum(["inline", "linked", "hidden-unless-failed"]).optional(),
});
export type WorkflowCapabilities = z.infer<typeof WorkflowCapabilitiesSchema>;

/* ── presentation projections ────────────────────────────────────────────── */

const DetailConditionSchema = z.strictObject({
  source: z.strictObject({ kind: z.enum(["input", "result"]), fieldPath: ContractFieldPathSchema }),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});
export type DetailCondition = z.input<typeof DetailConditionSchema>;

export const DetailProjectionSpecRuntimeSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "detail key must be kebab-case"),
  label: z.string().min(1),
  source: z.union([
    z.strictObject({ nodeId: NodeIdSchema, fieldPath: ContractFieldPathSchema }),
    z.strictObject({ kind: z.literal("result"), fieldPath: ContractFieldPathSchema }),
    z.strictObject({ kind: z.literal("input-title") }),
  ]),
  display: z.enum(["text", "eid", "date", "count", "badge"]),
  when: DetailConditionSchema.optional(),
});
export type DetailProjectionSpecRuntime = z.infer<typeof DetailProjectionSpecRuntimeSchema>;

/** Subject identity and the node/leaf supplying its display name are independent. */
export const SubjectProjectionSpecRuntimeSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ContractFieldPathSchema,
});
export type SubjectProjectionSpecRuntime = z.infer<typeof SubjectProjectionSpecRuntimeSchema>;

export const ResultSubtitleProjectionSchema = z.strictObject({
  fieldPath: ContractFieldPathSchema,
  display: z.literal("eid"),
});
export type ResultSubtitleProjection = z.input<typeof ResultSubtitleProjectionSchema>;

export const OutcomeProjectionSchema = z.strictObject({
  fieldPath: ContractFieldPathSchema,
  cases: z.array(z.strictObject({
    value: z.string().min(1),
    label: z.string().min(1),
    tone: z.enum(["success", "warning", "neutral"]),
  })).min(1),
}).superRefine((projection, context) => {
  if (new Set(projection.cases.map(entry => entry.value)).size !== projection.cases.length) {
    context.addIssue({ code: "custom", path: ["cases"], message: "outcome projection values must be unique" });
  }
});
export type OutcomeProjection = z.input<typeof OutcomeProjectionSchema>;

// Timeline categories must cover every node exactly once.
/** A timeline category's STABLE ANCHOR, distinct from its display label: a key is an identifier a folder name and a role declaration both have to spell the same way, which is why it is kebab-case. */
export const TimelineCategoryKeySchema = slugSchema("timeline category key must be a kebab-case slug");
export type TimelineCategoryKey = z.infer<typeof TimelineCategoryKeySchema>;

/** A folder's single key/label declaration binds category and harness claims. */
export const WorkflowStepSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** Preserve the folder's literal key through parsing and node-fragment types. */
export const WorkflowStepOfSchema = <const Key extends string>(key: Key) =>
  WorkflowStepSchema.extend({ key: TimelineCategoryKeySchema.and(z.literal(key)) });
export type WorkflowStepOf<Key extends string> = z.infer<ReturnType<typeof WorkflowStepOfSchema<Key>>>;

export const StartStepSelectionSchema = z.strictObject({ inputField: z.string().regex(/^[a-z][A-Za-z0-9]*$/u), selectedWhen: z.boolean() });

export const TimelineCategorySpecSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
  selection: StartStepSelectionSchema.optional(),
  nodes: z.array(NodeIdSchema).min(1),
});
export type TimelineCategorySpec = z.infer<typeof TimelineCategorySpecSchema>;

/** The factory-derived, frozen form every consumer reads: member node ids carry their display labels so a projection never re-derives it. */
export const TimelineCategoryProjectionSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
  selection: StartStepSelectionSchema.optional(),
  nodes: z.array(z.strictObject({ id: NodeIdSchema, label: z.string().min(1) })).min(1),
});
export type TimelineCategoryProjection = z.infer<typeof TimelineCategoryProjectionSchema>;

/** The descriptor's own prose about one node: DATA the descriptor authors, not code the surface decompiles, so it lives here rather than being inferred from a label or a contract title. */
export const NodePurposeSpecSchema = z.strictObject({
  nodeId: NodeIdSchema,
  purpose: z.string().min(1),
});
export type NodePurposeSpec = z.infer<typeof NodePurposeSpecSchema>;

/** Sinks are a closed infrastructure registry, deliberately keyed by sink kind, never by workflow. */
export const ArtifactSinkIdSchema = z.enum(["xlsx-retention"]);
export type ArtifactSinkId = z.infer<typeof ArtifactSinkIdSchema>;

export const DurableArtifactProjectionSpecRuntimeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "artifact projection id must be kebab-case"),
  source: z.strictObject({
    nodeId: NodeIdSchema,
    fieldPath: ContractFieldPathSchema,
  }),
  keyFields: z.array(ContractFieldPathSchema).min(1),
  sink: ArtifactSinkIdSchema,
  /** `blocking:false` is not legal — a durable projection that may silently lag is not durable. */
  blocking: z.literal(true),
});
export type DurableArtifactProjectionSpecRuntime =
  z.infer<typeof DurableArtifactProjectionSpecRuntimeSchema>;

/* ── derived projections ref dashboard-surfaces consumes ─────────────────────────────────── */

export const StepProjectionSchema = z.strictObject({
    /* The span key every run-span name is validated against; a transaction owns two child entries under one node id, so the key — not the node id — is what is unique. */
  key: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/(?:prepare|commit))?$/,
    "step key must be a node id with an optional /prepare or /commit arm",
  ),
  nodeId: NodeIdSchema,
  label: z.string().min(1),
  kind: z.enum(["task", "prepare", "commit", "branch", "parallel", "child-run", "gate"]),
  /** Present for task/prepare/commit entries; control nodes own no contract. */
  taskId: TaskIdSchema.optional(),
  conditional: z.boolean(),
});
export type StepProjection = z.infer<typeof StepProjectionSchema>;

export const GateProjectionDefinitionSchema = z.strictObject({
  nodeId: NodeIdSchema,
  label: z.string().min(1),
  statusKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/, "status key must be camelCase").optional(),
  resolvedBy: z.enum(["operator", "children-terminal", "external"]),
});
export type GateProjectionDefinition = z.infer<typeof GateProjectionDefinitionSchema>;
