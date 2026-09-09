import { z } from "zod";
import { deepFreeze } from "./immutability.js";
import { RunRecordSchema, RunStateSchema } from "./run/record.js";
import { DeletedRunRecordSchema } from "./run/deleted-run.js";
import {
  CommandAuditIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  NonNegativeIntSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "./ids.js";

export const AuthorityTableNameSchema = z.enum([
  "authority_meta",
  "workflow_runs",
  "run_terminal_authorizations",
  "failures",
  "run_results",
  "run_terminal_outbox",
  "diagnostic_bundles",
  "diagnostic_attachments",
  "evidence_receipts",
  "dry_run_scenario_results",
  "operator_xlsx_exports",
  "activity_person_pseudonyms",
  "activity_person_pseudonym_generations",
  "knowledge_records",
  "fix_records",
  "ledger_partitions",
  "ledger_projections",
  "provider_budget_counters",
  "provider_admissions",
  "workflow_workers",
  "delegation_dependencies",
  "run_delegations",
  "commands",
  "command_audits",
  "notifications",
  "config_snapshots",
  "settings_current",
  "runtime_config",
  "version_plans",
  "checkpoint_payloads",
  "run_checkpoints",
  "workflow_run_requests",
  "ocr_approvals",
  "run_operations",
  "run_operation_attempts",
  "operation_outbox",
  "artifact_outbox",
  "artifact_sink_heads",
  "intake_sessions",
  "intake_manifests",
  "ocr_extractions",
  "version_bump_applications",
  "archived_runs",
  "archive_relaunches",
  "worker_auth",
  "worker_pools",
  "workflow_run_batches",
  "deleted_runs",
  "authority_upgrades",
  "timeline_events",
]);

export const ProjectionTableNameSchema = z.enum([
  "spans",
  "gates",
  "notes",
]);

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
  toSchemaVersion: z.union([z.literal(30), z.literal(31), z.literal(32), z.literal(33), z.literal(34), z.literal(35), z.literal(36), z.literal(37), z.literal(38)]),
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
  toSchemaVersion: z.union([z.literal(32), z.literal(33), z.literal(34), z.literal(35), z.literal(36), z.literal(37), z.literal(38)]),
  backupManifest: z.string().min(1),
  ordinaryRevision: PositiveIntSchema,
  ordinaryFingerprint: FingerprintSchema,
  orphanGateRecordsRemoved: NonNegativeIntSchema,
  sourceFiles: z.array(z.string().min(1)),
  credentialCommandId: CommandIdSchema,
  credentialWriteId: z.uuid(),
  importedKeys: z.array(z.string().min(1)),
  envKeysToRemove: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/u)),
  timelineImport: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("fresh"), imported: z.literal(0), excludedDeleted: z.literal(0) }),
    z.strictObject({ state: z.literal("imported"), manifestDigest: FingerprintSchema,
      copyDirectory: z.string().min(1), backupSha256: FingerprintSchema,
      imported: NonNegativeIntSchema, excludedDeleted: NonNegativeIntSchema }),
  ]).optional(),
}).superRefine((record, context) => {
  if ((record.toSchemaVersion === 38) !== (record.timelineImport !== undefined)) {
    context.addIssue({ code: "custom", message: "timeline import evidence must match its upgrade version" });
  }
  if (record.timelineImport?.state === "fresh" && record.fromSchemaVersion !== 0) {
    context.addIssue({ code: "custom", message: "existing authority requires verified timeline source evidence" });
  }
});

export const AuthorityUpgradeRecordSchema = z.union([
  AuthorityUpgradeBaselineRecordSchema,
  AuthorityUpgradeExecutionRecordSchema,
  SqliteSettingsUpgradeRecordSchema,
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
