import { createHash } from "node:crypto";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../workflow-kit/workflow.js";
import type { SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import type { AssistantSubject } from "../../models/dashboard/assistant.js";
import { AssistantProposalSchema } from "../../models/dashboard/assistant.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { planStart, type StartPlannerDeps, type StartPlanRequest } from "../runs/start/plan.js";

export interface AssistantPlanningContext {
  readonly subject: AssistantSubject;
  readonly deps: StartPlannerDeps;
  readonly request: StartPlanRequest;
  assertCurrent(): void;
  assertSubjectBinding(input: SchemaBoundCanonicalValue): void;
}
export interface AssistantPlanner {
  context(workflowId: string, subject: AssistantSubject): AssistantPlanningContext;
}
export function prepareAssistantProposal(planner: AssistantPlanner, workflowId: string, subject: AssistantSubject) {
  const context = planner.context(workflowId, subject), request = context.request;
  context.assertCurrent();
  if (JSON.stringify(context.subject) !== JSON.stringify(subject) || request.descriptor.id !== workflowId || !request.dryRun || request.submissions.length !== 1
    || request.rerun !== undefined || request.stepOmissions !== undefined || request.protectedSubmissionBindings !== undefined
    || request.retainedInputs !== undefined) throw new Error("assistant-proposal-refused");
  const support = workflowDryRunSupport(request.descriptor);
  if (support.state !== "supported") throw new Error("assistant-proposal-refused");
  const stop = descriptorRuntimeNodes(request.descriptor).find(node => String(node.id) === support.stopsAt);
  if (stop?.kind !== "transaction" || stop.dryRun !== "stop-after-prepare") throw new Error("assistant-proposal-refused");
  const plan = planStart(context.deps, request);
  context.assertCurrent();
  if (plan.refused.length > 0 || plan.planned.length !== 1 || Date.parse(plan.expiresAt) <= context.deps.clock.nowMs()) throw new Error("assistant-proposal-refused");
  context.assertSubjectBinding(plan.planned[0].input);
  context.assertCurrent();
  const options = JsonValueSchema.parse({ resolvedInstance: plan.resolvedInstance, priority: plan.priority, shape: plan.shape,
    ...(plan.browserMode === undefined ? {} : { browserMode: plan.browserMode }), captureBrowserScreenshots: plan.captureBrowserScreenshots });
  return AssistantProposalSchema.parse({
    workflowId, subject, intent: "dry-run", descriptorVersion: plan.descriptorVersion, descriptorFingerprint: plan.descriptorFingerprint,
    configSnapshotId: plan.configSnapshotId, configFingerprint: plan.configFingerprint, inputFingerprint: plan.inputFingerprint,
    optionsFingerprint: createHash("sha256").update(canonicalJsonStringify(options)).digest("hex"),
    expiresAt: plan.expiresAt, stopBefore: { nodeId: String(stop.id), phase: "commit", afterPrepareTaskId: String(stop.prepare.uses.id), commitTaskId: String(stop.commit.uses.id) },
    effects: { workflowExecuted: false, transactionCommitted: false }, confirmation: "required-in-run",
  });
}
