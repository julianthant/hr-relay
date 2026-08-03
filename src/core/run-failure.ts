/**
 * Executor-side construction of doc 12's strict `FailureRecord` (doc 03
 * §Phase-1f: `failures` is a non-rebuildable authority family — every failed
 * run stores one of these, and a display-safe span summary is not a
 * substitute).
 *
 * Two builders, matching the two ways a Phase-1 run fails:
 *
 * - a NODE failure carries the exact `(nodeId, taskId)` the run was executing
 *   — the atomic failure composite cross-checks both against the descriptor
 *   and the run's `currentNodeId`, so a record naming the wrong node cannot
 *   terminalize the run;
 * - an ENTRY-VALIDATION failure (doc 02 §5.4) happens in `validating`, before
 *   any node executes, so it deliberately names no node — and lists EVERY
 *   problem in one summary rather than forcing a fix-one-refresh-repeat loop.
 */
import { TaskError } from "../base/errors.js";
import {
  EidSchema,
  ErrorCodeSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  TaskIdSchema,
} from "../domain/ids.js";
import type { NodeId, TaskId } from "../domain/ids.js";
import { RunRecordSchema } from "../domain/run/record.js";
import { sha256Hex } from "../domain/sha256.js";
import { FailureRecordSchema, type FailureRecord } from "../domain/trust/failure.js";

/**
 * Task-contract error codes are kebab-case; `FailureRecord.code` is
 * SCREAMING_SNAKE_CASE. One deterministic transform, applied in one place.
 */
export function failureCodeFromTaskCode(code: string): string {
  return ErrorCodeSchema.parse(code.toUpperCase().replaceAll("-", "_"));
}

/**
 * The failure-CLASS fingerprint: workflow + node + task + code, not the
 * occurrence. Two runs failing the same way share it, which is what doc 12's
 * knowledge lookups key on.
 */
export function deriveFailureFingerprint(input: Readonly<{
  workflowId: string;
  nodeId?: string;
  taskId?: string;
  code: string;
}>): string {
  // Absence is encoded EXPLICITLY: a run-level failure (no node) must never
  // fingerprint-collide with a node whose id happened to be empty.
  const nodePart = input.nodeId === undefined ? "absent-node" : input.nodeId;
  const taskPart = input.taskId === undefined ? "absent-task" : input.taskId;
  return FailureFingerprintSchema.parse(sha256Hex(
    `hrauto:failure-class:v1\0${input.workflowId}\0${nodePart}\0${taskPart}\0${input.code}`,
  ));
}

function subjectEvidence(subject: string) {
  return {
    kind: EidSchema.safeParse(subject).success ? ("eid" as const) : ("name" as const),
    digest: FailureFingerprintSchema.parse(sha256Hex(`hrauto:failure-subject:v1\0${subject}`)),
  };
}

export interface NodeFailureInput {
  readonly run: unknown;
  readonly failureId: unknown;
  readonly nodeId: NodeId;
  /** Absent for control nodes (branch/parallel/child-run/gate), which own no task. */
  readonly taskId?: TaskId;
  readonly error: unknown;
  readonly occurredAt: unknown;
}

export function buildNodeFailureRecord(input: NodeFailureInput): FailureRecord {
  const run = RunRecordSchema.parse(input.run);
  const occurredAt = IsoInstantSchema.parse(input.occurredAt);
  const nodeId = NodeIdSchema.parse(input.nodeId);
  const taskId = input.taskId === undefined ? undefined : TaskIdSchema.parse(input.taskId);
  const taskError: TaskError | undefined = input.error instanceof TaskError ? input.error : undefined;
  const code = failureCodeFromTaskCode(taskError?.code ?? "unhandled");
  const summary = input.error instanceof Error
    ? input.error.message
    : `node ${nodeId} threw a non-Error value`;
  const transient = taskError?.transient ?? false;
  return FailureRecordSchema.parse({
    failureId: FailureIdSchema.parse(input.failureId),
    fingerprint: deriveFailureFingerprint({
      workflowId: run.envelope.workflow,
      nodeId,
      ...(taskId === undefined ? {} : { taskId }),
      code,
    }),
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    attempt: run.envelope.attempt,
    workflowId: run.envelope.workflow,
    nodeId,
    ...(taskId === undefined ? {} : { taskId }),
    code,
    summary,
    transient,
    /** Phase-1 read/control nodes; transaction failures are the sequencer's. */
    writeState: "not-attempted",
    ...(taskError?.subject === undefined
      ? {}
      : { subject: { expected: subjectEvidence(taskError.subject) } }),
    causeChain: [{
      code,
      summary,
      role: "primary",
      transient,
    }],
    remediation: [transient
      ? { kind: "retry-when-served", message: `Retry once the underlying condition clears: ${summary}` }
      : { kind: "operator-action", message: `Investigate and correct at the source: ${summary}` }],
    occurredAt,
  });
}

export interface EntryValidationFailureInput {
  readonly run: unknown;
  readonly failureId: unknown;
  readonly problems: readonly string[];
  readonly occurredAt: unknown;
}

/** Doc 02 §5.4: one failure lists ALL problems; no node executed, so no nodeId. */
export function buildEntryValidationFailureRecord(input: EntryValidationFailureInput): FailureRecord {
  const run = RunRecordSchema.parse(input.run);
  if (input.problems.length === 0) {
    throw new Error(`run ${run.envelope.runId} entry validation failure requires at least one named problem`);
  }
  const code = ErrorCodeSchema.parse("RESUME_VALIDATION_FAILED");
  const summary = [
    `ResumeValidationError: ${run.envelope.workflow} run ${run.envelope.runId}`
    + `${run.envelope.startAt === undefined ? "" : `, start at "${run.envelope.startAt}"`}:`,
    ...input.problems.map((problem) => `  ${problem}`),
  ].join("\n");
  return FailureRecordSchema.parse({
    failureId: FailureIdSchema.parse(input.failureId),
    fingerprint: deriveFailureFingerprint({ workflowId: run.envelope.workflow, code }),
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    attempt: run.envelope.attempt,
    workflowId: run.envelope.workflow,
    code,
    summary,
    transient: false,
    writeState: "not-attempted",
    causeChain: [{ code, summary: "entry validation refused the resume before any browser launched", role: "primary", transient: false }],
    remediation: [{
      kind: "operator-action",
      message: "Start from the named step, or supply corrections validated against each producing contract's output schema.",
    }],
    occurredAt: IsoInstantSchema.parse(input.occurredAt),
  });
}
