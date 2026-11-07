import { failureCodeFromTaskCode } from "../../../models/failures/error-catalog.js";
import { z } from "zod";
import { rerunInputFieldAccepts } from "../../../models/validation/rerun-values.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { StartPlanIngress } from "../../../models/dashboard/start-plan.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { RerunRefusedError } from "./rerun.js";

export function failureCorrectionSubmission(descriptor: AnyWorkflowDescriptor, run: RunRecord, failure: FailureRecord | undefined, request: StartPlanIngress) {
  const source = request.rerunSource;
  const correction = source?.failureCorrection;
  if (source === undefined || correction === undefined) throw new RerunRefusedError("invalid-value", "Failure correction source is required");
  if (run.version !== source.expectedVersion) throw new RerunRefusedError("source-stale", "Failure source revision changed");
  if (run.envelope.runId !== source.runId || run.envelope.workflow !== descriptor.id || run.envelope.contractFingerprint !== descriptor.contractFingerprint
    || run.envelope.descriptorVersion !== descriptor.version || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed"
    || run.lifecycle.failureId !== correction.failureId) throw new RerunRefusedError("invalid-state", "Failure correction source is unavailable");
  const declaration = descriptor.failureCorrections?.find(entry => entry.inputField === correction.inputField
    && entry.nodeId === failure?.nodeId && failureCodeFromTaskCode(entry.code) === failure.code);
  const patch = z.record(z.string(), JsonValueSchema).safeParse(request.submissions[0]);
  const value = patch.success && declaration !== undefined ? patch.data[declaration.inputField] : undefined;
  if (failure?.failureId !== correction.failureId || failure.runId !== source.runId
    || failure.traceId !== run.envelope.traceId || failure.attempt !== run.envelope.attempt || failure.workflowId !== descriptor.id || declaration === undefined || failure.writeState !== "not-attempted"
    || request.submissions.length !== 1 || !patch.success
    || Object.keys(patch.data).length !== 1 || typeof value !== "string" || !rerunInputFieldAccepts(descriptor.input, declaration.inputField, value)) {
    throw new RerunRefusedError("invalid-value", "Failure correction requires exactly its declared input value");
  }
  if (request.dryRun !== run.envelope.dryRun || request.browserMode !== (run.envelope.browserMode ?? "headless")
    || request.captureBrowserScreenshots !== (run.envelope.captureBrowserScreenshots ?? false)
    || request.stepOmissions !== undefined || source.copiedFrom !== undefined
    || JSON.stringify(request.requestedInstance) !== JSON.stringify(run.envelope.requestedInstance) || request.priority !== run.envelope.priority
    || JSON.stringify(descriptor.timeline.filter(step => !run.envelope.stepOmissions?.some(omission => omission.step === step.key)).map(step => step.key)) !== JSON.stringify(source.selectedStepKeys)) {
    throw new RerunRefusedError("invalid-value", "Failure correction must preserve execution options and reread every step");
  }
  const retained = z.object({}).passthrough().parse(run.input.parsed.value);
  const submission = { ...retained, [declaration.inputField]: value };
  for (const binding of descriptor.protectedInputs ?? []) delete submission[binding.inputPath];
  return JsonValueSchema.parse(submission);
}
