import { LogIdentityRefusedError } from "../../commands/refusals.js";
import { readTimelineRecords } from "../../../storage/events/timeline-reader.js";
import { projectFailureDisplay } from "../../../../models/dashboard/failure-display.js";
import { projectFailureResolution } from "../failure-resolution.js";
import { retainedRunProtectedBindings } from "../../../../models/write-safety/protected-input.js";
import { z } from "zod";
import {
  FailureDetailWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../../models/dashboard/run-detail.js";
import {
  projectFailureForOperator,
  type FailureRecord,
} from "../../../../models/trust/failure.js";
import { projectReceiptForOperator } from "../../../../models/trust/evidence.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../../models/trust/diagnostic.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { RunDetailQueryDeps, RunDetailTrustDeps } from "../run-detail-types.js";
import { requireTrustRun, assertTrustEvidenceIdentity } from "../../trust/run-reader.js";
import { DiagnosticBundleCorruptError } from "../../commands/refusals.js";
import { availableSections } from "./availability.js";
import { descriptorRuntimeNodes } from "../../../../workflow-kit/workflow.js";

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
  const events = readTimelineRecords(deps.timeline, 0, runId).records.filter(record =>
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
  const descriptor = deps.canonical?.descriptors.resolve(authority.envelope.workflow);
  const failedNode = descriptor === undefined ? undefined : descriptorRuntimeNodes(descriptor).find(node => node.id === failure.nodeId);
  const canCorrectDocument = authority.envelope.workflow === "separations" && failure.code === "DOCUMENT_UNAVAILABLE"
    && failure.writeState === "not-attempted" && failure.taskId === "kuali/read-separation-document"
    && failedNode?.kind === "task" && failedNode.uses.id === failure.taskId
    && descriptor?.version === authority.envelope.descriptorVersion && descriptor.contractFingerprint === authority.envelope.contractFingerprint
    && descriptor.surfaces.inputRun?.parser.rules.some(rule => rule.emit === "documentNumber"
      && rule.when.kind === "pattern" && rule.when.pattern === "document-number");
  return RunDetailSectionResponseSchema.parse({
    section: "failure",
    payload: { state: "available", value: { ...native,
      ...(canCorrectDocument ? { rerunInput: { field: "documentNumber", expectedVersion: authority.version } } : {}), ...failureDetailWire(
      runId,
      failure,
      trust,
      retainedRunProtectedBindings(authority).length > 0,
      deps.captures,
    ) } },
  });
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
    ...(resolution === undefined ? {} : {resolution:{capability:trust.failureResolution?.capability(),capture:projectFailureResolution(resolution, protectedInput)}}),
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
