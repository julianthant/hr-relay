import type { CommandOutcome } from "../../../../../src/dashboard/app/commands/command-executor.js";
import { commandAttemptView } from "../../../../../src/dashboard/app/commands/command-outcome.js";

export function sharedOutcome(outcome: CommandOutcome): boolean {
  return commandAttemptView(outcome).view === "unknown";
}

export function unrelatedOutcome(result: { kind: "uncertain" | "saved" }): boolean {
  return result.kind === "uncertain";
}
