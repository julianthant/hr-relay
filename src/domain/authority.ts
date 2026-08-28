import { z } from "zod";
import { deepFreeze } from "./immutability.js";

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
  "capture_sessions",
  "capture_photo_order",
  "capture_finalization_outboxes",
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
