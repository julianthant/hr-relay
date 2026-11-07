
import { settleCommandResult } from "../../../../src/dashboard/app/commands/command-result.js";
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
