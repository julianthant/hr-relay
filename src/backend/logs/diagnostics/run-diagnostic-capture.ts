import { recordBrowserAction, currentBrowserActionSessionId } from "../../systems/browser-shared/action-notes.js";

import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import type {
  RunDiagnosticCapture,
  RunDiagnosticCaptureContext,
  RunBrowserScreenshotCapture,
} from "../../../workflow-kit/diagnostics.js";
import type { DiagnosticBundle } from "../../../models/trust/diagnostic.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type {
  DiagnosticAttachmentSource,
  DiagnosticCaptureService,
} from "./diagnostic-capture.js";


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
    discard: (bundle: DiagnosticBundle) => options.service.discard(bundle),
  });
}


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

/** Persist a selected lease screenshot through the existing restricted diagnostic authority. */
export function createRunBrowserScreenshotCapture(input: Readonly<{
  service: DiagnosticCaptureService;
}>): RunBrowserScreenshotCapture {
  return Object.freeze({
    async capture(context: Parameters<RunBrowserScreenshotCapture["capture"]>[0]) {
      if (context.trigger.kind === "task-point" && currentBrowserActionSessionId() !== context.screenshot.sessionId) {
        throw new Error("task screenshot action has no matching active browser lease");
      }
      const bundle = await operatorRequestedCapture({
        service: input.service,
        runId: context.runId,
        configFingerprint: context.configFingerprint,
        descriptorFingerprint: context.descriptorFingerprint,
        fields: [
          { key: "browserSystem", classification: "safe-diagnostic", transform: "allow", value: context.system },
          { key: "browserSessionId", classification: "safe-diagnostic", transform: "allow", value: context.screenshot.sessionId },
          ...(context.trigger.kind === "task-point" ? [
            { key: "captureBoundary", classification: "safe-diagnostic" as const, transform: "allow" as const, value: context.trigger.boundary ?? "step" },
            { key: "nodeId", classification: "safe-diagnostic" as const, transform: "allow" as const, value: context.trigger.nodeId },
            { key: "runAttempt", classification: "safe-diagnostic" as const, transform: "allow" as const, value: context.trigger.attempt },
          ] : []),
          { key: "captureStage", classification: "safe-diagnostic", transform: "allow", value: context.trigger.kind },
          ...(context.trigger.kind === "lease-end" ? [{ key: "leaseOutcome", classification: "safe-diagnostic" as const, transform: "allow" as const, value: context.trigger.outcome }] : []),
          ...(context.screenshot.state === "unavailable" ? [{ key: "captureUnavailable", classification: "safe-diagnostic", transform: "allow", value: context.screenshot.reason }] : []),
        ],
        attachments: context.screenshot.state === "unavailable" ? [...(context.screenshot.diagnosticAttachments ?? [])] : [...(context.screenshot.diagnosticAttachments ?? []), {
          kind: "screenshot",
          mediaType: "image/png",
          sensitivity: "restricted",
          bytes: context.screenshot.bytes,
          width: context.screenshot.width,
          height: context.screenshot.height,
        }],
      });
      if (context.screenshot.state === "available") {
        const attachment = bundle.attachments.find((candidate) => candidate.kind === "screenshot");
        if (attachment === undefined) throw new Error("Screenshot capture persisted without its screenshot artifact");
        const recorded = recordBrowserAction("screenshot", `${context.system}.${context.trigger.kind === "task-point" ? "task-capture" : "browser-capture"}`, `${bundle.bundleId}:${attachment.artifactId}`);
        if (context.trigger.kind === "task-point" && !recorded) throw new Error("task screenshot action was not queued");
      }
    },
  });
}
