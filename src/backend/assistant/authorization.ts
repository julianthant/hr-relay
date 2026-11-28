import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AssistantRefusalCode } from "../../models/profiles/assistant-permissions.js";
import { type AssistantCommandAttributionSchema, type CommandRequest, type CommandResult } from "../../rules/commands/commands.js";
import { AssistantAcceptedTurnSchema, AssistantSessionClaimSchema, assistantSessionAttribution, type AssistantAcceptedTurn, type AssistantApprovalMode,
  type AssistantSessionClaim, type AssistantSessionOutcome } from "../../models/dashboard/assistant.js";
import { parseInputRunText, toRawSubmission } from "../../models/workflow/ingress.js";
import type { RunRecord } from "../../models/run/record.js";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../workflow-kit/workflow.js";
import type { StartPlanService } from "../runs/commands/start-plan-service.js";
import type { RunRecordService } from "../runs/lifecycle/run-record-service.js";
import { requireTrustRun } from "../runs/trust/run-reader.js";
import { AssistantToolRefusal } from "./plugins/plugin.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { Clock } from "../../rules/time/clock.js";

export class AssistantAuthorizationError extends Error {
  constructor(reason: string, readonly code: AssistantRefusalCode = "ASSISTANT_BINDING_STALE") {
    super(reason); this.name = "AssistantAuthorizationError";
  }
}
const same = (a: unknown, b: unknown): boolean => canonicalJsonStringify(a) === canonicalJsonStringify(b);
/** Durable home of session claims (the proposal store); one claim per accepted message and request. */
export interface AssistantSessionClaims {
  /** Records a new claim; false when its accepted message already claimed this request or its command. */
  claim(claim: AssistantSessionClaim): boolean;
  /** Settles a claimed record once; any other prior state throws. */
  settle(actionId: string, outcome: Exclude<AssistantSessionOutcome, { state: "claimed" }>): void;
  byCommand(commandId: string): Readonly<{ claim: AssistantSessionClaim; outcome: AssistantSessionOutcome }> | undefined;
}
export interface AssistantSessionPorts {
  readonly claims: AssistantSessionClaims;
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  served(workflowId: string): boolean;
  readonly plans: Pick<StartPlanService, "prepare" | "plan">;
  readonly runs: Pick<RunRecordService, "read">;
  /** Submits the claimed command; composition records the attribution with its audit. */
  submit(command: CommandRequest, attribution: z.infer<typeof AssistantCommandAttributionSchema>): Promise<CommandResult>;
  browserMode(): "headless" | "headed";
  /** Settings > General > Permissions > Full access. */
  fullAccessAllowed(): boolean;
  current(): { readonly profileId: string; readonly epoch: number };
  readonly clock: Clock;
  readonly actorId: string;
}
const sessionRefusal = () => new AssistantToolRefusal("ASSISTANT_PROPOSAL_REFUSED");

/** Starts sessions the accepted turn may start without typed yes: a transaction-free registered graph, or a supported dry run under full access. */
export function createAssistantSessionAuthorization(ports: AssistantSessionPorts) {
  /** Each active claimed command's turn check, rerun at its effect hook. */
  const active = new Map<string, () => void>();
  return Object.freeze({
    async start(acceptedTurn: AssistantAcceptedTurn, request: Readonly<{ workflowId: string; entries: readonly string[] }>, approvalMode: AssistantApprovalMode,
      signal: AbortSignal, assertCurrent: () => void): Promise<readonly RunRecord[]> {
      const turn = AssistantAcceptedTurnSchema.parse(acceptedTurn), current = ports.current();
      if (turn.profileId !== current.profileId || turn.epoch !== current.epoch) throw new AssistantAuthorizationError("assistant-session-owner-stale", "ASSISTANT_BINDING_STALE");
      if (approvalMode === "full-access" && !ports.fullAccessAllowed()) throw sessionRefusal();
      const descriptor = ports.descriptors.resolve(request.workflowId);
      if (descriptor === undefined || !ports.served(descriptor.id) || descriptor.workbookReference !== undefined) throw sessionRefusal();
      const support = workflowDryRunSupport(descriptor);
      const dryRun = !(support.state === "unsupported" && support.reason === "no-transaction-node");
      if (dryRun && (approvalMode !== "full-access" || support.state !== "supported")) throw sessionRefusal();
      // A dry run exists only through Full access; turning it off stops the start at every later boundary.
      const stillAllowed = () => { assertCurrent(); if (dryRun && !ports.fullAccessAllowed()) throw sessionRefusal(); };
      const parser = descriptor.surfaces.inputRun?.parser;
      const submissions = request.entries.map(entry => {
        const [parsed, ...rest] = parser === undefined ? [] : parseInputRunText(parser, entry);
        if (parsed === undefined || rest.length > 0) throw sessionRefusal();
        return JsonValueSchema.parse(toRawSubmission(parsed));
      });
      const plan = { workflowId: descriptor.id, submissions, dryRun, browserMode: ports.browserMode(), captureBrowserScreenshots: true };
      await ports.plans.prepare?.(plan, signal);
      stillAllowed();
      const planned = ports.plans.plan(plan);
      // A session touches no other run: no refusals, rerun, omitted steps or superseded rows.
      if (planned.workflowId !== descriptor.id || planned.dryRun !== dryRun || planned.planned.length !== submissions.length || planned.refused.length > 0
        || planned.rerun !== undefined || planned.omittedSteps !== undefined || planned.planned.some(row => row.supersedeTargets !== undefined)) throw sessionRefusal();
      const claim = AssistantSessionClaimSchema.parse({ actionId: randomUUID(), acceptedTurn: turn, approvalMode, dryRun, contractFingerprint: descriptor.contractFingerprint,
        requestDigest: sha256Hex(canonicalJsonStringify({ workflowId: descriptor.id, submissions, dryRun })), claimedAt: ports.clock.now().toISOString(),
        command: { commandId: randomUUID(), requestedAt: ports.clock.now().toISOString(), requestedBy: ports.actorId, source: "assistant", family: "start", type: "start-run",
          target: { workflowId: descriptor.id, startPlanId: planned.startPlanId, expectedVersion: planned.expectedVersion }, payload: planned.fingerprints } });
      stillAllowed();
      if (!ports.claims.claim(claim)) throw sessionRefusal();
      const { commandId } = claim.command;
      active.set(commandId, stillAllowed);
      let result: CommandResult;
      try { result = await ports.submit(claim.command, assistantSessionAttribution(claim)); }
      catch (error) { ports.claims.settle(claim.actionId, { state: "unknown" }); throw error; }
      finally { active.delete(commandId); }
      if (result.state === "pending") {
        ports.claims.settle(claim.actionId, { state: "unknown" });
        throw new AssistantAuthorizationError("assistant-session-settlement-unproved", "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
      }
      const runIds = result.state === "applied" ? result.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []) : [];
      if (runIds.length !== submissions.length) {
        ports.claims.settle(claim.actionId, { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" });
        throw sessionRefusal();
      }
      ports.claims.settle(claim.actionId, { state: "started", runIds });
      return runIds.map(runId => requireTrustRun(ports.runs, runId));
    },
    /** The command effect hook: a claimed session command runs only inside its own start, unchanged, for the current owner. */
    assertEffect(commandId: string, command?: CommandRequest): void {
      const entry = ports.claims.byCommand(commandId);
      if (entry === undefined) return;
      const current = ports.current();
      if (command !== undefined && !same(entry.claim.command, command)) throw new AssistantAuthorizationError("assistant-command-binding-mismatch", "ASSISTANT_PROPOSAL_MISMATCH");
      const stillAllowed = active.get(commandId);
      if (stillAllowed === undefined || entry.outcome.state !== "claimed") throw new AssistantAuthorizationError("assistant-effect-custody-unproved", "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
      if (entry.claim.acceptedTurn.profileId !== current.profileId || entry.claim.acceptedTurn.epoch !== current.epoch) throw new AssistantAuthorizationError("assistant-effect-not-authorized");
      stillAllowed();
    },
  });
}
