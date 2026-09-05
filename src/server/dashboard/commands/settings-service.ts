import type {
  SettingsApplicationExecutor,
  SettingsCommand,
} from "../../../core/command-kernel.js";
import {
  ProtectedSettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../../domain/commands.js";
import {
  protectedSettingsReadback,
  type ProtectedStoreRecord,
} from "../../../domain/config/protected-settings.js";
import {
  SettingsApplyRefusalSchema,
  SettingsApplyRejectionCodeSchema,
  type SettingsApplyRefusal,
  type SettingsApplyRejectionCode,
  type SettingsFileRecord,
} from "../../../domain/config/settings.js";
import type {
  ProtectedSettingsFileAuthority,
  SettingsFileAuthority,
} from "../../../infra/config/settings-file.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import {
  readJournaledProtectedSettings,
  readJournaledSettings,
  requireJournaledProtectedSettings,
  requireJournaledSettings,
} from "../../settings-runtime.js";

function errorMessages(error: unknown): readonly string[] {
  // A wrapper/aggregate means settlement or cleanup may also have failed.
  // Only the top-level named refusal is safe to convert into a normal result.
  return error instanceof Error ? [error.message] : [];
}

function namedAuthorityCode(messages: readonly string[]): SettingsApplyRejectionCode | undefined {
  for (const code of SettingsApplyRejectionCodeSchema.options) {
    if (messages.some((message) => message.includes(code))) return code;
  }
  if (messages.some((message) => message.includes("no durable command journal"))) {
    return "authority-unjournaled";
  }
  if (messages.some((message) => /exclusive settings authority|settings authority lock|settings stale-(?:lock|reaper)/u.test(message))) {
    return "lock-unavailable";
  }
  if (messages.some((message) => /settings directory|unexpected settings entry|no-follow authority|not a regular file|hard links|permissions are|ownership cannot be verified|changed while its no-follow descriptor/u.test(message))) {
    return "directory-integrity";
  }
  return undefined;
}

function namedFact(messages: readonly string[], pattern: RegExp): string | undefined {
  for (const message of messages) {
    const match = pattern.exec(message);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/** Convert only D331's recognized, value-free authority failures; unknown effects still throw. */
function settingsAuthorityRefusal(
  error: unknown,
  command: SettingsCommand,
): SettingsApplyRefusal | undefined {
  const messages = errorMessages(error);
  const code = namedAuthorityCode(messages);
  if (code === undefined) return undefined;
  const document = command.type === "apply-settings" ? "settings.json" : "protected.json";
  const key = namedFact(messages, /\bkey:\s*([A-Za-z][A-Za-z0-9_.-]*)/u)
    ?? namedFact(messages, /\b(?:settings|protected) request\s+([A-Za-z][A-Za-z0-9_.-]*)/u);
  const keys = namedFact(messages, /\bkeys:\s*([A-Za-z][A-Za-z0-9_.-]*(?:,[A-Za-z][A-Za-z0-9_.-]*)*)/u);
  const message = (() => {
    switch (code) {
      case "schema-mismatch": return `${document} schema-mismatch`;
      case "patch-fingerprint-mismatch": return "patch-fingerprint-mismatch: settings patch fingerprint does not match its canonical value";
      case "envelope-fingerprint-mismatch": return "envelope-fingerprint-mismatch: protected settings envelope does not match its canonical value";
      case "not-editable": return `not-editable { key: ${key ?? document} }`;
      case "invalid-value": return `invalid-value { key: ${key ?? document} }`;
      case "cross-field-invalid": return `cross-field-invalid { keys: ${keys ?? "settings"} }`;
      case "document-too-large": return `document-too-large { file: ${document} }`;
      case "authority-unjournaled": return `authority-unjournaled { document: ${document} }`;
      case "authority-uncertain": return `authority-uncertain { document: ${document} }`;
      case "directory-integrity": return `directory-integrity { document: ${document} }`;
      case "lock-unavailable": return "lock-unavailable { document: settings.lock }";
      case "command-divergent": return `command-divergent { document: ${document} }`;
      case "write-id-reused": return command.type === "apply-protected-settings"
        ? `write-id-reused { writeId: ${command.payload.writeId} }`
        : "write-id-reused { document: settings.json }";
    }
  })();
  return Object.freeze(SettingsApplyRefusalSchema.parse({ state: "rejected", code, message }));
}

function applySettingsAuthority<Result>(
  command: SettingsCommand,
  apply: () => Result,
): Result | SettingsApplyRefusal {
  try {
    return apply();
  } catch (error) {
    const refusal = settingsAuthorityRefusal(error, command);
    if (refusal !== undefined) return refusal;
    throw error;
  }
}

/**
 * The settings command adapter is deliberately thin: the file authority owns
 * schema/patch fingerprints, CAS, exact persistence and compensation; the
 * kernel owns journaling, audit and typed command results.
 */
export function createSettingsApplicationExecutor(
  authority: SettingsFileAuthority,
  protectedAuthority?: ProtectedSettingsFileAuthority,
): SettingsApplicationExecutor {
  const pendingSettlements = new Map<string, Readonly<{
    commandFingerprint: string;
    record: SettingsFileRecord;
    settle(): void;
    rollback(): void;
  }>>();
  const pendingProtectedSettlements = new Map<string, Readonly<{
    commandFingerprint: string;
    record: ProtectedStoreRecord;
    settle(): void;
    rollback(): void;
  }>>();

  const verifyReplay = (
    repositories: AuthorityRepositories,
    command: SettingsCommand,
  ): Readonly<{ revision: number; settingsFingerprint: string }> => {
    const record = readJournaledSettings(authority, repositories);
    const applied = record.lastApplied;
    const commandFingerprint = deriveSettingsCommandFingerprint(command);
    if (record.revision !== command.target.expectedRevision + 1
      || applied === undefined
      || applied.commandId !== command.commandId
      || applied.commandFingerprint !== commandFingerprint) {
      throw new Error(
        `settings replay ${command.commandId} does not match the exact persisted settings result`,
      );
    }
    return Object.freeze({
      revision: record.revision,
      settingsFingerprint: record.settingsFingerprint,
    });
  };

  return Object.freeze({
    apply(command: SettingsCommand, repositories: AuthorityRepositories) {
      if (command.type === "apply-protected-settings") {
        if (protectedAuthority === undefined) {
          throw new Error(
            "settings/apply-protected-settings reached a composition with no protected settings authority",
          );
        }
        const admitted = ProtectedSettingsCommandRequestSchema.parse(command);
        const commandFingerprint = deriveSettingsCommandFingerprint(admitted);
        const outcome = applySettingsAuthority(admitted, () => {
          readJournaledProtectedSettings(protectedAuthority, repositories);
          return protectedAuthority.apply({
            commandId: admitted.commandId,
            commandFingerprint,
            expectedRevision: admitted.target.expectedRevision,
            protectedSchemaHash: admitted.payload.protectedSchemaHash,
            writeId: admitted.payload.writeId,
            entries: admitted.payload.entries,
            updatedAt: admitted.requestedAt,
          });
        });
        if (outcome.state !== "applied") return outcome;
        const settlement = Object.freeze({
          commandFingerprint,
          record: outcome.record,
          rollback: () => {
            outcome.rollback();
            pendingProtectedSettlements.delete(admitted.commandId);
          },
          settle: () => {
            outcome.commit();
            pendingProtectedSettlements.delete(admitted.commandId);
          },
        });
        pendingProtectedSettlements.set(admitted.commandId, settlement);
        return Object.freeze({
          state: "applied" as const,
          readback: protectedSettingsReadback(outcome.record),
          rollback: settlement.rollback,
          commit: settlement.settle,
        });
      }
      const outcome = applySettingsAuthority(command, () => authority.apply({
        commandId: command.commandId,
        commandFingerprint: deriveSettingsCommandFingerprint(command),
        expectedRevision: command.target.expectedRevision,
        settingsSchemaHash: command.payload.settingsSchemaHash,
        patchFingerprint: command.payload.patchFingerprint,
        patch: command.payload.patch,
      }));
      if (outcome.state !== "applied") return outcome;
      const commandFingerprint = deriveSettingsCommandFingerprint(command);
      const settlement = Object.freeze({
        commandFingerprint,
        record: outcome.record,
        rollback: () => {
          outcome.rollback();
          pendingSettlements.delete(command.commandId);
        },
        settle: () => {
          outcome.commit();
          pendingSettlements.delete(command.commandId);
        },
      });
      pendingSettlements.set(command.commandId, settlement);
      return Object.freeze({
        state: "applied" as const,
        revision: outcome.record.revision,
        settingsFingerprint: outcome.record.settingsFingerprint,
        rollback: settlement.rollback,
        commit: settlement.settle,
      });
    },
    reconcileReplay(repositories: AuthorityRepositories, command: SettingsCommand) {
      if (command.type === "apply-protected-settings") {
        if (protectedAuthority === undefined) {
          throw new Error(
            "settings/apply-protected-settings replay reached a composition with no protected settings authority",
          );
        }
        const admitted = ProtectedSettingsCommandRequestSchema.parse(command);
        const commandFingerprint = deriveSettingsCommandFingerprint(admitted);
        const pending = pendingProtectedSettlements.get(admitted.commandId);
        if (pending !== undefined) {
          if (pending.commandFingerprint !== commandFingerprint) {
            throw new Error(
              `protected settings replay ${admitted.commandId} does not match its unsettled command identity`,
            );
          }
          requireJournaledProtectedSettings(pending.record, repositories);
          try {
            pending.settle();
          } catch (cleanupError) {
            throw new Error(
              `protected settings replay ${admitted.commandId} could not finish committed cleanup`,
              { cause: cleanupError },
            );
          }
        }
        const replay = protectedAuthority.apply({
          commandId: admitted.commandId,
          commandFingerprint,
          expectedRevision: admitted.target.expectedRevision,
          protectedSchemaHash: admitted.payload.protectedSchemaHash,
          writeId: admitted.payload.writeId,
          entries: admitted.payload.entries,
          updatedAt: admitted.requestedAt,
        });
        if (replay.state !== "applied") {
          throw new Error(
            `protected settings replay ${admitted.commandId} did not reproduce its persisted result`,
          );
        }
        requireJournaledProtectedSettings(replay.record, repositories);
        replay.commit();
        return protectedSettingsReadback(
          readJournaledProtectedSettings(protectedAuthority, repositories),
        );
      }
      const commandFingerprint = deriveSettingsCommandFingerprint(command);
      const pending = pendingSettlements.get(command.commandId);
      if (pending !== undefined) {
        if (pending.commandFingerprint !== commandFingerprint) {
          throw new Error(
            `settings replay ${command.commandId} does not match its unsettled command identity`,
          );
        }
        // An exception after SQLite COMMIT is ambiguous to the caller. Prove
        // the exact committed conjunction before removing the pending evidence.
        requireJournaledSettings(pending.record, repositories);
        try {
          pending.settle();
        } catch (cleanupError) {
          try {
            const verified = verifyReplay(repositories, command);
            pendingSettlements.delete(command.commandId);
            return verified;
          } catch (verificationError) {
            throw new AggregateError(
              [cleanupError, verificationError],
              `settings replay ${command.commandId} could not finish cleanup or verify exact authority`,
              { cause: verificationError },
            );
          }
        }
      }
      return verifyReplay(repositories, command);
    },
  });
}
