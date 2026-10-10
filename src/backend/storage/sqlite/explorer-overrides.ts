import { commandFromRow } from "./command-record-row.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { CommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { ExplorerEditApplyRequestSchema, ExplorerWorkflowOverrideSchema, type ExplorerEditApplyRequest, type ExplorerWorkflowOverride } from "../../../models/dashboard/explorer.js";
import { applyExplorerPresentationChanges, explorerEditCommandFingerprint, ExplorerOverrideConflictError, type ExplorerOverrideRepository } from "../../../models/dashboard/explorer-override.js";

const RowSchema = z.strictObject({ id: z.string(), revision: z.number().int().positive(), command_id: z.string(), payload_json: z.string() });

function fromRow(input: unknown): ExplorerWorkflowOverride {
  const row = RowSchema.parse(input);
  const record = ExplorerWorkflowOverrideSchema.parse(JSON.parse(row.payload_json));
  if (row.id !== record.workflowId || row.revision !== record.revision || row.command_id !== record.appliedCommandId) {
    throw new Error("explorer-override-column-conflict");
  }
  return deepFreeze(record);
}

// Retained evidence proves its stored envelope, not the current descriptor.
export function assertExplorerOverrideEvidence(database: DatabaseSync, override: ExplorerWorkflowOverride): void {
  const row = database.prepare("SELECT * FROM commands WHERE id=?").get(override.appliedCommandId);
  const audits = database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(override.appliedCommandId);
  if (row === undefined || audits.length !== 1) throw new Error("explorer-override-command-audit-missing");
  const command = ExplorerEditApplyRequestSchema.parse(commandFromRow(row));
  const audit = CommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",audits[0]));
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
  for (const row of database.prepare("SELECT * FROM explorer_overrides ORDER BY id").iterate()) {
    assertExplorerOverrideEvidence(database, fromRow(row));
  }
}

export function createExplorerOverrideRepository(deps: Readonly<{
  database: DatabaseSync;
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
}>): ExplorerOverrideRepository {
  const { database } = deps;
  const read = (workflowId: string) => {
    const row = database.prepare("SELECT * FROM explorer_overrides WHERE id=?").get(workflowId);
    return row === undefined ? undefined : fromRow(row);
  };
  return Object.freeze({
    read,
    readAll: () => deepFreeze(database.prepare("SELECT * FROM explorer_overrides ORDER BY id").all().map(fromRow)),
    replace(input: ExplorerEditApplyRequest, value: ExplorerWorkflowOverride) {
      const command = ExplorerEditApplyRequestSchema.parse(input);
      const override = ExplorerWorkflowOverrideSchema.parse(value);
      return deps.mutate(() => {
        const journal = database.prepare("SELECT * FROM commands WHERE id=?").get(command.commandId);
        if (journal === undefined || canonicalJsonStringify(commandFromRow(journal)) !== canonicalJsonStringify(command)) {
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
          ? database.prepare("INSERT INTO explorer_overrides(id,revision,command_id,payload_json) VALUES (?,?,?,?)").run(override.workflowId, override.revision, command.commandId, json)
          : database.prepare("UPDATE explorer_overrides SET revision=?,command_id=?,payload_json=? WHERE id=? AND revision=?").run(override.revision, command.commandId, json, override.workflowId, revision);
        const result = read(override.workflowId);
        if (Number(changed.changes) !== 1 || canonicalJsonStringify(result) !== json) throw new Error("Explorer override readback differs from replacement");
        return { result: ExplorerWorkflowOverrideSchema.parse(result), changes: 1 };
      });
    },
  });
}
