import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { AssistantModelPreferenceRecordSchema } from "../../../models/dashboard/assistant.js";
import { AssistantModelPreferenceCommandRequestSchema, CommandResultSchema, CommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from '../../../rules/validation/canonical-json.js';
import { commandFromRow } from "./command-record-row.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";

interface Ports {
  database: DatabaseSync;
  read<T>(work: () => T): T;
  mutate<T>(table: "assistant_model_preference", work: () => { result: T; changes: number }): T;
}
export function createAssistantModelPreferenceRepository(ports: Ports) {
  const owner = () => z.object({ profile_id: z.uuid() }).parse(ports.database.prepare("SELECT profile_id FROM database_states WHERE id=1").get()).profile_id;
  function authenticated(commandId: string, auditId: string) {
    const command = ports.database.prepare("SELECT * FROM commands WHERE id=?").get(commandId);
    const request = AssistantModelPreferenceCommandRequestSchema.parse(commandFromRow(command));
    const auditRow = ports.database.prepare("SELECT * FROM command_audits WHERE id=? AND command_id=?").get(auditId, commandId);
    const audit = CommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits", auditRow));
    const auditedRequest = AssistantModelPreferenceCommandRequestSchema.parse(audit.request);
    const result = CommandResultSchema.parse(audit.result);
    if (canonicalJsonStringify(request) !== canonicalJsonStringify(auditedRequest)
      || request.requestedBy !== "local-operator" || request.source.startsWith("assistant")
      || ports.database.prepare('SELECT 1 FROM assistant_actions WHERE command_id = ?').get(commandId) !== undefined
      || canonicalJsonStringify(JSON.parse(z.string().parse(command?.outcome_json))) !== canonicalJsonStringify(audit)
      || request.target.profileId !== owner() || result.state !== "applied" || result.commandId !== commandId
      || result.affectedTargets.length !== 1) throw new Error("assistant-preference-audit-invalid");
    const target = result.affectedTargets[0];
    if (target?.family !== "assistant-model-preference" || target.profileId !== request.target.profileId
      || target.revision !== request.target.expectedRevision + 1
      || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{ target, before: request.target.expectedRevision, after: target.revision }])
      || canonicalJsonStringify(result) !== canonicalJsonStringify({ state: "applied", commandId, affectedTargets: [target] })
      || audit.affectedDependencyIds.length !== 0 || audit.writeResolution !== undefined) throw new Error("assistant-preference-audit-invalid");
    return { request, revision: target.revision, updatedAt: audit.completedAt };
  }
  function get(pendingCommandId?: string) {
    const row = ports.database.prepare("SELECT * FROM assistant_model_preference WHERE id='current'").get();
    const history = ports.database.prepare("SELECT a.id,c.id AS command_id FROM commands c LEFT JOIN command_audits a ON c.id=a.command_id WHERE json_extract(c.request_json,'$.family')='assistant-model-preference' AND json_extract(c.outcome_json,'$.result.state')='applied' AND c.id IS NOT ?").all(pendingCommandId ?? null);
    if (row === undefined) {
      if (history.length !== 0) throw new Error("assistant-preference-current-missing-with-history");
      return undefined;
    }
    const record = AssistantModelPreferenceRecordSchema.parse(nativeOrdinaryRecordFromRow("assistant_model_preference", row));
    const evidence = authenticated(record.commandId, record.auditId);
    const revisions = history.map(value => authenticated(z.string().parse(value.command_id), z.string().parse(value.id)).revision).sort((a, b) => a - b);
    if (record.profileId !== owner() || record.revision !== evidence.revision || record.updatedAt !== evidence.updatedAt
      || canonicalJsonStringify(record.preference) !== canonicalJsonStringify(evidence.request.payload)
      || revisions.length !== record.revision || revisions.some((revision, index) => revision !== index + 1)) {
      throw new Error("assistant-preference-current-divergent");
    }
    return record;
  }
  return Object.freeze({
    get: () => ports.read(() => get()),
    setByCommand(input: unknown) {
      const record = AssistantModelPreferenceRecordSchema.parse(input);
      return ports.mutate("assistant_model_preference", () => {
        const prior = get(record.commandId), evidence = authenticated(record.commandId, record.auditId);
        if (record.profileId !== owner() || record.revision !== (prior?.revision ?? 0) + 1
          || record.revision !== evidence.revision || record.updatedAt !== evidence.updatedAt
          || canonicalJsonStringify(record.preference) !== canonicalJsonStringify(evidence.request.payload)) throw new Error("assistant-preference-cas-conflict");
        const written = ports.database.prepare("INSERT INTO assistant_model_preference(id,profile_id,revision,command_id,audit_id,payload_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,command_id=excluded.command_id,audit_id=excluded.audit_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at WHERE assistant_model_preference.revision=?")
          .run(record.id,record.profileId,record.revision,record.commandId,record.auditId,canonicalJsonStringify(record),record.updatedAt,prior?.revision ?? 0);
        if (written.changes !== 1) throw new Error("assistant-preference-cas-conflict");
        return { result: record, changes: 1 };
      });
    },
  });
}
