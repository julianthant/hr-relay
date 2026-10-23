import { validateNativeLifecycleRequest } from "./native-lifecycle-request.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { StoredAuthorityCommandRecordSchema, AuthorityCommandAuditRecordSchema, CommandIdentityConflictError } from "../../../rules/commands/commands.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../models/config/settings-initialization.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import type { CommandApplication } from "../../runs/commands/command-application.js";
import type { AuthorityRepositories } from "./authority-database.js";

let activeRunCommand: Readonly<{ repositories: AuthorityRepositories; request: string }> | undefined;

export function withCanonicalRunCommandScope(repositories: AuthorityRepositories, request: CommandRequest,
  work: () => CommandApplication, parentCommandId?: string): CommandApplication {
  if (activeRunCommand !== undefined || request.family !== "run" || (request.type !== "retry" && request.type !== "cancel")) {
    throw new Error("canonical-run-command-scope-unavailable");
  }
  repositories.commands.assertIdentity(request, parentCommandId);
  if (canonicalJsonStringify(repositories.commands.get(request.commandId)) !== canonicalJsonStringify(request)
    || repositories.commandAudits.findByCommand(request.commandId) !== undefined) throw new Error("canonical-run-command-scope-unavailable");
  activeRunCommand = { repositories, request: canonicalJsonStringify(request) };
  try {
    const result = work();
    if ("then" in result) throw new Error("canonical-run-command-scope-must-be-synchronous");
    return result;
  } finally {
    activeRunCommand = undefined;
  }
}

export function assertCanonicalRunCommandScope(repositories: AuthorityRepositories, request: CommandRequest): void {
  if (activeRunCommand?.repositories !== repositories || activeRunCommand.request !== canonicalJsonStringify(request)) {
    throw new Error("canonical-run-command-scope-unavailable");
  }
}

export const NativeCommandRequestSchema = z.union([StoredAuthorityCommandRecordSchema, SettingsInitializationCommandSchema]);
export const NativeCommandAuditSchema = z.union([AuthorityCommandAuditRecordSchema, SettingsInitializationAuditSchema]);
const RowSchema = z.strictObject({
  id: z.string(), family: z.string(), actor_id: z.string(), parent_id: z.string().nullable(), target_id: z.string().nullable(),
  request_digest: z.string(), request_json: z.string(), state: z.enum(["admitted", "executing", "succeeded", "refused", "uncertain"]),
  outcome_json: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
});
export function commandIdentity(input: unknown) {
  const request = NativeCommandRequestSchema.parse(input);
  if ("kind" in request && request.kind === "run-lifecycle") validateNativeLifecycleRequest(request);
  const family = "kind" in request ? request.kind : request.family;
  const actor = "requestedBy" in request ? request.requestedBy : "acceptance" in request ? request.acceptance.request.requestedBy : LOCAL_OPERATOR_ACTOR_ID;
  const createdAt = "requestedAt" in request ? request.requestedAt : "recordedAt" in request ? request.recordedAt
    : "initializedAt" in request ? request.initializedAt : request.acceptance.request.requestedAt;
  const internalTarget = "kind" in request && request.kind === "run-lifecycle"
    ? z.object({runId:z.string().optional(),bundleId:z.string().optional(),
      terminal:z.object({result:z.object({runId:z.string()}).optional(),authorization:z.object({runId:z.string()}).optional()}).optional()}).parse(request.request) : undefined;
  const target: unknown = "target" in request ? Object.entries(request.target).find(([key, value]) => key.endsWith("Id") && typeof value === "string")?.[1]
    : internalTarget?.runId ?? internalTarget?.terminal?.result?.runId ?? internalTarget?.terminal?.authorization?.runId ?? internalTarget?.bundleId;
  const targetId = typeof target === "string" ? target : null;
  return { request, family, actor, createdAt, targetId, json: canonicalJsonStringify(request) };
}
export function commandFromRow(input: unknown) {
  const row = RowSchema.parse(input);
  const identity = commandIdentity(JSON.parse(row.request_json));
  if (row.id !== identity.request.commandId || row.family !== identity.family || row.actor_id !== identity.actor
    || row.target_id !== identity.targetId || row.request_digest !== sha256Hex(identity.json) || row.created_at !== identity.createdAt) {
    throw new Error("command-row-identity-mismatch");
  }
  if (row.outcome_json !== null) {
    const audit = NativeCommandAuditSchema.parse(JSON.parse(row.outcome_json));
    if (canonicalJsonStringify(audit.request) !== identity.json || audit.completedAt !== row.updated_at
      || commandAuditState(audit) !== row.state) throw new Error("command-row-outcome-mismatch");
  } else if (row.state === "succeeded" || row.state === "refused" || row.state === "uncertain") {
    if (!("kind" in identity.request && identity.request.kind === "bulk-parent" && row.state === "succeeded")) throw new Error("command-row-outcome-missing");
  }
  return identity.request;
}
function commandAuditState(input: z.infer<typeof NativeCommandAuditSchema>) {
  if (!("state" in input.result)) return "succeeded" as const;
  if (["applied", "already-applied", "initialized"].includes(input.result.state)) return "succeeded" as const;
  return "refused" as const;
}
export function insertNativeCommand(database: DatabaseSync, input: unknown, parentId?: string): number {
  const identity = commandIdentity(input);
  const existing = database.prepare("SELECT * FROM commands WHERE id=?").get(identity.request.commandId);
  if (existing !== undefined) {
    if (canonicalJsonStringify(commandFromRow(existing)) !== identity.json || RowSchema.parse(existing).parent_id !== (parentId ?? null)) throw new CommandIdentityConflictError();
    return 0;
  }
  return Number(database.prepare("INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,NULL,?,?)")
    .run(identity.request.commandId, identity.family, identity.actor, parentId ?? null, identity.targetId, sha256Hex(identity.json), identity.json,
      identity.family === "bulk-parent" ? "succeeded" : "admitted", identity.createdAt, identity.createdAt).changes);
}
export function settleNativeCommand(database: DatabaseSync, input: unknown): void {
  const audit = NativeCommandAuditSchema.parse(input);
  const row = database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
  if (row === undefined || canonicalJsonStringify(commandFromRow(row)) !== canonicalJsonStringify(audit.request)) throw new Error("command-audit-request-mismatch");
  const existing = RowSchema.parse(row).outcome_json, json = canonicalJsonStringify(audit);
  if (existing !== null) {
    if (existing !== json) throw new Error("command-audit-outcome-conflict");
    return;
  }
  const changes = Number(database.prepare("UPDATE commands SET state=?,outcome_json=?,updated_at=? WHERE id=? AND outcome_json IS NULL")
    .run(commandAuditState(audit), json, audit.completedAt, audit.request.commandId).changes);
  if (changes !== 1) throw new Error("command-audit-state-conflict");
}
