import { pageAddress, sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { browserLoginFailure } from "../../systems/browser-shared/login-contract.js";
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
import { ErrorCatalogCodeSchema, failureCodeFromTaskCode, catalogCodeForThrown, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import {
  CURRENT_DIAGNOSTIC_SAFETY_VERSION,
  FailureRecordSchema,
  settledWriteState,
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
  /** The run's write intents; a settled one makes this a failure after that write. */
  readonly writes: readonly Readonly<{ status: string }>[];
  /** Evidence faults recorded after the node's own failure, such as a failure screenshot that was not taken. */
  readonly secondaryCauses?: readonly FailureEvidenceCause[];
}

export type FailureEvidenceCause = Readonly<{ code: ErrorCatalogCode; summary: string }>;

/** `wrapUnhandledTaskError`'s code for a task error nothing classified. */
const UNHANDLED_TASK_CODE = "unhandled";

/** A task's declared code, or an error's own catalogued code; anything else is an unclassified task failure. */
function nodeFailureCode(error: unknown, taskError: TaskError | undefined): string {
  const thrown = catalogCodeForThrown(error);
  if (thrown !== undefined) return thrown;
  if (taskError !== undefined && taskError.code !== UNHANDLED_TASK_CODE) return failureCodeFromTaskCode(taskError.code);
  const own = taskError === undefined && error instanceof Error && "code" in error && typeof error.code === "string"
    ? ErrorCatalogCodeSchema.safeParse(failureCodeFromTaskCode(error.code)) : undefined;
  return own?.success === true ? own.data : "TASK_UNHANDLED_FAILURE";
}

/** A fault that followed a node's own failure, recorded beside that failure rather than in its place. */
export function followingFailureCause(error: unknown, context: string): FailureEvidenceCause {
  const code = ErrorCatalogCodeSchema.safeParse(nodeFailureCode(error, error instanceof TaskError ? error : undefined));
  return { code: code.success ? code.data : "TASK_UNHANDLED_FAILURE",
    summary: `${context}: ${error instanceof Error ? error.message : "a non-Error value"}` };
}

export function buildNodeFailureRecord(input: NodeFailureInput): FailureRecord {
  const run = RunRecordSchema.parse(input.run);
  const occurredAt = IsoInstantSchema.parse(input.occurredAt);
  const nodeId = NodeIdSchema.parse(input.nodeId);
  const taskId = input.taskId === undefined ? undefined : TaskIdSchema.parse(input.taskId);
  const taskError: TaskError | undefined = input.error instanceof TaskError ? input.error : undefined;
  const code = nodeFailureCode(input.error, taskError);
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
    // A failing transaction parks through the sequencer; this records only writes the run already settled.
    writeState: settledWriteState(input.writes),
    ...(taskError?.subject === undefined || hasProtectedTransactionInput(run)
      ? {}
      : { subject: { expected: subjectEvidence(taskError.subject) } }),
    causeChain: [{
      code,
      summary,
      role: "primary",
      transient,
    }, ...(input.secondaryCauses ?? []).map(cause => ({ code: cause.code, summary: sanitizeDebugText(cause.summary), role: "secondary", transient: false }))],
    remediation: [transient
      ? { kind: "retry-when-served", message: `Retry once the underlying condition clears: ${summary}` }
      : { kind: "operator-action", message: `Investigate and correct at the source: ${summary}` }],
    ...(writeAuthorityReason === undefined ? {} : { writeAuthorityReason }),
    occurredAt,
  });
}

export interface EntryValidationFailureInput {
  readonly code?: "RUN_CONTINUATION_REFUSED";
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
  const code = ErrorCodeSchema.parse(input.code === undefined ? "RESUME_VALIDATION_FAILED" : input.code);
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

const DEBUG_TEXT_BUDGET = 96 * 1024;

/** Query, fragment and userinfo never stay in diagnostic text. An unreadable URL becomes a fixed token. */
function withoutPageQuery(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/giu, (raw) => {
    const address = pageAddress(raw);
    return address === "unreadable-address" ? "[invalid-url]" : address;
  });
}

/** Percent-encoding is decoded until it is plain or an undecodable run is replaced.
 * The raw run is not kept: a broken sequence can hide an employee id from the digit mask.
 * Decoding finishes before URL, credential and employee-id suppression, and does not run again. */
function decodeUriText(text: string): string {
  let current = text;
  let passes = 0;
  while (passes < 8) {
    passes += 1;
    let changed = false;
    current = current.replace(/(?:%[0-9A-Fa-f]{2})+/gu, (run) => {
      changed = true;
      try { return decodeURIComponent(run); }
      catch { return "[invalid-encoding]"; }
    });
    if (!changed) return current;
  }
  return current.replace(/(?:%[0-9A-Fa-f]{2})+/gu, () => "[invalid-encoding]");
}

/** An employee id is eight digits. These refusal fields are safe diagnostic text, so the digits do not stay. */
function withoutEmployeeId(text: string): string {
  return text.replace(/(?<!\d)\d{8}(?!\d)/gu, "[removed]");
}

function refusalText(text: string): string {
  return withoutEmployeeId(sanitizeDebugText(withoutPageQuery(decodeUriText(text))));
}

function signInRefusalFrom(error: Error) {
  const login = browserLoginFailure(error);
  if (login === undefined) return undefined;
  const reason = refusalText(login.detail);
  const address = refusalText(pageAddress(login.observedUrl));
  if (reason.length === 0) throw new Error("sign-in refusal reason is empty");
  if (address.length === 0) throw new Error("sign-in page address is empty");
  return { system: login.system, step: login.step, reason, pageAddress: address };
}

/** Keep a whole UTF-8 character or none of it. The caller spends only the bytes actually kept. */
function takeDebugText(text: string, remaining: { bytes: number }): string {
  const encoded = Buffer.from(text);
  let end = Math.min(encoded.byteLength, remaining.bytes);
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  const result = encoded.subarray(0, end).toString("utf8");
  remaining.bytes -= Buffer.byteLength(result);
  return result;
}

export function failureDebugDetails(error: Error) {
  const texts = [error.stack ?? error.message];
  const seen = new Set<unknown>([error]);
  let cause: unknown = error.cause;
  while (cause instanceof Error && !seen.has(cause) && texts.length < 13) {
    seen.add(cause); texts.push(`${cause.name}: ${cause.stack ?? cause.message}`); cause = cause.cause;
  }
  const safe = texts.map(sanitizeDebugText);
  const refusal = signInRefusalFrom(error);
  const originalBytes = safe.reduce((total, text) => total + Buffer.byteLength(text), 0)
    + (refusal === undefined ? 0 : Buffer.byteLength(refusal.reason) + Buffer.byteLength(refusal.pageAddress));
  // The page cannot spend the whole budget. The check is taken from what remains, then stack text.
  const pageSlot = { bytes: Math.floor(DEBUG_TEXT_BUDGET / 2) };
  const pageAddressText = refusal === undefined ? "" : takeDebugText(refusal.pageAddress, pageSlot);
  const remaining = { bytes: DEBUG_TEXT_BUDGET - Buffer.byteLength(pageAddressText) };
  const reasonText = refusal === undefined ? "" : takeDebugText(refusal.reason, remaining);
  const bounded = safe.map(text => takeDebugText(text, remaining));
  const signInRefusal = refusal === undefined || reasonText.length === 0 || pageAddressText.length === 0
    ? undefined
    : { system: refusal.system, step: refusal.step, reason: reasonText, pageAddress: pageAddressText };
  const retainedBytes = Buffer.byteLength(bounded[0] ?? "")
    + bounded.slice(1).reduce((total, text) => total + Buffer.byteLength(text), 0)
    + (signInRefusal === undefined ? 0 : Buffer.byteLength(signInRefusal.reason) + Buffer.byteLength(signInRefusal.pageAddress));
  return { stack: bounded[0] ?? "", causes: bounded.slice(1), originalBytes,
    omittedBytes: Math.max(0, originalBytes - retainedBytes),
    ...(signInRefusal === undefined ? {} : { signInRefusal }) };
}
