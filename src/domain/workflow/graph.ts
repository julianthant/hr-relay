/**
 * Bundle-safe workflow graph vocabulary (ref workflow-model §1.1/§3).
 *
 * These are the node shapes a descriptor is made of. They carry pure functions
 * (`bind`, `choose`, `resolve`, `derive`) alongside serializable fields, so they
 * are operational type surfaces rather than durable-data boundaries — the
 * strict-boundary catalog owns the durable/wire records, not these.
 *
 * Nothing here imports a store, an executor, or Playwright. The exact node
 * tuple a builder accumulates is what feeds inference; `RuntimeFlowNode` exists
 * only so the composition root can switch exhaustively at runtime and is never
 * fed back into descriptor inference (ref workflow-model §3).
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../canonical-json.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
} from "../contracts/base.js";
import type { CompletionCheck } from "../contracts/write-safety.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { TransactionOutcomeSchema } from "../write-safety-primitives.js";
import {
  DelegationEdgeIdSchema,
  DelegationManifestIdSchema,
  FailureIdSchema,
  ItemIdSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  RunIdSchema,
} from "../ids.js";
import type { DelegationEdgeId, FailureId, ItemId, NodeId, RunId, WorkflowId } from "../ids.js";
import type { RetryPolicy } from "../session.js";
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
  readonly outputs: JsonObject;
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
  /** Display label. Defaults to the contract's `title` (ref workflow-model §1.5 precedence). */
  readonly label?: string;
  /** The CONTRACT object (ref task-contract / D3), imported by value. */
  readonly uses: C;
  /** Pure: workflow input + declared upstream outputs → `z.input<C["input"]>`. */
  readonly bind: (scope: Scope) => z.input<C["input"]>;
  /**
   * D228 — a DECLARED condition, evaluated by `evaluateNodeCondition` and
   * rendered by `describeNodeCondition`. One declaration, so the sentence the
   * explorer prints cannot disagree with the rule the executor applies.
   */
  readonly when?: NodeCondition;
  /** Resume policy — REQUIRED, no default (ref workflow-model §5.3). */
  readonly replay: "checkpoint" | "always-rerun";
}

/**
 * The graph-scope view of ref write-safety's durable `TransactionOutcome`
 * (`src/domain/write-safety.ts`), which stores `output`/`proof` as
 * schema-bound canonical values. Here they are the parsed, contract-typed
 * values a downstream `bind` actually reads. Same event, two altitudes — ref write-safety
 * owns the durable record and its validator; this is only its typed refinement,
 * so the name is distinct and nothing mints a second durable schema.
 *
 * Downstream nodes cannot confuse "this run clicked" with "the permanent key
 * was already satisfied"; both still carry the contract's full typed output.
 */
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

/**
 * Lower the DURABLE `TransactionOutcome` a `run_checkpoints` row stores onto the
 * graph-scope `TypedTransactionOutcome<C>` every descriptor is authored against
 * (D144). This is the ONE direction that crossing between the two altitudes is
 * allowed to travel, and it is a projection, never a re-derivation: no field is
 * defaulted, substituted, or invented, and both nested schema hashes must be the
 * commit contract's own before either value is parsed.
 *
 * Checking the nesting is what lets a transaction checkpoint carry the durable
 * outcome's schema hash without losing the commit contract's identity: the
 * envelope hash proves the ROW round-trips, `output.schemaHash` proves the
 * commit contract that produced it has not moved, and `proof.schemaHash` proves
 * the same of its completion proof. A drift in any of the three fails loud here
 * rather than reaching an authored `derive`.
 */
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
  // A checked identity bridge, not an assertion: every field above was parsed by
  // the commit contract's OWN schemas, and only after both nested schema hashes
  // were proven to be that contract's. This narrows an object this function
  // assembled; it never re-types one it was handed.
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
  /**
   * Bound and parsed before the live probe or browser launch. It may read only
   * workflow input and declared upstream outputs — never the ephemeral prepare
   * output — so the durable key is stable before any page mutation.
   */
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

/** One vocabulary, one owner — see `./delegation-policy.js` (D102). */
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

/**
 * The durable validator for a child terminal outcome. Ref workflow-model §3.2 requires every
 * child outcome to be schema-parsed and stored BEFORE the dependency transition.
 */
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

interface ChildRunNodeBase<Target extends AnyWorkflowRef> extends GraphNodeBase {
  readonly kind: "child-run";
  readonly edgeId: DelegationEdgeId;
  readonly target: Target;
  readonly deriveChildItemId: (input: z.output<Target["input"]>) => ItemId;
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

/**
 * Runtime discriminant union. The builder retains the descriptor's exact node
 * tuple; this alias is only for exhaustive runtime switching and never feeds
 * type inference (ref workflow-model §1.1).
 */
export type RuntimeFlowNode =
  | TaskStepNode<RuntimeScope, AnyReadTaskContract>
  | TransactionNode<RuntimeScope, AnyPrepareTaskContract, AnyCommitTaskContract>
  | BranchNode<RuntimeScope, Readonly<Record<string, readonly NodeId[]>>>
  | ParallelNode
  | ChildRunNode<RuntimeScope, AnyWorkflowRef>
  | AnyGateNode;
