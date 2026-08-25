/**
 * The ONE workflow builder API (ref workflow-model §3; absorbs ref task-contract §5).
 *
 * The builder accumulates two exact generics as nodes are added:
 *
 * - `S` — a `Record<nodeId, NodeEntry>` map carrying each node's concrete
 *   output type, whether that output is conditional, and which task contracts
 *   the node owns. Every graph kind contributes an entry, not just tasks.
 * - `Nodes` — the exact node tuple, in declaration order.
 *
 * `bind`/`when`/`choose`/`derive` receive `Pick<S, D[number]>`, so reading an
 * output the node did not declare in `dependsOn` fails `tsc`. No `Append*` or
 * `*BuilderResult` transform may collapse to `any`, `unknown`, `RuntimeFlowNode`,
 * or a broad `Record<string, JsonValue>`; `tests/types/flow-graph.typecheck.ts`
 * pins that with negative controls at node 20+.
 */
import { z } from "zod";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
  AnyTaskContract,
} from "../domain/contracts/base.js";
import { NodeIdSchema } from "../domain/ids.js";
import type { DelegationEdgeId, ItemId, NodeId } from "../domain/ids.js";
import type { RetryPolicy } from "../domain/session.js";
import { parseNodeCondition } from "../domain/workflow/node-condition.js";
import type { NodeConditionSpec } from "../domain/workflow/node-condition.js";
import type {
  AnyWorkflowRef,
  BranchNode,
  ChildRunNode,
  ChildRunOutcome,
  ChildrenGateNode,
  DelegationManifestRef,
  DelegationPolicy,
  ExternalGateNode,
  ExternalGateSource,
  GraphNodeBase,
  OperatorGateNode,
  ParallelNode,
  TaskStepNode,
  TransactionNode,
  TypedTransactionOutcome,
  WorkflowGateSource,
} from "../domain/workflow/graph.js";

/* ── the accumulator ─────────────────────────────────────────────────────── */

/**
 * One typed output entry per graph node. `contracts` is `[]` for
 * branch/parallel/child/gate, `[C]` for a task, and `[P, C]` for a transaction,
 * so `.decorate` can only name a contract the node actually owns.
 *
 * `Out` is deliberately unconstrained. Ref workflow-model §3 originally wrote
 * `Out extends JsonValue` to keep Page/Date/class instances out of checkpoints,
 * but inside a generic method `z.output<C["output"]>` is still `unknown`, so the
 * constraint rejects every well-formed node before its contract resolves. The
 * canonical-JSON guarantee is enforced where it is actually checkable — every
 * task contract's `output` is a `CanonicalJsonSchema` audited recursively by
 * `assertContractBoundarySchema` — and every other node output is built by the
 * kernel from those outputs plus branded ids. `JsonValue` remains the runtime
 * view (`RuntimeScope`).
 */
export interface NodeEntry<
  Out,
  Cond extends boolean,
  Contracts extends readonly AnyTaskContract[],
> {
  readonly output: Out;
  readonly conditional: Cond;
  readonly contracts: Contracts;
}
export type AnyNodeEntry = NodeEntry<unknown, boolean, readonly AnyTaskContract[]>;

export type OutputsOf<S> = {
  readonly [K in keyof S]: S[K] extends NodeEntry<infer Out, infer Cond, readonly AnyTaskContract[]>
    ? Out | (Cond extends true ? undefined : never)
    : never;
};

export interface FlowScope<InputSchema extends z.ZodType, S> {
  readonly input: z.output<InputSchema>;
  readonly outputs: OutputsOf<S>;
}
export type TerminalWorkflowScope<InputSchema extends z.ZodType, S> = FlowScope<InputSchema, S>;

/** Scope visible to a node that declared exactly `D` as its dependencies. */
type ScopeFor<InputSchema extends z.ZodType, S, D extends readonly (keyof S & string)[]> =
  FlowScope<InputSchema, Pick<S, D[number]>>;

type HasWhen<O> = "when" extends keyof O ? true : false;

/** The contract ids a node actually owns — branch/gate entries own none. */
export type ContractIdsOf<Entry> =
  Entry extends NodeEntry<unknown, boolean, infer Contracts extends readonly AnyTaskContract[]>
    ? Contracts[number]["id"]
    : never;
export type ContractById<Entry, Id> =
  Entry extends NodeEntry<unknown, boolean, infer Contracts extends readonly AnyTaskContract[]>
    ? Extract<Contracts[number], { readonly id: Id }>
    : never;

/* ── per-kind options ────────────────────────────────────────────────────── */

export interface StepOpts<
  InputSchema extends z.ZodType,
  S,
  C extends AnyReadTaskContract,
  D extends readonly (keyof S & string)[],
> {
  /** Defaults to the contract's `title` (ref workflow-model §1.5). */
  readonly label?: string;
  readonly dependsOn: D;
  readonly bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<C["input"]>;
  /** D228 — a DECLARED condition; the closure form is gone on purpose. */
  readonly when?: NodeConditionSpec;
  /** REQUIRED — no default (ref workflow-model §5.3). */
  readonly replay: "checkpoint" | "always-rerun";
}

export interface TransactionOpts<
  InputSchema extends z.ZodType,
  S,
  P extends AnyPrepareTaskContract,
  C extends AnyCommitTaskContract,
  D extends readonly (keyof S & string)[],
> {
  readonly label?: string;
  readonly dependsOn: D;
  readonly prepare: Readonly<{ uses: P; bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<P["input"]> }>;
  /** Never sees prepare output — the durable key is stable before page mutation. */
  readonly commit: Readonly<{ uses: C; bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<C["input"]> }>;
  readonly dryRun: "stop-after-prepare" | "unsupported";
  readonly probePolicy: "always" | "retries-and-recovery-only";
  readonly probeToFenceMaxMs: number;
  readonly retryBeforeFence?: RetryPolicy;
}

/**
 * A branch case names the nodes that arm RUNS, which are declared after the
 * branch — so the targets cannot be constrained to `keyof S`, whose keys are by
 * definition the nodes already accumulated. Forward references are checked at
 * `build()` instead: every target must be a declared node, and it must sit
 * downstream of its controller.
 */
export type BranchCases = Readonly<Record<string, readonly string[]>>;
export interface BranchOpts<
  InputSchema extends z.ZodType,
  S,
  Cases extends BranchCases,
  D extends readonly (keyof S & string)[],
> {
  readonly label?: string;
  readonly dependsOn: D;
  readonly choose: (scope: ScopeFor<InputSchema, S, D>) => keyof Cases & string;
  readonly cases: Cases;
}

/** Same forward-reference rule as `BranchCases`: members run after the fork. */
export type ParallelBranches = readonly Readonly<{
  id: string;
  nodes: readonly string[];
}>[];

export type ChildRunOpts<
  InputSchema extends z.ZodType,
  S,
  Target extends AnyWorkflowRef,
  D extends readonly (keyof S & string)[],
> =
  | Readonly<{
    label?: string;
    dependsOn: D;
    edgeId: DelegationEdgeId;
    cardinality: "one";
    bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<Target["input"]>;
    deriveChildItemId: (input: z.output<Target["input"]>) => ItemId;
    await: "terminal";
    join: "one";
    policy: DelegationPolicy;
  }>
  | Readonly<{
    label?: string;
    dependsOn: D;
    edgeId: DelegationEdgeId;
    cardinality: "many";
    bind: (scope: ScopeFor<InputSchema, S, D>) => readonly z.input<Target["input"]>[];
    deriveChildItemId: (input: z.output<Target["input"]>) => ItemId;
    await: "terminal";
    join: "all" | "all-settled";
    policy: DelegationPolicy;
  }>
  | Readonly<{
    label?: string;
    dependsOn: D;
    edgeId: DelegationEdgeId;
    cardinality: "one" | "many";
    bind: (scope: ScopeFor<InputSchema, S, D>) =>
      z.input<Target["input"]> | readonly z.input<Target["input"]>[];
    deriveChildItemId: (input: z.output<Target["input"]>) => ItemId;
    await: "none";
    join: "none";
    policy: DelegationPolicy;
  }>;

export type GateDecl<S, D extends readonly (keyof S & string)[]> =
  | Readonly<{
    dependsOn: D;
    label: string;
    statusKey?: string;
    resolvedBy: "operator";
    result: z.ZodType;
    /** An operator gate is resolved by a command, so it has no event source. */
    subscribes?: never;
    resolve?: never;
  }>
  | Readonly<{
    dependsOn: D;
    label: string;
    statusKey?: string;
    resolvedBy: "children-terminal";
    subscribes: WorkflowGateSource<AnyWorkflowRef, z.ZodType>;
    result: z.ZodType;
    resolve: (event: never) => unknown;
  }>
  | Readonly<{
    dependsOn: D;
    label: string;
    statusKey?: string;
    resolvedBy: "external";
    subscribes: ExternalGateSource<z.ZodType>;
    result: z.ZodType;
    resolve: (event: never) => unknown;
  }>;

/* ── output transforms ───────────────────────────────────────────────────── */

export type ChildRunOutput<
  Target extends AnyWorkflowRef,
  O extends { readonly await: "none" | "terminal"; readonly cardinality: "one" | "many" },
> = O["await"] extends "none"
  ? DelegationManifestRef
  : O["cardinality"] extends "one"
    ? ChildRunOutcome<Target>
    : readonly ChildRunOutcome<Target>[];

/** A branch's own output names the case it selected — downstream code branches on it. */
export type BranchOutput<Cases extends Readonly<Record<string, readonly string[]>>> =
  Readonly<{ selected: keyof Cases & string }>;

/** A `parallel` join exposes each branch id mapped to the ids it ran. */
export type ParallelOutput<B extends ParallelBranches> =
  Readonly<{
    join: "all" | "all-settled";
    branches: Readonly<{ [K in B[number]["id"]]: readonly string[] }>;
  }>;

export type GateOutput<Decl extends { readonly result: z.ZodType }> = z.output<Decl["result"]>;

/* ── node-tuple transforms ───────────────────────────────────────────────── */

export type AppendTaskNode<
  Nodes extends readonly GraphNodeBase[],
  InputSchema extends z.ZodType,
  S,
  C extends AnyReadTaskContract,
  D extends readonly (keyof S & string)[],
> = readonly [...Nodes, TaskStepNode<ScopeFor<InputSchema, S, D>, C>];

export type AppendTransactionNode<
  Nodes extends readonly GraphNodeBase[],
  InputSchema extends z.ZodType,
  S,
  P extends AnyPrepareTaskContract,
  C extends AnyCommitTaskContract,
  D extends readonly (keyof S & string)[],
> = readonly [...Nodes, TransactionNode<ScopeFor<InputSchema, S, D>, P, C>];

export type AppendBranchNode<
  Nodes extends readonly GraphNodeBase[],
  InputSchema extends z.ZodType,
  S,
  Cases extends BranchCases,
  D extends readonly (keyof S & string)[],
> = readonly [
  ...Nodes,
  BranchNode<ScopeFor<InputSchema, S, D>, { readonly [K in keyof Cases]: readonly NodeId[] }>,
];

export type AppendParallelNode<Nodes extends readonly GraphNodeBase[]> =
  readonly [...Nodes, ParallelNode];

export type AppendChildRunNode<
  Nodes extends readonly GraphNodeBase[],
  InputSchema extends z.ZodType,
  S,
  Target extends AnyWorkflowRef,
  D extends readonly (keyof S & string)[],
> = readonly [...Nodes, ChildRunNode<ScopeFor<InputSchema, S, D>, Target>];

export type AppendGateNode<
  Nodes extends readonly GraphNodeBase[],
  Decl extends { readonly resolvedBy: string; readonly result: z.ZodType },
> = readonly [
  ...Nodes,
  Decl["resolvedBy"] extends "operator"
    ? OperatorGateNode<Decl["result"]>
    : Decl["resolvedBy"] extends "children-terminal"
      ? ChildrenGateNode<WorkflowGateSource<AnyWorkflowRef, z.ZodType>, Decl["result"]>
      : ExternalGateNode<ExternalGateSource<z.ZodType>, Decl["result"]>,
];

/* ── the terminal result ─────────────────────────────────────────────────── */

export interface WorkflowResultSpec<
  ResultSchema extends z.ZodType,
  InputSchema extends z.ZodType,
  S,
  D extends readonly (keyof S & string)[],
> {
  /** Strict, canonical-JSON terminal schema. */
  readonly schema: ResultSchema;
  /** Exact terminal dependencies `derive` is allowed to read. */
  readonly dependsOn: D;
  readonly derive: (scope: TerminalWorkflowScope<InputSchema, Pick<S, D[number]>>) =>
    z.input<ResultSchema>;
}

/* ── decoration ──────────────────────────────────────────────────────────── */

export interface TaskHooks<C extends AnyTaskContract> {
  readonly before?: (input: z.output<C["input"]>) => void;
  readonly after?: (output: z.output<C["output"]>) => void;
  readonly onError?: (error: unknown) => void;
}

/* ── the builder ─────────────────────────────────────────────────────────── */

export interface FlowBuilder<
  InputSchema extends z.ZodType,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  Nodes extends readonly GraphNodeBase[],
> {
  step<
    Id extends string,
    C extends AnyReadTaskContract,
    const D extends readonly (keyof S & string)[],
    O extends StepOpts<InputSchema, S, C, D>,
  >(
    id: Id,
    contract: C,
    opts: O,
  ): FlowBuilder<
    InputSchema,
    S & { readonly [K in Id]: NodeEntry<z.output<C["output"]>, HasWhen<O>, readonly [C]> },
    AppendTaskNode<Nodes, InputSchema, S, C, D>
  >;

  transaction<
    Id extends string,
    P extends AnyPrepareTaskContract,
    C extends AnyCommitTaskContract,
    const D extends readonly (keyof S & string)[],
  >(
    id: Id,
    pair: TransactionOpts<InputSchema, S, P, C, D>,
  ): FlowBuilder<
    InputSchema,
    S & { readonly [K in Id]: NodeEntry<TypedTransactionOutcome<C>, false, readonly [P, C]> },
    AppendTransactionNode<Nodes, InputSchema, S, P, C, D>
  >;

  branch<
    Id extends string,
    const Cases extends BranchCases,
    const D extends readonly (keyof S & string)[],
  >(
    id: Id,
    opts: BranchOpts<InputSchema, S, Cases, D>,
  ): FlowBuilder<
    InputSchema,
    S & { readonly [K in Id]: NodeEntry<BranchOutput<Cases>, false, readonly []> },
    AppendBranchNode<Nodes, InputSchema, S, Cases, D>
  >;

  parallel<Id extends string, const B extends ParallelBranches>(
    id: Id,
    branches: B,
    opts: Readonly<{ join: "all" | "all-settled" }>,
  ): FlowBuilder<
    InputSchema,
    S & { readonly [K in Id]: NodeEntry<ParallelOutput<B>, false, readonly []> },
    AppendParallelNode<Nodes>
  >;

  childRun<
    Id extends string,
    T extends AnyWorkflowRef,
    const D extends readonly (keyof S & string)[],
    O extends ChildRunOpts<InputSchema, S, T, D>,
  >(
    id: Id,
    target: T,
    opts: O,
  ): FlowBuilder<
    InputSchema,
    S & { readonly [K in Id]: NodeEntry<ChildRunOutput<T, O>, false, readonly []> },
    AppendChildRunNode<Nodes, InputSchema, S, T, D>
  >;

  gate<
    Id extends string,
    const D extends readonly (keyof S & string)[],
    const Decl extends GateDecl<S, D>,
  >(
    id: Id,
    decl: Decl,
  ): FlowBuilder<
    InputSchema,
    S & { readonly [K in Id]: NodeEntry<GateOutput<Decl>, false, readonly []> },
    AppendGateNode<Nodes, Decl>
  >;

  /** Decoration names one actual child contract; branch/gate ids own none. */
  decorate<Id extends keyof S & string, ContractId extends ContractIdsOf<S[Id]>>(
    id: Id,
    contractId: ContractId,
    hooks: TaskHooks<ContractById<S[Id], ContractId>>,
    label: string,
  ): FlowBuilder<InputSchema, S, Nodes>;

  /** Instrumentation on EVERY step of this workflow. */
  instrument(hooks: TaskHooks<AnyTaskContract>, label: string): FlowBuilder<InputSchema, S, Nodes>;

  /**
   * Apply a FRAGMENT — a function from this builder to a builder with more
   * nodes — without leaving the chain (D265 §1.2.2 rule 2). A step folder's
   * node fragments are `defineTaskNode`/`defineTransactionNode`/
   * `defineGateNode` values whose `.wire(...)` returns exactly such a function;
   * `S2`/`Nodes2` are whatever the fragment accumulated, so nothing is erased.
   */
  pipe<S2 extends Readonly<Record<string, AnyNodeEntry>>, Nodes2 extends readonly GraphNodeBase[]>(
    fragment: (builder: FlowBuilder<InputSchema, S, Nodes>) => FlowBuilder<InputSchema, S2, Nodes2>,
  ): FlowBuilder<InputSchema, S2, Nodes2>;

  build<ResultSchema extends z.ZodType, const D extends readonly (keyof S & string)[]>(
    result: WorkflowResultSpec<ResultSchema, InputSchema, S, D>,
  ): BuiltFlow<InputSchema, ResultSchema, Nodes, S, D>;
}

/**
 * What `build()` returns: the exact node tuple plus the accumulated `S`/`D`
 * generics the descriptor factory needs. The full `WorkflowDescriptor` (ref workflow-model
 * §1.1) wraps this with the doc-03-owned presentation/enqueue/action fields.
 */
export interface BuiltFlow<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Nodes extends readonly GraphNodeBase[],
  S extends Readonly<Record<string, AnyNodeEntry>>,
  D extends readonly (keyof S & string)[],
> {
  readonly input: InputSchema;
  readonly nodes: Nodes;
  readonly result: WorkflowResultSpec<ResultSchema, InputSchema, S, D>;
  readonly decorations: readonly FlowDecoration[];
  readonly instrumentation: readonly FlowInstrumentation[];
}

export interface FlowDecoration {
  readonly nodeId: NodeId;
  readonly contractId: AnyTaskContract["id"];
  readonly hooks: TaskHooks<AnyTaskContract>;
  readonly label: string;
}
export interface FlowInstrumentation {
  readonly hooks: TaskHooks<AnyTaskContract>;
  readonly label: string;
}

/* ── runtime ─────────────────────────────────────────────────────────────── */

type MutableFlowState = {
  readonly input: z.ZodType;
  readonly nodes: GraphNodeBase[];
  readonly decorations: FlowDecoration[];
  readonly instrumentation: FlowInstrumentation[];
};

function nodeId(id: string): NodeId {
  return NodeIdSchema.parse(id);
}

function nodeIds(ids: readonly string[]): readonly NodeId[] {
  return Object.freeze(ids.map(nodeId));
}

function assertUniqueNodeId(state: MutableFlowState, id: NodeId): void {
  if (state.nodes.some((node) => node.id === id)) {
    throw new Error(`workflow graph declares node ${id} more than once`);
  }
}

function assertDeclaredDependencies(state: MutableFlowState, id: NodeId, dependsOn: readonly NodeId[]): void {
  const known = new Set(state.nodes.map((node) => node.id));
  for (const dependency of dependsOn) {
    if (!known.has(dependency)) {
      throw new Error(`workflow node ${id} depends on ${dependency}, which is not a declared upstream node`);
    }
  }
  if (new Set(dependsOn).size !== dependsOn.length) {
    throw new Error(`workflow node ${id} repeats a dependency`);
  }
}

/**
 * Branch cases and parallel branches name the nodes their path RUNS, so every
 * target must be declared and must sit downstream of its controller. Only
 * `build()` can check this: at push time the targets do not exist yet, and a
 * case pointing backwards would make the graph cyclic.
 */
function assertControlFlowTargets(nodes: readonly GraphNodeBase[]): void {
  const position = new Map(nodes.map((node, index) => [String(node.id), index]));
  const assertDownstream = (owner: string, index: number, target: string): void => {
    const targetIndex = position.get(target);
    if (targetIndex === undefined) throw new Error(`${owner} targets undeclared node ${target}`);
    if (targetIndex <= index) throw new Error(`${owner} targets ${target}, which is not downstream of it`);
  };
  for (const [index, node] of nodes.entries()) {
    if (node.kind === "branch") {
      const branch = node as unknown as BranchNode<never, Readonly<Record<string, readonly NodeId[]>>>;
      for (const [caseName, targets] of Object.entries(branch.cases)) {
        if (targets.length === 0) throw new Error(`branch ${node.id} case "${caseName}" joins no node`);
        for (const target of targets) {
          assertDownstream(`branch ${node.id} case "${caseName}"`, index, String(target));
        }
      }
    }
    if (node.kind === "parallel") {
      const parallel = node as unknown as ParallelNode;
      for (const branch of parallel.branches) {
        if (branch.nodes.length === 0) {
          throw new Error(`parallel ${node.id} branch "${branch.id}" runs no node`);
        }
        for (const member of branch.nodes) {
          assertDownstream(`parallel ${node.id} branch "${branch.id}"`, index, String(member));
        }
      }
    }
  }
}

/**
 * Builder implementation. Every method mutates one shared state object and
 * returns a re-typed view of the same builder — the accumulation that matters
 * is in the type parameters, and a fluent chain has exactly one owner.
 */
function makeBuilder(state: MutableFlowState): unknown {
  const push = (node: GraphNodeBase): void => {
    assertUniqueNodeId(state, node.id);
    assertDeclaredDependencies(state, node.id, node.dependsOn);
    state.nodes.push(Object.freeze(node));
  };
  const builder = {
    step(id: string, contract: AnyReadTaskContract, opts: {
      label?: string;
      dependsOn: readonly string[];
      bind: (scope: never) => unknown;
      when?: NodeConditionSpec;
      replay: "checkpoint" | "always-rerun";
    }): unknown {
      push({
        kind: "task",
        id: nodeId(id),
        dependsOn: nodeIds(opts.dependsOn),
        ...(opts.label === undefined ? {} : { label: opts.label }),
        uses: contract,
        bind: opts.bind,
        ...(opts.when === undefined ? {} : { when: parseNodeCondition(opts.when) }),
        replay: opts.replay,
      } as GraphNodeBase);
      return builder;
    },
    transaction(id: string, pair: {
      label?: string;
      dependsOn: readonly string[];
      prepare: { uses: AnyPrepareTaskContract; bind: (scope: never) => unknown };
      commit: { uses: AnyCommitTaskContract; bind: (scope: never) => unknown };
      dryRun: "stop-after-prepare" | "unsupported";
      probePolicy: "always" | "retries-and-recovery-only";
      probeToFenceMaxMs: number;
      retryBeforeFence?: RetryPolicy;
    }): unknown {
      if (!Number.isInteger(pair.probeToFenceMaxMs) || pair.probeToFenceMaxMs <= 0) {
        throw new Error(`transaction ${id} requires a positive integer probeToFenceMaxMs budget`);
      }
      push({
        kind: "transaction",
        id: nodeId(id),
        dependsOn: nodeIds(pair.dependsOn),
        ...(pair.label === undefined ? {} : { label: pair.label }),
        prepare: Object.freeze({ uses: pair.prepare.uses, bind: pair.prepare.bind }),
        commit: Object.freeze({ uses: pair.commit.uses, bind: pair.commit.bind }),
        leaseScope: "transaction",
        dryRun: pair.dryRun,
        probePolicy: pair.probePolicy,
        probeToFenceMaxMs: pair.probeToFenceMaxMs,
        ...(pair.retryBeforeFence === undefined ? {} : { retryBeforeFence: pair.retryBeforeFence }),
      } as GraphNodeBase);
      return builder;
    },
    branch(id: string, opts: {
      label?: string;
      dependsOn: readonly string[];
      choose: (scope: never) => string;
      cases: Readonly<Record<string, readonly string[]>>;
    }): unknown {
      const cases = Object.entries(opts.cases);
      if (cases.length < 2) throw new Error(`branch ${id} requires at least two cases`);
      push({
        kind: "branch",
        id: nodeId(id),
        dependsOn: nodeIds(opts.dependsOn),
        ...(opts.label === undefined ? {} : { label: opts.label }),
        choose: opts.choose,
        cases: Object.freeze(Object.fromEntries(
          cases.map(([name, targets]) => [name, nodeIds(targets)]),
        )),
      } as GraphNodeBase);
      return builder;
    },
    parallel(
      id: string,
      branches: readonly { id: string; nodes: readonly string[] }[],
      opts: { join: "all" | "all-settled" },
    ): unknown {
      const branchIds = branches.map((branch) => branch.id);
      if (new Set(branchIds).size !== branchIds.length) {
        throw new Error(`parallel ${id} repeats a branch id`);
      }
      if (branches.length < 2) throw new Error(`parallel ${id} requires at least two branches`);
      push({
        kind: "parallel",
        id: nodeId(id),
        dependsOn: nodeIds([]),
        branches: Object.freeze(branches.map((branch) =>
          Object.freeze({ id: branch.id, nodes: nodeIds(branch.nodes) }))),
        join: opts.join,
      } as GraphNodeBase);
      return builder;
    },
    childRun(id: string, target: AnyWorkflowRef, opts: {
      label?: string;
      dependsOn: readonly string[];
      edgeId: DelegationEdgeId;
      cardinality: "one" | "many";
      bind: (scope: never) => unknown;
      deriveChildItemId: (input: never) => ItemId;
      await: "none" | "terminal";
      join: "one" | "all" | "all-settled" | "none";
      policy: DelegationPolicy;
    }): unknown {
      push({
        kind: "child-run",
        id: nodeId(id),
        dependsOn: nodeIds(opts.dependsOn),
        ...(opts.label === undefined ? {} : { label: opts.label }),
        edgeId: opts.edgeId,
        target,
        cardinality: opts.cardinality,
        bind: opts.bind,
        deriveChildItemId: opts.deriveChildItemId,
        await: opts.await,
        join: opts.join,
        policy: opts.policy,
      } as GraphNodeBase);
      return builder;
    },
    gate(id: string, decl: {
      dependsOn: readonly string[];
      label: string;
      statusKey?: string;
      resolvedBy: "operator" | "children-terminal" | "external";
      subscribes?: unknown;
      result: z.ZodType;
      resolve?: (event: never) => unknown;
    }): unknown {
      if (decl.resolvedBy !== "operator" && decl.subscribes === undefined) {
        throw new Error(`gate ${id} resolved by ${decl.resolvedBy} requires a subscribes source`);
      }
      if (decl.resolvedBy === "operator" && decl.subscribes !== undefined) {
        throw new Error(`gate ${id} resolved by the operator cannot subscribe to a source`);
      }
      push({
        kind: "gate",
        id: nodeId(id),
        dependsOn: nodeIds(decl.dependsOn),
        label: decl.label,
        ...(decl.statusKey === undefined ? {} : { statusKey: decl.statusKey }),
        resolvedBy: decl.resolvedBy,
        ...(decl.subscribes === undefined ? {} : { subscribes: decl.subscribes }),
        result: decl.result,
        ...(decl.resolve === undefined ? {} : { resolve: decl.resolve }),
      } as GraphNodeBase);
      return builder;
    },
    decorate(
      id: string,
      contractId: AnyTaskContract["id"],
      hooks: TaskHooks<AnyTaskContract>,
      label: string,
    ): unknown {
      const target = nodeId(id);
      if (!state.nodes.some((node) => node.id === target)) {
        throw new Error(`cannot decorate ${target}: no such node is declared`);
      }
      state.decorations.push(Object.freeze({ nodeId: target, contractId, hooks, label }));
      return builder;
    },
    instrument(hooks: TaskHooks<AnyTaskContract>, label: string): unknown {
      state.instrumentation.push(Object.freeze({ hooks, label }));
      return builder;
    },
    pipe(fragment: (builder: unknown) => unknown): unknown {
      const piped = fragment(builder);
      if (piped !== builder) {
        throw new Error("a flow fragment must return the builder it was given, with its nodes appended");
      }
      return piped;
    },
    build(result: { dependsOn: readonly string[] }): unknown {
      assertDeclaredDependencies(state, nodeId("workflow-result"), nodeIds(result.dependsOn));
      if (state.nodes.length === 0) throw new Error("a workflow graph requires at least one node");
      assertControlFlowTargets(state.nodes);
      return Object.freeze({
        input: state.input,
        nodes: Object.freeze([...state.nodes]),
        result,
        decorations: Object.freeze([...state.decorations]),
        instrumentation: Object.freeze([...state.instrumentation]),
      });
    },
  };
  return builder;
}

/** Start a workflow graph over its workflow-constant input schema. */
export function flow<InputSchema extends z.ZodType>(
  input: InputSchema,
): FlowBuilder<InputSchema, Record<never, never>, readonly []> {
  return makeBuilder({
    input,
    nodes: [],
    decorations: [],
    instrumentation: [],
  }) as FlowBuilder<InputSchema, Record<never, never>, readonly []>;
}

/* ── node fragments (D265 §1.2.2 rule 2) ─────────────────────────────────── */

/**
 * A node's IDENTITY and a node's WIRING are two different facts with two
 * different owners. The identity — its id, the contract(s) it runs, its label,
 * its replay policy or, for a transaction, its whole write policy — belongs to
 * the step folder that owns the node, declared ONCE. The wiring — where the
 * node sits in a particular graph (`dependsOn`) and what feeds each input
 * (`bind`) — belongs to the graph that applies it, because the composition and
 * the harness that proves a step feed the same node from different upstreams.
 *
 * A fragment therefore carries the identity and takes the wiring:
 *
 * ```ts
 * export const NAME_SEARCH = defineTaskNode("name-search", SearchPersonOrg, { label, replay: "checkpoint" });
 * // the composition:            the harness:
 * flow(In).pipe(NAME_SEARCH.wire({ dependsOn: [PLAN], bind: ... }))   .pipe(NAME_SEARCH.wire({ dependsOn: [], bind: ... }))
 * ```
 *
 * The builder's generics flow through unchanged: `wire` is generic over the
 * builder's `S`/`Nodes` at the point of application, so `bind` sees exactly the
 * `Pick<S, D[number]>` scope a hand-written `.step` would, and `pipe` returns
 * the accumulated `S`/`Nodes` rather than erasing them. No `when` — a declared
 * condition is a fact about the graph, not about the node, and none of the
 * fragments this seam exists for declares one.
 */
export interface TaskNodeWiring<
  InputSchema extends z.ZodType,
  S,
  C extends AnyReadTaskContract,
  D extends readonly (keyof S & string)[],
> {
  readonly dependsOn: D;
  readonly bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<C["input"]>;
}

export interface TransactionNodeWiring<
  InputSchema extends z.ZodType,
  S,
  P extends AnyPrepareTaskContract,
  C extends AnyCommitTaskContract,
  D extends readonly (keyof S & string)[],
> {
  readonly dependsOn: D;
  readonly prepare: Readonly<{ bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<P["input"]> }>;
  /** Never sees prepare output — the durable key is stable before page mutation. */
  readonly commit: Readonly<{ bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<C["input"]> }>;
}

export interface GateNodeWiring<S, D extends readonly (keyof S & string)[]> {
  readonly dependsOn: D;
}

/** A fragment is a function from a builder to the same builder with nodes appended. */
export type FlowFragment<
  InputSchema extends z.ZodType,
  S extends Readonly<Record<string, AnyNodeEntry>>,
  Nodes extends readonly GraphNodeBase[],
  S2 extends Readonly<Record<string, AnyNodeEntry>>,
  Nodes2 extends readonly GraphNodeBase[],
> = (builder: FlowBuilder<InputSchema, S, Nodes>) => FlowBuilder<InputSchema, S2, Nodes2>;

export interface TaskNodeFragment<Id extends string, C extends AnyReadTaskContract> {
  readonly kind: "task";
  readonly id: Id;
  readonly contract: C;
  readonly label: string;
  readonly replay: "checkpoint" | "always-rerun";
  wire<
    InputSchema extends z.ZodType,
    S extends Readonly<Record<string, AnyNodeEntry>>,
    Nodes extends readonly GraphNodeBase[],
    const D extends readonly (keyof S & string)[],
  >(
    wiring: TaskNodeWiring<InputSchema, S, C, D>,
  ): FlowFragment<
    InputSchema,
    S,
    Nodes,
    S & { readonly [K in Id]: NodeEntry<z.output<C["output"]>, false, readonly [C]> },
    AppendTaskNode<Nodes, InputSchema, S, C, D>
  >;
}

export interface TransactionNodeFragment<
  Id extends string,
  P extends AnyPrepareTaskContract,
  C extends AnyCommitTaskContract,
> {
  readonly kind: "transaction";
  readonly id: Id;
  readonly prepare: P;
  readonly commit: C;
  readonly label: string;
  readonly dryRun: "stop-after-prepare" | "unsupported";
  readonly probePolicy: "always" | "retries-and-recovery-only";
  readonly probeToFenceMaxMs: number;
  readonly retryBeforeFence?: RetryPolicy;
  wire<
    InputSchema extends z.ZodType,
    S extends Readonly<Record<string, AnyNodeEntry>>,
    Nodes extends readonly GraphNodeBase[],
    const D extends readonly (keyof S & string)[],
  >(
    wiring: TransactionNodeWiring<InputSchema, S, P, C, D>,
  ): FlowFragment<
    InputSchema,
    S,
    Nodes,
    S & { readonly [K in Id]: NodeEntry<TypedTransactionOutcome<C>, false, readonly [P, C]> },
    AppendTransactionNode<Nodes, InputSchema, S, P, C, D>
  >;
}

/** Only the operator-resolved gate has a fragment form: the ALWAYS-GATE is the one a step folder owns. */
export interface OperatorGateNodeFragment<Id extends string, Result extends z.ZodType> {
  readonly kind: "gate";
  readonly id: Id;
  readonly label: string;
  readonly statusKey?: string;
  readonly resolvedBy: "operator";
  readonly result: Result;
  wire<
    InputSchema extends z.ZodType,
    S extends Readonly<Record<string, AnyNodeEntry>>,
    Nodes extends readonly GraphNodeBase[],
    const D extends readonly (keyof S & string)[],
  >(
    wiring: GateNodeWiring<S, D>,
  ): FlowFragment<
    InputSchema,
    S,
    Nodes,
    S & { readonly [K in Id]: NodeEntry<z.output<Result>, false, readonly []> },
    readonly [...Nodes, OperatorGateNode<Result>]
  >;
}

export type AnyNodeFragment =
  | TaskNodeFragment<string, AnyReadTaskContract>
  | TransactionNodeFragment<string, AnyPrepareTaskContract, AnyCommitTaskContract>
  | OperatorGateNodeFragment<string, z.ZodType>;

export function defineTaskNode<Id extends string, C extends AnyReadTaskContract>(
  id: Id,
  contract: C,
  identity: Readonly<{ label: string; replay: "checkpoint" | "always-rerun" }>,
): TaskNodeFragment<Id, C> {
  nodeId(id);
  const fragment: TaskNodeFragment<Id, C> = {
    kind: "task",
    id,
    contract,
    label: identity.label,
    replay: identity.replay,
    wire(wiring) {
      return (builder) => builder.step(id, contract, {
        label: identity.label,
        dependsOn: wiring.dependsOn,
        bind: wiring.bind,
        replay: identity.replay,
      });
    },
  };
  return Object.freeze(fragment);
}

export function defineTransactionNode<
  Id extends string,
  P extends AnyPrepareTaskContract,
  C extends AnyCommitTaskContract,
>(
  id: Id,
  identity: Readonly<{
    label: string;
    prepare: P;
    commit: C;
    dryRun: "stop-after-prepare" | "unsupported";
    probePolicy: "always" | "retries-and-recovery-only";
    probeToFenceMaxMs: number;
    retryBeforeFence?: RetryPolicy;
  }>,
): TransactionNodeFragment<Id, P, C> {
  nodeId(id);
  if (!Number.isInteger(identity.probeToFenceMaxMs) || identity.probeToFenceMaxMs <= 0) {
    throw new Error(`transaction ${id} requires a positive integer probeToFenceMaxMs budget`);
  }
  const fragment: TransactionNodeFragment<Id, P, C> = {
    kind: "transaction",
    id,
    prepare: identity.prepare,
    commit: identity.commit,
    label: identity.label,
    dryRun: identity.dryRun,
    probePolicy: identity.probePolicy,
    probeToFenceMaxMs: identity.probeToFenceMaxMs,
    ...(identity.retryBeforeFence === undefined ? {} : { retryBeforeFence: identity.retryBeforeFence }),
    wire(wiring) {
      return (builder) => builder.transaction(id, {
        label: identity.label,
        dependsOn: wiring.dependsOn,
        prepare: { uses: identity.prepare, bind: wiring.prepare.bind },
        commit: { uses: identity.commit, bind: wiring.commit.bind },
        dryRun: identity.dryRun,
        probePolicy: identity.probePolicy,
        probeToFenceMaxMs: identity.probeToFenceMaxMs,
        ...(identity.retryBeforeFence === undefined ? {} : { retryBeforeFence: identity.retryBeforeFence }),
      });
    },
  };
  return Object.freeze(fragment);
}

export function defineOperatorGateNode<Id extends string, Result extends z.ZodType>(
  id: Id,
  identity: Readonly<{ label: string; statusKey?: string; result: Result }>,
): OperatorGateNodeFragment<Id, Result> {
  nodeId(id);
  const fragment: OperatorGateNodeFragment<Id, Result> = {
    kind: "gate",
    id,
    label: identity.label,
    ...(identity.statusKey === undefined ? {} : { statusKey: identity.statusKey }),
    resolvedBy: "operator",
    result: identity.result,
    wire(wiring) {
      return (builder) => builder.gate(id, {
        label: identity.label,
        ...(identity.statusKey === undefined ? {} : { statusKey: identity.statusKey }),
        dependsOn: wiring.dependsOn,
        resolvedBy: "operator",
        result: identity.result,
      });
    },
  };
  return Object.freeze(fragment);
}
