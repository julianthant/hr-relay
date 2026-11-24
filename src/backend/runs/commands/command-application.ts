import type { z } from "zod";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { EditableSettingsOverrideSchema } from "../../../models/config/schema.js";
import type { ProtectedSettingsReadback } from "../../../models/config/protected-settings.js";
import { CommandResultSchema, type CommandRequest, type CommandResult } from "../../../rules/commands/commands.js";
import type { TargetReference, VersionChange } from "../lifecycle/run-fan-out.js";

export interface CommandApplication {
  readonly result: CommandResult;
  readonly versionChanges: readonly VersionChange[];
  readonly affectedDependencyIds: readonly string[];
  readonly writeResolution?: WriteIntentRecord;
  readonly afterAudit?: () => void;
  /** Compensation for the settings file if the surrounding authority transaction fails. */
  readonly rollback?: () => void;
  /** Releases settings-file authority only after the surrounding transaction commits. */
  readonly commit?: () => void;
  readonly settingsCurrent?: Readonly<{
    revision: number;
    settingsFingerprint: string;
    commandFingerprint: string;
    settings: z.infer<typeof EditableSettingsOverrideSchema>;
  }>;
}

export function applied(
  request: CommandRequest,
  affectedTargets: readonly TargetReference[],
  versionChanges: readonly VersionChange[],
  affectedDependencyIds: readonly string[] = [],
  rollback?: () => void,
  commit?: () => void,
  settingsResult?: Readonly<
    | { kind: "ordinary"; revision: number; settingsFingerprint: string; restartRequired: boolean }
    | { kind: "protected"; readback: ProtectedSettingsReadback }
  >,
): CommandApplication {
  return Object.freeze({
    result: CommandResultSchema.parse({
      state: "applied",
      commandId: request.commandId,
      affectedTargets,
      ...(request.family === "notification" && "members" in request.target && request.target.matchingCount === 0 && affectedTargets.length === 0
        ? { noChange: "no-matching-notifications" } : {}),
      ...(settingsResult?.kind === "ordinary" ? {
        restartRequired: settingsResult.restartRequired,
        settingsRevision: settingsResult.revision,
        settingsFingerprint: settingsResult.settingsFingerprint,
      } : settingsResult?.kind === "protected" ? {
        restartRequired: false,
        revision: settingsResult.readback.revision,
        entries: settingsResult.readback.entries,
      } : {}),
    }),
    versionChanges,
    affectedDependencyIds,
    ...(rollback === undefined ? {} : { rollback }),
    ...(commit === undefined ? {} : { commit }),
  });
}
