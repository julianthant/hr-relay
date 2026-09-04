import { z } from "zod";
import { deepFreeze } from "./immutability.js";
import {
  CommandAuditIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  NonNegativeIntSchema,
  PositiveIntSchema,
} from "./ids.js";

export const AuthorityTableNameSchema = z.enum([
  "authority_meta",
  "tasks",
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
  "leases",
  "dependencies",
  "delegation_manifests",
  "commands",
  "command_audits",
  "bulk_command_acceptances",
  "notifications",
  "config_snapshots",
  "settings_current",
  "runtime_config",
  "version_plans",
  "checkpoint_payloads",
  "run_checkpoints",
  "start_plans",
  "ocr_approvals",
  "write_intents",
  "write_attempts",
  "durable_outbox",
  "artifact_outbox",
  "artifact_sink_heads",
  "intake_sessions",
  "intake_manifests",
  "ocr_extractions",
  "version_bump_applications",
  "archived_runs",
  "archive_relaunches",
  "duo_ceremony_leases",
  "worker_pools",
  "run_sessions",
  "deleted_runs",
  "protected_settings_current",
  "authority_upgrades",
]);

export const ProjectionTableNameSchema = z.enum([
  "spans",
  "gates",
  "notes",
  "runs_view",
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

/** D332.5 — append-only upgrade evidence; protected values never enter this record. */
export const AuthorityUpgradeRecordSchema = z.discriminatedUnion("phase", [
  AuthorityUpgradeBaselineRecordSchema,
  AuthorityUpgradeExecutionRecordSchema,
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
