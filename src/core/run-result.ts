/** Factory-authenticated construction of durable terminal workflow results. */
import {
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../base/workflow.js";
import type { Clock } from "../domain/clock.js";
import { RunRecordSchema } from "../domain/run/record.js";
import {
  TerminalDependencyEvidenceSchema,
  type RunResultRecord,
} from "../domain/run/result.js";

export { TerminalDependencyEvidenceSchema };

/**
 * Build the result by invoking the exact descriptor-authored derive over the
 * run's canonical input and schema-validated checkpoint outputs. There is no
 * caller-supplied candidate value: the factory owns both derivation and seal.
 */
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
