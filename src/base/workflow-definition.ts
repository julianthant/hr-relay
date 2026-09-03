/**
 * D311/D315/D317 — the ONE workflow-authoring seam.
 *
 * A `WorkflowDefinition` is the reviewed source form of a workflow: identity
 * and presentation, typed input/result, and one ordered array of timeline
 * tuples `[group, entries[]]`. Tuple order is presentation order only; every
 * execution edge is derived from the typed references an entry declares. The
 * compiler is the only place those references become the runtime builder's
 * string node ids, so tuple order can never accidentally become execution
 * authority.
 *
 * The tuple's entries come from one CLOSED, EXPLICIT algebra (D315):
 * `task | parallel | delegate | gate | transaction`. The compiler may derive
 * edges from typed references, but it never infers whether an operation is
 * parallel, delegated, gated or transactional — each is an explicit entry
 * whose control policy the author writes down, and each entry and each
 * parallel leaf has a stable id.
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
import { DelegationEdgeIdSchema, WorkflowIdSchema } from "../domain/ids.js";
import type { ItemId } from "../domain/ids.js";
import type { NodeConditionSpec } from "../domain/workflow/node-condition.js";
import type { CompletionProgram } from "../domain/workflow/completion.js";
import { BUILD_MANIFEST, resolveWorkflowFingerprint } from "../domain/workflow/build-manifest.js";
import type { BuildManifest } from "../domain/workflow/build-manifest.js";
import { DelegationPolicySchema } from "../domain/workflow/delegation-policy.js";
import type { DelegationPolicy } from "../domain/workflow/delegation-policy.js";
import type { WorkflowModuleRole } from "../domain/workflow/module-role.js";
import { WorkflowModuleRoleSchema } from "../domain/workflow/module-role.js";
import {
  TimelineCategoryKeySchema,
  WorkflowStepSchema,
} from "../domain/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../domain/workflow/step-omission.js";
import type {
  AnyWorkflowRef,
  ChildRunOutcome,
  DelegationManifestRef,
  RuntimeFlowNode,
  TypedTransactionOutcome,
} from "../domain/workflow/graph.js";
import type { RetryPolicy } from "../domain/session.js";
import type { RegisteredTaskStore } from "./store.js";
import { flow } from "./flow.js";
import type { AnyNodeEntry, BuiltFlow, OperatorGateNodeFragment } from "./flow.js";
import { defineWorkflowDescriptor } from "./workflow.js";
import type {
  AnyWorkflowDescriptor,
  WorkflowDescriptor,
  WorkflowDescriptorSpec,
} from "./workflow.js";

/** The closed entry algebra (D315). */
export type WorkflowEntryKind = "task" | "parallel" | "delegate" | "gate" | "transaction";
const GROUP_OWNER = Symbol("workflow-group-owner");

export interface WorkflowTimelineGroup {
  readonly key: string;
  readonly label: string;
  readonly omission?: StepOmissionDeclaration;
  readonly [GROUP_OWNER]?: WorkflowTimelineGroup;
}

/**
 * One entry of a timeline tuple: a typed reusable value over an existing task
 * contract (or gate/transaction/parallel/delegate declaration) that appears in
 * exactly one tuple.
 */
export interface WorkflowEntry<
  Id extends string = string,
  Output = unknown,
  Conditional extends boolean = boolean,
> {
  readonly entryKind: "workflow-entry";
  readonly kind: WorkflowEntryKind;
  readonly id: Id;
  /** Exact D265 step object that owns a reusable identity, when one exists. */
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

/* ── entry identities — what an author (or a shared step identity value) writes ── */

type HasWhen<Identity> = "when" extends keyof Identity ? true : false;

/** A step-owned identity carries the exact D265 step object; an inline identity carries none. */
interface StepOwned {
  readonly step?: WorkflowTimelineGroup;
}

export interface TaskEntryIdentity<
  Id extends string = string,
  Contract extends AnyReadTaskContract = AnyReadTaskContract,
> extends StepOwned {
  readonly id: Id;
  readonly contract: Contract;
  readonly label?: string;
  readonly replay: "checkpoint" | "always-rerun";
  readonly when?: NodeConditionSpec;
}

export interface GateEntryIdentity<
  Id extends string = string,
  Result extends z.ZodType = z.ZodType,
> extends StepOwned {
  readonly id: Id;
  readonly label: string;
  readonly statusKey?: string;
  readonly result: Result;
  readonly when?: NodeConditionSpec;
}

export interface TransactionEntryIdentity<
  Id extends string = string,
  Prepare extends AnyPrepareTaskContract = AnyPrepareTaskContract,
  Commit extends AnyCommitTaskContract = AnyCommitTaskContract,
> extends StepOwned {
  readonly id: Id;
  readonly label?: string;
  readonly prepare: Prepare;
  readonly commit: Commit;
  readonly dryRun: "stop-after-prepare" | "unsupported";
  readonly probePolicy: "always" | "retries-and-recovery-only";
  readonly probeToFenceMaxMs: number;
  readonly retryBeforeFence?: RetryPolicy;
}

/**
 * D315 — a parallel entry declares its join and failure policy explicitly.
 * The runtime interprets `join: "all"` with `failure: "fail-fast"`: every leaf
 * checkpoints independently, so one failed leaf retries on the next attempt
 * while its successful siblings replay; `all-settled` remains a capability the
 * executor refuses by name, so the compiler refuses it before a run exists.
 */
export interface ParallelEntryIdentity<Id extends string = string> extends StepOwned {
  readonly id: Id;
  readonly label?: string;
  readonly join: "all" | "all-settled";
  readonly failure: "fail-fast";
}

export interface ParallelBranchDeclaration<
  Id extends string = string,
  Leaves extends readonly AnyWorkflowEntry[] = readonly AnyWorkflowEntry[],
> {
  readonly id: Id;
  readonly leaves: Leaves;
}

export type ParallelEntryOutput<Branches extends readonly ParallelBranchDeclaration[]> = Readonly<{
  join: "all";
  branches: Readonly<{ [Branch in Branches[number] as Branch["id"]]: readonly string[] }>;
}>;

/** D315 — a delegate entry names the existing typed child-run edge and its whole policy. */
export interface DelegateEntryIdentity<
  Id extends string = string,
  Target extends AnyWorkflowRef = AnyWorkflowRef,
> extends StepOwned {
  readonly id: Id;
  readonly label?: string;
  readonly target: Target;
  readonly edgeId: string;
  readonly cardinality: "one" | "many";
  readonly await: "none" | "terminal";
  readonly join: "one" | "all" | "all-settled" | "none";
  readonly policy: DelegationPolicy;
}

export type DelegateEntryOutput<
  Target extends AnyWorkflowRef,
  Identity extends { readonly await: "none" | "terminal"; readonly cardinality: "one" | "many" },
> = Identity["await"] extends "none"
  ? DelegationManifestRef
  : Identity["cardinality"] extends "one"
    ? ChildRunOutcome<Target>
    : readonly ChildRunOutcome<Target>[];

type GateConditional<Identity> = Identity extends OperatorGateNodeFragment<string, string, z.ZodType, infer C>
  ? C
  : HasWhen<Identity>;

/* ── runtime entry shapes (compiler-private) ─────────────────────────────── */

interface TaskEntry<Id extends string, Output, Conditional extends boolean>
  extends WorkflowEntry<Id, Output, Conditional> {
  readonly kind: "task";
  readonly contract: AnyReadTaskContract;
  readonly label?: string;
  readonly replay: "checkpoint" | "always-rerun";
  readonly when?: NodeConditionSpec;
  readonly bind: (scope: unknown) => unknown;
}

interface TransactionEntry<Id extends string, Output> extends WorkflowEntry<Id, Output, false> {
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

interface ParallelEntry<Id extends string, Output> extends WorkflowEntry<Id, Output, false> {
  readonly kind: "parallel";
  readonly label?: string;
  readonly join: "all";
  readonly failure: "fail-fast";
  readonly branches: readonly Readonly<{ id: string; leaves: readonly TaskEntry<string, unknown, boolean>[] }>[];
}

interface DelegateEntry<Id extends string, Output> extends WorkflowEntry<Id, Output, false> {
  readonly kind: "delegate";
  readonly label?: string;
  readonly target: AnyWorkflowRef;
  readonly edgeId: string;
  readonly cardinality: "one" | "many";
  readonly await: "none" | "terminal";
  readonly join: "one" | "all" | "all-settled" | "none";
  readonly policy: DelegationPolicy;
  readonly bind: (scope: unknown) => unknown;
  readonly deriveChildItemId: (input: unknown) => ItemId;
}

type RuntimeEntry =
  | TaskEntry<string, unknown, boolean>
  | TransactionEntry<string, unknown>
  | GateEntry<string, unknown, boolean>
  | ParallelEntry<string, unknown>
  | DelegateEntry<string, unknown>;

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

/* ── the author ──────────────────────────────────────────────────────────── */

export interface WorkflowAuthor<InputSchema extends z.ZodType> {
  /** D307/D313 — declare a group omittable, beside its own entries. */
  group(
    this: void,
    step: WorkflowTimelineGroup,
    options: Readonly<{ omission: StepOmissionDeclaration }>,
  ): WorkflowTimelineGroup;

  task<
    const Identity extends TaskEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    bind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Identity["contract"]["input"]>,
  ): WorkflowEntry<Identity["id"], z.output<Identity["contract"]["output"]>, HasWhen<Identity>>;

  gate<
    const Identity extends GateEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
  ): WorkflowEntry<Identity["id"], z.output<Identity["result"]>, GateConditional<Identity>>;

  transaction<
    const Identity extends TransactionEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    binds: Readonly<{
      prepareBind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Identity["prepare"]["input"]>;
      commitBind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Identity["commit"]["input"]>;
    }>,
  ): WorkflowEntry<Identity["id"], TypedTransactionOutcome<Identity["commit"]>, false>;

  parallel<
    const Identity extends ParallelEntryIdentity,
    const Branches extends readonly ParallelBranchDeclaration[],
  >(
    this: void,
    identity: Identity,
    branches: Branches,
  ): WorkflowEntry<Identity["id"], ParallelEntryOutput<Branches>, false>;

  delegate<
    const Identity extends DelegateEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    binds: Readonly<{
      bind: (scope: WorkflowEntryScope<InputSchema, References>) =>
        Identity["cardinality"] extends "one"
          ? z.input<Identity["target"]["input"]>
          : readonly z.input<Identity["target"]["input"]>[];
      deriveChildItemId: (input: z.output<Identity["target"]["input"]>) => ItemId;
    }>,
  ): WorkflowEntry<Identity["id"], DelegateEntryOutput<Identity["target"], Identity>, false>;

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

const PARALLEL_JOINS = new Set(["all", "all-settled"]);

function withStep(identity: StepOwned): { step?: WorkflowTimelineGroup } {
  return identity.step === undefined ? {} : { step: identity.step };
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
      identity: TaskEntryIdentity,
      references: readonly AnyWorkflowEntry[],
      bind: (scope: never) => unknown,
    ) {
      const entry: TaskEntry<string, unknown, boolean> = {
        entryKind: "workflow-entry",
        kind: "task",
        id: identity.id,
        ...withStep(identity),
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
    gate(
      identity: GateEntryIdentity,
      references: readonly AnyWorkflowEntry[],
    ) {
      const entry: GateEntry<string, unknown, boolean> = {
        entryKind: "workflow-entry",
        kind: "gate",
        id: identity.id,
        ...withStep(identity),
        references,
        contracts: Object.freeze([]),
        label: identity.label,
        ...(identity.statusKey === undefined ? {} : { statusKey: identity.statusKey }),
        result: identity.result,
        ...(identity.when === undefined ? {} : { when: identity.when }),
      };
      return Object.freeze(entry);
    },
    transaction(
      identity: TransactionEntryIdentity,
      references: readonly AnyWorkflowEntry[],
      binds: Readonly<{
        prepareBind: (scope: never) => unknown;
        commitBind: (scope: never) => unknown;
      }>,
    ) {
      if (!Number.isInteger(identity.probeToFenceMaxMs) || identity.probeToFenceMaxMs <= 0) {
        throw new Error(`transaction entry "${identity.id}" requires a positive integer probeToFenceMaxMs budget`);
      }
      const entry: TransactionEntry<string, unknown> = {
        entryKind: "workflow-entry",
        kind: "transaction",
        id: identity.id,
        ...withStep(identity),
        references,
        contracts: Object.freeze([identity.prepare, identity.commit]),
        prepareContract: identity.prepare,
        commitContract: identity.commit,
        ...(identity.label === undefined ? {} : { label: identity.label }),
        dryRun: identity.dryRun,
        probePolicy: identity.probePolicy,
        probeToFenceMaxMs: identity.probeToFenceMaxMs,
        ...(identity.retryBeforeFence === undefined ? {} : { retryBeforeFence: identity.retryBeforeFence }),
        prepareBind: (scope) => binds.prepareBind(scope as never),
        commitBind: (scope) => binds.commitBind(scope as never),
      };
      return Object.freeze(entry);
    },
    parallel(
      identity: ParallelEntryIdentity,
      branches: readonly ParallelBranchDeclaration[],
    ) {
      if (!PARALLEL_JOINS.has(identity.join)) {
        throw new Error(`parallel entry "${identity.id}" declares unknown join "${String(identity.join)}"`);
      }
      if (identity.join !== "all") {
        throw new Error(
          `parallel entry "${identity.id}" declares join "${identity.join}", which the run executor does not `
          + "interpret (capability-unavailable); declare join \"all\" or wait for the owning milestone",
        );
      }
      if (identity.failure !== "fail-fast") {
        throw new Error(
          `parallel entry "${identity.id}" declares failure policy "${String(identity.failure)}"; `
          + "the executor implements exactly \"fail-fast\" (each leaf checkpoints independently and retries alone)",
        );
      }
      if (branches.length < 2) {
        throw new Error(`parallel entry "${identity.id}" requires at least two branches`);
      }
      const branchIds = new Set<string>();
      const leafObjects = new Set<AnyWorkflowEntry>();
      const compiledBranches = branches.map((branch) => {
        if (branchIds.has(branch.id)) {
          throw new Error(`parallel entry "${identity.id}" repeats branch id "${branch.id}"`);
        }
        branchIds.add(branch.id);
        if (branch.leaves.length === 0) {
          throw new Error(`parallel entry "${identity.id}" branch "${branch.id}" runs no leaf`);
        }
        const leaves = branch.leaves.map((leaf) => {
          if (leaf.kind !== "task") {
            throw new Error(
              `parallel entry "${identity.id}" branch "${branch.id}" leaf "${leaf.id}" is a ${leaf.kind} entry; `
              + "a parallel leaf is a task entry with its own checkpoint",
            );
          }
          if (leafObjects.has(leaf)) {
            throw new Error(`parallel entry "${identity.id}" lists leaf "${leaf.id}" in more than one branch`);
          }
          leafObjects.add(leaf);
          return leaf as TaskEntry<string, unknown, boolean>;
        });
        return Object.freeze({ id: branch.id, leaves: Object.freeze(leaves) });
      });
      const entry: ParallelEntry<string, unknown> = {
        entryKind: "workflow-entry",
        kind: "parallel",
        id: identity.id,
        ...withStep(identity),
        references: Object.freeze([]),
        contracts: Object.freeze(compiledBranches.flatMap((branch) => branch.leaves.flatMap(({ contracts }) => contracts))),
        ...(identity.label === undefined ? {} : { label: identity.label }),
        join: "all",
        failure: "fail-fast",
        branches: Object.freeze(compiledBranches),
      };
      return Object.freeze(entry);
    },
    delegate(
      identity: DelegateEntryIdentity,
      references: readonly AnyWorkflowEntry[],
      binds: Readonly<{
        bind: (scope: never) => unknown;
        deriveChildItemId: (input: never) => ItemId;
      }>,
    ) {
      DelegationEdgeIdSchema.parse(identity.edgeId);
      DelegationPolicySchema.parse(identity.policy);
      const shape = `${identity.cardinality}/${identity.await}/${identity.join}`;
      const admitted = identity.await === "none"
        ? identity.join === "none"
        : identity.cardinality === "one"
          ? identity.join === "one"
          : identity.join === "all" || identity.join === "all-settled";
      if (!admitted) {
        throw new Error(
          `delegate entry "${identity.id}" declares cardinality/await/join ${shape}, which is not one of the `
          + "typed child-run shapes: one/terminal/one, many/terminal/all, many/terminal/all-settled, or */none/none",
        );
      }
      const entry: DelegateEntry<string, unknown> = {
        entryKind: "workflow-entry",
        kind: "delegate",
        id: identity.id,
        ...withStep(identity),
        references,
        contracts: Object.freeze([]),
        ...(identity.label === undefined ? {} : { label: identity.label }),
        target: identity.target,
        edgeId: identity.edgeId,
        cardinality: identity.cardinality,
        await: identity.await,
        join: identity.join,
        policy: identity.policy,
        bind: (scope) => binds.bind(scope as never),
        deriveChildItemId: (input) => binds.deriveChildItemId(input as never),
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

/* ── validation ──────────────────────────────────────────────────────────── */

function entryName(entry: AnyWorkflowEntry): string {
  return `workflow entry "${entry.id}"`;
}

function isParallel(entry: AnyWorkflowEntry): entry is ParallelEntry<string, unknown> {
  return entry.kind === "parallel";
}

/** Every entry the tuples own, with a parallel's leaves beside their parent. */
function flattenEntries(steps: readonly WorkflowTimelineTuple[]): readonly AnyWorkflowEntry[] {
  return steps.flatMap(([, members]) => members.flatMap((entry) =>
    isParallel(entry) ? [entry, ...entry.branches.flatMap((branch) => branch.leaves)] : [entry]));
}

function validateSteps(
  id: string,
  steps: readonly WorkflowTimelineTuple[],
  resultReferences: readonly AnyWorkflowEntry[],
): void {
  if (steps.length === 0) throw new Error(`workflow ${id} requires at least one timeline group`);
  const entries = flattenEntries(steps);
  if (entries.length === 0) throw new Error(`workflow ${id} requires at least one entry`);

  const groupKeys = new Set<string>();
  const groupLabels = new Set<string>();
  const entryObjects = new Set<AnyWorkflowEntry>();
  const entryIds = new Set<string>();
  const leafParents = new Map<AnyWorkflowEntry, string>();
  for (const [group, members] of steps) {
    const parsed = WorkflowStepSchema.parse({ key: group.key, label: group.label });
    TimelineCategoryKeySchema.parse(parsed.key);
    if (groupKeys.has(parsed.key)) throw new Error(`workflow ${id} repeats timeline group key "${parsed.key}"`);
    if (groupLabels.has(parsed.label)) throw new Error(`workflow ${id} repeats timeline group label "${parsed.label}"`);
    groupKeys.add(parsed.key);
    groupLabels.add(parsed.label);
    if (members.length === 0) throw new Error(`workflow ${id} timeline group "${parsed.key}" has no entries`);
    const groupOwner = group[GROUP_OWNER] ?? group;
    const admit = (entry: AnyWorkflowEntry): void => {
      if (entry.step !== undefined && entry.step !== groupOwner) {
        const sameKeyDifferentObject = entry.step.key === parsed.key
          ? `; same key but distinct step objects: "${parsed.label}" and "${entry.step.label}"`
          : "";
        throw new Error(
          `timeline group "${parsed.key}" claims ${entryName(entry)}, which belongs to step "${entry.step.key}"${sameKeyDifferentObject}`,
        );
      }
      if (entryObjects.has(entry)) {
        const parent = leafParents.get(entry);
        throw new Error(parent === undefined
          ? `${entryName(entry)} appears in more than one timeline tuple`
          : `${entryName(entry)} is a leaf of parallel entry "${parent}" and may not also appear in a timeline tuple`);
      }
      if (entryIds.has(entry.id)) throw new Error(`workflow ${id} declares entry id "${entry.id}" more than once`);
      entryObjects.add(entry);
      entryIds.add(entry.id);
    };
    for (const entry of members) {
      if (isParallel(entry)) {
        for (const branch of entry.branches) {
          for (const leaf of branch.leaves) leafParents.set(leaf, entry.id);
        }
      }
    }
    for (const entry of members) {
      admit(entry);
      if (isParallel(entry)) {
        for (const branch of entry.branches) for (const leaf of branch.leaves) admit(leaf);
      }
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
  for (const entry of flattenEntries(authored.steps)) Object.freeze(entry.references);
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

/* ── compilation ─────────────────────────────────────────────────────────── */

/** Every runtime node an entry compiles to, in the order the timeline names them. */
function entryNodeIds(entry: AnyWorkflowEntry): readonly string[] {
  return isParallel(entry)
    ? [entry.id, ...entry.branches.flatMap((branch) => branch.leaves.map((leaf) => leaf.id))]
    : [entry.id];
}

function topologicalEntries(definition: AnyWorkflowDefinition): readonly RuntimeEntry[] {
  const entries = flattenEntries(definition.steps) as unknown as readonly RuntimeEntry[];
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
  parallel(
    id: string,
    branches: readonly Readonly<{ id: string; nodes: readonly string[] }>[],
    opts: Readonly<{ join: "all" | "all-settled" }>,
  ): RuntimeFlowBuilder;
  childRun(id: string, target: AnyWorkflowRef, opts: Readonly<{
    label?: string;
    dependsOn: readonly string[];
    edgeId: string;
    cardinality: "one" | "many";
    bind: (scope: unknown) => unknown;
    deriveChildItemId: (input: unknown) => ItemId;
    await: "none" | "terminal";
    join: "one" | "all" | "all-settled" | "none";
    policy: DelegationPolicy;
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
  // A leaf's parallel node must be declared before the leaf (the builder's
  // downstream check); the parallel entry itself has no references, so it is
  // emitted lazily — immediately before its first leaf in dependency order.
  const parallelOf = new Map<AnyWorkflowEntry, ParallelEntry<string, unknown>>();
  for (const entry of flattenEntries(definition.steps)) {
    if (!isParallel(entry)) continue;
    for (const branch of entry.branches) for (const leaf of branch.leaves) parallelOf.set(leaf, entry);
  }
  const emittedParallels = new Set<ParallelEntry<string, unknown>>();
  const emitParallel = (entry: ParallelEntry<string, unknown>): void => {
    if (emittedParallels.has(entry)) return;
    emittedParallels.add(entry);
    builder.parallel(
      entry.id,
      entry.branches.map((branch) => ({ id: branch.id, nodes: branch.leaves.map((leaf) => leaf.id) })),
      { join: entry.join },
    );
  };
  for (const entry of topologicalEntries(definition)) {
    const dependsOn = Object.freeze(entry.references.map(({ id }) => id));
    if (entry.kind === "parallel") continue;
    const parent = parallelOf.get(entry);
    if (parent !== undefined) emitParallel(parent);
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
    if (entry.kind === "delegate") {
      builder.childRun(entry.id, entry.target, {
        ...(entry.label === undefined ? {} : { label: entry.label }),
        dependsOn,
        edgeId: entry.edgeId,
        cardinality: entry.cardinality,
        bind: entry.bind,
        deriveChildItemId: entry.deriveChildItemId,
        await: entry.await,
        join: entry.join,
        policy: entry.policy,
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

function defaultEntryLabel(entry: RuntimeEntry): string | undefined {
  switch (entry.kind) {
    case "task": return entry.label ?? entry.contract.title;
    case "transaction": return entry.label ?? entry.commitContract.title;
    case "gate": return entry.label;
    case "parallel":
    case "delegate":
      return undefined;
  }
}

/**
 * Compile a definition through the existing descriptor factory and runtime.
 * Compilation is memoized per definition object, so the descriptor's identity
 * is stable across every consumer — the composition root, the bundle-safe
 * descriptor tuple and every test read the same object.
 */
export interface CompileWorkflowOptions {
  /**
   * The build manifest that owns this workflow's contract fingerprint. Defaults
   * to the checked-in manifest; a test fixture that is not a registered
   * workflow supplies a manifest naming itself. It is never an authoring input.
   */
  readonly manifest?: BuildManifest;
}

export function compileWorkflow<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
>(
  definition: WorkflowDefinition<InputSchema, ResultSchema, Completion>,
  options: CompileWorkflowOptions = {},
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
  void result;
  const timeline = steps.map(([group, entries]) => ({
    key: group.key,
    label: group.label,
    nodes: entries.flatMap(entryNodeIds),
    ...(group.omission === undefined ? {} : { omission: group.omission }),
  }));
  const usesDefaultTimeline = steps.every(([group, entries]) => {
    const [entry] = entries as readonly RuntimeEntry[];
    if (entry === undefined || entries.length !== 1 || group.omission !== undefined) return false;
    const label = defaultEntryLabel(entry);
    return label !== undefined && group.key === entry.id && group.label === label;
  });
  const descriptor = defineWorkflowDescriptor({
    ...presentation,
    contractFingerprint: resolveWorkflowFingerprint(options.manifest ?? BUILD_MANIFEST, WorkflowIdSchema.parse(definition.id)),
    flow: compileFlow(definition),
    ...(usesDefaultTimeline ? {} : { timeline }),
  });
  const contracts = Object.freeze(flattenEntries(steps).flatMap(({ contracts: owned }) => owned));
  const compiled: CompiledWorkflow<InputSchema, ResultSchema, Completion> = Object.freeze({
    kind: "compiled-workflow",
    definition,
    descriptor,
    contracts,
    storeNamespaces: Object.freeze([...new Set(contracts.map(storeNamespace))]),
  });
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

/** Registry-wide conformance seam: the entry kinds a definition uses, closed and explicit. */
export function workflowEntryKinds(definition: AnyWorkflowDefinition): readonly WorkflowEntryKind[] {
  return Object.freeze([...new Set(flattenEntries(definition.steps).map(({ kind }) => kind))]);
}
