import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogMessage } from "../../../models/failures/error-catalog.js";
import { BulkRunCommandRequestSchema, CommandRequestSchema, type BulkRunCommandRequest, type BulkRunCommandOutcome, type BulkRunCommandResponse, type CommandRequest, type CommandResult } from "../../../rules/commands/commands.js";
import { deriveBulkChildCommand } from "../../../rules/commands/command-groups.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { checkedBulkCommandResult, checkedCommandResult, type SharedCommands } from "../../client/commands/shared-commands.js";
import { DashboardClientError } from "../../client/errors.js";
import { beforeEffectRefusal } from "./command-result.js";

export interface CommandExecutionScope {
  readonly actorId: string;
  readonly client: SharedCommands;
  readonly authority: object;
  readonly dayRequest: object;
}

export type RetainedCommandRequest = CommandRequest | BulkRunCommandRequest;
export type CommandExecutionReply = CommandResult | BulkRunCommandResponse | BulkRunCommandOutcome;
export type CommandReadbackVerification =
  | { readonly state: "matched"; readonly evidence: unknown }
  | { readonly state: "mismatch"; readonly evidence: unknown }
  | { readonly state: "conflict"; readonly evidence: unknown };

type OutcomeData = Readonly<{
  commandId: string;
  reply?: CommandExecutionReply;
  cause?: unknown;
  children?: readonly CommandOutcome[];
}>;
export type CommandOutcome = OutcomeData & (
  | { readonly kind: "confirmed"; readonly readback: unknown }
  | { readonly kind: "refused"; readonly feedback: ErrorCatalogMessage; readonly reason?: "locked" | "identity-reused" | "scope-replaced" | "actor-mismatch" | "attempt-unavailable" | "not-attempted" }
  | { readonly kind: "conflict"; readonly feedback: ErrorCatalogMessage; readonly readback?: unknown }
  | { readonly kind: "confirmation-required"; readonly feedback: ErrorCatalogMessage; readonly warningDigest: string }
  | { readonly kind: "uncertain"; readonly feedback: ErrorCatalogMessage }
  | { readonly kind: "failed"; readonly feedback: ErrorCatalogMessage }
);

export interface CommandExecutionOptions {
  readonly scope: CommandExecutionScope;
  /** Proves effect, revision and every returned target's admitted relationship. */
  readonly readback: (request: CommandRequest, reply: CommandResult | BulkRunCommandOutcome, scope: CommandExecutionScope) => Promise<CommandReadbackVerification>;
  readonly publish?: (outcome: CommandOutcome) => void;
}

export interface RetainedCommandAttempt {
  readonly request: RetainedCommandRequest;
  readonly body: string;
  readonly scope: CommandExecutionScope;
  readonly state: "pending" | "settled";
  readonly outcome?: CommandOutcome;
}

interface Attempt {
  readonly request: RetainedCommandRequest;
  readonly body: string;
  readonly scope: CommandExecutionScope;
  state: "pending" | "settled";
  outcome?: CommandOutcome;
}
interface Reservation { readonly attempt: Attempt; readonly token: object }

function feedback(code: "COMMAND_REFUSED" | "COMMAND_CONFLICT" | "COMMAND_CONFIRMATION_REQUIRED" | "COMMAND_OUTCOME_UNCERTAIN" | "COMMAND_RESULT_IDENTITY_MISMATCH" | "COMMAND_READBACK_MISMATCH" | "COMMAND_DISPATCH_FAILED" | "DASHBOARD_AUTHORITY_REPLACED"): ErrorCatalogMessage {
  return formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
}

function sameScope(left: CommandExecutionScope | undefined, right: CommandExecutionScope): boolean {
  return left?.actorId === right.actorId && left.client === right.client && left.authority === right.authority && left.dayRequest === right.dayRequest;
}

function lockKey(request: CommandRequest): string {
  let identity: readonly unknown[];
  switch (request.family) {
    case 'assistant-model-preference': identity = [request.target.profileId]; break;
    case "run": identity = [request.target.runId]; break;
    case "gate": identity = [request.target.runId, request.target.gateId]; break;
    case "start": identity = [request.target.workflowId, request.target.startPlanId]; break;
    case "intake": identity = [request.target.intakeSessionId]; break;
    case "worker-browser": identity = "workflowId" in request.target ? [request.target.workflowId] : [request.target.workerId]; break;
    case "settings": identity = []; break;
    case "storage-relocation": identity = [request.target.installationId]; break;
    case "notification": identity = "members" in request.target ? ["collection", request.target.actorId] : [request.target.notificationId, request.target.actorId]; break;
    case "explorer": identity = [request.target.workflowId]; break;
    case "workflow-batch": identity = [request.target.batchId]; break;
    case "failure-resolution": identity = [request.target.runId, request.target.failureId]; break;
  }
  return JSON.stringify([request.family, request.type, ...identity]);
}

function children(request: RetainedCommandRequest): readonly CommandRequest[] {
  return "targets" in request ? request.targets.map(target => deriveBulkChildCommand(request, target)) : [request];
}

function uncertain(commandId: string, cause: unknown, reply?: CommandExecutionReply): CommandOutcome {
  const code = cause instanceof DashboardClientError && cause.code === "COMMAND_RESULT_IDENTITY_MISMATCH"
    ? "COMMAND_RESULT_IDENTITY_MISMATCH" : "COMMAND_OUTCOME_UNCERTAIN";
  return { kind: "uncertain", commandId, feedback: feedback(code), cause, ...(reply === undefined ? {} : { reply }) };
}

export class CommandExecutor {
  private readonly attempts = new Map<string, Attempt>();
  private readonly reservations = new Map<string, Reservation>();

  constructor(private readonly currentScope: () => CommandExecutionScope | undefined) {}

  retainedAttempts(): readonly RetainedCommandAttempt[] {
    return Object.freeze([...new Set(this.attempts.values())].map(attempt => Object.freeze({ ...attempt })));
  }

  async execute(input: unknown, options: CommandExecutionOptions): Promise<CommandOutcome> {
    let request: RetainedCommandRequest;
    try {
      request = deepFreeze(typeof input === "object" && input !== null && "targets" in input
        ? BulkRunCommandRequestSchema.parse(input) : CommandRequestSchema.parse(input));
    } catch (cause) {
      return this.publish({ kind: "failed", commandId: "", feedback: feedback("COMMAND_DISPATCH_FAILED"), cause }, options);
    }
    if (!sameScope(this.currentScope(), options.scope)) return this.publish(this.refuse(request.commandId, "scope-replaced"), options);
    if (request.requestedBy !== options.scope.actorId) return this.publish(this.refuse(request.commandId, "actor-mismatch"), options);
    const commands = children(request);
    const identities = [request.commandId, ...("targets" in request ? [request.bulkCommandId, ...commands.map(command => command.commandId)] : [])];
    if (identities.some(id => this.attempts.has(id))) return this.publish(this.refuse(request.commandId, "identity-reused"), options);
    const attempt: Attempt = { request, body: JSON.stringify(request), scope: Object.freeze({ ...options.scope }), state: "settled" };
    return this.dispatch(attempt, options);
  }

  async check(commandId: string, options: CommandExecutionOptions & {
    readonly observe: (request: CommandRequest) => Promise<CommandResult | undefined>;
  }): Promise<CommandOutcome> {
    const attempt = this.attempts.get(commandId);
    if (attempt === undefined || "targets" in attempt.request) return this.publish(this.refuse(commandId, "attempt-unavailable"), options);
    if (!sameScope(this.currentScope(), options.scope) || attempt.scope.actorId !== options.scope.actorId || attempt.scope.client !== options.scope.client
      || attempt.scope.authority !== options.scope.authority) return this.publish(this.refuse(commandId, "scope-replaced"), options);
    if (attempt.state !== "settled" || attempt.outcome?.kind !== "uncertain") return this.publish(this.refuse(commandId, "locked"), options);
    const request = attempt.request;
    const key = lockKey(request);
    const held = this.reservations.get(key);
    if (held?.attempt !== attempt) return this.publish(this.refuse(commandId, "attempt-unavailable"), options);
    attempt.state = "pending";
    let outcome: CommandOutcome;
    try {
      const observed = await options.observe(request);
      if (!sameScope(this.currentScope(), options.scope)) outcome = uncertain(commandId, "scope-replaced");
      else outcome = observed === undefined ? uncertain(commandId, "readback-unavailable")
        : await this.settle(request, checkedCommandResult(request, observed), options);
    } catch (cause) { outcome = uncertain(commandId, cause); }
    if (!sameScope(this.currentScope(), options.scope)) outcome = uncertain(commandId, "scope-replaced");
    if (outcome.kind !== "confirmed") outcome = uncertain(commandId, outcome, outcome.reply);
    attempt.state = "settled";
    attempt.outcome = Object.freeze(outcome);
    if (outcome.kind === "confirmed" && this.reservations.get(key) === held) this.reservations.delete(key);
    return this.publish(outcome, options);
  }

  async replay(commandId: string, options: CommandExecutionOptions): Promise<CommandOutcome> {
    const attempt = this.attempts.get(commandId);
    if (attempt === undefined) return this.publish(this.refuse(commandId, "attempt-unavailable"), options);
    if (!sameScope(this.currentScope(), options.scope)) return this.publish(this.refuse(commandId, "scope-replaced"), options);
    if (attempt.scope.actorId !== options.scope.actorId) return this.publish(this.refuse(commandId, "actor-mismatch"), options);
    if (attempt.state === "pending") return this.publish(this.refuse(commandId, "locked"), options);
    return this.dispatch(attempt, options);
  }

  private refuse(commandId: string, reason: Extract<CommandOutcome, { kind: "refused" }>["reason"]): CommandOutcome {
    return { kind: "refused", commandId, reason, feedback: feedback(reason === "scope-replaced" ? "DASHBOARD_AUTHORITY_REPLACED" : "COMMAND_REFUSED") };
  }

  private async settle(request: CommandRequest, reply: CommandResult | BulkRunCommandOutcome, options: CommandExecutionOptions): Promise<CommandOutcome> {
    const commandId = request.commandId;
    if ("outcome" in reply) {
      switch (reply.outcome) {
        case "errored": return uncertain(commandId, reply, reply);
        case "conflict": return { kind: "conflict", commandId, reply, feedback: feedback("COMMAND_CONFLICT") };
        case "refused": return reply.code === "authority-unjournaled" || reply.code === "authority-uncertain"
          ? uncertain(commandId, reply, reply) : { kind: "refused", commandId, reply, feedback: feedback("COMMAND_REFUSED") };
        case "applied": break;
      }
    } else {
      switch (reply.state) {
        case "pending": return uncertain(commandId, reply, reply);
        case "conflict": return { kind: "conflict", commandId, reply, feedback: feedback("COMMAND_CONFLICT") };
        case "confirmation-required": return { kind: "confirmation-required", commandId, reply, warningDigest: reply.warningDigest, feedback: feedback("COMMAND_CONFIRMATION_REQUIRED") };
        case "rejected": return reply.code === "authority-unjournaled" || reply.code === "authority-uncertain"
          ? uncertain(commandId, reply, reply) : { kind: "refused", commandId, reply, feedback: feedback("COMMAND_REFUSED") };
        case "applied": case "already-applied": break;
      }
    }
    try {
      const readback = await options.readback(request, reply, options.scope);
      if (readback.state === "matched") return { kind: "confirmed", commandId, reply, readback: readback.evidence };
      if (readback.state === "conflict") return { kind: "conflict", commandId, reply, readback: readback.evidence, feedback: feedback("COMMAND_CONFLICT") };
      return { kind: "uncertain", commandId, reply, cause: readback, feedback: feedback("COMMAND_READBACK_MISMATCH") };
    } catch (cause) { return uncertain(commandId, cause, reply); }
  }

  private async dispatch(attempt: Attempt, options: CommandExecutionOptions): Promise<CommandOutcome> {
    options = { ...options, scope: Object.freeze({ ...options.scope }) };
    const request = attempt.request;
    if (typeof options.readback !== "function") return this.publish({ kind: "failed", commandId: request.commandId, feedback: feedback("COMMAND_DISPATCH_FAILED") }, options);
    const commands = children(request);
    const keys = commands.map(lockKey);
    if (new Set(keys).size !== keys.length || keys.some(key => {
      const held = this.reservations.get(key);
      return held !== undefined && held.attempt !== attempt;
    })) return this.publish(this.refuse(request.commandId, "locked"), options);
    const token = Object.freeze({});
    for (const key of keys) this.reservations.set(key, { attempt, token });
    this.attempts.set(request.commandId, attempt);
    if ("targets" in request) {
      this.attempts.set(request.bulkCommandId, attempt);
      for (const command of commands) this.attempts.set(command.commandId, attempt);
    }
    attempt.state = "pending";
    let outcome: CommandOutcome;
    try {
      if ("targets" in request) {
        const reply = checkedBulkCommandResult(request, await options.scope.client.executeBulkCommand(request));
        if (reply.state === "refused") outcome = reply.code === "authority-unjournaled" || reply.code === "authority-uncertain"
          ? uncertain(request.commandId, reply, reply) : { kind: "refused", commandId: request.commandId, reply, feedback: feedback("COMMAND_REFUSED") };
        else {
          const outcomes: CommandOutcome[] = [];
          for (const [index, command] of commands.entries()) {
            const child = reply.results[index];
            outcomes.push(child === undefined ? this.refuse(command.commandId, "not-attempted") : await this.settle(command, child, options));
          }
          const unresolved = outcomes.find(child => child.kind === "uncertain");
          const conflict = outcomes.find(child => child.kind === "conflict");
          outcome = unresolved ? { ...unresolved, commandId: request.commandId, reply, children: Object.freeze(outcomes) }
            : conflict ? { ...conflict, commandId: request.commandId, reply, children: Object.freeze(outcomes) }
            : outcomes.every(child => child.kind === "confirmed") ? { kind: "confirmed", commandId: request.commandId, reply, children: Object.freeze(outcomes), readback: outcomes.map(child => child.kind === "confirmed" ? child.readback : undefined) }
            : { kind: "refused", commandId: request.commandId, reply, children: Object.freeze(outcomes), feedback: feedback("COMMAND_REFUSED") };
        }
      } else outcome = await this.settle(request, checkedCommandResult(request, await options.scope.client.executeCommand(request)), options);
    } catch (cause) {
      outcome = beforeEffectRefusal(cause)
        ? { kind: "refused", commandId: request.commandId, feedback: feedback("COMMAND_REFUSED"), cause }
        : uncertain(request.commandId, cause);
    }
    attempt.state = "settled";
    attempt.outcome = Object.freeze(outcome);
    for (const [index, key] of keys.entries()) {
      const held = this.reservations.get(key);
      const child = outcome.children?.[index] ?? outcome;
      if (child.kind !== "uncertain" && held?.attempt === attempt && held.token === token) this.reservations.delete(key);
    }
    attempt.outcome = this.publish(attempt.outcome, options);
    return attempt.outcome;
  }

  private publish(outcome: CommandOutcome, options: CommandExecutionOptions): CommandOutcome {
    if (sameScope(this.currentScope(), options.scope)) {
      try { options.publish?.(outcome); }
      catch (cause) { return Object.freeze({ ...outcome, cause }); }
    }
    return Object.freeze(outcome);
  }
}
