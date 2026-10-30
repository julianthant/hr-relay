/** The read-only Workflow Explorer wire: a projection of registration state derived at the server from the one composition root, never a second authority. */
import { z } from "zod";
import { ContractSchemaLeafKindSchema } from "../validation/contract-boundary.js";

import { ContractFieldPathSchema, TaskErrorCodeSchema } from "../task/task-contract.js";
import { BrowserSystemIdSchema, FingerprintSchema, IsoInstantSchema, NodeIdSchema, ObservationIdSchema, ProviderCapabilityIdSchema, ScenarioIdSchema, TaskIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import { SecretNameSchema } from "../config/secret-names.js";
import { SessionNeedSchema } from "../sessions/session.js";
import { NodeConditionSchema } from "../workflow/node-condition.js";
import { WorkflowModuleRoleSchema } from "../../workflow-kit/validation/module-role.js";
import { WorkflowOperatorFieldSchema, TimelineCategoryKeySchema, WorkflowCodeSchema } from "../workflow/presentation.js";
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
        description: z.string().min(1).optional(),
        system: z.union([BrowserSystemIdSchema, z.literal("local")]).optional(),
        operatorFields: z.array(WorkflowOperatorFieldSchema).optional(),
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
    description: z.string().min(1).optional(),
    system: z.union([BrowserSystemIdSchema, z.literal("local")]).optional(),
    operatorFields: z.array(WorkflowOperatorFieldSchema).optional(),
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
