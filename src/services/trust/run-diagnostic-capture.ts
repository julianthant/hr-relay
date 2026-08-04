/**
 * The adapter between the interpreter's `RunDiagnosticCapture` port and the
 * capture service — i.e. doc 12 §2.2's task-failure trigger, wired.
 *
 * Every field it contributes is CLASSIFIED explicitly, so
 * `redactDiagnosticFields` transforms or drops it by policy rather than by this
 * module's judgement. Two deliberate omissions:
 *
 *  - `FailureRecord.summary` is not copied. It is free text that can carry a
 *    person's name or an EID, it already lives in the failure row the bundle is
 *    joined to, and duplicating it into an exportable bundle would widen the
 *    blast radius for nothing.
 *  - Screenshots and accessibility excerpts come from `attachmentsFor`, which
 *    is a SEAM. The interpreter terminalizes after its driver lease has closed,
 *    so it holds no page; the system driver layer is what can honestly produce
 *    a page attachment, and it fills this in when it exists. Absent, the bundle
 *    carries the structured evidence only — never a fabricated screenshot.
 */
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import type {
  RunDiagnosticCapture,
  RunDiagnosticCaptureContext,
} from "../../base/diagnostics.js";
import type { DiagnosticBundle } from "../../domain/trust/diagnostic.js";
import type { FailureRecord } from "../../domain/trust/failure.js";
import type {
  DiagnosticAttachmentSource,
  DiagnosticCaptureService,
} from "./diagnostic-capture.js";

/**
 * Doc 12 §2.2 distinguishes a task failure from a subject mismatch, and both
 * from an unexpected page state. The `FailureRecord` already knows which it is:
 * a mismatch names an expected/observed subject pair, and an unexpected state
 * carries the code the driver raises for it.
 */
export const UNEXPECTED_PAGE_STATE_CODE = "UNEXPECTED_PAGE_STATE";

export function diagnosticTriggerOfFailure(failure: FailureRecord): "task-failure" | "subject-mismatch" | "unexpected-state" {
  if (failure.subject?.expected !== undefined && failure.subject.observed !== undefined) return "subject-mismatch";
  if (failure.code === UNEXPECTED_PAGE_STATE_CODE) return "unexpected-state";
  return "task-failure";
}

/** Classified evidence, keyed to survive `ClassifiedDiagnosticValueSchema`. */
export function classifiedFailureFields(failure: FailureRecord): readonly unknown[] {
  return Object.freeze([
    { key: "failureCode", classification: "safe-diagnostic", transform: "allow", value: failure.code },
    { key: "failureFingerprint", classification: "safe-diagnostic", transform: "allow", value: failure.fingerprint },
    { key: "transient", classification: "safe-diagnostic", transform: "allow", value: failure.transient },
    { key: "writeState", classification: "safe-diagnostic", transform: "allow", value: failure.writeState },
    { key: "workflowId", classification: "safe-diagnostic", transform: "allow", value: failure.workflowId },
    { key: "attempt", classification: "safe-diagnostic", transform: "allow", value: failure.attempt },
    { key: "traceId", classification: "safe-diagnostic", transform: "allow", value: failure.traceId },
    { key: "causeChainLength", classification: "safe-diagnostic", transform: "count", value: failure.causeChain },
    ...(failure.nodeId === undefined
      ? []
      : [{ key: "nodeId", classification: "safe-diagnostic", transform: "allow", value: failure.nodeId }]),
    ...(failure.taskId === undefined
      ? []
      : [{ key: "taskId", classification: "safe-diagnostic", transform: "allow", value: failure.taskId }]),
    ...(failure.page?.screen === undefined
      ? []
      : [{ key: "screen", classification: "safe-diagnostic", transform: "allow", value: failure.page.screen }]),
    ...(failure.page?.state === undefined
      ? []
      : [{ key: "pageState", classification: "safe-diagnostic", transform: "allow", value: failure.page.state }]),
    // The producer's contract is that these are already redacted (the field
    // names say so); the digest keeps them joinable without republishing text.
    ...(failure.page?.urlRedacted === undefined
      ? []
      : [{ key: "pageUrl", classification: "sensitive-hr", transform: "digest", value: failure.page.urlRedacted }]),
    ...(failure.action?.elementId === undefined
      ? []
      : [{ key: "elementId", classification: "safe-diagnostic", transform: "allow", value: failure.action.elementId }]),
    ...(failure.action?.operation === undefined
      ? []
      : [{ key: "operation", classification: "safe-diagnostic", transform: "allow", value: failure.action.operation }]),
    ...(failure.subject?.expected === undefined
      ? []
      : [{ key: "subjectExpectedDigest", classification: "safe-diagnostic", transform: "allow", value: failure.subject.expected.digest }]),
    ...(failure.subject?.observed === undefined
      ? []
      : [{ key: "subjectObservedDigest", classification: "safe-diagnostic", transform: "allow", value: failure.subject.observed.digest }]),
  ]);
}

export interface RunDiagnosticCaptureOptions {
  readonly service: DiagnosticCaptureService;
  /**
   * The driver-side page evidence seam (screenshot, accessibility excerpt,
   * console/network summary). Absent means the bundle carries no attachment,
   * which is honest; a fabricated one would not be.
   */
  readonly attachmentsFor?: (failure: FailureRecord) => Promise<readonly DiagnosticAttachmentSource[]>;
}

export function createRunDiagnosticCapture(options: RunDiagnosticCaptureOptions): RunDiagnosticCapture {
  return Object.freeze({
    async captureForFailure(context: RunDiagnosticCaptureContext) {
      const attachments = await options.attachmentsFor?.(context.failure) ?? [];
      return options.service.prepare({
        trigger: diagnosticTriggerOfFailure(context.failure),
        runId: context.failure.runId,
        failureId: context.failure.failureId,
        configFingerprint: context.configFingerprint,
        descriptorFingerprint: context.descriptorFingerprint,
        fields: classifiedFailureFields(context.failure),
        attachments,
      });
    },
    persist: (bundle: DiagnosticBundle) => options.service.persist(bundle),
  });
}

/**
 * Doc 12 §2.2's fifth trigger: an operator asking for a snapshot of a run that
 * has not failed. It names the requesting actor and no failure — the local
 * operator seam (D75) supplies the constant id today.
 */
export function operatorRequestedCapture(input: Readonly<{
  service: DiagnosticCaptureService;
  runId: string;
  configFingerprint: string;
  descriptorFingerprint: string;
  fields: readonly unknown[];
  attachments?: readonly DiagnosticAttachmentSource[];
  requestedBy?: string;
  retention?: unknown;
}>) {
  return input.service.capture({
    trigger: "operator-request",
    runId: input.runId,
    requestedBy: input.requestedBy ?? LOCAL_OPERATOR_ACTOR_ID,
    configFingerprint: input.configFingerprint,
    descriptorFingerprint: input.descriptorFingerprint,
    fields: input.fields,
    attachments: input.attachments ?? [],
    ...(input.retention === undefined ? {} : { retention: input.retention }),
  });
}
