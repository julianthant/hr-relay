import { WorkflowStepReviewSchema, type WorkflowStepReview } from "../models/workflow/review-spec.js";
import { assertSchemaOffersCollectionPath } from "../models/validation/contract-boundary.js";
import { deepFreeze } from "../rules/validation/immutability.js";
import type { StableRecordId } from "../rules/identity/ids.js";
import type { DryRunBinding, DryRunScope } from "../models/workflow/dry-run.js";
import type { ProtectedInputBinding } from "../models/write-safety/protected-input.js";
/** The ONE workflow-authoring seam. A `WorkflowDefinition` is ordered `[group, entries[]]` tuples whose order is presentation only; execution edges come from typed references the compiler resolves. */
import { z } from "zod";
import type { IntakeProjection } from "../models/intake/projection.js";
import type { RetryPolicy } from "../models/sessions/session.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
} from "../models/task/task-contract.js";
import type { CompletionProgram } from "../models/workflow/completion.js";
import type { ChildVisibility, DelegationPolicy } from "../models/workflow/delegation-policy.js";
import { DelegationPolicySchema } from "../models/workflow/delegation-policy.js";
import type {
  AnyWorkflowRef,
  ChildRunIdentityContext,
  ChildRunOutcome,
  DelegationManifestRef,
  RuntimeFlowNode,
  TypedTransactionOutcome,
} from "../models/workflow/graph.js";
import type { NodeConditionSpec } from "../models/workflow/node-condition.js";
import {
  TimelineCategoryKeySchema,
  type WorkflowOperatorField,
  WorkflowStepSchema,
} from "../models/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../models/workflow/step-omission.js";
import type { ItemId } from "../rules/identity/ids.js";
import { BrowserSystemIdSchema, DelegationEdgeIdSchema, WorkflowIdSchema } from "../rules/identity/ids.js";
import type { AnyNodeEntry, BuiltFlow } from "./flow.js";
import { flow } from "./flow.js";
import type { RegisteredTaskStore } from "./task-registry.js";
import { workflowContractFingerprint } from "./fingerprints.js";
import type { WorkflowModuleRole } from "./validation/module-role.js";
import { WorkflowModuleRoleSchema } from "./validation/module-role.js";
import type {
  AnyWorkflowDescriptor,
  WorkflowDescriptor,
  WorkflowDescriptorSpec,
} from "./workflow.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes, parseWorkbookRequirement } from "./workflow.js";

/** The closed entry algebra. */
export type WorkflowEntryKind = "task" | "parallel" | "delegate" | "gate" | "transaction" | "branch";
const GROUP_OWNER = Symbol("workflow-group-owner");

export interface WorkflowTimelineGroup {
  readonly description?: string;
  readonly review?: WorkflowStepReview;
  readonly operatorFields?: readonly WorkflowOperatorField[];
  readonly system?: z.input<typeof BrowserSystemIdSchema> | "local";
  readonly key: string;
  readonly label: string;
  readonly omission?: StepOmissionDeclaration;
  readonly selection?: Readonly<{ inputField: string; selectedWhen: boolean }>;
  readonly [GROUP_OWNER]?: WorkflowTimelineGroup;
}

export type WorkflowGroupOptions = Readonly<Partial<Pick<WorkflowTimelineGroup, "omission" | "description" | "system" | "operatorFields" | "review">>>;

/** One timeline-tuple entry: a typed reusable value over an existing contract (or gate/transaction/parallel/delegate declaration), in exactly one tuple. */
export interface WorkflowEntry<
  Id extends string = string,
  Output = unknown,
  Conditional extends boolean = boolean,
> {
  readonly entryKind: "workflow-entry";
  readonly kind: WorkflowEntryKind;
  readonly id: Id;
  /** Exact step object that owns a reusable identity, when one exists. */
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
  readonly dryRun?: DryRunScope;
  readonly protectedInputBindings?: readonly ProtectedInputBinding[];
  readonly outputs: EntryOutputs<References>;
}

/* ── entry identities — what an author (or a shared step identity value) writes ── */

type HasWhen<Identity> = "when" extends keyof Identity ? true : false;

/** A step-owned identity carries the exact step object; an inline identity carries none. */
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
  readonly dryRun?: "stop-before-publish";
}

export interface BranchEntryIdentity<
  Id extends string = string,
  Cases extends Readonly<Record<string, readonly string[]>> = Readonly<Record<string, readonly string[]>>,
> extends StepOwned {
  readonly id: Id;
  readonly label?: string;
  readonly cases: Cases;
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

/** A parallel entry declares its join and failure policy; `join:"all"` +
 *  `failure:"fail-fast"` retries one leaf while siblings replay, and `all-settled` is refused by name. */
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

/** A delegate entry names the existing typed child-run edge and its whole policy. */
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
  readonly policy: Omit<DelegationPolicy, "visibility"> & { readonly visibility?: ChildVisibility };
}

export type DelegateEntryOutput<
  Target extends AnyWorkflowRef,
  Identity extends { readonly await: "none" | "terminal"; readonly cardinality: "one" | "many" },
> = Identity["await"] extends "none"
  ? DelegationManifestRef
  : Identity["cardinality"] extends "one"
    ? ChildRunOutcome<Target>
    : readonly ChildRunOutcome<Target>[];

type GateConditional<Identity> = HasWhen<Identity>;

/* ── runtime entry shapes (compiler-private) ─────────────────────────────── */

interface TaskEntry<Id extends string, Output, Conditional extends boolean>
  extends WorkflowEntry<Id, Output, Conditional> {
  readonly kind: "task";
  readonly contract: AnyReadTaskContract;
  readonly label?: string;
  readonly replay: "checkpoint" | "always-rerun";
  readonly when?: NodeConditionSpec;
  readonly dryRun?: "stop-before-publish";
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
  readonly previewBind?: (scope: unknown) => DryRunBinding | undefined;
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
  readonly branches: readonly Readonly<{ id: string; leaves: readonly (TaskEntry<string, unknown, boolean> | DelegateEntry<string, unknown>)[] }>[];
}

interface DelegateEntry<Id extends string, Output> extends WorkflowEntry<Id, Output, false> {
  readonly kind: "delegate";
  readonly sourceRecordIds?: (scope: unknown) => readonly (readonly StableRecordId[])[];
  readonly label?: string;
  readonly target: AnyWorkflowRef;
  readonly edgeId: string;
  readonly cardinality: "one" | "many";
  readonly await: "none" | "terminal";
  readonly join: "one" | "all" | "all-settled" | "none";
  readonly policy: DelegationPolicy;
  readonly bind: (scope: unknown) => unknown;
  readonly deriveChildItemId: (input: unknown, context: ChildRunIdentityContext) => ItemId;
}

interface BranchEntry extends WorkflowEntry<string, { readonly selected: string }, false> {
  readonly kind: "branch";
  readonly label?: string;
  readonly cases: Readonly<Record<string, readonly string[]>>;
  readonly choose: (scope: unknown) => string;
}

type RuntimeEntry =
  | BranchEntry
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
  /** Add a composition's own group facts (omission, operator text and fields) to a step, beside its own entries. */
  group(
    this: void,
    step: WorkflowTimelineGroup,
    options: WorkflowGroupOptions,
  ): WorkflowTimelineGroup;

  branch<
    const Identity extends BranchEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    choose: (scope: WorkflowEntryScope<InputSchema, References>) => keyof Identity["cases"] & string,
  ): WorkflowEntry<Identity["id"], { readonly selected: keyof Identity["cases"] & string }, false>;

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
      previewBind?: (scope: WorkflowEntryScope<InputSchema, References>) => DryRunBinding | undefined;
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
      sourceRecordIds?: (scope: WorkflowEntryScope<InputSchema, References>) => readonly (readonly StableRecordId[])[];
      bind: (scope: WorkflowEntryScope<InputSchema, References>) =>
        Identity["cardinality"] extends "one"
          ? z.input<Identity["target"]["input"]>
          : readonly z.input<Identity["target"]["input"]>[];
      deriveChildItemId: (input: z.output<Identity["target"]["input"]>, context: ChildRunIdentityContext) => ItemId;
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

function workflowAuthor<InputSchema extends z.ZodType>(delegationDisplay: ChildVisibility = "inline"): WorkflowAuthor<InputSchema> {
  const author = {
    group(step: WorkflowTimelineGroup, options: WorkflowGroupOptions) {
      return Object.freeze({ ...step, ...options, key: step.key, label: step.label, [GROUP_OWNER]: step });
    },
    branch(
      identity: BranchEntryIdentity,
      references: readonly AnyWorkflowEntry[],
      choose: (scope: never) => string,
    ) {
      const entry: BranchEntry = {
        entryKind: "workflow-entry", kind: "branch", id: identity.id, ...withStep(identity),
        references, contracts: Object.freeze([]), cases: identity.cases,
        ...(identity.label === undefined ? {} : { label: identity.label }),
        choose: scope => choose(scope as never),
      };
      return Object.freeze(entry);
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
        ...(identity.dryRun === undefined ? {} : { dryRun: identity.dryRun }),
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
        previewBind?: (scope: never) => DryRunBinding | undefined;
        prepareBind: (scope: never) => unknown;
        commitBind: (scope: never) => unknown;
      }>,
    ) {
      if (!Number.isInteger(identity.probeToFenceMaxMs) || identity.probeToFenceMaxMs <= 0) {
        throw new Error(`transaction entry "${identity.id}" requires a positive integer probeToFenceMaxMs budget`);
      }
      const previewBind = binds.previewBind;
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
        ...(previewBind === undefined ? {} : { previewBind: (scope: unknown) => previewBind(scope as never) }),
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
          if (leaf.kind !== "task" && leaf.kind !== "delegate") {
            throw new Error(
              `parallel entry "${identity.id}" branch "${branch.id}" leaf "${leaf.id}" is a ${leaf.kind} entry; `
              + "a parallel leaf is a task or delegate entry with its own evidence",
            );
          }
          if (leafObjects.has(leaf)) {
            throw new Error(`parallel entry "${identity.id}" lists leaf "${leaf.id}" in more than one branch`);
          }
          leafObjects.add(leaf);
          return leaf as TaskEntry<string, unknown, boolean> | DelegateEntry<string, unknown>;
        });
        return Object.freeze({ id: branch.id, leaves: Object.freeze(leaves) });
      });
      const hasDelegates = compiledBranches.some(branch => branch.leaves.some(leaf => leaf.kind === "delegate"));
      if (hasDelegates && compiledBranches.some(branch => branch.leaves.some(leaf => leaf.references.some(reference => leafObjects.has(reference))))) {
        throw new Error(`parallel entry "${identity.id}" with delegates cannot depend on a sibling leaf; declare that work sequentially`);
      }
      const references = hasDelegates ? [...new Set(compiledBranches.flatMap(branch => branch.leaves.flatMap(leaf => leaf.references)))] : [];
      const entry: ParallelEntry<string, unknown> = {
        entryKind: "workflow-entry",
        kind: "parallel",
        id: identity.id,
        ...withStep(identity),
        references: Object.freeze(references),
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
        sourceRecordIds?: (scope: never) => readonly (readonly StableRecordId[])[];
        deriveChildItemId: (input: never, context: ChildRunIdentityContext) => ItemId;
      }>,
    ) {
      DelegationEdgeIdSchema.parse(identity.edgeId);
      const policy = DelegationPolicySchema.parse({ ...identity.policy,
        visibility: identity.policy.visibility === undefined ? delegationDisplay : identity.policy.visibility });
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
      const sourceRecordIds = binds.sourceRecordIds;
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
        policy,
        bind: (scope) => binds.bind(scope as never),
        ...(sourceRecordIds === undefined ? {} : { sourceRecordIds: (scope: unknown) => sourceRecordIds(scope as never) }),
        deriveChildItemId: (input, context) => binds.deriveChildItemId(input as never, context),
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
  validateOmissions(id, steps);

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

// Omission rebuilds only tasks; mandatory verifiers remain outside the omitted step.
function validateOmissions(id: string, steps: readonly WorkflowTimelineTuple[]): void {
  const memberGroup = new Map<AnyWorkflowEntry, WorkflowTimelineGroup>();
  for (const [group, members] of steps) {
    for (const entry of members) {
      memberGroup.set(entry, group);
      if (isParallel(entry)) {
        for (const branch of entry.branches) for (const leaf of branch.leaves) memberGroup.set(leaf, group);
      }
    }
  }
  for (const [group, members] of steps) {
    const omission = group.omission;
    if (omission === undefined) continue;
    const memberById = new Map<string, AnyWorkflowEntry>();
    for (const entry of members) {
      memberById.set(entry.id, entry);
      if (isParallel(entry)) {
        for (const branch of entry.branches) for (const leaf of branch.leaves) memberById.set(leaf.id, leaf);
      }
    }
    for (const producedId of Object.keys(omission.produces)) {
      const produced = memberById.get(producedId);
      if (produced === undefined) {
        throw new Error(
          `workflow ${id} step "${group.key}" omission produces "${producedId}", which is not an entry of that step`,
        );
      }
      if (produced.kind !== "task") {
        throw new Error(
          `workflow ${id} step "${group.key}" omission produces "${producedId}", which is a ${produced.kind} entry; `
          + "only task entries are ever rebuilt from operator facts",
        );
      }
    }
    for (const [reader, readerGroup] of memberGroup) {
      if (readerGroup === group) continue;
      for (const reference of reader.references) {
        if (memberGroup.get(reference) !== group) continue;
        if (reference.kind === "task" && Object.hasOwn(omission.produces, reference.id)) continue;
        throw new Error(
          `workflow ${id} step "${group.key}" is omittable, but ${entryName(reader)} in step "${readerGroup.key}" reads its `
          + `${reference.kind} entry "${reference.id}", which omitting the step leaves unread; rebuild "${reference.id}" `
          + "from the step's omission form, move the reader into the step, or declare the check as its own entry "
          + "outside the omitted step",
        );
      }
    }
  }
}

type CompiledState = Readonly<Record<string, AnyNodeEntry>>;
type CompiledFlow<InputSchema extends z.ZodType, ResultSchema extends z.ZodType> = BuiltFlow<
  InputSchema,
  ResultSchema,
  readonly RuntimeFlowNode[],
  CompiledState,
  readonly string[]
>;

/** The authored presentation half of a definition: every descriptor field an author writes, minus the compiler-derived products (`flow`, `timeline`, `contractFingerprint`). */
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
  /** What this workflow IS to the composition root. */
  readonly role: WorkflowModuleRole;
  /** Ref data-intake-and-edit-data — the spreadsheet-capable declaration, when one exists. */
  readonly intake?: IntakeProjection;
    /** The graph, authored through the typed author so each entry's input/output binds to THIS
     *  input schema; returns the ordered timeline tuples and the terminal result declaration. */
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
  readonly requiredWorkbookFields: readonly string[];
  readonly workbookReference?: WorkflowDefinitionPresentation<InputSchema, ResultSchema, Completion>["workbookReference"];
  readonly input: InputSchema;
  readonly role: WorkflowModuleRole;
  readonly intake?: IntakeProjection;
  readonly steps: readonly WorkflowTimelineTuple[];
  readonly result: WorkflowResultDeclaration<InputSchema, ResultSchema>;
}

export type AnyWorkflowDefinition = WorkflowDefinition<z.ZodType, z.ZodType, CompletionProgram | undefined>;

export type StepProofSpec<Input extends z.ZodType, Result extends z.ZodType> = Omit<WorkflowDefinitionSpec<Input, Result>, "id" | "role">;

/** A workflow-owned call retains the driver's exact contract, store and provenance policy. */
export function reuseTask<const Identity extends TaskEntryIdentity, Input>(
  step: WorkflowTimelineGroup,
  identity: Identity,
  bind: (input: Input) => z.input<Identity["contract"]["input"]>,
) {
  return Object.freeze({
    identity: Object.freeze({ ...identity, step }),
    bind: ({ input }: Readonly<{ input: Input }>) => bind(input),
  });
}

export function defineStep<const Spec extends {
  readonly group: WorkflowTimelineGroup;
  readonly proof: { readonly id: string; readonly order: number };
}>(spec: Spec): Readonly<Spec> {
  return Object.freeze(spec);
}

export function inheritStepProof<Input extends z.ZodType>(parent: WorkflowDefinition<Input>) {
  return {
    requiredWorkbookFields: parent.requiredWorkbookFields,
    ...(parent.workbookReference === undefined ? {} : { workbookReference: parent.workbookReference }),
    ...(parent.referenceKeys === undefined ? {} : { referenceKeys: parent.referenceKeys }),
    version: 1,
    icon: parent.icon,
    category: parent.category,
    input: parent.input,
    canonicalInput: parent.canonicalInput,
    inputSubject: parent.inputSubject,
    surface: { shape: "single" as const },
    enqueue: parent.enqueue,
    actions: parent.actions,
    surfaces: parent.surfaces,
    verdicts: [],
    details: [],
    identity: parent.identity,
    presentation: parent.presentation,
    scenarios: parent.scenarios,
  };
}

export function defineStepProof<
  Parent extends AnyWorkflowDefinition,
  Input extends z.ZodType,
  Result extends z.ZodType,
>(parent: Parent, step: Readonly<{
  group: WorkflowTimelineGroup;
  proof: Readonly<{
    id: string;
    order: number;
    build: (parent: Parent) => StepProofSpec<Input, Result>;
  }>;
}>) {
  const spec = step.proof.build(parent);
  const authored = spec.steps(workflowAuthor<Input>());
  const nodeIds = new Set(flattenEntries(authored.steps).flatMap(entryNodeIds));
  const definition = defineWorkflow({
    ...spec,
    id: step.proof.id,
    role: { kind: "chunk-harness", of: WorkflowIdSchema.parse(parent.id), step: step.group.key },
    nodePurposes: spec.nodePurposes ?? parent.nodePurposes?.filter(({ nodeId }) => nodeIds.has(nodeId)),
    steps: () => authored,
  });
  return Object.freeze({ definition, order: step.proof.order });
}

/** Define one immutable workflow. The `steps` callback only binds each entry's input/output types to this workflow's input schema; the returned tuples stay the grouping/order authority. */
export function defineWorkflow<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined = undefined,
>(
  spec: WorkflowDefinitionSpec<InputSchema, ResultSchema, Completion>,
): WorkflowDefinition<InputSchema, ResultSchema, Completion> {
  const id = WorkflowIdSchema.parse(spec.id);
  WorkflowModuleRoleSchema.parse(spec.role);
  const { requiredWorkbookFields, workbookReference } = parseWorkbookRequirement(spec.requiredWorkbookFields, spec.workbookReference);
  const { steps: authorSteps, input, role, intake, ...presentation } = spec;
  const authored = authorSteps(workflowAuthor<InputSchema>(spec.capabilities?.delegationDisplay));
  validateSteps(id, authored.steps, authored.result.references);

  for (const entry of flattenEntries(authored.steps)) Object.freeze(entry.references);
  Object.freeze(authored.result.references);
  return Object.freeze({
    ...presentation,
    requiredWorkbookFields,
    ...(workbookReference === undefined ? {} : { workbookReference }),
    kind: "workflow-definition",
    input,
    role,
    ...(intake === undefined ? {} : { intake }),
    steps: Object.freeze(authored.steps.map(([group, entries]) => Object.freeze([
      Object.freeze(Object.defineProperty({ ...group,
        ...(group.review === undefined ? {} : { review: deepFreeze(WorkflowStepReviewSchema.parse(group.review)) }),
      }, GROUP_OWNER, {
        value: group[GROUP_OWNER] ?? group, enumerable: false,
      })),
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

function topologicalEntries(definition: AnyWorkflowDefinition, parallelOf: ReadonlyMap<AnyWorkflowEntry, ParallelEntry<string, unknown>>): readonly RuntimeEntry[] {
  const entries = flattenEntries(definition.steps) as unknown as readonly RuntimeEntry[];
  const ordered: RuntimeEntry[] = [];
  const remaining = new Set(entries);
  while (remaining.size > 0) {
    const ready = entries.find((entry) =>
      remaining.has(entry)
      && [...entry.references, ...(parallelOf.get(entry)?.references ?? [])].every((reference) => !remaining.has(reference as RuntimeEntry)));
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
    dryRun?: "stop-before-publish";
  }>): RuntimeFlowBuilder;
  branch(id: string, opts: Readonly<{
    label?: string;
    dependsOn: readonly string[];
    cases: Readonly<Record<string, readonly string[]>>;
    choose: (scope: unknown) => string;
  }>): RuntimeFlowBuilder;
  transaction(id: string, pair: Readonly<{
    label?: string;
    dependsOn: readonly string[];
    previewBind?: (scope: unknown) => DryRunBinding | undefined;
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
    opts: Readonly<{ join: "all" | "all-settled"; dependsOn?: readonly string[] }>,
  ): RuntimeFlowBuilder;
  childRun(id: string, target: AnyWorkflowRef, opts: Readonly<{
    label?: string;
    dependsOn: readonly string[];
    edgeId: string;
    cardinality: "one" | "many";
    bind: (scope: unknown) => unknown;
    sourceRecordIds?: (scope: unknown) => readonly (readonly StableRecordId[])[];
    deriveChildItemId: (input: unknown, context: ChildRunIdentityContext) => ItemId;
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
      { join: entry.join, dependsOn: entry.references.map(reference => reference.id) },
    );
  };
  for (const entry of topologicalEntries(definition, parallelOf)) {
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
        ...(entry.dryRun === undefined ? {} : { dryRun: entry.dryRun }),
      });
      continue;
    }
    if (entry.kind === "branch") {
      builder.branch(entry.id, { dependsOn, cases: entry.cases, choose: entry.choose,
        ...(entry.label === undefined ? {} : { label: entry.label }) });
      continue;
    }
    if (entry.kind === "transaction") {
      builder.transaction(entry.id, {
        ...(entry.label === undefined ? {} : { label: entry.label }),
        dependsOn,
        prepare: { uses: entry.prepareContract, bind: entry.prepareBind },
        ...(entry.previewBind === undefined ? {} : { previewBind: entry.previewBind }),
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
        ...(entry.sourceRecordIds === undefined ? {} : { sourceRecordIds: entry.sourceRecordIds }),
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

/** The generated executable representation of one definition: the descriptor every projection
 *  consumes, plus the contract set and store namespaces the composition root resolves. */
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
    case "branch":
      return undefined;
  }
}

/** Compile a definition through the descriptor factory and runtime; memoized per definition object, so the composition root, the descriptor tuple and every test read the same object. */
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
  void result;
  const timeline = steps.map(([group, entries]) => ({
    key: group.key,
    label: group.label,
    ...(group.description === undefined ? {} : { description: group.description }),
    ...(group.system === undefined ? {} : { system: group.system }),
    nodes: entries.flatMap(entryNodeIds),
    ...(group.operatorFields === undefined ? {} : { operatorFields: group.operatorFields }),
    ...(group.selection === undefined ? {} : { selection: group.selection }),
    ...(group.omission === undefined ? {} : { omission: group.omission }),
  }));
  const usesDefaultTimeline = steps.every(([group, entries]) => {
    const [entry] = entries as readonly RuntimeEntry[];
    if (entry === undefined || entries.length !== 1 || group.omission !== undefined || group.selection !== undefined || group.operatorFields !== undefined || group.system !== undefined || group.description !== undefined) return false;
    const label = defaultEntryLabel(entry);
    return label !== undefined && group.key === entry.id && group.label === label;
  });
  const contracts = Object.freeze(flattenEntries(steps).flatMap(({ contracts: owned }) => owned));
  const descriptor = defineWorkflowDescriptor({
    ...presentation,
    contractFingerprint: workflowContractFingerprint({
      id: String(definition.id),
      version: definition.version,
      input: definition.input,
      canonicalInput: definition.canonicalInput,
      result: definition.result.schema,
      graph: (flattenEntries(steps) as readonly RuntimeEntry[]).map((entry) => ({ id: entry.id, kind: entry.kind, dependsOn: entry.references.map(({ id }) => id) })),
      contracts,
      requiredWorkbookFields: definition.requiredWorkbookFields,
      workbookReference: definition.workbookReference,
    }),
    flow: compileFlow(definition),
    ...(usesDefaultTimeline ? {} : { timeline }),
  });
  for (const [group] of steps) {
    if (group.review === undefined) continue;
    const review = WorkflowStepReviewSchema.parse(group.review);
    const members = descriptor.timeline.find(candidate => candidate.key === group.key);
    if (members === undefined) throw new Error(`workflow ${definition.id} review names unknown step ${group.key}`);
    const ownIds = new Set(members.nodes.map(node => String(node.id)));
    const ownNodes = descriptorRuntimeNodes(descriptor).filter(node => ownIds.has(String(node.id)));
    const assertOwnNode = (nodeId: string): void => {
      if (!ownIds.has(nodeId)) throw new Error(`workflow ${definition.id} review step ${group.key} names unknown or outside node ${nodeId}`);
    };
    const assertUnique = (values: readonly string[], subject: string): void => {
      if (new Set(values).size !== values.length) throw new Error(`workflow ${definition.id} review step ${group.key} repeats ${subject}`);
    };
    const assertRead = (read: { stepKey: string; page: string; field: string } | undefined): void => {
      if (read === undefined) return;
      const target = steps.find(([candidate]) => candidate.key === read.stepKey)?.[0];
      if (target === undefined) throw new Error(`workflow ${definition.id} review source names unknown step ${read.stepKey}`);
      const pages = target.review?.pages.filter(page => page.title === read.page) ?? [];
      const [page] = pages;
      if (pages.length !== 1 || page === undefined) throw new Error(`workflow ${definition.id} review source names unknown or ambiguous page ${read.stepKey}/${read.page}`);
      if (page.fields.filter(field => ("operatorField" in field ? field.operatorField : field.label) === read.field).length !== 1) {
        throw new Error(`workflow ${definition.id} review source names unknown or ambiguous field ${read.stepKey}/${read.page}/${read.field}`);
      }
    };
    assertUnique(review.pages.map(page => page.id), "page id");
    assertUnique(review.pages.flatMap(page => page.fields.map(field => field.id)), "field id");
    for (const page of review.pages) {
      page.nodeIds.forEach(assertOwnNode);
      assertUnique(page.lines.map(line => line.id), "line id");
      for (const line of page.lines) for (const nodeId of line.nodeIds) {
        assertOwnNode(nodeId);
        if (!page.nodeIds.includes(nodeId)) throw new Error(`workflow ${definition.id} review line ${line.id} is outside page ${page.id}`);
      }
      for (const field of page.fields) {
        if ("operatorField" in field) {
          const matches = (group.operatorFields ?? []).filter(candidate => candidate.label === field.operatorField);
          const [operatorField] = matches;
          if (matches.length !== 1 || operatorField === undefined || operatorField.visibility === "logs") {
            throw new Error(`workflow ${definition.id} review field ${field.id} requires one visible operator field ${field.operatorField}`);
          }
          if (operatorField.sources.some(source => !page.nodeIds.some(nodeId => nodeId === source.nodeId))) {
            throw new Error(`workflow ${definition.id} review field ${field.id} reads outside page ${page.id}`);
          }
        } else {
          const transactionSource = (nodeId: string) => {
            assertOwnNode(nodeId);
            if (!page.nodeIds.some(id => id === nodeId)) throw new Error(`workflow ${definition.id} review field ${field.id} reads outside page ${page.id}`);
            const node = ownNodes.find(node => node.id === nodeId);
            if (node?.kind !== "transaction") throw new Error(`workflow ${definition.id} review field ${field.id} requires a transaction source ${nodeId}`);
            return node;
          };
          if ("transactionFields" in field) {
            for (const reference of field.transactionFields) assertSchemaOffersCollectionPath(transactionSource(reference.nodeId).prepare.uses[reference.kind], reference.fieldPath,
              `workflow ${definition.id} review transaction field ${field.id}`);
          } else {
            field.constant.nodeIds.forEach(transactionSource);
          }
        }
        assertRead(field.source.read);
        field.source.chain.forEach(link => assertRead(link.read));
      }
    }
    assertUnique(review.branchLabels.map(label => `${label.nodeId}/${label.outcome}`), "branch outcome");
    for (const label of review.branchLabels) {
      assertOwnNode(label.nodeId);
      const node = ownNodes.find(candidate => candidate.id === label.nodeId);
      if (node?.kind !== "branch" || !Object.hasOwn(node.cases, label.outcome)) {
        throw new Error(`workflow ${definition.id} review names unknown branch outcome ${label.nodeId}/${label.outcome}`);
      }
    }
    for (const node of ownNodes) {
      if (node.kind !== "branch") continue;
      for (const outcome of Object.keys(node.cases)) {
        if (!review.branchLabels.some(label => label.nodeId === node.id && label.outcome === outcome)) {
          throw new Error(`workflow ${definition.id} review omits branch outcome ${node.id}/${outcome}`);
        }
      }
    }
  }
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

// Select only contract-owned stores; unused inventory drops and mismatches refuse.
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

/* ── shared step identities ─────────────── */

type WithWhen<Identity> = Identity extends { readonly when: NodeConditionSpec }
  ? { readonly when: NodeConditionSpec }
  : Record<never, never>;

/** The entry identities a STEP FOLDER shares — id, contract, label, replay, write policy — bound to the frozen step object. Plain values: passed straight to the author, never re-typed. */
export function defineStepEntries<const Key extends string>(step: Readonly<{ key: Key; label: string }>) {
  const owner: WorkflowTimelineGroup = step;
  return Object.freeze({
    task<
      const Id extends string,
      Contract extends AnyReadTaskContract,
      const Identity extends Readonly<{ label?: string; replay: "checkpoint" | "always-rerun"; when?: NodeConditionSpec; dryRun?: "stop-before-publish" }>,
    >(
      id: Id,
      contract: Contract,
      identity: Identity,
    ): Omit<TaskEntryIdentity<Id, Contract>, "when"> & WithWhen<Identity> {
      const value = {
        step: owner,
        id,
        contract,
        ...(identity.label === undefined ? {} : { label: identity.label }),
        replay: identity.replay,
        ...(identity.when === undefined ? {} : { when: identity.when }),
        ...(identity.dryRun === undefined ? {} : { dryRun: identity.dryRun }),
      };
      return Object.freeze(value) as Omit<TaskEntryIdentity<Id, Contract>, "when"> & WithWhen<Identity>;
    },
    transaction<
      const Id extends string,
      Prepare extends AnyPrepareTaskContract,
      Commit extends AnyCommitTaskContract,
    >(
      id: Id,
      identity: Readonly<{
        label: string;
        prepare: Prepare;
        commit: Commit;
        dryRun: "stop-after-prepare" | "unsupported";
        probePolicy: "always" | "retries-and-recovery-only";
        probeToFenceMaxMs: number;
        retryBeforeFence?: RetryPolicy;
      }>,
    ): TransactionEntryIdentity<Id, Prepare, Commit> {
      return Object.freeze({
        step: owner,
        id,
        label: identity.label,
        prepare: identity.prepare,
        commit: identity.commit,
        dryRun: identity.dryRun,
        probePolicy: identity.probePolicy,
        probeToFenceMaxMs: identity.probeToFenceMaxMs,
        ...(identity.retryBeforeFence === undefined ? {} : { retryBeforeFence: identity.retryBeforeFence }),
      });
    },
    operatorGate<
      const Id extends string,
      const Identity extends Readonly<{ label: string; statusKey?: string; result: z.ZodType; when?: NodeConditionSpec }>,
    >(
      id: Id,
      identity: Identity,
    ): Omit<GateEntryIdentity<Id, Identity["result"]>, "when"> & WithWhen<Identity> {
      const value = {
        step: owner,
        id,
        label: identity.label,
        ...(identity.statusKey === undefined ? {} : { statusKey: identity.statusKey }),
        result: identity.result,
        ...(identity.when === undefined ? {} : { when: identity.when }),
      };
      return Object.freeze(value) as Omit<GateEntryIdentity<Id, Identity["result"]>, "when"> & WithWhen<Identity>;
    },
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

/** Browser-safe presentation order from the same validated tuples the compiler executes. */
export function workflowExplorerDeclaration(definition: AnyWorkflowDefinition) {
  const compiled = COMPILED.get(definition);
  if (compiled === undefined) throw new Error(`workflow ${definition.id} has no compiled definition`);
  return Object.freeze(definition.steps.map(([group, entries]) => Object.freeze({
    key: group.key,
    label: group.label,
    ...(group.description === undefined ? {} : { description: group.description }),
    ...(group.system === undefined ? {} : { system: group.system }),
    ...(group.operatorFields === undefined ? {} : { operatorFields: group.operatorFields }),
    entries: Object.freeze(entries.map((entry) => Object.freeze({
      id: entry.id,
      kind: entry.kind,
      nodeIds: Object.freeze([...entryNodeIds(entry)]),
      dependsOn: Object.freeze(entry.references.map((reference) => reference.id)),
      taskIds: Object.freeze(entry.contracts.map((contract) => String(contract.id))),
    }))),
  })));
}
