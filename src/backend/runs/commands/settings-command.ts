import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsReadbackSchema } from "../../../models/config/protected-settings.js";
import { EditableSettingsOverrideSchema } from "../../../models/config/schema.js";
import { SettingsApplyRefusalSchema, type SettingsFileRecord } from "../../../models/config/settings.js";
import { CommandIdentityConflictError, type CommandRequest, CommandRequestSchema, type CommandResult, CommandResultSchema, deriveSettingsCommandFingerprint, markSettingsCommand } from "../../../rules/commands/commands.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { readSettings } from "../../runtime/settings/settings-runtime.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { CommandRefusal, conflict, reject } from "./command-refusal.js";
import { replay } from "./command-replay.js";
import { z } from "zod";

/** An ordinary settings commit, with the revision and fingerprint its reply carries. */
export type SettingsCommitted = (committed: Readonly<{ revision: number; settingsFingerprint: string }>) => void;

export type SettingsCommand = Extract<CommandRequest, { family: "settings" }>;

const SettingsApplicationRefusalSchemas = SettingsApplyRefusalSchema.options;

const OrdinarySettingsApplicationOutcomeSchema = z.union([
  z.strictObject({
    state: z.literal("applied"),
    revision: z.number().int().positive(),
    settingsFingerprint: FingerprintSchema,
    settings: EditableSettingsOverrideSchema,
    restartRequired: z.boolean().optional(),
  }),
  ...SettingsApplicationRefusalSchemas,
]);

const ProtectedSettingsApplicationOutcomeSchema = z.union([
  z.strictObject({
    state: z.literal("applied"),
    readback: ProtectedSettingsReadbackSchema,
  }),
  ...SettingsApplicationRefusalSchemas,
]);

export interface SettingsApplicationExecutor {
  validateRequest(command: SettingsCommand): z.infer<typeof SettingsApplyRefusalSchema> | undefined;
  commitPrivate(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>): z.infer<typeof SettingsApplyRefusalSchema> | undefined;
  applyOrdinary(command: Extract<SettingsCommand, { type: "apply-settings" }>, repositories: AuthorityRepositories, current: SettingsFileRecord): unknown;
  reconcileReplay(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>): unknown;
}

export function executeSettings(
  dependencies: Pick<CommandKernelDependencies, "settings">,
  repositories: AuthorityRepositories,
  request: SettingsCommand,
  ordinarySnapshot?: SettingsFileRecord,
): CommandApplication {
  if (dependencies.settings === undefined) {
    throw new Error(
      `settings/${request.type} reached a composition with no settings application executor`,
    );
  }
  const requireExpectedRevision = (revision: number): void => {
    if (revision !== request.target.expectedRevision + 1) {
      throw new Error("settings executor did not advance exactly one revision");
    }
  };
  if (request.type === "apply-settings") {
    if (ordinarySnapshot === undefined) throw new Error("settings-ordinary-snapshot-unavailable");
    const outcome = OrdinarySettingsApplicationOutcomeSchema.parse(
      dependencies.settings.applyOrdinary(request, repositories, ordinarySnapshot),
    );
    if (outcome.state === "conflict") conflict(request, outcome.currentRevision, outcome.message);
    if (outcome.state === "rejected") reject(request, outcome.code, outcome.message);
    requireExpectedRevision(outcome.revision);
    const target = { family: "settings" as const, revision: outcome.revision };
    const application = applied(
      request,
      [target],
      [{ target, before: request.target.expectedRevision, after: outcome.revision }],
      [],
      undefined,
      undefined,
      { kind: "ordinary", revision: outcome.revision, settingsFingerprint: outcome.settingsFingerprint, restartRequired: outcome.restartRequired ?? true },
    );
    return Object.freeze({
      ...application,
      settingsCurrent: Object.freeze({
        revision: outcome.revision,
        settingsFingerprint: outcome.settingsFingerprint,
        settings: outcome.settings,
        commandFingerprint: deriveSettingsCommandFingerprint(request),
      }),
    });
  }
  const outcome = ProtectedSettingsApplicationOutcomeSchema.parse(
    { state: "applied", readback: dependencies.settings.reconcileReplay(request) },
  );
  if (outcome.state === "conflict") conflict(request, outcome.currentRevision, outcome.message);
  if (outcome.state === "rejected") reject(request, outcome.code, outcome.message);
  requireExpectedRevision(outcome.readback.revision);
  const target = { family: "protected-settings" as const, revision: outcome.readback.revision };
  const application = applied(
    request,
    [target],
    [{ target, before: request.target.expectedRevision, after: outcome.readback.revision }],
    [],
    undefined,
    undefined,
    { kind: "protected", readback: outcome.readback },
  );
  return application;
}

/** The same settings command path is used by the BFF and stopped migration. */
export function executeSettingsCommand(
  dependencies: Pick<CommandKernelDependencies, "authority" | "clock" | "ids" | "settings" | "settingsCommitted">,
  input: unknown,
): CommandResult {
  const request = CommandRequestSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
  if (request.family !== "settings") throw new Error("settings command required");
  const executor = dependencies.settings;
  if (executor === undefined) throw new Error("settings executor unavailable");
  // Request-only validation precedes every database/private-store read.
  if (request.type === "apply-protected-settings" && request.payload.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
    return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId,
      code: "schema-mismatch", message: "credential schema does not match the current catalog" });
  }
  const refusal = executor.validateRequest(request);
  if (refusal !== undefined) return CommandResultSchema.parse(refusal.state === "conflict"
    ? { state: "conflict", commandId: request.commandId, currentVersion: refusal.currentRevision, message: refusal.message }
    : { ...refusal, commandId: request.commandId });
  let credentialsCommitted = false;
  try {
    const result = dependencies.authority.withAuthorityTransaction((repositories) => {
      const now = dependencies.clock.now().toISOString();
      const journalRequest = markSettingsCommand(request);
      // Validate ordinary authority before this command becomes retained history.
      // Replays use their existing journal and do not need a new read snapshot.
      const ordinarySnapshot = request.type === "apply-settings" && repositories.commands.get(request.commandId) === undefined
        ? readSettings(repositories) : undefined;
      if (request.type === "apply-protected-settings") {
        repositories.commands.assertIdentity(journalRequest);
        // BEGIN IMMEDIATE holds identity admission, private commit and audit; SQL rollback cannot undo the private commit.
        const protectedRefusal = executor.commitPrivate(request);
        if (protectedRefusal !== undefined) {
          throw new CommandRefusal(CommandResultSchema.parse(protectedRefusal.state === "conflict"
            ? { state: "conflict", commandId: request.commandId, currentVersion: protectedRefusal.currentRevision, message: protectedRefusal.message }
            : { ...protectedRefusal, commandId: request.commandId }));
        }
        credentialsCommitted = true;
      }
      const journal = repositories.commands.insert(journalRequest);
      if (journal.state === "existing") return replay(dependencies, repositories, request, now);
      const application = executeSettings(dependencies, repositories, request, ordinarySnapshot);
      const auditId = dependencies.ids.uuid();
      repositories.commandAudits.insert({ auditId, request: journalRequest, result: application.result,
        completedAt: now, versionChanges: application.versionChanges, affectedDependencyIds: application.affectedDependencyIds });
      if (application.settingsCurrent !== undefined) {
        repositories.settingsCurrent.advance({
          ...application.settingsCurrent, commandId: request.commandId, auditId, committedAt: now,
        });
        const committed = dependencies.settingsCommitted;
        if (committed !== undefined) {
          const { authority } = dependencies;
          if (authority.afterAuthorityCommit === undefined) throw new Error("settings-commit-publication-unavailable");
          const { revision, settingsFingerprint } = application.settingsCurrent;
          authority.afterAuthorityCommit(() => committed({ revision, settingsFingerprint }));
        }
      }
      return application.result;
    });
    return result;
  } catch (error) {
    if (credentialsCommitted) {
      throw new Error("credential-audit-uncertain: credentials committed; retry the exact command to verify its audit", { cause: error });
    }
    if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
      state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
    });
    if (error instanceof CommandRefusal) return error.result;
    throw error;
  }
}
