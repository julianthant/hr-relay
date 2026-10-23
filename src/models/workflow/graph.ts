import type { ProtectedInputBinding } from "../write-safety/protected-input.js";
/** Bundle-safe workflow graph vocabulary: the node shapes a descriptor is made of, operational type surfaces rather than durable-data boundaries. */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../../rules/validation/canonical-json.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
} from "../task/task-contract.js";
import type { CompletionCheck } from "../task/write-safety.js";
import { deriveSchemaHash } from "../validation/schema-bound-value.js";
import { TransactionOutcomeSchema } from "../../rules/write-safety/write-safety-primitives.js";
import {
  DelegationEdgeIdSchema,
  DelegationManifestIdSchema,
  FailureIdSchema,
  ItemIdSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  RunIdSchema,
} from "../../rules/identity/ids.js";
import type { DelegationEdgeId, FailureId, ItemId, NodeId, RunId, WorkflowId } from "../../rules/identity/ids.js";
import type { RetryPolicy } from "../sessions/session.js";
import type { DelegationPolicy } from "./delegation-policy.js";
import type { NodeCondition } from "./node-condition.js";

/** The proof type a commit contract's completion arm produces. */
export type ProofOf<C extends AnyCommitTaskContract> =
  C["writeSafety"]["completion"] extends CompletionCheck<z.ZodType, infer Proof extends z.ZodType>
    ? z.output<Proof>
    : never;

export interface WorkflowRef<InputSchema extends z.ZodType, ResultSchema extends z.ZodType> {
  readonly id: WorkflowId;
  readonly input: InputSchema;
  /** The schema-valid terminal value a successful child exposes to its parent. */
  readonly result: ResultSchema;
}
export type AnyWorkflowRef = WorkflowRef<z.ZodType, z.ZodType>;

/** The widest scope a runtime switch may see; never a source of inference. */
export interface RuntimeScope {
  readonly input: JsonValue;
  readonly protectedInputBindings?: readonly ProtectedInputBinding[];
  readonly outputs: JsonObject;
  readonly configuration?: Readonly<Record<string, JsonValue>>;
}

export interface WorkflowGateSource<
  Target extends AnyWorkflowRef,
  EventSchema extends z.ZodType,
> {
  readonly kind: "workflow";
  readonly workflow: Target;
  readonly event: EventSchema;
  readonly correlationKey: string;
  readonly terminal?: readonly string[];
}
export interface ExternalGateSource<EventSchema extends z.ZodType> {
  readonly kind: "external";
  readonly sourceId: string;
  readonly event: EventSchema;
  readonly correlationKey: string;
}

export const GraphNodeKindSchema = z.enum([
  "task", "transaction", "branch", "parallel", "child-run", "gate",
]);
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;
export interface GraphNodeBase {
  readonly kind: GraphNodeKind;
  readonly id: NodeId;
  readonly dependsOn: readonly NodeId[];
}

export interface TaskStepNode<Scope, C extends AnyReadTaskContract> extends GraphNodeBase {
  readonly kind: "task";
  /** Display label. Defaults to the contract's `title` (ref workflow-model precedence). */
  readonly label?: string;
  /** Import the contract by value. */
  readonly uses: C;
  /** Pure: workflow input + declared upstream outputs → `z.input<C["input"]>`. */
  readonly bind: (scope: Scope) => z.input<C["input"]>;
    /* A DECLARED condition, evaluated by one function and rendered by another: one declaration, so the sentence the explorer prints cannot disagree with the rule the executor applies. */
  readonly when?: NodeCondition;
  /** Resume policy — REQUIRED, no default (ref workflow-model ). */
  readonly replay: "checkpoint" | "always-rerun";
}

/** Contract-typed downstream values project the durable outcome without minting another schema. */
export type TypedTransactionOutcome<C extends AnyCommitTaskContract> =
  | Readonly<{
    disposition: "committed";
    proofSource: "normal-output" | "recovery-probe" | "operator-attestation";
    output: z.output<C["output"]>;
    proof: ProofOf<C>;
  }>
  | Readonly<{
    disposition: "already-present";
    proofSource: "durable-intent" | "live-probe";
    output: z.output<C["output"]>;
    proof: ProofOf<C>;
  }>;

/** Lower the durable transaction outcome a checkpoint row stores onto the graph-scope type; the ONE allowed direction, and a projection: no field is defaulted, substituted, or invented. */
export function projectTransactionOutcome<C extends AnyCommitTaskContract>(
  commit: C,
  storedValue: unknown,
  context: string,
): TypedTransactionOutcome<C> {
  const outcome = TransactionOutcomeSchema.parse(storedValue);
  const outputSchemaHash = deriveSchemaHash(commit.output, "output");
  if (outcome.output.schemaHash !== outputSchemaHash) {
    throw new Error(
      `${context}: stored transaction outcome binds commit output schema ${outcome.output.schemaHash}, `
      + `and ${commit.id} now declares ${outputSchemaHash}`,
    );
  }
  const proofSchema = commit.writeSafety.completion.proofSchema;
  const proofSchemaHash = deriveSchemaHash(proofSchema, "output");
  if (outcome.proof.schemaHash !== proofSchemaHash) {
    throw new Error(
      `${context}: stored transaction outcome binds completion proof schema ${outcome.proof.schemaHash}, `
      + `and ${commit.id} now declares ${proofSchemaHash}`,
    );
  }
  const projected = Object.freeze({
    disposition: outcome.disposition,
    proofSource: outcome.proofSource,
    output: commit.output.parse(outcome.output.value),
    proof: proofSchema.parse(outcome.proof.value),
  });
  // Narrow only the object assembled from contract-parsed values with verified nested hashes.
  const ExactProjection = z.custom<TypedTransactionOutcome<C>>(
    (candidate) => candidate === projected,
    "transaction outcome projection was not assembled by projectTransactionOutcome",
  );
  return ExactProjection.parse(projected);
}

export interface TransactionNode<
  Scope,
  P extends AnyPrepareTaskContract,
  C extends AnyCommitTaskContract,
> extends GraphNodeBase {
  readonly kind: "transaction";
  readonly label?: string;
  readonly prepare: Readonly<{ uses: P; bind: (scope: Scope) => z.input<P["input"]> }>;
    // Bind commit input before probes; never include ephemeral prepare output in durable transaction identity.
  readonly commit: Readonly<{ uses: C; bind: (scope: Scope) => z.input<C["input"]> }>;
  /** Same context/page lease from prepare start through commit verification. */
  readonly leaseScope: "transaction";
  readonly dryRun: "stop-after-prepare" | "unsupported";
  readonly probePolicy: "always" | "retries-and-recovery-only";
  /** Probe→fence budget; a stale preflight may never proceed to a click. */
  readonly probeToFenceMaxMs: number;
  /** Restarts preflight+prepare on a fresh/reset lease; never commit. */
  readonly retryBeforeFence?: RetryPolicy;
}

export interface BranchNode<
  Scope,
  Cases extends Readonly<Record<string, readonly NodeId[]>>,
> extends GraphNodeBase {
  readonly kind: "branch";
  readonly choose: (scope: Scope) => keyof Cases & string;
  readonly cases: Cases;
}

export const ParallelBranchSpecSchema = z.strictObject({
  id: z.string().min(1),
  nodes: z.array(NodeIdSchema),
});
export type ParallelBranchSpec = z.infer<typeof ParallelBranchSpecSchema>;
export interface ParallelNode extends GraphNodeBase {
  readonly kind: "parallel";
  readonly branches: readonly ParallelBranchSpec[];
  readonly join: "all" | "all-settled";
}

/** One vocabulary, one owner — see `./delegation-policy.js`. */
export {
  ChildCancelPolicySchema,
  ChildFailurePolicySchema,
  ChildRetryPolicySchema,
  ChildVisibilitySchema,
  DelegationPolicySchema,
} from "./delegation-policy.js";
export type {
  ChildCancelPolicy,
  ChildFailurePolicy,
  ChildRetryPolicy,
  ChildVisibility,
  DelegationPolicy,
} from "./delegation-policy.js";

export type ChildRunOutcome<Target extends AnyWorkflowRef> =
  | Readonly<{ state: "done"; runId: RunId; itemId: ItemId; output: z.output<Target["result"]> }>
  | Readonly<{ state: "failed"; runId: RunId; itemId: ItemId; failureId: FailureId }>
  | Readonly<{
    state: "cancelled";
    runId: RunId;
    itemId: ItemId;
    reason: string;
    cancelledBy: "operator" | "parent" | "kernel";
  }>
  | Readonly<{ state: "blocked"; runId: RunId; itemId: ItemId; failureId: FailureId; reason: string }>;

/** The durable validator for a child terminal outcome; every child outcome is schema-parsed and stored BEFORE the dependency transition. */
export function childRunOutcomeSchema<ResultSchema extends z.ZodType>(result: ResultSchema) {
  const identity = { runId: RunIdSchema, itemId: ItemIdSchema } as const;
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("done"), ...identity, output: result }),
    z.strictObject({ state: z.literal("failed"), ...identity, failureId: FailureIdSchema }),
    z.strictObject({
      state: z.literal("cancelled"),
      ...identity,
      reason: z.string().min(1),
      cancelledBy: z.enum(["operator", "parent", "kernel"]),
    }),
    z.strictObject({
      state: z.literal("blocked"),
      ...identity,
      failureId: FailureIdSchema,
      reason: z.string().min(1),
    }),
  ]);
}

/** An un-awaited fan-out yields the immutable manifest reference, never child outcomes. */
export const DelegationManifestRefSchema = z.strictObject({
  manifestId: DelegationManifestIdSchema,
  edgeId: DelegationEdgeIdSchema,
  childCount: NonNegativeIntSchema,
});
export type DelegationManifestRef = z.infer<typeof DelegationManifestRefSchema>;

export interface ChildRunIdentityContext {
  readonly canonicalItemId: ItemId;
}

interface ChildRunNodeBase<Target extends AnyWorkflowRef> extends GraphNodeBase {
  readonly kind: "child-run";
  readonly edgeId: DelegationEdgeId;
  readonly target: Target;
  readonly deriveChildItemId: (input: z.output<Target["input"]>, context: ChildRunIdentityContext) => ItemId;
  readonly policy: DelegationPolicy;
}
export type ChildRunNode<Scope, Target extends AnyWorkflowRef> =
  | (ChildRunNodeBase<Target> & Readonly<{
    cardinality: "one";
    bind: (scope: Scope) => z.input<Target["input"]>;
    await: "terminal";
    join: "one";
  }>)
  | (ChildRunNodeBase<Target> & Readonly<{
    cardinality: "many";
    bind: (scope: Scope) => readonly z.input<Target["input"]>[];
    await: "terminal";
    join: "all" | "all-settled";
  }>)
  | (ChildRunNodeBase<Target> & Readonly<{
    cardinality: "one" | "many";
    bind: (scope: Scope) => z.input<Target["input"]> | readonly z.input<Target["input"]>[];
    await: "none";
    join: "none";
  }>);

interface GateNodeBase extends GraphNodeBase {
  readonly kind: "gate";
  readonly label: string;
  /** e.g. "needsReview" — ref dashboard-surfaces's status projection key. */
  readonly statusKey?: string;
}
export interface OperatorGateNode<ResultSchema extends z.ZodType> extends GateNodeBase {
  readonly resolvedBy: "operator";
  /** A false declared condition produces no human decision or gate result. */
  readonly when?: NodeCondition;
  readonly result: ResultSchema;
  readonly subscribes?: never;
  readonly resolve?: never;
}
export interface ChildrenGateNode<
  Source extends WorkflowGateSource<AnyWorkflowRef, z.ZodType>,
  ResultSchema extends z.ZodType,
> extends GateNodeBase {
  readonly resolvedBy: "children-terminal";
  readonly subscribes: Source;
  readonly result: ResultSchema;
  readonly resolve: (event: z.output<Source["event"]>) => z.input<ResultSchema>;
}
export interface ExternalGateNode<
  Source extends ExternalGateSource<z.ZodType>,
  ResultSchema extends z.ZodType,
> extends GateNodeBase {
  readonly resolvedBy: "external";
  readonly subscribes: Source;
  readonly result: ResultSchema;
  readonly resolve: (event: z.output<Source["event"]>) => z.input<ResultSchema>;
}
export type AnyGateNode =
  | OperatorGateNode<z.ZodType>
  | ChildrenGateNode<WorkflowGateSource<AnyWorkflowRef, z.ZodType>, z.ZodType>
  | ExternalGateNode<ExternalGateSource<z.ZodType>, z.ZodType>;

/** Runtime discriminant union: the builder retains the descriptor's exact node tuple, and this alias is only for exhaustive runtime switching, never type inference. */
export type RuntimeFlowNode =
  | TaskStepNode<RuntimeScope, AnyReadTaskContract>
  | TransactionNode<RuntimeScope, AnyPrepareTaskContract, AnyCommitTaskContract>
  | BranchNode<RuntimeScope, Readonly<Record<string, readonly NodeId[]>>>
  | ParallelNode
  | ChildRunNode<RuntimeScope, AnyWorkflowRef>
  | AnyGateNode;
