import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { CommandAuditRecord, CommandRequest } from "../../domain/commands.js";
import { deriveSettingsCommandFingerprint } from "../../domain/config/settings.js";
import { CommandIdSchema } from "../../domain/ids.js";
import type {
  SettingsCommandJournal,
  SettingsJournalObservation,
} from "./settings-file-service.js";

export interface SettingsCommandJournalAuthority {
  readonly commands: { get(commandId: string): CommandRequest | undefined };
  readonly commandAudits: {
    findByCommand(commandId: string): CommandAuditRecord | undefined;
  };
}

export function createSettingsCommandJournal(
  authority: SettingsCommandJournalAuthority,
): SettingsCommandJournal {
  return Object.freeze({
    observe(commandIdInput: string): SettingsJournalObservation {
      const commandId = CommandIdSchema.parse(commandIdInput);
      const command = authority.commands.get(commandId);
      const audit = authority.commandAudits.findByCommand(commandId);
      if (command === undefined && audit === undefined) return { state: "absent" };
      if (command === undefined || audit === undefined) {
        return {
          state: "inconsistent",
          reason: command === undefined
            ? "the command audit exists without its command journal row"
            : "the command journal row exists without its audit outcome",
        };
      }
      if (command.family !== "settings" || audit.request.family !== "settings") {
        return { state: "inconsistent", reason: "the prepared command id belongs to a non-settings command" };
      }
      if (canonicalJsonStringify(command) !== canonicalJsonStringify(audit.request)) {
        return { state: "inconsistent", reason: "the command journal row and audit request differ" };
      }
      if (audit.result.state !== "applied") {
        return {
          state: "inconsistent",
          reason: `the settings command audit recorded ${audit.result.state}, not applied`,
        };
      }
      const settingsTargets = audit.result.affectedTargets.filter((target) => target.family === "settings");
      const target = settingsTargets[0];
      if (settingsTargets.length !== 1 || target?.family !== "settings") {
        return {
          state: "inconsistent",
          reason: "the settings command audit does not carry exactly one settings revision target",
        };
      }
      return {
        state: "committed",
        commandFingerprint: deriveSettingsCommandFingerprint(command),
        revision: target.revision,
      };
    },
  });
}
