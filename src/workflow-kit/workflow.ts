import type { EvidenceSchemaReader } from "../models/storage/evidence-schema-admission.js";
import { checkpointRecordKey, type RunCheckpointRecord } from "../models/workflow/checkpoint.js";
import type { RunRecord } from "../models/run/record.js";
import { WorkbookReferenceLookupSchema, type WorkbookReferenceLookup, type RunWorkbookReference } from "../models/dashboard/workbooks.js";
import { PlannedRunOutputSchema, type PlannedRunOutput } from "../models/dashboard/run-outputs.js";
import type { RunContinuation } from "../models/run/continuation.js";
import { WorkbookRequirementDeclarationSchema, type WorkflowWorkbookRequirement } from "../models/dashboard/workbook-library.js";
import { deepFreeze } from "../rules/validation/immutability.js";
import { delegationInvocationCommandId } from "../rules/commands/lifecycle-command-id.js";
import type { RerunValueMappingSpec } from "../models/workflow/rerun-values.js";
import { validateRerunValueMappings } from "../models/validation/rerun-values.js";
import { retainedRunProtectedBindings } from "../models/write-safety/protected-input.js";
import { ProtectedInputDeclarationSchema, type ProtectedInputBinding, type ProtectedInputDeclaration } from "../models/write-safety/protected-input.js";
import { z } from "zod";
import { validateFailureCorrections, validateGateCorrections, type FailureCorrection, type GateCorrection } from "../models/workflow/failure-correction.js";
import { JsonValueSchema, canonicalJsonStringify } from "../rules/validation/canonical-json.js";
import type {
  AnyTaskContract,
} from "../models/task/task-contract.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  NodeIdSchema,
  ScenarioIdSchema,
  WorkflowIdSchema,
} from "../rules/identity/ids.js";
import type { Fingerprint, NodeId, ScenarioId, WorkflowId } from "../rules/identity/ids.js";
import {
  RunDryRunPreviewResultSchema, RunDelegatedDryRunPreviewResultSchema, RunPublicationDryRunPreviewResultSchema, AnyRunPreviewStepSchema,
  isRunPreviewSchemaHash, readRunPreviewResult, resolveDelegationEvidenceOutput, type RunPreviewStep,
  terminalDelegationDependencyRecord, terminalGateDependencyRecord,
  RunResultRecordSchema,
  TerminalDependencyEvidenceSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
  type TerminalDependencyRecord,
} from "../models/run/result.js";
import { StepOmissionFormSchema } from "../models/workflow/step-omission.js";
import type { StepOmissionDeclaration, StepOmissionSpec } from "../models/workflow/step-omission.js";
import { SecretNameSchema } from "../models/config/secret-names.js";
import { deriveSchemaHash } from "../models/validation/schema-bound-value.js";
import { assertAuditedCanonicalInput, canonicalInputSamples } from "../models/workflow/canonical-input.js";
import type { CanonicalInputSchema } from "../models/workflow/canonical-input.js";
import type {
  CompletionConsumptionSpec,
  CompletionProgram,
  CoordinatorPolicy,
  SealedCompletionProgram,
} from "../models/workflow/completion.js";
import {
  CompletionConsumptionSpecSchema,
  CoordinatorPolicySchema,
} from "../models/workflow/completion.js";
import { GraphNodeKindSchema, DelegationManifestRefSchema, childRunOutcomeSchema, projectTransactionOutcome } from "../models/workflow/graph.js";
import type { GraphNodeBase, RuntimeFlowNode } from "../models/workflow/graph.js";
import {
  TransactionOutcomeSchema,
} from "../rules/write-safety/write-safety-primitives.js";
import { WorkflowSurfacesSchema, parseInputRunText, toRawSubmission } from "../models/workflow/ingress.js";
import type { InputRunSurface, WorkflowSurfaces } from "../models/workflow/ingress.js";
import {
  ArtifactSinkIdSchema,
  DetailProjectionSpecRuntimeSchema,
  type DetailCondition,
  DurableArtifactProjectionSpecRuntimeSchema,
  EnqueuePolicySchema,
  GateProjectionDefinitionSchema,
  IconNameSchema,
  InputSubjectSchema,
  StepProjectionSchema,
  SubjectProjectionSpecRuntimeSchema,
  OutcomeProjectionSchema,
  type OutcomeProjection,
  ResultTitleProjectionSchema,
  type ResultTitleProjection,
  ResultSubtitleProjectionSchema,
  type ResultSubtitleProjection,
  SurfaceShapeSchema,
  NodePurposeSpecSchema,
  TimelineCategoryProjectionSchema,
  type WorkflowOperatorField,
  TimelineCategorySpecSchema,
  VerdictDefinitionSchema,
  WorkflowActionPolicySchema,
  WorkflowCapabilitiesSchema,
  WorkflowCategorySchema,
  WorkflowCodeSchema,
  WorkflowStepOfSchema,
} from "../models/workflow/presentation.js";
import type {
  ArtifactSinkId,
  EnqueuePolicy,
  GateProjectionDefinition,
  IconName,
  InputSubject,
  NodePurposeSpec,
  StepProjection,
  SurfaceShape,
  TimelineCategoryProjection,
  VerdictDefinition,
  WorkflowActionPolicy,
  WorkflowCategory,
  WorkflowStepOf,
} from "../models/workflow/presentation.js";
import { deriveGraphCoveragePoints } from "./validation/scenario-coverage.js";
import type { GraphCoveragePoint } from "./validation/scenario-coverage.js";
import {
  contractSchemaLeaves,
  assertContractBoundarySchema,
  assertBooleanSelectionField,
  assertSchemaOffersPath,
  assertSchemaOffersCollectionPath,
  assertSchemaOwnsPath,
} from "../models/validation/contract-boundary.js";
import type {
  AnyNodeEntry,
  BuiltFlow,
  OutputsOf,
  WorkflowResultSpec,
} from "./flow.js";

// The factory validates each source and condition path.
export interface DetailProjectionSpec<S> {
  readonly key: string;
  readonly label: string;
  readonly source: Readonly<{ nodeId: keyof S & string; fieldPath: string }>
    | Readonly<{ kind: "result"; fieldPath: string }> | Readonly<{ kind: "input-title" }>;
  readonly when?: DetailCondition;
  readonly display: "text" | "eid" | "date" | "count" | "badge" | "person-name";
}

// Resolves the subject's display name; the factory proves the path is offered.
export interface SubjectProjectionSpec<S> {
  readonly nodeId: keyof S & string;
  readonly fieldPath: string;
  readonly eidFieldPath?: string;
}

// Brands are enforced by parsing through the schema.
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

// The match key identifies the logical item; the kernel mints the ItemId.
interface WorkflowIdentitySpec<Input> {
  readonly matchKey: (input: Input) => string;
}

// Owns the step's kebab key and operator label.
export function defineWorkflowStep<const Key extends string>(
  step: Readonly<{ key: Key; label: string }>,
): WorkflowStepOf<Key> {
  return Object.freeze(WorkflowStepOfSchema(step.key).parse(step));
}

// Missing operator-selected facts must fail, never default.
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
  readonly subtitle?: (input: Input) => string | undefined;
}

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
  /** Build-manifest derived (ref workflow-model ); stamped on every run, checkpoint, and span. */
  readonly contractFingerprint: Fingerprint;
  /** Existing references or linked masters this workflow directly needs. */
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: WorkflowWorkbookRequirement["workbookReference"];
  readonly referenceKeys?: (input: z.output<InputSchema>) => readonly string[];
  readonly plannedOutputs?: (input: z.output<InputSchema>, references: readonly RunWorkbookReference[]) => readonly PlannedRunOutput[];
  readonly code: string;
  readonly label: string;
  readonly sessionLabel?: string;
  readonly icon: IconName;
  readonly category: WorkflowCategory;
  readonly input: InputSchema;
  readonly canonicalInput: CanonicalInputSchema<InputSchema>;
  readonly protectedInputs?: readonly ProtectedInputDeclaration[];
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
  /** Explicit optional candidates for new Run input/omission assertions. */
  readonly rerunValues?: readonly RerunValueMappingSpec[];
  readonly failureCorrections?: readonly FailureCorrection[];
  readonly gateCorrections?: readonly GateCorrection[];
  readonly details: readonly DetailProjectionSpec<S>[];
  /** Ref dashboard-surfaces: where the RUN resolves the subject's name, if it ever does. */
  readonly subjectProjection?: SubjectProjectionSpec<S>;
  readonly titleProjection?: ResultTitleProjection;
  readonly subtitleProjection?: ResultSubtitleProjection;
  readonly outcomeProjection?: OutcomeProjection;
   /** The run-detail timeline's categorical shape, DERIVED by the factory: the declared
    * categories with member labels, or the one-per-node default. Always exhaustive. */
  readonly timeline: readonly TimelineCategoryProjection[];
   // Distinguishes a declared timeline from the factory default.
  readonly timelineDeclared: boolean;
   /** The steps an operator may omit at start, with their typed form and the task nodes
    * their producers rebuild; empty when no step is omittable. */
  readonly stepOmissions: readonly StepOmissionSpec[];
   // Exhaustive so no node is silently prose-less.
  readonly summary?: string;
  readonly nodePurposes: readonly NodePurposeSpec[];
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

// Runtime reader view; the exact descriptor assigns to it.
export interface AnyWorkflowDescriptor {
  readonly id: WorkflowId;
  readonly version: number;
  readonly contractFingerprint: Fingerprint;
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: WorkflowWorkbookRequirement["workbookReference"];
  readonly referenceKeys?: (input: never) => readonly string[];
  readonly plannedOutputs?: (input: never, references: readonly RunWorkbookReference[]) => readonly PlannedRunOutput[];
  readonly code: string;
  readonly label: string;
  readonly sessionLabel?: string;
  readonly icon: IconName;
  readonly category: WorkflowCategory;
  readonly input: z.ZodType;
  readonly canonicalInput: z.ZodType;
  readonly protectedInputs?: readonly ProtectedInputDeclaration[];
  readonly inputSubject: InputSubject | ((input: never) => InputSubject);
  readonly surface: SurfaceShape;
  readonly nodes: readonly GraphNodeBase[];
  readonly surfaces: WorkflowSurfaces;
  readonly verdicts?: readonly VerdictDefinition[];
  readonly completion?: Readonly<{ kind: "sealed-completion-program"; mode: string; gate: string }>;
  readonly capabilities?: WorkflowCapabilitiesSpec;
  /** Explicit optional candidates for new Run input/omission assertions. */
  readonly rerunValues?: readonly RerunValueMappingSpec[];
  readonly failureCorrections?: readonly FailureCorrection[];
  readonly gateCorrections?: readonly GateCorrection[];
  readonly details: readonly z.input<typeof DetailProjectionSpecRuntimeSchema>[];
   /** Plain data, so it rides the BROAD view (unlike `presentation`, whose title/subtitle are
    * functions of the exact input type). The run/queue projection reads it. */
  readonly subjectProjection?: Readonly<{ nodeId: string; fieldPath: string; eidFieldPath?: string }>;
  readonly titleProjection?: ResultTitleProjection;
  readonly subtitleProjection?: ResultSubtitleProjection;
  readonly outcomeProjection?: OutcomeProjection;
  /** Plain data like `subjectProjection`, so it rides the broad view. */
  readonly timeline: readonly Readonly<{
    description?: string;
    operatorFields?: readonly WorkflowOperatorField[];
    system?: z.input<typeof BrowserSystemIdSchema> | "local";
    /** The category's stable anchor: the step folder's name, and what a `chunk-harness.step` names. */
    key: string;
    label: string;
    selection?: Readonly<{ inputField: string; selectedWhen: boolean }>;
    nodes: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  /** DECLARED or DERIVED; the composition root's role audit is the reader. */
  readonly timelineDeclared: boolean;
  /** Omittable steps with their forms and producers; empty when none. */
  readonly stepOmissions: readonly StepOmissionSpec[];
  /** The descriptor's own prose; plain data, so it rides the broad view. */
  readonly summary?: string;
  readonly nodePurposes: readonly Readonly<{ nodeId: string; purpose: string }>[];
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
  | "timelineDeclared" | "nodePurposes" | "stepOmissions" | "requiredWorkbookFields" | "workbookReference"
> {
  readonly id: string;
  readonly contractFingerprint: string;
  readonly requiredWorkbookFields?: readonly string[];
  readonly workbookReference?: WorkflowWorkbookRequirement["workbookReference"];
  /** Parsed into branded `ScenarioId`s by the factory, the way contracts do. */
  readonly scenarios: readonly [string, ...string[]];
   // Optional; declaring it demands every node exactly once.
  readonly timeline?: readonly Readonly<{
    key: string;
    label: string;
    nodes: readonly string[];
    description?: string;
    operatorFields?: readonly WorkflowOperatorField[];
    system?: z.input<typeof BrowserSystemIdSchema> | "local";
    selection?: Readonly<{ inputField: string; selectedWhen: boolean }>;
    /** Present iff the step folder declared the step omittable. */
    omission?: StepOmissionDeclaration;
  }>[];
   /** The authored prose: one sentence per node, keyed by node id. Optional, and EXHAUSTIVE
    * when declared — a partial list would leave nodes silently prose-less. */
  readonly nodePurposes?: readonly Readonly<{ nodeId: string; purpose: string }>[];
  /** The built graph — its exact node tuple, result spec, and accumulators. */
  readonly flow: BuiltFlow<InputSchema, ResultSchema, Nodes, S, D>;
}

export interface WorkflowProjections {
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: WorkflowWorkbookRequirement["workbookReference"];
  readonly steps: readonly StepProjection[];
  readonly gates: readonly GateProjectionDefinition[];
  /** Browser systems only — service and `workflow:<id>` stores contribute none. */
  readonly systems: readonly string[];
  readonly requires: readonly string[];
  readonly coveragePoints: readonly GraphCoveragePoint[];
  /** Registered graph scenarios unioned with every used task contract's scenarios. */
  readonly scenarios: readonly ScenarioId[];
  readonly contracts: readonly AnyTaskContract[];
  /** Whether every transaction in this graph supports preparation without commit. */
  readonly dryRun: WorkflowDryRunSupport;
}

type WorkflowLocalDryRunSupport =
  | Readonly<{
    state: "supported";
    /** First preparation boundary; its real dependencies are retained in preview evidence. */
    firstTransactionNodeId: string;
  }>
  | Readonly<{
    state: "supported";
    /** First local publication boundary: bound and checked in a dry run, never published. */
    firstPublicationNodeId: string;
  }>
  | Readonly<{ state: "unsupported"; reason: "no-transaction-node" }>
  | Readonly<{
    state: "unsupported";
    reason: "node-declares-unsupported";
    /** The FIRST transaction node that declares no preview arm. */
    nodeId: string;
  }>;

export type WorkflowDryRunSupport = WorkflowLocalDryRunSupport
  | Readonly<{ state: "supported"; firstDelegationNodeId: string }>
  | Readonly<{ state: "unsupported"; reason: "descendant-declares-unsupported"; workflowId: string; nodeId: string }>;

function isPreviewBoundary(node: RuntimeFlowNode): boolean {
  return node.kind === "transaction" || (node.kind === "task" && node.dryRun === "stop-before-publish");
}

// Every transaction must support preview, including later writes.
function deriveDryRunSupport(nodes: readonly RuntimeFlowNode[]): WorkflowLocalDryRunSupport {
  const first = nodes.find(isPreviewBoundary);
  if (first === undefined) return Object.freeze({ state: "unsupported", reason: "no-transaction-node" });
  for (const node of nodes) {
    if (node.kind === "transaction" && node.dryRun !== "stop-after-prepare") {
      return Object.freeze({ state: "unsupported", reason: "node-declares-unsupported", nodeId: String(node.id) });
    }
  }
  return Object.freeze(first.kind === "transaction"
    ? { state: "supported", firstTransactionNodeId: String(first.id) }
    : { state: "supported", firstPublicationNodeId: String(first.id) });
}

/** The ONE derivation every consumer shares — the projection computes it once. */
export function workflowDryRunSupport(descriptor: AnyWorkflowDescriptor): WorkflowDryRunSupport {
  return projectionStateOf(descriptor).support;
}

export function workflowPreviewDependencyIds(descriptor: AnyWorkflowDescriptor, steps: readonly RunPreviewStep[]): readonly NodeId[] {
  const support = workflowDryRunSupport(descriptor);
  if (support.state !== "supported") throw new Error("workflow-preview-unsupported");
  const nodes = descriptorRuntimeNodes(descriptor);
  const boundaryId = "firstTransactionNodeId" in support ? support.firstTransactionNodeId
    : "firstPublicationNodeId" in support ? support.firstPublicationNodeId : support.firstDelegationNodeId;
  const boundary = nodes.find(node => node.id === boundaryId);
  if (boundary === undefined) throw new Error("workflow-preview-boundary-unavailable");
  const unavailable = new Set(steps.filter(step => step.state === "unavailable").map(step => step.nodeId));
  const exercised = new Set(steps.filter(step => step.state === "exercised" || step.state === "delegation-preview").map(step => step.nodeId));
  return [...new Set([...boundary.dependsOn.filter(id => !unavailable.has(id)),
    ...nodes.filter(node => (node.kind === "task" || node.kind === "child-run") && exercised.has(node.id)).map(node => node.id),
  ])];
}

export function bindWorkflowDelegationTargets(descriptors: readonly AnyWorkflowDescriptor[]): void {
  const all = new Map(descriptors.map(descriptor => [String(descriptor.id), descriptor]));
  if (all.size !== descriptors.length) throw new Error("workflow delegation registry has duplicate identifiers");
  const bindings = new Map(descriptors.map(descriptor => {
    projectionStateOf(descriptor);
    const targets = new Map<string, AnyWorkflowDescriptor>();
    for (const node of descriptorRuntimeNodes(descriptor)) {
      if (node.kind !== "child-run") continue;
      const target = all.get(node.target.id);
      if (target === undefined) throw new Error(`workflow delegation target ${node.target.id} is not registered`);
      projectionStateOf(target);
      if (deriveSchemaHash(target.input, "input") !== deriveSchemaHash(node.target.input, "input")
        || workflowTerminalResultExecution(target).schemaHash !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-target-contract-mismatch");
      targets.set(String(node.id), target);
    }
    return [descriptor, targets] as const;
  }));
  const qualified = new Map<AnyWorkflowDescriptor, Readonly<{ support: WorkflowDryRunSupport; depth: number }>>();
  const visiting = new Set<AnyWorkflowDescriptor>();
  const visit = (descriptor: AnyWorkflowDescriptor): Readonly<{ support: WorkflowDryRunSupport; depth: number }> => {
    if (visiting.has(descriptor)) throw new Error(`workflow delegation cycle at ${descriptor.id}`);
    const retained = qualified.get(descriptor);
    if (retained !== undefined) return retained;
    visiting.add(descriptor);
    const own = projectionStateOf(descriptor).ownDryRun;
    let support: WorkflowDryRunSupport = own, depth = 1;
    const targets = bindings.get(descriptor);
    if (targets === undefined) throw new Error("delegation-target-registration-unavailable");
    for (const [nodeId, target] of targets) {
      const { support: child, depth: childDepth } = visit(target);
      depth = Math.max(depth, 1 + childDepth);
      if (child.state === "unsupported" && child.reason !== "no-transaction-node") {
        support = child.reason === "descendant-declares-unsupported" ? child
          : Object.freeze({ state: "unsupported", reason: "descendant-declares-unsupported", workflowId: target.id, nodeId: child.nodeId });
      } else if (child.state === "supported" && support.state === "unsupported" && support.reason === "no-transaction-node") {
        support = Object.freeze({ state: "supported", firstDelegationNodeId: nodeId });
      }
    }
    if (depth > 16) throw new Error(`workflow delegation depth exceeds 16 at ${descriptor.id}`);
    if (own.state === "unsupported" && own.reason === "node-declares-unsupported") support = own;
    visiting.delete(descriptor);
    const result = Object.freeze({ support, depth }); qualified.set(descriptor, result);
    return result;
  };
  for (const descriptor of descriptors) {
    visit(descriptor);
    const existing = projectionStateOf(descriptor).targets, targets = bindings.get(descriptor);
    if (targets === undefined || existing !== undefined && (existing.size !== targets.size
      || [...existing].some(([id, target]) => targets.get(id) !== target))) throw new Error("delegation-target-registration-changed");
  }
  for (const [descriptor, targets] of bindings) {
    const state = projectionStateOf(descriptor);
    state.targets = targets; state.support = visit(descriptor).support;
  }
}

// Lookups use ingress; run callbacks use bound canonical input.
export interface WorkflowPlanning {
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: WorkflowWorkbookRequirement["workbookReference"];
  readonly plannedOutputs: (parsed: unknown, references: readonly RunWorkbookReference[]) => readonly PlannedRunOutput[];
  readonly parseInput: (raw: unknown) => Readonly<{ input: unknown; lookups: readonly WorkbookReferenceLookup[] }>;
  readonly parseCanonicalInput: (value: unknown) => unknown;
  readonly matchKey: (parsed: unknown) => string;
  readonly title: (parsed: unknown) => string;
  readonly subtitle: (parsed: unknown) => string | undefined;
  readonly inputSubject: (parsed: unknown) => InputSubject;
}

/** Factory-authenticated terminal-result data: the broad executor reads dependency metadata here, while exact typed derivation and its authorization seal stay inside the descriptor factory. */
export interface WorkflowTerminalResultExecution<Input = never, Outputs = never, Result = unknown> {
  readonly schema: z.ZodType;
  readonly schemaHash: Fingerprint;
  readonly dependsOn: readonly NodeId[];
  readonly dependencies: readonly Readonly<{
    nodeId: NodeId;
    notRunReason?: "condition-false" | "branch-not-selected";
    /** The node may be absent as `step-omitted` (its step is omittable and no producer rebuilds it). */
    omittable?: true;
    /** The node may arrive `asserted` (its step is omittable and a producer rebuilds it). */
    assertable?: true;
  }>[];
  readonly parseResult: (candidate: unknown) => unknown;
  readonly derive: (scope: Readonly<{ input: Input; outputs: Outputs }>) => Result;
  readonly build: (
    currentRun: WorkflowTerminalRun,
    evidence: unknown,
    clock: TerminalResultClock,
    schemaReader?: EvidenceSchemaReader,
  ) => Readonly<{ record: RunResultRecord; authorization: object }>;
   // A preview shares the seal and identity checks but not the derive.
  readonly buildPreview: (
    currentRun: WorkflowTerminalRun,
    preview: unknown,
    evidence: unknown,
    clock: TerminalResultClock,
    schemaReader?: EvidenceSchemaReader,
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
    /** The one durable record of what the operator asked for. */
    dryRun: boolean;
    /** The steps this run omitted; an asserted dependency must name one of them. */
    stepOmissions?: readonly Readonly<{ step: string }>[];
    continuation?: RunContinuation;
  }>;
  readonly input: Readonly<{
    parsed: Readonly<{ schemaHash: string; value: unknown; protectedBindings?: readonly ProtectedInputBinding[] }>;
  }>;
  readonly lifecycle: Readonly<{ state: string }>;
  readonly version: number;
}

interface TerminalResultClock {
  now(): Date;
}

interface WorkflowProjectionState {
  readonly projections: WorkflowProjections;
  readonly ownDryRun: WorkflowLocalDryRunSupport;
  support: WorkflowDryRunSupport;
  targets?: ReadonlyMap<string, AnyWorkflowDescriptor>;
}
const PROJECTIONS = new WeakMap<object, WorkflowProjectionState>();
function projectionStateOf(descriptor: object): WorkflowProjectionState {
  const state = PROJECTIONS.get(descriptor);
  if (state === undefined) throw new Error("workflow projections require the exact object returned by defineWorkflowDescriptor");
  return state;
}
const PLANNING = new WeakMap<object, WorkflowPlanning>();
const RUNTIME_NODES = new WeakMap<object, readonly RuntimeFlowNode[]>();
const TERMINAL_RESULTS = new WeakMap<object, WorkflowTerminalResultExecution>();
const RUN_RESULT_AUTHORIZATIONS = new WeakMap<
  object,
  Readonly<{ result: string; currentRun: string }>
>();

export interface DelegationAccountingPlan {
  readonly joinNodeId: string;
  readonly target: AnyWorkflowDescriptor;
  readonly recompute: readonly string[];
  readonly retain: readonly string[];
}

function delegationAccountingPlan(descriptor: AnyWorkflowDescriptor): DelegationAccountingPlan | undefined {
  const nodes = descriptorRuntimeNodes(descriptor), state = projectionStateOf(descriptor);
  if ((descriptor.artifactProjections?.length ?? 0) > 0
    || nodes.some(node => node.kind !== "child-run" && (node.kind !== "task" || node.uses.effect !== "read"))) return;
  const joins = nodes.flatMap(node => {
    if (node.kind !== "child-run" || node.await !== "terminal" || node.join !== "all-settled"
      || node.policy.afterChildRetry !== "manual-parent-resume") return [];
    const target = state.targets?.get(String(node.id));
    return target !== undefined && workflowDryRunSupport(target).state === "supported" ? [{ node, target }] : [];
  });
  const join = joins.length === 1 ? joins[0] : undefined;
  if (join === undefined) return;
  const affected = new Set<string>([join.node.id]);
  for (const node of nodes) if (node.dependsOn.some(id => affected.has(id))) affected.add(node.id);
  const accounting = nodes.filter(node => affected.has(node.id) && node.id !== join.node.id);
  if (accounting.length === 0 || accounting.some(node => node.kind !== "task" || node.uses.effect !== "read"
    || node.uses.provenance.default !== "derived")
    || workflowTerminalResultExecution(descriptor).dependsOn.some(id => !affected.has(id))) return;
  return Object.freeze({ joinNodeId: join.node.id, target: join.target, recompute: Object.freeze(accounting.map(node => String(node.id))),
    retain: Object.freeze(nodes.filter(node => !affected.has(node.id)).map(node => String(node.id))) });
}

const DELEGATION_REFRESH_AUTHORIZATIONS = new WeakMap<object, Readonly<{ descriptor: AnyWorkflowDescriptor; run: string; accounting?: DelegationAccountingPlan }>>();

export function authorizeWorkflowDelegationRefresh(descriptor: AnyWorkflowDescriptor, run: RunRecord): object | undefined {
  const state = projectionStateOf(descriptor);
  if (descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint) throw new Error("delegation-refresh-definition-mismatch");
  if (descriptorRuntimeNodes(descriptor).some(node => node.kind === "child-run") && state.targets === undefined) throw new Error("delegation-refresh-target-authority-unavailable");
  const support = workflowDryRunSupport(descriptor);
  const accounting = delegationAccountingPlan(descriptor);
  if ((support.state !== "unsupported" || support.reason !== "no-transaction-node") && accounting === undefined) return undefined;
  const authorization = Object.freeze({});
  DELEGATION_REFRESH_AUTHORIZATIONS.set(authorization,{ descriptor, run: canonicalJsonStringify(run), ...(accounting === undefined ? {} : { accounting }) });
  return authorization;
}

export function assertWorkflowDelegationRefreshAuthorization(authorization: object | undefined, run: RunRecord): AnyWorkflowDescriptor {
  const bound = authorization === undefined ? undefined : DELEGATION_REFRESH_AUTHORIZATIONS.get(authorization);
  if (bound === undefined || bound.run !== canonicalJsonStringify(run)) throw new Error("delegation-refresh-factory-authorization-unavailable");
  const support = workflowDryRunSupport(bound.descriptor);
  if ((support.state !== "unsupported" || support.reason !== "no-transaction-node") && bound.accounting === undefined) throw new Error("delegation-refresh-transactions-unsupported");
  return bound.descriptor;
}

export function workflowDelegationAccounting(authorization: object, run: RunRecord): DelegationAccountingPlan | undefined {
  assertWorkflowDelegationRefreshAuthorization(authorization, run);
  return DELEGATION_REFRESH_AUTHORIZATIONS.get(authorization)?.accounting;
}

// WeakMap membership authenticates the result; copied tokens carry no authority.
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
  return projectionStateOf(descriptor).projections;
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

// Widening happens once; `kind` is re-parsed first.
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

/** "Which schema owns this node's output FIELD PATHS" — for a transaction, the COMMIT contract's output (e.g. `savedState.timekeeperName`), not the wrapper or the checkpoint schema. */
function outputSchemaOf(node: RuntimeFlowNode): z.ZodType | undefined {
  switch (node.kind) {
    case "task": return node.uses.output;
    case "transaction": return node.commit.uses.output;
    case "gate": return node.result;
    default: return undefined;
  }
}

// Transactions checkpoint the whole outcome, then project the derive value.
type TerminalEvidenceBinding = Readonly<{
  /** The schema the durable checkpoint row is bound to. */
  checkpointSchema: z.ZodType;
  /** Durable value → the scope value handed to `derive`. Fails loud on drift. */
  project: (storedValue: unknown, context: string, retained?: Readonly<{ checkpoint: RunCheckpointRecord; schemaReader?: EvidenceSchemaReader }>) => unknown;
}>;

function terminalEvidenceOf(node: RuntimeFlowNode): TerminalEvidenceBinding | undefined {
  switch (node.kind) {
    case "task":
      return { checkpointSchema: node.uses.output, project: (value) => node.uses.output.parse(value) };
    case "child-run":
      { const schema = node.await === "none" ? DelegationManifestRefSchema : node.cardinality === "one" ? childRunOutcomeSchema(node.target.result) : z.array(childRunOutcomeSchema(node.target.result));
        return { checkpointSchema: schema, project: value => schema.parse(value) }; }
    case "gate":
      return { checkpointSchema: node.result, project: (value) => node.result.parse(value) };
    case "transaction": {
      const commit = node.commit.uses;
      return {
        checkpointSchema: TransactionOutcomeSchema,
        project: (value, context, retained) => projectTransactionOutcome(commit, value, context, retained),
      };
    }
    default: return undefined;
  }
}

// One label rule shared by every surface.
export function runtimeNodeLabel(node: RuntimeFlowNode): string {
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
      label: runtimeNodeLabel(node),
      kind: node.kind,
      ...(node.kind === "task" ? { taskId: node.uses.id } : {}),
      conditional: (node.kind === "task" || (node.kind === "gate" && node.resolvedBy === "operator")) && node.when !== undefined,
    }));
  }
  return Object.freeze(steps);
}

// Omission producers cannot mint gate or transaction authority.
function deriveStepOmissions(
  id: string,
  nodes: readonly RuntimeFlowNode[],
  declared: readonly Readonly<{ key: string; nodes: readonly string[]; omission?: StepOmissionDeclaration }>[] | undefined,
): readonly StepOmissionSpec[] {
  const specs: StepOmissionSpec[] = [];
  for (const category of declared ?? []) {
    if (category.omission === undefined) continue;
    const form = StepOmissionFormSchema.parse(category.omission.form);
    const members = new Set(category.nodes);
    for (const produced of Object.keys(category.omission.produces)) {
      if (!members.has(produced)) {
        throw new Error(`${id}: step "${category.key}" omission produces node "${produced}", which is not a member of that step`);
      }
      const node = nodeByIdOrThrow(id, nodes, NodeIdSchema.parse(produced), `step "${category.key}" omission`);
      if (node.kind !== "task") {
        throw new Error(`${id}: step "${category.key}" omission produces ${node.kind} node "${produced}"; only task nodes are ever asserted`);
      }
      if (typeof category.omission.produces[produced] !== "function") {
        throw new Error(`${id}: step "${category.key}" omission producer for "${produced}" is not a function`);
      }
    }
    specs.push(Object.freeze({ step: category.key, form, produces: Object.freeze({ ...category.omission.produces }) }));
  }
  return Object.freeze(specs);
}

// A declared timeline is exhaustive and assigns each node one category.
function deriveTimeline(
  id: string,
  nodes: readonly RuntimeFlowNode[],
  declared: readonly Readonly<{ key: string; label: string; selection?: Readonly<{ inputField: string; selectedWhen: boolean }>; description?: string;
    operatorFields?: readonly WorkflowOperatorField[]; system?: z.input<typeof BrowserSystemIdSchema> | "local"; nodes: readonly string[] }>[] | undefined,
): readonly TimelineCategoryProjection[] {
  if (declared === undefined) {
    // The per-node default's key is the NODE ID (the kebab anchor the nodes are already named by);
    // deriving from the label instead would invent a second spelling of a name the graph already owns.
    return Object.freeze(nodes.map((node) => TimelineCategoryProjectionSchema.parse({
      key: String(node.id),
      label: runtimeNodeLabel(node),
      nodes: [{ id: node.id, label: runtimeNodeLabel(node) }],
    })));
  }
  const labelByNode = new Map(nodes.map((node) => [String(node.id), runtimeNodeLabel(node)]));
  const seen = new Set<string>();
  const categories = declared.map((category) => {
    const parsed = TimelineCategorySpecSchema.parse(category);
    for (const field of parsed.operatorFields ?? []) for (const source of field.sources) {
      if (!parsed.nodes.includes(source.nodeId)) throw new Error(`${id}: operator field "${field.label}" reads outside its timeline group`);
      const node = nodeByIdOrThrow(id, nodes, source.nodeId, `operator field "${field.label}"`);
      if (node.kind !== "task") throw new Error(`${id}: operator field "${field.label}" requires a task source`);
      assertSchemaOffersCollectionPath(node.uses[source.kind], source.fieldPath, `${id}: operator field "${field.label}"`);
    }
    return TimelineCategoryProjectionSchema.parse({
      key: parsed.key,
      label: parsed.label,
      ...(parsed.description === undefined ? {} : { description: parsed.description }),
      ...(parsed.system === undefined ? {} : { system: parsed.system }),
      ...(parsed.selection === undefined ? {} : { selection: parsed.selection }),
      ...(parsed.operatorFields === undefined ? {} : { operatorFields: parsed.operatorFields }),
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
      `${id}: a declared timeline is exhaustive and this one does not cover: ${missing.join(", ")}`,
    );
  }
  assertUnique(id, "timeline category keys", categories.map((category) => category.key));
  assertUnique(id, "timeline category labels", categories.map((category) => category.label));
  return Object.freeze(categories);
}

// A declared list is exhaustive; an undeclared list is empty.
function deriveNodePurposes(
  id: string,
  nodes: readonly RuntimeFlowNode[],
  declared: readonly Readonly<{ nodeId: string; purpose: string }>[] | undefined,
): readonly NodePurposeSpec[] {
  if (declared === undefined) return Object.freeze([]);
  const known = new Set(nodes.map((node) => String(node.id)));
  const seen = new Set<string>();
  const purposes = declared.map((entry) => {
    const parsed = NodePurposeSpecSchema.parse(entry);
    if (!known.has(String(parsed.nodeId))) {
      throw new Error(`${id}: node purpose names undeclared node ${String(parsed.nodeId)}`);
    }
    if (seen.has(String(parsed.nodeId))) {
      throw new Error(`${id}: node purposes name node ${String(parsed.nodeId)} twice`);
    }
    seen.add(String(parsed.nodeId));
    return parsed;
  });
  const missing = nodes.map((node) => String(node.id)).filter((nodeId) => !seen.has(nodeId));
  if (missing.length > 0) {
    throw new Error(
      `${id}: a declared node-purpose list is exhaustive and this one does not cover: ${missing.join(", ")}`,
    );
  }
  return Object.freeze(purposes);
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

// Examples must pass the operator-facing parser and input schema.
function assertInputRunExamples(id: string, input: z.ZodType, inputRun: InputRunSurface, protectedInputs: readonly ProtectedInputDeclaration[]): void {
  const examples = inputRun.examples;
  if (examples === undefined) return;
  assertUnique(id, "input-run example keys", examples.map((example) => example.key));
  for (const example of examples) {
    const entries = (() => {
      try {
        return parseInputRunText(inputRun.parser, example.text);
      } catch (error) {
        throw new Error(
          `${id}: input-run example "${example.key}" does not parse under this surface's own parser: `
          + (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    })();
    for (const entry of entries) {
      const parsed = input.safeParse(toRawSubmission(entry));
      if (!parsed.success && !parsed.error.issues.every((issue) => issue.code === "invalid_type"
        && issue.path.length === 1 && protectedInputs.some(({ inputPath }) => inputPath === issue.path[0]))) {
        throw new Error(
          `${id}: input-run example "${example.key}" entry ${String(entry.index + 1)} ("${entry.sourceText}") `
          + `is refused by this workflow's own input schema: ${parsed.error.message}`,
        );
      }
    }
  }
}

function assertSurfaceFields(id: string, input: z.ZodType, surfaces: WorkflowSurfaces, protectedInputs: readonly ProtectedInputDeclaration[]): void {
  const inputRun = surfaces.inputRun;
  if (inputRun !== undefined) {
    for (const rule of inputRun.parser.rules) {
      assertSchemaOffersPath(input, rule.emit, `${id}: input-run parser rule`);
    }
    for (const constant of inputRun.parser.constants ?? []) {
      assertSchemaOffersPath(input, constant.field, `${id}: input-run parser constant`);
    }
    for (const declaration of protectedInputs) {
      assertSchemaOffersPath(input, declaration.inputPath, `${id}: protected input`);
      if (inputRun.parser.rules.some((rule) => rule.emit === declaration.inputPath)
        || inputRun.parser.constants?.some((constant) => constant.field === declaration.inputPath)) {
        throw new Error(`${id}: protected input ${declaration.name} cannot be supplied by the browser parser`);
      }
    }
    assertInputRunExamples(id, input, inputRun, protectedInputs);
  }
  const uploadRun = surfaces.uploadRun;
  if (uploadRun !== undefined) {
    if (uploadRun.pdfInput !== undefined) {
      const pdfInput = uploadRun.pdfInput;
      const fields = "documentsField" in pdfInput ? Object.values(pdfInput) : [pdfInput.documentField, pdfInput.fileNameField, pdfInput.readingIdField, ...Object.keys(pdfInput.fixed)];
      for (const field of fields) assertSchemaOffersPath(input, field, `${id}: PDF input`);
      if ("fixed" in pdfInput && input instanceof z.ZodObject) {
        const shape: Readonly<Record<string, z.ZodType | undefined>> = (input as z.ZodObject<Readonly<Record<string, z.ZodType>>>).shape;
        for (const [field, value] of Object.entries(pdfInput.fixed)) if (shape[field]?.safeParse(value).success !== true) throw new Error(`${id}: PDF input fixed value ${field} is invalid`);
      }
      if (uploadRun.accepts.some(accept => accept.mediaType !== "application/pdf")) throw new Error(`${id}: PDF input requires PDF files`);
    }
    for (const field of uploadRun.fields) {
      assertSchemaOffersPath(input, field.field, `${id}: upload field`);
    }
  }
}

export function parseWorkbookRequirement(requiredWorkbookFields: unknown, workbookReference: unknown): Readonly<{
  requiredWorkbookFields: readonly string[];
  workbookReference?: WorkflowWorkbookRequirement["workbookReference"];
}> {
  const parsed = WorkbookRequirementDeclarationSchema.parse({
    requiredWorkbookFields: requiredWorkbookFields === undefined ? [] : requiredWorkbookFields,
    ...(workbookReference === undefined ? {} : { workbookReference }),
  });
  return deepFreeze({ requiredWorkbookFields: parsed.requiredWorkbookFields,
    ...(parsed.workbookReference === undefined ? {} : { workbookReference: parsed.workbookReference }) });
}

function requireReferenceKeys<Input>(callback: ((input: Input) => readonly string[]) | undefined, input: Input): readonly string[] {
  if (callback === undefined) throw new Error("workbook reference keys declaration unavailable");
  return callback(input);
}

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
  const { requiredWorkbookFields, workbookReference } = parseWorkbookRequirement(spec.requiredWorkbookFields, spec.workbookReference);
  const referenceKeys = spec.referenceKeys;
  if (workbookReference?.mode === "all" && referenceKeys !== undefined
    || workbookReference?.mode === "keys" && referenceKeys === undefined
    || workbookReference === undefined && referenceKeys !== undefined) throw new Error("invalid workbook reference keys declaration");
  // The ONE code declaration site. Uniqueness across the registry is
  // the composition root's — a descriptor cannot see its siblings.
  if (!WorkflowCodeSchema.safeParse(spec.code).success) {
    throw new Error(`${id}: code must be two to four lowercase letters`);
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

  // The terminal result and gate results are durable, replayable and go through the boundary
  // strictness audit — no open record, `any`, or a value SQLite cannot round-trip.
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

    // A declared `when` names a real schema field, refused at definition time.
  for (const node of nodes) {
    if ((node.kind !== "task" && !(node.kind === "gate" && node.resolvedBy === "operator")) || node.when === undefined) continue;
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
    if ("nodeId" in detail.source) assertNodeFieldPath(id, nodes, detail.source.nodeId, detail.source.fieldPath, `detail "${detail.key}"`);
    else if (detail.source.kind === "result") assertSchemaOwnsPath(spec.flow.result.schema, detail.source.fieldPath, `${id}: detail "${detail.key}" result`);
    if (detail.when !== undefined) assertSchemaOwnsPath(detail.when.source.kind === "input" ? spec.canonicalInput : spec.flow.result.schema,
      detail.when.source.fieldPath, `${id}: detail "${detail.key}" condition`);
  }
  assertUnique(id, "detail keys", spec.details.map((detail) => detail.key));

  if (spec.outcomeProjection !== undefined) {
    const projection = OutcomeProjectionSchema.parse(spec.outcomeProjection);
    const owner = `${id}: result outcome projection`;
    assertSchemaOwnsPath(spec.flow.result.schema, projection.fieldPath, owner);
    const leaf = contractSchemaLeaves(spec.flow.result.schema).find(entry => entry.path === projection.fieldPath);
    if (leaf === undefined || !["string", "enum", "literal"].includes(leaf.kind)) {
      throw new Error(`${owner} must name a string outcome field`);
    }
    const vocabulary = leaf.options;
    if (vocabulary !== undefined && projection.cases.some(entry => !vocabulary.includes(entry.value))) {
      throw new Error(`${owner} contains a value outside the result field vocabulary`);
    }
  }
  if (spec.titleProjection !== undefined) {
    ResultTitleProjectionSchema.parse(spec.titleProjection);
    assertSchemaOwnsPath(spec.flow.result.schema, spec.titleProjection.fieldPath, `${id}: result title projection`);
    const leaf = contractSchemaLeaves(spec.flow.result.schema).find(entry => entry.path === spec.titleProjection?.fieldPath);
    if (leaf === undefined || leaf.kind !== "string") throw new Error(`${id}: result title projection must name a string field`);
  }
  if (spec.subtitleProjection !== undefined) {
    ResultSubtitleProjectionSchema.parse(spec.subtitleProjection);
    assertSchemaOwnsPath(spec.flow.result.schema, spec.subtitleProjection.fieldPath, `${id}: result subtitle projection`);
  }

    // Absent subject arm keeps the start title.
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
    if (spec.subjectProjection.eidFieldPath !== undefined) {
      assertNodeFieldPath(id, nodes, spec.subjectProjection.nodeId, spec.subjectProjection.eidFieldPath, "subject EID projection", "offers");
    }
  }

  const editData = spec.capabilities?.editData;
  if (typeof editData === "object") {
    // Ref data-intake-and-edit-data /§6.3: an editable path must resolve through the producing
    // node's own output schema, and only a READ task node's output is correctable (a write proof isn't).
    for (const field of editData.fields) {
      const owner = nodeByIdOrThrow(id, nodes, field.nodeId, "editData field");
      if (owner.kind !== "task") {
        throw new Error(
          `${id}: editData field "${field.fieldPath}" names node "${String(field.nodeId)}" of kind `
          + `"${owner.kind}"; only a read task node's output is correctable — write proofs never are`,
        );
      }
      if (owner.replay !== "checkpoint") {
        // An always-rerun node never replays its checkpoint, so a correction could never be
        // consumed (the executor refuses the leftover patch at resume); refuse the declaration instead.
        throw new Error(
          `${id}: editData field "${field.fieldPath}" names node "${String(field.nodeId)}" with replay `
          + `"${owner.replay}"; only a checkpoint-replayed node's recorded output is correctable — `
          + "an always-rerun node takes its value from the live read",
        );
      }
      // Union arms may offer correctable paths; saving revalidates the entire patched outcome.
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
  const publications = nodes.filter(node => node.kind === "task" && node.dryRun === "stop-before-publish");
  for (const node of publications) {
    if (node.kind === "task" && (node.uses.providers ?? []).length === 0) {
      throw new Error(`${id}: node "${node.id}" declares dryRun "stop-before-publish" but its contract declares no provider to stop before`);
    }
  }
  if (deriveDryRunSupport(nodes).state === "supported") {
    // A dry run stops at a preview boundary, so every projection source must sit behind one that cannot be skipped.
    const boundaries = new Set(nodes.filter(node => isPreviewBoundary(node) && !(node.kind === "task" && node.when !== undefined)).map(node => String(node.id)));
    const behind = new Set<string>();
    for (const node of nodes) {
      if (node.dependsOn.some(dependency => behind.has(String(dependency)) || boundaries.has(String(dependency)))) behind.add(String(node.id));
    }
    for (const projection of spec.artifactProjections ?? []) {
      if (!behind.has(String(projection.source.nodeId))) {
        throw new Error(`${id}: artifact projection "${projection.id}" reads node "${String(projection.source.nodeId)}", which does not depend on an unconditional dry-run preview boundary`);
      }
    }
  }
  if ((spec.artifactProjections ?? []).filter(projection => projection.sink === "documents-file").length > 1) throw new Error(`${id} may publish only one named document artifact per run`);
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

  assertSurfaceFields(id, spec.flow.input, spec.surfaces, spec.protectedInputs ?? []);

  // Keep the exact input type here; widening would invalidate the authored-function proof.
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
    const subtitle = spec.presentation.subtitle?.(parsed);
    if (subtitle !== undefined && subtitle.trim().length === 0) {
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
  // Preview support is derived, never authored.
  for (const [name, surface] of [["inputRun", spec.surfaces.inputRun], ["uploadRun", spec.surfaces.uploadRun]] as const) {
    if (surface !== undefined && "supportsDryRun" in surface) {
      throw new Error(
        `${id}: surfaces.${name}.supportsDryRun is derived from the graph and cannot be authored; `
        + "delete it — whether this workflow can be previewed is decided by its preview boundary nodes",
      );
    }
  }
  // Which nodes an omitted step rebuilds (asserted) and which it leaves unread (omitted); derived
  // once so the terminal-dependency authentication and the retained declaration agree.
  for (const step of spec.timeline ?? []) {
    if (step.selection === undefined) continue;
    const { inputField, selectedWhen } = step.selection;
    assertSchemaOffersPath(spec.flow.input, inputField, `${id}: start step ${step.key} selection`);
    const constant = spec.surfaces?.inputRun?.parser.constants?.find(constant => constant.field === inputField);
    if (constant?.value.kind !== "boolean") throw new Error(`${id}: start step ${step.key} selection requires a boolean default`);
    assertBooleanSelectionField(spec.flow.input, inputField, `${id}: start step ${step.key} ingress`);
    assertBooleanSelectionField(spec.canonicalInput, inputField, `${id}: start step ${step.key} canonical`);
    if (step.omission !== undefined) throw new Error(`${id}: start step ${step.key} has both selection and omission`);
    for (const member of step.nodes) {
      const node = nodes.find(node => node.id === member);
      if (node?.kind === "task" && node.when?.of.from === "input" && String(node.when.of.path) === inputField
        && (node.when.kind !== (selectedWhen ? "is-true" : "is-false"))) throw new Error(`${id}: start step ${step.key} selection contradicts its condition`);
    }
  }
  const stepOmissions = deriveStepOmissions(id, nodes, spec.timeline);
  const failureCorrections = spec.failureCorrections === undefined ? undefined : validateFailureCorrections(spec.flow.input, nodes, spec.failureCorrections);
  const gateCorrections = spec.gateCorrections === undefined ? undefined : validateGateCorrections(spec.flow.input, nodes, spec.gateCorrections);
  const rerunValues = spec.rerunValues === undefined ? undefined : validateRerunValueMappings({
    input: spec.flow.input, nodes, stepOmissions,
    ...(spec.protectedInputs === undefined ? {} : { protectedInputs: spec.protectedInputs }),
  }, spec.rerunValues);
  const omissionOfNode = new Map<string, Readonly<{ step: string; produced: boolean }>>();
  for (const declared of spec.timeline ?? []) {
    if (declared.omission === undefined) continue;
    for (const member of declared.nodes) {
      const node = nodeByIdOrThrow(id, nodes, NodeIdSchema.parse(member), `step "${declared.key}" omission`);
      if (node.kind === "gate") continue;
      omissionOfNode.set(member, Object.freeze({ step: declared.key, produced: Object.hasOwn(declared.omission.produces, member) }));
    }
  }
  const surfaces = Object.freeze({
    ...spec.surfaces,
    ...(spec.surfaces.inputRun === undefined
      ? {}
      : { inputRun: Object.freeze({ ...spec.surfaces.inputRun, supportsDryRun: dryRun.state === "supported" }) }),
    ...(spec.surfaces.uploadRun === undefined
      ? {}
      : { uploadRun: Object.freeze({ ...spec.surfaces.uploadRun, supportsDryRun: dryRun.state === "supported" }) }),
  });
  const descriptor: WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D> = Object.freeze({
    ...spec,
    ...(spec.protectedInputs === undefined ? {} : { protectedInputs: Object.freeze(ProtectedInputDeclarationSchema.array().max(1).parse(spec.protectedInputs)) }),
    id,
    contractFingerprint,
    requiredWorkbookFields,
    ...(workbookReference === undefined ? {} : { workbookReference }),
    surfaces,
    input: spec.flow.input,
    result: spec.flow.result,
    nodes: spec.flow.nodes,
    scenarios: declaredScenarios,
    timeline: deriveTimeline(id, nodes, spec.timeline?.map(({ key, label, description, system, selection, operatorFields, nodes: members }) => ({ key, label, ...(description === undefined ? {} : { description }), ...(system === undefined ? {} : { system }), ...(operatorFields === undefined ? {} : { operatorFields }), ...(selection === undefined ? {} : { selection }), nodes: members }))),
    timelineDeclared: spec.timeline !== undefined,
    stepOmissions,
    ...(rerunValues === undefined ? {} : { rerunValues }),
    ...(failureCorrections === undefined ? {} : { failureCorrections }),
    ...(gateCorrections === undefined ? {} : { gateCorrections }),
    nodePurposes: deriveNodePurposes(id, nodes, spec.nodePurposes),
  });
  PROJECTIONS.set(descriptor, { ownDryRun: dryRun, support: dryRun, projections: Object.freeze({
    requiredWorkbookFields,
    ...(workbookReference === undefined ? {} : { workbookReference }),
    steps,
    gates,
    systems,
    requires,
    coveragePoints: deriveGraphCoveragePoints(nodes),
    scenarios,
    get dryRun() { return workflowDryRunSupport(descriptor); },
    contracts: Object.freeze(contracts),
  }) });
  PLANNING.set(descriptor, Object.freeze({
    requiredWorkbookFields,
    ...(workbookReference === undefined ? {} : { workbookReference }),
    plannedOutputs: (parsed: unknown, references: readonly RunWorkbookReference[]) => PlannedRunOutputSchema.array().parse(spec.plannedOutputs?.(spec.canonicalInput.parse(parsed), references) ?? []),
    parseInput: (raw: unknown) => {
      const input = spec.flow.input.parse(raw);
      const lookups = workbookReference === undefined ? [] : [workbookReference.mode === "all"
        ? { mode: "all" as const, typeId: workbookReference.id, fields: [...requiredWorkbookFields] }
        : { typeId: workbookReference.id, keys: [...requireReferenceKeys(referenceKeys, input)], fields: [...requiredWorkbookFields] }];
      return { input, lookups: WorkbookReferenceLookupSchema.array().parse(lookups) };
    },
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
  const dependencySchemaHashes = new Map<NodeId, Fingerprint>();
  // Share dependency rules between full and preview results.
  const dependencySpecFor = (
    nodeIds: readonly NodeId[],
    purpose: string,
  ): WorkflowTerminalResultExecution["dependencies"] => Object.freeze(
    nodeIds.map((nodeId) => {
      const node = nodeByIdOrThrow(id, nodes, nodeId, purpose);
      if (node.kind === "child-run" && node.cardinality !== "one" && purpose === "terminal result" && terminalDependsOn.includes(nodeId)) {
        throw new Error(`${id}: ${purpose} dependency ${nodeId} owns no output schema`);
      }
      const evidenceBinding = terminalEvidenceOf(node);
      if (evidenceBinding === undefined) {
        throw new Error(`${id}: ${purpose} dependency ${nodeId} owns no output schema`);
      }
      dependencySchemaHashes.set(nodeId, deriveSchemaHash(evidenceBinding.checkpointSchema, "output"));
      const isBranchTarget = branchTargets.has(nodeId);
      const hasWhen = (node.kind === "task" || (node.kind === "gate" && node.resolvedBy === "operator")) && node.when !== undefined;
      if (isBranchTarget && hasWhen) {
        throw new Error(
          `${id}: ${purpose} dependency ${nodeId} has both branch and when conditionality; `
          + "its durable not-run reason would be ambiguous",
        );
      }
      const omission = omissionOfNode.get(String(nodeId));
      return Object.freeze({
        nodeId,
        ...(isBranchTarget
          ? { notRunReason: "branch-not-selected" as const }
          : hasWhen ? { notRunReason: "condition-false" as const } : {}),
        ...(omission === undefined ? {} : omission.produced ? { assertable: true as const } : { omittable: true as const }),
      });
    }),
  );
  const terminalDependencies = dependencySpecFor(terminalDependsOn, "terminal result");
  const canonicalInputSchemaHash = deriveSchemaHash(spec.canonicalInput, "output");
  const terminalResultSchemaHash = deriveSchemaHash(spec.flow.result.schema, "output");
  /** The RUN identity checks shared by `build` and `buildPreview`, so the two never diverge on what "this run may settle against this descriptor" means. */
  const assertTerminalRunBinding = (currentRun: WorkflowTerminalRun, schemaReader?: EvidenceSchemaReader): z.output<typeof spec.canonicalInput> => {
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
    if ((schemaReader?.({ kind: "run-input", id: currentRun.envelope.runId }, currentRun.input, currentRun.input.parsed.schemaHash, canonicalInputSchemaHash) ?? currentRun.input.parsed.schemaHash) !== canonicalInputSchemaHash) {
      throw new Error(
        `run ${currentRun.envelope.runId} canonical input schema ${currentRun.input.parsed.schemaHash} `
        + `does not match descriptor schema ${canonicalInputSchemaHash}`,
      );
    }
    return spec.canonicalInput.parse(currentRun.input.parsed.value);
  };

    // Preview and terminal results use identical dependency checks.
  const resolveTerminalDependencies = (
    currentRun: WorkflowTerminalRun,
    evidenceInput: unknown,
    expectedDependencies: WorkflowTerminalResultExecution["dependencies"],
    purpose: string,
    allowChildPreviews = false,
    schemaReader?: EvidenceSchemaReader,
  ): Readonly<{ outputs: Record<string, unknown>; dependencies: TerminalDependencyRecord[] }> => {
    const expectedIds = expectedDependencies.map(({ nodeId }) => nodeId);
    const evidence = z.array(TerminalDependencyEvidenceSchema).parse(evidenceInput);
    const evidenceNodeIds = evidence.map(({ nodeId }) => nodeId);
    if (new Set(evidenceNodeIds).size !== evidenceNodeIds.length) {
      throw new Error(`${purpose} dependency evidence contains a duplicate node identity`);
    }
    const additional = evidence.filter(entry => !expectedIds.includes(entry.nodeId) && entry.state === "delegation-resolved");
    const extras = evidenceNodeIds.filter(nodeId => !expectedIds.includes(nodeId) && !additional.some(entry => entry.nodeId === nodeId));
    const missing = expectedIds.filter((nodeId) => !evidenceNodeIds.includes(nodeId));
    if (extras.length > 0 || missing.length > 0) {
      throw new Error(
        `${purpose} dependency evidence does not match authenticated dependsOn; `
        + `missing=${missing.join(",") || "none"} extra=${extras.join(",") || "none"}`,
      );
    }
    const byNode = new Map(evidence.map((entry) => [entry.nodeId, entry]));
    const outputs: Record<string, unknown> = {};
    const dependencies: TerminalDependencyRecord[] = [...expectedDependencies, ...dependencySpecFor(additional.map(entry => entry.nodeId), purpose)].map((expected) => {
      const entry = byNode.get(expected.nodeId);
      if (entry === undefined) throw new Error(`${purpose} dependency ${expected.nodeId} is missing`);
      if (entry.state === "gate-resolved") {
        const node = nodeByIdOrThrow(id, nodes, entry.nodeId, purpose);
        const gate = entry.gate;
        if (node.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, deriveSchemaHash(node.result, "output")) ?? gate.result.schemaHash) !== dependencySchemaHashes.get(entry.nodeId)
          || (node.resolvedBy === "operator" ? !("commandId" in gate) : !("source" in gate) || gate.source.kind !== node.resolvedBy)
          || gate.runId !== currentRun.envelope.runId && !currentRun.envelope.continuation?.gates.some(reference => reference.runId === gate.runId && reference.nodeId === entry.nodeId)) {
          throw new Error("terminal-gate-dependency-identity-mismatch");
        }
        const receipt = terminalGateDependencyRecord(entry.nodeId, gate);
        outputs[entry.nodeId] = node.result.parse(gate.result.value);
        return receipt;
      }
      const sourceParent = entry.state === "delegation-resolved" || entry.state === "child-resolved"
        ? entry.parentRunId === currentRun.envelope.runId
          ? { runId: currentRun.envelope.runId, attempt: currentRun.envelope.attempt }
          : currentRun.envelope.continuation?.sources.find(source => source.runId === entry.parentRunId)
        : undefined;
      if (entry.state === "delegation-resolved") {
        const node = nodeByIdOrThrow(id, nodes, entry.nodeId, purpose);
        if (node.kind !== "child-run" || sourceParent === undefined || entry.edgeId !== node.edgeId
          || entry.invocationCommandId !== delegationInvocationCommandId({ runId: sourceParent.runId, attempt: sourceParent.attempt, nodeId: node.id, revision: entry.manifest.revision })
          || entry.manifest.cardinality !== node.cardinality || entry.manifest.join !== node.join
          || canonicalJsonStringify(entry.manifest.policy) !== canonicalJsonStringify(node.policy)
          || (schemaReader?.({ kind: "delegation-input", id: entry.manifest.manifestId }, entry.manifest, entry.manifest.inputSchemaHash, deriveSchemaHash(node.target.input, "input")) ?? entry.manifest.inputSchemaHash) !== deriveSchemaHash(node.target.input, "input")
          || (schemaReader?.({ kind: "delegation-result", id: entry.manifest.manifestId }, entry.manifest, entry.manifest.resultSchemaHash, deriveSchemaHash(node.target.result, "output")) ?? entry.manifest.resultSchemaHash) !== deriveSchemaHash(node.target.result, "output")
          || entry.children.some(child => child.run.envelope.workflow !== node.target.id || child.run.envelope.dryRun !== currentRun.envelope.dryRun)) throw new Error("terminal-delegation-dependency-identity-mismatch");
        const resolution = resolveDelegationEvidenceOutput(entry, node.target.result, schemaReader);
        if (resolution.kind === "preview") {
          if (!allowChildPreviews || !currentRun.envelope.dryRun) throw new Error("terminal-preview-is-not-workflow-output");
        } else if (expectedIds.includes(entry.nodeId)) outputs[entry.nodeId] = resolution.output;
        return terminalDelegationDependencyRecord(entry);
      }
      if (entry.state === "child-resolved") {
        const node = nodeByIdOrThrow(id, nodes, entry.nodeId, purpose);
        if (node.kind !== "child-run" || node.await !== "terminal" || node.cardinality !== "one" || node.join !== "one") throw new Error("terminal-child-dependency-shape-mismatch");
        const child = entry.childRun;
        const result = RunResultRecordSchema.parse(entry.result);
        if (readRunPreviewResult(result) !== undefined) throw new Error("terminal-child-preview-requires-group");
        if (sourceParent === undefined || entry.edgeId !== node.edgeId
          || child.workflowId !== node.target.id || result.runId !== child.runId || result.workflowId !== child.workflowId
          || result.attempt !== child.attempt || result.descriptorVersion !== child.descriptorVersion
          || result.contractFingerprint !== child.contractFingerprint || (schemaReader?.({ kind: "run-result", id: result.runId }, result, result.resultSchemaHash, deriveSchemaHash(node.target.result, "output")) ?? result.resultSchemaHash) !== deriveSchemaHash(node.target.result, "output")) throw new Error("terminal-child-dependency-identity-mismatch");
        const output = node.target.result.parse(result.result.value);
        outputs[entry.nodeId] = { state: "done", runId: child.runId, itemId: child.itemId, output };
        return { state: "child-resolved", nodeId: entry.nodeId, parentRunId: entry.parentRunId, edgeId: entry.edgeId,
          child: { runId: child.runId, itemId: child.itemId, workflowId: child.workflowId, attempt: child.attempt,
            descriptorVersion: child.descriptorVersion, contractFingerprint: child.contractFingerprint,
            resultSchemaHash: result.resultSchemaHash, resultDigest: result.resultDigest, dependencyDigest: result.dependencyDigest },
          ...(result.operationSources === undefined ? {} : { operationSources: result.operationSources }),
          ...(result.operationLineage === undefined ? {} : { operationLineage: result.operationLineage }) };
      }

        if (entry.state === "asserted") {
          if (expected.assertable !== true) {
            throw new Error(`${purpose} dependency ${entry.nodeId} is not producible by any step omission and cannot be asserted`);
          }
          const declaredStep = omissionOfNode.get(String(entry.nodeId))?.step;
          if (declaredStep !== entry.step) {
            throw new Error(
              `${purpose} dependency ${entry.nodeId} is asserted for step "${entry.step}", `
              + `but its declared omittable step is "${declaredStep ?? "(none)"}"`,
            );
          }
          if (!(currentRun.envelope.stepOmissions ?? []).some((omission) => omission.step === entry.step)) {
            throw new Error(`${purpose} dependency ${entry.nodeId} is asserted for step "${entry.step}", which this run did not omit`);
          }
          const assertedNode = nodeByIdOrThrow(id, nodes, entry.nodeId, purpose);
          const assertedBinding = terminalEvidenceOf(assertedNode);
          if (assertedBinding === undefined) {
            throw new Error(`${id}: ${purpose} dependency ${entry.nodeId} owns no output schema`);
          }
          const assertedSchemaHash = dependencySchemaHashes.get(entry.nodeId);
          if (entry.output.schemaHash !== assertedSchemaHash) {
            throw new Error(
              `${purpose} dependency ${entry.nodeId} asserted output schema `
              + `${entry.output.schemaHash} does not match ${assertedSchemaHash}`,
            );
          }
          outputs[entry.nodeId] = assertedBinding.project(entry.output.value, `${purpose} dependency ${entry.nodeId}`);
          return {
            state: "asserted",
            nodeId: entry.nodeId,
            step: entry.step,
            assertedAt: entry.assertedAt,
            outputSchemaHash: entry.output.schemaHash,
            outputDigest: deriveCheckpointOutputDigest(entry.output),
          };
        }
        if (entry.state === "not-run") {
          if (entry.reason === "operator-asserted") {
            throw new Error(
              `${purpose} dependency ${entry.nodeId} cannot be marked not-run as operator-asserted; `
              + "an asserted node carries its output in the asserted evidence arm",
            );
          }
          if (entry.reason === "step-omitted") {
            if (expected.omittable !== true) {
              throw new Error(`${purpose} dependency ${entry.nodeId} belongs to no omittable step and cannot be marked step-omitted`);
            }
            outputs[entry.nodeId] = undefined;
            return { state: "not-run", nodeId: entry.nodeId, reason: entry.reason };
          }
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
        const outputSchemaHash = dependencySchemaHashes.get(entry.nodeId);
        if (outputSchemaHash === undefined || (schemaReader?.({ kind: "task-output", id: checkpointRecordKey(checkpoint) }, checkpoint, checkpoint.output.schemaHash, outputSchemaHash) ?? checkpoint.output.schemaHash) !== outputSchemaHash) {
          throw new Error(
            `${purpose} dependency ${entry.nodeId} checkpoint output schema `
            + `${checkpoint.output.schemaHash} does not match ${outputSchemaHash}`,
          );
        }
        outputs[entry.nodeId] = binding.project(
          checkpoint.output.value,
          `${purpose} dependency ${entry.nodeId}`,
          { checkpoint, schemaReader },
        );
        return {
          state: "resolved",
          nodeId: entry.nodeId,
          checkpoint: {
            workflowId: checkpoint.workflowId,
            itemId: checkpoint.itemId,
            attempt: checkpoint.attempt,
            claimGeneration: checkpoint.claimGeneration,
            runId: checkpoint.runId,
          },
          outputSchemaHash: checkpoint.output.schemaHash,
          descriptorVersion: checkpoint.descriptorVersion,
          contractFingerprint: checkpoint.contractFingerprint,
          implFingerprint: checkpoint.implFingerprint,
          outputDigest: deriveCheckpointOutputDigest(checkpoint.output),
          provenanceDigest: deriveCheckpointProvenanceDigest(checkpoint.provenance),
          ...(checkpoint.operationSources === undefined ? {} : { operationSources: checkpoint.operationSources }),
        };
    });
    return Object.freeze({ outputs, dependencies });
  };

    // WeakMap membership binds authority to exact result bytes and the settling run.
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
    schemaHash: terminalResultSchemaHash,
    dependsOn: Object.freeze(terminalDependsOn),
    dependencies: terminalDependencies,
    parseResult: (candidate: unknown) => spec.flow.result.schema.parse(candidate),
    derive: spec.flow.result.derive,
    build: (currentRun: WorkflowTerminalRun, evidenceInput: unknown, clock: TerminalResultClock, schemaReader?: EvidenceSchemaReader) => {
      const input = assertTerminalRunBinding(currentRun, schemaReader);
      const { outputs, dependencies } = resolveTerminalDependencies(
        currentRun,
        evidenceInput,
        terminalDependencies,
        "terminal",
        false, schemaReader,
      );

      const scopeCandidate = Object.freeze({ input, outputs: Object.freeze(outputs) });
      // Preserve the derive scope only after validating every dependency and output.
      const ExactTerminalScopeSchema = z.custom<Parameters<typeof spec.flow.result.derive>[0]>(
        (candidate) => candidate === scopeCandidate,
        "terminal derive scope was not assembled by the descriptor factory",
      );
      const derived = spec.flow.result.derive(ExactTerminalScopeSchema.parse(scopeCandidate));
      const parsedResult = JsonValueSchema.parse(spec.flow.result.schema.parse(derived));
      const schemaHash = terminalResultSchemaHash;
      const resultValue = { schemaHash, value: parsedResult,
        ...(retainedRunProtectedBindings(currentRun).length === 0 ? {} :
          { protectedBindings: retainedRunProtectedBindings(currentRun) }) };
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
        ...(currentRun.envelope.continuation === undefined ? {} : { continuation: currentRun.envelope.continuation }),
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
      schemaReader?: EvidenceSchemaReader,
    ) => {
      assertTerminalRunBinding(currentRun, schemaReader);
      // Preview requires a run the operator enqueued as a dry run.
      if (!currentRun.envelope.dryRun) {
        throw new Error(
          `run ${currentRun.envelope.runId} is not a dry run; a preview result may not be built for it`,
        );
      }
      const support = workflowDryRunSupport(descriptor);
      if (support.state !== "supported") {
        throw new Error(`${id} is not previewable (${support.reason}); no preview result can describe a run of it`);
      }
      const steps = z.array(AnyRunPreviewStepSchema).parse(previewInput);
      const expectedIds = nodes.map(node => String(node.id));
      if (steps.length !== expectedIds.length || steps.some((step, index) => step.nodeId !== expectedIds[index])) {
        throw new Error("dry-run preview must account for every declared node exactly once in execution order");
      }
      for (const step of steps) {
        const node = nodeByIdOrThrow(id, nodes, step.nodeId, "dry-run preview");
        if (step.state === "transaction-preview" && (node.kind !== "transaction" || step.preview.nodeId !== step.nodeId)) {
          throw new Error("dry-run preview transaction membership mismatch");
        }
        if (node.kind === "transaction" && step.state === "exercised") throw new Error("a preview cannot claim a transaction executed");
        if (step.state === "delegation-preview" && (node.kind !== "child-run" || node.await !== "terminal")) throw new Error("dry-run preview delegation membership mismatch");
        const publication = node.kind === "task" && node.dryRun === "stop-before-publish";
        if (step.state === "publication-preview" && !publication) throw new Error("dry-run preview publication membership mismatch");
        if (publication && step.state === "exercised") throw new Error("a preview cannot claim a publication executed");
      }
      const targets = projectionStateOf(descriptor).targets;
      const dispatched = nodes.find(node => {
        if (node.kind !== "child-run" || node.join !== "none" || !steps.some(step => step.nodeId === node.id && step.state === "exercised")) return false;
        const target = targets?.get(node.id);
        return target !== undefined && workflowDryRunSupport(target).state === "supported";
      });
      const published = steps.some(step => step.state === "publication-preview");
      // Delegation-preview steps equal the resolved preview members (checked below), so this sees every delegated preview.
      if (published && ("firstDelegationNodeId" in support || dispatched !== undefined || steps.some(step => step.state === "delegation-preview"))) {
        throw new Error("dry-run preview cannot combine publication and delegated previews");
      }
      const { dependencies } = resolveTerminalDependencies(currentRun, evidenceInput,
        dependencySpecFor(workflowPreviewDependencyIds(descriptor, steps), "dry-run preview"), "dry-run preview", true, schemaReader);
      const previewNodes = new Set(dependencies.filter(dependency => dependency.state === "delegation-resolved"
        && dependency.members.some(member => isRunPreviewSchemaHash(member.resultSchemaHash))).map(dependency => dependency.nodeId));
      if (steps.some(step => (step.state === "delegation-preview") !== previewNodes.has(step.nodeId))) throw new Error("dry-run preview delegation accounting mismatch");
      const delegated = "firstDelegationNodeId" in support || previewNodes.size > 0 || dispatched !== undefined;
      const schema = published ? RunPublicationDryRunPreviewResultSchema
        : delegated ? RunDelegatedDryRunPreviewResultSchema : RunDryRunPreviewResultSchema;
      const previewValue = JsonValueSchema.parse(schema.parse({
        kind: published ? "publication-dry-run-preview" : delegated ? "delegated-dry-run-preview" : "dry-run-preview",
        externalCommit: "none",
        coverage: dispatched === undefined ? { state: "full" } : { state: "partial", boundaryNodeId: dispatched.id, reason: "descendant-not-awaited" },
        steps,
      }));
      const schemaHash = deriveSchemaHash(schema, "output");
      const resultValue = { schemaHash, value: previewValue,
        ...(retainedRunProtectedBindings(currentRun).length === 0 ? {} :
          { protectedBindings: retainedRunProtectedBindings(currentRun) }) };
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
        ...(currentRun.envelope.continuation === undefined ? {} : { continuation: currentRun.envelope.continuation }),
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
