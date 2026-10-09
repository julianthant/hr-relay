/**
 * The unified completion (fan-out / approval) contract — ref dashboard-surfaces §4, adopted into
 * ref workflow-model's descriptor as `completion`.
 *
 * This replaces the legacy `approveTo` / `approveDocumentTo` /
 * `completeDelegatedRun` trio with ONE typed program in two arms:
 *
 * - `staged-fanout` — the approval gate resolves into an ORDERED stage list.
 *   Stage N+1's derive receives the itemIds stage N **actually enqueued**, not
 *   the operator's selected set: a record filtered out by `eligible` is never
 *   enqueued and never reaches a later stage (ref dashboard-surfaces §4.1, as-built
 *   `approve.ts:306` / `oath.ts:455`).
 * - `complete-then-enqueue` — i9's shape: no approval gate exists, so there is
 *   nothing to approve; the enqueue happens at the prepare seam once the
 *   delegated run completes, and unsearchable pages become task-less
 *   display-only failed rows.
 *
 * Two shapes deliberately have NO program and are pinned as such by the guard:
 * oath-upload (a sibling born-at-upload subscriber, ref dashboard-surfaces §4.5) and verify
 * (in-run enrichment through child-run nodes, ref dashboard-surfaces §4.6).
 *
 * **Cross-spec borrowing is closed structurally (ref dashboard-surfaces §4.2).**
 * `defineCompletionProgram` returns a SEALED handle: its type exposes `mode` and
 * `gate` and nothing else, so `otherDescriptor.completion.stages[0].eligible` is
 * a type error rather than a convention. The one way back to the program is
 * `revealCompletionProgram`, which the composition root calls and a workflow
 * module may not (`descriptor-coverage` checks the call sites). Eligibility
 * predicates are first-class named exports minted by `definePredicate`, so two
 * workflows share a predicate by importing the same shared module — never by
 * fishing one out of another workflow's config.
 */
import { z } from "zod";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  EidSchema,
  IntakeSessionIdSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  PredicateIdSchema,
  RunIdSchema,
  StableRecordIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import type { ItemId } from "../../rules/identity/ids.js";
import type { AnyWorkflowRef } from "./graph.js";

/* ── the values a program's derives read ─────────────────────────────────── */

/**
 * One extracted field. A closed `present`/`absent` union rather than an
 * optional string: "the extractor read an empty box" and "the extractor never
 * saw this field" must stay distinguishable at the boundary.
 */
export const ExtractedFieldSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "extracted field key must be kebab-case"),
  value: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), text: z.string() }),
    z.strictObject({ state: z.literal("absent") }),
  ]),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

/**
 * A record admitted by extraction and shown in Review. `recordId` is minted at
 * admission from the source-artifact digest plus stable page/form identity, so
 * item identity can be derived from it without ever touching an array index or
 * a run id (ref dashboard-surfaces §4.1).
 */
export const PreviewRecordSchema = z.strictObject({
  recordId: StableRecordIdSchema,
  sourceArtifactId: ArtifactIdSchema,
  page: PositiveIntSchema,
  fields: z.array(ExtractedFieldSchema),
});
export type PreviewRecord = z.infer<typeof PreviewRecordSchema>;

/** The approval act itself — who resolved the gate, on which parent, when. */
export const ApproveContextSchema = z.strictObject({
  parentRunId: RunIdSchema,
  parentItemId: ItemIdSchema,
  intakeSessionId: IntakeSessionIdSchema,
  sourceArtifactId: ArtifactIdSchema,
  approvedBy: ActorIdSchema,
  approvedAt: IsoInstantSchema,
});
export type ApproveContext = z.infer<typeof ApproveContextSchema>;

/** Everything a per-document stage sees EXCEPT the ids the record stage enqueued. */
export const ApprovedDocumentSeedSchema = z.strictObject({
  sourceArtifactId: ArtifactIdSchema,
  intakeSessionId: IntakeSessionIdSchema,
  context: ApproveContextSchema,
});
export type ApprovedDocumentSeed = z.infer<typeof ApprovedDocumentSeedSchema>;

/**
 * The per-document stage's input. `perRecordItemIds` is the ACTUALLY-enqueued
 * set from the preceding record stage — the whole reason stages are ordered.
 */
export const ApprovedDocumentSchema = z.strictObject({
  ...ApprovedDocumentSeedSchema.shape,
  perRecordItemIds: z.array(ItemIdSchema),
});
export type ApprovedDocument = z.infer<typeof ApprovedDocumentSchema>;

/**
 * One member of a completed delegated run's plan, consumed by
 * `complete-then-enqueue` at the prepare seam. It carries its own `itemId`
 * because the plan is minted into the durable manifest before dispatch; the
 * person stage therefore derives input, never identity.
 */
export const MemberPlanEntrySchema = z.strictObject({
  recordId: StableRecordIdSchema,
  itemId: ItemIdSchema,
  parentRunId: RunIdSchema,
  delegatedRunId: RunIdSchema,
  sourceArtifactId: ArtifactIdSchema,
  subject: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("eid"), emplId: EidSchema }),
    z.strictObject({ kind: z.literal("name"), name: z.string().min(1) }),
  ]),
});
export type MemberPlanEntry = z.infer<typeof MemberPlanEntrySchema>;

/* ── named predicates (ref dashboard-surfaces §4.2 mechanism 1) ──────────────────────────── */

/**
 * A shared eligibility predicate. It exists as a named export in a shared
 * module so two workflows can agree on "signed with a resolved EID" without
 * either importing the other's configuration.
 */
export interface NamedPredicate {
  readonly id: z.infer<typeof PredicateIdSchema>;
  readonly test: (record: PreviewRecord) => boolean;
}

const FACTORY_SEALED_PREDICATES = new WeakSet<object>();

export function definePredicate(
  id: z.input<typeof PredicateIdSchema>,
  test: (record: PreviewRecord) => boolean,
): NamedPredicate {
  const predicate: NamedPredicate = Object.freeze({ id: PredicateIdSchema.parse(id), test });
  FACTORY_SEALED_PREDICATES.add(predicate);
  return predicate;
}

function assertFactorySealedPredicate(value: NamedPredicate, owner: string): void {
  if (!FACTORY_SEALED_PREDICATES.has(value)) {
    throw new Error(`${owner} eligibility must be the exact predicate returned by definePredicate`);
  }
}

/* ── the program ─────────────────────────────────────────────────────────── */

export const CompletionModeSchema = z.enum(["staged-fanout", "complete-then-enqueue"]);
export type CompletionMode = z.infer<typeof CompletionModeSchema>;
/** The only gate a staged fan-out may resolve; a second gate id is a new arm, not a string. */
export const CompletionGateSchema = z.literal("approval");
export type CompletionGate = z.infer<typeof CompletionGateSchema>;

export interface PerRecordStage<Target extends AnyWorkflowRef> {
  readonly per: "record";
  readonly to: Target;
  readonly derive: (record: PreviewRecord, context: ApproveContext) => z.input<Target["input"]>;
  /** Skipped records are NOT enqueued and their itemIds do NOT reach later stages. */
  readonly eligible?: NamedPredicate;
  readonly deriveItemId: (record: PreviewRecord, context: ApproveContext) => ItemId;
}

export interface PerDocumentStage<Target extends AnyWorkflowRef> {
  readonly per: "document";
  readonly to: Target;
  readonly derive: (document: ApprovedDocument) => z.input<Target["input"]>;
  readonly deriveItemId: (document: ApprovedDocument) => ItemId;
}

export type AnyFanOutStage = PerRecordStage<AnyWorkflowRef> | PerDocumentStage<AnyWorkflowRef>;
export type FanOutStages = readonly [PerRecordStage<AnyWorkflowRef>, ...AnyFanOutStage[]];

export interface StagedFanOut<Stages extends FanOutStages> {
  readonly mode: "staged-fanout";
  readonly gate: CompletionGate;
  /** ORDERED — stage N+1 consumes stage N's actually-enqueued itemIds. */
  readonly stages: Stages;
}

export interface CompleteThenEnqueue<Target extends AnyWorkflowRef> {
  readonly mode: "complete-then-enqueue";
  readonly then: Readonly<{
    per: "person";
    to: Target;
    /** Runs at the PREPARE seam once the delegated run completes — not at an approve route. */
    derive: (plan: MemberPlanEntry) => z.input<Target["input"]>;
    /** Pages that can never be searched become task-less display-only failed rows. */
    displayFailures: true;
  }>;
}

export type CompletionProgram =
  | StagedFanOut<FanOutStages>
  | CompleteThenEnqueue<AnyWorkflowRef>;

/* ── sealing ─────────────────────────────────────────────────────────────── */

const COMPLETION_REVEAL: unique symbol = Symbol("completion-program-reveal");
export type CompletionRevealKey = typeof COMPLETION_REVEAL;

/**
 * What a descriptor carries. `mode` and `gate` are the projection-visible facts
 * ref dashboard-surfaces reads; the stages, derives, and predicates are not structurally
 * reachable, which is what makes cross-spec borrowing a compile error.
 */
export interface SealedCompletionProgram<Program extends CompletionProgram> {
  readonly kind: "sealed-completion-program";
  readonly mode: Program["mode"];
  readonly gate: CompletionGate | "none";
  readonly reveal: (key: CompletionRevealKey) => Program;
}

/** The single, greppable seam back to the program. Workflow modules may not call it. */
export function revealCompletionProgram<Program extends CompletionProgram>(
  sealed: SealedCompletionProgram<Program>,
): Program {
  return sealed.reveal(COMPLETION_REVEAL);
}

/* ── construction, with the stage chain proven at build ──────────────────── */

/**
 * One sample per program arm. Without it "the derive typechecks" is a claim
 * about the shape of a function, not about the value it produces — and a bad
 * derive would surface as a durable failed approval at the first real upload
 * instead of at build.
 */
export const CompletionProgramSampleSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("staged-fanout"),
    record: PreviewRecordSchema,
    context: ApproveContextSchema,
    document: ApprovedDocumentSeedSchema,
  }),
  z.strictObject({
    mode: z.literal("complete-then-enqueue"),
    plan: MemberPlanEntrySchema,
  }),
]);
export type CompletionProgramSample = z.infer<typeof CompletionProgramSampleSchema>;

function assertWorkflowRef(target: AnyWorkflowRef, owner: string): void {
  WorkflowIdSchema.parse(target.id);
  if (!(target.input instanceof z.ZodType) || !(target.result instanceof z.ZodType)) {
    throw new Error(`${owner} target ${target.id} must retain its concrete input and result schemas`);
  }
}

function stableItemId(derive: () => ItemId, owner: string): ItemId {
  const first = ItemIdSchema.parse(derive());
  const second = ItemIdSchema.parse(derive());
  if (first !== second) {
    throw new Error(`${owner} deriveItemId is not stable: produced ${first} then ${second}`);
  }
  return first;
}

function proveStagedFanOut(
  program: StagedFanOut<FanOutStages>,
  sample: Extract<CompletionProgramSample, { mode: "staged-fanout" }>,
): void {
  if (program.gate !== "approval") throw new Error("a staged fan-out resolves the approval gate");
  if (program.stages[0].per !== "record") {
    throw new Error("a staged fan-out must open with a per-record stage");
  }
  const documentStages = program.stages.filter((stage) => stage.per === "document");
  if (documentStages.length > 1) {
    throw new Error("a staged fan-out declares at most one per-document stage");
  }
  let enqueued: readonly ItemId[] = [];
  for (const [index, stage] of program.stages.entries()) {
    const owner = `completion stage ${index} (${stage.per})`;
    assertWorkflowRef(stage.to, owner);
    if (stage.per === "record") {
      if (stage.eligible !== undefined) assertFactorySealedPredicate(stage.eligible, owner);
      const admitted = stage.eligible === undefined || stage.eligible.test(sample.record);
      if (!admitted) {
        enqueued = [];
        continue;
      }
      stage.to.input.parse(stage.derive(sample.record, sample.context));
      enqueued = [stableItemId(() => stage.deriveItemId(sample.record, sample.context), owner)];
      continue;
    }
    const document = ApprovedDocumentSchema.parse({ ...sample.document, perRecordItemIds: enqueued });
    stage.to.input.parse(stage.derive(document));
    enqueued = [stableItemId(() => stage.deriveItemId(document), owner)];
  }
}

function proveCompleteThenEnqueue(
  program: CompleteThenEnqueue<AnyWorkflowRef>,
  sample: Extract<CompletionProgramSample, { mode: "complete-then-enqueue" }>,
): void {
  const owner = "completion then-stage (person)";
  if (program.then.per !== "person") throw new Error(`${owner} must fan out per person`);
  if (program.then.displayFailures !== true) {
    throw new Error(`${owner} must declare displayFailures: unsearchable pages are display-only rows`);
  }
  assertWorkflowRef(program.then.to, owner);
  program.then.to.input.parse(program.then.derive(sample.plan));
}

/**
 * Build a completion program, prove it against one sample, and seal it.
 *
 * The returned handle keeps `Program` exact — the concrete heterogeneous stage
 * tuple — so renaming a field on a target's input schema fails `tsc` at the
 * `derive` site rather than silently producing an unparseable child input.
 */
export function defineCompletionProgram<const Program extends CompletionProgram>(
  program: Program,
  sampleInput: z.input<typeof CompletionProgramSampleSchema>,
): SealedCompletionProgram<Program> {
  const sample = CompletionProgramSampleSchema.parse(sampleInput);
  if (sample.mode !== program.mode) {
    throw new Error(`completion sample is for ${sample.mode} but the program is ${program.mode}`);
  }
  // A generic value is not narrowed by its own discriminant, so the proof runs
  // against the broad union view of the same object.
  const runtime: CompletionProgram = program;
  if (runtime.mode === "staged-fanout" && sample.mode === "staged-fanout") {
    proveStagedFanOut(runtime, sample);
  } else if (runtime.mode === "complete-then-enqueue" && sample.mode === "complete-then-enqueue") {
    proveCompleteThenEnqueue(runtime, sample);
  }
  const gate = runtime.mode === "staged-fanout" ? runtime.gate : "none";
  return Object.freeze({
    kind: "sealed-completion-program",
    mode: program.mode,
    gate,
    reveal: (key: CompletionRevealKey): Program => {
      if (key !== COMPLETION_REVEAL) {
        throw new Error("a sealed completion program is readable only through revealCompletionProgram");
      }
      return program;
    },
  });
}

/* ── what a launching coordinator declares it consumes (ref dashboard-surfaces §4.3) ─────── */

export const CompletionConsumptionSpecSchema = z.strictObject({
  /** Fan-out children are stamped `operation-member` only when the intent is a coordinator. */
  memberShape: z.enum(["operation-member", "natural"]),
  /** Stage kinds this coordinator suppresses — oath signs only; oath-upload files its own ticket. */
  suppress: z.array(z.enum(["document"])).optional(),
});
export type CompletionConsumptionSpec = z.infer<typeof CompletionConsumptionSpecSchema>;

/**
 * A `display` coordinator is an operation row with no daemon task: its
 * `run.queued` carries `displayOnly`, no `run.claimed` follows, and completion
 * is the members-terminal rollup. Dependency edges are not created for it by
 * type, not by probing for a missing task row.
 */
export const CoordinatorPolicySchema = z.enum(["display", "task"]);
export type CoordinatorPolicy = z.infer<typeof CoordinatorPolicySchema>;
