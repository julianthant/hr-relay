import type { CommandOutcome } from "../../../../../src/dashboard/app/commands/command-executor.js";

export function privateOutcome(outcome: CommandOutcome): "unknown" | "refused" {
  return outcome.kind === "uncertain" ? "unknown" : "refused";
}
