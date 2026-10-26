import type { JsonValue } from "../rules/validation/canonical-json.js";
import type { ProtectedInputBinding } from "../models/write-safety/protected-input.js";
/** The ONE workflow-authoring seam. A `WorkflowDefinition` is ordered `[group, entries[]]` tuples whose order is presentation only; execution edges come from typed references the compiler resolves. */
import { z } from "zod";
import { assertFactorySealedTaskContract } from "../models/task/task-contract.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
} from "../models/task/task-contract.js";
import type { IntakeProjection } from "../models/intake/projection.js";
import { BrowserSystemIdSchema, DelegationEdgeIdSchema, WorkflowIdSchema } from "../rules/identity/ids.js";
import type { ItemId } from "../rules/identity/ids.js";
import type { NodeConditionSpec } from "../models/workflow/node-condition.js";
import type { CompletionProgram } from "../models/workflow/completion.js";
import {
  compileWorkflowOperationDisplay,
  type WorkflowOperationDisplay,
  type WorkflowOperationDisplayDeclaration,
  type WorkflowOperationEntryProjection,
  type WorkflowResultSourceBinding,
} from "../models/workflow/operation-display.js";
import { BUILD_MANIFEST, resolveWorkflowFingerprint } from "./validation/build-manifest.js";
import type { BuildManifest } from "../models/workflow/build-manifest.js";
import { DelegationPolicySchema } from "../models/workflow/delegation-policy.js";
import type { DelegationPolicy } from "../models/workflow/delegation-policy.js";
import type { WorkflowModuleRole } from "./validation/module-role.js";
import { WorkflowModuleRoleSchema } from "./validation/module-role.js";
import {
  TimelineCategoryKeySchema,
  type WorkflowOperatorField,
  WorkflowStepSchema,
} from "../models/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../models/workflow/step-omission.js";
import type {
  AnyWorkflowRef,
  ChildRunIdentityContext,
  ChildRunOutcome,
  DelegationManifestRef,
  RuntimeFlowNode,
  TypedTransactionOutcome,
} from "../models/workflow/graph.js";
import type { RetryPolicy } from "../models/sessions/session.js";
import type { RegisteredTaskStore } from "./task-registry.js";
import { flow } from "./flow.js";
import type { AnyNodeEntry, BuiltFlow } from "./flow.js";
import { defineWorkflowDescriptor } from "./workflow.js";
import type {
  AnyWorkflowDescriptor,
  WorkflowDescriptor,
  WorkflowDescriptorSpec,
} from "./workflow.js";

/** The closed entry algebra. */
export type WorkflowEntryKind = "task" | "parallel" | "delegate" | "gate" | "transaction";
const GROUP_OWNER = Symbol("workflow-group-owner");

export interface WorkflowTimelineGroup {
  readonly description?: string;
  readonly operatorFields?: readonly WorkflowOperatorField[];
  readonly system?: z.input<typeof BrowserSystemIdSchema> | "local";
  readonly key: string;
  readonly label: string;
  readonly omission?: StepOmissionDeclaration;
  readonly selection?: Readonly<{ inputField: string; selectedWhen: boolean }>;
  readonly [GROUP_OWNER]?: WorkflowTimelineGroup;
}

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
  readonly protectedInputBindings?: readonly ProtectedInputBinding[];
  readonly outputs: EntryOutputs<References>;
  readonly configuration?: Readonly<Record<string, JsonValue>>;
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

type GateConditional<Identity> = HasWhen<Identity>;

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
  readonly deriveChildItemId: (input: unknown, context: ChildRunIdentityContext) => ItemId;
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
  readonly sources?: readonly WorkflowResultSourceBinding[];
  readonly references: readonly AnyWorkflowEntry[];
  readonly derive: (scope: unknown) => z.input<ResultSchema>;
  /** Type witness binding the derive scope to this definition's input. */
  readonly _input?: InputSchema;
}

/* ── the author ──────────────────────────────────────────────────────────── */

export interface WorkflowAuthor<InputSchema extends z.ZodType> {
  /** Declare a group omittable, beside its own entries. */
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
    sources?: readonly WorkflowResultSourceBinding[],
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
        deriveChildItemId: (input: never, context: ChildRunIdentityContext) => ItemId;
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
        deriveChildItemId: (input, context) => binds.deriveChildItemId(input as never, context),
      };
      return Object.freeze(entry);
    },
    result(
      schema: z.ZodType,
      references: readonly AnyWorkflowEntry[],
      derive: (scope: never) => unknown,
      sources?: readonly WorkflowResultSourceBinding[],
    ) {
      return Object.freeze({
        schema,
        ...(sources === undefined ? {} : { sources: Object.freeze([...sources]) }),
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
  | "operationDisplay"
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
  /** Optional v1 action display declaration; omitted definitions remain legacy. */
  readonly operationDisplay?: WorkflowOperationDisplayDeclaration;
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
  readonly input: InputSchema;
  readonly role: WorkflowModuleRole;
  readonly intake?: IntakeProjection;
  readonly operationDisplay?: WorkflowOperationDisplayDeclaration;
  readonly steps: readonly WorkflowTimelineTuple[];
  readonly result: WorkflowResultDeclaration<InputSchema, ResultSchema>;
}

export type AnyWorkflowDefinition = WorkflowDefinition<z.ZodType, z.ZodType, CompletionProgram | undefined>;

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
  const { steps: authorSteps, input, role, intake, operationDisplay, ...presentation } = spec;
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
    ...(operationDisplay === undefined ? {} : { operationDisplay }),
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
  // A leaf's parallel node must be declared before the leaf (builder downstream check); the
  // parallel entry has no references, so it is emitted lazily before its first leaf in dep order.
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
  /** Complete v1 projection or explicit legacy capability for existing definitions. */
  readonly operationDisplay: WorkflowOperationDisplay;
  /** Task-store namespaces the definition's contracts belong to, first-use order. */
  readonly storeNamespaces: readonly string[];
}

export type AnyCompiledWorkflow = CompiledWorkflow<z.ZodType, z.ZodType, CompletionProgram | undefined>;

const COMPILED = new WeakMap<object, Readonly<{ compiled: AnyCompiledWorkflow; manifest: BuildManifest }>>();
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

/** Projects the entry graph read-only: it validates identities and field references but never
 *  builds an edge or gives presentation children scheduler meaning. */
function operationDisplayEntries(definition: AnyWorkflowDefinition): readonly WorkflowOperationEntryProjection[] {
  const entries = flattenEntries(definition.steps) as readonly RuntimeEntry[];
  return Object.freeze(entries.map((entry) => {
    const base = {
      id: entry.id,
      kind: entry.kind,
      ...(entry.label === undefined ? {} : { label: entry.label }),
      dependsOn: Object.freeze(entry.references.map(({ id }) => id)),
    } as const;
    if (entry.kind === "task") {
      return Object.freeze({
        ...base,
        kind: "task" as const,
        contracts: Object.freeze([{ role: "task" as const, contract: entry.contract }]),
        output: entry.contract.output,
      });
    }
    if (entry.kind === "transaction") {
      const reads = definition.operationDisplay?.transactionReads?.filter((read) => read.entryId === entry.id) ?? [];
      const completion = entry.commitContract.writeSafety.completion;
      const required = [
        { role: "probe" as const, taskId: entry.commitContract.writeSafety.idempotency.probe.taskId },
        ...(completion.kind === "receipt" ? [] : [{ role: "verify" as const, taskId: completion.verify.taskId }]),
      ];
      if (definition.operationDisplay !== undefined) {
        for (const reference of required) {
          const matching = reads.filter((read) => read.role === reference.role);
          if (matching.length !== 1) throw new Error(`complete operation display requires one ${reference.role} contract for transaction ${entry.id}`);
          const read = matching[0];
          assertFactorySealedTaskContract(read.contract);
          if (read.contract.effect !== "read" || read.contract.id !== reference.taskId) {
            throw new Error(`operation display ${reference.role} contract does not match transaction ${entry.id} writeSafety`);
          }
        }
        if (reads.some((read) => !required.some((reference) => read.role === reference.role))) {
          throw new Error(`operation display declares an unavailable read role for transaction ${entry.id}`);
        }
      }
      return Object.freeze({
        ...base,
        kind: "transaction" as const,
        contracts: Object.freeze([
          { role: "prepare" as const, contract: entry.prepareContract },
          { role: "commit" as const, contract: entry.commitContract },
          ...reads.map((read) => ({ role: read.role, contract: read.contract })),
        ]),
        output: entry.commitContract.output,
      });
    }
    if (entry.kind === "delegate") {
      return Object.freeze({
        ...base,
        kind: "delegate" as const,
        contracts: Object.freeze([]),
        child: Object.freeze({ workflowId: String(entry.target.id), result: entry.target.result }),
      });
    }
    if (entry.kind === "gate") {
      return Object.freeze({
        ...base,
        kind: "gate" as const,
        contracts: Object.freeze([]),
        output: entry.result,
      });
    }
    return Object.freeze({
      ...base,
      kind: "parallel" as const,
      contracts: Object.freeze([]),
    });
  }));
}

/** Compile a definition through the descriptor factory and runtime; memoized per definition object, so the composition root, the descriptor tuple and every test read the same object. */
export interface CompileWorkflowOptions {
    /** The build manifest owning this workflow's contract fingerprint; defaults to the
     *  checked-in one. Never an authoring input. */
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
  const manifest = options.manifest ?? BUILD_MANIFEST;
  const existing = COMPILED.get(definition);
  if (existing !== undefined) {
    if (existing.manifest !== manifest) {
      throw new Error(
        `workflow ${String(definition.id)} was already compiled under a different build manifest; one definition `
        + "compiles under exactly one manifest",
      );
    }
    return existing.compiled as CompiledWorkflow<InputSchema, ResultSchema, Completion>;
  }
  if (definition.kind !== "workflow-definition") {
    throw new Error("compileWorkflow requires a value produced by defineWorkflow");
  }
  const { kind, input, role, intake, operationDisplay: operationDisplayDeclaration, steps, result, ...presentation } = definition;
  void kind;
  void input;
  void role;
  void intake;
  void operationDisplayDeclaration;
  void result;
  for (const read of definition.operationDisplay?.transactionReads ?? []) {
    if (!flattenEntries(definition.steps).some((entry) => entry.kind === "transaction" && entry.id === read.entryId)) {
      throw new Error(`operation display read references unavailable transaction ${read.entryId}`);
    }
  }
  const operationDisplay = compileWorkflowOperationDisplay({
    workflowId: String(definition.id),
    input: definition.input,
    entries: operationDisplayEntries(definition),
    result: { schema: definition.result.schema, dependsOn: definition.result.references.map((entry) => entry.id), ...(definition.result.sources === undefined ? {} : { sources: definition.result.sources }) },
    ...(definition.operationDisplay === undefined ? {} : { declaration: definition.operationDisplay }),
  });
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
  const descriptor = defineWorkflowDescriptor({
    ...presentation,
    contractFingerprint: resolveWorkflowFingerprint(manifest, WorkflowIdSchema.parse(definition.id)),
    flow: compileFlow(definition),
    ...(usesDefaultTimeline ? {} : { timeline }),
    ...(operationDisplay.capability === "complete" ? { operationDisplay } : {}),
  });
  const contracts = Object.freeze(flattenEntries(steps).flatMap(({ contracts: owned }) => owned));
  const compiled: CompiledWorkflow<InputSchema, ResultSchema, Completion> = Object.freeze({
    kind: "compiled-workflow",
    definition,
    descriptor,
    contracts,
    operationDisplay,
    storeNamespaces: Object.freeze([...new Set(contracts.map(storeNamespace))]),
  });
  COMPILED.set(definition, Object.freeze({ compiled, manifest }));
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
  readonly operationDisplay: WorkflowOperationDisplay;
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
  if (COMPILED.get(compiled.definition)?.compiled !== compiled) {
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
    operationDisplay: compiled.operationDisplay,
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
      const Identity extends Readonly<{ label?: string; replay: "checkpoint" | "always-rerun"; when?: NodeConditionSpec }>,
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
  const compiled = COMPILED.get(definition)?.compiled;
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
