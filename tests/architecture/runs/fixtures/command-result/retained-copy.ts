import type * as commands from "../../../../../src/dashboard/app/commands/command-executor.js";

export function privateOutcome(attempt: commands.RetainedCommandAttempt): boolean {
  return attempt.outcome?.kind === "uncertain";
}
