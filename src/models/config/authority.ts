import { z } from "zod";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { RunRecordSchema, RunStateSchema } from "../run/record.js";
import { DeletedRunRecordSchema } from "../run/deleted-run.js";
import {
  CommandAuditIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "../../rules/identity/ids.js";

export const AuthorityTableNameSchema = z.enum([
  "database_states",
  "database_upgrades",
  "settings_snapshots",
  "commands",
  "command_audits",
  "settings",
  "run_batches",
  "deleted_runs",
  "runs",
  "run_requests",
  "run_delegations",
  "delegation_dependencies",
  "run_checkpoints",
  "gate_results",
  "run_results",
  "run_failures",
  "run_receipts",
  "write_intents",
  "write_attempts",
  "worker_pools",
  "worker_slots",
  "worker_leases",
  "worker_controls",
  "browser_sessions",
  "auth_leases",
  "notifications",
  "notification_states",
  "explorer_overrides",
  "artifacts",
  "timeline_events",
  "diagnostic_snapshots",
  "diagnostic_files",
  "dryrun_results",
  "run_search",
]);

export const ProjectionTableNameSchema = z.enum([]);

export const TableNameSchema = z.union([AuthorityTableNameSchema, ProjectionTableNameSchema]);
export const TableClassSchema = z.enum(["authority", "projection"]);
const ALL_TABLE_NAMES = [...AuthorityTableNameSchema.options, ...ProjectionTableNameSchema.options];

const AuthorityTableSpecSchema = z.strictObject({
  name: AuthorityTableNameSchema,
  classification: z.literal("authority"),
  schemaVersion: z.literal(1),
  generationAccounting: z.literal("outer-authority-transaction"),
  recovery: z.literal("verified-backup-required"),
});

const ProjectionTableSpecSchema = z.strictObject({
  name: ProjectionTableNameSchema,
  classification: z.literal("projection"),
  schemaVersion: z.literal(1),
  generationAccounting: z.literal("none"),
  recovery: z.literal("rebuild-from-native-jsonl"),
});

export const TableSpecSchema = z.discriminatedUnion("classification", [
  AuthorityTableSpecSchema,
  ProjectionTableSpecSchema,
]);

export const AuthorityTableRegistrySchema = z.array(TableSpecSchema).superRefine((entries, context) => {
  const names = entries.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: "custom", message: "authority table registry names must be unique" });
  }
  for (const name of ALL_TABLE_NAMES) {
    if (!names.includes(name)) {
      context.addIssue({ code: "custom", message: `authority table registry omits ${name}` });
    }
  }
});

const authority = (name: z.infer<typeof AuthorityTableNameSchema>) => ({
  name,
  classification: "authority" as const,
  schemaVersion: 1 as const,
  generationAccounting: "outer-authority-transaction" as const,
  recovery: "verified-backup-required" as const,
});

const projection = (name: z.infer<typeof ProjectionTableNameSchema>) => ({
  name,
  classification: "projection" as const,
  schemaVersion: 1 as const,
  generationAccounting: "none" as const,
  recovery: "rebuild-from-native-jsonl" as const,
});

export const AUTHORITY_TABLE_REGISTRY = deepFreeze(AuthorityTableRegistrySchema.parse([
  ...AuthorityTableNameSchema.options.map(authority),
  ...ProjectionTableNameSchema.options.map(projection),
]));

export function auditAuthorityTableRegistry(input: unknown): readonly string[] {
  const parsed = AuthorityTableRegistrySchema.safeParse(input);
  if (!parsed.success) return ["authority table registry failed strict parsing"];
  return [];
}

export type AuthorityTableName = z.infer<typeof AuthorityTableNameSchema>;
export type ProjectionTableName = z.infer<typeof ProjectionTableNameSchema>;
export type TableName = z.infer<typeof TableNameSchema>;
export type TableSpec = z.infer<typeof TableSpecSchema>;

export const AuthorityUpgradePhaseSchema = z.enum([
  "baseline",
  "planned",
  "committed",
  "settled",
]);

const AuthorityUpgradeRecordBaseSchema = z.strictObject({
  recordKey: z.uuid(),
  upgradeId: z.union([z.literal("fresh"), FingerprintSchema]),
  fromSchemaVersion: NonNegativeIntSchema,
  toSchemaVersion: PositiveIntSchema,
  by: z.literal(LOCAL_OPERATOR_ACTOR_ID),
  recordedAt: IsoInstantSchema,
});

const AuthorityUpgradeBaselineRecordSchema = AuthorityUpgradeRecordBaseSchema.extend({
  upgradeId: z.literal("fresh"),
  phase: z.literal("baseline"),
  fromSchemaVersion: z.literal(0),
  toSchemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

const AuthorityForwardUpgradeRecordSchema = AuthorityUpgradeRecordBaseSchema.extend({
  upgradeId: FingerprintSchema,
  phase: z.enum(["planned", "committed", "settled"]),
  planDigest: FingerprintSchema,
  backup: z.strictObject({
    manifestPath: z.string().min(1),
    sha256: FingerprintSchema,
    authorityGeneration: NonNegativeIntSchema,
  }),
});

export const AuthorityUpgradeRecordSchema = z.union([
  AuthorityUpgradeBaselineRecordSchema,
  AuthorityForwardUpgradeRecordSchema,
]);
export type AuthorityUpgradeRecord = z.infer<typeof AuthorityUpgradeRecordSchema>;

export const ProtectedSettingsEntrySchema = z.strictObject({
  name: z.string().min(1),
  valueId: z.uuid(),
  updatedAt: IsoInstantSchema,
});

/** The protected document's journal identity; never a value, digest, or length. */
export const ProtectedSettingsCurrentRecordSchema = z.strictObject({
  revision: PositiveIntSchema,
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  auditId: CommandAuditIdSchema,
  committedAt: IsoInstantSchema,
  entries: z.array(ProtectedSettingsEntrySchema),
}).superRefine((record, context) => {
  if (record.revision < 2) {
    context.addIssue({
      code: "custom",
      path: ["revision"],
      message: "protected settings current authority begins at the first applied revision 2",
    });
  }
  const names = record.entries.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    context.addIssue({
      code: "custom",
      path: ["entries"],
      message: "protected settings current entry names must be unique",
    });
  }
});
export type ProtectedSettingsCurrentRecord = z.infer<typeof ProtectedSettingsCurrentRecordSchema>;

/** Evidence cannot manufacture a lifecycle row. */
export const RunExistenceSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), runId: RunIdSchema }),
  z.strictObject({
    state: z.literal("present"),
    disposition: z.literal("live"),
    run: RunRecordSchema,
  }),
  z.strictObject({ state: z.literal("deleted"), tombstone: DeletedRunRecordSchema }),
]);
export type RunExistence = z.infer<typeof RunExistenceSchema>;

/** Expected refusals are data; storage failures still propagate. */
export const RunRecordRefusalSchema = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("conflict"), currentVersion: PositiveIntSchema }),
  z.strictObject({ reason: z.literal("identity-conflict"), field: z.enum(["runId", "attempt", "runNumber", "itemId", "sessionId"]) }),
  z.strictObject({ reason: z.literal("illegal-transition"), from: RunStateSchema, to: RunStateSchema, message: z.string().min(1) }),
  z.strictObject({ reason: z.literal("worker-busy"), runId: RunIdSchema }),
  z.strictObject({ reason: z.literal("none-eligible"), notBefore: IsoInstantSchema.optional() }),
  z.strictObject({ reason: z.literal("tree-non-terminal"), runId: RunIdSchema }),
  z.strictObject({ reason: z.literal("schema-mismatch"), digest: FingerprintSchema }),
  z.strictObject({ reason: z.enum([
    "parent-missing", "retry-of-missing", "tombstoned", "runtime-stale", "cursor-stale",
    "owned-by-worker", "lost", "replay-divergent", "heartbeat-live", "invalid-state",
    "source-deleted", "not-terminal", "already-archived", "workflow-unregistered",
    "is-member", "use-archive-door", "retention-not-due", "policy-refused", "shared-checkpoint", "unresolved-write",
  ]) }),
]);
export type RunRecordRefusal = z.infer<typeof RunRecordRefusalSchema>;
