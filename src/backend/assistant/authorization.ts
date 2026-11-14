import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkAssistantAction } from "./action-policy.js";
import { AssistantActionManifestSchema, type AssistantRefusalCode, type AssistantApprovalBinding } from "../../models/profiles/assistant-permissions.js";
import { AssistantPlanBindingSchema, AssistantStoredCommandSchema, type AssistantActionRecord } from "../../models/profiles/assistant-authorization.js";
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
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import type { CommandKernel } from "../runs/commands/command-kernel.js";
import type { Clock } from "../../rules/time/clock.js";

export class AssistantAuthorizationError extends Error {
  constructor(reason: string, readonly code: AssistantRefusalCode = "ASSISTANT_BINDING_STALE") {
    super(reason); this.name = "AssistantAuthorizationError";
  }
}

interface Ports {
  database: AuthorityDatabase;
  kernel: CommandKernel;
  clock: Clock;
  current(): { readonly profileId: string; readonly epoch: number };
}
interface Chat { readonly chatId: string }
const same = (a: unknown, b: unknown): boolean => canonicalJsonStringify(a) === canonicalJsonStringify(b);

/** Private composition port; no model or HTTP request supplies authority fields. */
export function createAssistantAuthorization(ports: Ports) {
  const chats = new WeakSet<Chat>();
  const activeClaims = new Set<string>();
  const startChecks = new Map<string, () => void>();
  const now = () => ports.clock.now().toISOString();
  const repository = ports.database.authority.assistantAuthorization;
  const chat = (capability: Chat) => {
    if (!chats.has(capability)) throw new AssistantAuthorizationError("assistant-chat-not-issued");
    const current = ports.current(), row = repository.chat(capability.chatId);
    if (row === undefined || row.profileId !== current.profileId || row.epoch !== current.epoch
      || Date.parse(row.expiresAt) <= ports.clock.nowMs()) throw new AssistantAuthorizationError("assistant-chat-stale");
    return { current, row };
  };
  const decision = (capability: Chat, command: CommandRequest, approval?: AssistantApprovalBinding) => {
    const { current } = chat(capability);
    const manifest = AssistantActionManifestSchema.parse(ports.kernel.assistantManifest());
    const resolved = { profileId: current.profileId, accountSessionEpoch: current.epoch, command,
      subject: command.family === "start" ? { kind: "catalog", catalogKey: "assistant-selected-subject", bindingDigest: command.payload.inputFingerprint } : { kind: "none" }, cancelled: false, checkOutcome: { state: "none" } };
    const checked = checkAssistantAction({ phase: approval === undefined ? "prepare" : "dispatch",
      authority: { profileId: current.profileId, accountSessionEpoch: current.epoch, manifest },
      proposal: { commandId: command.commandId, family: command.family, action: command.type, target: command.target },
      resolved, ...(approval === undefined ? {} : { approval }) });
    if (checked.state === "refused") throw new AssistantAuthorizationError(checked.code, checked.code);
    return { checked, manifest };
  };
  const validate = (capability: Chat, row: AssistantActionRecord) => {
    chat(capability);
    if (row.chatId !== capability.chatId || Date.parse(row.expiresAt) <= ports.clock.nowMs()) throw new AssistantAuthorizationError("assistant-action-stale");
    const current = decision(capability, row.command, row.binding);
    if (current.checked.state !== "assistant-clear" || !same(row.binding, current.checked.binding)
      || !same(row.manifest, current.manifest)) throw new AssistantAuthorizationError("assistant-binding-stale");
    if (row.plan !== null) {
      const plan = ports.database.authority.startPlans.get(row.plan.startPlanId);
      if (plan === undefined || plan.consumedBy !== undefined || Date.parse(plan.expiresAt) <= ports.clock.nowMs()
        || !Object.entries(row.plan).every(([key, value]) => Reflect.get(plan, key) === value)) throw new AssistantAuthorizationError("assistant-plan-stale");
    }
  };
  return Object.freeze({
    createChat(): Chat {
      return ports.database.withAuthorityTransaction(() => {
        const current = ports.current(), createdAt = now(), chatId = randomUUID();
        repository.createChat({ id: chatId, ...current, createdAt,
          expiresAt: new Date(ports.clock.nowMs() + 3_600_000).toISOString() });
        const issued = Object.freeze({ chatId }); chats.add(issued); return issued;
      });
    },
    prepare(capability: Chat, input: unknown) {
      const command = AssistantStoredCommandSchema.parse(input);
      return ports.database.withAuthorityTransaction(() => {
        const { checked, manifest } = decision(capability, command);
        const id = randomUUID(), createdAt = now();
        let plan = null;
        if (command.family === "start") {
          const stored = ports.database.authority.startPlans.get(command.target.startPlanId);
          if (stored === undefined || stored.workflowId !== command.target.workflowId || stored.consumedBy !== undefined
            || stored.version !== command.target.expectedVersion || Date.parse(stored.expiresAt) <= ports.clock.nowMs()
            || !Object.entries(command.payload).every(([key, value]) => Reflect.get(stored, key) === value)) throw new AssistantAuthorizationError("assistant-plan-stale");
          plan = AssistantPlanBindingSchema.parse({ startPlanId: stored.startPlanId, version: stored.version, descriptorFingerprint: stored.descriptorFingerprint, configFingerprint: stored.configFingerprint, ingressSchemaHash: stored.ingressSchemaHash, canonicalInputSchemaHash: stored.canonicalInputSchemaHash, inputFingerprint: stored.inputFingerprint, expiresAt: stored.expiresAt });
        }
        repository.createAction({ id, chatId: capability.chatId, manifest, binding: checked.binding, command, plan,
          revision: 1, state: "prepared", result: null, createdAt,
          expiresAt: new Date(ports.clock.nowMs() + 60_000).toISOString() });
        return Object.freeze({ id, revision: 1, state: "prepared" as const });
      });
    },
    approve(capability: Chat, id: string, revision: number) {
      return ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        validate(capability, row);
        const approved = repository.transition(id, revision, "approved");
        return Object.freeze({ id: approved.id, revision: approved.revision, state: "approved" as const });
      });
    },
    cancel(capability: Chat, id: string, revision: number) {
      return ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        validate(capability, row);
        const cancelled = repository.transition(id, revision, "cancelled");
        return Object.freeze({ id: cancelled.id, revision: cancelled.revision, state: "cancelled" as const });
      });
    },
    assertEffect(commandId: string, command?: CommandRequest): void {
      const row = repository.actionByCommand(commandId);
      if (row === undefined) return;
      if (command !== undefined && !same(row.command, command)) throw new AssistantAuthorizationError("assistant-command-binding-mismatch", "ASSISTANT_PROPOSAL_MISMATCH");
      if (!activeClaims.has(commandId)) throw new AssistantAuthorizationError("assistant-effect-custody-unproved", "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
      startChecks.get(commandId)?.();
      ports.database.withAuthorityTransaction(() => {
        const current = ports.current(), owner = repository.chat(row.chatId);
        if (row.state !== "claimed" || owner === undefined || owner.profileId !== current.profileId || owner.epoch !== current.epoch
          || Date.parse(owner.expiresAt) <= ports.clock.nowMs() || Date.parse(row.expiresAt) <= ports.clock.nowMs()) throw new AssistantAuthorizationError("assistant-effect-not-authorized");
        const manifest = ports.kernel.assistantManifest();
        const checked = checkAssistantAction({ phase: "dispatch", authority: { profileId: current.profileId,
          accountSessionEpoch: current.epoch, manifest },
          proposal: { commandId, family: row.command.family, action: row.command.type, target: row.command.target },
          resolved: { profileId: current.profileId, accountSessionEpoch: current.epoch, command: row.command,
            subject: row.binding.subject, cancelled: false, checkOutcome: { state: "none" } }, approval: row.binding });
        if (checked.state !== "assistant-clear" || !same(checked.binding, row.binding) || !same(row.manifest, manifest)) throw new AssistantAuthorizationError("assistant-effect-binding-stale");
      });
    },
    async consumeAsync(capability: Chat, id: string) {
      const claimed = ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        validate(capability, row);
        if (row.state !== "approved" || row.command.family !== "worker-browser" || row.command.type !== "spawn-worker") throw new AssistantAuthorizationError("assistant-action-not-consumable");
        return repository.transition(id, row.revision, "claimed");
      });
      activeClaims.add(claimed.command.commandId);
      try {
        const result = await ports.kernel.executeWorkerPool(claimed.command);
        return ports.database.withAuthorityTransaction(() => {
          if (result.state === "pending") {
            repository.transition(id, claimed.revision, "unknown");
            throw new AssistantAuthorizationError("assistant-async-settlement-unproved", "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
          }
          repository.transition(id, claimed.revision, "settled", result);
          return result;
        });
      } catch (error) {
        ports.database.withAuthorityTransaction(() => {
          const current = repository.action(id);
          if (current?.state === "claimed") repository.transition(id, current.revision, "unknown");
        });
        throw error;
      } finally { activeClaims.delete(claimed.command.commandId); }
    },
    async consumeStart(capability: Chat, id: string, assertCurrent: () => void, submit: (command: CommandRequest) => Promise<CommandResult>) {
      const claimed = ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        validate(capability, row);
        if (row.state !== "approved" || row.command.family !== "start") throw new AssistantAuthorizationError("assistant-action-not-consumable");
        return repository.transition(id, row.revision, "claimed");
      });
      activeClaims.add(claimed.command.commandId);
      startChecks.set(claimed.command.commandId, assertCurrent);
      try {
        const result = await submit(claimed.command);
        return ports.database.withAuthorityTransaction(() => {
          if (result.state === "pending") throw new AssistantAuthorizationError("assistant-start-settlement-unproved");
          repository.transition(id, claimed.revision, "settled", result);
          return result;
        });
      } catch (error) {
        ports.database.withAuthorityTransaction(() => {
          const current = repository.action(id);
          if (current?.state === "claimed") repository.transition(id, current.revision, "unknown");
        });
        throw error;
      } finally { activeClaims.delete(claimed.command.commandId); startChecks.delete(claimed.command.commandId); }
    },
    reconcile(capability: Chat, id: string) {
      return ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        chat(capability);
        if (row.chatId !== capability.chatId || (row.state !== "claimed" && row.state !== "unknown")) throw new AssistantAuthorizationError("assistant-action-not-reconcilable");
        const audit = ports.database.authority.commandAudits.findByCommand(row.command.commandId);
        if (audit === undefined || !same(audit.request, row.command) || audit.result.state === "pending") throw new AssistantAuthorizationError("assistant-canonical-outcome-unproved");
        repository.transition(row.id, row.revision, "settled", audit.result);
        return audit.result;
      });
    },
    consume(capability: Chat, id: string) {
      // The claim commits before the kernel runs so its admitted command and recovery notice survive a thrown effect.
      const claim = ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        validate(capability, row);
        if (row.state === "settled") return { state: "settled" as const, result: row.result };
        if (row.state !== "approved" || (row.command.family === "worker-browser" || row.command.family === "start")) throw new AssistantAuthorizationError("assistant-action-not-consumable");
        return { state: "claimed" as const, claimed: repository.transition(id, row.revision, "claimed") };
      });
      if (claim.state === "settled") return claim.result;
      const claimed = claim.claimed;
      activeClaims.add(claimed.command.commandId);
      try {
        const result = ports.kernel.execute(claimed.command);
        return ports.database.withAuthorityTransaction(() => {
          if (result.state === "pending") throw new AssistantAuthorizationError("assistant-sync-settlement-unproved");
          repository.transition(id, claimed.revision, "settled", result);
          ports.current();
          return result;
        });
      } catch (error) {
        ports.database.withAuthorityTransaction(() => {
          const current = repository.action(id);
          if (current?.state === "claimed") repository.transition(id, current.revision, "unknown");
        });
        throw error;
      } finally { activeClaims.delete(claimed.command.commandId); }
    },
  });
}

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
