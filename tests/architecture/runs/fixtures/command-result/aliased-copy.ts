import type { CommandOutcome as Outcome } from "../../../../../src/dashboard/app/commands/command-executor.js";

type Alias = Outcome;
export function privateOutcome(result: Alias): boolean {
  const alias = result;
  return "uncertain" !== alias.kind;
}
