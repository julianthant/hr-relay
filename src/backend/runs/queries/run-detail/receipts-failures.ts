import { failureCodeFromTaskCode } from "../../../../models/failures/error-catalog.js";
import { StartPlanRequestSchema, type StartPlanRequest } from "../../../../models/dashboard/start-plan.js";
import { RerunRefusedError, previewRerunWarnings } from "../../start/rerun.js";
import { LogIdentityRefusedError } from "../../commands/refusals.js";
import { readTimelineRecords } from "../../../storage/events/timeline-reader.js";
import { FailureRetryWireSchema, projectFailureDisplay } from "../../../../models/dashboard/failure-display.js";
import type { FailureDisplaySchema } from "../../../../models/dashboard/failure-display.js";
import type { TimelineEventRecord } from "../../../../models/events/timeline.js";
import { projectObservedOperatorFields } from "../run-logs.js";
import { nodeIdOfTaskSpanPath } from "../../lifecycle/support.js";
import { aggregateMemberRetryAvailable } from "../run-retry.js";
import { ocrChildRetryAvailable } from "../../lifecycle/ocr-review-authority.js";
import { projectFailureResolution } from "../failure-resolution.js";
import { retainedRunProtectedBindings } from "../../../../models/write-safety/protected-input.js";
import { z } from "zod";
import {
  FailureDetailWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../../models/dashboard/run-detail.js";
import type { FailureDetailWire } from "../../../../models/dashboard/run-detail.js";
import type { RunDecisionWire } from "../../../../models/dashboard/run-decision.js";
import { projectDecision } from "../../decisions/project-decision.js";
import {
  projectFailureForOperator,
  type FailureRecord,
} from "../../../../models/trust/failure.js";
import { projectReceiptForOperator } from "../../../../models/trust/evidence.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../../models/trust/diagnostic.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { AnyWorkflowDescriptor } from "../../../../workflow-kit/workflow.js";
import type { RunDetailQueryDeps, RunDetailTrustDeps } from "../run-detail-types.js";
import { requireTrustRun, assertTrustEvidenceIdentity } from "../../trust/run-reader.js";
import { DiagnosticBundleCorruptError } from "../../commands/refusals.js";
import { availableSections } from "./availability.js";

export type ReceiptFailureSection = "receipt" | "failure";

export function buildReceiptFailureSection(
  deps: RunDetailQueryDeps,
  runId: string,
  section: ReceiptFailureSection,
): RunDetailSectionResponse {
  const authority = requireTrustRun(deps.runReader, runId);
  const served = availableSections(undefined, authority, deps.trust);
  if (!served.includes(section)) {
    if (section === "receipt") {
      return RunDetailSectionResponseSchema.parse({
        section,
        payload: { state: "missing", reason: receiptAbsenceReason(authority, deps.trust) },
      });
    }
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: {
        state: "missing",
        reason: deps.trust === undefined
          ? "this composition wires no trust service, so the structured failure record cannot be read"
          : "this run holds no structured failure record",
      },
    });
  }
  const trust = deps.trust;
  if (trust === undefined) {
    throw new Error(`section ${section} was advertised for run ${runId} without a trust service`);
  }

  if (section === "receipt") {
    const storedReceipt = trust.ensureReceipt(runId);
    assertTrustEvidenceIdentity(authority, storedReceipt, "receipt");
    const receipt = projectReceiptForOperator(storedReceipt);
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: { state: "available", value: receipt.value },
    });
  }

  if (authority.lifecycle.state !== "terminal" || authority.lifecycle.outcome !== "failed"
    || authority.lifecycle.failureId === undefined) {
    throw new Error(`run ${runId} advertises a failure section without a terminal failure record`);
  }
  const { failureId } = authority.lifecycle;
  const failure = trust.getFailure(failureId);
  if (failure === undefined) {
    throw new Error(
      `run ${runId} terminalized failed against failure ${failureId}, which authority does not hold`,
    );
  }
  assertTrustEvidenceIdentity(authority, failure, "failure");
  if (failure.failureId !== failureId) throw new Error(`TRUST_EVIDENCE_IDENTITY_MISMATCH: failure ${failureId}`);
  const records = readTimelineRecords(deps.timeline, 0, runId).records;
  const events = records.filter(record =>
    record.payload.kind === "span" && record.payload.event.t === "span.ended"
    && record.payload.event.kind === "run" && record.payload.event.failureId === failureId);
  if (events.length > 1) throw new LogIdentityRefusedError("RUN_LOG_FAILURE_NATIVE_IDENTITY_DUPLICATE");
  const event = events[0];
  const source = event?.payload.kind === "span" && "runId" in event.payload.event ? event.payload.event : undefined;
  if (source !== undefined && (source.traceId !== failure.traceId || source.attempt !== failure.attempt)) {
    throw new LogIdentityRefusedError("RUN_LOG_FAILURE_NATIVE_IDENTITY_MISMATCH");
  }
  const native = source === undefined || event === undefined ? {} : { native: {
    eventId: event.eventId, order: event.cursor, runId, attempt: failure.attempt,
    traceId: failure.traceId, spanPath: source.spanPath,
    ...(failure.nodeId === undefined ? {} : { nodeId: failure.nodeId }),
  } };
  const recovery = failureRecovery(deps, authority, failure);
  const value = FailureDetailWireSchema.parse({ ...native,
    ...recovery, ...failureDetailWire(
      runId,
      failure,
      trust,
      retainedRunProtectedBindings(authority).length > 0,
      deps.captures,
    ), display: failureDisplayFacts(deps, authority, failure, event === undefined ? records : records.filter(record => record.cursor < event.cursor)),
    retry: "recovery" in recovery ? undefined : failureRetry(deps, authority, failure),
  });
  return RunDetailSectionResponseSchema.parse({
    section: "failure",
    payload: { state: "available", value: { ...value, decision: failureDecision(value) } },
  });
}

/** Corrections retain their own retry; an ordinary retry is offered only through its served descriptor. */
export function failureDecision(failure: FailureDetailWire): RunDecisionWire {
  const annotate = { via: "command" as const, family: "failure-resolution", type: "annotate-failure" };
  const resolvable = failure.resolution?.capture.resolution.status === "unresolved";
  const recovery = failure.recovery;
  if (recovery !== undefined) {
    // The run's typed input never crosses this wire, except a rejected value the correction declares display-safe.
    const { correction, retry } = recovery;
    return projectDecision("correct-value", [
      { id: "retry-with-value", send: { via: "start-plan" }, label: correction.actionLabel, confirm: recovery.confirm,
        input: { kind: "text", label: correction.label, ...(correction.placeholder === undefined ? {} : { placeholder: correction.placeholder }), ...(correction.pattern === undefined ? {} : { pattern: correction.pattern }), ...(recovery.prefill === undefined ? {} : { prefill: recovery.prefill }) } },
      { id: "check-again", send: { via: "action", actionKey: retry.key }, ...(retry.kind === "command" && retry.confirm !== undefined ? { confirm: retry.confirm } : {}) },
    ]);
  }
  if (failure.writeState === "committed" || failure.writeState === "verified") {
    return projectDecision("failed-after-write", resolvable ? [{ id: "mark-as-failed", send: annotate }] : []);
  }
  return projectDecision("failed-retryable", failure.retry === undefined ? []
    : [{ id: "retry", send: { via: "action", actionKey: failure.retry.key } }]);
}

function failureRetry(deps: RunDetailQueryDeps, run: RunRecord, failure: FailureRecord): FailureDetailWire["retry"] {
  const canonical = deps.canonical;
  if (canonical === undefined || failure.writeState !== "not-attempted") return undefined;
  return canonical.database.withAuthorityReadSnapshot(() => {
    const descriptor = canonical.descriptors.resolve(run.envelope.workflow);
    const source = canonical.reader.read(run.envelope.runId);
    const repositories = canonical.database.authority;
    if (descriptor === undefined || descriptor.version !== run.envelope.descriptorVersion
      || descriptor.contractFingerprint !== run.envelope.contractFingerprint
      || source.state !== "present" || source.disposition !== "live"
      || run.input.parsed?.value === undefined || repositories.runs.admission().state !== "open"
      || repositories.writeIntents.listByRun(run.envelope.runId).length > 0) return undefined;
    if (descriptor.enqueue === "reject-active" && repositories.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId })
      .some(attempt => attempt.envelope.runId !== run.envelope.runId && attempt.lifecycle.state !== "terminal")) return undefined;
    if (run.envelope.parent !== undefined && !ocrChildRetryAvailable(repositories, canonical.reader, run,
      workflowId => canonical.descriptors.resolve(workflowId)) && !aggregateMemberRetryAvailable(repositories, canonical.reader, run,
      workflowId => canonical.descriptors.resolve(workflowId))) return undefined;
    return FailureRetryWireSchema.parse({ key: "retry-failed-step", label: "Retry step", kind: "command", command: "retry",
      expectedVersion: run.version, intent: "neutral", icon: "retry", placement: ["banner"] });
  });
}

function failureDisplayFacts(deps: RunDetailQueryDeps, run: RunRecord, failure: FailureRecord,
  records: readonly TimelineEventRecord[]): z.infer<typeof FailureDisplaySchema> {
  const descriptor = deps.descriptors.resolve(run.envelope.workflow);
  const labels = new Map(descriptor?.timeline?.flatMap(step => step.nodes.map(node => [node.id, node.label] as const)));
  const title = failure.nodeId === undefined ? undefined : labels.get(failure.nodeId);
  const protectedInput = retainedRunProtectedBindings(run).length > 0;
  const projected = projectFailureForOperator(failure, protectedInput);
  const display = { ...projectFailureDisplay(projected), ...(title === undefined ? {} : { title }), observation: projected.summary };
  let lastCompleted: string | undefined;
  let field: z.infer<typeof FailureDisplaySchema>["field"];
  for (const record of records) {
    if (Date.parse(record.occurredAt) > Date.parse(failure.occurredAt)) continue;
    const payload = record.payload;
    if (payload.kind !== "span" && payload.kind !== "note") continue;
    const identity = payload.kind === "span" ? payload.event : payload.note;
    if (!("runId" in identity) || identity.attempt !== failure.attempt) continue;
    if (identity.traceId !== failure.traceId) throw new LogIdentityRefusedError("RUN_LOG_FAILURE_NATIVE_IDENTITY_MISMATCH");
    if (payload.kind !== "span") continue;
    const event = payload.event;
    if (event.t === "span.ended" && event.kind === "task" && event.outcome === "done") {
      const nodeId = nodeIdOfTaskSpanPath(event.spanPath);
      const label = nodeId === undefined ? undefined : labels.get(nodeId);
      if (label !== undefined) lastCompleted = label;
    } else if (event.t === "data.observed") {
      if (Date.parse(event.observedAt) > Date.parse(failure.occurredAt)) continue;
      if (event.nodeId !== nodeIdOfTaskSpanPath(event.spanPath)) throw new LogIdentityRefusedError("RUN_LOG_FAILURE_NATIVE_IDENTITY_MISMATCH");
      const origin = descriptor?.dataOrigins?.find(entry => entry.nodeId === event.nodeId && entry.taskId === event.taskId);
      for (const observed of projectObservedOperatorFields(event, origin?.operatorFields)) {
        if (observed.direction !== "read") continue;
        lastCompleted = `Read ${observed.label}`;
        if (!protectedInput && observed.point.values.every(value => value.state === "allowed")) {
          field = { label: observed.label, value: observed.value, outcome: "Read" };
        }
      }
    }
  }
  return { ...display, ...(title === undefined ? {} : { attemptedAction: title }),
    ...(lastCompleted === undefined ? {} : { lastCompleted }), ...(field === undefined ? {} : { field }) };
}

export function failureRecovery(deps: RunDetailQueryDeps, run: RunRecord, failure: FailureRecord): object {
  const canonical = deps.canonical;
  const descriptor = canonical?.descriptors.resolve(run.envelope.workflow);
  const correction = descriptor?.failureCorrections?.find(entry => entry.nodeId === failure.nodeId && failureCodeFromTaskCode(entry.code) === failure.code);
  if (canonical === undefined || descriptor === undefined || correction === undefined || failure.writeState !== "not-attempted"
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint || descriptor.version !== run.envelope.descriptorVersion) return {};
  const request = correctionStartRequest(canonical, descriptor, run, { failureCorrection: { failureId: failure.failureId, inputField: correction.inputField } });
  if (request === undefined) return {};
  const rejected = correction.displaySafe === true ? (run.input.parsed.value as Record<string, unknown> | null)?.[correction.inputField] : undefined;
  return { recovery: { correction, expectedVersion: run.version, ...(typeof rejected === "string" && rejected !== "" ? { prefill: rejected } : {}),
    retry: { kind: "command", command: "retry", key: "check-again", label: "Check again", intent: "neutral", placement: ["banner"], expectedVersion: run.version,
      confirm: { title: "Check again", body: "Retry this run from its retained checkpoints.", confirmLabel: "Check again", tone: "neutral" } },
    confirm: { title: correction.actionLabel, body: "Relay reads the entered value in the real system before continuing. Identity still requires operator approval.", confirmLabel: correction.actionLabel, tone: "neutral" },
    request } };
}

/** The one-field rerun a correction card sends, or undefined when the canonical rerun owner refuses the source (uncertain writes, incompatible evidence). */
export function correctionStartRequest(canonical: NonNullable<RunDetailQueryDeps["canonical"]>, descriptor: AnyWorkflowDescriptor, run: RunRecord,
  correction: Readonly<{ failureCorrection: { failureId: string; inputField: string } }> | Readonly<{ gateCorrection: { gateId: string; inputField: string } }>): StartPlanRequest | undefined {
  const source = { runId: run.envelope.runId, expectedVersion: run.version, intent: "rerun" as const,
    selectedStepKeys: descriptor.timeline.filter(step => !run.envelope.stepOmissions?.some(omission => omission.step === step.key)).map(step => step.key),
    ...correction };
  try {
    const warnings = canonical.database.withAuthorityReadSnapshot(() => previewRerunWarnings(canonical.database.authority, descriptor, source));
    if (warnings.warnings.length > 0) return undefined;
  } catch (error) {
    if (error instanceof RerunRefusedError) return undefined;
    throw error;
  }
  return StartPlanRequestSchema.parse({ workflowId: descriptor.id, rerunSource: source, submissions: [{}],
    selectedStepKeys: source.selectedStepKeys, dryRun: run.envelope.dryRun, browserMode: run.envelope.browserMode ?? "headless",
    captureBrowserScreenshots: run.envelope.captureBrowserScreenshots ?? false, priority: run.envelope.priority,
    ...(run.envelope.requestedInstance === undefined ? {} : { requestedInstance: run.envelope.requestedInstance }) });
}

function receiptAbsenceReason(authority: RunRecord, trust?: RunDetailTrustDeps): string {
  if (trust === undefined) {
    return "this composition wires no trust service, so no receipt can be derived";
  }
  const { lifecycle } = authority;
  if (lifecycle.state !== "terminal") {
    return `run is ${lifecycle.state}; a receipt states a settled verdict and this run has none yet`;
  }
  return "run was interrupted; ref write-safety recovery will requeue or settle it before a receipt can name a verdict";
}


function failureDetailWire(
  runId: string,
  failure: FailureRecord,
  trust: RunDetailTrustDeps,
  protectedInput: boolean,
  captures: RunDetailQueryDeps["captures"],
): z.infer<typeof FailureDetailWireSchema> {
  const projected = projectFailureForOperator(failure, protectedInput);
  const diagnosticBundleId = validateFailureDiagnosticBundle(runId, failure, captures);
  const seen = trust.countFailuresByFingerprint(projected.fingerprint);
  const resolution = trust.failureResolution?.read(runId, failure.failureId);
  if (trust.failureResolution !== undefined && resolution === undefined) throw new Error("failure-resolution-annotation-missing");
  return FailureDetailWireSchema.parse({
    runId,
    failureId: projected.failureId,
    ...(resolution === undefined ? {} : {resolution:{capture:projectFailureResolution(resolution, protectedInput)}}),
    traceId: projected.traceId,
    attempt: projected.attempt,
    workflowId: projected.workflowId,
    ...(projected.nodeId === undefined ? {} : { nodeId: projected.nodeId }),
    ...(projected.taskId === undefined ? {} : { taskId: projected.taskId }),
    fingerprint: projected.fingerprint,
    code: projected.code,
    summary: projected.summary,
    display: projectFailureDisplay(projected),
    transient: projected.transient,
    writeState: projected.writeState,
    subject: projected.subject === undefined
      ? { state: "absent", reason: "this failure bound no transaction subject" }
      : { state: "present", ...projected.subject },
    ...(projected.page === undefined ? {} : { page: projected.page }),
    ...(projected.action === undefined ? {} : { action: projected.action }),
    causeChain: projected.causeChain,
    remediation: projected.remediation,
    // The record being projected is itself one occurrence, so a count that
    // came back short of 1 means the index disagrees with the row.
    sameFingerprintSeen: Math.max(1, seen),
    diagnosticBundle: diagnosticBundleId === undefined
      ? {
        state: "absent",
        reason: "no diagnostic bundle was captured",
      }
      : { state: "present", bundleId: diagnosticBundleId },
    occurredAt: projected.occurredAt,
  });
}

function validateFailureDiagnosticBundle(
  runId: string,
  failure: FailureRecord,
  captures: RunDetailQueryDeps["captures"],
): string | undefined {
  const bundleId = failure.diagnosticBundleId;
  if (bundleId === undefined) return undefined;

  const corrupt = (reason: string, cause?: unknown): never => {
    throw new DiagnosticBundleCorruptError(
      `failure ${failure.failureId} diagnostic bundle linkage is corrupt: ${reason}`,
      ...(cause === undefined ? [] : [{ cause }]),
    );
  };
  if (captures === undefined) return corrupt("no diagnostic capture authority is available");

  let stored: DiagnosticBundle | undefined;
  try {
    const value = captures.authority.get(bundleId);
    stored = value === undefined ? undefined : DiagnosticBundleSchema.parse(value);
  } catch (error: unknown) {
    return corrupt("the exact bundle record could not be read", error);
  }
  if (stored === undefined) return corrupt("the named bundle record is absent");
  if (stored.bundleId !== bundleId) return corrupt("the exact-id lookup returned another bundle");
  assertFailureBundleOrigin(stored, runId, failure.failureId, corrupt);

  let listed: readonly DiagnosticBundle[];
  try {
    listed = captures.authority.listByRun(runId).map((value) => DiagnosticBundleSchema.parse(value));
  } catch (error: unknown) {
    return corrupt("the run-indexed bundle set could not be read", error);
  }
  const bundleIds = new Set<string>();
  let indexed: DiagnosticBundle | undefined;
  for (const bundle of listed) {
    if (bundle.runId !== runId) return corrupt("the run index returned a foreign run identity");
    if (bundleIds.has(bundle.bundleId)) return corrupt("the run index repeated a bundle identity");
    bundleIds.add(bundle.bundleId);
    if (bundle.bundleId === bundleId) indexed = bundle;
  }
  if (indexed === undefined) return corrupt("the named bundle is absent from the run index");
  if (canonicalJsonStringify(indexed) !== canonicalJsonStringify(stored)) {
    return corrupt("the exact bundle record disagrees with the run index");
  }
  return bundleId;
}

function assertFailureBundleOrigin(
  bundle: DiagnosticBundle,
  runId: string,
  failureId: string,
  corrupt: (reason: string, cause?: unknown) => never,
): void {
  if (bundle.runId !== runId) return corrupt("the named bundle belongs to another run");
  if (bundle.origin.kind === "operator-request" || bundle.origin.failureId !== failureId) {
    return corrupt("the named bundle does not originate from this failure");
  }
}
