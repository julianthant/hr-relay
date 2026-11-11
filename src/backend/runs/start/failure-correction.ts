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
  if (source === undefined || correction === undefined || source.gateCorrection !== undefined) throw new RerunRefusedError("invalid-value", "Failure correction source is required");
  if (run.version !== source.expectedVersion) throw new RerunRefusedError("source-stale", "Failure source revision changed");
  if (!sourceMatches(descriptor, run, source.runId) || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed"
    || run.lifecycle.failureId !== correction.failureId) throw new RerunRefusedError("invalid-state", "Failure correction source is unavailable");
  const declaration = descriptor.failureCorrections?.find(entry => entry.inputField === correction.inputField
    && entry.nodeId === failure?.nodeId && failureCodeFromTaskCode(entry.code) === failure.code);
  if (failure?.failureId !== correction.failureId || failure.runId !== source.runId
    || failure.traceId !== run.envelope.traceId || failure.attempt !== run.envelope.attempt || failure.workflowId !== descriptor.id || declaration === undefined || failure.writeState !== "not-attempted") {
    throw new RerunRefusedError("invalid-value", "Failure correction requires exactly its declared input value");
  }
  return correctedSubmission(descriptor, run, request, declaration);
}

/** A typed value at a gate restarts the parked run's lookup with that one input; it never answers the gate. */
export function gateCorrectionSubmission(descriptor: AnyWorkflowDescriptor, run: RunRecord, request: StartPlanIngress) {
  const source = request.rerunSource;
  const correction = source?.gateCorrection;
  if (source === undefined || correction === undefined || source.failureCorrection !== undefined) throw new RerunRefusedError("invalid-value", "Gate correction source is required");
  if (run.version !== source.expectedVersion) throw new RerunRefusedError("source-stale", "Gate source revision changed");
  if (!sourceMatches(descriptor, run, source.runId) || run.lifecycle.state !== "parked-gate"
    || String(run.lifecycle.gateId) !== correction.gateId) throw new RerunRefusedError("invalid-state", "Gate correction source is unavailable");
  const declaration = descriptor.gateCorrections?.find(entry => entry.gateId === correction.gateId && entry.inputField === correction.inputField);
  if (declaration === undefined) throw new RerunRefusedError("invalid-value", "Gate correction requires exactly its declared input value");
  return correctedSubmission(descriptor, run, request, declaration);
}

function sourceMatches(descriptor: AnyWorkflowDescriptor, run: RunRecord, runId: string): boolean {
  return run.envelope.runId === runId && run.envelope.workflow === descriptor.id && run.envelope.contractFingerprint === descriptor.contractFingerprint
    && run.envelope.descriptorVersion === descriptor.version;
}

function correctedSubmission(descriptor: AnyWorkflowDescriptor, run: RunRecord, request: StartPlanIngress, { inputField, pattern }: Readonly<{ inputField: string; pattern?: string }>) {
  const source = request.rerunSource;
  const patch = z.record(z.string(), JsonValueSchema).safeParse(request.submissions[0]);
  const value = patch.success ? patch.data[inputField] : undefined;
  if (source === undefined || request.submissions.length !== 1 || !patch.success
    || Object.keys(patch.data).length !== 1 || typeof value !== "string" || !rerunInputFieldAccepts(descriptor.input, inputField, value)
    || (pattern !== undefined && !new RegExp(pattern, "u").test(value))) {
    throw new RerunRefusedError("invalid-value", "Correction requires exactly its declared input value");
  }
  if (request.dryRun !== run.envelope.dryRun || request.browserMode !== (run.envelope.browserMode ?? "headless")
    || request.captureBrowserScreenshots !== (run.envelope.captureBrowserScreenshots ?? false)
    || request.stepOmissions !== undefined || source.copiedFrom !== undefined
    || JSON.stringify(request.requestedInstance) !== JSON.stringify(run.envelope.requestedInstance) || request.priority !== run.envelope.priority
    || JSON.stringify(descriptor.timeline.filter(step => !run.envelope.stepOmissions?.some(omission => omission.step === step.key)).map(step => step.key)) !== JSON.stringify(source.selectedStepKeys)) {
    throw new RerunRefusedError("invalid-value", "Correction must preserve execution options and reread every step");
  }
  const retained = z.object({}).passthrough().parse(run.input.parsed.value);
  const submission = { ...retained, [inputField]: value };
  for (const binding of descriptor.protectedInputs ?? []) delete submission[binding.inputPath];
  return JsonValueSchema.parse(submission);
}
