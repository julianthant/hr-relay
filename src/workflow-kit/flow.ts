import type { DryRunBinding, DryRunScope } from "../models/workflow/dry-run.js";
import type { ProtectedInputBinding } from "../models/write-safety/protected-input.js";
/** The ONE workflow builder API (ref workflow-model ): it accumulates `S` (per-node output/conditional/contracts) and `Nodes`, so reading an undeclared output fails `tsc`. */
import { z } from "zod";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
  AnyTaskContract,
} from "../models/task/task-contract.js";
import { NodeIdSchema } from "../rules/identity/ids.js";
import type { DelegationEdgeId, ItemId, NodeId } from "../rules/identity/ids.js";
import type { RetryPolicy } from "../models/sessions/session.js";
import { parseNodeCondition } from "../models/workflow/node-condition.js";
import type { NodeConditionSpec } from "../models/workflow/node-condition.js";
import type {
  AnyWorkflowRef,
  ChildRunIdentityContext,
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
} from "../models/workflow/graph.js";

/* ── the accumulator ─────────────────────────────────────────────────────── */

/** One typed output entry per graph node: `contracts` is `[]`/`[C]`/`[P,C]` by kind, so `decorate` names only an owned contract; `Out` is unconstrained because canonical-JSON is enforced at the contract boundary. */
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
  readonly dryRun?: DryRunScope;
  readonly input: z.output<InputSchema>;
  readonly protectedInputBindings?: readonly ProtectedInputBinding[];
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
  /** Defaults to the contract's `title` (ref workflow-model ). */
  readonly label?: string;
  readonly dependsOn: D;
  readonly bind: (scope: ScopeFor<InputSchema, S, D>) => z.input<C["input"]>;
  /** A DECLARED node condition (schema form), never a closure. */
  readonly when?: NodeConditionSpec;
  /** REQUIRED — no default (ref workflow-model ). */
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
  readonly previewBind?: (scope: ScopeFor<InputSchema, S, D>) => DryRunBinding | undefined;
  readonly probePolicy: "always" | "retries-and-recovery-only";
  readonly probeToFenceMaxMs: number;
  readonly retryBeforeFence?: RetryPolicy;
}

// Forward targets are checked at build; push cannot see undeclared nodes.
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
    deriveChildItemId: (input: z.output<Target["input"]>, context: ChildRunIdentityContext) => ItemId;
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
    deriveChildItemId: (input: z.output<Target["input"]>, context: ChildRunIdentityContext) => ItemId;
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
    deriveChildItemId: (input: z.output<Target["input"]>, context: ChildRunIdentityContext) => ItemId;
    await: "none";
    join: "none";
    policy: DelegationPolicy;
  }>;

type GateDecl<S, D extends readonly (keyof S & string)[]> =
  | Readonly<{
    dependsOn: D;
    label: string;
    statusKey?: string;
    resolvedBy: "operator";
    when?: NodeConditionSpec;
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
type BranchOutput<Cases extends Readonly<Record<string, readonly string[]>>> =
  Readonly<{ selected: keyof Cases & string }>;

/** A `parallel` join exposes each branch id mapped to the ids it ran. */
type ParallelOutput<B extends ParallelBranches> =
  Readonly<{
    join: "all" | "all-settled";
    branches: Readonly<{ [K in B[number]["id"]]: readonly string[] }>;
  }>;

type GateOutput<Decl extends { readonly result: z.ZodType }> = z.output<Decl["result"]>;

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

type AppendBranchNode<
  Nodes extends readonly GraphNodeBase[],
  InputSchema extends z.ZodType,
  S,
  Cases extends BranchCases,
  D extends readonly (keyof S & string)[],
> = readonly [
  ...Nodes,
  BranchNode<ScopeFor<InputSchema, S, D>, { readonly [K in keyof Cases]: readonly NodeId[] }>,
];

type AppendParallelNode<Nodes extends readonly GraphNodeBase[]> =
  readonly [...Nodes, ParallelNode];

export type AppendChildRunNode<
  Nodes extends readonly GraphNodeBase[],
  InputSchema extends z.ZodType,
  S,
  Target extends AnyWorkflowRef,
  D extends readonly (keyof S & string)[],
> = readonly [...Nodes, ChildRunNode<ScopeFor<InputSchema, S, D>, Target>];

type AppendGateNode<
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
    S & { readonly [K in Id]: NodeEntry<GateOutput<Decl>, HasWhen<Decl>, readonly []> },
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

  build<ResultSchema extends z.ZodType, const D extends readonly (keyof S & string)[]>(
    result: WorkflowResultSpec<ResultSchema, InputSchema, S, D>,
  ): BuiltFlow<InputSchema, ResultSchema, Nodes, S, D>;
}

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

interface FlowDecoration {
  readonly nodeId: NodeId;
  readonly contractId: AnyTaskContract["id"];
  readonly hooks: TaskHooks<AnyTaskContract>;
  readonly label: string;
}
interface FlowInstrumentation {
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

// Require downstream targets to prevent graph cycles.
function assertControlFlowTargets(nodes: readonly GraphNodeBase[]): void {
  const position = new Map(nodes.map((node, index) => [String(node.id), index]));
  const assertDownstream = (owner: string, index: number, target: string): void => {
    const targetIndex = position.get(target);
    if (targetIndex === undefined) throw new Error(`${owner} targets undeclared node ${target}`);
    if (targetIndex <= index) throw new Error(`${owner} targets ${target}, which is not downstream of it`);
  };
  const targetCases = new Map<NodeId, { branchId: NodeId; caseName: string }>();
  for (const [index, node] of nodes.entries()) {
    if (node.kind === "branch") {
      const branch = node as unknown as BranchNode<never, Readonly<Record<string, readonly NodeId[]>>>;
      for (const [caseName, targets] of Object.entries(branch.cases)) {
        if (targets.length === 0) throw new Error(`branch ${node.id} case "${caseName}" joins no node`);
        for (const target of targets) {
          const previousCase = targetCases.get(target);
          if (previousCase !== undefined
            && (previousCase.branchId !== node.id || previousCase.caseName !== caseName)) {
            throw new Error(`branch ${node.id} target ${target} appears in more than one case`);
          }
          targetCases.set(target, { branchId: node.id, caseName });
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
      previewBind?: (scope: never) => DryRunBinding | undefined;
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
        ...(pair.previewBind === undefined ? {} : { previewBind: pair.previewBind }),
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
      deriveChildItemId: (input: never, context: ChildRunIdentityContext) => ItemId;
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
      when?: NodeConditionSpec;
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
        ...(decl.when === undefined ? {} : { when: parseNodeCondition(decl.when) }),
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
