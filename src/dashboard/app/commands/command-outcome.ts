import { createErrorCatalogFailure,formatErrorCatalogFailure,type ErrorCatalogMessage } from "../../../models/failures/error-catalog.js";
import { bulkChildEffect,commandResultEffect,type BulkChildClass,type CommandEffect } from "../../../rules/commands/command-lifecycle.js";
import { DashboardClientError } from "../../client/errors.js";
import type { CommandExecutionReply,CommandOutcome,RetainedCommandAttempt,RetainedCommandRequest } from "./command-executor.js";

type RefusedOutcome = Extract<CommandOutcome, { kind: "refused" }>;

/** What a surface shows for one attempt. Every refusal arm here means the effect is `none`. */
export type CommandAttemptView =
  | { readonly view: "pending" }
  /** `children`: a confirmed bulk parent. */
  | { readonly view: "landed"; readonly replayed: boolean; readonly children?: readonly CommandAttemptView[] }
  /** Landed, then readback showed the target had moved on. */
  | { readonly view: "superseded"; readonly feedback: ErrorCatalogMessage }
  | { readonly view: "unknown"; readonly feedback: ErrorCatalogMessage }
  | { readonly view: "conflict"; readonly feedback: ErrorCatalogMessage; readonly currentVersion?: number }
  | { readonly view: "confirmation-required"; readonly feedback: ErrorCatalogMessage; readonly warningDigest: string }
  /** A kernel, bulk or worker refusal that came with a code. */
  | { readonly view: "rejected"; readonly feedback: ErrorCatalogMessage; readonly code: string }
  /** Refused before or without a reply: this call sent nothing that could land. */
  | { readonly view: "call-refused"; readonly feedback: ErrorCatalogMessage; readonly reason?: NonNullable<RefusedOutcome["reason"]> | "before-effect" }
  | { readonly view: "not-sent"; readonly feedback: ErrorCatalogMessage }
  /** A bulk parent that is neither confirmed nor unknown. */
  | { readonly view: "bulk"; readonly effect: "landed" | "none" | "mixed"; readonly kind: "conflict" | "refused"; readonly feedback: ErrorCatalogMessage;
      readonly children: readonly CommandAttemptView[]; readonly classes: readonly (BulkChildClass | "not-attempted")[] };

/** An outcome whose evidence contradicts itself: a vector reply without child outcomes, a bulk child without its
 * reply, or a reply whose effect does not match its own arm. */
export class CommandOutcomeInvalidError extends Error {
  constructor(readonly commandId: string, readonly problem: "vector-without-children" | "child-without-reply" | "effect-contradicts-reply") {
    super(`command-outcome-invalid: ${problem} for command ${commandId}`);
    this.name = "CommandOutcomeInvalidError";
  }
}

function feedback(code: "COMMAND_OUTCOME_UNCERTAIN" | "COMMAND_RESULT_IDENTITY_MISMATCH"): ErrorCatalogMessage {
  return formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
}

/** The one builder for an outcome whose effect is unknown. */
export function uncertainOutcome(commandId: string, cause: unknown, reply?: CommandExecutionReply): CommandOutcome {
  const code = cause instanceof DashboardClientError && cause.code === "COMMAND_RESULT_IDENTITY_MISMATCH"
    ? "COMMAND_RESULT_IDENTITY_MISMATCH" : "COMMAND_OUTCOME_UNCERTAIN";
  return { kind: "uncertain", commandId, feedback: feedback(code), cause, ...(reply === undefined ? {} : { reply }) };
}

function replyLanded(reply: CommandExecutionReply | undefined): boolean {
  if (reply === undefined) return false;
  if ("outcome" in reply) return reply.outcome === "applied";
  return reply.state === "applied" || reply.state === "already-applied";
}

function replyEffect(outcome: CommandOutcome): CommandEffect {
  const reply = outcome.reply;
  if (reply === undefined) return "none";
  if ("outcome" in reply) return bulkChildEffect(reply.outcome);
  switch (reply.state) {
    case "refused": return "none";
    case "vector": throw new CommandOutcomeInvalidError(outcome.commandId, "vector-without-children");
    default: return commandResultEffect(reply);
  }
}

/** Did this attempt change anything? Read from the reply, readback and children, never from `kind` alone. */
export function outcomeEffect(outcome: CommandOutcome): CommandEffect | "mixed" {
  if (outcome.kind === "uncertain") return "unknown";
  if (outcome.children !== undefined) {
    const effects = new Set(outcome.children.map(outcomeEffect));
    if (effects.has("unknown")) return "unknown";
    if (effects.size === 1 && effects.has("landed")) return "landed";
    if (effects.size === 1 && effects.has("none")) return "none";
    return "mixed";
  }
  if (outcome.kind === "confirmed" || replyLanded(outcome.reply)) return "landed";
  return replyEffect(outcome);
}

function replayed(reply: CommandExecutionReply | undefined): boolean {
  if (reply === undefined) return false;
  return "outcome" in reply ? reply.outcome === "applied" && reply.replayed : reply.state === "already-applied";
}

function childClass(child: CommandOutcome): BulkChildClass | "not-attempted" {
  if (child.reply !== undefined && "outcome" in child.reply) return child.reply.outcome;
  if (child.kind === "refused" && child.reason === "not-attempted") return "not-attempted";
  throw new CommandOutcomeInvalidError(child.commandId, "child-without-reply");
}

function currentVersion(reply: CommandExecutionReply | undefined): { readonly currentVersion?: number } {
  if (reply === undefined) return {};
  if ("outcome" in reply) return reply.outcome === "conflict" ? { currentVersion: reply.currentVersion } : {};
  return reply.state === "conflict" ? { currentVersion: reply.currentVersion } : {};
}

function rejectionCode(outcome: RefusedOutcome, reply: CommandExecutionReply): string {
  if ("outcome" in reply) return reply.outcome === "refused" ? reply.code : outcome.feedback.code;
  return reply.state === "rejected" || reply.state === "refused" ? reply.code : outcome.feedback.code;
}

function outcomeView(outcome: CommandOutcome): CommandAttemptView {
  const effect = outcomeEffect(outcome);
  if (outcome.kind === "uncertain" || effect === "unknown") return { view: "unknown", feedback: outcome.kind === "uncertain" ? outcome.feedback : feedback("COMMAND_OUTCOME_UNCERTAIN") };
  if (outcome.kind === "confirmed") return { view: "landed", replayed: replayed(outcome.reply),
    ...(outcome.children === undefined ? {} : { children: outcome.children.map(outcomeView) }) };
  if (outcome.children !== undefined && (outcome.kind === "conflict" || outcome.kind === "refused")) {
    return { view: "bulk", effect, kind: outcome.kind, feedback: outcome.feedback,
      children: outcome.children.map(outcomeView), classes: outcome.children.map(childClass) };
  }
  if (effect === "landed") return { view: "superseded", feedback: outcome.feedback };
  switch (outcome.kind) {
    case "conflict": return { view: "conflict", feedback: outcome.feedback, ...currentVersion(outcome.reply) };
    case "confirmation-required": return { view: "confirmation-required", feedback: outcome.feedback, warningDigest: outcome.warningDigest };
    case "refused": {
      if (outcome.reply !== undefined) return { view: "rejected", feedback: outcome.feedback, code: rejectionCode(outcome, outcome.reply) };
      const reason = outcome.reason ?? (outcome.cause === undefined ? undefined : "before-effect");
      return { view: "call-refused", feedback: outcome.feedback, ...(reason === undefined ? {} : { reason }) };
    }
    case "failed": return { view: "not-sent", feedback: outcome.feedback };
  }
}

/** The view a surface switches over for one attempt or one returned outcome. A draft not yet sent shows as pending. */
export function commandAttemptView(input: { readonly request: RetainedCommandRequest; readonly state: AttemptPhase; readonly outcome?: CommandOutcome } | CommandOutcome): CommandAttemptView {
  if (!("request" in input)) return outcomeView(input);
  if (input.state === "pending" || input.outcome === undefined) return { view: "pending" };
  return outcomeView(input.outcome);
}

/** Pending, or settled with an unknown effect: the attempt must be resolved before anything replaces it. */
export function attemptUnresolved(attempt: RetainedCommandAttempt): boolean {
  const { view } = commandAttemptView(attempt);
  return view === "pending" || view === "unknown";
}

export type AttemptPhase = "absent" | "pending" | "settled";
export type AttemptEvent =
  /** An unregistered draft, before the dispatch guards. */
  | { readonly type: "create" }
  | { readonly type: "dispatch"; readonly origin: "execute" | "replay" }
  | { readonly type: "check"; readonly retained: CommandAttemptView }
  | { readonly type: "reply"; readonly via: "dispatch" | "check"; readonly outcome: CommandOutcome; readonly scopeCurrent: boolean };
/** `release`: which of the attempt's target reservations the executor frees. */
export type AttemptSettlement = { readonly phase: "settled"; readonly outcome: CommandOutcome; readonly release: "all" | "settled-children" | "none" };
export type AttemptMove = { readonly phase: "absent" | "pending"; readonly release: "none" } | AttemptSettlement;
export type AttemptStep = AttemptMove | { readonly refused: "locked" | "attempt-unavailable" };

/** An event the executor's own guards make impossible from this phase. */
export class AttemptTransitionInvalidError extends Error {
  constructor(readonly phase: AttemptPhase, readonly event: AttemptEvent["type"]) {
    super(`attempt-transition-invalid: ${event} from ${phase}`);
    this.name = "AttemptTransitionInvalidError";
  }
}

/** The attempt transition table; the executor calls it at every attempt write. Publication is not part of it. */
export function attemptTransition(phase: AttemptPhase, event: Extract<AttemptEvent, { type: "create" }>): AttemptMove;
export function attemptTransition(phase: AttemptPhase, event: Extract<AttemptEvent, { type: "reply" }>): AttemptSettlement;
export function attemptTransition(phase: AttemptPhase, event: AttemptEvent): AttemptStep;
export function attemptTransition(phase: AttemptPhase, event: AttemptEvent): AttemptStep {
  switch (event.type) {
    case "create":
      if (phase === "absent") return { phase: "absent", release: "none" };
      break;
    case "dispatch":
      if (phase === "pending") return { refused: "locked" };
      if (event.origin === "execute" && phase === "absent") return { phase: "pending", release: "none" };
      if (event.origin === "replay") return phase === "settled" ? { phase: "pending", release: "none" } : { refused: "attempt-unavailable" };
      break;
    case "check":
      if (phase === "absent") return { refused: "attempt-unavailable" };
      if (phase === "pending" || event.retained.view !== "unknown") return { refused: "locked" };
      return { phase: "pending", release: "none" };
    case "reply": {
      if (phase !== "pending") break;
      if (event.via === "dispatch") return { phase: "settled", outcome: event.outcome, release: "settled-children" };
      const outcome = event.outcome;
      if (!event.scopeCurrent) return { phase: "settled", outcome: uncertainOutcome(outcome.commandId, "scope-replaced"), release: "none" };
      // A recorded refusal proves no effect; anything else short of confirmation stays checkable.
      if (outcome.kind === "confirmed" || (outcome.kind === "refused" && outcomeEffect(outcome) === "none")) return { phase: "settled", outcome, release: "all" };
      return { phase: "settled", outcome: uncertainOutcome(outcome.commandId, outcome, outcome.reply), release: "none" };
    }
  }
  throw new AttemptTransitionInvalidError(phase, event.type);
}
