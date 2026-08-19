/**
 * Descriptor assembly — doc 02 §1.1's `WorkflowDescriptor` and the factory that
 * validates one.
 *
 * A descriptor is ONE client-safe declaration per workflow. Every parallel
 * registry the legacy dashboard hand-maintained (icons, instance labels, input
 * and upload panels, step-label switches, the status index, the `:stop`
 * scripts) becomes a projection of this object, so adding a workflow is one
 * module rather than ten synchronized lists (doc 02 §1.3).
 *
 * The factory is where "derived, not declared" becomes real. `steps`, `gates`,
 * `systems`, and `requires` are computed from the node tuple — a hand-written
 * `systems:` list is exactly the drift D2/D15 deleted. Everything the factory
 * cannot derive it *proves*: detail and artifact paths resolve in the producing
 * node's real output schema, parser fields resolve in the input schema, and
 * identity/presentation/subject run against the audited canonical-input samples
 * so a derive that throws or returns an unusable id fails at build rather than
 * at enqueue.
 */
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "../domain/canonical-json.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
  AnyTaskContract,
} from "../domain/contracts/base.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  NodeIdSchema,
  ScenarioIdSchema,
  WorkflowIdSchema,
} from "../domain/ids.js";
import type { Fingerprint, NodeId, ScenarioId, WorkflowId } from "../domain/ids.js";
import {
  RunDryRunPreviewResultSchema,
  RunResultRecordSchema,
  TerminalDependencyEvidenceSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
  type TerminalDependencyRecord,
} from "../domain/run/result.js";
import { SecretNameSchema } from "../domain/secret-names.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { assertAuditedCanonicalInput, canonicalInputSamples } from "../domain/workflow/canonical-input.js";
import type { CanonicalInputSchema } from "../domain/workflow/canonical-input.js";
import type {
  CompletionConsumptionSpec,
  CompletionProgram,
  CoordinatorPolicy,
  SealedCompletionProgram,
} from "../domain/workflow/completion.js";
import {
  CompletionConsumptionSpecSchema,
  CoordinatorPolicySchema,
} from "../domain/workflow/completion.js";
import { GraphNodeKindSchema, projectTransactionOutcome } from "../domain/workflow/graph.js";
import type { GraphNodeBase, RuntimeFlowNode } from "../domain/workflow/graph.js";
import {
  TransactionDryRunPreviewSchema,
  TransactionOutcomeSchema,
} from "../domain/write-safety-primitives.js";
import { WorkflowSurfacesSchema } from "../domain/workflow/ingress.js";
import type { WorkflowSurfaces } from "../domain/workflow/ingress.js";
import {
  ArtifactSinkIdSchema,
  DetailProjectionSpecRuntimeSchema,
  DurableArtifactProjectionSpecRuntimeSchema,
  EnqueuePolicySchema,
  GateProjectionDefinitionSchema,
  IconNameSchema,
  InputSubjectSchema,
  StepProjectionSchema,
  SubjectProjectionSpecRuntimeSchema,
  SurfaceShapeSchema,
  TimelineCategoryProjectionSchema,
  TimelineCategorySpecSchema,
  VerdictDefinitionSchema,
  WorkflowActionPolicySchema,
  WorkflowCapabilitiesSchema,
  WorkflowCategorySchema,
} from "../domain/workflow/presentation.js";
import type {
  ArtifactSinkId,
  EnqueuePolicy,
  GateProjectionDefinition,
  IconName,
  InputSubject,
  StepProjection,
  SurfaceShape,
  TimelineCategoryProjection,
  VerdictDefinition,
  WorkflowActionPolicy,
  WorkflowCategory,
} from "../domain/workflow/presentation.js";
import { deriveGraphCoveragePoints } from "../domain/workflow/scenario-coverage.js";
import type { GraphCoveragePoint } from "../domain/workflow/scenario-coverage.js";
import {
  assertContractBoundarySchema,
  assertSchemaOffersPath,
  assertSchemaOwnsPath,
} from "../validation/contract-boundary.js";
import type { AnyNodeEntry, BuiltFlow, OutputsOf, WorkflowResultSpec } from "./flow.js";

/* ── the authored halves that stay typed over the graph ──────────────────── */

/**
 * A detail projection names a node the graph actually declares. Typing `nodeId`
 * over `keyof S` is what makes a renamed node a compile error here; the runtime
 * half additionally proves the field path exists in that node's output schema.
 */
export interface DetailProjectionSpec<S> {
  readonly key: string;
  readonly label: string;
  readonly source: Readonly<{ nodeId: keyof S & string; fieldPath: string }>;
  readonly display: "text" | "eid" | "date" | "count" | "badge";
}

/**
 * The one leaf at which THIS graph resolves its subject's display name — the
 * declared seam behind doc 03 §1.2's queue-row title. `nodeId` is typed over
 * `keyof S` exactly as a detail's is, so a renamed node is a compile error
 * here; the factory additionally proves the path is OFFERED by that node's
 * output schema (see `SubjectProjectionSpecRuntimeSchema` for why `offers` and
 * not `owns`).
 */
export interface SubjectProjectionSpec<S> {
  readonly nodeId: keyof S & string;
  readonly fieldPath: string;
}

/**
 * The authored (unbranded) face of `WorkflowCapabilitiesSchema`, the way
 * `DetailProjectionSpec` is the authored face of its runtime schema — the
 * factory parses the value through the schema, so the brands are enforced at
 * definition time without every descriptor literal having to spell them.
 */
export interface WorkflowCapabilitiesSpec {
  readonly review: boolean;
  readonly editData:
    | boolean
    | Readonly<{
      fields: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[];
    }>;
  readonly delegationDisplay?: "inline" | "linked" | "hidden-unless-failed";
}

export interface DurableArtifactProjectionSpec<S> {
  readonly id: string;
  readonly source: Readonly<{ nodeId: keyof S & string; fieldPath: string }>;
  readonly keyFields: readonly [string, ...string[]];
  readonly sink: ArtifactSinkId;
  readonly blocking: true;
}

export interface InputPreset<Input> {
  readonly id: string;
  readonly label: string;
  readonly value: Input;
}

/**
 * The logical-item identity. Retries of the same work share the match key;
 * rerun-with-different-input produces a different one and therefore a fresh
 * item with zero checkpoints by construction.
 *
 * Deviation from doc 02 §1.1, which pairs `matchKey` with a `deriveItemId`
 * returning an `ItemId`. A descriptor is bundle-safe and cannot hash, so it
 * cannot mint a UUID; and two independent derivations of one identity are a
 * drift surface by construction. The descriptor therefore declares the match key
 * only, and the kernel mints `ItemId` from `(workflowId, matchKey)` at enqueue —
 * one derivation, one place. Fan-out `deriveItemId` (doc 03 §4.1) is unaffected:
 * completion derives are server-side.
 */
export interface WorkflowIdentitySpec<Input> {
  readonly matchKey: (input: Input) => string;
}

/**
 * Read a fact a bind depends on, or fail loud naming the node and path.
 *
 * This is the `require()` of doc 02 §8. Substituting a plausible default for a
 * person nobody selected is the charter's single most dangerous pattern, so the
 * only alternative to a value here is a thrown error.
 */
export function requireFact<Value>(
  value: Value | null | undefined,
  nodeId: string,
  path: string,
): Value {
  if (value === null || value === undefined) {
    throw new Error(`workflow bind requires ${nodeId}.${path}, which is ${value === null ? "null" : "absent"}`);
  }
  return value;
}

export interface WorkflowPresentationSpec<Input> {
  readonly title: (input: Input) => string;
  readonly subtitle?: (input: Input) => string;
}

/* ── the descriptor ──────────────────────────────────────────────────────── */

export interface WorkflowDescriptor<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Nodes extends readonly GraphNodeBase[],
  Completion extends CompletionProgram | undefined,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  D extends readonly (keyof S & string)[],
> {
  readonly id: WorkflowId;
  /** Bumped for semantic graph/bind/presentation contract changes. */
  readonly version: number;
  /** Build-manifest derived (doc 02 §1.1); stamped on every run, checkpoint, and span. */
  readonly contractFingerprint: Fingerprint;
  readonly code: string;
  readonly label: string;
  readonly sessionLabel?: string;
  readonly icon: IconName;
  readonly category: WorkflowCategory;
  readonly input: InputSchema;
  readonly canonicalInput: CanonicalInputSchema<InputSchema>;
  readonly result: WorkflowResultSpec<ResultSchema, InputSchema, S, D>;
  readonly inputSubject: InputSubject | ((input: z.output<InputSchema>) => InputSubject);
  readonly surface: SurfaceShape;
  readonly nodes: Nodes;
  readonly surfaces: WorkflowSurfaces;
  readonly verdicts?: readonly VerdictDefinition[];
  readonly completion?: Completion extends CompletionProgram
    ? SealedCompletionProgram<Completion>
    : undefined;
  readonly capabilities?: WorkflowCapabilitiesSpec;
  readonly details: readonly DetailProjectionSpec<S>[];
  /** Doc 03 §1.2: where the RUN resolves the subject's name, if it ever does. */
  readonly subjectProjection?: SubjectProjectionSpec<S>;
  /**
   * D225 — the run-detail timeline's categorical shape, DERIVED by the factory:
   * the spec's declared categories normalized with member labels, or the
   * one-category-per-node default. Always present, always exhaustive.
   */
  readonly timeline: readonly TimelineCategoryProjection[];
  readonly enqueue: EnqueuePolicy;
  readonly actions: WorkflowActionPolicy;
  readonly presets?: readonly InputPreset<z.input<InputSchema>>[];
  readonly identity: WorkflowIdentitySpec<z.output<InputSchema>>;
  readonly presentation: WorkflowPresentationSpec<z.output<InputSchema>>;
  readonly coordinator?: CoordinatorPolicy;
  readonly completionConsumes?: readonly CompletionConsumptionSpec[];
  readonly scenarios: readonly [ScenarioId, ...ScenarioId[]];
  readonly artifactProjections?: readonly DurableArtifactProjectionSpec<S>[];
}

/**
 * The broad runtime view a composition root, projection, or guard switches on.
 *
 * It is declared structurally rather than as `WorkflowDescriptor<z.ZodType, …>`
 * for the same reason `RuntimeFlowNode` is: `S` appears contravariantly in
 * `result.derive` and in `details`' `keyof S`, so an exact descriptor is NOT
 * assignable to a "broad" instantiation of its own generic. This view carries
 * the fields a runtime consumer actually reads, and the exact descriptor is
 * assignable to it. Everything generic — `result`, `identity`, `presentation`,
 * `presets` — stays behind the exact type, where reading it is typed.
 */
export interface AnyWorkflowDescriptor {
  readonly id: WorkflowId;
  readonly version: number;
  readonly contractFingerprint: Fingerprint;
  readonly code: string;
  readonly label: string;
  readonly sessionLabel?: string;
  readonly icon: IconName;
  readonly category: WorkflowCategory;
  readonly input: z.ZodType;
  readonly canonicalInput: z.ZodType;
  readonly inputSubject: InputSubject | ((input: never) => InputSubject);
  readonly surface: SurfaceShape;
  readonly nodes: readonly GraphNodeBase[];
  readonly surfaces: WorkflowSurfaces;
  readonly verdicts?: readonly VerdictDefinition[];
  readonly completion?: Readonly<{ kind: "sealed-completion-program"; mode: string; gate: string }>;
  readonly capabilities?: WorkflowCapabilitiesSpec;
  readonly details: readonly Readonly<{
    key: string;
    label: string;
    source: Readonly<{ nodeId: string; fieldPath: string }>;
    display: string;
  }>[];
  /**
   * Plain data, so it rides the BROAD view (unlike `presentation`, whose title
   * and subtitle are functions of the exact input type). The run/queue
   * projection is the reader, and it holds descriptors as
   * `AnyWorkflowDescriptor`.
   */
  readonly subjectProjection?: Readonly<{ nodeId: string; fieldPath: string }>;
  /** D225 — plain data like `subjectProjection`, so it rides the broad view. */
  readonly timeline: readonly Readonly<{
    label: string;
    nodes: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  readonly enqueue: EnqueuePolicy;
  readonly actions: WorkflowActionPolicy;
  readonly coordinator?: CoordinatorPolicy;
  readonly completionConsumes?: readonly CompletionConsumptionSpec[];
  readonly scenarios: readonly [ScenarioId, ...ScenarioId[]];
  readonly artifactProjections?: readonly Readonly<{
    id: string;
    source: Readonly<{ nodeId: string; fieldPath: string }>;
    keyFields: readonly [string, ...string[]];
    sink: ArtifactSinkId;
    blocking: true;
  }>[];
}

export interface WorkflowDescriptorSpec<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Nodes extends readonly GraphNodeBase[],
  Completion extends CompletionProgram | undefined,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  D extends readonly (keyof S & string)[],
> extends Omit<
  WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D>,
  "id" | "contractFingerprint" | "input" | "result" | "nodes" | "scenarios" | "timeline"
> {
  readonly id: string;
  readonly contractFingerprint: string;
  /** Parsed into branded `ScenarioId`s by the factory, the way contracts do. */
  readonly scenarios: readonly [string, ...string[]];
  /**
   * D225 — the authored form: category labels over node-id lists. Optional; a
   * graph small enough to read per-node declares nothing and gets the default.
   * If declared, the factory demands it name every node exactly once. Plain
   * strings here — the factory parses them into branded node ids the same way
   * it parses scenario ids.
   */
  readonly timeline?: readonly Readonly<{ label: string; nodes: readonly string[] }>[];
  /** The built graph — its exact node tuple, result spec, and accumulators. */
  readonly flow: BuiltFlow<InputSchema, ResultSchema, Nodes, S, D>;
}

/* ── derived projections (doc 03 reads these; nobody hand-writes them) ───── */

export interface WorkflowProjections {
  readonly steps: readonly StepProjection[];
  readonly gates: readonly GateProjectionDefinition[];
  /** Browser systems only — service and `workflow:<id>` stores contribute none (D2/D15). */
  readonly systems: readonly string[];
  readonly requires: readonly string[];
  readonly coveragePoints: readonly GraphCoveragePoint[];
  /** Registered graph scenarios unioned with every used task contract's scenarios. */
  readonly scenarios: readonly ScenarioId[];
  readonly contracts: readonly AnyTaskContract[];
  /** D209 — whether this GRAPH can be previewed, and where a preview stops. */
  readonly dryRun: WorkflowDryRunSupport;
}

/**
 * D209 — dry-runnability is a property of the GRAPH, not of the start surface.
 *
 * The question a start plan asks is "can this workflow be run without touching a
 * live HR system", and only the node tuple can answer it: a transaction node is
 * the one node kind that can commit externally, and its own `dryRun` declaration
 * says whether it has a preview arm. Binding the answer to
 * `surfaces.inputRun?.supportsDryRun` bound it instead to whether an operator can
 * paste a line into a textbox, which is why all three registered write workflows
 * — every one of them `surfaces: {}` by design — were structurally un-previewable
 * through the pipeline (`docs/migrations/separations.md` §9.9 gap 1).
 *
 * A graph with NO transaction node is `no-transaction-node`, which is a REFUSAL
 * and not a trivial yes: a dry run of such a graph is byte-for-byte an ordinary
 * run, so answering "supported" would silently redefine what the operator asked
 * for. Refusing names the reason instead.
 */
export type WorkflowDryRunSupport =
  | Readonly<{
    state: "supported";
    /** The first transaction node; a preview stops there (doc 01 §10.1). */
    stopsAt: string;
  }>
  | Readonly<{ state: "unsupported"; reason: "no-transaction-node" }>
  | Readonly<{
    state: "unsupported";
    reason: "node-declares-unsupported";
    /** The FIRST transaction node that declares no preview arm. */
    nodeId: string;
  }>;

/**
 * Every transaction node must declare `stop-after-prepare`, not just the first
 * one a preview would reach. A graph whose second write says `unsupported` is a
 * graph that cannot be previewed to its end, and reporting it as previewable
 * because the run happens to stop earlier is the same class of true-about-the-
 * wrong-thing statement D205 was written about. The first offender is named.
 */
function deriveDryRunSupport(nodes: readonly RuntimeFlowNode[]): WorkflowDryRunSupport {
  const transactions = nodes.filter((node) => node.kind === "transaction");
  const [first] = transactions;
  if (first === undefined) return Object.freeze({ state: "unsupported", reason: "no-transaction-node" });
  for (const node of transactions) {
    if (node.dryRun !== "stop-after-prepare") {
      return Object.freeze({ state: "unsupported", reason: "node-declares-unsupported", nodeId: String(node.id) });
    }
  }
  return Object.freeze({ state: "supported", stopsAt: String(first.id) });
}

/** The ONE derivation every consumer shares — the projection computes it once. */
export function workflowDryRunSupport(descriptor: AnyWorkflowDescriptor): WorkflowDryRunSupport {
  return workflowProjections(descriptor).dryRun;
}

/**
 * The typed reads a planner needs, captured while the exact generic type is
 * still in scope.
 *
 * `AnyWorkflowDescriptor` deliberately omits `identity` and `presentation`
 * because `S` appears contravariantly in them, so a runtime consumer holding the
 * broad view cannot call them without an assertion. Closing over the exact
 * descriptor at definition time is the alternative to that assertion: each
 * function below re-parses its argument through the descriptor's own canonical
 * schema before handing it to the authored callback, so a wrong value fails
 * loud here rather than reaching a bind.
 */
export interface WorkflowPlanning {
  readonly parseInput: (raw: unknown) => unknown;
  readonly parseCanonicalInput: (value: unknown) => unknown;
  readonly matchKey: (parsed: unknown) => string;
  readonly title: (parsed: unknown) => string;
  readonly subtitle: (parsed: unknown) => string | undefined;
  readonly inputSubject: (parsed: unknown) => InputSubject;
}

/**
 * Factory-authenticated terminal-result execution data. The broad executor
 * reads dependency metadata here; exact typed derivation and its opaque
 * authorization seal remain inside the descriptor factory.
 */
export interface WorkflowTerminalResultExecution<Input = never, Outputs = never, Result = unknown> {
  readonly schema: z.ZodType;
  readonly schemaHash: Fingerprint;
  readonly dependsOn: readonly NodeId[];
  readonly dependencies: readonly Readonly<{
    nodeId: NodeId;
    notRunReason?: "condition-false" | "branch-not-selected";
  }>[];
  readonly parseResult: (candidate: unknown) => unknown;
  readonly derive: (scope: Readonly<{ input: Input; outputs: Outputs }>) => Result;
  readonly build: (
    currentRun: WorkflowTerminalRun,
    evidence: unknown,
    clock: TerminalResultClock,
  ) => Readonly<{ record: RunResultRecord; authorization: object }>;
  /**
   * D210 — the terminal record of a run that stopped at its transaction node
   * under `envelope.dryRun`. It shares `build`'s seal and every identity check;
   * what it does NOT share is the authored `derive`, because a preview has no
   * commit output to fold and inventing one is the banned fabrication.
   */
  readonly buildPreview: (
    currentRun: WorkflowTerminalRun,
    preview: unknown,
    evidence: unknown,
    clock: TerminalResultClock,
  ) => Readonly<{ record: RunResultRecord; authorization: object }>;
}

/** Structural executor view; core owns strict RunRecord parsing before this boundary. */
interface WorkflowTerminalRun {
  readonly envelope: Readonly<{
    runId: string;
    itemId: string;
    workflow: string;
    attempt: number;
    descriptorVersion: number;
    contractFingerprint: string;
    configFingerprint: string;
    configSnapshotId: string;
    /** D210 — the one durable record of what the operator asked for (D6). */
    dryRun: boolean;
  }>;
  readonly input: Readonly<{
    parsed: Readonly<{ schemaHash: string; value: unknown }>;
  }>;
  readonly lifecycle: Readonly<{ state: string }>;
  readonly version: number;
}

interface TerminalResultClock {
  now(): Date;
}

const PROJECTIONS = new WeakMap<object, WorkflowProjections>();
const PLANNING = new WeakMap<object, WorkflowPlanning>();
const RUNTIME_NODES = new WeakMap<object, readonly RuntimeFlowNode[]>();
const TERMINAL_RESULTS = new WeakMap<object, WorkflowTerminalResultExecution>();
const RUN_RESULT_AUTHORIZATIONS = new WeakMap<
  object,
  Readonly<{ result: string; currentRun: string }>
>();

/**
 * Prove that an initial success was constructed by an exact descriptor's
 * sealed derive path. The token has no structural fields to forge; membership
 * in this module-private WeakMap is the authority.
 */
export function assertWorkflowRunResultAuthorization(
  authorization: object | undefined,
  result: RunResultRecord,
  currentRun: object,
): void {
  const sealed = authorization === undefined
    ? undefined
    : RUN_RESULT_AUTHORIZATIONS.get(authorization);
  if (sealed === undefined
    || sealed.result !== canonicalJsonStringify(result)
    || sealed.currentRun !== canonicalJsonStringify(currentRun)) {
    throw new Error(
      `run result ${result.runId} lacks factory-authenticated terminal-result authorization`,
    );
  }
}

/** The planning view captured when the descriptor was built. Fails loud if it was not. */
export function workflowPlanning(descriptor: object): WorkflowPlanning {
  const planning = PLANNING.get(descriptor);
  if (planning === undefined) {
    throw new Error("workflow planning is only available for a descriptor built by defineWorkflowDescriptor");
  }
  return planning;
}

/** The projections derived when the descriptor was built. Fails loud if it was not. */
export function workflowProjections(descriptor: object): WorkflowProjections {
  const projections = PROJECTIONS.get(descriptor);
  if (projections === undefined) {
    throw new Error("workflow projections require the exact object returned by defineWorkflowDescriptor");
  }
  return projections;
}

/** The sealed terminal-result view; copied or hand-built descriptors fail loud. */
export function workflowTerminalResultExecution<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Nodes extends readonly GraphNodeBase[],
  Completion extends CompletionProgram | undefined,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  D extends readonly (keyof S & string)[],
>(descriptor: WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D>):
  WorkflowTerminalResultExecution<z.output<InputSchema>, OutputsOf<Pick<S, D[number]>>, z.input<ResultSchema>>;
export function workflowTerminalResultExecution(descriptor: object): WorkflowTerminalResultExecution;
export function workflowTerminalResultExecution(descriptor: object): unknown {
  const execution = TERMINAL_RESULTS.get(descriptor);
  if (execution === undefined) {
    throw new Error("workflow terminal results require the exact object returned by defineWorkflowDescriptor");
  }
  return execution;
}

/** Invoke the exact authored derive only after the descriptor identity is authenticated. */
export function deriveWorkflowTerminalResult<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Nodes extends readonly GraphNodeBase[],
  Completion extends CompletionProgram | undefined,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  D extends readonly (keyof S & string)[],
>(
  descriptor: WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D>,
  scope: Parameters<WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D>["result"]["derive"]>[0],
): z.input<ResultSchema> {
  return workflowTerminalResultExecution(descriptor).derive(scope);
}

/* ── runtime node view ───────────────────────────────────────────────────── */

/**
 * The one place the exact node tuple is widened to the runtime switch union.
 * Doc 02 §1.1 allows exactly this direction: the composition root switches
 * exhaustively at runtime, and the widened view is never fed back into
 * descriptor inference. `kind` is re-parsed first, so a hand-rolled node object
 * that skipped the builder is rejected instead of falling through a switch.
 */
function runtimeNodes(nodes: readonly GraphNodeBase[]): readonly RuntimeFlowNode[] {
  for (const node of nodes) {
    GraphNodeKindSchema.parse(node.kind);
    NodeIdSchema.parse(node.id);
  }
  return nodes as readonly RuntimeFlowNode[];
}

function contractsOf(node: RuntimeFlowNode): readonly AnyTaskContract[] {
  switch (node.kind) {
    case "task": return [node.uses];
    case "transaction": return [node.prepare.uses, node.commit.uses];
    default: return [];
  }
}

/**
 * "Which schema owns this node's output FIELD PATHS" — the question a detail or
 * surface asks. For a transaction node that is the COMMIT contract's output,
 * because a detail names `savedState.timekeeperName`, not the kernel wrapper
 * around it. This is deliberately NOT the same question as "which schema is this
 * node's durable checkpoint bound to" (see `terminalEvidenceOf`); conflating the
 * two is what left a transaction node unable to be a terminal dependency (D144).
 */
function outputSchemaOf(node: RuntimeFlowNode): z.ZodType | undefined {
  switch (node.kind) {
    case "task": return node.uses.output;
    case "transaction": return node.commit.uses.output;
    case "gate": return node.result;
    default: return undefined;
  }
}

/**
 * D144 — what a node's DURABLE checkpoint is bound to, and how that stored value
 * becomes the scope value the authored `derive` reads.
 *
 * For a task or gate the two coincide: the row stores the contract's own parsed
 * output under that schema's hash, and the scope value is that output verbatim.
 *
 * For a transaction node they do not, and the row is right: doc 09 beat ⑦ stores
 * the full durable `TransactionOutcome`, so the row's `output.schemaHash` is that
 * envelope's hash — the only hash that truthfully describes the bytes stored.
 * Demanding the commit contract's bare output hash here would have required a
 * checkpoint the sequencer never wrote, which D110/D114 forbid outright. The
 * commit contract's identity is not lost, it is checked one level down by
 * `projectTransactionOutcome`, which then lowers the envelope onto the
 * `TypedTransactionOutcome<C>` shape the descriptor authored against — the same
 * shape the interpreter puts in every other consumer's scope.
 */
type TerminalEvidenceBinding = Readonly<{
  /** The schema the durable checkpoint row is bound to. */
  checkpointSchema: z.ZodType;
  /** Durable value → the scope value handed to `derive`. Fails loud on drift. */
  project: (storedValue: unknown, context: string) => unknown;
}>;

function terminalEvidenceOf(node: RuntimeFlowNode): TerminalEvidenceBinding | undefined {
  switch (node.kind) {
    case "task":
      return { checkpointSchema: node.uses.output, project: (value) => node.uses.output.parse(value) };
    case "gate":
      return { checkpointSchema: node.result, project: (value) => node.result.parse(value) };
    case "transaction": {
      const commit = node.commit.uses;
      return {
        checkpointSchema: TransactionOutcomeSchema,
        project: (value, context) => projectTransactionOutcome(commit, value, context),
      };
    }
    default: return undefined;
  }
}

function labelOf(node: RuntimeFlowNode): string {
  switch (node.kind) {
    case "task": return node.label ?? node.uses.title;
    case "transaction": return node.label ?? node.commit.uses.title;
    case "gate": return node.label;
    default: return node.id;
  }
}

function deriveSteps(nodes: readonly RuntimeFlowNode[]): readonly StepProjection[] {
  const steps: StepProjection[] = [];
  for (const node of nodes) {
    if (node.kind === "transaction") {
      const base = node.label ?? node.commit.uses.title;
      steps.push(StepProjectionSchema.parse({
        key: `${node.id}/prepare`, nodeId: node.id, label: `${base} — prepare`,
        kind: "prepare", taskId: node.prepare.uses.id, conditional: false,
      }));
      steps.push(StepProjectionSchema.parse({
        key: `${node.id}/commit`, nodeId: node.id, label: `${base} — commit`,
        kind: "commit", taskId: node.commit.uses.id, conditional: false,
      }));
      continue;
    }
    steps.push(StepProjectionSchema.parse({
      key: node.id,
      nodeId: node.id,
      label: labelOf(node),
      kind: node.kind,
      ...(node.kind === "task" ? { taskId: node.uses.id } : {}),
      conditional: node.kind === "task" && node.when !== undefined,
    }));
  }
  return Object.freeze(steps);
}

/**
 * D225 — normalize the declared timeline categories, or derive the per-node
 * default. A declared timeline is EXHAUSTIVE: every node appears in exactly one
 * category, checked here so a node cannot silently vanish from the surface
 * whose whole job is to say what a run does. Gate and transaction nodes are
 * ordinary members — a gate folds into its category as the waiting state
 * rather than taking a segment of its own (the demo's "a wait is a state of a
 * step, not a step of its own").
 */
function deriveTimeline(
  id: string,
  nodes: readonly RuntimeFlowNode[],
  declared: readonly Readonly<{ label: string; nodes: readonly string[] }>[] | undefined,
): readonly TimelineCategoryProjection[] {
  if (declared === undefined) {
    return Object.freeze(nodes.map((node) => TimelineCategoryProjectionSchema.parse({
      label: labelOf(node),
      nodes: [{ id: node.id, label: labelOf(node) }],
    })));
  }
  const labelByNode = new Map(nodes.map((node) => [String(node.id), labelOf(node)]));
  const seen = new Set<string>();
  const categories = declared.map((category) => {
    const parsed = TimelineCategorySpecSchema.parse(category);
    return TimelineCategoryProjectionSchema.parse({
      label: parsed.label,
      nodes: parsed.nodes.map((nodeId) => {
        const label = labelByNode.get(String(nodeId));
        if (label === undefined) {
          throw new Error(`${id}: timeline category "${parsed.label}" names undeclared node ${String(nodeId)}`);
        }
        if (seen.has(String(nodeId))) {
          throw new Error(`${id}: timeline categories name node ${String(nodeId)} twice`);
        }
        seen.add(String(nodeId));
        return { id: nodeId, label };
      }),
    });
  });
  const missing = nodes.map((node) => String(node.id)).filter((nodeId) => !seen.has(nodeId));
  if (missing.length > 0) {
    throw new Error(
      `${id}: a declared timeline is exhaustive (D225) and this one does not cover: ${missing.join(", ")}`,
    );
  }
  assertUnique(id, "timeline category labels", categories.map((category) => category.label));
  return Object.freeze(categories);
}

function deriveGates(nodes: readonly RuntimeFlowNode[]): readonly GateProjectionDefinition[] {
  return Object.freeze(nodes.filter((node) => node.kind === "gate").map((node) =>
    GateProjectionDefinitionSchema.parse({
      nodeId: node.id,
      label: node.label,
      ...(node.statusKey === undefined ? {} : { statusKey: node.statusKey }),
      resolvedBy: node.resolvedBy,
    })));
}

function systemOf(taskId: string): string {
  return taskId.slice(0, taskId.indexOf("/"));
}

/* ── validation ──────────────────────────────────────────────────────────── */

function assertContractPlacement(id: string, nodes: readonly RuntimeFlowNode[]): void {
  for (const node of nodes) {
    if (node.kind === "task") {
      const effect: string = node.uses.effect;
      if (effect !== "read") {
        throw new Error(`${id}: step ${node.id} uses a ${effect} contract; only transactions may`);
      }
    }
    if (node.kind !== "transaction") continue;
    if (node.prepare.uses.effect !== "prepare") {
      throw new Error(`${id}: transaction ${node.id} prepare arm is not a prepare contract`);
    }
    if (node.commit.uses.effect !== "commit") {
      throw new Error(`${id}: transaction ${node.id} commit arm is not a commit contract`);
    }
    if (systemOf(node.prepare.uses.id) !== systemOf(node.commit.uses.id)) {
      throw new Error(`${id}: transaction ${node.id} pairs arms from two systems`);
    }
  }
}

function assertUnique(id: string, label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error(`${id}: ${label} must be unique`);
}

function nodeByIdOrThrow(
  id: string,
  nodes: readonly RuntimeFlowNode[],
  nodeId: string,
  owner: string,
): RuntimeFlowNode {
  const node = nodes.find((candidate) => candidate.id === NodeIdSchema.parse(nodeId));
  if (node === undefined) throw new Error(`${id}: ${owner} names undeclared node ${nodeId}`);
  return node;
}

function assertNodeFieldPath(
  id: string,
  nodes: readonly RuntimeFlowNode[],
  nodeId: string,
  fieldPath: string,
  owner: string,
  unionRule: "owns" | "offers" = "owns",
): void {
  const node = nodeByIdOrThrow(id, nodes, nodeId, owner);
  const schema = outputSchemaOf(node);
  if (schema === undefined) {
    throw new Error(`${id}: ${owner} reads ${node.kind} node ${nodeId}, which owns no output schema`);
  }
  if (unionRule === "offers") assertSchemaOffersPath(schema, fieldPath, `${id}: ${owner}`);
  else assertSchemaOwnsPath(schema, fieldPath, `${id}: ${owner}`);
}

function assertSurfaceFields(id: string, input: z.ZodType, surfaces: WorkflowSurfaces): void {
  const inputRun = surfaces.inputRun;
  if (inputRun !== undefined) {
    for (const rule of inputRun.parser.rules) {
      assertSchemaOffersPath(input, rule.emit, `${id}: input-run parser rule`);
    }
    for (const constant of inputRun.parser.constants ?? []) {
      assertSchemaOffersPath(input, constant.field, `${id}: input-run parser constant`);
    }
  }
  const uploadRun = surfaces.uploadRun;
  if (uploadRun !== undefined) {
    for (const field of uploadRun.fields) {
      assertSchemaOffersPath(input, field.field, `${id}: upload field`);
    }
  }
}

/* ── the factory ─────────────────────────────────────────────────────────── */

export function defineWorkflowDescriptor<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  const Nodes extends readonly GraphNodeBase[],
  Completion extends CompletionProgram | undefined,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  const D extends readonly (keyof S & string)[],
>(
  spec: WorkflowDescriptorSpec<InputSchema, ResultSchema, Nodes, Completion, S, D>,
): WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D> {
  const id = WorkflowIdSchema.parse(spec.id);
  const contractFingerprint = FingerprintSchema.parse(spec.contractFingerprint);
  if (!/^[a-z0-9]{2}$/.test(spec.code)) {
    throw new Error(`${id}: code must be exactly two lowercase alphanumeric characters`);
  }
  if (spec.label.trim().length === 0) throw new Error(`${id}: label is required`);
  if (!Number.isInteger(spec.version) || spec.version < 1) {
    throw new Error(`${id}: version must be a positive integer`);
  }
  IconNameSchema.parse(spec.icon);
  WorkflowCategorySchema.parse(spec.category);
  SurfaceShapeSchema.parse(spec.surface);
  EnqueuePolicySchema.parse(spec.enqueue);
  WorkflowActionPolicySchema.parse(spec.actions);
  WorkflowSurfacesSchema.parse(spec.surfaces);
  if (spec.capabilities !== undefined) WorkflowCapabilitiesSchema.parse(spec.capabilities);
  if (spec.coordinator !== undefined) CoordinatorPolicySchema.parse(spec.coordinator);
  if (typeof spec.inputSubject === "string") InputSubjectSchema.parse(spec.inputSubject);
  assertAuditedCanonicalInput(spec.canonicalInput);

  const nodes = runtimeNodes(spec.flow.nodes);
  assertContractPlacement(id, nodes);

  // The terminal result and every gate result are durable, replayable values —
  // a parent reads the first as its child's typed output, and the second is
  // stored run-state a resume re-parses. Both go through the same recursive
  // strictness audit as a contract boundary, so neither can carry an open
  // record, an `any`, or a value SQLite cannot round-trip.
  assertContractBoundarySchema(spec.flow.result.schema, `${id}: workflow result`);
  for (const node of nodes) {
    if (node.kind === "gate") assertContractBoundarySchema(node.result, `${id}: gate ${node.id} result`);
  }

  const steps = deriveSteps(nodes);
  assertUnique(id, "step keys", steps.map((step) => step.key));
  const gates = deriveGates(nodes);
  assertUnique(id, "gate node ids", gates.map((gate) => gate.nodeId));
  assertUnique(
    id,
    "gate status keys",
    gates.flatMap((gate) => gate.statusKey === undefined ? [] : [gate.statusKey]),
  );

  for (const verdict of spec.verdicts ?? []) VerdictDefinitionSchema.parse(verdict);
  assertUnique(id, "verdict keys", (spec.verdicts ?? []).map((verdict) => verdict.key));

  /**
   * D227 — a declared `when` names a real field of a real schema, checked here
   * the same way a detail's path is. The closure form could only fail at run
   * time, on the one run whose input finally reached the node; a declaration is
   * refused at `defineWorkflowDescriptor`, which is module load and therefore
   * every test.
   *
   * `owns` for the arms that read a VALUE (a condition reading a field only one
   * union arm carries would throw mid-run on the other arm) and `offers` for
   * `is-present` / `is-absent`, whose entire question is whether the field is
   * there.
   */
  for (const node of nodes) {
    if (node.kind !== "task" || node.when === undefined) continue;
    const condition = node.when;
    const rule = condition.kind === "is-present" || condition.kind === "is-absent"
      ? "offers" as const
      : "owns" as const;
    const owner = `node "${String(node.id)}" when`;
    if (condition.of.from === "input") {
      if (rule === "offers") assertSchemaOffersPath(spec.flow.input, String(condition.of.path), `${id}: ${owner}`);
      else assertSchemaOwnsPath(spec.flow.input, String(condition.of.path), `${id}: ${owner}`);
      continue;
    }
    const upstream = String(condition.of.nodeId);
    if (!node.dependsOn.map(String).includes(upstream)) {
      throw new Error(
        `${id}: ${owner} reads node ${upstream}, which it does not depend on — `
        + "the condition would be evaluated before that node had an answer",
      );
    }
    assertNodeFieldPath(id, nodes, upstream, String(condition.of.path), owner, rule);
  }

  for (const detail of spec.details) {
    DetailProjectionSpecRuntimeSchema.parse(detail);
    assertNodeFieldPath(id, nodes, detail.source.nodeId, detail.source.fieldPath, `detail "${detail.key}"`);
  }
  assertUnique(id, "detail keys", spec.details.map((detail) => detail.key));

  /**
   * Doc 03 §1.2's subject seam. `offers` on purpose: a resolved subject name
   * lives on one arm of a present/absent union far more often than not, and
   * that absent arm IS the "the run has not resolved a subject" state the queue
   * projection reads as *keep the title the start input composed*.
   */
  if (spec.subjectProjection !== undefined) {
    SubjectProjectionSpecRuntimeSchema.parse(spec.subjectProjection);
    assertNodeFieldPath(
      id,
      nodes,
      spec.subjectProjection.nodeId,
      spec.subjectProjection.fieldPath,
      "subject projection",
      "offers",
    );
  }

  const editData = spec.capabilities?.editData;
  if (typeof editData === "object") {
    // Doc 06 §6.2/§6.3 (D166): every declared editable path must resolve
    // through the producing node's own output schema — a path the schema does
    // not own could never re-parse — and only a READ task node's output is
    // correctable: a transaction node's output is a write proof, and proof
    // fields are structurally non-editable.
    for (const field of editData.fields) {
      const owner = nodeByIdOrThrow(id, nodes, field.nodeId, "editData field");
      if (owner.kind !== "task") {
        throw new Error(
          `${id}: editData field "${field.fieldPath}" names node "${String(field.nodeId)}" of kind `
          + `"${owner.kind}"; only a read task node's output is correctable — write proofs never are`,
        );
      }
      if (owner.replay !== "checkpoint") {
        // An always-rerun node structurally never replays its checkpoint, so a
        // correction to it could never be consumed — the executor would refuse
        // the leftover patch at resume. Refusing the DECLARATION is earlier
        // and clearer than refusing every save made against it.
        throw new Error(
          `${id}: editData field "${field.fieldPath}" names node "${String(field.nodeId)}" with replay `
          + `"${owner.replay}"; only a checkpoint-replayed node's recorded output is correctable — `
          + "an always-rerun node takes its value from the live read",
        );
      }
      // `offers`, not `owns`: a correctable value routinely sits on one arm of
      // a present/absent union, and the save re-parses the WHOLE post-patch
      // output — a patch naming an arm the stored outcome does not hold fails
      // there, loudly, against the actual bytes rather than the declaration.
      assertNodeFieldPath(id, nodes, field.nodeId, field.fieldPath, "editData field", "offers");
    }
  }

  for (const projection of spec.artifactProjections ?? []) {
    DurableArtifactProjectionSpecRuntimeSchema.parse(projection);
    ArtifactSinkIdSchema.parse(projection.sink);
    const owner = `artifact projection "${projection.id}"`;
    assertNodeFieldPath(id, nodes, projection.source.nodeId, projection.source.fieldPath, owner);
    const node = nodeByIdOrThrow(id, nodes, projection.source.nodeId, owner);
    const schema = outputSchemaOf(node);
    if (schema === undefined) throw new Error(`${id}: ${owner} reads a node with no output schema`);
    for (const keyField of projection.keyFields) {
      assertSchemaOwnsPath(schema, keyField, `${id}: ${owner} key field`);
    }
  }
  assertUnique(id, "artifact projection ids", (spec.artifactProjections ?? []).map((entry) => entry.id));

  for (const preset of spec.presets ?? []) {
    if (preset.label.trim().length === 0) throw new Error(`${id}: preset "${preset.id}" has no label`);
    spec.flow.input.parse(preset.value);
  }
  assertUnique(id, "preset ids", (spec.presets ?? []).map((preset) => preset.id));

  const consumes = spec.completionConsumes ?? [];
  for (const consumption of consumes) CompletionConsumptionSpecSchema.parse(consumption);
  if (consumes.length > 1) {
    throw new Error(`${id}: a coordinator declares at most one completion consumption rule`);
  }

  assertSurfaceFields(id, spec.flow.input, spec.surfaces);

  // The identity/presentation proof stays inside the factory so `spec` keeps
  // its exact `InputSchema`: a helper would have to widen the parsed value, and
  // a widened value proves nothing about the functions that consume it.
  for (const [index, sample] of canonicalInputSamples(spec.canonicalInput).entries()) {
    const parsed = spec.canonicalInput.parse(sample);
    const where = `${id}: canonical input sample ${String(index)}`;
    const matchKey = spec.identity.matchKey(parsed);
    if (matchKey.trim().length === 0) throw new Error(`${where} produced an empty match key`);
    if (spec.identity.matchKey(parsed) !== matchKey) {
      throw new Error(`${where} match key is not stable across two calls`);
    }
    if (spec.presentation.title(parsed).trim().length === 0) {
      throw new Error(`${where} produced an empty presentation title`);
    }
    const subtitle = spec.presentation.subtitle;
    if (subtitle !== undefined && subtitle(parsed).trim().length === 0) {
      throw new Error(`${where} produced an empty presentation subtitle`);
    }
    if (typeof spec.inputSubject === "function") InputSubjectSchema.parse(spec.inputSubject(parsed));
  }

  const [firstScenario, ...restScenarios] = spec.scenarios;
  const declaredScenarios: readonly [ScenarioId, ...ScenarioId[]] = [
    ScenarioIdSchema.parse(firstScenario),
    ...restScenarios.map((scenario) => ScenarioIdSchema.parse(scenario)),
  ];
  assertUnique(id, "scenarios", declaredScenarios);

  const contracts = nodes.flatMap(contractsOf);
  const scenarios = Object.freeze([...new Set([
    ...declaredScenarios,
    ...contracts.flatMap((contract) => contract.scenarios.map((scenario) => ScenarioIdSchema.parse(scenario))),
  ])]);
  const systems = Object.freeze([...new Set(contracts
    .map((contract) => systemOf(contract.id))
    .filter((system) => BrowserSystemIdSchema.safeParse(system).success))].sort());
  const requires = Object.freeze([...new Set(contracts
    .flatMap((contract) => contract.requires ?? [])
    .map((name) => SecretNameSchema.parse(name)))].sort());

  const dryRun = deriveDryRunSupport(nodes);
  /**
   * D209 — `supportsDryRun` is DERIVED here and may not be authored. The
   * dashboard's run-start surface composes `surfaces.inputRun` client-side off
   * the bundled descriptor, so the flag has to keep existing where that reader
   * looks; what changes is that the graph, not the author, decides its value.
   * An authored one is refused rather than overwritten — silently replacing a
   * declaration is how a descriptor comes to say one thing and mean another.
   */
  if (spec.surfaces.inputRun !== undefined && "supportsDryRun" in spec.surfaces.inputRun) {
    throw new Error(
      `${id}: surfaces.inputRun.supportsDryRun is derived from the graph (D209) and cannot be authored; `
      + "delete it — whether this workflow can be previewed is decided by its transaction nodes",
    );
  }
  const surfaces = Object.freeze({
    ...spec.surfaces,
    ...(spec.surfaces.inputRun === undefined
      ? {}
      : { inputRun: Object.freeze({ ...spec.surfaces.inputRun, supportsDryRun: dryRun.state === "supported" }) }),
  });
  const descriptor: WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D> = Object.freeze({
    ...spec,
    id,
    contractFingerprint,
    surfaces,
    input: spec.flow.input,
    result: spec.flow.result,
    nodes: spec.flow.nodes,
    scenarios: declaredScenarios,
    timeline: deriveTimeline(id, nodes, spec.timeline),
  });
  PROJECTIONS.set(descriptor, Object.freeze({
    steps,
    gates,
    systems,
    requires,
    coveragePoints: deriveGraphCoveragePoints(nodes),
    scenarios,
    dryRun,
    contracts: Object.freeze(contracts),
  }));
  PLANNING.set(descriptor, Object.freeze({
    parseInput: (raw: unknown) => spec.flow.input.parse(raw),
    parseCanonicalInput: (value: unknown) => spec.canonicalInput.parse(value),
    matchKey: (parsed: unknown) => spec.identity.matchKey(spec.canonicalInput.parse(parsed)),
    title: (parsed: unknown) => spec.presentation.title(spec.canonicalInput.parse(parsed)),
    subtitle: (parsed: unknown) => spec.presentation.subtitle?.(spec.canonicalInput.parse(parsed)),
    inputSubject: (parsed: unknown) => (typeof spec.inputSubject === "string"
      ? spec.inputSubject
      : spec.inputSubject(spec.canonicalInput.parse(parsed))),
  }));
  RUNTIME_NODES.set(descriptor, nodes);
  const terminalDependsOn = spec.flow.result.dependsOn.map((nodeId) => NodeIdSchema.parse(nodeId));
  assertUnique(id, "terminal result dependencies", terminalDependsOn);
  const branchTargets = new Set(nodes.flatMap((node) => node.kind === "branch"
    ? Object.values(node.cases).flat()
    : []));
  /**
   * The factory-authenticated dependency SPEC for an arbitrary node-id list —
   * which nodes are expected, and the one closed `not-run` reason each may
   * legitimately carry. `build` asks it for the terminal `dependsOn`; D210's
   * `buildPreview` asks it for the transaction node's own `dependsOn`, which is
   * the exact set that node's `prepare`/`commit` binds read. ONE implementation
   * on purpose: a second copy would be a second answer to disagree with.
   */
  const dependencySpecFor = (
    nodeIds: readonly NodeId[],
    purpose: string,
  ): WorkflowTerminalResultExecution["dependencies"] => Object.freeze(
    nodeIds.map((nodeId) => {
      const node = nodeByIdOrThrow(id, nodes, nodeId, purpose);
      if (terminalEvidenceOf(node) === undefined) {
        throw new Error(`${id}: ${purpose} dependency ${nodeId} owns no output schema`);
      }
      const isBranchTarget = branchTargets.has(nodeId);
      const hasWhen = node.kind === "task" && node.when !== undefined;
      if (isBranchTarget && hasWhen) {
        throw new Error(
          `${id}: ${purpose} dependency ${nodeId} has both branch and when conditionality; `
          + "its durable not-run reason would be ambiguous",
        );
      }
      return Object.freeze({
        nodeId,
        ...(isBranchTarget
          ? { notRunReason: "branch-not-selected" as const }
          : hasWhen ? { notRunReason: "condition-false" as const } : {}),
      });
    }),
  );
  const terminalDependencies = dependencySpecFor(terminalDependsOn, "terminal result");
  /**
   * Every identity check a terminal settlement makes about the RUN itself,
   * shared by `build` and D210's `buildPreview` so the two can never diverge on
   * what "this run may settle against this descriptor" means.
   */
  const assertTerminalRunBinding = (currentRun: WorkflowTerminalRun): z.output<typeof spec.canonicalInput> => {
    if (currentRun.lifecycle.state !== "running") {
      throw new Error(
        `run ${currentRun.envelope.runId} is ${currentRun.lifecycle.state}; `
        + "only a running claimed run can build a terminal result",
      );
    }
    if (currentRun.envelope.workflow !== descriptor.id
      || currentRun.envelope.descriptorVersion !== descriptor.version
      || currentRun.envelope.contractFingerprint !== descriptor.contractFingerprint) {
      throw new Error(`run ${currentRun.envelope.runId} is not bound to descriptor ${descriptor.id}`);
    }
    const canonicalInputSchemaHash = deriveSchemaHash(spec.canonicalInput, "output");
    if (currentRun.input.parsed.schemaHash !== canonicalInputSchemaHash) {
      throw new Error(
        `run ${currentRun.envelope.runId} canonical input schema ${currentRun.input.parsed.schemaHash} `
        + `does not match descriptor schema ${canonicalInputSchemaHash}`,
      );
    }
    return spec.canonicalInput.parse(currentRun.input.parsed.value);
  };

  /**
   * Resolve caller-supplied evidence against a factory-authenticated dependency
   * spec, producing both the durable dependency identities and the scope values.
   * `purpose` only names the thing in refusals; the CHECKS are identical, which
   * is the point — a preview's upstream facts are held to exactly the bar a
   * terminal result's are.
   */
  const resolveTerminalDependencies = (
    currentRun: WorkflowTerminalRun,
    evidenceInput: unknown,
    expectedDependencies: WorkflowTerminalResultExecution["dependencies"],
    purpose: string,
  ): Readonly<{ outputs: Record<string, unknown>; dependencies: TerminalDependencyRecord[] }> => {
    const expectedIds = expectedDependencies.map(({ nodeId }) => nodeId);
    const evidence = z.array(TerminalDependencyEvidenceSchema).parse(evidenceInput);
    const evidenceNodeIds = evidence.map(({ nodeId }) => nodeId);
    if (new Set(evidenceNodeIds).size !== evidenceNodeIds.length) {
      throw new Error(`${purpose} dependency evidence contains a duplicate node identity`);
    }
    const extras = evidenceNodeIds.filter((nodeId) => !expectedIds.includes(nodeId));
    const missing = expectedIds.filter((nodeId) => !evidenceNodeIds.includes(nodeId));
    if (extras.length > 0 || missing.length > 0) {
      throw new Error(
        `${purpose} dependency evidence does not match authenticated dependsOn; `
        + `missing=${missing.join(",") || "none"} extra=${extras.join(",") || "none"}`,
      );
    }
    const byNode = new Map(evidence.map((entry) => [entry.nodeId, entry]));
    const outputs: Record<string, unknown> = {};
    const dependencies: TerminalDependencyRecord[] = expectedDependencies.map((expected) => {
      const entry = byNode.get(expected.nodeId);
      if (entry === undefined) throw new Error(`${purpose} dependency ${expected.nodeId} is missing`);
        if (entry.state === "not-run") {
          if (expected.notRunReason === undefined) {
            throw new Error(`${purpose} dependency ${entry.nodeId} is unconditional and cannot be marked not-run`);
          }
          if (entry.reason !== expected.notRunReason) {
            throw new Error(
              `${purpose} dependency ${entry.nodeId} not-run reason ${entry.reason} `
              + `does not match authenticated reason ${expected.notRunReason}`,
            );
          }
          outputs[entry.nodeId] = undefined;
          return { state: "not-run", nodeId: entry.nodeId, reason: entry.reason };
        }

        const checkpoint = entry.checkpoint;
        if (checkpoint.nodeId !== entry.nodeId) {
          throw new Error(`${purpose} dependency ${entry.nodeId} carries checkpoint ${checkpoint.nodeId}`);
        }
        if (checkpoint.workflowId !== currentRun.envelope.workflow
          || checkpoint.itemId !== currentRun.envelope.itemId) {
          throw new Error(
            `${purpose} dependency ${entry.nodeId} checkpoint belongs to `
            + `${checkpoint.workflowId}/${checkpoint.itemId}, not `
            + `${currentRun.envelope.workflow}/${currentRun.envelope.itemId}`,
          );
        }
        if (checkpoint.attempt > currentRun.envelope.attempt) {
          throw new Error(
            `${purpose} dependency ${entry.nodeId} checkpoint attempt ${String(checkpoint.attempt)} `
            + `is newer than run attempt ${String(currentRun.envelope.attempt)}`,
          );
        }
        if (checkpoint.descriptorVersion !== descriptor.version
          || checkpoint.contractFingerprint !== descriptor.contractFingerprint) {
          throw new Error(
            `${purpose} dependency ${entry.nodeId} checkpoint descriptor binding does not match ${descriptor.id}`,
          );
        }
        const node = nodeByIdOrThrow(id, nodes, entry.nodeId, purpose);
        const binding = terminalEvidenceOf(node);
        if (binding === undefined) {
          throw new Error(`${id}: ${purpose} dependency ${entry.nodeId} owns no output schema`);
        }
        const outputSchemaHash = deriveSchemaHash(binding.checkpointSchema, "output");
        if (checkpoint.output.schemaHash !== outputSchemaHash) {
          throw new Error(
            `${purpose} dependency ${entry.nodeId} checkpoint output schema `
            + `${checkpoint.output.schemaHash} does not match ${outputSchemaHash}`,
          );
        }
        outputs[entry.nodeId] = binding.project(
          checkpoint.output.value,
          `${purpose} dependency ${entry.nodeId}`,
        );
        return {
          state: "resolved",
          nodeId: entry.nodeId,
          checkpoint: {
            workflowId: checkpoint.workflowId,
            itemId: checkpoint.itemId,
            attempt: checkpoint.attempt,
            // D214 — cite the EXECUTION, not merely the attempt. Absent only
            // when the cited row itself predates the component.
            ...(checkpoint.claimGeneration === undefined
              ? {}
              : { claimGeneration: checkpoint.claimGeneration }),
            runId: checkpoint.runId,
          },
          outputSchemaHash: checkpoint.output.schemaHash,
          descriptorVersion: checkpoint.descriptorVersion,
          contractFingerprint: checkpoint.contractFingerprint,
          implFingerprint: checkpoint.implFingerprint,
          outputDigest: deriveCheckpointOutputDigest(checkpoint.output),
          provenanceDigest: deriveCheckpointProvenanceDigest(checkpoint.provenance),
        };
    });
    return Object.freeze({ outputs, dependencies });
  };

  /**
   * The unforgeable seal D110/D114 requires: membership in a module-private
   * WeakMap over the EXACT stored bytes and the exact run they settle. Both
   * builders go through it, so a preview record is authority in precisely the
   * same sense a derived result is.
   */
  const sealTerminalRecord = (
    currentRun: WorkflowTerminalRun,
    result: RunResultRecord,
  ): Readonly<{ record: RunResultRecord; authorization: object }> => {
    const authorization = Object.freeze({});
    RUN_RESULT_AUTHORIZATIONS.set(authorization, Object.freeze({
      result: canonicalJsonStringify(result),
      currentRun: canonicalJsonStringify(currentRun),
    }));
    return Object.freeze({ record: result, authorization });
  };

  TERMINAL_RESULTS.set(descriptor, Object.freeze({
    schema: spec.flow.result.schema,
    schemaHash: deriveSchemaHash(spec.flow.result.schema, "output"),
    dependsOn: Object.freeze(terminalDependsOn),
    dependencies: terminalDependencies,
    parseResult: (candidate: unknown) => spec.flow.result.schema.parse(candidate),
    derive: spec.flow.result.derive,
    build: (currentRun: WorkflowTerminalRun, evidenceInput: unknown, clock: TerminalResultClock) => {
      const input = assertTerminalRunBinding(currentRun);
      const { outputs, dependencies } = resolveTerminalDependencies(
        currentRun,
        evidenceInput,
        terminalDependencies,
        "terminal",
      );

      const scopeCandidate = Object.freeze({ input, outputs: Object.freeze(outputs) });
      // This checked identity bridge preserves the exact generic scope needed by
      // the authored derive only after every key and value above was validated
      // against the factory's own dependency list and node output schemas.
      const ExactTerminalScopeSchema = z.custom<Parameters<typeof spec.flow.result.derive>[0]>(
        (candidate) => candidate === scopeCandidate,
        "terminal derive scope was not assembled by the descriptor factory",
      );
      const derived = spec.flow.result.derive(ExactTerminalScopeSchema.parse(scopeCandidate));
      const parsedResult = JsonValueSchema.parse(spec.flow.result.schema.parse(derived));
      const schemaHash = deriveSchemaHash(spec.flow.result.schema, "output");
      const resultValue = { schemaHash, value: parsedResult };
      const result = RunResultRecordSchema.parse({
        runId: currentRun.envelope.runId,
        attempt: currentRun.envelope.attempt,
        workflowId: currentRun.envelope.workflow,
        descriptorVersion: currentRun.envelope.descriptorVersion,
        contractFingerprint: currentRun.envelope.contractFingerprint,
        configFingerprint: currentRun.envelope.configFingerprint,
        configSnapshotId: currentRun.envelope.configSnapshotId,
        resultSchemaHash: schemaHash,
        result: resultValue,
        resultDigest: deriveRunResultDigest(resultValue),
        dependencies,
        dependencyDigest: deriveTerminalDependencyDigest(dependencies),
        createdAt: clock.now().toISOString(),
      });
      return sealTerminalRecord(currentRun, result);
    },
    buildPreview: (
      currentRun: WorkflowTerminalRun,
      previewInput: unknown,
      evidenceInput: unknown,
      clock: TerminalResultClock,
    ) => {
      assertTerminalRunBinding(currentRun);
      /**
       * A preview result may only be built for a run the OPERATOR enqueued as a
       * dry run. `envelope.dryRun` is the durable, immutable record of that
       * request (D6), and it is the run's own field rather than a caller claim —
       * the same reason beat ② re-reads it before a real write.
       */
      if (!currentRun.envelope.dryRun) {
        throw new Error(
          `run ${currentRun.envelope.runId} is not a dry run; a preview result may not be built for it`,
        );
      }
      if (dryRun.state !== "supported") {
        throw new Error(
          `${id} is not previewable (${dryRun.reason}); no preview result can describe a run of it`,
        );
      }
      const preview = TransactionDryRunPreviewSchema.parse(previewInput);
      /**
       * The preview must name the node the executor could actually have stopped
       * at. A preview claiming a different node would put an unreachable stop
       * point on a durable record nobody can check later.
       */
      if (preview.nodeId !== dryRun.stopsAt) {
        throw new Error(
          `preview for run ${currentRun.envelope.runId} stopped at "${preview.nodeId}", but ${id} previews `
          + `stop at "${dryRun.stopsAt}"`,
        );
      }
      const stopNode = nodeByIdOrThrow(id, nodes, NodeIdSchema.parse(preview.nodeId), "dry-run preview");
      if (stopNode.kind !== "transaction") {
        throw new Error(`${id}: dry-run preview node ${preview.nodeId} is a ${stopNode.kind} node`);
      }
      /**
       * The preview's dependencies are the transaction node's OWN `dependsOn` —
       * the exact upstream facts its `prepare` and `commit` binds read. They are
       * not `terminalDependsOn`, because the authored `derive` never ran; saying
       * otherwise would claim a derivation that did not happen.
       */
      const { dependencies } = resolveTerminalDependencies(
        currentRun,
        evidenceInput,
        dependencySpecFor(
          stopNode.dependsOn.map((nodeId) => NodeIdSchema.parse(nodeId)),
          "dry-run preview",
        ),
        "dry-run preview",
      );
      const previewValue = JsonValueSchema.parse(RunDryRunPreviewResultSchema.parse({
        kind: "dry-run-preview",
        stoppedAtNodeId: preview.nodeId,
        externalCommit: "none",
        preview,
      }));
      // The hash of the bytes actually stored — never the descriptor's declared
      // result hash, which would make a preview readable as a completed
      // workflow (D144's rule applied to the terminal row).
      const schemaHash = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");
      const resultValue = { schemaHash, value: previewValue };
      const result = RunResultRecordSchema.parse({
        runId: currentRun.envelope.runId,
        attempt: currentRun.envelope.attempt,
        workflowId: currentRun.envelope.workflow,
        descriptorVersion: currentRun.envelope.descriptorVersion,
        contractFingerprint: currentRun.envelope.contractFingerprint,
        configFingerprint: currentRun.envelope.configFingerprint,
        configSnapshotId: currentRun.envelope.configSnapshotId,
        resultSchemaHash: schemaHash,
        result: resultValue,
        resultDigest: deriveRunResultDigest(resultValue),
        dependencies,
        dependencyDigest: deriveTerminalDependencyDigest(dependencies),
        createdAt: clock.now().toISOString(),
      });
      return sealTerminalRecord(currentRun, result);
    },
  }));
  return descriptor;
}

/** The runtime node view for the executor and every guard, derived once per descriptor. */
export function descriptorRuntimeNodes(descriptor: AnyWorkflowDescriptor): readonly RuntimeFlowNode[] {
  const nodes = RUNTIME_NODES.get(descriptor);
  if (nodes === undefined) {
    throw new Error("workflow runtime nodes require the exact object returned by defineWorkflowDescriptor");
  }
  return nodes;
}

export type { AnyCommitTaskContract, AnyPrepareTaskContract, AnyReadTaskContract };
