import { validateNativeLifecycleRequest } from "./native-lifecycle-request.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AssistantCommandAttributionSchema, CommandAuditRecordSchema, StoredAuthorityCommandRecordSchema, AuthorityCommandAuditRecordSchema, CommandIdentityConflictError, RunLifecycleCommandRecordSchema, RunLifecycleCommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../models/config/settings-initialization.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import type { AuthorityRepositories } from "./authority-database.js";

let activeRunCommand: Readonly<{ repositories: AuthorityRepositories; request: string }> | undefined;

export function withCanonicalRunCommandScope<Result extends object>(repositories: AuthorityRepositories, request: CommandRequest,
  work: () => Result, parentCommandId?: string): Result {
  if (activeRunCommand !== undefined || !(request.family === "ocr-review" || request.family === "start" || request.family === "run" && (request.type === "retry" || request.type === "recover-run" || request.type === "cancel" || request.type === "resume"))) {
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
export function settledRunDeletionIds(audit: z.infer<typeof NativeCommandAuditSchema>): readonly string[] | undefined {
  if (!("kind" in audit) || audit.kind !== "run-lifecycle") return undefined;
  if (audit.request.operation === "delete" && audit.result.kind === "deletion"
    || audit.request.operation === "clear-history" && audit.result.kind === "history-deletion") return audit.result.runIds;
  return undefined;
}
const RowSchema = z.strictObject({
  id: z.string(), family: z.string(), actor_id: z.string(), parent_id: z.string().nullable(), target_id: z.string().nullable(),
  request_digest: z.string(), request_json: z.string(), state: z.enum(["admitted", "executing", "succeeded", "refused", "uncertain"]),
  outcome_json: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
});
function isRunLifecycleCommand(input: unknown): boolean {
  return typeof input === "object" && input !== null && "kind" in input && input.kind === "run-lifecycle";
}

export function commandIdentity(input: unknown, validateLifecycle: (command: unknown) => void = validateNativeLifecycleRequest) {
  const request = isRunLifecycleCommand(input)
    ? RunLifecycleCommandRecordSchema.parse(input)
    : NativeCommandRequestSchema.parse(input);
  if ("kind" in request && request.kind === "run-lifecycle") validateLifecycle(request);
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
export function commandFromRow(input: unknown, validateLifecycle?: (command: unknown) => void) {
  const row = RowSchema.parse(input);
  const identity = commandIdentity(JSON.parse(row.request_json), validateLifecycle);
  if (row.id !== identity.request.commandId || row.family !== identity.family || row.actor_id !== identity.actor
    || row.target_id !== identity.targetId || row.request_digest !== sha256Hex(identity.json) || row.created_at !== identity.createdAt) {
    throw new Error("command-row-identity-mismatch");
  }
  if (row.outcome_json !== null) {
    const outcome = JSON.parse(row.outcome_json) as unknown;
    const audit = isRunLifecycleCommand(outcome)
      ? RunLifecycleCommandAuditRecordSchema.parse(outcome)
      : NativeCommandAuditSchema.parse(outcome);
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
  const audit = isRunLifecycleCommand(input)
    ? RunLifecycleCommandAuditRecordSchema.parse(input)
    : NativeCommandAuditSchema.parse(input);
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

// Unregistered source contracts; current native readers and writers remain unchanged.
export const AssistantM1NativeCommandAuditSchema = z.union([
  CommandAuditRecordSchema.safeExtend({ attribution: AssistantCommandAttributionSchema }),
  RunLifecycleCommandAuditRecordSchema.safeExtend({ attribution: AssistantCommandAttributionSchema }),
  SettingsInitializationAuditSchema.safeExtend({ attribution: AssistantCommandAttributionSchema }),
]).superRefine((audit, context) => {
  if (audit.attribution.kind === "assistant" && (!("requestedBy" in audit.request)
    || audit.attribution.requestedBy !== audit.request.requestedBy || audit.request.source !== "assistant")) {
    context.addIssue({ code: "custom", message: "command-attribution-provenance-mismatch" });
  }
});
export const AssistantM1NativeCommandRowSchema = RowSchema.extend({ attribution_json: z.string() }).superRefine((row, context) => {
  try {
    const { attribution_json, ...before } = row;
    const attribution = AssistantCommandAttributionSchema.parse(JSON.parse(attribution_json));
    if (before.outcome_json !== null) {
      const { attribution: auditAttribution, ...audit } = AssistantM1NativeCommandAuditSchema.parse(JSON.parse(before.outcome_json));
      if (canonicalJsonStringify(auditAttribution) !== canonicalJsonStringify(attribution)) throw new Error("command-attribution-mismatch");
      before.outcome_json = canonicalJsonStringify(audit);
    }
    const request = commandFromRow(before);
    if (attribution.kind === "assistant" && (!("requestedBy" in request) || request.requestedBy !== attribution.requestedBy || request.source !== "assistant")) {
      throw new Error("command-attribution-provenance-mismatch");
    }
  } catch {
    context.addIssue({ code: "custom", message: "command-m1-row-invalid" });
  }
});
const CommandAuditRowSchema = z.strictObject({ id: z.string(), command_id: z.string(), code: z.string().nullable(), payload_json: z.string(), created_at: z.string() });

/** Known-predecessor conversion only; authentic native/profile admission remains the activation owner's responsibility. */
export function convertAssistantCommandPairToM1(commandInput: unknown, auditInput: unknown) {
  const command = RowSchema.parse(commandInput);
  commandFromRow(command);
  const attribution = AssistantCommandAttributionSchema.parse({ kind: "unrecorded" });
  if (command.outcome_json === null) {
    if (auditInput !== null) throw new Error("command-audit-settlement-mismatch");
    return { command: AssistantM1NativeCommandRowSchema.parse({ ...command, attribution_json: canonicalJsonStringify(attribution) }), audit: null };
  }
  const row = CommandAuditRowSchema.parse(auditInput), audit = NativeCommandAuditSchema.parse(JSON.parse(row.payload_json));
  if (row.id !== audit.auditId || row.command_id !== audit.request.commandId || row.created_at !== audit.completedAt
    || row.code !== ("code" in audit.result ? audit.result.code : null)
    || row.command_id !== command.id || command.outcome_json !== canonicalJsonStringify(audit)) throw new Error("command-audit-settlement-mismatch");
  const payload_json = canonicalJsonStringify(AssistantM1NativeCommandAuditSchema.parse({ ...audit, attribution }));
  return { command: AssistantM1NativeCommandRowSchema.parse({ ...command, attribution_json: canonicalJsonStringify(attribution), outcome_json: payload_json }),
    audit: { ...row, payload_json } };
}

export function assertAssistantM1CommandIdentity(input: unknown, request: unknown, attribution: unknown, parentId?: string): void {
  const row = AssistantM1NativeCommandRowSchema.parse(input), identity = commandIdentity(request);
  if (row.request_digest !== sha256Hex(identity.json) || canonicalJsonStringify(JSON.parse(row.request_json)) !== identity.json
    || row.parent_id !== (parentId ?? null)
    || canonicalJsonStringify(JSON.parse(row.attribution_json)) !== canonicalJsonStringify(AssistantCommandAttributionSchema.parse(attribution))) {
    throw new CommandIdentityConflictError();
  }
}
