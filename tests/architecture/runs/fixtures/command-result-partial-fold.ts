/**
 * A VIOLATING fixture for `command-result-exhaustive.test.ts` (D253, Track D
 * row D3 — the call-site-granularity follow-up).
 *
 * The per-MODULE form of the second arm ("does this module import the fold
 * at all") is trivially satisfied by a module that imports it once and folds
 * only ONE of its several `.executeCommand(` dispatches. This is the exact
 * shape that check could not see: a REAL, non-type import of
 * `settleCommandResult`, called on the first dispatch, and a second dispatch
 * that reaches its own `.then` and never calls the fold at all — so a
 * `conflict` or `rejected` on the second command lands on `onSaved()` in
 * silence, exactly as if nothing had ever been read from the fold.
 *
 * It is checked in so the call-site walker is executed against a real
 * violation the import-only walker passed.
 */
import { settleCommandResult } from "../../../../src/dashboard/app/command-result.js";
import type { CommandResult } from "../../../../src/rules/commands/commands.js";

interface CommandClient {
  executeCommand: (request: unknown) => Promise<CommandResult>;
}

export function saveTwiceButFoldOnlyTheFirst(
  client: CommandClient,
  first: unknown,
  second: unknown,
  onSaved: () => void,
): void {
  void client.executeCommand(first).then((result) => {
    if (settleCommandResult(result).kind === "applied") onSaved();
  });
  // The second dispatch never reaches the fold: applied, already-applied,
  // conflict and rejected all arrive at `.then` and all call `onSaved()`.
  void client.executeCommand(second).then(() => onSaved());
}
