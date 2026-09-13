import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { deepFreeze } from "../../domain/immutability.js";
import { CommandAuditRecordSchema } from "../../domain/commands.js";
import { ExplorerEditApplyRequestSchema, ExplorerWorkflowOverrideSchema, type ExplorerEditApplyRequest, type ExplorerWorkflowOverride } from "../../domain/dashboard/explorer.js";
import { applyExplorerPresentationChanges, explorerEditCommandFingerprint, ExplorerOverrideConflictError, type ExplorerOverrideRepository } from "../../domain/dashboard/explorer-override.js";

export const EXPLORER_OVERRIDES_DDL = `CREATE TABLE explorer_overrides (
  record_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision > 0),
  command_id TEXT NOT NULL REFERENCES commands(record_key) ON DELETE RESTRICT,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  CHECK(record_key IS json_extract(record_json,'$.workflowId')),
  CHECK(revision IS json_extract(record_json,'$.revision')),
  CHECK(command_id IS json_extract(record_json,'$.appliedCommandId'))
) STRICT`;

export const EXPLORER_OVERRIDE_CONSTRAINTS = [
  `CREATE TRIGGER explorer_overrides_revision BEFORE UPDATE ON explorer_overrides
    WHEN NEW.record_key IS NOT OLD.record_key OR NEW.revision <> OLD.revision + 1
    BEGIN SELECT RAISE(ABORT,'Explorer override requires next revision'); END`,
  `CREATE TRIGGER explorer_overrides_no_replace BEFORE INSERT ON explorer_overrides
    WHEN EXISTS (SELECT 1 FROM explorer_overrides WHERE record_key=NEW.record_key)
    BEGIN SELECT RAISE(ABORT,'Explorer override already exists'); END`,
  `CREATE TRIGGER explorer_overrides_retained BEFORE DELETE ON explorer_overrides
    BEGIN SELECT RAISE(ABORT,'Explorer appearance restore requires a new revision'); END`,
] as const;

const RowSchema = z.strictObject({ record_key: z.string(), revision: z.number().int().positive(), command_id: z.string(), record_json: z.string() });
const JsonRowSchema = z.strictObject({ record_json: z.string() });

function fromRow(input: unknown): ExplorerWorkflowOverride {
  const row = RowSchema.parse(input);
  const record = ExplorerWorkflowOverrideSchema.parse(JSON.parse(row.record_json));
  if (row.record_key !== record.workflowId || row.revision !== record.revision || row.command_id !== record.appliedCommandId) {
    throw new Error("explorer-override-column-conflict");
  }
  return deepFreeze(record);
}

/** Historical evidence proves its own envelope, never today's descriptor. */
export function assertExplorerOverrideEvidence(database: DatabaseSync, override: ExplorerWorkflowOverride): void {
  const row = database.prepare("SELECT record_json FROM commands WHERE record_key=?").get(override.appliedCommandId);
  const audits = database.prepare("SELECT record_json FROM command_audits WHERE command_id=?").all(override.appliedCommandId);
  if (row === undefined || audits.length !== 1) throw new Error("explorer-override-command-audit-missing");
  const command = ExplorerEditApplyRequestSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json));
  const audit = CommandAuditRecordSchema.parse(JSON.parse(JsonRowSchema.parse(audits[0]).record_json));
  const target = { family: "explorer", workflowId: override.workflowId, revision: override.revision };
  if (command.commandId !== override.appliedCommandId
    || command.target.workflowId !== override.workflowId || command.target.expectedVersion !== override.descriptorVersion
    || command.target.contractFingerprint !== override.contractFingerprint || command.target.expectedOverrideRevision + 1 !== override.revision
    || explorerEditCommandFingerprint(command) !== override.commandFingerprint
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || audit.affectedDependencyIds.length !== 0 || audit.result.state !== "applied" || audit.result.commandId !== command.commandId
    || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
    || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{ target, before: command.target.expectedOverrideRevision, after: override.revision }])) {
    throw new Error("explorer-override-command-audit-conflict");
  }
  const changed = applyExplorerPresentationChanges({}, command);
  for (const key of ["label", "icon", "category"] as const) {
    if (changed[key] !== undefined && override.presentation[key] !== changed[key]) throw new Error("explorer-override-presentation-conflict");
  }
}

export function validateExplorerOverrides(database: DatabaseSync): void {
  for (const row of database.prepare("SELECT * FROM explorer_overrides ORDER BY record_key").iterate()) {
    assertExplorerOverrideEvidence(database, fromRow(row));
  }
}

export function createExplorerOverrideRepository(deps: Readonly<{
  database: DatabaseSync;
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
}>): ExplorerOverrideRepository {
  const { database } = deps;
  const read = (workflowId: string) => {
    const row = database.prepare("SELECT * FROM explorer_overrides WHERE record_key=?").get(workflowId);
    return row === undefined ? undefined : fromRow(row);
  };
  return Object.freeze({
    read,
    readAll: () => deepFreeze(database.prepare("SELECT * FROM explorer_overrides ORDER BY record_key").all().map(fromRow)),
    replace(input: ExplorerEditApplyRequest, value: ExplorerWorkflowOverride) {
      const command = ExplorerEditApplyRequestSchema.parse(input);
      const override = ExplorerWorkflowOverrideSchema.parse(value);
      return deps.mutate(() => {
        const journal = database.prepare("SELECT record_json FROM commands WHERE record_key=?").get(command.commandId);
        if (journal === undefined || canonicalJsonStringify(JSON.parse(JsonRowSchema.parse(journal).record_json)) !== canonicalJsonStringify(command)) {
          throw new Error("explorer-override-command-transaction-required");
        }
        const current = read(command.target.workflowId);
        const revision = current?.revision ?? 0;
        if (revision !== command.target.expectedOverrideRevision) throw new ExplorerOverrideConflictError(command.target.workflowId, command.target.expectedOverrideRevision, revision);
        if (override.workflowId !== command.target.workflowId || override.descriptorVersion !== command.target.expectedVersion
          || override.contractFingerprint !== command.target.contractFingerprint || override.revision !== revision + 1
          || override.appliedCommandId !== command.commandId || override.commandFingerprint !== explorerEditCommandFingerprint(command)) {
          throw new Error("explorer-override-command-conflict");
        }
        const presentation = applyExplorerPresentationChanges(current?.presentation ?? {}, command);
        if (canonicalJsonStringify(presentation) !== canonicalJsonStringify(override.presentation)) throw new Error("explorer-override-presentation-conflict");
        const json = canonicalJsonStringify(override);
        const changed = current === undefined
          ? database.prepare("INSERT INTO explorer_overrides(record_key,revision,command_id,record_json) VALUES (?,?,?,?)").run(override.workflowId, override.revision, command.commandId, json)
          : database.prepare("UPDATE explorer_overrides SET revision=?,command_id=?,record_json=? WHERE record_key=? AND revision=?").run(override.revision, command.commandId, json, override.workflowId, revision);
        const result = read(override.workflowId);
        if (Number(changed.changes) !== 1 || canonicalJsonStringify(result) !== json) throw new Error("Explorer override readback differs from replacement");
        return { result: ExplorerWorkflowOverrideSchema.parse(result), changes: 1 };
      });
    },
  });
}
