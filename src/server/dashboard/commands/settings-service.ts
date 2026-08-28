import type {
  SettingsApplicationExecutor,
  SettingsCommand,
} from "../../../core/command-kernel.js";
import { deriveSettingsCommandFingerprint } from "../../../domain/commands.js";
import type { SettingsFileAuthority } from "../../../infra/config/settings-file.js";

/**
 * The settings command adapter is deliberately thin: the file authority owns
 * schema/patch fingerprints, CAS, exact persistence and compensation; the
 * kernel owns journaling, audit and typed command results.
 */
export function createSettingsApplicationExecutor(
  authority: SettingsFileAuthority,
): SettingsApplicationExecutor {
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
      return Object.freeze({
        state: "applied" as const,
        revision: outcome.record.revision,
        rollback: () => outcome.rollback(),
        commit: () => outcome.commit(),
      });
    },
  });
}
