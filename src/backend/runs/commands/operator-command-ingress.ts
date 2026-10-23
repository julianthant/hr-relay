import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";
import { AssistantPermissionChangeSchema, LiveWorkerResetRequestSchema, CommandIdentityConflictError, BulkRunCommandRequestSchema, CommandResultSchema, CommandRequestSchema, ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema, deriveBulkRunCommandFingerprint, type BulkRunCommandAcceptanceRecord, type BulkRunCommandRequest, type BulkRunCommandResponse, type CommandResult, type CommandRequest } from "../../../rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint } from "../../../models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { RequestIdentityRefusedError } from "./refusals.js";

function refuseForeignActorClaim(input: unknown): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return;
  if (Object.hasOwn(input, "requestedBy")
    && Reflect.get(input, "requestedBy") !== LOCAL_OPERATOR_ACTOR_ID) {
    throw new RequestIdentityRefusedError(
      "the request's requestedBy actor does not match the server-derived actor",
    );
  }
}

/** Still untrusted: the canonical strict schema must parse this before any use. */
function withOperatorProvenance(input: unknown, clock: Clock): unknown {
  refuseForeignActorClaim(input);
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  return {
    ...input,
    requestedAt: clock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  };
}

type CommandJournalRead = Readonly<{
  get(commandId: string): CommandRequest | undefined;
}>;

const OrdinarySettingsIngressRequestSchema = SettingsCommandRequestSchema.extend({
  payload: z.strictObject({ settingsSchemaHash: FingerprintSchema, patchFingerprint: FingerprintSchema,
    patch: z.unknown(), assistantPermission: AssistantPermissionChangeSchema.optional() }),
});
const ProtectedSettingsIngressRequestSchema = ProtectedSettingsCommandRequestSchema.extend({
  payload: ProtectedSettingsCommandRequestSchema.shape.payload.extend({ entries: z.unknown() }),
});

type CommandIngressDecision =
  | Readonly<{ state: "accepted"; request: CommandRequest }>
  | Readonly<{ state: "refused"; response: CommandResult }>;

function settingsLeafIssueKey(issue: z.core.$ZodIssue, member: "patch" | "entries"): string {
  const memberIndex = issue.path.indexOf(member);
  const path = (memberIndex < 0 ? issue.path : issue.path.slice(memberIndex + 1)).map(String);
  if (issue.code === "unrecognized_keys" && path.length === 0) return issue.keys[0] ?? "document";
  if (path.at(-1) === "set" || path.at(-1) === "clear") path.pop();
  return path.join(".") || "document";
}

function isUnknownSettingsKey(issue: z.core.$ZodIssue, member: "patch" | "entries"): boolean {
  const memberIndex = issue.path.indexOf(member);
  const leafPath = memberIndex < 0 ? issue.path : issue.path.slice(memberIndex + 1);
  return issue.code === "unrecognized_keys" && leafPath.length === 0;
}

function settingsLeafRefusal(
  commandId: string,
  error: z.ZodError,
  member: "patch" | "entries",
): CommandResult {
  const issue = error.issues[0];
  if (issue === undefined) throw error;
  const key = settingsLeafIssueKey(issue, member);
  const code = isUnknownSettingsKey(issue, member)
    || issue.message.includes("is not an editable ordinary setting")
    ? "not-editable"
    : "invalid-value";
  return CommandResultSchema.parse({
    state: "rejected",
    commandId,
    code,
    message: `${code} { key: ${key} }`,
  });
}

function settingsRequestRefusal(
  commandId: string,
  code: "schema-mismatch" | "patch-fingerprint-mismatch",
  document: "settings.json" | "protected.json",
): CommandIngressDecision {
  const message = code === "schema-mismatch"
    ? `${document} schema-mismatch`
    : "patch-fingerprint-mismatch: settings patch fingerprint does not match its canonical value";
  return Object.freeze({
    state: "refused",
    response: CommandResultSchema.parse({ state: "rejected", commandId, code, message }),
  });
}

/** Admit the strict command shell before classifying request-only ordinary leaf failures. */
function parseOperatorCommand(input: unknown, clock: Clock): CommandIngressDecision {
  const stamped = withOperatorProvenance(input, clock);
  const parsed = CommandRequestSchema.safeParse(stamped);
  if (parsed.success) {
    const request = parsed.data;
    if (request.type === "stop-worker" && !LiveWorkerResetRequestSchema.safeParse(request).success) return {
      state: "refused", response: CommandResultSchema.parse({ state: "rejected", commandId: request.commandId,
        code: "invalid-state", message: "worker-reset-authority-unavailable" }) };

    if (request.family === "settings") {
      if (request.type === "apply-settings") {
        if (request.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) return settingsRequestRefusal(request.commandId, "schema-mismatch", "settings.json");
        if (request.payload.patchFingerprint !== deriveRawSettingsPatchFingerprint(request.payload.patch)) return settingsRequestRefusal(request.commandId, "patch-fingerprint-mismatch", "settings.json");
      } else if (request.payload.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
        return settingsRequestRefusal(request.commandId, "schema-mismatch", "protected.json");
      }
    }
    return Object.freeze({ state: "accepted", request });
  }

  const ordinary = OrdinarySettingsIngressRequestSchema.safeParse(stamped);
  if (ordinary.success) {
    if (ordinary.data.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH) {
      return settingsRequestRefusal(ordinary.data.commandId, "schema-mismatch", "settings.json");
    }
    const canonicalPatch = z.json().safeParse(ordinary.data.payload.patch);
    if (canonicalPatch.success && ordinary.data.payload.patchFingerprint
      !== deriveRawSettingsPatchFingerprint(canonicalPatch.data)) {
      return settingsRequestRefusal(
        ordinary.data.commandId,
        "patch-fingerprint-mismatch",
        "settings.json",
      );
    }
    const strict = SettingsCommandRequestSchema.safeParse(ordinary.data);
    if (strict.success) throw parsed.error;
    return Object.freeze({
      state: "refused",
      response: settingsLeafRefusal(ordinary.data.commandId, strict.error, "patch"),
    });
  }
  const protectedSettings = ProtectedSettingsIngressRequestSchema.safeParse(stamped);
  if (protectedSettings.success) {
    if (protectedSettings.data.payload.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
      return settingsRequestRefusal(
        protectedSettings.data.commandId,
        "schema-mismatch",
        "protected.json",
      );
    }
    const strict = ProtectedSettingsCommandRequestSchema.safeParse(protectedSettings.data);
    if (strict.success) throw parsed.error;
    return Object.freeze({
      state: "refused",
      response: settingsLeafRefusal(protectedSettings.data.commandId, strict.error, "entries"),
    });
  }
  throw parsed.error;
}

type BulkCommandAcceptanceRepository = Readonly<{
  get(bulkCommandId: string): BulkRunCommandAcceptanceRecord | undefined;
  insert(record: unknown): Readonly<{
    state: "inserted" | "existing";
    record: BulkRunCommandAcceptanceRecord;
  }>;
}>;

export type BulkCommandAcceptanceAuthority = Readonly<{
  withTransaction<Result>(work: (repository: BulkCommandAcceptanceRepository) => Result): Result;
}>;

/** Replace caller-authored provenance with facts owned by this BFF process. */
function stampOperatorCommand(
  input: unknown,
  clock: Clock,
  journal: CommandJournalRead,
  protectedCommandAcceptedAt: (commandId: string) => string | undefined,
): CommandRequest {
  const intent = CommandRequestSchema.parse(withOperatorProvenance(input, clock));
  const accepted = journal.get(intent.commandId);
  return CommandRequestSchema.parse({
    ...intent,
    requestedAt: accepted?.requestedAt
      ?? (intent.family === "settings" && intent.type === "apply-protected-settings" ? protectedCommandAcceptedAt(intent.commandId) : undefined)
      ?? clock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  });
}

type BulkIngressDecision =
  | Readonly<{ state: "accepted"; request: BulkRunCommandRequest }>
  | Readonly<{ state: "refused"; response: BulkRunCommandResponse }>;

function parseOperatorBulkCommand(input: unknown, clock: Clock): BulkIngressDecision {
  const parsed = BulkRunCommandRequestSchema.safeParse(withOperatorProvenance(input, clock));
  return parsed.success
    ? Object.freeze({ state: "accepted", request: parsed.data })
    : Object.freeze({
      state: "refused",
      response: Object.freeze({
        state: "refused",
        code: "schema-mismatch",
        message: `the bulk request does not parse: ${z.prettifyError(parsed.error)}`,
      }),
    });
}

/** Bind one bulk id to one exact ordered accepted parent before any child executes. */
function acceptOperatorBulkCommand(
  input: unknown,
  clock: Clock,
  repository: BulkCommandAcceptanceRepository,
): BulkIngressDecision {
  const intent = parseOperatorBulkCommand(input, clock);
  if (intent.state === "refused") return intent;
  const existing = repository.get(intent.request.bulkCommandId);
  const request = BulkRunCommandRequestSchema.parse({
    ...intent.request,
    requestedAt: existing?.request.requestedAt ?? clock.now().toISOString(),
  });

  const requestFingerprint = deriveBulkRunCommandFingerprint(request);
  if (existing !== undefined) {
    if (existing.requestFingerprint !== requestFingerprint) {
      return Object.freeze({
        state: "refused",
        response: Object.freeze({
          state: "refused",
          code: "schema-mismatch",
          message: `bulk command ${request.bulkCommandId} was already accepted for a different exact ordered envelope; nothing was attempted`,
        }),
      });
    }
    return Object.freeze({ state: "accepted", request: existing.request });
  }

  const accepted = Object.freeze({
    bulkCommandId: request.bulkCommandId,
    requestFingerprint,
    request,
  });
  repository.insert(accepted);
  return Object.freeze({ state: "accepted", request: accepted.request });
}

export interface OperatorCommandIngress {
  submit(
    input: unknown,
    execute: (accepted: CommandRequest) => Promise<CommandResult>,
  ): Promise<CommandResult>;
  executeBulk(
    input: unknown,
    execute: (accepted: BulkRunCommandRequest) => BulkRunCommandResponse,
  ): Promise<BulkRunCommandResponse>;
}

/** Hold one in-process acceptance lane per durable command identity through execution. */
export function createOperatorCommandIngress(input: Readonly<{
  clock: Clock;
  journal: CommandJournalRead;
  protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  bulkAcceptances: BulkCommandAcceptanceAuthority;
}>): OperatorCommandIngress {
  const tails = new Map<string, Promise<void>>();
  const serialize = async <Result>(keys: readonly string[], work: () => Promise<Result>): Promise<Result> => {
    const identities = [...new Set(keys)];
    const previous = new Set(identities.flatMap((key) => {
      const tail = tails.get(key);
      return tail === undefined ? [] : [tail];
    }));
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Reserve the full overlapping set synchronously before awaiting earlier owners to prevent wait cycles.
    for (const key of identities) tails.set(key, current);
    try {
      if (previous.size > 0) await Promise.all(previous);
      return await work();
    } finally {
      for (const key of identities) if (tails.get(key) === current) tails.delete(key);
      release();
    }
  };

  return Object.freeze({
    submit(
      command: unknown,
      execute: (accepted: CommandRequest) => Promise<CommandResult>,
    ): Promise<CommandResult> {
      const ingress = parseOperatorCommand(command, input.clock);
      if (ingress.state === "refused") return Promise.resolve(ingress.response);
      return serialize([`command:${ingress.request.commandId}`], async () => {
        try {
          return await execute(stampOperatorCommand(ingress.request, input.clock, input.journal, input.protectedCommandAcceptedAt));
        } catch (error) {
          if (!(error instanceof CommandIdentityConflictError)) throw error;
          return CommandResultSchema.parse({ state: "rejected", commandId: ingress.request.commandId, code: "command-divergent", message: error.message });
        }
      });
    },
    executeBulk(
      command: unknown,
      execute: (accepted: BulkRunCommandRequest) => BulkRunCommandResponse,
    ): Promise<BulkRunCommandResponse> {
      const intent = parseOperatorBulkCommand(command, input.clock);
      if (intent.state === "refused") return Promise.resolve(intent.response);
      const run = async (): Promise<BulkRunCommandResponse> => {
        try {
          const acceptance = input.bulkAcceptances.withTransaction((repository) =>
            acceptOperatorBulkCommand(intent.request, input.clock, repository));
          return acceptance.state === "refused"
            ? acceptance.response
            : execute(acceptance.request);
        } catch (error) {
          if (!(error instanceof CommandIdentityConflictError)) throw error;
          return Object.freeze({ state: "refused", code: "command-divergent", message: error.message });
        }
      };
      return serialize([
        `command:${intent.request.bulkCommandId}`,
        ...intent.request.targets.map((target) => `command:${deriveBulkChildCommandId(intent.request.bulkCommandId, target.runId)}`),
      ], run);
    },
  });
}
