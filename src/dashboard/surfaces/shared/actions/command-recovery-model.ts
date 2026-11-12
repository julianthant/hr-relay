export interface CommandRecoveryEntry {
  readonly inFlightKey: string;
  readonly label: string;
  readonly targets: readonly { runId: string; title: string; expectedVersion: number }[];
  readonly detail?: string;
}

/** Shared by the sticky toast and its Priority notification so both name the command the same way. */
export const recoveryTitle = (entry: CommandRecoveryEntry) => `${entry.label.replace(/ requested$/u, "")}: outcome unknown`;
export const recoveryDetail = (entry: CommandRecoveryEntry) => `${entry.targets.length} ${entry.targets.length === 1 ? "run" : "runs"}`;
