import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkAssistantAction } from "./action-policy.js";
import { AssistantActionManifestSchema, type AssistantRefusalCode, type AssistantApprovalBinding } from "../../models/profiles/assistant-permissions.js";
import { AssistantStoredCommandSchema, type AssistantActionRecord } from "../../models/profiles/assistant-authorization.js";
import { type CommandRequest } from "../../rules/commands/commands.js";
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
    const grant = repository.grant();
    if (grant === undefined || grant.profileId !== current.profileId) throw new AssistantAuthorizationError("assistant-grant-required", "ASSISTANT_GRANT_REQUIRED");
    const manifest = AssistantActionManifestSchema.parse(ports.kernel.assistantManifest());
    const resolved = { profileId: current.profileId, accountSessionEpoch: current.epoch, command,
      subject: { kind: "none" }, cancelled: false, checkOutcome: { state: "none" } };
    const checked = checkAssistantAction({ phase: approval === undefined ? "prepare" : "dispatch",
      authority: { profileId: current.profileId, accountSessionEpoch: current.epoch, policy: grant.policy, manifest },
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
        repository.createAction({ id, chatId: capability.chatId, manifest, binding: checked.binding, command, plan: null,
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
      ports.database.withAuthorityTransaction(() => {
        const current = ports.current(), owner = repository.chat(row.chatId);
        if (row.state !== "claimed" || owner === undefined || owner.profileId !== current.profileId || owner.epoch !== current.epoch
          || Date.parse(owner.expiresAt) <= ports.clock.nowMs() || Date.parse(row.expiresAt) <= ports.clock.nowMs()) throw new AssistantAuthorizationError("assistant-effect-not-authorized");
        const grant = repository.grant(), manifest = ports.kernel.assistantManifest();
        if (grant === undefined) throw new AssistantAuthorizationError("assistant-grant-required", "ASSISTANT_GRANT_REQUIRED");
        const checked = checkAssistantAction({ phase: "dispatch", authority: { profileId: current.profileId,
          accountSessionEpoch: current.epoch, policy: grant.policy, manifest },
          proposal: { commandId, family: row.command.family, action: row.command.type, target: row.command.target },
          resolved: { profileId: current.profileId, accountSessionEpoch: current.epoch, command: row.command,
            subject: { kind: "none" }, cancelled: false, checkOutcome: { state: "none" } }, approval: row.binding });
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
      return ports.database.withAuthorityTransaction(() => {
        const row = repository.action(z.uuid().parse(id));
        if (row === undefined) throw new AssistantAuthorizationError("assistant-action-missing");
        validate(capability, row);
        if (row.state === "settled") return row.result;
        if (row.state !== "approved" || row.command.family === "worker-browser") throw new AssistantAuthorizationError("assistant-action-not-consumable");
        const claimed = repository.transition(id, row.revision, "claimed");
        activeClaims.add(row.command.commandId);
        try {
          const result = ports.kernel.execute(row.command);
          if (result.state === "pending") throw new AssistantAuthorizationError("assistant-sync-settlement-unproved");
          repository.transition(id, claimed.revision, "settled", result);
          ports.current();
          return result;
        } finally { activeClaims.delete(row.command.commandId); }
      });
    },
  });
}
