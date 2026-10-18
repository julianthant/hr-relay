/** The read-only Workflow Explorer wire: a projection of registration state derived at the server from the one composition root, never a second authority. */
import { z } from "zod";
import { ContractSchemaLeafKindSchema } from "../validation/contract-boundary.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { ContractFieldPathSchema, TaskErrorCodeSchema } from "../task/task-contract.js";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  ObservationIdSchema,
  ProviderCapabilityIdSchema,
  ScenarioIdSchema,
  SourceSurfaceIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { SecretNameSchema } from "../config/secret-names.js";
import { SessionNeedSchema } from "../sessions/session.js";
import { NodeConditionSchema } from "../workflow/node-condition.js";
import { WorkflowModuleRoleSchema } from "../../workflow-kit/validation/module-role.js";
import {
  EditDataFieldSchema,
  EnqueuePolicySchema,
  IconNameSchema,
  TimelineCategoryKeySchema,
  WorkflowCategorySchema,
  WorkflowCodeSchema,
} from "../workflow/presentation.js";
import { DashboardWireVersionSchema } from "./primitives.js";
import { ExplorerOperationStructureWireSchema } from "./operation-structure.js";

/** A repository-relative source path, anchored and slash-separated with no `..` segment and no leading slash: it is rendered as "the file that owns this fact". */
export const SourcePathSchema = z
  .string()
  .regex(
    /^(?!.*\/\.\.\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
    "source path must be a repo-relative slash path with no parent segment",
  )
  .brand<"SourcePath">();
export type SourcePath = z.infer<typeof SourcePathSchema>;

/** Where a named source file was looked for, and whether it was found; a miss is NEVER silent and never guessed — it is resolved against a real listing. */
export const SourceLinkWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), path: SourcePathSchema }),
  z.strictObject({
    state: z.literal("unresolved"),
    attemptedPath: SourcePathSchema,
    reason: z.string().min(1),
  }),
]);
export type SourceLinkWire = z.infer<typeof SourceLinkWireSchema>;

/** A UI id a browser task uses, reversed out of the generated catalog's own index; the explorer never re-derives this relationship. */
export const ExplorerUiLinkWireSchema = z.strictObject({
  catalogId: z.string().min(1),
  kind: z.enum(["screen", "element", "page-state", "observation"]),
  system: BrowserSystemIdSchema,
  label: z.string().min(1),
  verifiedAt: z.string().min(1),
  /** The driver registry that owns this id — ref operator-trust's "driver" source link. */
  driverSource: z.string().min(1),
});
export type ExplorerUiLinkWire = z.infer<typeof ExplorerUiLinkWireSchema>;

/** Where a contract's implementation lives, and whether one exists at all; a pending entry is carried through verbatim, because surfacing it honestly is the point. */
export const ExplorerTaskBindingWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("bound"),
    storeNamespace: z.string().min(1),
    storeKind: z.enum(["browser", "headless"]),
    /** The driver's system — browser stores only; a headless store owns none. */
    driverSystem: BrowserSystemIdSchema.optional(),
    sessions: z.array(SessionNeedSchema).optional(),
  }),
  z.strictObject({
    state: z.literal("pending"),
    note: z.string().min(1),
  }),
]);
export type ExplorerTaskBindingWire = z.infer<typeof ExplorerTaskBindingWireSchema>;

/** The contract's declared subject binding (ref task-contract), projected without its schemas. */
export const ExplorerSubjectWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("none"),
    reason: z.string().min(1).optional(),
    reviewedReasonId: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.enum(["person", "artifact"]),
    fromInput: ContractFieldPathSchema,
    identity: z.enum(["eid", "name", "eid-and-name", "artifact-id", "sha256", "document-id"]),
    observe: ObservationIdSchema,
    match: z.enum(["normalized-exact-eid", "normalized-exact-name", "eid-and-name", "exact"]),
    requiredAt: z.enum(["before-subject-read", "after-prepare-before-fence"]),
  }),
]);
export type ExplorerSubjectWire = z.infer<typeof ExplorerSubjectWireSchema>;

/** The write-safety declaration of a `commit` contract, reduced to the facts that are DATA. */
export const ExplorerWriteSafetyWireSchema = z.strictObject({
  completionKind: z.enum(["receipt", "save-verify", "upload-verify"]),
  /** The read contract that proves the write landed; `receipt` needs none. */
  verifyTaskId: TaskIdSchema.optional(),
  probeTaskId: TaskIdSchema,
  recoveryAbsence: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("stabilized"),
      minSinceFenceMs: z.number().int().positive(),
      consistentReads: z.union([z.literal(2), z.literal(3)]),
      minBetweenReadsMs: z.number().int().positive(),
    }),
    z.strictObject({ kind: z.literal("operator-only"), reason: z.string().min(1) }),
  ]),
  /** ref write-safety's reviewed always-park exception, when the contract carries one. */
  unverifiableByPage: z.strictObject({
    policy: z.literal("always-park"),
    reason: z.string().min(1),
  }).optional(),
});
export type ExplorerWriteSafetyWire = z.infer<typeof ExplorerWriteSafetyWireSchema>;

/** A freshness bound, JSON-safe; an unbounded policy crossing this wire is stated as such rather than serialized to `null`. */
export const ExplorerFreshnessLimitWireSchema = z.union([
  z.number().int().nonnegative(),
  z.literal("unbounded"),
]);

export const ExplorerFreshnessWireSchema = z.strictObject({
  defaultMaxAge: ExplorerFreshnessLimitWireSchema,
  defaultOverride: z.enum(["forbidden", "audited"]).optional(),
  byField: z.array(z.strictObject({
    path: ContractFieldPathSchema,
    maxAge: ExplorerFreshnessLimitWireSchema,
    override: z.enum(["forbidden", "audited"]).optional(),
  })),
});
export type ExplorerFreshnessWire = z.infer<typeof ExplorerFreshnessWireSchema>;

export const ExplorerProvenanceWireSchema = z.strictObject({
  default: z.enum(["live", "derived"]),
  byField: z.array(z.strictObject({
    path: ContractFieldPathSchema,
    source: z.enum(["live", "derived"]),
  })),
});
export type ExplorerProvenanceWire = z.infer<typeof ExplorerProvenanceWireSchema>;

/** How ONE field of a contract gets recorded — the "Recorded" column of the explorer's field table; no run is laid over the contract to fill it. */
export const ExplorerFieldRecordedWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("observed"),
    source: z.enum(["live", "derived"]),
    maxAge: ExplorerFreshnessLimitWireSchema,
    override: z.enum(["forbidden", "audited"]).optional(),
  }),
  /** An INPUT leaf: the graph binds this value, so nothing observes it. */
  z.strictObject({ state: z.literal("bound"), reason: z.string().min(1) }),
  /** A prepare arm's output: `checkpoint: in-memory-only`, so nothing stores it. */
  z.strictObject({ state: z.literal("not-recorded"), reason: z.string().min(1) }),
  /** A commit arm's output: stored inside the transaction outcome. */
  z.strictObject({ state: z.literal("checkpointed"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("unknown"), reason: z.string().min(1) }),
]);
export type ExplorerFieldRecordedWire = z.infer<typeof ExplorerFieldRecordedWireSchema>;

/** One FIELD of a task arm's contract, derived from the contract's own zod shape; `kind` and `presence` come from the same schema walk the hash uses. */
export const ExplorerContractFieldWireSchema = z.strictObject({
  path: ContractFieldPathSchema,
  side: z.enum(["input", "output"]),
  kind: ContractSchemaLeafKindSchema,
  presence: z.enum(["always", "sometimes"]),
  /** The closed vocabulary an `enum`/`literal` field admits. */
  options: z.array(z.string().min(1)).min(1).optional(),
  recorded: ExplorerFieldRecordedWireSchema,
});
export type ExplorerContractFieldWire = z.infer<typeof ExplorerContractFieldWireSchema>;

/** One task arm of a node: a `task` node has one, a `transaction` node has two. */
export const ExplorerTaskWireSchema = z.strictObject({
  arm: z.enum(["task", "prepare", "commit"]),
  taskId: TaskIdSchema,
  title: z.string().min(1),
  effect: z.enum(["read", "prepare", "commit"]),
  binding: ExplorerTaskBindingWireSchema,
  errorCodes: z.array(TaskErrorCodeSchema).min(1),
  requires: z.array(SecretNameSchema),
  providers: z.array(ProviderCapabilityIdSchema),
  freshness: ExplorerFreshnessWireSchema.optional(),
  provenance: ExplorerProvenanceWireSchema.optional(),
  artifacts: z.literal("content-addressed").optional(),
  checkpoint: z.literal("in-memory-only").optional(),
  subject: ExplorerSubjectWireSchema,
  scenarios: z.array(ScenarioIdSchema),
  ui: z.array(ExplorerUiLinkWireSchema),
  writeSafety: ExplorerWriteSafetyWireSchema.optional(),
  inputSchemaHash: FingerprintSchema,
  outputSchemaHash: FingerprintSchema,
  /** Every field this contract's input and output own, sorted, side-tagged. */
  fields: z.array(ExplorerContractFieldWireSchema),
  contractSource: SourceLinkWireSchema,
  /** The store's task implementation, and the fingerprint the manifest gave it. */
  implSource: SourceLinkWireSchema,
  implFingerprint: FingerprintSchema.optional(),
});
export type ExplorerTaskWire = z.infer<typeof ExplorerTaskWireSchema>;

/** The control-shape of a node, one arm per graph node kind; every arm carries the DOWNSTREAM node ids its controller names, so the surface can draw the real structure. */
export const ExplorerNodeShapeWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("task"),
    replay: z.enum(["checkpoint", "always-rerun"]),
      /* The node's `when`, served as the DECLARATION the executor evaluates; the client renders it through the one projection of that declaration. */
    condition: NodeConditionSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("transaction"),
    dryRun: z.enum(["stop-after-prepare", "unsupported"]),
    probePolicy: z.enum(["always", "retries-and-recovery-only"]),
    probeToFenceMaxMs: z.number().int().positive(),
    leaseScope: z.literal("transaction"),
    retryBeforeFence: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("branch"),
    cases: z.array(z.strictObject({
      name: z.string().min(1),
      nodes: z.array(NodeIdSchema),
    })).min(1),
  }),
  z.strictObject({
    kind: z.literal("parallel"),
    join: z.enum(["all", "all-settled"]),
    branches: z.array(z.strictObject({
      id: z.string().min(1),
      nodes: z.array(NodeIdSchema),
    })).min(1),
  }),
  z.strictObject({
    kind: z.literal("child-run"),
    edgeId: z.string().min(1),
    targetWorkflowId: WorkflowIdSchema,
    cardinality: z.enum(["one", "many"]),
    await: z.enum(["terminal", "none"]),
    join: z.enum(["one", "all", "all-settled", "none"]),
    onChildFailed: z.enum(["fail-parent", "block-parent", "allow-partial"]),
    cascadeCancel: z.enum(["cascade", "independent"]),
    afterChildRetry: z.enum(["resume-parent", "manual-parent-resume"]),
    visibility: z.enum(["inline", "linked", "hidden-unless-failed"]),
  }),
  z.strictObject({
    kind: z.literal("gate"),
    resolvedBy: z.enum(["operator", "children-terminal", "external"]),
    statusKey: z.string().min(1).optional(),
  }),
]);
export type ExplorerNodeShapeWire = z.infer<typeof ExplorerNodeShapeWireSchema>;

/** The descriptor's own words about a workflow or a node; `absent` is an arm rather than a throw, because the explorer serves every registered workflow in ONE document. */
export const ExplorerProseWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("authored"), text: z.string().min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type ExplorerProseWire = z.infer<typeof ExplorerProseWireSchema>;

export const ExplorerNodeWireSchema = z.strictObject({
  id: NodeIdSchema,
  label: z.string().min(1),
  /** The descriptor's own sentence about why this node exists. */
  purpose: ExplorerProseWireSchema,
  dependsOn: z.array(NodeIdSchema),
  shape: ExplorerNodeShapeWireSchema,
  tasks: z.array(ExplorerTaskWireSchema),
  /** Detail projections (ref dashboard-surfaces) this node is the source of. */
  details: z.array(z.strictObject({
    key: z.string().min(1),
    label: z.string().min(1),
    fieldPath: ContractFieldPathSchema,
    display: z.enum(["text", "eid", "date", "count", "badge", "person-name"]),
  })),
  /** Descriptor-allowlisted Edit Data fields sourced from this node (ref data-intake-and-edit-data ). */
  editableFields: z.array(z.strictObject({
    fieldPath: ContractFieldPathSchema,
    label: z.string().min(1),
  })),
  /** Graph coverage points this node contributes (ref operator-trust ). */
  coveragePoints: z.array(z.strictObject({
    id: z.string().min(1),
    kind: z.enum(["branch-case", "gate", "delegation", "transaction"]),
    detail: z.string().min(1),
  })),
});
export type ExplorerNodeWire = z.infer<typeof ExplorerNodeWireSchema>;

/** An edge the surface draws; the execution edge and the CONTROL edges are kept distinct because they mean different things: one is "after", the others "instead of" and "alongside". */
export const ExplorerEdgeWireSchema = z.strictObject({
  from: NodeIdSchema,
  to: NodeIdSchema,
  kind: z.enum(["depends-on", "branch-case", "parallel-branch"]),
  /** The case or branch name, for the two control kinds. */
  label: z.string().min(1).optional(),
});
export type ExplorerEdgeWire = z.infer<typeof ExplorerEdgeWireSchema>;

/** A registered scenario id and the executable file that walks it; what a scenario CLAIMS to cover is deliberately absent from this wire. */
export const ExplorerScenarioWireSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  source: SourceLinkWireSchema,
});
export type ExplorerScenarioWire = z.infer<typeof ExplorerScenarioWireSchema>;

export const ExplorerWorkflowWireSchema = z.strictObject({
  id: WorkflowIdSchema,
  label: z.string().min(1),
  /** The descriptor's own sentence about what this workflow does. */
  summary: ExplorerProseWireSchema,
  code: WorkflowCodeSchema,
  icon: z.string().min(1),
  category: z.string().min(1),
    /* The module's declared taxonomy, served RAW beside the category exactly as the bootstrap wire serves it. */
  role: WorkflowModuleRoleSchema,
  version: z.number().int().positive(),
  contractFingerprint: FingerprintSchema,
  /** One declared operation tree, or explicit legacy absence. */
  operationStructure: ExplorerOperationStructureWireSchema,
  /** Authored tuple order, kept apart from the graph's typed execution edges. */
  definitionPreview: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
    z.strictObject({
      state: z.literal("compiled"),
      groups: z.array(z.strictObject({
        key: z.string().min(1),
        label: z.string().min(1),
        entries: z.array(z.strictObject({
          id: NodeIdSchema,
          kind: z.enum(["task", "parallel", "delegate", "gate", "transaction"]),
          nodeIds: z.array(NodeIdSchema).min(1),
          dependsOn: z.array(NodeIdSchema),
          taskIds: z.array(TaskIdSchema),
        })).min(1),
      })).min(1),
      systemsFirstUse: z.array(BrowserSystemIdSchema),
    }),
  ]),
  /** The exact closed subset the safe-edit protocol derives for this descriptor. */
  edit: z.strictObject({
    overrideRevision: z.number().int().nonnegative(),
    presentation: z.strictObject({
      workflowLabel: z.literal(true),
      iconValues: z.array(IconNameSchema).min(1),
      categoryValues: z.array(WorkflowCategorySchema).min(1),
      timeline: z.strictObject({
        state: z.literal("unavailable"),
        reason: z.string().min(1),
      }),
    }),
    notificationPreferences: z.strictObject({
      state: z.literal("unavailable"),
      reason: z.string().min(1),
    }),
    operationalPolicies: z.strictObject({
      state: z.literal("code-change-only"),
      reason: z.string().min(1),
    }),
    editData: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
      z.strictObject({
        state: z.literal("code-change-only"),
        fields: z.array(EditDataFieldSchema).min(1),
        reason: z.string().min(1),
      }),
    ]),
  }),
    /* `SurfaceShape` is either a declared row shape or `by-input`, which resolves per run; the explorer reports which of the two the descriptor declared and never resolves the second. */
  surfaceShape: z.enum(["single", "preview", "operation", "operation-member", "by-input"]),
  enqueue: z.string().min(1),
    /* `inputSubject` is either a constant the descriptor declared or a function of the input; the explorer reports which of the two it is and never evaluates it against a fabricated input. */
  inputSubject: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("fixed"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("derived") }),
  ]),
  actions: z.array(z.string().min(1)),
  systems: z.array(z.string().min(1)),
  requires: z.array(SecretNameSchema),
  inputSchemaHash: FingerprintSchema,
  canonicalInputSchemaHash: FingerprintSchema,
  resultSchemaHash: FingerprintSchema,
  resultDependsOn: z.array(NodeIdSchema),
  verdicts: z.array(z.strictObject({
    key: z.string().min(1),
    label: z.string().min(1),
    tone: z.string().min(1),
  })),
  capabilities: z.strictObject({
    review: z.boolean(),
    editData: z.enum(["none", "all", "declared-fields"]),
  }),
  /** Which operator-facing surfaces this workflow DECLARES (doc 06/ref dashboard-surfaces). */
  surfaces: z.strictObject({
    inputRun: z.discriminatedUnion("state", [
      z.strictObject({
        state: z.literal("declared"),
        placeholder: z.string().min(1),
        supportsDryRun: z.boolean(),
      }),
      z.strictObject({ state: z.literal("absent") }),
    ]),
    intake: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("declared"), targetCount: z.number().int().nonnegative() }),
      z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    ]),
  }),
  nodes: z.array(ExplorerNodeWireSchema).min(1),
  /** Factory-owned presentation groups; every graph node occurs exactly once. */
  timeline: z.array(z.strictObject({
    key: TimelineCategoryKeySchema,
    label: z.string().min(1),
    nodes: z.array(NodeIdSchema).min(1),
  })).min(1),
  edges: z.array(ExplorerEdgeWireSchema),
  scenarios: z.array(ExplorerScenarioWireSchema),
  sources: z.strictObject({
    descriptor: SourceLinkWireSchema,
    module: SourceLinkWireSchema,
    /** Every file in the descriptor's fingerprinted source closure. */
    closureFileCount: z.number().int().positive(),
  }),
}).superRefine((workflow, context) => {
  const graphNodeIds = new Set(workflow.nodes.map(({ id }) => String(id)));
  const groupKeys = new Set<string>();
  const timelineNodeIds = new Set<string>();
  for (const [groupIndex, group] of workflow.timeline.entries()) {
    if (groupKeys.has(group.key)) {
      context.addIssue({
        code: "custom",
        path: ["timeline", groupIndex, "key"],
        message: `timeline repeats group key ${group.key}`,
      });
    }
    groupKeys.add(group.key);
    for (const [nodeIndex, nodeId] of group.nodes.entries()) {
      const id = String(nodeId);
      if (!graphNodeIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["timeline", groupIndex, "nodes", nodeIndex],
          message: `timeline names unknown node ${id}`,
        });
      }
      if (timelineNodeIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["timeline", groupIndex, "nodes", nodeIndex],
          message: `timeline repeats node ${id}`,
        });
      }
      timelineNodeIds.add(id);
    }
  }
  for (const node of workflow.nodes) {
    const id = String(node.id);
    if (!timelineNodeIds.has(id)) {
      context.addIssue({
        code: "custom",
        path: ["timeline"],
        message: `timeline omits graph node ${id}`,
      });
    }
  }
});
export type ExplorerWorkflowWire = z.infer<typeof ExplorerWorkflowWireSchema>;

/** The whole projection, served in one document; every registered workflow travels together because the surface's spine needs the list and the payload is static registration metadata. */
export const WorkflowExplorerWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  generatedAt: IsoInstantSchema,
  descriptorHash: FingerprintSchema,
  workflows: z.array(ExplorerWorkflowWireSchema),
}).superRefine((wire, context) => {
  const ids = wire.workflows.map(({ id }) => String(id));
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["workflows"], message: "workflow identities must be unique" });
  }
    // Harness parents must be compositions in this document or nesting is unrenderable.
  const compositions = new Set(
    wire.workflows.filter(({ role }) => role.kind === "composition").map(({ id }) => String(id)),
  );
  for (const [index, workflow] of wire.workflows.entries()) {
    if (workflow.role.kind === "chunk-harness" && !compositions.has(String(workflow.role.of))) {
      context.addIssue({
        code: "custom",
        path: ["workflows", index, "role", "of"],
        message: `${String(workflow.id)} is served as a chunk harness of ${String(workflow.role.of)}, `
          + "which this document does not carry as a composition",
      });
    }
    const nodeIds = new Set(workflow.nodes.map(({ id }) => String(id)));
    if (nodeIds.size !== workflow.nodes.length) {
      context.addIssue({
        code: "custom",
        path: ["workflows", index, "nodes"],
        message: `${String(workflow.id)} repeats a node id`,
      });
    }
    for (const [edgeIndex, edge] of workflow.edges.entries()) {
      // An edge naming a node the graph does not carry would draw a line to
      // nowhere — and, worse, would let a stale projection look complete.
      for (const [end, value] of [["from", edge.from], ["to", edge.to]] as const) {
        if (!nodeIds.has(String(value))) {
          context.addIssue({
            code: "custom",
            path: ["workflows", index, "edges", edgeIndex, end],
            message: `${String(workflow.id)} edge names unknown node ${String(value)}`,
          });
        }
      }
    }
  }
});
export type WorkflowExplorerWire = z.infer<typeof WorkflowExplorerWireSchema>;

/* ── the Explorer safe-edit protocol ────────────────────────── */

/** One operator-authored presentation label; deliberately narrower than an arbitrary string — surrounding whitespace, non-normalized text and control characters are all refused. */
export const ExplorerPresentationLabelSchema = z.string().max(120).superRefine((value, context) => {
  if (value.trim() !== value || value.length === 0) {
    context.addIssue({ code: "custom", message: "Explorer presentation labels must be non-empty and already trimmed" });
  }
  if (value.normalize("NFC") !== value) {
    context.addIssue({ code: "custom", message: "Explorer presentation labels must be NFC-normalized" });
  }
  if (/\p{Cc}/u.test(value)) {
    context.addIssue({ code: "custom", message: "Explorer presentation labels cannot contain control characters" });
  }
  if (/(?:password|ps_token=|storagestate|privatekey|private[ -]?key|duo-credential|\.auth(?:-rebuild)?[\\/]|\b\d{3}-\d{2}-\d{4}\b|\b\d{4}-\d{2}-\d{2}\b)/iu.test(value)) {
    context.addIssue({
      code: "custom",
      message: "Explorer presentation labels cannot contain credential- or regulated-value-shaped text",
    });
  }
});

export const ExplorerEditChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-label"), value: ExplorerPresentationLabelSchema }),
  z.strictObject({ kind: z.literal("workflow-icon"), value: IconNameSchema }),
  z.strictObject({ kind: z.literal("workflow-category"), value: WorkflowCategorySchema }),
  /** Operational: valid draft input, but apply remains a reviewed code change. */
  z.strictObject({ kind: z.literal("enqueue-policy"), value: EnqueuePolicySchema }),
  /** Descriptor-owned: valid draft input, but apply remains a reviewed code change. */
  z.strictObject({ kind: z.literal("edit-data-fields"), fields: z.array(EditDataFieldSchema).min(1) }),
]);

/** A draft is always based on BOTH identities the running descriptor stamps onto a run plus the presentation override revision the Explorer served. */
export const ExplorerEditDraftSchema = z.strictObject({
  draftVersion: z.literal(1),
  workflowId: WorkflowIdSchema,
  baseDescriptorVersion: z.number().int().positive(),
  baseContractFingerprint: FingerprintSchema,
  baseOverrideRevision: z.number().int().nonnegative(),
  changes: z.array(ExplorerEditChangeSchema).min(1),
});
export type ExplorerEditDraft = z.infer<typeof ExplorerEditDraftSchema>;

const ExplorerEditReasonSchema = z.string().min(1).max(500).refine(
  (value) => value.trim() === value,
  "operator reason must already be trimmed",
);

/** The durable Explorer apply identity: the complete strict command envelope rather than a command id plus a derived draft, so a crash replay may not change WHO requested the mutation. */
export const ExplorerEditApplyRequestSchema = z.strictObject({
  commandId: CommandIdSchema,
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema,
  reason: ExplorerEditReasonSchema.optional(),
  family: z.literal("explorer"),
  type: z.literal("apply-explorer-edit"),
  target: z.strictObject({
    workflowId: WorkflowIdSchema,
    expectedVersion: z.number().int().positive(),
    contractFingerprint: FingerprintSchema,
    expectedOverrideRevision: z.number().int().nonnegative(),
  }),
  payload: z.strictObject({ changes: z.array(ExplorerEditChangeSchema).min(1) }),
});
export type ExplorerEditApplyRequest = z.infer<typeof ExplorerEditApplyRequestSchema>;

export const ExplorerPresentationOverrideSchema = z.strictObject({
  label: ExplorerPresentationLabelSchema.optional(),
  icon: IconNameSchema.optional(),
  category: WorkflowCategorySchema.optional(),
});
export type ExplorerPresentationOverride = z.infer<typeof ExplorerPresentationOverrideSchema>;

const ExplorerWorkflowOverrideFields = {
  overrideVersion: z.literal(1),
  workflowId: WorkflowIdSchema,
  descriptorVersion: z.number().int().positive(),
  contractFingerprint: FingerprintSchema,
  revision: z.number().int().positive(),
  presentation: ExplorerPresentationOverrideSchema,
} as const;

export const ExplorerProposedWorkflowOverrideSchema = z.strictObject(ExplorerWorkflowOverrideFields);
export type ExplorerProposedWorkflowOverride = z.infer<typeof ExplorerProposedWorkflowOverrideSchema>;

export const ExplorerWorkflowOverrideSchema = z.strictObject({
  ...ExplorerWorkflowOverrideFields,
  appliedCommandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
});
export type ExplorerWorkflowOverride = z.infer<typeof ExplorerWorkflowOverrideSchema>;

export const ExplorerOverrideDocumentSchema = z.strictObject({
  documentVersion: z.literal(1),
  workflows: z.array(ExplorerWorkflowOverrideSchema),
}).superRefine((document, context) => {
  const ids = document.workflows.map(({ workflowId }) => String(workflowId));
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["workflows"], message: "Explorer overrides must have unique workflow ids" });
  }
});
export type ExplorerOverrideDocument = z.infer<typeof ExplorerOverrideDocumentSchema>;

export const ExplorerSemanticDiffEntrySchema = z.strictObject({
  path: z.string().min(1),
  before: z.string(),
  after: z.string(),
});

/** Held compile bytes are not passed validation; live registry facts must be re-derived. */
export const ExplorerCompileAttestationSchema = z.strictObject({
  attestationVersion: z.literal(2),
  workflowId: WorkflowIdSchema,
  descriptorVersion: z.number().int().positive(),
  contractFingerprint: FingerprintSchema,
  checks: z.strictObject({
    builder: z.strictObject({
      state: z.literal("held"),
      factory: z.literal("defineWorkflowDescriptor"),
    }),
    schema: z.strictObject({
      state: z.literal("held"),
      inputSchemaHash: FingerprintSchema,
      canonicalInputSchemaHash: FingerprintSchema,
      resultSchemaHash: FingerprintSchema,
      tasks: z.array(z.strictObject({
        taskId: TaskIdSchema,
        inputSchemaHash: FingerprintSchema,
        outputSchemaHash: FingerprintSchema,
      })).min(1),
    }),
    graph: z.strictObject({
      state: z.literal("held"),
      nodeIds: z.array(NodeIdSchema).min(1),
      edgeFingerprint: FingerprintSchema,
      coveragePointIds: z.array(z.string().min(1)),
    }),
    guard: z.strictObject({
      state: z.literal("held"),
      name: z.literal("workflow-editor-compile-integrity"),
      scope: z.literal("runtime-registry-round-trip"),
      descriptorSetHash: FingerprintSchema,
    }),
    scenario: z.strictObject({
      state: z.literal("held"),
      scope: z.literal("registered-declaration-equivalence"),
      registrations: z.array(z.strictObject({
        scenarioId: ScenarioIdSchema,
      })).min(1),
    }),
  }),
}).superRefine((attestation, context) => {
  for (const [path, values] of [
    ["checks.schema.tasks", attestation.checks.schema.tasks.map(({ taskId }) => String(taskId))],
    ["checks.graph.nodeIds", attestation.checks.graph.nodeIds.map(String)],
    ["checks.graph.coveragePointIds", attestation.checks.graph.coveragePointIds],
    ["checks.scenario.registrations", attestation.checks.scenario.registrations.map(({ scenarioId }) => String(scenarioId))],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: path.split("."), message: `${path} must be unique` });
    }
  }
});
export type ExplorerCompileAttestation = z.infer<typeof ExplorerCompileAttestationSchema>;

const ExplorerEditDataFieldsSchema = z.array(EditDataFieldSchema).min(1);

const ExplorerCodeChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("enqueue-policy"), value: EnqueuePolicySchema }),
  z.strictObject({ kind: z.literal("edit-data-fields"), fields: ExplorerEditDataFieldsSchema }),
]);

function canonicalExpressionSchema(schema: z.ZodType): z.ZodString {
  return z.string().min(1).superRefine((expression, context) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(expression);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: `TypeScript patch expression must be canonical JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "TypeScript patch expression is outside its closed value schema" });
      return;
    }
    if (canonicalJsonStringify(parsed.data) !== expression) {
      context.addIssue({ code: "custom", message: "TypeScript patch expression must use canonical JSON bytes" });
    }
  });
}

const ExplorerTypescriptPatchOperationSchema = z.discriminatedUnion("propertyPath", [
  z.strictObject({
    propertyPath: z.literal("enqueue"),
    beforeExpression: canonicalExpressionSchema(EnqueuePolicySchema),
    afterExpression: canonicalExpressionSchema(EnqueuePolicySchema),
  }),
  z.strictObject({
    propertyPath: z.literal("capabilities.editData.fields"),
    beforeExpression: canonicalExpressionSchema(ExplorerEditDataFieldsSchema),
    afterExpression: canonicalExpressionSchema(ExplorerEditDataFieldsSchema),
  }),
]);

export const ExplorerDescriptorPatchSchema = z.strictObject({
  patchVersion: z.literal(1),
  workflowId: WorkflowIdSchema,
  baseDescriptorVersion: z.number().int().positive(),
  baseContractFingerprint: FingerprintSchema,
  changes: z.array(ExplorerCodeChangeSchema).min(1),
  canonicalDescriptorJson: z.string().min(1),
  typescript: z.strictObject({
    sourcePath: SourcePathSchema,
    operations: z.array(ExplorerTypescriptPatchOperationSchema).min(1),
  }),
}).superRefine((patch, context) => {
  const canonicalDocument = {
    patchVersion: patch.patchVersion,
    workflowId: patch.workflowId,
    baseDescriptorVersion: patch.baseDescriptorVersion,
    baseContractFingerprint: patch.baseContractFingerprint,
    changes: patch.changes,
  };
  if (patch.canonicalDescriptorJson !== canonicalJsonStringify(canonicalDocument)) {
    context.addIssue({
      code: "custom",
      path: ["canonicalDescriptorJson"],
      message: "canonical descriptor JSON must exactly encode the closed patch document",
    });
  }
  const changeKinds = patch.changes.map(({ kind }) => kind);
  const operationKinds = patch.typescript.operations.map(({ propertyPath }) =>
    propertyPath === "enqueue" ? "enqueue-policy" : "edit-data-fields");
  if (new Set(changeKinds).size !== changeKinds.length
    || changeKinds.length !== operationKinds.length
    || !changeKinds.every((kind, index) => operationKinds[index] === kind)) {
    context.addIssue({
      code: "custom",
      path: ["typescript", "operations"],
      message: "TypeScript operations must correspond one-for-one and in order with unique closed patch changes",
    });
  }
  for (const [index, change] of patch.changes.entries()) {
    const operation = patch.typescript.operations[index];
    if (operation === undefined) continue;
    if (operation.beforeExpression === operation.afterExpression) {
      context.addIssue({
        code: "custom",
        path: ["typescript", "operations", index],
        message: "TypeScript patch operation must change its reviewed source value",
      });
    }
    const expectedAfter = canonicalJsonStringify(
      change.kind === "enqueue-policy" ? change.value : change.fields,
    );
    if (operation.afterExpression !== expectedAfter) {
      context.addIssue({
        code: "custom",
        path: ["typescript", "operations", index, "afterExpression"],
        message: "TypeScript after expression must equal the reviewed closed patch value",
      });
    }
  }
});
export type ExplorerDescriptorPatch = z.infer<typeof ExplorerDescriptorPatchSchema>;

const ExplorerSemanticSetDiffSchema = z.strictObject({
  added: z.array(z.string().min(1)),
  removed: z.array(z.string().min(1)),
});

export const ExplorerCodeChangeSemanticDiffSchema = z.strictObject({
  presentation: z.array(ExplorerSemanticDiffEntrySchema),
  nodes: z.strictObject({
    added: z.array(NodeIdSchema),
    removed: z.array(NodeIdSchema),
    changed: z.array(NodeIdSchema),
  }),
  edges: z.strictObject({
    added: z.array(z.string().min(1)),
    removed: z.array(z.string().min(1)),
    changed: z.array(z.string().min(1)),
  }),
  effects: ExplorerSemanticSetDiffSchema,
  policies: z.array(ExplorerSemanticDiffEntrySchema).min(1),
  uiIds: ExplorerSemanticSetDiffSchema,
  evidenceObligations: z.tuple([
    z.literal("builder"),
    z.literal("schema"),
    z.literal("graph"),
    z.literal("guard"),
    z.literal("scenario"),
  ]),
});

const ExplorerRequiredCompileChecksSchema = z.tuple([
  z.strictObject({ check: z.literal("builder"), state: z.literal("required") }),
  z.strictObject({ check: z.literal("schema"), state: z.literal("required") }),
  z.strictObject({ check: z.literal("graph"), state: z.literal("required") }),
  z.strictObject({ check: z.literal("guard"), state: z.literal("required") }),
  z.strictObject({ check: z.literal("scenario"), state: z.literal("required") }),
]);

export const ExplorerCodeChangeBriefSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  reason: z.string().min(1),
  requiredFiles: z.array(SourcePathSchema).min(1),
  failedObligations: z.array(z.string().min(1)).min(1),
  baseAttestation: ExplorerCompileAttestationSchema,
  patch: ExplorerDescriptorPatchSchema,
  semanticDiff: ExplorerCodeChangeSemanticDiffSchema,
  impacts: z.strictObject({
    workflows: z.array(WorkflowIdSchema).length(1),
    tasks: z.array(TaskIdSchema).min(1),
    scenarios: z.array(ScenarioIdSchema).min(1),
    sourceFiles: z.array(SourcePathSchema).min(1),
  }),
  nextDescriptor: z.strictObject({
    version: z.number().int().positive(),
    contractFingerprint: z.strictObject({
      state: z.literal("must-change"),
      current: FingerprintSchema,
    }),
  }),
  requiredChecks: ExplorerRequiredCompileChecksSchema,
}).superRefine((brief, context) => {
  const same = (left: readonly unknown[], right: readonly unknown[]): boolean =>
    canonicalJsonStringify(left) === canonicalJsonStringify(right);
  if (brief.workflowId !== brief.baseAttestation.workflowId
    || brief.workflowId !== brief.patch.workflowId
    || brief.impacts.workflows[0] !== brief.workflowId) {
    context.addIssue({ code: "custom", path: ["workflowId"], message: "code-change brief workflow identities disagree" });
  }
  if (brief.patch.baseDescriptorVersion !== brief.baseAttestation.descriptorVersion
    || brief.nextDescriptor.version !== brief.baseAttestation.descriptorVersion + 1) {
    context.addIssue({
      code: "custom",
      path: ["nextDescriptor", "version"],
      message: "a code-change brief must require exactly the next descriptor version",
    });
  }
  if (brief.patch.baseContractFingerprint !== brief.baseAttestation.contractFingerprint
    || brief.nextDescriptor.contractFingerprint.current !== brief.baseAttestation.contractFingerprint) {
    context.addIssue({
      code: "custom",
      path: ["nextDescriptor", "contractFingerprint"],
      message: "a code-change brief must bind its current descriptor fingerprint exactly",
    });
  }
  if (!brief.requiredFiles.includes(brief.patch.typescript.sourcePath)
    || !same(brief.requiredFiles, brief.impacts.sourceFiles)) {
    context.addIssue({
      code: "custom",
      path: ["requiredFiles"],
      message: "the TypeScript patch source and impacted source files must equal the required files",
    });
  }
  const taskIds = brief.baseAttestation.checks.schema.tasks.map(({ taskId }) => taskId);
  const scenarioIds = brief.baseAttestation.checks.scenario.registrations.map(({ scenarioId }) => scenarioId);
  if (!same(brief.impacts.tasks, taskIds) || !same(brief.impacts.scenarios, scenarioIds)) {
    context.addIssue({
      code: "custom",
      path: ["impacts"],
      message: "brief impacts must carry the attested tasks and scenarios exactly",
    });
  }
  const semanticValue = (
    operation: z.infer<typeof ExplorerTypescriptPatchOperationSchema>,
    expression: string,
  ): string | undefined => {
    const valueSchema = operation.propertyPath === "enqueue"
      ? EnqueuePolicySchema
      : ExplorerEditDataFieldsSchema;
    if (!canonicalExpressionSchema(valueSchema).safeParse(expression).success) return undefined;
    const decoded: unknown = JSON.parse(expression);
    return operation.propertyPath === "enqueue"
      ? EnqueuePolicySchema.parse(decoded)
      : canonicalJsonStringify(ExplorerEditDataFieldsSchema.parse(decoded));
  };
  const expectedPolicies = brief.patch.typescript.operations.map((operation) => {
    const before = semanticValue(operation, operation.beforeExpression);
    const after = semanticValue(operation, operation.afterExpression);
    return before === undefined || after === undefined
      ? undefined
      : { path: operation.propertyPath, before, after };
  });
  if (expectedPolicies.every((entry) => entry !== undefined)
    && !same(brief.semanticDiff.policies, expectedPolicies)) {
    context.addIssue({
      code: "custom",
      path: ["semanticDiff", "policies"],
      message: "semantic policy diff must exactly match each reviewed TypeScript operation",
    });
  }
  if (brief.semanticDiff.presentation.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["semanticDiff", "presentation"],
      message: "source-only Explorer patches cannot claim presentation changes",
    });
  }
  const changedNodeIds = new Set<string>();
  let nodeDiffComparable = true;
  for (const operation of brief.patch.typescript.operations) {
    if (operation.propertyPath !== "capabilities.editData.fields") continue;
    for (const expression of [operation.beforeExpression, operation.afterExpression]) {
      if (!canonicalExpressionSchema(ExplorerEditDataFieldsSchema).safeParse(expression).success) {
        nodeDiffComparable = false;
        continue;
      }
      const decoded: unknown = JSON.parse(expression);
      for (const field of ExplorerEditDataFieldsSchema.parse(decoded)) changedNodeIds.add(String(field.nodeId));
    }
  }
  const expectedNodes = { added: [], removed: [], changed: [...changedNodeIds].sort() };
  if (nodeDiffComparable && !same([brief.semanticDiff.nodes], [expectedNodes])) {
    context.addIssue({
      code: "custom",
      path: ["semanticDiff", "nodes"],
      message: "semantic node diff must exactly match Edit Data patch expressions",
    });
  }
  if (brief.semanticDiff.edges.added.length > 0
    || brief.semanticDiff.edges.removed.length > 0
    || brief.semanticDiff.edges.changed.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["semanticDiff", "edges"],
      message: "closed policy/Edit Data patches cannot claim graph edge changes",
    });
  }
  if (brief.semanticDiff.effects.added.length > 0 || brief.semanticDiff.effects.removed.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["semanticDiff", "effects"],
      message: "closed policy/Edit Data patches cannot claim executable effect changes",
    });
  }
  if (brief.semanticDiff.uiIds.added.length > 0 || brief.semanticDiff.uiIds.removed.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["semanticDiff", "uiIds"],
      message: "closed policy/Edit Data patches cannot claim semantic UI identity changes",
    });
  }
});
export type ExplorerCodeChangeBrief = z.infer<typeof ExplorerCodeChangeBriefSchema>;

export const ExplorerEditConflictSchema = z.strictObject({
  state: z.literal("conflict"),
  conflict: z.enum(["descriptor-version", "contract-fingerprint", "override-revision"]),
  message: z.string().min(1),
  currentDescriptorVersion: z.number().int().positive(),
  currentContractFingerprint: FingerprintSchema,
  currentOverrideRevision: z.number().int().nonnegative(),
});

export const ExplorerEditValidationResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready-to-apply"),
    draft: ExplorerEditDraftSchema,
    override: ExplorerProposedWorkflowOverrideSchema,
    semanticDiff: z.array(ExplorerSemanticDiffEntrySchema).min(1),
    impactedTasks: z.array(TaskIdSchema),
    impactedScenarios: z.array(ScenarioIdSchema).min(1),
    compileAttestation: ExplorerCompileAttestationSchema,
  }),
  ExplorerEditConflictSchema,
  z.strictObject({ state: z.literal("refused"), category: z.string().min(1), message: z.string().min(1) }),
  z.strictObject({ state: z.literal("code-change-required"), brief: ExplorerCodeChangeBriefSchema }),
]);
export type ExplorerEditValidationResult = z.infer<typeof ExplorerEditValidationResultSchema>;

export const ExplorerEditApplyResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("applied"),
    override: ExplorerWorkflowOverrideSchema,
    readback: ExplorerWorkflowOverrideSchema,
  }),
  ExplorerEditConflictSchema,
  z.strictObject({ state: z.literal("refused"), category: z.string().min(1), message: z.string().min(1) }),
  z.strictObject({ state: z.literal("code-change-required"), brief: ExplorerCodeChangeBriefSchema }),
]);
export type ExplorerEditApplyResult = z.infer<typeof ExplorerEditApplyResultSchema>;
