import { sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { hasProtectedTransactionInput } from "../../../models/write-safety/protected-input.js";

import { TaskError } from "../../../workflow-kit/errors.js";
import {
  WriteSafetyAuthorityError,
  type WriteAuthorityReason,
} from "../../../rules/write-safety/write-authority-reason.js";
import {
  EidSchema,
  ErrorCodeSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  TaskIdSchema,
} from "../../../rules/identity/ids.js";
import type { NodeId, TaskId } from "../../../rules/identity/ids.js";
import { RunRecordSchema } from "../../../models/run/record.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { catalogCodeForThrown } from "../../../models/failures/error-catalog.js";
import {
  CURRENT_DIAGNOSTIC_SAFETY_VERSION,
  FailureRecordSchema,
  type FailureRecord,
} from "../../../models/trust/failure.js";

function writeAuthorityReasonFrom(error: unknown): WriteAuthorityReason | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof WriteSafetyAuthorityError) return current.authorityReason;
    if (!(current instanceof Error) || current.cause === undefined) return undefined;
    current = current.cause;
  }
  return undefined;
}


export function failureCodeFromTaskCode(code: string): string {
  return ErrorCodeSchema.parse(code.toUpperCase().replaceAll("-", "_"));
}

// Failure fingerprints describe a failure class; occurrence identity must not split repeated failures.
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
  const errorCode = input.error instanceof Error && "code" in input.error && typeof input.error.code === "string" ? input.error.code : undefined;
  const code = catalogCodeForThrown(input.error) ?? failureCodeFromTaskCode(taskError?.code ?? errorCode ?? "unhandled");
  const summary = input.error instanceof Error
    ? Buffer.from(sanitizeDebugText(input.error.message)).subarray(0, 32 * 1024).toString("utf8")
    : `node ${nodeId} threw a non-Error value`;
  const transient = taskError?.transient ?? false;
  const writeAuthorityReason = writeAuthorityReasonFrom(input.error);
  return FailureRecordSchema.parse({
    // `Error.message` is opaque source detail. Keep it in durable authority,
    // but admit only the fixed non-Error fallback sentence to projection.
    ...(input.error instanceof Error
      ? {}
      : { diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION }),
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
    ...(input.error instanceof Error ? { debug: failureDebugDetails(input.error) } : {}),
    transient,
    // Transaction failures are owned by the sequencer.
    writeState: "not-attempted",
    ...(taskError?.subject === undefined || hasProtectedTransactionInput(run)
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
    ...(writeAuthorityReason === undefined ? {} : { writeAuthorityReason }),
    occurredAt,
  });
}

export interface EntryValidationFailureInput {
  readonly run: unknown;
  readonly failureId: unknown;
  readonly problems: readonly string[];
  readonly occurredAt: unknown;
}

/** Ref workflow-model: one failure lists ALL problems; no node executed, so no nodeId. */
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
    // Every problem is caller-supplied. Preserve the complete list in
    // authority while leaving operator projections on the typed failure code.
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

export function failureDebugDetails(error: Error) {
  const texts = [error.stack ?? error.message];
  const seen = new Set<unknown>([error]);
  let cause: unknown = error.cause;
  while (cause instanceof Error && !seen.has(cause) && texts.length < 13) {
    seen.add(cause); texts.push(cause.stack ?? cause.message); cause = cause.cause;
  }
  const safe = texts.map(sanitizeDebugText);
  const originalBytes = safe.reduce((total, text) => total + Buffer.byteLength(text), 0);
  let remaining = 96 * 1024;
  const bounded = safe.map(text => {
    const bytes = Buffer.from(text);
    const result = bytes.subarray(0, remaining).toString("utf8");
    remaining = Math.max(0, remaining - bytes.byteLength);
    return result;
  });
  return { stack: bounded[0] ?? "", causes: bounded.slice(1), originalBytes,
    omittedBytes: Math.max(0, originalBytes - 96 * 1024) };
}
