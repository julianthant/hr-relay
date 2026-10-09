import type { VersionChange } from "../lifecycle/run-fan-out.js";
import type { z } from "zod";
import type { CommandResult } from "../../../rules/commands/commands.js";
import type { EditableSettingsOverrideSchema } from "../../../models/config/schema.js";
export interface CommandApplication {
  readonly result: CommandResult;
  readonly versionChanges: readonly VersionChange[];
  readonly affectedDependencyIds: readonly string[];
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
