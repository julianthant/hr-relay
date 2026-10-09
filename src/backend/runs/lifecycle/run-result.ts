/** Factory-authenticated construction of durable terminal workflow results. */
import {
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import { RunRecordSchema } from "../../../models/run/record.js";
import {
  TerminalDependencyEvidenceSchema,
  type RunResultRecord,
} from "../../../models/run/result.js";

export { TerminalDependencyEvidenceSchema };


export function buildRunResult(
  descriptor: AnyWorkflowDescriptor,
  currentRun: unknown,
  evidence: unknown,
  clock: Clock,
): Readonly<{ record: RunResultRecord; authorization: object }> {
  return workflowTerminalResultExecution(descriptor).build(
    RunRecordSchema.parse(currentRun),
    evidence,
    clock,
  );
}


export function buildRunPreviewResult(
  descriptor: AnyWorkflowDescriptor,
  currentRun: unknown,
  preview: unknown,
  evidence: unknown,
  clock: Clock,
): Readonly<{ record: RunResultRecord; authorization: object }> {
  return workflowTerminalResultExecution(descriptor).buildPreview(
    RunRecordSchema.parse(currentRun),
    preview,
    evidence,
    clock,
  );
}
