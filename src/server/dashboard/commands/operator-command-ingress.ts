import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import {
  BulkRunCommandRequestSchema,
  CommandRequestSchema,
  deriveBulkRunCommandFingerprint,
  type BulkRunCommandAcceptanceRecord,
  type BulkRunCommandResponse,
  type CommandResult,
  type CommandRequest,
} from "../../../domain/commands.js";
import { CommandIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";

const CommandIntentObjectSchema = z.object({}).loose();

type CommandJournalRead = Readonly<{
  get(commandId: string): CommandRequest | undefined;
}>;

type BulkCommandAcceptanceRepository = Readonly<{
  get(bulkCommandId: string): BulkRunCommandAcceptanceRecord | undefined;
  insert(record: unknown): Readonly<{
    state: "inserted" | "existing";
    record: BulkRunCommandAcceptanceRecord;
  }>;
}>;

export type BulkCommandAcceptanceAuthority = Readonly<{
  withTransaction<Result>(work: (repository: BulkCommandAcceptanceRepository) => Result): Result;
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

type BulkIngressDecision =
  | Readonly<{ state: "accepted"; request: unknown }>
  | Readonly<{ state: "refused"; response: BulkRunCommandResponse }>;

/** Bind one bulk id to one exact ordered accepted parent before any child executes. */
export function acceptOperatorBulkCommand(
  input: unknown,
  clock: Clock,
  repository: BulkCommandAcceptanceRepository,
): BulkIngressDecision {
  const intent = CommandIntentObjectSchema.parse(input);
  const bulkCommandId = CommandIdSchema.safeParse(intent.bulkCommandId);
  const existing = bulkCommandId.success ? repository.get(bulkCommandId.data) : undefined;
  const serverProvenance = {
    requestedAt: existing?.request.requestedAt ?? clock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID,
    source: "dashboard",
  } as const;
  const provisional = {
    ...intent,
    ...serverProvenance,
  };
  const parsed = BulkRunCommandRequestSchema.safeParse(provisional);
  if (!parsed.success) {
    return Object.freeze({ state: "accepted", request: Object.freeze(provisional) });
  }

  const requestFingerprint = deriveBulkRunCommandFingerprint(parsed.data);
  if (existing !== undefined) {
    if (existing.requestFingerprint !== requestFingerprint) {
      return Object.freeze({
        state: "refused",
        response: Object.freeze({
          state: "refused",
          code: "schema-mismatch",
          message: `bulk command ${parsed.data.bulkCommandId} was already accepted for a different exact ordered envelope; nothing was attempted`,
        }),
      });
    }
    return Object.freeze({ state: "accepted", request: existing.request });
  }

  const accepted = Object.freeze({
    bulkCommandId: parsed.data.bulkCommandId,
    requestFingerprint,
    request: parsed.data,
  });
  repository.insert(accepted);
  return Object.freeze({ state: "accepted", request: accepted.request });
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
  bulkAcceptances: BulkCommandAcceptanceAuthority;
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
      const run = async (): Promise<BulkRunCommandResponse> => {
        const acceptance = input.bulkAcceptances.withTransaction((repository) =>
          acceptOperatorBulkCommand(intent, input.clock, repository));
        return acceptance.state === "refused"
          ? acceptance.response
          : execute(acceptance.request);
      };
      return bulkCommandId.success
        ? serialize(`bulk:${bulkCommandId.data}`, run)
        : run();
    },
  });
}
