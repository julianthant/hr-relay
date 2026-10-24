import { type NotificationCollectionTarget, type NotificationCollectionOperation } from "../../models/notifications/notifications.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AssistantCitationSchema, ASSISTANT_FAILURES, AssistantActionProposalSchema, type AssistantRequest, type AssistantActionDecision, type AssistantActionResult } from "../../models/dashboard/assistant.js";
import { CommandRequestSchema, type CommandRequest } from "../../rules/commands/commands.js";
import { canonicalJsonStringify, type JsonValue } from "../../rules/validation/canonical-json.js";
import type { AssistantActionRecord } from "../../models/profiles/assistant-authorization.js";
import type { Clock } from "../../rules/time/clock.js";
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import type { CommandKernel } from "../runs/commands/command-kernel.js";
import type { createAssistantAuthorization } from "./authorization.js";
import type { AssistantFunctionContext, AssistantFunctionSet } from "./service.js";

import { ASSISTANT_SAFE_KNOWLEDGE, assistantKnowledgeArtifact } from "./context.js";
import { AssistantLocalIntentError } from "./service.js";

const ACTIONS = {
  "mark notifications read": "notification-read-all",
  "mark notifications unread": "notification-unread-all",
  "snooze notifications": "notification-snooze-all",
  "unsnooze notifications": "notification-unsnooze-all",
} as const;
type Action = typeof ACTIONS[keyof typeof ACTIONS];
type Intent = { kind: "help"; topic: keyof typeof ASSISTANT_SAFE_KNOWLEDGE } | { kind: "notification"; action: Action };
export function localAssistantIntent(request: AssistantRequest, knowledge: Readonly<Record<string, string>> = ASSISTANT_SAFE_KNOWLEDGE): Intent {
  if (request.subjectRef !== undefined) throw new AssistantLocalIntentError("assistant-local-intent-unavailable");
  const message = request.message.trim().toLowerCase();
  for (const topic of Object.keys(knowledge)) {
    if (message === `help ${topic}`.toLowerCase()) return { kind: "help", topic };
  }
  for (const phrase of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
    if (message === phrase) return { kind: "notification", action: ACTIONS[phrase] };
  }
  throw new AssistantLocalIntentError("assistant-local-intent-unavailable");
}

function operationOf(action: string): NotificationCollectionOperation {
  if (action === "notification-read-all") return "read";
  if (action === "notification-unread-all") return "unread";
  if (action === "notification-snooze-all") return "snooze";
  if (action === "notification-unsnooze-all") return "unsnooze";
  throw new AssistantLocalIntentError("assistant-collection-operation-unavailable");
}
function collectionLabel(action: string, count: number): string {
  const operation = operationOf(action);
  return operation === "read" ? `Mark ${count} current notifications read` : operation === "unread" ? `Mark ${count} current notifications unread`
    : operation === "snooze" ? `Snooze ${count} current notifications` : `Unsnooze ${count} current notifications`;
}

/** Captured references resolve only in this request's actual profile/command owner. */
export function createProductionAssistantTools(input: Readonly<{
  database: AuthorityDatabase; kernel: CommandKernel; authorization: ReturnType<typeof createAssistantAuthorization>;
  knowledge: ReturnType<typeof assistantKnowledgeArtifact>;
  actorId: string; clock: Clock; assertCurrent(): void;
}>) {
  type Captured = { intent: Intent; refs: Map<string, NotificationCollectionTarget> };
  const requests = new WeakMap<AssistantRequest, Captured>();
  type Pending = { chat: ReturnType<typeof input.authorization.createChat>; revision: number; command: CommandRequest; expiresAt: string; record: AssistantActionRecord; assertCurrent(): void };
  const pending = new Map<string, Pending>();
  const current = () => { input.assertCurrent(); };
  return Object.freeze({
    decideAction(decision: AssistantActionDecision, signal: AbortSignal): AssistantActionResult {
      signal.throwIfAborted(); current();
      const issued = pending.get(decision.actionId);
      if (issued === undefined || issued.chat.chatId !== decision.chatId || issued.revision !== decision.revision
        || Date.parse(issued.expiresAt) <= input.clock.nowMs()) throw new AssistantLocalIntentError("assistant-action-not-current");
      issued.assertCurrent();
      const stored = input.database.authority.assistantAuthorization.action(decision.actionId);
      if (stored === undefined || canonicalJsonStringify(stored) !== canonicalJsonStringify(issued.record)) throw new AssistantLocalIntentError("assistant-action-record-stale");
      if (issued.command.family !== "notification") throw new AssistantLocalIntentError("assistant-action-not-issued");
      if (!("members" in issued.command.target)) throw new AssistantLocalIntentError("assistant-collection-required");
      if (decision.decision === "cancel") {
        input.authorization.cancel(issued.chat, decision.actionId, decision.revision);
        pending.delete(decision.actionId);
        return { state: "cancelled", actionId: decision.actionId };
      }
      const target = issued.command.target;
      const observed = input.database.withAuthorityReadSnapshot(() => input.database.authority.notifications.collection(input.actorId, operationOf(issued.command.type)));
      if (canonicalJsonStringify(observed) !== canonicalJsonStringify(target)) throw new AssistantLocalIntentError("assistant-collection-stale");
      pending.delete(decision.actionId);
      input.authorization.approve(issued.chat, decision.actionId, decision.revision);
      try {
        const result = input.authorization.consume(issued.chat, decision.actionId);
        current(); issued.assertCurrent();
        return result?.state === "applied" ? { state: "applied", actionId: decision.actionId }
          : { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" };
      } catch { return { state: "unknown", actionId: decision.actionId }; }
    },
    projectInput(request: AssistantRequest): Readonly<{ completion: "answer" | "canonical-action"; input: JsonValue; citations: readonly z.infer<typeof AssistantCitationSchema>[] }> {
      current();
      const intent = localAssistantIntent(request, input.knowledge.topics), refs: Captured["refs"] = new Map();
      if (intent.kind === "notification") {
        const target = input.database.withAuthorityReadSnapshot(() => input.database.authority.notifications.collection(input.actorId, operationOf(intent.action)));
        refs.set(`ref_${randomUUID().replaceAll("-", "")}`, target);
      }
      current(); requests.set(request, { intent, refs });
      const knowledge = input.knowledge;
      if (intent.kind === "help") {
        const line = Object.keys(knowledge.topics).indexOf(intent.topic) + 1;
        return { completion: "answer", input: { intent: "app-help", topic: intent.topic, knowledge: knowledge.topics[intent.topic], source: knowledge.policy.exportSha256 },
          citations: [{ path: knowledge.reference.files[0].path, revision: knowledge.policy.revision, startLine: line, endLine: line,
            quote: `${intent.topic}: ${knowledge.topics[intent.topic]}` }] };
      }
      const collection = refs.values().next().value;
      if (collection === undefined) throw new AssistantLocalIntentError("assistant-collection-required");
      return { completion: "canonical-action", input: { intent: "notification", action: intent.action, count: collection.matchingCount, references: [...refs.keys()] }, citations: [] };
    },
    async bindFunctions(context: AssistantFunctionContext, signal: AbortSignal): Promise<readonly AssistantFunctionSet[]> {
      signal.throwIfAborted(); current();
      for (const [id, entry] of pending) if (Date.parse(entry.expiresAt) <= input.clock.nowMs()) pending.delete(id);
      const captured = requests.get(context.request);
      if (captured === undefined) throw new Error("assistant-request-not-projected");
      requests.delete(context.request);
      if (captured.intent.kind === "help") return [];
      const action = captured.intent.action;
      const manifest = input.kernel.assistantManifest();
      if (!manifest.entries.some(entry => entry.family === "notification" && entry.action === action)) {
        throw new Error("assistant-action-unavailable");
      }
      const metadata = input.kernel.assistantAvailability().find(entry => entry.action === action);
      if (metadata === undefined || metadata.availability !== "available") throw new AssistantLocalIntentError("assistant-action-unavailable");
      const parameters = z.strictObject({ reference: z.string().regex(/^ref_[a-f0-9]{32}$/u) });
      return [{ namespace: "relay", description: "Only the complete current notification collection action is available.", functions: [{
        name: action.replaceAll("-", "_"), description: metadata.summary,
        parameters,
        async invoke(value, invocationSignal, invocationContext) {
          invocationSignal.throwIfAborted(); current(); invocationContext.assertCurrent();
          if (canonicalJsonStringify(input.kernel.assistantManifest()) !== canonicalJsonStringify(manifest)) {
            throw new AssistantLocalIntentError("assistant-manifest-stale");
          }
          const reference = parameters.parse(value).reference, target = captured.refs.get(reference);
          if (target === undefined) throw new Error("assistant-reference-not-issued");
          const observed = input.database.withAuthorityReadSnapshot(() => input.database.authority.notifications.collection(input.actorId, operationOf(action)));
          if (canonicalJsonStringify(observed) !== canonicalJsonStringify(target)) throw new AssistantLocalIntentError("assistant-collection-stale");
          const command: CommandRequest = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: input.clock.now().toISOString(),
            requestedBy: input.actorId, source: "assistant", family: "notification", type: action,
            target });
          captured.refs.delete(reference);
          const chat = input.authorization.createChat();
          const proposal = input.authorization.prepare(chat, command);
          current(); invocationContext.assertCurrent();
          const record = input.database.authority.assistantAuthorization.action(proposal.id);
          if (record === undefined || record.state !== proposal.state || record.chatId !== chat.chatId) throw new AssistantLocalIntentError("assistant-action-owner-mismatch");
          const actionView = AssistantActionProposalSchema.parse({ chatId: chat.chatId, actionId: proposal.id,
            revision: proposal.revision, expiresAt: record.expiresAt, label: collectionLabel(action, target.matchingCount),
            targetLabel: `${target.matchingCount} current notifications`, subject: "none", effect: "local-write" });
          if (proposal.state === "prepared") {
            const retained = invocationContext.assertRetainedCurrent?.bind(invocationContext);
            if (retained === undefined) throw new AssistantLocalIntentError("assistant-confirmation-owner-required");
            pending.set(proposal.id, { chat, revision: proposal.revision, command, expiresAt: record.expiresAt, record, assertCurrent: retained });
            return { kind: "complete", result: { state: "action-proposal", proposal: actionView } };
          }
          current(); invocationContext.assertCurrent();
          invocationContext.effectEntered?.(actionView);
          try {
            const result = input.authorization.consume(chat, proposal.id);
            current(); invocationContext.assertCurrent();
            if (result?.state !== "applied") return { kind: "complete", result: { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED", message: ASSISTANT_FAILURES.ASSISTANT_PROPOSAL_REFUSED } };
            return { kind: "complete", result: { state: "answered", text: `${collectionLabel(action, target.matchingCount)}: completed. Only current local notifications were changed.`, citations: [] } };
          } catch {
            return { kind: "complete", result: { state: "unknown", actionId: actionView.actionId, action: actionView } };
          }
        },
      }] }];
    },
  });
}

export function assistantSurfaceCoverage(routes: readonly Readonly<{ method: string; path: string }>[]) {
  const actions = new Map<string, Readonly<{ method: string; path: string; availability: "handoff"; reason: "operator-interface-required" }>>();
  for (const route of routes) {
    if (route.method === "ALL") continue;
    const key = `${route.method} ${route.path}`;
    actions.set(key, { method: route.method, path: route.path, availability: "handoff", reason: "operator-interface-required" });
  }
  return [...actions.values()].sort((a, b) => {
    const left = `${a.method} ${a.path}`, right = `${b.method} ${b.path}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
