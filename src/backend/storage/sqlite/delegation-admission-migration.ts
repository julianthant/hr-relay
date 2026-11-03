import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { DelegationAdmissionRequestSchema, DelegationInvocationRequestSchema, DelegationScopeEvidenceSchema } from "./delegation-contracts.js";
import { validateNativeLifecycleRequest } from "./native-lifecycle-request.js";

const PredecessorAdmissionSchema = DelegationAdmissionRequestSchema.pick({ commandId: true, runId: true, expectedVersion: true, claim: true }).extend({
  invocationCommandId: z.uuid(), scopeEvidence: DelegationScopeEvidenceSchema, observedScopeDigest: z.string().regex(/^[0-9a-f]{64}$/u),
});
const ObjectSchema = z.record(z.string(), z.unknown());
export const DELEGATION_ADMISSION_CONVERSION_ID = sha256Hex("relay:delegation-admission:ordered-members:v1");

function convertCommand(database: DatabaseSync, input: unknown) {
  const command = RunLifecycleCommandRecordSchema.parse(input);
  if (command.operation !== "delegation-admission") return command;
  const previous = PredecessorAdmissionSchema.parse(command.request);
  if (command.commandId !== previous.commandId
    || command.requestFingerprint !== sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-admission\0${canonicalJsonStringify(previous)}`)
    || canonicalJsonStringify(command.fence) !== canonicalJsonStringify({ kind: "terminal", expectedVersion: previous.expectedVersion, ...previous.claim })) {
    throw new Error("delegation-admission-predecessor-binding-mismatch");
  }
  const row = z.object({ request_json: z.string() }).parse(database.prepare("SELECT request_json FROM commands WHERE id=?").get(previous.invocationCommandId));
  const invocationCommand = RunLifecycleCommandRecordSchema.parse(JSON.parse(row.request_json));
  validateNativeLifecycleRequest(invocationCommand);
  if (invocationCommand.operation !== "delegation-invocation") throw new Error("delegation-admission-predecessor-invocation-unavailable");
  const invocation = DelegationInvocationRequestSchema.parse(invocationCommand.request);
  if (invocation.commandId !== previous.invocationCommandId || invocation.runId !== previous.runId) throw new Error("delegation-admission-predecessor-binding-mismatch");
  const { invocationCommandId, scopeEvidence, observedScopeDigest, ...owner } = previous;
  const request = DelegationAdmissionRequestSchema.parse({ ...owner, nodeId: invocation.nodeId,
    members: [{ state: "admitted", nodeId: invocation.nodeId, invocationCommandId, scopeEvidence, observedScopeDigest }] });
  const converted = RunLifecycleCommandRecordSchema.parse({ ...command, request,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-admission\0${canonicalJsonStringify(request)}`) });
  validateNativeLifecycleRequest(converted);
  return converted;
}

function convertAudit(database: DatabaseSync, input: unknown) {
  const audit = RunLifecycleCommandAuditRecordSchema.parse(input);
  return RunLifecycleCommandAuditRecordSchema.parse({ ...audit, request: convertCommand(database, audit.request) });
}

export function convertDelegationAdmissionRow(database: DatabaseSync, table: string, input: unknown): Record<string, unknown> {
  const row = ObjectSchema.parse(input);
  if (table === "commands" && row.family === "run-lifecycle") {
    const previous = RunLifecycleCommandRecordSchema.parse(JSON.parse(z.string().parse(row.request_json)));
    if (previous.operation !== "delegation-admission") return row;
    if (row.request_digest !== sha256Hex(canonicalJsonStringify(previous))) throw new Error("command-row-identity-mismatch");
    const command = convertCommand(database, previous), json = canonicalJsonStringify(command);
    if (row.outcome_json === null) return { ...row, request_json: json, request_digest: sha256Hex(json) };
    const audit = RunLifecycleCommandAuditRecordSchema.parse(JSON.parse(z.string().parse(row.outcome_json)));
    if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(previous)) throw new Error("command-row-outcome-mismatch");
    return { ...row, request_json: json, request_digest: sha256Hex(json), outcome_json: canonicalJsonStringify(convertAudit(database, audit)) };
  }
  if (table === "command_audits") {
    const audit = ObjectSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    if (audit.kind === "run-lifecycle" && ObjectSchema.parse(audit.request).operation === "delegation-admission") {
      return { ...row, payload_json: canonicalJsonStringify(convertAudit(database, audit)) };
    }
  }
  return row;
}

export function migrateDelegationAdmissions(database: DatabaseSync): void {
  const changes = ["commands", "command_audits"].flatMap(table => database.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row =>
    ({ table, before: row, after: convertDelegationAdmissionRow(database, table, row) })));
  for (const { table, before, after } of changes) {
    if (canonicalJsonStringify(before) === canonicalJsonStringify(after)) continue;
    if (table === "commands") database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
      .run(z.string().parse(after.request_json), z.string().parse(after.request_digest), z.string().nullable().parse(after.outcome_json), z.string().parse(after.id));
    else database.prepare("UPDATE command_audits SET payload_json=? WHERE id=?").run(z.string().parse(after.payload_json), z.string().parse(after.id));
  }
}
