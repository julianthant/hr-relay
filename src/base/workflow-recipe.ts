/**
 * D311's one workflow-authoring seam.
 *
 * A recipe groups typed task values for presentation and connects them with
 * object references for execution. The compiler is the only place those
 * references become the existing flow builder's string node ids, so tuple
 * order can never accidentally become execution authority.
 */
import { z } from "zod";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
} from "../domain/contracts/base.js";
import type { NodeConditionSpec } from "../domain/workflow/node-condition.js";
import type { CompletionProgram } from "../domain/workflow/completion.js";
import {
  TimelineCategoryKeySchema,
  WorkflowStepSchema,
} from "../domain/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../domain/workflow/step-omission.js";
import type { RuntimeFlowNode, TypedTransactionOutcome } from "../domain/workflow/graph.js";
import type { RetryPolicy } from "../domain/session.js";
import type { RegisteredTaskStore } from "./store.js";
import { flow } from "./flow.js";
import type {
  AnyNodeEntry,
  BuiltFlow,
  OperatorGateNodeFragment,
  TaskNodeFragment,
  TransactionNodeFragment,
} from "./flow.js";
import { defineWorkflowDescriptor } from "./workflow.js";
import type {
  AnyWorkflowDescriptor,
  WorkflowDescriptor,
  WorkflowDescriptorSpec,
} from "./workflow.js";

type RecipeTaskKind = "task" | "transaction" | "gate";

export interface WorkflowTimelineGroup {
  readonly key: string;
  readonly label: string;
  readonly omission?: StepOmissionDeclaration;
}

export interface WorkflowRecipeTask<
  Id extends string = string,
  Output = unknown,
  Conditional extends boolean = boolean,
> {
  readonly recipeKind: "workflow-recipe-task";
  readonly kind: RecipeTaskKind;
  readonly id: Id;
  readonly references: readonly AnyWorkflowRecipeTask[];
  readonly contracts: readonly (AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract)[];
  /** Type-only witnesses used by reference-scope inference. */
  readonly _output?: Output;
  readonly _conditional?: Conditional;
}

export type AnyWorkflowRecipeTask = WorkflowRecipeTask<string, unknown, boolean>;

type TaskOutput<Task> = Task extends WorkflowRecipeTask<string, infer Output, infer Conditional>
  ? Output | (Conditional extends true ? undefined : never)
  : never;

type RecipeOutputs<References extends readonly AnyWorkflowRecipeTask[]> = {
  readonly [Reference in References[number] as Reference["id"]]: TaskOutput<Reference>;
};

export interface WorkflowRecipeScope<
  InputSchema extends z.ZodType,
  References extends readonly AnyWorkflowRecipeTask[],
> {
  readonly input: z.output<InputSchema>;
  readonly outputs: RecipeOutputs<References>;
}

interface ReadRecipeTask<
  Id extends string,
  Output,
  Conditional extends boolean,
> extends WorkflowRecipeTask<Id, Output, Conditional> {
  readonly kind: "task";
  readonly contract: AnyReadTaskContract;
  readonly label?: string;
  readonly replay: "checkpoint" | "always-rerun";
  readonly when?: NodeConditionSpec;
  readonly bind: (scope: unknown) => unknown;
}

interface TransactionRecipeTask<Id extends string, Output>
  extends WorkflowRecipeTask<Id, Output, false> {
  readonly kind: "transaction";
  readonly prepareContract: AnyPrepareTaskContract;
  readonly commitContract: AnyCommitTaskContract;
  readonly label?: string;
  readonly dryRun: "stop-after-prepare" | "unsupported";
  readonly probePolicy: "always" | "retries-and-recovery-only";
  readonly probeToFenceMaxMs: number;
  readonly retryBeforeFence?: RetryPolicy;
  readonly prepareBind: (scope: unknown) => unknown;
  readonly commitBind: (scope: unknown) => unknown;
}

interface GateRecipeTask<Id extends string, Output, Conditional extends boolean>
  extends WorkflowRecipeTask<Id, Output, Conditional> {
  readonly kind: "gate";
  readonly label: string;
  readonly statusKey?: string;
  readonly result: z.ZodType;
  readonly when?: NodeConditionSpec;
}

type RuntimeRecipeTask =
  | ReadRecipeTask<string, unknown, boolean>
  | TransactionRecipeTask<string, unknown>
  | GateRecipeTask<string, unknown, boolean>;

type WorkflowRecipeTuple = readonly [WorkflowTimelineGroup, readonly AnyWorkflowRecipeTask[]];

export interface WorkflowRecipe<
  InputSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
> {
  readonly kind: "workflow-recipe";
  readonly input: InputSchema;
  readonly steps: readonly WorkflowRecipeTuple[];
  readonly result: Readonly<{
    schema: ResultSchema;
    references: readonly AnyWorkflowRecipeTask[];
    derive: (scope: unknown) => z.input<ResultSchema>;
  }>;
}

interface WorkflowRecipeAuthor<InputSchema extends z.ZodType> {
  task<
    const Id extends string,
    Contract extends AnyReadTaskContract,
    const References extends readonly AnyWorkflowRecipeTask[],
    const Conditional extends boolean = false,
  >(
    identity: Readonly<{
      id: Id;
      contract: Contract;
      label?: string;
      replay: "checkpoint" | "always-rerun";
      when?: NodeConditionSpec;
      conditional?: Conditional;
    }>,
    references: References,
    bind: (scope: WorkflowRecipeScope<InputSchema, References>) => z.input<Contract["input"]>,
  ): WorkflowRecipeTask<Id, z.output<Contract["output"]>, Conditional>;

  taskFromFragment<
    const StepKey extends string,
    const Id extends string,
    Contract extends AnyReadTaskContract,
    const References extends readonly AnyWorkflowRecipeTask[],
  >(
    fragment: TaskNodeFragment<StepKey, Id, Contract>,
    references: References,
    bind: (scope: WorkflowRecipeScope<InputSchema, References>) => z.input<Contract["input"]>,
  ): WorkflowRecipeTask<Id, z.output<Contract["output"]>, false>;

  transactionFromFragment<
    const StepKey extends string,
    const Id extends string,
    Prepare extends AnyPrepareTaskContract,
    Commit extends AnyCommitTaskContract,
    const References extends readonly AnyWorkflowRecipeTask[],
  >(
    fragment: TransactionNodeFragment<StepKey, Id, Prepare, Commit>,
    references: References,
    binds: Readonly<{
      prepare: (scope: WorkflowRecipeScope<InputSchema, References>) => z.input<Prepare["input"]>;
      commit: (scope: WorkflowRecipeScope<InputSchema, References>) => z.input<Commit["input"]>;
    }>,
  ): WorkflowRecipeTask<Id, TypedTransactionOutcome<Commit>, false>;

  gateFromFragment<
    const StepKey extends string,
    const Id extends string,
    Result extends z.ZodType,
    const Conditional extends boolean,
    const References extends readonly AnyWorkflowRecipeTask[],
  >(
    fragment: OperatorGateNodeFragment<StepKey, Id, Result, Conditional>,
    references: References,
  ): WorkflowRecipeTask<Id, z.output<Result>, Conditional>;

  result<
    ResultSchema extends z.ZodType,
    const References extends readonly AnyWorkflowRecipeTask[],
  >(
    schema: ResultSchema,
    references: References,
    derive: (scope: WorkflowRecipeScope<InputSchema, References>) => z.input<ResultSchema>,
  ): WorkflowRecipe<InputSchema, ResultSchema>["result"];
}

function recipeAuthor<InputSchema extends z.ZodType>(): WorkflowRecipeAuthor<InputSchema> {
  const author = {
    task(
      identity: Readonly<{
        id: string;
        contract: AnyReadTaskContract;
        label?: string;
        replay: "checkpoint" | "always-rerun";
        when?: NodeConditionSpec;
        conditional?: boolean;
      }>,
      references: readonly AnyWorkflowRecipeTask[],
      bind: (scope: never) => unknown,
    ) {
      const task: ReadRecipeTask<string, unknown, boolean> = {
        recipeKind: "workflow-recipe-task",
        kind: "task",
        id: identity.id,
        references,
        contracts: Object.freeze([identity.contract]),
        contract: identity.contract,
        ...(identity.label === undefined ? {} : { label: identity.label }),
        replay: identity.replay,
        ...(identity.when === undefined ? {} : { when: identity.when }),
        bind: (scope) => bind(scope as never),
      };
      return Object.freeze(task);
    },
    taskFromFragment(
      fragment: TaskNodeFragment<string, string, AnyReadTaskContract>,
      references: readonly AnyWorkflowRecipeTask[],
      bind: (scope: never) => unknown,
    ) {
      const task: ReadRecipeTask<string, unknown, false> = {
        recipeKind: "workflow-recipe-task",
        kind: "task",
        id: fragment.id,
        references,
        contracts: Object.freeze([fragment.contract]),
        contract: fragment.contract,
        label: fragment.label,
        replay: fragment.replay,
        bind: (scope) => bind(scope as never),
      };
      return Object.freeze(task);
    },
    transactionFromFragment(
      fragment: TransactionNodeFragment<
        string,
        string,
        AnyPrepareTaskContract,
        AnyCommitTaskContract
      >,
      references: readonly AnyWorkflowRecipeTask[],
      binds: Readonly<{
        prepare: (scope: never) => unknown;
        commit: (scope: never) => unknown;
      }>,
    ) {
      const task: TransactionRecipeTask<string, unknown> = {
        recipeKind: "workflow-recipe-task",
        kind: "transaction",
        id: fragment.id,
        references,
        contracts: Object.freeze([fragment.prepare, fragment.commit]),
        prepareContract: fragment.prepare,
        commitContract: fragment.commit,
        label: fragment.label,
        dryRun: fragment.dryRun,
        probePolicy: fragment.probePolicy,
        probeToFenceMaxMs: fragment.probeToFenceMaxMs,
        ...(fragment.retryBeforeFence === undefined ? {} : { retryBeforeFence: fragment.retryBeforeFence }),
        prepareBind: (scope) => binds.prepare(scope as never),
        commitBind: (scope) => binds.commit(scope as never),
      };
      return Object.freeze(task);
    },
    gateFromFragment(
      fragment: OperatorGateNodeFragment<string, string, z.ZodType, boolean>,
      references: readonly AnyWorkflowRecipeTask[],
    ) {
      const task: GateRecipeTask<string, unknown, boolean> = {
        recipeKind: "workflow-recipe-task",
        kind: "gate",
        id: fragment.id,
        references,
        contracts: Object.freeze([]),
        label: fragment.label,
        ...(fragment.statusKey === undefined ? {} : { statusKey: fragment.statusKey }),
        result: fragment.result,
        ...("when" in fragment && fragment.when !== undefined ? { when: fragment.when } : {}),
      };
      return Object.freeze(task);
    },
    result(
      schema: z.ZodType,
      references: readonly AnyWorkflowRecipeTask[],
      derive: (scope: never) => unknown,
    ) {
      return Object.freeze({
        schema,
        references,
        derive: (scope: unknown) => derive(scope as never),
      });
    },
  };
  return Object.freeze(author) as unknown as WorkflowRecipeAuthor<InputSchema>;
}

function taskName(task: AnyWorkflowRecipeTask): string {
  return `workflow recipe task "${task.id}"`;
}

function validateRecipe(
  steps: readonly WorkflowRecipeTuple[],
  resultReferences: readonly AnyWorkflowRecipeTask[],
): void {
  if (steps.length === 0) throw new Error("workflow recipe requires at least one timeline group");
  const tasks = steps.flatMap(([, members]) => members);
  if (tasks.length === 0) throw new Error("workflow recipe requires at least one task");

  const groupKeys = new Set<string>();
  const groupLabels = new Set<string>();
  const taskObjects = new Set<AnyWorkflowRecipeTask>();
  const taskIds = new Set<string>();
  for (const [group, members] of steps) {
    const parsed = WorkflowStepSchema.parse(group);
    TimelineCategoryKeySchema.parse(parsed.key);
    if (groupKeys.has(parsed.key)) throw new Error(`workflow recipe repeats timeline group key "${parsed.key}"`);
    if (groupLabels.has(parsed.label)) throw new Error(`workflow recipe repeats timeline group label "${parsed.label}"`);
    groupKeys.add(parsed.key);
    groupLabels.add(parsed.label);
    if (members.length === 0) throw new Error(`workflow recipe timeline group "${parsed.key}" has no tasks`);
    for (const task of members) {
      if (taskObjects.has(task)) throw new Error(`${taskName(task)} appears in more than one timeline tuple`);
      if (taskIds.has(task.id)) throw new Error(`workflow recipe declares task id "${task.id}" more than once`);
      taskObjects.add(task);
      taskIds.add(task.id);
    }
  }

  const assertResolved = (owner: string, references: readonly AnyWorkflowRecipeTask[]): void => {
    const seen = new Set<AnyWorkflowRecipeTask>();
    for (const reference of references) {
      if (seen.has(reference)) throw new Error(`${owner} repeats reference "${reference.id}"`);
      seen.add(reference);
      if (!taskObjects.has(reference)) {
        throw new Error(`${owner} references unresolved task "${reference.id}"`);
      }
    }
  };
  for (const task of tasks) assertResolved(taskName(task), task.references);
  assertResolved("workflow recipe result", resultReferences);

  const visiting = new Set<AnyWorkflowRecipeTask>();
  const visited = new Set<AnyWorkflowRecipeTask>();
  const visit = (task: AnyWorkflowRecipeTask, path: readonly string[]): void => {
    if (visited.has(task)) return;
    if (visiting.has(task)) {
      throw new Error(`workflow recipe dependency cycle: ${[...path, task.id].join(" -> ")}`);
    }
    visiting.add(task);
    for (const reference of task.references) visit(reference, [...path, task.id]);
    visiting.delete(task);
    visited.add(task);
  };
  for (const task of tasks) visit(task, []);
}

/**
 * Define one immutable recipe. The callback exists only to bind every task's
 * input/output types to this recipe's input schema; the returned `steps` array
 * remains the sole grouping and timeline-order authority.
 */
export function defineWorkflowRecipe<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
>(
  input: InputSchema,
  define: (author: WorkflowRecipeAuthor<InputSchema>) => Readonly<{
    steps: readonly WorkflowRecipeTuple[];
    result: WorkflowRecipe<InputSchema, ResultSchema>["result"];
  }>,
): WorkflowRecipe<InputSchema, ResultSchema> {
  const definition = define(recipeAuthor<InputSchema>());
  validateRecipe(definition.steps, definition.result.references);
  for (const [, tasks] of definition.steps) {
    for (const task of tasks) Object.freeze(task.references);
  }
  Object.freeze(definition.result.references);
  return Object.freeze({
    kind: "workflow-recipe",
    input,
    steps: Object.freeze(definition.steps.map(([group, tasks]) => Object.freeze([
      Object.freeze({ ...group }),
      Object.freeze([...tasks]),
    ] as const))),
    result: definition.result,
  });
}

function topologicalTasks(recipe: WorkflowRecipe): readonly RuntimeRecipeTask[] {
  const tasks = recipe.steps.flatMap(([, members]) => members) as unknown as readonly RuntimeRecipeTask[];
  const ordered: RuntimeRecipeTask[] = [];
  const remaining = new Set(tasks);
  while (remaining.size > 0) {
    const ready = tasks.find((task) =>
      remaining.has(task)
      && task.references.every((reference) => !remaining.has(reference as RuntimeRecipeTask)));
    if (ready === undefined) {
      throw new Error(`workflow recipe dependency cycle among: ${[...remaining].map(({ id }) => id).join(", ")}`);
    }
    remaining.delete(ready);
    ordered.push(ready);
  }
  return Object.freeze(ordered);
}

type CompiledState = Readonly<Record<string, AnyNodeEntry>>;
type CompiledFlow<InputSchema extends z.ZodType, ResultSchema extends z.ZodType> = BuiltFlow<
  InputSchema,
  ResultSchema,
  readonly RuntimeFlowNode[],
  CompiledState,
  readonly string[]
>;

interface RuntimeFlowBuilder {
  step(id: string, contract: AnyReadTaskContract, opts: Readonly<{
    label?: string;
    dependsOn: readonly string[];
    bind: (scope: unknown) => unknown;
    when?: NodeConditionSpec;
    replay: "checkpoint" | "always-rerun";
  }>): RuntimeFlowBuilder;
  transaction(id: string, pair: Readonly<{
    label?: string;
    dependsOn: readonly string[];
    prepare: Readonly<{ uses: AnyPrepareTaskContract; bind: (scope: unknown) => unknown }>;
    commit: Readonly<{ uses: AnyCommitTaskContract; bind: (scope: unknown) => unknown }>;
    dryRun: "stop-after-prepare" | "unsupported";
    probePolicy: "always" | "retries-and-recovery-only";
    probeToFenceMaxMs: number;
    retryBeforeFence?: RetryPolicy;
  }>): RuntimeFlowBuilder;
  gate(id: string, decl: Readonly<{
    dependsOn: readonly string[];
    label: string;
    statusKey?: string;
    resolvedBy: "operator";
    when?: NodeConditionSpec;
    result: z.ZodType;
  }>): RuntimeFlowBuilder;
  build(result: Readonly<{
    schema: z.ZodType;
    dependsOn: readonly string[];
    derive: (scope: unknown) => unknown;
  }>): unknown;
}

function compileFlow<InputSchema extends z.ZodType, ResultSchema extends z.ZodType>(
  recipe: WorkflowRecipe<InputSchema, ResultSchema>,
): CompiledFlow<InputSchema, ResultSchema> {
  const builder = flow(recipe.input) as unknown as RuntimeFlowBuilder;
  for (const task of topologicalTasks(recipe)) {
    const dependsOn = Object.freeze(task.references.map(({ id }) => id));
    if (task.kind === "task") {
      builder.step(task.id, task.contract, {
        ...(task.label === undefined ? {} : { label: task.label }),
        dependsOn,
        bind: task.bind,
        ...(task.when === undefined ? {} : { when: task.when }),
        replay: task.replay,
      });
      continue;
    }
    if (task.kind === "transaction") {
      builder.transaction(task.id, {
        ...(task.label === undefined ? {} : { label: task.label }),
        dependsOn,
        prepare: { uses: task.prepareContract, bind: task.prepareBind },
        commit: { uses: task.commitContract, bind: task.commitBind },
        dryRun: task.dryRun,
        probePolicy: task.probePolicy,
        probeToFenceMaxMs: task.probeToFenceMaxMs,
        ...(task.retryBeforeFence === undefined ? {} : { retryBeforeFence: task.retryBeforeFence }),
      });
      continue;
    }
    builder.gate(task.id, {
      dependsOn,
      label: task.label,
      ...(task.statusKey === undefined ? {} : { statusKey: task.statusKey }),
      resolvedBy: "operator",
      ...(task.when === undefined ? {} : { when: task.when }),
      result: task.result,
    });
  }
  return builder.build({
    schema: recipe.result.schema,
    dependsOn: recipe.result.references.map(({ id }) => id),
    derive: recipe.result.derive,
  }) as CompiledFlow<InputSchema, ResultSchema>;
}

const DESCRIPTOR_RECIPES = new WeakMap<object, WorkflowRecipe>();

type RecipeDescriptorSpec<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
> = Omit<
  WorkflowDescriptorSpec<
    InputSchema,
    ResultSchema,
    readonly RuntimeFlowNode[],
    Completion,
    CompiledState,
    readonly string[]
  >,
  "flow" | "timeline"
>;

/** Compile a recipe through the existing descriptor factory and runtime. */
export function compileWorkflowRecipe<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
>(
  recipe: WorkflowRecipe<InputSchema, ResultSchema>,
  spec: RecipeDescriptorSpec<InputSchema, ResultSchema, Completion>,
): WorkflowDescriptor<
  InputSchema,
  ResultSchema,
  readonly RuntimeFlowNode[],
  Completion,
  CompiledState,
  readonly string[]
> {
  const timeline = recipe.steps.map(([group, tasks]) => ({
    ...group,
    nodes: tasks.map(({ id }) => id),
  }));
  const usesDefaultTimeline = recipe.steps.every(([group, tasks]) => {
    const [task] = tasks as readonly RuntimeRecipeTask[];
    if (task === undefined || tasks.length !== 1 || group.omission !== undefined) return false;
    const label = task.kind === "task"
      ? task.label ?? task.contract.title
      : task.kind === "transaction"
        ? task.label ?? task.commitContract.title
        : task.label;
    return group.key === task.id && group.label === label;
  });
  const descriptor = defineWorkflowDescriptor({
    ...spec,
    flow: compileFlow(recipe),
    ...(usesDefaultTimeline ? {} : { timeline }),
  });
  DESCRIPTOR_RECIPES.set(descriptor, recipe);
  return descriptor;
}

function recipeContracts(recipe: WorkflowRecipe): readonly (
  AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract
)[] {
  return Object.freeze(recipe.steps.flatMap(([, tasks]) => tasks.flatMap(({ contracts }) => contracts)));
}

function storeNamespace(contract: AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract): string {
  return String(contract.id).slice(0, String(contract.id).lastIndexOf("/"));
}

/**
 * Derive the server module's exact store requirements from the recipe's task
 * contracts. `availableStores` is an inventory, not another authoring list:
 * unused stores are dropped and missing/exact-contract mismatches refuse.
 */
export function compileWorkflowRecipeModule<
  Descriptor extends AnyWorkflowDescriptor,
  Extras extends Readonly<Record<string, unknown>>,
>(
  recipe: WorkflowRecipe,
  descriptor: Descriptor,
  availableStores: readonly RegisteredTaskStore[],
  extras: Extras,
): Readonly<{ descriptor: Descriptor; stores: readonly RegisteredTaskStore[]; recipe: WorkflowRecipe } & Extras> {
  if (DESCRIPTOR_RECIPES.get(descriptor) !== recipe) {
    throw new Error(`workflow ${String(descriptor.id)} module does not use the recipe that compiled its descriptor`);
  }
  const contracts = recipeContracts(recipe);
  const namespaces = [...new Set(contracts.map(storeNamespace))];
  const stores = namespaces.map((namespace) => {
    const store = availableStores.find((candidate) => String(candidate.namespace) === namespace);
    if (store === undefined) {
      throw new Error(`workflow ${String(descriptor.id)} recipe requires missing store ${namespace}`);
    }
    for (const contract of contracts.filter((candidate) => storeNamespace(candidate) === namespace)) {
      if (!Object.values(store.tasks).some((task) => task.contract === contract)) {
        throw new Error(`workflow ${String(descriptor.id)} recipe cannot resolve exact contract ${contract.id}`);
      }
    }
    return store;
  });
  return Object.freeze({ descriptor, stores: Object.freeze(stores), recipe, ...extras });
}

/** Registry/conformance seam: recover the exact recipe that compiled a descriptor. */
export function workflowRecipeFor(descriptor: object): WorkflowRecipe | undefined {
  return DESCRIPTOR_RECIPES.get(descriptor);
}
