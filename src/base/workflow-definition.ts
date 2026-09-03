/**
 * D311/D317 — the ONE workflow-authoring seam.
 *
 * A `WorkflowDefinition` is the reviewed source form of a workflow: identity
 * and presentation, typed input/result, and one ordered array of timeline
 * tuples `[group, entries[]]`. Tuple order is presentation order only; every
 * execution edge is derived from the typed references an entry declares. The
 * compiler is the only place those references become the runtime builder's
 * string node ids, so tuple order can never accidentally become execution
 * authority.
 *
 * Vocabulary (D317): the authored value is a `WorkflowDefinition`, its
 * generated executable representation is a `CompiledWorkflow`, and one
 * execution is a workflow run. "Recipe" is a teaching analogy and is not a
 * type, file, API or second domain concept here.
 */
import { z } from "zod";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
} from "../domain/contracts/base.js";
import type { IntakeProjection } from "../domain/intake/projection.js";
import { WorkflowIdSchema } from "../domain/ids.js";
import type { NodeConditionSpec } from "../domain/workflow/node-condition.js";
import type { CompletionProgram } from "../domain/workflow/completion.js";
import { BUILD_MANIFEST, resolveWorkflowFingerprint } from "../domain/workflow/build-manifest.js";
import type { WorkflowModuleRole } from "../domain/workflow/module-role.js";
import { WorkflowModuleRoleSchema } from "../domain/workflow/module-role.js";
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

type EntryKind = "task" | "transaction" | "gate";
const GROUP_OWNER = Symbol("workflow-group-owner");

export interface WorkflowTimelineGroup {
  readonly key: string;
  readonly label: string;
  readonly omission?: StepOmissionDeclaration;
  readonly [GROUP_OWNER]?: WorkflowTimelineGroup;
}

/**
 * One entry of a timeline tuple: a typed reusable value over an existing task
 * contract (or gate/transaction declaration) that appears in exactly one tuple.
 */
export interface WorkflowEntry<
  Id extends string = string,
  Output = unknown,
  Conditional extends boolean = boolean,
> {
  readonly entryKind: "workflow-entry";
  readonly kind: EntryKind;
  readonly id: Id;
  /** Exact D265 step object that owns a reusable fragment, when one exists. */
  readonly step?: WorkflowTimelineGroup;
  readonly references: readonly AnyWorkflowEntry[];
  readonly contracts: readonly (AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract)[];
  /** Type-only witnesses used by reference-scope inference. */
  readonly _output?: Output;
  readonly _conditional?: Conditional;
}

export type AnyWorkflowEntry = WorkflowEntry<string, unknown, boolean>;

type EntryOutput<Entry> = Entry extends WorkflowEntry<string, infer Output, infer Conditional>
  ? Output | (Conditional extends true ? undefined : never)
  : never;

type EntryOutputs<References extends readonly AnyWorkflowEntry[]> = {
  readonly [Reference in References[number] as Reference["id"]]: EntryOutput<Reference>;
};

export interface WorkflowEntryScope<
  InputSchema extends z.ZodType,
  References extends readonly AnyWorkflowEntry[],
> {
  readonly input: z.output<InputSchema>;
  readonly outputs: EntryOutputs<References>;
}

interface TaskEntry<
  Id extends string,
  Output,
  Conditional extends boolean,
> extends WorkflowEntry<Id, Output, Conditional> {
  readonly kind: "task";
  readonly contract: AnyReadTaskContract;
  readonly label?: string;
  readonly replay: "checkpoint" | "always-rerun";
  readonly when?: NodeConditionSpec;
  readonly bind: (scope: unknown) => unknown;
}

interface TransactionEntry<Id extends string, Output>
  extends WorkflowEntry<Id, Output, false> {
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

interface GateEntry<Id extends string, Output, Conditional extends boolean>
  extends WorkflowEntry<Id, Output, Conditional> {
  readonly kind: "gate";
  readonly label: string;
  readonly statusKey?: string;
  readonly result: z.ZodType;
  readonly when?: NodeConditionSpec;
}

type RuntimeEntry =
  | TaskEntry<string, unknown, boolean>
  | TransactionEntry<string, unknown>
  | GateEntry<string, unknown, boolean>;

export type WorkflowTimelineTuple = readonly [WorkflowTimelineGroup, readonly AnyWorkflowEntry[]];

export interface WorkflowResultDeclaration<
  InputSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
> {
  readonly schema: ResultSchema;
  readonly references: readonly AnyWorkflowEntry[];
  readonly derive: (scope: unknown) => z.input<ResultSchema>;
  /** Type witness binding the derive scope to this definition's input. */
  readonly _input?: InputSchema;
}

export interface WorkflowAuthor<InputSchema extends z.ZodType> {
  group(
    this: void,
    step: WorkflowTimelineGroup,
    options: Readonly<{ omission: StepOmissionDeclaration }>,
  ): WorkflowTimelineGroup;

  task<
    const Id extends string,
    Contract extends AnyReadTaskContract,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Readonly<{
      id: Id;
      contract: Contract;
      label?: string;
      replay: "checkpoint" | "always-rerun";
      when: NodeConditionSpec;
    }>,
    references: References,
    bind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Contract["input"]>,
  ): WorkflowEntry<Id, z.output<Contract["output"]>, true>;

  task<
    const Id extends string,
    Contract extends AnyReadTaskContract,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Readonly<{
      id: Id;
      contract: Contract;
      label?: string;
      replay: "checkpoint" | "always-rerun";
      when?: undefined;
    }>,
    references: References,
    bind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Contract["input"]>,
  ): WorkflowEntry<Id, z.output<Contract["output"]>, false>;

  taskFromFragment<
    const StepKey extends string,
    const Id extends string,
    Contract extends AnyReadTaskContract,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    fragment: TaskNodeFragment<StepKey, Id, Contract>,
    references: References,
    bind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Contract["input"]>,
  ): WorkflowEntry<Id, z.output<Contract["output"]>, false>;

  transactionFromFragment<
    const StepKey extends string,
    const Id extends string,
    Prepare extends AnyPrepareTaskContract,
    Commit extends AnyCommitTaskContract,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    fragment: TransactionNodeFragment<StepKey, Id, Prepare, Commit>,
    references: References,
    binds: Readonly<{
      prepareBind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Prepare["input"]>;
      commitBind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Commit["input"]>;
    }>,
  ): WorkflowEntry<Id, TypedTransactionOutcome<Commit>, false>;

  gateFromFragment<
    const StepKey extends string,
    const Id extends string,
    Result extends z.ZodType,
    const Conditional extends boolean,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    fragment: OperatorGateNodeFragment<StepKey, Id, Result, Conditional>,
    references: References,
  ): WorkflowEntry<Id, z.output<Result>, Conditional>;

  result<
    ResultSchema extends z.ZodType,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    schema: ResultSchema,
    references: References,
    derive: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<ResultSchema>,
  ): WorkflowResultDeclaration<InputSchema, ResultSchema>;
}

function workflowAuthor<InputSchema extends z.ZodType>(): WorkflowAuthor<InputSchema> {
  const author = {
    group(
      step: WorkflowTimelineGroup,
      options: Readonly<{ omission: StepOmissionDeclaration }>,
    ) {
      return Object.freeze({
        key: step.key,
        label: step.label,
        omission: options.omission,
        [GROUP_OWNER]: step,
      });
    },
    task(
      identity: Readonly<{
        id: string;
        contract: AnyReadTaskContract;
        label?: string;
        replay: "checkpoint" | "always-rerun";
        when?: NodeConditionSpec;
      }>,
      references: readonly AnyWorkflowEntry[],
      bind: (scope: never) => unknown,
    ) {
      const entry: TaskEntry<string, unknown, boolean> = {
        entryKind: "workflow-entry",
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
      return Object.freeze(entry);
    },
    taskFromFragment(
      fragment: TaskNodeFragment<string, string, AnyReadTaskContract>,
      references: readonly AnyWorkflowEntry[],
      bind: (scope: never) => unknown,
    ) {
      const entry: TaskEntry<string, unknown, false> = {
        entryKind: "workflow-entry",
        kind: "task",
        id: fragment.id,
        step: fragment.step,
        references,
        contracts: Object.freeze([fragment.contract]),
        contract: fragment.contract,
        label: fragment.label,
        replay: fragment.replay,
        bind: (scope) => bind(scope as never),
      };
      return Object.freeze(entry);
    },
    transactionFromFragment(
      fragment: TransactionNodeFragment<
        string,
        string,
        AnyPrepareTaskContract,
        AnyCommitTaskContract
      >,
      references: readonly AnyWorkflowEntry[],
      binds: Readonly<{
        prepareBind: (scope: never) => unknown;
        commitBind: (scope: never) => unknown;
      }>,
    ) {
      const entry: TransactionEntry<string, unknown> = {
        entryKind: "workflow-entry",
        kind: "transaction",
        id: fragment.id,
        step: fragment.step,
        references,
        contracts: Object.freeze([fragment.prepare, fragment.commit]),
        prepareContract: fragment.prepare,
        commitContract: fragment.commit,
        label: fragment.label,
        dryRun: fragment.dryRun,
        probePolicy: fragment.probePolicy,
        probeToFenceMaxMs: fragment.probeToFenceMaxMs,
        ...(fragment.retryBeforeFence === undefined ? {} : { retryBeforeFence: fragment.retryBeforeFence }),
        prepareBind: (scope) => binds.prepareBind(scope as never),
        commitBind: (scope) => binds.commitBind(scope as never),
      };
      return Object.freeze(entry);
    },
    gateFromFragment(
      fragment: OperatorGateNodeFragment<string, string, z.ZodType, boolean>,
      references: readonly AnyWorkflowEntry[],
    ) {
      const entry: GateEntry<string, unknown, boolean> = {
        entryKind: "workflow-entry",
        kind: "gate",
        id: fragment.id,
        step: fragment.step,
        references,
        contracts: Object.freeze([]),
        label: fragment.label,
        ...(fragment.statusKey === undefined ? {} : { statusKey: fragment.statusKey }),
        result: fragment.result,
        ...("when" in fragment && fragment.when !== undefined ? { when: fragment.when } : {}),
      };
      return Object.freeze(entry);
    },
    result(
      schema: z.ZodType,
      references: readonly AnyWorkflowEntry[],
      derive: (scope: never) => unknown,
    ) {
      return Object.freeze({
        schema,
        references,
        derive: (scope: unknown) => derive(scope as never),
      });
    },
  };
  return Object.freeze(author) as unknown as WorkflowAuthor<InputSchema>;
}

function entryName(entry: AnyWorkflowEntry): string {
  return `workflow entry "${entry.id}"`;
}

function validateSteps(
  id: string,
  steps: readonly WorkflowTimelineTuple[],
  resultReferences: readonly AnyWorkflowEntry[],
): void {
  if (steps.length === 0) throw new Error(`workflow ${id} requires at least one timeline group`);
  const entries = steps.flatMap(([, members]) => members);
  if (entries.length === 0) throw new Error(`workflow ${id} requires at least one entry`);

  const groupKeys = new Set<string>();
  const groupLabels = new Set<string>();
  const entryObjects = new Set<AnyWorkflowEntry>();
  const entryIds = new Set<string>();
  for (const [group, members] of steps) {
    const parsed = WorkflowStepSchema.parse({ key: group.key, label: group.label });
    TimelineCategoryKeySchema.parse(parsed.key);
    if (groupKeys.has(parsed.key)) throw new Error(`workflow ${id} repeats timeline group key "${parsed.key}"`);
    if (groupLabels.has(parsed.label)) throw new Error(`workflow ${id} repeats timeline group label "${parsed.label}"`);
    groupKeys.add(parsed.key);
    groupLabels.add(parsed.label);
    if (members.length === 0) throw new Error(`workflow ${id} timeline group "${parsed.key}" has no entries`);
    for (const entry of members) {
      const groupOwner = group[GROUP_OWNER] ?? group;
      if (entry.step !== undefined && entry.step !== groupOwner) {
        const sameKeyDifferentObject = entry.step.key === parsed.key
          ? `; same key but distinct step objects: "${parsed.label}" and "${entry.step.label}"`
          : "";
        throw new Error(
          `timeline group "${parsed.key}" claims ${entryName(entry)}, which belongs to step "${entry.step.key}"${sameKeyDifferentObject}`,
        );
      }
      if (entryObjects.has(entry)) throw new Error(`${entryName(entry)} appears in more than one timeline tuple`);
      if (entryIds.has(entry.id)) throw new Error(`workflow ${id} declares entry id "${entry.id}" more than once`);
      entryObjects.add(entry);
      entryIds.add(entry.id);
    }
  }

  const assertResolved = (owner: string, references: readonly AnyWorkflowEntry[]): void => {
    const seen = new Set<AnyWorkflowEntry>();
    for (const reference of references) {
      if (seen.has(reference)) throw new Error(`${owner} repeats reference "${reference.id}"`);
      seen.add(reference);
      if (!entryObjects.has(reference)) {
        throw new Error(`${owner} references unresolved entry "${reference.id}"`);
      }
    }
  };
  for (const entry of entries) assertResolved(entryName(entry), entry.references);
  assertResolved(`workflow ${id} result`, resultReferences);

  const visiting = new Set<AnyWorkflowEntry>();
  const visited = new Set<AnyWorkflowEntry>();
  const visit = (entry: AnyWorkflowEntry, path: readonly string[]): void => {
    if (visited.has(entry)) return;
    if (visiting.has(entry)) {
      throw new Error(`workflow ${id} dependency cycle: ${[...path, entry.id].join(" -> ")}`);
    }
    visiting.add(entry);
    for (const reference of entry.references) visit(reference, [...path, entry.id]);
    visiting.delete(entry);
    visited.add(entry);
  };
  for (const entry of entries) visit(entry, []);
}

type CompiledState = Readonly<Record<string, AnyNodeEntry>>;
type CompiledFlow<InputSchema extends z.ZodType, ResultSchema extends z.ZodType> = BuiltFlow<
  InputSchema,
  ResultSchema,
  readonly RuntimeFlowNode[],
  CompiledState,
  readonly string[]
>;

/**
 * The authored presentation half of a definition: every descriptor field an
 * author writes, minus the products the compiler derives (`flow`, `timeline`
 * and the build-manifest fingerprint).
 */
export type WorkflowDefinitionPresentation<
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
  "flow" | "timeline" | "contractFingerprint"
>;

export interface WorkflowDefinitionSpec<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined = undefined,
> extends WorkflowDefinitionPresentation<InputSchema, ResultSchema, Completion> {
  readonly input: InputSchema;
  /** D219 — what this workflow IS to the composition root. */
  readonly role: WorkflowModuleRole;
  /** Ref data-intake-and-edit-data §1 — the spreadsheet-capable declaration, when one exists. */
  readonly intake?: IntakeProjection;
  /**
   * The graph, authored through the typed author so every entry's input and
   * output binds to THIS input schema. Returns the ordered timeline tuples and
   * the terminal result declaration.
   */
  readonly steps: (author: WorkflowAuthor<InputSchema>) => Readonly<{
    steps: readonly WorkflowTimelineTuple[];
    result: WorkflowResultDeclaration<InputSchema, ResultSchema>;
  }>;
}

export interface WorkflowDefinition<
  InputSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
  Completion extends CompletionProgram | undefined = CompletionProgram | undefined,
> extends WorkflowDefinitionPresentation<InputSchema, ResultSchema, Completion> {
  readonly kind: "workflow-definition";
  readonly input: InputSchema;
  readonly role: WorkflowModuleRole;
  readonly intake?: IntakeProjection;
  readonly steps: readonly WorkflowTimelineTuple[];
  readonly result: WorkflowResultDeclaration<InputSchema, ResultSchema>;
}

export type AnyWorkflowDefinition = WorkflowDefinition<z.ZodType, z.ZodType, CompletionProgram | undefined>;

/**
 * Define one immutable workflow. The `steps` callback exists only to bind every
 * entry's input/output types to this workflow's input schema; the returned
 * tuple array remains the sole grouping and timeline-order authority.
 */
export function defineWorkflow<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined = undefined,
>(
  spec: WorkflowDefinitionSpec<InputSchema, ResultSchema, Completion>,
): WorkflowDefinition<InputSchema, ResultSchema, Completion> {
  const id = WorkflowIdSchema.parse(spec.id);
  WorkflowModuleRoleSchema.parse(spec.role);
  const { steps: authorSteps, input, role, intake, ...presentation } = spec;
  const authored = authorSteps(workflowAuthor<InputSchema>());
  validateSteps(id, authored.steps, authored.result.references);
  for (const [, entries] of authored.steps) {
    for (const entry of entries) Object.freeze(entry.references);
  }
  Object.freeze(authored.result.references);
  return Object.freeze({
    ...presentation,
    kind: "workflow-definition",
    input,
    role,
    ...(intake === undefined ? {} : { intake }),
    steps: Object.freeze(authored.steps.map(([group, entries]) => Object.freeze([
      Object.freeze({ ...group }),
      Object.freeze([...entries]),
    ] as const))),
    result: authored.result,
  });
}

function topologicalEntries(definition: AnyWorkflowDefinition): readonly RuntimeEntry[] {
  const entries = definition.steps.flatMap(([, members]) => members) as unknown as readonly RuntimeEntry[];
  const ordered: RuntimeEntry[] = [];
  const remaining = new Set(entries);
  while (remaining.size > 0) {
    const ready = entries.find((entry) =>
      remaining.has(entry)
      && entry.references.every((reference) => !remaining.has(reference as RuntimeEntry)));
    if (ready === undefined) {
      throw new Error(`workflow ${definition.id} dependency cycle among: ${[...remaining].map(({ id }) => id).join(", ")}`);
    }
    remaining.delete(ready);
    ordered.push(ready);
  }
  return Object.freeze(ordered);
}

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
  definition: WorkflowDefinition<InputSchema, ResultSchema, CompletionProgram | undefined>,
): CompiledFlow<InputSchema, ResultSchema> {
  const builder = flow(definition.input) as unknown as RuntimeFlowBuilder;
  for (const entry of topologicalEntries(definition)) {
    const dependsOn = Object.freeze(entry.references.map(({ id }) => id));
    if (entry.kind === "task") {
      builder.step(entry.id, entry.contract, {
        ...(entry.label === undefined ? {} : { label: entry.label }),
        dependsOn,
        bind: entry.bind,
        ...(entry.when === undefined ? {} : { when: entry.when }),
        replay: entry.replay,
      });
      continue;
    }
    if (entry.kind === "transaction") {
      builder.transaction(entry.id, {
        ...(entry.label === undefined ? {} : { label: entry.label }),
        dependsOn,
        prepare: { uses: entry.prepareContract, bind: entry.prepareBind },
        commit: { uses: entry.commitContract, bind: entry.commitBind },
        dryRun: entry.dryRun,
        probePolicy: entry.probePolicy,
        probeToFenceMaxMs: entry.probeToFenceMaxMs,
        ...(entry.retryBeforeFence === undefined ? {} : { retryBeforeFence: entry.retryBeforeFence }),
      });
      continue;
    }
    builder.gate(entry.id, {
      dependsOn,
      label: entry.label,
      ...(entry.statusKey === undefined ? {} : { statusKey: entry.statusKey }),
      resolvedBy: "operator",
      ...(entry.when === undefined ? {} : { when: entry.when }),
      result: entry.result,
    });
  }
  return builder.build({
    schema: definition.result.schema,
    dependsOn: definition.result.references.map(({ id }) => id),
    derive: definition.result.derive,
  }) as CompiledFlow<InputSchema, ResultSchema>;
}

export type CompiledWorkflowDescriptor<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
> = WorkflowDescriptor<
  InputSchema,
  ResultSchema,
  readonly RuntimeFlowNode[],
  Completion,
  CompiledState,
  readonly string[]
>;

/**
 * The generated executable representation of one definition: the exact
 * descriptor the runtime and every generic projection consume, plus the
 * contract set and store namespaces the composition root resolves.
 */
export interface CompiledWorkflow<
  InputSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
  Completion extends CompletionProgram | undefined = CompletionProgram | undefined,
> {
  readonly kind: "compiled-workflow";
  readonly definition: WorkflowDefinition<InputSchema, ResultSchema, Completion>;
  readonly descriptor: CompiledWorkflowDescriptor<InputSchema, ResultSchema, Completion>;
  readonly contracts: readonly (AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract)[];
  /** Task-store namespaces the definition's contracts belong to, first-use order. */
  readonly storeNamespaces: readonly string[];
}

export type AnyCompiledWorkflow = CompiledWorkflow<z.ZodType, z.ZodType, CompletionProgram | undefined>;

const COMPILED = new WeakMap<object, AnyCompiledWorkflow>();
const DESCRIPTOR_DEFINITIONS = new WeakMap<object, AnyWorkflowDefinition>();

function storeNamespace(contract: AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract): string {
  return String(contract.id).slice(0, String(contract.id).lastIndexOf("/"));
}

/**
 * Compile a definition through the existing descriptor factory and runtime.
 * Compilation is memoized per definition object, so the descriptor's identity
 * is stable across every consumer — the composition root, the bundle-safe
 * descriptor tuple and every test read the same object.
 */
export function compileWorkflow<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
>(
  definition: WorkflowDefinition<InputSchema, ResultSchema, Completion>,
): CompiledWorkflow<InputSchema, ResultSchema, Completion> {
  const existing = COMPILED.get(definition);
  if (existing !== undefined) return existing as CompiledWorkflow<InputSchema, ResultSchema, Completion>;
  if (definition.kind !== "workflow-definition") {
    throw new Error("compileWorkflow requires a value produced by defineWorkflow");
  }
  const { kind, input, role, intake, steps, result, ...presentation } = definition;
  void kind;
  void input;
  void role;
  void intake;
  const timeline = steps.map(([group, entries]) => ({
    key: group.key,
    label: group.label,
    nodes: entries.map(({ id }) => id),
    ...(group.omission === undefined ? {} : { omission: group.omission }),
  }));
  const usesDefaultTimeline = steps.every(([group, entries]) => {
    const [entry] = entries as readonly RuntimeEntry[];
    if (entry === undefined || entries.length !== 1 || group.omission !== undefined) return false;
    const label = entry.kind === "task"
      ? entry.label ?? entry.contract.title
      : entry.kind === "transaction"
        ? entry.label ?? entry.commitContract.title
        : entry.label;
    return group.key === entry.id && group.label === label;
  });
  const descriptor = defineWorkflowDescriptor({
    ...presentation,
    contractFingerprint: resolveWorkflowFingerprint(BUILD_MANIFEST, WorkflowIdSchema.parse(definition.id)),
    flow: compileFlow(definition),
    ...(usesDefaultTimeline ? {} : { timeline }),
  });
  const contracts = Object.freeze(steps.flatMap(([, entries]) => entries.flatMap(({ contracts: owned }) => owned)));
  const compiled: CompiledWorkflow<InputSchema, ResultSchema, Completion> = Object.freeze({
    kind: "compiled-workflow",
    definition,
    descriptor,
    contracts,
    storeNamespaces: Object.freeze([...new Set(contracts.map(storeNamespace))]),
  });
  void result;
  COMPILED.set(definition, compiled);
  DESCRIPTOR_DEFINITIONS.set(descriptor, definition);
  return compiled;
}

/** The server composition value the registry derives from one compiled workflow. */
export interface WorkflowModule<
  Descriptor extends AnyWorkflowDescriptor = AnyWorkflowDescriptor,
> {
  readonly descriptor: Descriptor;
  readonly stores: readonly RegisteredTaskStore[];
  readonly role: WorkflowModuleRole;
  readonly intake?: IntakeProjection;
  readonly definition: AnyWorkflowDefinition;
}

/**
 * Bind a compiled workflow to the exact stores its contracts resolve through.
 * `availableStores` is an inventory, not another authoring list: unused stores
 * are dropped and missing/exact-contract mismatches refuse by name.
 */
export function composeWorkflowModule<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
>(
  compiled: CompiledWorkflow<InputSchema, ResultSchema, Completion>,
  availableStores: readonly RegisteredTaskStore[],
): WorkflowModule<CompiledWorkflowDescriptor<InputSchema, ResultSchema, Completion>> {
  const workflowId = String(compiled.descriptor.id);
  if (COMPILED.get(compiled.definition) !== compiled) {
    throw new Error(`workflow ${workflowId} module does not use the compiled workflow of its own definition`);
  }
  const stores = compiled.storeNamespaces.map((namespace) => {
    const matchingStores = availableStores.filter((candidate) => String(candidate.namespace) === namespace);
    if (matchingStores.length === 0) {
      throw new Error(`workflow ${workflowId} requires missing store ${namespace}`);
    }
    if (matchingStores.length > 1) {
      throw new Error(`workflow ${workflowId} found duplicate stores for ${namespace}`);
    }
    const [store] = matchingStores;
    if (store === undefined) throw new Error(`workflow ${workflowId} lost store ${namespace}`);
    for (const contract of compiled.contracts.filter((candidate) => storeNamespace(candidate) === namespace)) {
      if (!Object.values(store.tasks).some((task) => task.contract === contract)) {
        throw new Error(`workflow ${workflowId} cannot resolve exact contract ${contract.id}`);
      }
    }
    return store;
  }).sort((left, right) => {
    if (left.kind === right.kind) return 0;
    return left.kind === "browser" ? -1 : 1;
  });
  const { definition } = compiled;
  return Object.freeze({
    descriptor: compiled.descriptor,
    stores: Object.freeze(stores),
    role: definition.role,
    ...(definition.intake === undefined ? {} : { intake: definition.intake }),
    definition,
  });
}

/** Registry/conformance seam: recover the exact definition that compiled a descriptor. */
export function workflowDefinitionOf(descriptor: object): AnyWorkflowDefinition | undefined {
  return DESCRIPTOR_DEFINITIONS.get(descriptor);
}
