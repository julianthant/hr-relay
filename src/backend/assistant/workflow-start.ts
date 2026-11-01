import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AssistantActionProposalSchema, type AssistantActionDecision, type AssistantActionResult, type AssistantRequest } from "../../models/dashboard/assistant.js";
import { StartCommandRequestSchema } from "../../rules/commands/commands.js";
import { canonicalJsonStringify, type JsonValue } from "../../rules/validation/canonical-json.js";
import { workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../workflow-kit/workflow.js";
import type { Clock } from "../../rules/time/clock.js";
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../runs/lifecycle/run-record-service.js";
import { requireTrustRun } from "../runs/trust/run-reader.js";
import type { StartPlanService } from "../runs/commands/start-plan-service.js";
import type { DashboardCommandService } from "../runs/commands/command-service.js";
import { selectActiveRunSettings } from "../runs/settings/run-settings.js";
import type { createAssistantAuthorization } from "./authorization.js";
import { AssistantLocalIntentError, type AssistantFunctionContext, type AssistantFunctionSet } from "./service.js";

const Selection = z.string().regex(/^run_[a-f0-9-]{36}_[1-9][0-9]*$/u);
const Parameters = z.strictObject({ reference: z.string().regex(/^ref_[a-f0-9]{32}$/u) });
export const ASSISTANT_START_SELECTED_WORKFLOW = "start selected workflow";

export function createAssistantWorkflowStarts(input: Readonly<{
  database: AuthorityDatabase; runs: Pick<RunRecordService, "read">; plans: StartPlanService;
  commands: DashboardCommandService; authorization: ReturnType<typeof createAssistantAuthorization>;
  descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  served(workflowId: string): boolean; actorId: string; clock: Clock; assertCurrent(): void;
}>) {
  function selected(request: AssistantRequest) {
    input.assertCurrent();
    const reference = Selection.parse(request.subjectRef), runId = reference.slice(4, 40), version = Number(reference.slice(41));
    const run = requireTrustRun(input.runs, runId), workflowId = run.envelope.workflow;
    if (run.version !== version || !input.served(workflowId) || run.input.parsed.protectedBindings.length > 0) throw new AssistantLocalIntentError("assistant-selected-run-stale");
    const descriptor = input.descriptors.resolve(workflowId);
    if (descriptor === undefined || descriptor.protectedInputs !== undefined && descriptor.protectedInputs.length > 0
      || descriptor.version !== run.envelope.descriptorVersion || descriptor.contractFingerprint !== run.envelope.contractFingerprint) throw new AssistantLocalIntentError("assistant-workflow-unavailable");
    const support = workflowDryRunSupport(descriptor);
    if (support.state !== "supported" && support.reason !== "no-transaction-node") throw new AssistantLocalIntentError("assistant-workflow-preview-unavailable");
    return { run, descriptor, dryRun: support.state === "supported" };
  }
  type Captured = { reference: string; selection: ReturnType<typeof selected>; assertCurrent(): void };
  type Pending = { chat: ReturnType<typeof input.authorization.createChat>; revision: number; expiresAt: string;
    record: NonNullable<ReturnType<AuthorityDatabase["authority"]["assistantAuthorization"]["action"]>>; assertCurrent(): void };
  const requests = new WeakMap<AssistantRequest, Captured>(), pending = new Map<string, Pending>();
  return {
    projectInput(request: AssistantRequest): { completion: "canonical-action"; input: JsonValue; citations: [] } {
      const selection = selected(request), identity = canonicalJsonStringify(selection.run);
      const reference = `ref_${randomUUID().replaceAll("-", "")}`;
      const assertCurrent = () => {
        input.assertCurrent();
        if (canonicalJsonStringify(selected(request).run) !== identity) throw new AssistantLocalIntentError("assistant-selected-run-stale");
      };
      requests.set(request, { reference, selection, assertCurrent });
      return { completion: "canonical-action", input: { intent: "workflow-start-proposal", workflow: selection.descriptor.id,
        mode: selection.dryRun ? "dry-run" : "live-read", reference }, citations: [] };
    },
    async bindFunctions(context: AssistantFunctionContext, signal: AbortSignal): Promise<readonly AssistantFunctionSet[]> {
      signal.throwIfAborted();
      for (const [id, entry] of pending) if (Date.parse(entry.expiresAt) <= input.clock.nowMs()) pending.delete(id);
      const captured = requests.get(context.request);
      if (captured === undefined) throw new AssistantLocalIntentError("assistant-selection-not-issued");
      requests.delete(context.request); captured.assertCurrent();
      return [{ namespace: "relay", description: "Propose only the selected subject's served workflow, without starting it.", functions: [{
        name: "propose_workflow_start", description: "Prepare one canonical plan for the selected subject. The operator must confirm before dispatch.", parameters: Parameters,
        async invoke(value, invocationSignal, invocationContext) {
          invocationSignal.throwIfAborted(); invocationContext.assertCurrent(); captured.assertCurrent();
          if (Parameters.parse(value).reference !== captured.reference) throw new AssistantLocalIntentError("assistant-selection-not-issued");
          captured.reference = "";
          const { run, descriptor, dryRun } = captured.selection;
          const settings = input.database.withAuthorityReadSnapshot(() => selectActiveRunSettings(input.database.authority));
          const request = { workflowId: descriptor.id, submissions: [run.input.raw], dryRun,
            browserMode: settings.config.browser.headless ? "headless" as const : "headed" as const,
            captureBrowserScreenshots: true };
          await input.plans.prepare?.(request, invocationSignal);
          invocationSignal.throwIfAborted(); invocationContext.assertCurrent(); captured.assertCurrent();
          const planned = input.plans.plan(request), plan = input.database.authority.startPlans.get(planned.startPlanId);
          if (plan === undefined || plan.refused.length > 0 || plan.planned.length !== 1 || plan.planned[0].input.schemaHash !== run.input.parsed.schemaHash
            || canonicalJsonStringify(plan.planned[0].input.value) !== canonicalJsonStringify(run.input.parsed.value)
            || plan.stepOmissions !== undefined || plan.rerun !== undefined) throw new AssistantLocalIntentError("assistant-workflow-plan-refused");
          const command = StartCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: input.clock.now().toISOString(),
            requestedBy: input.actorId, source: "assistant", family: "start", type: "start-run",
            target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version }, payload: planned.fingerprints });
          const chat = input.authorization.createChat(), proposal = input.authorization.prepare(chat, command);
          const record = input.database.authority.assistantAuthorization.action(proposal.id);
          if (record === undefined) throw new AssistantLocalIntentError("assistant-action-not-issued");
          const retained = invocationContext.assertRetainedCurrent?.bind(invocationContext);
          if (retained === undefined) throw new AssistantLocalIntentError("assistant-confirmation-owner-required");
          const assertCurrent = () => {
            captured.assertCurrent(); retained();
            const current = input.database.withAuthorityReadSnapshot(() => selectActiveRunSettings(input.database.authority));
            if (current.configSnapshotId !== plan.configSnapshotId || current.fingerprint !== plan.configFingerprint) throw new AssistantLocalIntentError("assistant-workflow-settings-stale");
          };
          assertCurrent();
          const action = AssistantActionProposalSchema.parse({ chatId: chat.chatId, actionId: proposal.id, revision: proposal.revision,
            expiresAt: record.expiresAt, label: `${dryRun ? "Dry run" : "Live read"}: ${descriptor.label}`, targetLabel: plan.planned[0].title,
            subject: "selected-run", effect: "workflow-start", workflowId: descriptor.id, dryRun });
          pending.set(proposal.id, { chat, revision: proposal.revision, expiresAt: record.expiresAt, record, assertCurrent });
          return { kind: "complete", result: { state: "action-proposal", proposal: action } };
        },
      }] }];
    },
    async decideAction(decision: AssistantActionDecision, signal: AbortSignal): Promise<AssistantActionResult> {
      signal.throwIfAborted(); input.assertCurrent();
      const issued = pending.get(decision.actionId);
      if (issued === undefined || issued.chat.chatId !== decision.chatId || issued.revision !== decision.revision
        || Date.parse(issued.expiresAt) <= input.clock.nowMs()) throw new AssistantLocalIntentError("assistant-action-not-current");
      issued.assertCurrent();
      if (canonicalJsonStringify(input.database.authority.assistantAuthorization.action(decision.actionId)) !== canonicalJsonStringify(issued.record)) throw new AssistantLocalIntentError("assistant-action-record-stale");
      if (decision.decision === "cancel") {
        input.authorization.cancel(issued.chat, decision.actionId, decision.revision); pending.delete(decision.actionId);
        return { state: "cancelled", actionId: decision.actionId };
      }
      pending.delete(decision.actionId);
      input.authorization.approve(issued.chat, decision.actionId, decision.revision);
      try {
        const result = await input.authorization.consumeStart(issued.chat, decision.actionId, () => issued.assertCurrent(), command => input.commands.submit(command));
        return result.state === "applied" ? { state: "applied", actionId: decision.actionId }
          : { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" };
      } catch { return { state: "unknown", actionId: decision.actionId }; }
    },
    owns(actionId: string): boolean { return pending.has(actionId); },
  };
}
