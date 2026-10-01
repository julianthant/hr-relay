import { CommandResultSchema, type CommandResult, type CommandRequest, type CommandRejectionCodeSchema } from "../../domain/commands.js";
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
