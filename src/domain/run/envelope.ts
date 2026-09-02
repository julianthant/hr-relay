/**
 * The `RunEnvelope` — kernel-owned state that rides BESIDE the workflow-constant
 * input (ref workflow-model §2).
 *
 * Three rules make this shape what it is.
 *
 * 1. **`dryRun` lives here and nowhere else (D6).** A workflow schema that could
 *    declare it could also disagree with the executor about whether a run may
 *    commit, so the flag is envelope state and no `TaskCtx` exposes it. The
 *    executor compiles a commit-free graph rather than checking a boolean at the
 *    fence.
 * 2. **Requested is not resolved.** `requestedInstance` is what the surface
 *    asked for; `resolvedInstance` is what enqueue decided. Both are recorded so
 *    a resolver that quietly ignored the request is a parse failure here rather
 *    than a surprise against a production host.
 * 3. **Resume affordances are attempt-scoped.** A freshness override authorizes
 *    exactly one attempt (ref workflow-model §5.5) and an override naming a different
 *    attempt is a bug, not a silently-ignored no-op — so it is rejected.
 */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  ConfigSnapshotIdSchema,
  DelegationEdgeIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { CheckpointPatchSchema, FreshnessOverrideSchema } from "../workflow/checkpoint.js";

export const SystemInstanceSchema = z.enum(["prod", "test"]);
export type SystemInstance = z.infer<typeof SystemInstanceSchema>;

/** The SHAPE axis (ref dashboard-surfaces §1.1) — stamped once at enqueue, never recomputed. */
export const RunShapeSchema = z.enum(["single", "preview", "operation", "operation-member"]);
export type RunShape = z.infer<typeof RunShapeSchema>;

/** Server-stamped from the run surface; children inherit their root's value. */
export const RunPrioritySchema = z.enum(["interactive", "bulk"]);
export type RunPriority = z.infer<typeof RunPrioritySchema>;

/** The browser presentation the operator chose for this immutable run. */
export const BrowserPresentationModeSchema = z.enum(["headless", "headed"]);
export type BrowserPresentationMode = z.infer<typeof BrowserPresentationModeSchema>;

/**
 * A partial map over the closed browser-system set. `partialRecord` keeps the
 * key set closed — an unknown system id fails rather than riding along as an
 * unread extra key.
 */
export const InstanceSelectionSchema = z.partialRecord(BrowserSystemIdSchema, SystemInstanceSchema);
export type InstanceSelection = z.infer<typeof InstanceSelectionSchema>;

export const RunParentSchema = z.strictObject({
  runId: RunIdSchema,
  tracePrefix: TraceIdSchema,
  edgeId: DelegationEdgeIdSchema,
});
export type RunParent = z.infer<typeof RunParentSchema>;

export const RunEnvelopeSchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  /** The logical-item key half: `(workflow, itemId)` — ref workflow-model §5.7. */
  itemId: ItemIdSchema,
  /** Frozen at enqueue; the join key for spans, notes, and the ledger. */
  traceId: TraceIdSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  requestedInstance: InstanceSelectionSchema.optional(),
  resolvedInstance: InstanceSelectionSchema,
  configFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  parent: RunParentSchema.optional(),
  shape: RunShapeSchema,
  priority: RunPrioritySchema,
  /** D6 — the ONLY home of this flag. */
  dryRun: z.boolean(),
  /** Optional only so historical authority rows remain readable. */
  browserMode: BrowserPresentationModeSchema.optional(),
  /** Optional only so historical authority rows remain readable. */
  captureBrowserScreenshots: z.boolean().optional(),
  /** A resumable graph-node id, never an internal transaction arm (ref workflow-model §5.7). */
  startAt: NodeIdSchema.optional(),
  injected: z.array(CheckpointPatchSchema).min(1).optional(),
  freshnessOverride: z.array(FreshnessOverrideSchema).min(1).optional(),
  retryOf: RunIdSchema.optional(),
  /**
   * D221 — the attempt at the ITEM, not at this run.
   *
   * `(workflow, itemId)` is the logical item and the checkpoint key is scoped to
   * it (ref workflow-model §5.7), so every component of that key must be item-scoped too. A
   * new run for an item — an operator retry, or any fresh enqueue of an item
   * that has run before — therefore takes the item's NEXT attempt, and a requeue
   * inside a run advances the same counter. Two runs of one item may never hold
   * the same attempt; `runs.enqueue` refuses one that would.
   */
  attempt: PositiveIntSchema,
  enqueuedAt: IsoInstantSchema,
}).superRefine((envelope, context) => {
  if (envelope.retryOf === envelope.runId) {
    context.addIssue({ code: "custom", path: ["retryOf"], message: "a run cannot be a cross-run retry of itself" });
  }
  if (envelope.parent?.runId === envelope.runId) {
    context.addIssue({ code: "custom", path: ["parent", "runId"], message: "a run cannot be its own parent" });
  }
  for (const [system, requested] of Object.entries(envelope.requestedInstance ?? {})) {
    const resolved = envelope.resolvedInstance[BrowserSystemIdSchema.parse(system)];
    if (resolved === undefined) {
      context.addIssue({
        code: "custom",
        path: ["resolvedInstance", system],
        message: `${system} was requested but enqueue resolved no instance for it`,
      });
      continue;
    }
    if (resolved !== requested) {
      context.addIssue({
        code: "custom",
        path: ["resolvedInstance", system],
        message: `${system} was requested as ${requested} but resolved to ${resolved}`,
      });
    }
  }
  for (const [index, override] of (envelope.freshnessOverride ?? []).entries()) {
    if (override.validForAttempt !== envelope.attempt) {
      context.addIssue({
        code: "custom",
        path: ["freshnessOverride", index, "validForAttempt"],
        message: `freshness override is scoped to attempt ${String(override.validForAttempt)} but this run is attempt ${String(envelope.attempt)}`,
      });
    }
  }
  if (envelope.injected !== undefined) {
    // D166: `injected` no longer requires `startAt`. The original rule
    // guarded the start-at-N affordance ("without startAt the patched node
    // would re-run and discard the correction"), but the live Edit-Data save
    // stores patches on a queued/parked run whose patched nodes REPLAY from
    // checkpoints — and the executor refuses, loudly, any patch naming a
    // node it will execute rather than replay. The discard the old rule
    // feared is now a structural refusal, not a silence.
    const seen = new Set<string>();
    for (const [index, patch] of envelope.injected.entries()) {
      const key = `${patch.nodeId}\u0000${patch.fieldPath}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["injected", index],
          message: `two patches target ${patch.nodeId}.${patch.fieldPath}`,
        });
      }
      seen.add(key);
      if (patch.nodeId === envelope.startAt) {
        context.addIssue({
          code: "custom",
          path: ["injected", index, "nodeId"],
          message: `${patch.nodeId} is the entry node and will re-run; only upstream checkpoints may be patched`,
        });
      }
    }
  }
});
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;

/**
 * The envelope for the next attempt, with every single-resume affordance gone.
 *
 * The keys are DELETED, not set to `undefined`: a durable record is canonical
 * JSON, and `{ startAt: undefined }` is neither absent nor a JSON value — it
 * would fail serialization at the storage boundary rather than quietly meaning
 * "no start node". Dropping them is also the contract, not tidiness: a
 * freshness override authorizes exactly one attempt, and injected patches have
 * already been persisted as checkpoints by the executor that applied them.
 *
 * **`nextAttempt` is supplied, never computed as `attempt + 1` (D221).** The
 * attempt counts attempts at the ITEM, not at this run — the checkpoint key is
 * item-scoped and the write sequencer reads `attempt > 1` as "this item has been
 * attempted before" — so the next one is whatever the item has not used yet, and
 * only authority can say what that is. It must strictly advance: an attempt that
 * stood still or went backwards would put this requeue's executions under a key
 * another execution already owns.
 */
export function nextAttemptEnvelope(envelope: RunEnvelope, nextAttempt: number): RunEnvelope {
  const { startAt, injected, freshnessOverride, ...carried } = envelope;
  void startAt;
  void injected;
  void freshnessOverride;
  const advanced = PositiveIntSchema.parse(nextAttempt);
  if (advanced <= carried.attempt) {
    throw new Error(
      `run ${carried.runId} is at attempt ${String(carried.attempt)} and cannot requeue into attempt `
      + `${String(advanced)}; an item's attempt counter only advances`,
    );
  }
  return RunEnvelopeSchema.parse({ ...carried, attempt: advanced });
}
