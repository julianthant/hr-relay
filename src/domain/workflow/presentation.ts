/**
 * The plain-data presentation/policy vocabularies a descriptor carries.
 *
 * Ref dashboard-surfaces §3.2 contributes the semantics; ref workflow-model §1.1 owns the descriptor field
 * that holds them. Every one of these is a CLOSED union, never a free string:
 * that is what turns each of today's hand-maintained parallel registries
 * (`WORKFLOW_ICONS`, `INSTANCE_LABELS`, `queue-row-status-index.ts`, the step
 * label switches) into a projection of the descriptor set with a coverage guard
 * instead of a list that fails at runtime (ref workflow-model §1.3).
 */
import { z } from "zod";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { NodeIdSchema, TaskIdSchema } from "../ids.js";

/**
 * Compile-time icon union. The dashboard's icon map is
 * `Record<IconName, LucideIcon>` and exhaustive, so a name added here without a
 * component fails to compile rather than rendering a hole.
 */
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

/**
 * The workflow's SHORT CODE — the operator-facing handle that fits in a column
 * (ref workflow-model §1.1, D242).
 *
 * It has exactly ONE declaration site (the descriptor) and two consumers, and
 * that is the whole point of this schema existing in `presentation.ts` rather
 * than as three regexes in three files:
 *
 *  - `deriveTraceId` composes `<code>-<HHMMSS>-<runId4>`, so the code is
 *    already stamped on every run, span, note and ledger line this program has
 *    ever written; and
 *  - the archive index, the Activity per-workflow table and the version
 *    registry print it beside the label, because at 800 rows `Separation
 *    Documents v1` costs the name column real width and `sd v1` does not.
 *
 * Those two were built five months apart and the second one nearly minted a
 * SECOND code, which would have given one workflow two short names — the
 * operator reading `sd-141203-9a1c` in a log and `sep v1` in the archive would
 * have had nothing telling them the two name the same thing. One declaration,
 * two readers.
 *
 * Two to four LOWERCASE LETTERS. Letters only, because a code sits directly in
 * front of a digit run in every trace id and `s1-000619-4ebf` reads as one
 * opaque blob rather than a workflow followed by a time. Two is enough for
 * everything registered today; four is the room a later collision needs, and
 * widening the bound now costs nothing while widening it after a stored trace
 * id exists costs a reader that must accept both shapes forever.
 *
 * UNIQUENESS is NOT checkable here — one code cannot see its siblings — and it
 * is not optional either: two workflows sharing `sd` would make a trace prefix
 * ambiguous and an archive row lie about which workflow it belongs to. The
 * composition root refuses a duplicate at load (`auditWorkflowCodes`), which is
 * the one place the whole registry is in scope.
 */
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

/**
 * Verdict mappings replace the legacy `statusExtensions` function registry:
 * person-lookup's `notFound` becomes plain data over `span.ended.verdict`, and
 * `SpanEnded` may emit only this descriptor-derived union (ref dashboard-surfaces §3.2).
 */
/**
 * Deliberately unbranded: a verdict key is authored as a literal in the
 * descriptor and validated there, and there is no other id kind a bare verdict
 * key could be confused with. Branding would only add a `parse` call to every
 * authoring site without closing a hole.
 */
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

/* ── command / action policy (ref dashboard-surfaces §2.4) ───────────────────────────────── */

export const EnqueuePolicySchema = z.enum(["reject-active", "supersede-active", "allow-parallel"]);
export type EnqueuePolicy = z.infer<typeof EnqueuePolicySchema>;

export const CommandActionIdSchema = z.enum([
  "retry", "cancel", "bump", "rename",
  "edit-checkpoint", "resolve-write-present", "resolve-write-absent",
]);
export const NavigationActionIdSchema = z.enum(["open-review", "open-evidence"]);
export const WorkflowActionIdSchema = z.enum([
  ...CommandActionIdSchema.options,
  ...NavigationActionIdSchema.options,
]);
export type WorkflowActionId = z.infer<typeof WorkflowActionIdSchema>;

/**
 * A condition is a closed rule over projected run state, never a callback: the
 * client must be able to decide whether an action is offered without executing
 * descriptor code.
 */
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

/** The action set every ordinary workflow gets; a descriptor opts into more, never fewer by accident. */
export const STANDARD_WORKFLOW_ACTIONS: WorkflowActionPolicy = Object.freeze(
  WorkflowActionPolicySchema.parse({
    enabled: ["retry", "cancel", "bump", "rename"],
  }),
);

/**
 * Ref data-intake-and-edit-data §6.2 (D166): the descriptor names EXACTLY which node+field paths an
 * operator may correct. The default is read-only — `true` keeps the Data
 * section visible with ZERO editable fields, never "all checkpoint JSON".
 *
 * `label` is what the Context rail prints over the editable value (2i-C). A
 * field a descriptor declares correctable is, by that declaration, a field
 * the operator sees raw — never declare a secret-bearing path here.
 */
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
  /** Checkpoint fields may be corrected from the Context rail (ref data-intake-and-edit-data §6). */
  editData: EditDataPolicySchema,
  /** How this workflow's children render when it delegates. */
  delegationDisplay: z.enum(["inline", "linked", "hidden-unless-failed"]).optional(),
});
export type WorkflowCapabilities = z.infer<typeof WorkflowCapabilitiesSchema>;

/* ── projections over node outputs ───────────────────────────────────────── */

/**
 * The declared patch set: ref dashboard-surfaces validates every `SpanPatched` key against this
 * list, and the coverage guard proves every `fieldPath` exists in the producing
 * node's exact output schema.
 */
export const DetailProjectionSpecRuntimeSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "detail key must be kebab-case"),
  label: z.string().min(1),
  source: z.strictObject({
    nodeId: NodeIdSchema,
    fieldPath: ContractFieldPathSchema,
  }),
  display: z.enum(["text", "eid", "date", "count", "badge"]),
});
export type DetailProjectionSpecRuntime = z.infer<typeof DetailProjectionSpecRuntimeSchema>;

/**
 * WHERE this workflow's own run resolves the SUBJECT'S DISPLAY NAME (ref dashboard-surfaces
 * §1.2 — the queue row title).
 *
 * `inputSubject` above says what KIND of thing a run is about (an eid, a name,
 * a document). This says the one node+leaf at which the run's own reads settle
 * that thing's NAME, so the queue row can stop calling a person by the document
 * number the operator started from. The two are independent: a workflow started
 * from a document number has `inputSubject: "document"` and may still resolve a
 * person's name three nodes in.
 *
 * It is a DECLARATION, never a sniff. Nothing anywhere may guess which leaf
 * holds a subject's name from its field name, its shape, or its workflow id —
 * a title is the one column an operator scans before acting on a real HR
 * transaction, and a heuristic that is right for eight workflows and wrong for
 * the ninth prints the wrong person's name in the place the eye trusts most.
 *
 * A descriptor that declares NOTHING here is a valid, complete state: its rows
 * keep the title its `presentation.title` composed from the start input,
 * forever. That is the honest answer for a workflow whose subject IS the
 * document, and for one whose start input already carries the person's name.
 *
 * The path is validated `offers` rather than `owns`, because a resolved subject
 * name routinely lives on ONE ARM of a present/absent union — which is exactly
 * the "not resolved yet / not resolved at all" state the projection reads as
 * *keep the current title*.
 */
export const SubjectProjectionSpecRuntimeSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ContractFieldPathSchema,
});
export type SubjectProjectionSpecRuntime = z.infer<typeof SubjectProjectionSpecRuntimeSchema>;

/* ── timeline categories (ref dashboard-surfaces, D225) ──────────────────────────────────── */

/**
 * D225 (operator ruling, 2026-08-18): the run-detail timeline is CATEGORICAL.
 * A workflow with a large graph does not print one segment per node — the
 * composed separations graph drew eighteen truncated stubs — it declares the
 * categories an operator actually thinks in ("Kuali extraction", "Identity
 * check", …), and every node folds into exactly one of them.
 *
 * The declaration is EXHAUSTIVE by rule: if a descriptor declares categories at
 * all, every node in its graph must appear in exactly one — a node left out
 * would silently vanish from the one surface that says what a run does. A
 * descriptor that declares nothing gets the derived default of one category
 * per node, which is the honest shape for a small graph.
 */
/**
 * D265 — a timeline category's STABLE ANCHOR, distinct from its display label.
 *
 * The operator's ruling makes the workflow tree the rail and the timeline: a
 * composition's step folder IS one declared category, the folder name IS this
 * key, and a `chunk-harness` names the step it proves by this key
 * (`src/domain/workflow/module-role.ts`). A label is prose an operator reads
 * and an author may re-word; a key is an identifier a folder name and a role
 * declaration both have to spell the same way, which is why it is kebab-case
 * and its own field rather than a slugified label — slugifying "Kuali
 * extraction" into an anchor would make re-wording the label silently move
 * every reference to the step.
 */
export const TimelineCategoryKeySchema = z.string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "timeline category key must be kebab-case");
export type TimelineCategoryKey = z.infer<typeof TimelineCategoryKeySchema>;

/**
 * D265 §1.2.2 rule 2 — the (key, label) pair a STEP FOLDER declares once.
 *
 * The folder is the category, so the two facts that name it — the kebab-case
 * anchor the folder is called and the operator-approved prose the timeline
 * prints — are declared in the folder's own `step.ts` and read from there by
 * everything that needs them: the composition's `timeline` entry, which adds
 * only `nodes`, and the harness module's `chunk-harness.step`. One declaration
 * is what keeps the folder name, the declared category and the harness's claim
 * from being three strings that merely agree today.
 */
export const WorkflowStepSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const TimelineCategorySpecSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
  nodes: z.array(NodeIdSchema).min(1),
});
export type TimelineCategorySpec = z.infer<typeof TimelineCategorySpecSchema>;

/**
 * The factory-derived, frozen form every consumer reads: member node ids carry
 * their display labels so a projection never re-derives `labelOf`.
 */
export const TimelineCategoryProjectionSchema = z.strictObject({
  key: TimelineCategoryKeySchema,
  label: z.string().min(1),
  nodes: z.array(z.strictObject({ id: NodeIdSchema, label: z.string().min(1) })).min(1),
});
export type TimelineCategoryProjection = z.infer<typeof TimelineCategoryProjectionSchema>;

/**
 * D229 — the descriptor's own prose about one node.
 *
 * The explorer's ⓘ opens with the descriptor's sentence about the workflow and
 * about each node. That sentence is DATA the descriptor authors, not code the
 * surface decompiles (ref operator-trust §5.9) — which is why it lives here beside the
 * timeline rather than being inferred from a label, a contract title, or a node
 * id. A one-sentence purpose says why the step exists; the label says what it
 * is called, and the two are not the same fact.
 */
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
  /**
   * The span key ref dashboard-surfaces validates `SpanEnded.name` against. A transaction owns
   * two child entries (`<node>/prepare`, `<node>/commit`) under one node id, so
   * the key — not the node id — is what is unique.
   */
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
