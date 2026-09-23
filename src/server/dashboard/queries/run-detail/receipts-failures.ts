import { projectFailureResolution } from "../failure-resolution.js";
import { retainedRunProtectedBindings } from "../../../../domain/protected-input.js";
import { z } from "zod";
import {
  FailureDetailWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../../domain/dashboard/run-detail.js";
import {
  projectFailureForOperator,
  type FailureRecord,
} from "../../../../domain/trust/failure.js";
import { projectReceiptForOperator } from "../../../../domain/trust/evidence.js";
import type { RunRecord } from "../../../../domain/run/record.js";
import type { RunDetailQueryDeps, RunDetailTrustDeps } from "../run-detail-types.js";
import { requireTrustRun, assertTrustEvidenceIdentity } from "../../../trust/run-reader.js";
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
    if (receipt.state === "withheld") {
      return RunDetailSectionResponseSchema.parse({
        section,
        payload: { state: "missing", reason: receipt.reason },
      });
    }
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
  return RunDetailSectionResponseSchema.parse({
    section: "failure",
    payload: { state: "available", value: failureDetailWire(runId, failure, trust, retainedRunProtectedBindings(authority).length > 0) },
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

/**
 * Project the durable `FailureRecord` onto the strict wire. The projection is
 * a whitelist BY CONSTRUCTION — every field is named here — so a field added
 * to the durable record later reaches no surface until someone decides how it
 * is classified. `sameFingerprintSeen` counts occurrences of the failure
 * CLASS, which is ref operator-trust §2.1's "same failure seen before" link.
 */
function failureDetailWire(
  runId: string,
  failure: FailureRecord,
  trust: RunDetailTrustDeps,
  protectedInput: boolean,
): z.infer<typeof FailureDetailWireSchema> {
  const projected = projectFailureForOperator(failure, protectedInput);
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
    diagnosticBundle: projected.diagnosticBundleId === undefined
      ? {
        state: "absent",
        reason: "no diagnostic bundle was captured; automatic capture is a separate 2g slice",
      }
      : { state: "present", bundleId: projected.diagnosticBundleId },
    occurredAt: projected.occurredAt,
  });
}
