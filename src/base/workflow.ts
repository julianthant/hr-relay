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
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
  AnyTaskContract,
} from "../domain/contracts/base.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  ItemIdSchema,
  NodeIdSchema,
  ScenarioIdSchema,
  WorkflowIdSchema,
} from "../domain/ids.js";
import type { Fingerprint, ItemId, ScenarioId, WorkflowId } from "../domain/ids.js";
import { SecretNameSchema } from "../domain/secret-names.js";
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
import { GraphNodeKindSchema } from "../domain/workflow/graph.js";
import type { GraphNodeBase, RuntimeFlowNode } from "../domain/workflow/graph.js";
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
  SurfaceShapeSchema,
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
  VerdictDefinition,
  WorkflowActionPolicy,
  WorkflowCapabilities,
  WorkflowCategory,
} from "../domain/workflow/presentation.js";
import { deriveGraphCoveragePoints } from "../domain/workflow/scenario-coverage.js";
import type { GraphCoveragePoint } from "../domain/workflow/scenario-coverage.js";
import { assertSchemaOwnsPath } from "../validation/contract-boundary.js";
import type { AnyNodeEntry, BuiltFlow, WorkflowResultSpec } from "./flow.js";

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
 * Server-only identity functions. They stay in the validated descriptor and
 * project only their resolved values to the client (doc 02 §1.1).
 */
export interface WorkflowIdentitySpec<Input> {
  /** The logical-item match key — retries of the same work share it. */
  readonly matchKey: (input: Input) => string;
  readonly deriveItemId: (input: Input) => ItemId;
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
  readonly capabilities?: WorkflowCapabilities;
  readonly details: readonly DetailProjectionSpec<S>[];
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

/** The broad runtime view a composition root, projection, or guard switches on. */
export type AnyWorkflowDescriptor = WorkflowDescriptor<
  z.ZodType,
  z.ZodType,
  readonly GraphNodeBase[],
  CompletionProgram | undefined,
  Readonly<Record<string, AnyNodeEntry>>,
  readonly string[]
>;

export interface WorkflowDescriptorSpec<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Nodes extends readonly GraphNodeBase[],
  Completion extends CompletionProgram | undefined,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  D extends readonly (keyof S & string)[],
> extends Omit<
  WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D>,
  "id" | "contractFingerprint" | "input" | "result" | "nodes"
> {
  readonly id: string;
  readonly contractFingerprint: string;
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
}

const PROJECTIONS = new WeakMap<object, WorkflowProjections>();

/** The projections derived when the descriptor was built. Fails loud if it was not. */
export function workflowProjections(descriptor: object): WorkflowProjections {
  const projections = PROJECTIONS.get(descriptor);
  if (projections === undefined) {
    throw new Error("workflow projections require the exact object returned by defineWorkflowDescriptor");
  }
  return projections;
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

function outputSchemaOf(node: RuntimeFlowNode): z.ZodType | undefined {
  switch (node.kind) {
    case "task": return node.uses.output;
    case "transaction": return node.commit.uses.output;
    case "gate": return node.result;
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

function assertGraphReferences(id: string, nodes: readonly RuntimeFlowNode[]): void {
  const declared = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (node.kind === "branch") {
      for (const [caseName, targets] of Object.entries(node.cases)) {
        if (targets.length === 0) {
          throw new Error(`${id}: branch ${node.id} case "${caseName}" joins no node`);
        }
        for (const target of targets) {
          if (!declared.has(target)) {
            throw new Error(`${id}: branch ${node.id} case "${caseName}" targets undeclared node ${target}`);
          }
        }
      }
    }
    if (node.kind === "parallel") {
      for (const branch of node.branches) {
        if (branch.nodes.length === 0) {
          throw new Error(`${id}: parallel ${node.id} branch "${branch.id}" runs no node`);
        }
        for (const member of branch.nodes) {
          if (!declared.has(NodeIdSchema.parse(member))) {
            throw new Error(`${id}: parallel ${node.id} branch "${branch.id}" names undeclared node ${member}`);
          }
        }
      }
    }
  }
}

/**
 * The effect placement rule is already structural — `step` takes only a read
 * contract, and prepare/commit contracts are accepted only by a transaction's
 * arms. The runtime check is the backstop for what a cast could smuggle past
 * the types, so the effect is read through a widened local: narrowed to its
 * literal it would be `never`, and a `never` check proves nothing.
 */
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
): void {
  const node = nodeByIdOrThrow(id, nodes, nodeId, owner);
  const schema = outputSchemaOf(node);
  if (schema === undefined) {
    throw new Error(`${id}: ${owner} reads ${node.kind} node ${nodeId}, which owns no output schema`);
  }
  assertSchemaOwnsPath(schema, fieldPath, `${id}: ${owner}`);
}

function assertSurfaceFields(id: string, input: z.ZodType, surfaces: WorkflowSurfaces): void {
  const inputRun = surfaces.inputRun;
  if (inputRun !== undefined) {
    for (const rule of inputRun.parser.rules) {
      assertSchemaOwnsPath(input, rule.emit, `${id}: input-run parser rule`);
    }
    for (const constant of inputRun.parser.constants ?? []) {
      assertSchemaOwnsPath(input, constant.field, `${id}: input-run parser constant`);
    }
  }
  const uploadRun = surfaces.uploadRun;
  if (uploadRun !== undefined) {
    for (const field of uploadRun.fields) {
      assertSchemaOwnsPath(input, field.field, `${id}: upload field`);
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
  assertGraphReferences(id, nodes);
  assertContractPlacement(id, nodes);

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

  for (const detail of spec.details) {
    DetailProjectionSpecRuntimeSchema.parse(detail);
    assertNodeFieldPath(id, nodes, detail.source.nodeId, detail.source.fieldPath, `detail "${detail.key}"`);
  }
  assertUnique(id, "detail keys", spec.details.map((detail) => detail.key));

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
    const itemId = ItemIdSchema.parse(spec.identity.deriveItemId(parsed));
    if (ItemIdSchema.parse(spec.identity.deriveItemId(parsed)) !== itemId) {
      throw new Error(`${where} deriveItemId is not stable across two calls`);
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

  const declaredScenarios = spec.scenarios.map((scenario) => ScenarioIdSchema.parse(scenario));
  if (declaredScenarios.length === 0) throw new Error(`${id}: at least one scenario must be registered`);
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

  const descriptor: WorkflowDescriptor<InputSchema, ResultSchema, Nodes, Completion, S, D> = Object.freeze({
    ...spec,
    id,
    contractFingerprint,
    input: spec.flow.input,
    result: spec.flow.result,
    nodes: spec.flow.nodes,
    scenarios: spec.scenarios,
  });
  PROJECTIONS.set(descriptor, Object.freeze({
    steps,
    gates,
    systems,
    requires,
    coveragePoints: deriveGraphCoveragePoints(nodes),
    scenarios,
    contracts: Object.freeze(contracts),
  }));
  return descriptor;
}

/** The runtime node view for the executor and every guard, derived once per descriptor. */
export function descriptorRuntimeNodes(descriptor: AnyWorkflowDescriptor): readonly RuntimeFlowNode[] {
  return runtimeNodes(descriptor.nodes);
}

export type { AnyCommitTaskContract, AnyPrepareTaskContract, AnyReadTaskContract };
