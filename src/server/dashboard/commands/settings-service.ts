import type {
  SettingsApplicationExecutor,
  SettingsCommand,
} from "../../../core/command-kernel.js";
import { deriveSettingsCommandFingerprint } from "../../../domain/commands.js";
import type { SettingsFileAuthority } from "../../../infra/config/settings-file.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { readJournaledSettings } from "../../settings-runtime.js";

/**
 * The settings command adapter is deliberately thin: the file authority owns
 * schema/patch fingerprints, CAS, exact persistence and compensation; the
 * kernel owns journaling, audit and typed command results.
 */
export function createSettingsApplicationExecutor(
  authority: SettingsFileAuthority,
): SettingsApplicationExecutor {
  const pendingSettlements = new Map<string, Readonly<{
    commandFingerprint: string;
    commit(): void;
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
    apply(command: SettingsCommand) {
      const outcome = authority.apply({
        commandId: command.commandId,
        commandFingerprint: deriveSettingsCommandFingerprint(command),
        expectedRevision: command.target.expectedRevision,
        settingsSchemaHash: command.payload.settingsSchemaHash,
        patchFingerprint: command.payload.patchFingerprint,
        patch: command.payload.patch,
      });
      if (outcome.state !== "applied") return outcome;
      const commandFingerprint = deriveSettingsCommandFingerprint(command);
      const settlement = Object.freeze({
        commandFingerprint,
        rollback: () => {
          outcome.rollback();
          pendingSettlements.delete(command.commandId);
        },
        commit: () => {
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
        commit: settlement.commit,
      });
    },
    reconcileReplay(repositories: AuthorityRepositories, command: SettingsCommand) {
      const commandFingerprint = deriveSettingsCommandFingerprint(command);
      const pending = pendingSettlements.get(command.commandId);
      if (pending !== undefined) {
        if (pending.commandFingerprint !== commandFingerprint) {
          throw new Error(
            `settings replay ${command.commandId} does not match its unsettled command identity`,
          );
        }
        try {
          pending.commit();
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
