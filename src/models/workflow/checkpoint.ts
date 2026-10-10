import { DeclaredActionIdentitySchema } from "./operation-action-identity.js";
/** The checkpoint record, its loader, and the freshness walk: a union loader with no defaultable shape, mandatory fingerprints, and a walk that keeps a stale read out of a live write. */
import { z } from "zod";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import type { FreshnessPolicy } from "../task/task-contract.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  NodeIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import type { NodeId } from "../../rules/identity/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import type { RuntimeFlowNode } from "./graph.js";

/* ── the durable record ──────────────────────────────────────────────────── */

/** Field-level fact provenance: `originalObservedAt` is the oldest contributing live capture, so a pure transform cannot refresh its inputs. */
export const FactProvenanceSchema = z.strictObject({
  path: ContractFieldPathSchema,
  source: z.enum(["live", "derived", "operator"]),
  observedAt: IsoInstantSchema,
  originalObservedAt: IsoInstantSchema,
  /** Present only for an operator correction (ref workflow-model §5.6 #3). */
  correctedAt: IsoInstantSchema.optional(),
  supersedes: IsoInstantSchema.optional(),
});
export type FactProvenance = z.infer<typeof FactProvenanceSchema>;

/** One row of `run_checkpoints`; the logical item is `(workflowId, itemId)` and `runId` records which attempt wrote it, for audit only. */
export const RunCheckpointRecordSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  nodeId: NodeIdSchema,
  attempt: PositiveIntSchema,
    // Absent generations preserve historical keys; current writers must supply the execution’s claim generation.
  claimGeneration: PositiveIntSchema.optional(),
  runId: RunIdSchema,
  /** The schema-parsed node output, bound to the hash of the schema that parsed it. */
  output: SchemaBoundCanonicalValueSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  implFingerprint: FingerprintSchema,
  provenance: z.array(FactProvenanceSchema),
  writtenAt: IsoInstantSchema,
  operationSources: z.array(z.strictObject({ path: ContractFieldPathSchema, identity: DeclaredActionIdentitySchema })).optional(),
    // Operator assertions replay only under the same omission; they never substitute for live observations.
  assertion: z.strictObject({
    step: z.string().min(1),
    assertedAt: IsoInstantSchema,
  }).optional(),
}).superRefine((record, context) => {
  const paths = new Set<string>();
  for (const [index, source] of (record.operationSources ?? []).entries()) {
    const identity = source.identity;
    if (paths.has(source.path) || identity.runId !== record.runId || identity.nodeId !== record.nodeId
      || identity.attempt !== record.attempt || identity.claimGeneration !== record.claimGeneration
      || identity.definitionFingerprint !== record.contractFingerprint || (identity.state !== undefined && identity.state !== "completed")) {
      context.addIssue({ code: "custom", path: ["operationSources", index], message: "checkpoint operation source identity mismatch or duplicate path" });
    }
    paths.add(source.path);
    let value: unknown = record.output.value;
    for (const segment of source.path.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined;
    if (value === undefined) context.addIssue({ code: "custom", path: ["operationSources", index, "path"], message: "checkpoint operation source field unavailable" });
  }
});
export type RunCheckpointRecord = z.infer<typeof RunCheckpointRecordSchema>;

/** What the current build expects a replayable checkpoint to have been written under. */
export const CheckpointExpectationSchema = z.strictObject({
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  implFingerprint: FingerprintSchema,
  outputSchemaHash: FingerprintSchema,
});
export type CheckpointExpectation = z.infer<typeof CheckpointExpectationSchema>;

export const CheckpointMissReasonSchema = z.enum([
  "no-checkpoint",
  "descriptor-version-mismatch",
  "contract-fingerprint-mismatch",
  "impl-fingerprint-mismatch",
  "output-schema-mismatch",
  "payload-invalid",
]);
export type CheckpointMissReason = z.infer<typeof CheckpointMissReasonSchema>;

/** The loader's result, deliberately not a schema: `output` is the producing contract's own parsed type. */
export type CheckpointLoad<Output> =
  | Readonly<{
    found: true;
    output: Output;
    provenance: readonly FactProvenance[];
    attempt: number;
    runId: string;
    /** Set when a checked-in migration transformed the stored payload. */
    migratedFrom?: Readonly<{ descriptorVersion: number; contractFingerprint: string }>;
  }>
  | Readonly<{ found: false; reason: CheckpointMissReason; detail: string }>;

/* ── checkpoint migrations ───────────────────────────────────────────────── */

/** A checked-in, version-to-version transform; nothing else may make an incompatible checkpoint replayable. */
export interface CheckpointMigration {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly from: Readonly<{ descriptorVersion: number; contractFingerprint: string }>;
  readonly to: Readonly<{ descriptorVersion: number; contractFingerprint: string }>;
  readonly migrate: (stored: unknown) => unknown;
}

const FACTORY_SEALED_MIGRATIONS = new WeakSet<object>();

export function defineCheckpointMigration(migration: CheckpointMigration): CheckpointMigration {
  WorkflowIdSchema.parse(migration.workflowId);
  NodeIdSchema.parse(migration.nodeId);
  for (const side of [migration.from, migration.to] as const) {
    PositiveIntSchema.parse(side.descriptorVersion);
    FingerprintSchema.parse(side.contractFingerprint);
  }
  if (migration.from.descriptorVersion === migration.to.descriptorVersion
    && migration.from.contractFingerprint === migration.to.contractFingerprint) {
    throw new Error(
      `checkpoint migration for ${migration.workflowId}/${migration.nodeId} does not change version or fingerprint`,
    );
  }
  const sealed = Object.freeze({ ...migration });
  FACTORY_SEALED_MIGRATIONS.add(sealed);
  return sealed;
}

function findMigration(
  migrations: readonly CheckpointMigration[],
  record: RunCheckpointRecord,
  expectation: CheckpointExpectation,
): CheckpointMigration | undefined {
  return migrations.find((migration) =>
    migration.workflowId === record.workflowId
    && migration.nodeId === record.nodeId
    && migration.from.descriptorVersion === record.descriptorVersion
    && migration.from.contractFingerprint === record.contractFingerprint
    && migration.to.descriptorVersion === expectation.descriptorVersion
    && migration.to.contractFingerprint === expectation.contractFingerprint);
}

/** Decide whether a stored checkpoint may be replayed; `stored` is `undefined` when no row exists. */
export function loadCheckpoint<OutputSchema extends z.ZodType>(
  stored: RunCheckpointRecord | undefined,
  expectation: CheckpointExpectation,
  outputSchema: OutputSchema,
  migrations: readonly CheckpointMigration[] = [],
): CheckpointLoad<z.output<OutputSchema>> {
  if (stored === undefined) {
    return { found: false, reason: "no-checkpoint", detail: "no checkpoint row exists for this node" };
  }
  const record = RunCheckpointRecordSchema.parse(stored);
  const compatible = record.descriptorVersion === expectation.descriptorVersion
    && record.contractFingerprint === expectation.contractFingerprint;
  let payload: unknown = record.output.value;
  let migratedFrom: Readonly<{ descriptorVersion: number; contractFingerprint: string }> | undefined;

  if (!compatible) {
    const migration = findMigration(migrations, record, expectation);
    if (migration === undefined) {
      const reason: CheckpointMissReason = record.descriptorVersion === expectation.descriptorVersion
        ? "contract-fingerprint-mismatch"
        : "descriptor-version-mismatch";
      return {
        found: false,
        reason,
        detail: `checkpoint ${record.nodeId} was written under descriptor v${String(record.descriptorVersion)} `
          + `/ ${record.contractFingerprint} and no checked-in migration reaches `
          + `v${String(expectation.descriptorVersion)} / ${expectation.contractFingerprint}`,
      };
    }
    if (!FACTORY_SEALED_MIGRATIONS.has(migration)) {
      throw new Error("checkpoint migrations must be the exact objects returned by defineCheckpointMigration");
    }
    payload = migration.migrate(payload);
    migratedFrom = {
      descriptorVersion: record.descriptorVersion,
      contractFingerprint: record.contractFingerprint,
    };
  }

  if (record.implFingerprint !== expectation.implFingerprint && migratedFrom === undefined) {
    return {
      found: false,
      reason: "impl-fingerprint-mismatch",
      detail: `checkpoint ${record.nodeId} was produced by implementation ${record.implFingerprint}, `
        + `and this build binds ${expectation.implFingerprint}`,
    };
  }
  if (record.output.schemaHash !== expectation.outputSchemaHash && migratedFrom === undefined) {
    return {
      found: false,
      reason: "output-schema-mismatch",
      detail: `checkpoint ${record.nodeId} stores a payload bound to schema ${record.output.schemaHash}, `
        + `and this build parses ${expectation.outputSchemaHash}`,
    };
  }

  const parsed = outputSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      found: false,
      reason: "payload-invalid",
      detail: `checkpoint ${record.nodeId} payload no longer parses: `
        + parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    };
  }
  return {
    found: true,
    output: parsed.data,
    provenance: record.provenance,
    attempt: record.attempt,
    runId: record.runId,
    ...(migratedFrom === undefined ? {} : { migratedFrom }),
  };
}

/* ── the freshness walk ────────────────────────────────────────────── */

/** One operator correction to a replayed upstream checkpoint; `value` is raw JSON until the whole post-patch output re-parses. */
export const CheckpointPatchSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ContractFieldPathSchema,
  value: JsonValueSchema,
  correctedAt: IsoInstantSchema,
  reason: z.string().min(1),
});
export type CheckpointPatch = z.infer<typeof CheckpointPatchSchema>;

/** A single-resume, field-scoped operator confirmation that only reaches a field marked `override: "audited"`. */
export const FreshnessOverrideSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPaths: z.array(ContractFieldPathSchema).min(1),
  confirmedAt: IsoInstantSchema,
  reason: z.string().min(1),
  validForAttempt: PositiveIntSchema,
});
export type FreshnessOverride = z.infer<typeof FreshnessOverrideSchema>;

/** Conservative forward edges: dependency edges plus branch and parallel targets. */
function forwardEdges(nodes: readonly RuntimeFlowNode[]): ReadonlyMap<string, readonly NodeId[]> {
  const edges = new Map<string, NodeId[]>();
  const add = (from: string, to: NodeId): void => {
    const existing = edges.get(from);
    if (existing === undefined) edges.set(from, [to]);
    else if (!existing.includes(to)) existing.push(to);
  };
  for (const node of nodes) {
    for (const dependency of node.dependsOn) add(dependency, node.id);
    if (node.kind === "branch") {
      for (const targets of Object.values(node.cases)) for (const target of targets) add(node.id, target);
    }
    if (node.kind === "parallel") {
      for (const branch of node.branches) {
        for (const member of branch.nodes) add(node.id, NodeIdSchema.parse(member));
      }
    }
  }
  return edges;
}

/** Every commit node reachable from `from`, with the path taken, over the STATIC graph so a walk cannot under-approximate. */
export function reachableCommits(
  nodes: readonly RuntimeFlowNode[],
  from: NodeId,
  scheduled: ReadonlySet<string>,
): readonly { readonly nodeId: NodeId; readonly path: readonly NodeId[] }[] {
  const edges = forwardEdges(nodes);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const seen = new Set<string>([String(from)]);
  const queue: { nodeId: NodeId; path: readonly NodeId[] }[] = [{ nodeId: from, path: [from] }];
  const found: { nodeId: NodeId; path: readonly NodeId[] }[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of edges.get(String(current.nodeId)) ?? []) {
      if (seen.has(String(next))) continue;
      seen.add(String(next));
      const path = [...current.path, next];
      const node = byId.get(String(next));
      if (node?.kind === "transaction" && scheduled.has(String(next))) found.push({ nodeId: next, path });
      queue.push({ nodeId: next, path });
    }
  }
  return found;
}

function freshnessLimitMs(policy: FreshnessPolicy, path: string): number {
  const override = policy.byField?.find((rule) => rule.path === path);
  return override?.maxAgeMs ?? policy.defaultMaxAgeMs;
}

function overrideAllowed(policy: FreshnessPolicy, path: string): boolean {
  const rule = policy.byField?.find((entry) => entry.path === path);
  return (rule?.override ?? policy.defaultOverride) === "audited";
}

/** The bound ONE field is recorded under — `byField` beats the default, and an unstated override policy is `forbidden`. */
export function resolveFreshnessBound(
  policy: FreshnessPolicy,
  path: string,
): { readonly maxAgeMs: number; readonly override: "forbidden" | "audited" } {
  return {
    maxAgeMs: freshnessLimitMs(policy, path),
    override: overrideAllowed(policy, path) ? "audited" : "forbidden",
  };
}

export interface ReplayedCheckpoint {
  readonly nodeId: NodeId;
  readonly taskId: string;
  readonly freshness: FreshnessPolicy;
  readonly provenance: readonly FactProvenance[];
}

export interface FreshnessWalkInput {
  readonly workflowId: string;
  readonly runId: string;
  readonly startAt: NodeId;
  readonly nodes: readonly RuntimeFlowNode[];
  readonly replayed: readonly ReplayedCheckpoint[];
  /** Nodes this run will actually execute; a commit outside it is no sink. */
  readonly scheduled: readonly NodeId[];
  readonly now: Date;
  readonly attempt: number;
  readonly overrides?: readonly FreshnessOverride[];
}

function formatAge(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  return `${String(Math.floor(totalMinutes / 60))}h${String(totalMinutes % 60).padStart(2, "0")}m`;
}

/** One message per refused replay; empty means every replayed fact is either fresh enough or cannot reach a scheduled commit. */
export function auditCheckpointFreshness(input: FreshnessWalkInput): readonly string[] {
  const scheduled = new Set(input.scheduled.map(String));
  const violations: string[] = [];
  for (const checkpoint of input.replayed) {
    const sinks = reachableCommits(input.nodes, checkpoint.nodeId, scheduled);
    if (sinks.length === 0) continue;
    for (const fact of checkpoint.provenance) {
      const limit = freshnessLimitMs(checkpoint.freshness, fact.path);
      if (!Number.isFinite(limit)) continue;
      // A derived fact is only as fresh as its oldest contributing live capture.
      const observed = fact.source === "derived" ? fact.originalObservedAt : fact.observedAt;
      const age = input.now.getTime() - Date.parse(observed);
      if (age <= limit) continue;
      const covered = input.overrides?.some((override) =>
        override.nodeId === checkpoint.nodeId
        && override.validForAttempt === input.attempt
        && override.fieldPaths.includes(fact.path));
      if (covered === true) {
        if (!overrideAllowed(checkpoint.freshness, fact.path)) {
          violations.push(
            `CheckpointFreshnessError: ${input.workflowId} run ${input.runId}: field "${fact.path}" of `
            + `checkpoint "${checkpoint.nodeId}" (${checkpoint.taskId}) is override:"forbidden" and must be re-read; `
            + `an operator confirmation cannot authorize it.`,
          );
        }
        continue;
      }
      for (const sink of sinks) {
        violations.push(
          `CheckpointFreshnessError: ${input.workflowId} run ${input.runId}, start at "${input.startAt}":\n`
          + `  checkpoint "${checkpoint.nodeId}" (${checkpoint.taskId}) field "${fact.path}" captured ${observed}\n`
          + `  (age ${formatAge(age)}, freshness limit ${String(limit)}ms) feeds commit node "${sink.nodeId}"\n`
          + `  in this run — via ${sink.path.join(" → ")}.\n`
          + `Fix: re-run "${checkpoint.nodeId}" (start there, or mark it always-rerun for this resume),\n`
          + `  or confirm an operator freshness override (recorded, single-resume scope).`,
        );
      }
    }
  }
  return violations;
}

/** Fail-loud wrapper: a stale read that reaches a live write stops the run. */
export function assertCheckpointFreshness(input: FreshnessWalkInput): void {
  const violations = auditCheckpointFreshness(input);
  if (violations.length > 0) throw new Error(violations.join("\n\n"));
}

/* ── canonical-input snapshot migrations (ref workflow-model §2) ─────────────────────── */

/** A changed canonical schema requires an explicit snapshot migration or a loud refusal, never a re-run of ingress parsing. */
export interface CanonicalInputSnapshotMigration {
  readonly workflowId: string;
  readonly from: string;
  readonly to: string;
  readonly migrate: (stored: unknown) => unknown;
}

const FACTORY_SEALED_SNAPSHOT_MIGRATIONS = new WeakSet<object>();

export function defineCanonicalInputSnapshotMigration(
  migration: CanonicalInputSnapshotMigration,
): CanonicalInputSnapshotMigration {
  WorkflowIdSchema.parse(migration.workflowId);
  FingerprintSchema.parse(migration.from);
  FingerprintSchema.parse(migration.to);
  if (migration.from === migration.to) {
    throw new Error(`canonical input snapshot migration for ${migration.workflowId} does not change the schema hash`);
  }
  const sealed = Object.freeze({ ...migration });
  FACTORY_SEALED_SNAPSHOT_MIGRATIONS.add(sealed);
  return sealed;
}

/** Bring a stored snapshot to the current canonical schema, or refuse; the caller re-parses the result. */
export function migrateCanonicalInputSnapshot(
  stored: Readonly<{ schemaHash: string; value: unknown }>,
  currentSchemaHash: string,
  migrations: readonly CanonicalInputSnapshotMigration[],
  workflowId: string,
): unknown {
  if (stored.schemaHash === currentSchemaHash) return stored.value;
  const chain: unknown[] = [];
  let value = stored.value;
  let hash = stored.schemaHash;
  const applied = new Set<string>([hash]);
  for (;;) {
    const migration = migrations.find((candidate) =>
      candidate.workflowId === workflowId && candidate.from === hash);
    if (migration === undefined) break;
    if (!FACTORY_SEALED_SNAPSHOT_MIGRATIONS.has(migration)) {
      throw new Error(
        "canonical input snapshot migrations must be the exact objects returned by "
        + "defineCanonicalInputSnapshotMigration",
      );
    }
    if (applied.has(migration.to)) {
      throw new Error(`canonical input snapshot migrations for ${workflowId} form a cycle at ${migration.to}`);
    }
    value = migration.migrate(value);
    hash = migration.to;
    applied.add(hash);
    chain.push(hash);
    if (hash === currentSchemaHash) return value;
  }
  throw new Error(
    `stored canonical input snapshot for ${workflowId} is bound to schema ${stored.schemaHash} and this build `
    + `parses ${currentSchemaHash}; no checked-in snapshot migration reaches it `
    + `(reached ${chain.length === 0 ? "nothing" : chain.join(" → ")}). `
    + `It will not be re-derived from ingress.`,
  );
}

/** The durable key of a checkpoint row; the separator is NUL so two different tuples can never collide, and an absent claim generation appends nothing. */
export function checkpointLookupKey(
  workflowId: string,
  itemId: string,
  nodeId: string,
  attempt: number,
  claimGeneration?: number,
): string {
  const base = [workflowId, itemId, nodeId, String(attempt)];
  if (claimGeneration === undefined) return base.join("\u0000");
  return [...base, String(PositiveIntSchema.parse(claimGeneration))].join("\u0000");
}

export function checkpointRecordKey(record: RunCheckpointRecord): string {
  return checkpointLookupKey(
    record.workflowId,
    record.itemId,
    record.nodeId,
    record.attempt,
    record.claimGeneration,
  );
}
