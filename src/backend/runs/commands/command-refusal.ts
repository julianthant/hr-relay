import { CommandResultSchema, type CommandResult, type CommandRequest, type CommandRejectionCodeSchema } from "../../../rules/commands/commands.js";
import type { z } from "zod";
export class CommandRefusal extends Error {
  readonly result: CommandResult;

  constructor(result: unknown) {
    const parsed = CommandResultSchema.parse(result);
    if (parsed.state !== "conflict" && parsed.state !== "rejected" && parsed.state !== "confirmation-required") {
      throw new Error("a command refusal cannot carry an applied result");
    }
    super(`command ${parsed.commandId} ${parsed.state}: ${parsed.message}`);
    this.name = "CommandRefusal";
    this.result = parsed;
  }
}

export function rejectCommandRequest(request: CommandRequest, code: z.infer<typeof CommandRejectionCodeSchema>, message: string): never {
  throw new CommandRefusal({state:"rejected",commandId:request.commandId,code,message});
}

export function reject(request: CommandRequest, code: string, message: string): never {
  throw new CommandRefusal({ state: "rejected", commandId: request.commandId, code, message });
}

// Invalid served proof is a typed rejection that rolls back the transaction, not a transport failure.

export function conflict(request: CommandRequest, currentVersion: number, message: string): never {
  throw new CommandRefusal({ state: "conflict", commandId: request.commandId, currentVersion, message });
}
