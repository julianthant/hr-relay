import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import {
  BulkRunCommandRequestSchema,
  CommandRequestSchema,
  type BulkRunCommandResponse,
  type CommandResult,
  type CommandRequest,
} from "../../../domain/commands.js";
import { CommandIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";
import { deriveBulkChildCommandId } from "./command-service.js";

const CommandIntentObjectSchema = z.object({}).loose();

type CommandJournalRead = Readonly<{
  get(commandId: string): CommandRequest | undefined;
}>;

/** Replace caller-authored provenance with facts owned by this BFF process. */
export function stampOperatorCommand(
  input: unknown,
  clock: Clock,
  journal: CommandJournalRead,
): CommandRequest {
  const intent = CommandIntentObjectSchema.parse(input);
  const commandId = CommandIdSchema.parse(intent.commandId);
  const accepted = journal.get(commandId);
  return CommandRequestSchema.parse({
    ...intent,
    requestedAt: accepted?.requestedAt ?? clock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  });
}

/** Bulk parents are not journaled, so their exact accepted time is recovered from any durable child. */
export function stampOperatorBulkCommand(
  input: unknown,
  clock: Clock,
  journal: CommandJournalRead,
): Readonly<Record<string, unknown>> {
  const intent = CommandIntentObjectSchema.parse(input);
  const serverProvenance = {
    requestedAt: clock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  } as const;
  const provisional = {
    ...intent,
    ...serverProvenance,
  };
  const parsed = BulkRunCommandRequestSchema.safeParse(provisional);
  if (!parsed.success) return Object.freeze(provisional);

  const acceptedChildren = parsed.data.targets
    .map(({ runId }) => journal.get(deriveBulkChildCommandId(parsed.data.bulkCommandId, runId)))
    .filter((command) => command !== undefined);
  const acceptedTimes = new Set(acceptedChildren.map(({ requestedAt }) => requestedAt));
  if (acceptedTimes.size > 1
    || acceptedChildren.some(({ requestedBy, source }) =>
      requestedBy !== LOCAL_OPERATOR_ACTOR_ID || source !== "dashboard")) {
    throw new Error(
      `bulk command ${parsed.data.bulkCommandId} has durable children with divergent accepted provenance`,
    );
  }
  return Object.freeze({
    ...intent,
    ...serverProvenance,
    requestedAt: acceptedTimes.values().next().value ?? serverProvenance.requestedAt,
  });
}

export interface OperatorCommandIngress {
  submit(
    input: unknown,
    execute: (accepted: CommandRequest) => Promise<CommandResult>,
  ): Promise<CommandResult>;
  executeBulk(
    input: unknown,
    execute: (accepted: unknown) => BulkRunCommandResponse,
  ): Promise<BulkRunCommandResponse>;
}

/** Hold one in-process acceptance lane per durable command identity through execution. */
export function createOperatorCommandIngress(input: Readonly<{
  clock: Clock;
  journal: CommandJournalRead;
}>): OperatorCommandIngress {
  const tails = new Map<string, Promise<void>>();
  const serialize = async <Result>(key: string, work: () => Promise<Result>): Promise<Result> => {
    const previous = tails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(key, current);
    if (previous !== undefined) await previous;
    try {
      return await work();
    } finally {
      if (tails.get(key) === current) tails.delete(key);
      release();
    }
  };

  return Object.freeze({
    submit(
      command: unknown,
      execute: (accepted: CommandRequest) => Promise<CommandResult>,
    ): Promise<CommandResult> {
      const intent = CommandIntentObjectSchema.parse(command);
      const commandId = CommandIdSchema.parse(intent.commandId);
      return serialize(`command:${commandId}`, () =>
        execute(stampOperatorCommand(intent, input.clock, input.journal)));
    },
    executeBulk(
      command: unknown,
      execute: (accepted: unknown) => BulkRunCommandResponse,
    ): Promise<BulkRunCommandResponse> {
      const intent = CommandIntentObjectSchema.parse(command);
      const bulkCommandId = CommandIdSchema.safeParse(intent.bulkCommandId);
      const run = async (): Promise<BulkRunCommandResponse> =>
        execute(stampOperatorBulkCommand(intent, input.clock, input.journal));
      return bulkCommandId.success
        ? serialize(`bulk:${bulkCommandId.data}`, run)
        : run();
    },
  });
}
