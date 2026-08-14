/**
 * The read-only Workflow Explorer wire (doc 12 §5.2 Phase A, D176) and the
 * generated UI catalog wire (doc 12 §1.3, D177).
 *
 * Both are PROJECTIONS of registration state, never a second authority. The
 * explorer is derived at the server from the ONE composition root
 * (`WORKFLOW_MODULES`), the descriptors' own factory-sealed projections, the
 * generated build manifest, and the on-disk inventories; the catalog is the
 * committed `generated/ui-catalog.json` served verbatim after a freshness
 * assertion. Nothing here is hand-maintained, and
 * `workflow-editor-compile-integrity` proves that in both directions.
 *
 * This module is browser-reachable, so it imports zod and pure domain modules
 * only — no Node built-in may enter its closure (doc 13 §8.13).
 *
 * ## Why so many facts are a closed union rather than a string
 *
 * The explorer's whole job is to let a person or an AI resolve "the failure is
 * at `<workflow> → <node> → <task>`" to stable ids and source locations. A fact
 * it renders as free text is a fact nothing can check, so every policy value
 * below travels as the same closed vocabulary its owning schema declares. What
 * genuinely cannot be projected — an authored `bind`, `choose`, `when` or
 * `derive` closure — is reported as its PRESENCE and its source file, never as
 * a decompiled approximation of what the function does.
 */
import { z } from "zod";
import { ContractFieldPathSchema, TaskErrorCodeSchema } from "../contracts/base.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  ObservationIdSchema,
  ProviderCapabilityIdSchema,
  ScenarioIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { SecretNameSchema } from "../secret-names.js";
import { UiCatalogEntrySchema } from "../ui/contracts.js";
import { WorkflowModuleRoleSchema } from "../workflow/module-role.js";
import { DashboardWireVersionSchema } from "./primitives.js";

/**
 * A repository-relative source path. Anchored and slash-separated, with no
 * `..` segment and no leading slash: this value is rendered to an operator as
 * "the file that owns this fact", so a path that could escape the repo would be
 * pointing at something the explorer never read.
 */
export const SourcePathSchema = z
  .string()
  .regex(
    /^(?!.*\/\.\.\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
    "source path must be a repo-relative slash path with no parent segment",
  )
  .brand<"SourcePath">();
export type SourcePath = z.infer<typeof SourcePathSchema>;

/**
 * Where a named source file was looked for, and whether it was found.
 *
 * A miss is NEVER silent and never guessed: the explorer resolves a candidate
 * path against a real listing (the build manifest's own source closure, or the
 * scenario directory) and reports `unresolved` with the path it tried. Printing
 * a plausible-but-absent path would send a reader — or a code-changing AI — to
 * a file that does not exist, which is exactly the plausible-wrong-value
 * failure this program forbids.
 */
export const SourceLinkWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), path: SourcePathSchema }),
  z.strictObject({
    state: z.literal("unresolved"),
    attemptedPath: SourcePathSchema,
    reason: z.string().min(1),
  }),
]);
export type SourceLinkWire = z.infer<typeof SourceLinkWireSchema>;

/**
 * A UI id a browser task uses, reversed out of the generated catalog's own
 * `taskUses` index (doc 12 §1.3). The explorer never re-derives this
 * relationship — the catalog entry already declares it, and inventing a second
 * derivation is how the two would disagree.
 */
export const ExplorerUiLinkWireSchema = z.strictObject({
  catalogId: z.string().min(1),
  kind: z.enum(["screen", "element", "page-state", "observation"]),
  system: BrowserSystemIdSchema,
  label: z.string().min(1),
  verifiedAt: z.string().min(1),
  /** The driver registry that owns this id — doc 12 §5.2's "driver" source link. */
  driverSource: z.string().min(1),
});
export type ExplorerUiLinkWire = z.infer<typeof ExplorerUiLinkWireSchema>;

/**
 * Where a contract's implementation lives, and whether one exists at all.
 *
 * `pending` is `config/pending-impl-bindings.json`'s own entry, carried through
 * verbatim (D107). Surfacing it honestly is the point: a descriptor may
 * legitimately name a contract no store implements yet, and an explorer that
 * hid that would describe a workflow which cannot run as one that can.
 */
export const ExplorerTaskBindingWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("bound"),
    storeNamespace: z.string().min(1),
    storeKind: z.enum(["browser", "headless"]),
    /** The driver's system — browser stores only; a headless store owns none. */
    driverSystem: BrowserSystemIdSchema.optional(),
  }),
  z.strictObject({
    state: z.literal("pending"),
    note: z.string().min(1),
  }),
]);
export type ExplorerTaskBindingWire = z.infer<typeof ExplorerTaskBindingWireSchema>;

/** The contract's declared subject binding (doc 01), projected without its schemas. */
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

/**
 * The write-safety declaration of a `commit` contract (doc 09), reduced to the
 * facts that are DATA.
 *
 * `idempotency.key`, `proofFromOutput` and their siblings are authored
 * closures, so the explorer reports the shape they sit in and the source file
 * that owns them — never a rendering of what the function computes. What is
 * genuinely projectable is the whole fail-closed skeleton: which read task
 * probes, which read task verifies, and what the kernel does when the write's
 * proof is ABSENT after the fence.
 */
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
  /** doc 09's reviewed always-park exception, when the contract carries one. */
  unverifiableByPage: z.strictObject({
    policy: z.literal("always-park"),
    reason: z.string().min(1),
  }).optional(),
});
export type ExplorerWriteSafetyWire = z.infer<typeof ExplorerWriteSafetyWireSchema>;

/**
 * A freshness bound, JSON-safe.
 *
 * `FreshnessPolicySchema` admits `Number.POSITIVE_INFINITY`, which
 * `JSON.stringify` turns into `null` — so an unbounded policy crossing this
 * wire as a raw number would arrive as "no value" and read as a MISSING bound
 * rather than a deliberate one. It travels as the word instead.
 */
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
  contractSource: SourceLinkWireSchema,
  /** The store's task implementation, and the fingerprint the manifest gave it. */
  implSource: SourceLinkWireSchema,
  implFingerprint: FingerprintSchema.optional(),
});
export type ExplorerTaskWire = z.infer<typeof ExplorerTaskWireSchema>;

/**
 * The control-shape of a node, one arm per graph node kind.
 *
 * Every arm carries the DOWNSTREAM node ids its controller names (D104's
 * forward references) so the surface can draw the real structure — a branch's
 * cases, a parallel's branches — rather than inferring nesting from `dependsOn`
 * alone, which cannot distinguish "runs after" from "is selected by".
 */
export const ExplorerNodeShapeWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("task"),
    replay: z.enum(["checkpoint", "always-rerun"]),
    /** The node declares a `when` predicate; the closure itself is source-only. */
    conditional: z.boolean(),
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

export const ExplorerNodeWireSchema = z.strictObject({
  id: NodeIdSchema,
  label: z.string().min(1),
  dependsOn: z.array(NodeIdSchema),
  shape: ExplorerNodeShapeWireSchema,
  tasks: z.array(ExplorerTaskWireSchema),
  /** Detail projections (doc 03) this node is the source of. */
  details: z.array(z.strictObject({
    key: z.string().min(1),
    label: z.string().min(1),
    fieldPath: ContractFieldPathSchema,
    display: z.enum(["text", "eid", "date", "count", "badge"]),
  })),
  /** Descriptor-allowlisted Edit Data fields sourced from this node (doc 06 §6.2). */
  editableFields: z.array(z.strictObject({
    fieldPath: ContractFieldPathSchema,
    label: z.string().min(1),
  })),
  /** Graph coverage points this node contributes (doc 12 §3.2). */
  coveragePoints: z.array(z.strictObject({
    id: z.string().min(1),
    kind: z.enum(["branch-case", "gate", "delegation", "transaction"]),
    detail: z.string().min(1),
  })),
});
export type ExplorerNodeWire = z.infer<typeof ExplorerNodeWireSchema>;

/**
 * An edge the surface draws. `depends-on` is the execution edge every node
 * declares; `branch-case` and `parallel-branch` are the CONTROL edges a
 * controller names downstream, and they are kept distinct because they mean
 * different things: one is "after", the others are "instead of" and "alongside".
 */
export const ExplorerEdgeWireSchema = z.strictObject({
  from: NodeIdSchema,
  to: NodeIdSchema,
  kind: z.enum(["depends-on", "branch-case", "parallel-branch"]),
  /** The case or branch name, for the two control kinds. */
  label: z.string().min(1).optional(),
});
export type ExplorerEdgeWire = z.infer<typeof ExplorerEdgeWireSchema>;

/**
 * A registered scenario id and the executable file that walks it.
 *
 * What a scenario CLAIMS to cover is deliberately absent. Those claims live in
 * the executable corpus (`tests/scenario/coverage-claims.ts`), `scenario-coverage`
 * already audits them against the graph in both directions, and `src/` importing
 * a test module to re-serve them would put a second copy of that relationship in
 * the product. The node's own derived coverage points are served instead — those
 * come from the graph, which is where they are true.
 */
export const ExplorerScenarioWireSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  source: SourceLinkWireSchema,
});
export type ExplorerScenarioWire = z.infer<typeof ExplorerScenarioWireSchema>;

export const ExplorerWorkflowWireSchema = z.strictObject({
  id: WorkflowIdSchema,
  label: z.string().min(1),
  code: z.string().min(1),
  icon: z.string().min(1),
  category: z.string().min(1),
  /**
   * The module's declared taxonomy (doc 02 §1.2.1, D219), served RAW beside the
   * category exactly as the bootstrap wire serves it.
   *
   * The explorer is one of the three workflow-listing surfaces D219 names, so
   * it must carry the same fact the rail and the picker do — a surface that had
   * to infer membership from an id prefix would be the second answer that
   * eventually disagrees with the first.
   */
  role: WorkflowModuleRoleSchema,
  version: z.number().int().positive(),
  contractFingerprint: FingerprintSchema,
  /**
   * `SurfaceShape` is either a declared row shape or `by-input`, which resolves
   * per run. The explorer reports which of the two the descriptor declared and
   * never resolves the second against a fabricated input.
   */
  surfaceShape: z.enum(["single", "preview", "operation", "operation-member", "by-input"]),
  enqueue: z.string().min(1),
  /**
   * `inputSubject` is either a constant the descriptor declared or a function
   * of the input. A function's RESULT depends on a run's input, so the explorer
   * reports which of the two it is and never evaluates it against a fabricated
   * input to print a specimen answer.
   */
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
  /** Which operator-facing surfaces this workflow DECLARES (doc 06/doc 03). */
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
    captureIntake: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("declared") }),
      z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    ]),
  }),
  nodes: z.array(ExplorerNodeWireSchema).min(1),
  edges: z.array(ExplorerEdgeWireSchema),
  scenarios: z.array(ExplorerScenarioWireSchema),
  sources: z.strictObject({
    descriptor: SourceLinkWireSchema,
    module: SourceLinkWireSchema,
    /** Every file in the descriptor's fingerprinted source closure. */
    closureFileCount: z.number().int().positive(),
  }),
});
export type ExplorerWorkflowWire = z.infer<typeof ExplorerWorkflowWireSchema>;

/**
 * The whole projection, served in one document.
 *
 * Every registered workflow travels together because the surface's spine needs
 * the list and the payload is static registration metadata — there is no
 * per-workflow authority read to defer, and a second round trip to open a
 * neighbouring workflow would buy nothing.
 */
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
  // The same refusal the bootstrap wire makes (D219): a harness whose `of` is
  // not a composition in THIS document leaves the one grouping rule with a
  // parent it cannot find. The composition root already refuses that shape at
  // load; this is the wire declining to describe a nesting nothing could draw.
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

/** Every task arm across a workflow's nodes, in graph order. */
export function explorerWorkflowTasks(
  workflow: ExplorerWorkflowWire,
): readonly Readonly<{ node: ExplorerNodeWire; task: ExplorerTaskWire }>[] {
  return workflow.nodes.flatMap((node) => node.tasks.map((task) => ({ node, task })));
}

/* ── the generated UI catalog surface (D177) ─────────────────────────────── */

/**
 * The committed `generated/ui-catalog.json`, served as itself.
 *
 * `entries` is the catalog's OWN entry schema — not a reshaped copy — because
 * the surface's whole value is that what an operator reads is byte-for-byte
 * what the guard pins and what `npm run selector:search` searches. A projection
 * that dropped or renamed a field would quietly become a third description of
 * the same registry.
 */
export const UiCatalogWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  /** The tracked artifact this content came from, so the surface can name it. */
  sourcePath: SourcePathSchema,
  schemaVersion: z.literal(1),
  entries: z.array(UiCatalogEntrySchema),
});
export type UiCatalogWire = z.infer<typeof UiCatalogWireSchema>;

/**
 * The catalog's search, defined ONCE so the surface and its tests agree.
 *
 * It matches the fields `npm run selector:search` matches — id, label and the
 * registry's own `searchTerms` — plus the system, because "show me every kuali
 * element" is the question an operator actually arrives with. Matching is
 * case-insensitive substring over whitespace-split terms, and EVERY term must
 * hit: an operator narrowing a 49-entry list expects the second word to filter
 * rather than to widen.
 */
export function matchesUiCatalogQuery(entry: z.output<typeof UiCatalogEntrySchema>, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/u).filter((term) => term.length > 0);
  if (terms.length === 0) return true;
  const haystack = [
    String(entry.id),
    entry.label,
    entry.system,
    entry.kind,
    ...entry.searchTerms,
  ].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
