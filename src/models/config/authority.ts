import { ExplorerOverrideImportReceiptSchema } from "../dashboard/explorer-override.js";
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
  "transaction_selection", "run_search_index", "run_search_grams", "run_search_publication", "run_search_declarations", "run_search_actors",
  "run_summaries", "summary_publication", "archive_transfers", "version_changes",
  "database_state",
  "explorer_overrides",
  "workflow_runs",
  "run_failures",
  "run_results",
  "diagnostic_snapshots",
  "diagnostic_files",
  "run_receipts",
  "dryrun_results",
  "generated_artifacts",
  "provider_usage",
  "provider_requests",
  "workflow_workers",
  "delegation_dependencies",
  "run_delegations",
  "commands",
  "command_audits",
  "notifications", "notification_publications", "notification_health",
  "settings_snapshots",
  "app_settings",
  "version_plans",
  "checkpoint_payloads",
  "run_checkpoints",
  "workflow_run_requests",
  "run_operations",
  "run_operation_attempts",
  "imported_artifacts",
  "extracted_artifacts",
  "version_bump_applications",
  "archived_runs",
  "worker_auth",
  "worker_pools",
  "worker_controls",
  "worker_browsers",
  "workflow_run_batches",
  "deleted_runs",
  "database_upgrades",
  "timeline_events",
  "timeline_operation_sources",
  "runtime_versions", "runtime_version_adoptions", "runtime_version_changes",
]);

export const ProjectionTableNameSchema = z.enum([]);

export const TableNameSchema = z.union([AuthorityTableNameSchema, ProjectionTableNameSchema]);
export const TableClassSchema = z.enum(["authority", "projection"]);
/** Kept in the name grammar only for released backup/deletion compatibility. */
const RETIRED_ARCHIVE_TABLES: readonly string[] = ["archived_runs", "version_plans", "version_bump_applications"];
const CURRENT_AUTHORITY_TABLE_NAMES = AuthorityTableNameSchema.options.filter(name => !RETIRED_ARCHIVE_TABLES.includes(name));
const ALL_TABLE_NAMES = [...CURRENT_AUTHORITY_TABLE_NAMES, ...ProjectionTableNameSchema.options];

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
  ...CURRENT_AUTHORITY_TABLE_NAMES.map(authority),
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
  toSchemaVersion: z.union([z.literal(30), z.literal(31), z.literal(32), z.literal(33), z.literal(34), z.literal(35), z.literal(36), z.literal(37), z.literal(38), z.literal(39), z.literal(40), z.literal(41), z.literal(42), z.literal(43), z.literal(44), z.literal(45), z.literal(46), z.literal(47), z.literal(48), z.literal(49), z.literal(50), z.literal(51), z.literal(52), z.literal(53), z.literal(54), z.literal(55)]),
});

const AuthorityUpgradeBaselineV56Schema = AuthorityUpgradeRecordBaseSchema.extend({
  upgradeId: z.literal("fresh"),
  phase: z.literal("baseline"),
  fromSchemaVersion: z.literal(0),
  toSchemaVersion: z.literal(56),
});

const AuthorityUpgradeExecutionRecordSchema = AuthorityUpgradeRecordBaseSchema.extend({
  upgradeId: FingerprintSchema,
  phase: z.enum(["planned", "committed", "settled"]),
  planDigest: FingerprintSchema,
  backup: z.strictObject({
    manifestPath: z.string().min(1),
    sha256: FingerprintSchema,
    authorityGeneration: NonNegativeIntSchema,
  }),
  settings: z.strictObject({
    ordinaryRevisionBefore: PositiveIntSchema,
    ordinaryRevisionAfter: PositiveIntSchema,
    settingsFingerprintAfter: FingerprintSchema,
    settingsSchemaHashAfter: FingerprintSchema,
    protectedRevisionAfter: PositiveIntSchema,
    protectedEntryNames: z.array(z.string().min(1)),
  }),
  tombstoneBackfill: z.strictObject({
    fromRoots: NonNegativeIntSchema,
    fromReconstructedRoots: NonNegativeIntSchema,
    unknown: NonNegativeIntSchema,
  }),
  orphanGateRecordsRemoved: NonNegativeIntSchema,
  historicalExposure: z.array(z.literal("operator.timekeeperName")),
  envKeysToRemove: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/u)),
});

export const TombstoneBackfillCountsSchema = z.strictObject({
  fromRoots: NonNegativeIntSchema,
  fromReconstructedRoots: NonNegativeIntSchema,
  unknown: NonNegativeIntSchema,
  missingRunNumber: NonNegativeIntSchema,
});

/** D336 observations never authenticate or gate the independent credential store. */
const SqliteSettingsUpgradeRecordSchema = AuthorityUpgradeRecordBaseSchema.extend({
  format: z.literal(3),
  historicalExposure: z.array(z.literal("operator.timekeeperName")),
  tombstoneBackfill: TombstoneBackfillCountsSchema,
  upgradeId: FingerprintSchema,
  phase: z.enum(["committed", "settled"]),
  toSchemaVersion: z.union([z.literal(32), z.literal(33), z.literal(34), z.literal(35), z.literal(36), z.literal(37), z.literal(38), z.literal(39), z.literal(40), z.literal(41), z.literal(42), z.literal(43), z.literal(44), z.literal(45), z.literal(46), z.literal(47), z.literal(48), z.literal(49), z.literal(50), z.literal(51), z.literal(52), z.literal(53), z.literal(54), z.literal(55)]),
  backupManifest: z.string().min(1),
  ordinaryRevision: PositiveIntSchema,
  ordinaryFingerprint: FingerprintSchema,
  orphanGateRecordsRemoved: NonNegativeIntSchema,
  sourceFiles: z.array(z.string().min(1)),
  credentialCommandId: CommandIdSchema,
  credentialWriteId: z.uuid(),
  importedKeys: z.array(z.string().min(1)),
  envKeysToRemove: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/u)),
  explorerImport: ExplorerOverrideImportReceiptSchema.optional(),
  generatedImport: z.strictObject({manifestDigest: FingerprintSchema, copyDirectory: z.string().min(1), backupSha256: FingerprintSchema}).optional(),
  timelineImport: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("fresh"), imported: z.literal(0), excludedDeleted: z.literal(0) }),
    z.strictObject({ state: z.literal("imported"), manifestDigest: FingerprintSchema,
      copyDirectory: z.string().min(1), backupSha256: FingerprintSchema,
      imported: NonNegativeIntSchema, excludedDeleted: NonNegativeIntSchema }),
  ]).optional(),
}).superRefine((record, context) => {
  if ((record.toSchemaVersion >= 51) !== (record.explorerImport !== undefined)) {
    context.addIssue({ code: "custom", message: "Explorer import receipt must match its upgrade version" });
  }
  if ((record.toSchemaVersion >= 38) !== (record.timelineImport !== undefined)) {
    context.addIssue({ code: "custom", message: "timeline import evidence must match its upgrade version" });
  }
  if (record.timelineImport?.state === "fresh" && record.fromSchemaVersion !== 0) {
    context.addIssue({ code: "custom", message: "existing authority requires verified timeline source evidence" });
  }
});

export const AuthorityCapabilityUpgradeRecordSchema = AuthorityUpgradeRecordBaseSchema.extend({
  format: z.literal(4),
  phase: z.literal("settled"),
  fromSchemaVersion: z.literal(55),
  toSchemaVersion: z.literal(56),
  sourceGeneration: NonNegativeIntSchema,
  sourceFingerprint: FingerprintSchema,
  backupManifest: z.string().min(1),
  backupSha256: FingerprintSchema,
});

export const AuthorityUpgradeRecordSchema = z.union([
  AuthorityUpgradeBaselineRecordSchema,
  AuthorityUpgradeBaselineV56Schema,
  AuthorityUpgradeExecutionRecordSchema,
  SqliteSettingsUpgradeRecordSchema,
  AuthorityCapabilityUpgradeRecordSchema,
]);
export type AuthorityUpgradeRecord = z.infer<typeof AuthorityUpgradeRecordSchema>;

export const ProtectedSettingsEntrySchema = z.strictObject({
  name: z.string().min(1),
  valueId: z.uuid(),
  updatedAt: IsoInstantSchema,
});

/** D331.4 — the protected document's journal identity; never a value, digest, or length. */
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

/** D330.2: evidence cannot manufacture a lifecycle row. */
export const RunExistenceSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), runId: RunIdSchema }),
  z.strictObject({
    state: z.literal("present"),
    disposition: z.enum(["live", "archived"]),
    run: RunRecordSchema,
  }),
  z.strictObject({ state: z.literal("deleted"), tombstone: DeletedRunRecordSchema }),
]);
export type RunExistence = z.infer<typeof RunExistenceSchema>;

/** D330.5: expected refusals are data; storage failures still propagate. */
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
    "is-member", "use-archive-door", "retention-not-due", "policy-refused",
  ]) }),
]);
export type RunRecordRefusal = z.infer<typeof RunRecordRefusalSchema>;
