import { PreflightAdmissionRefusal } from "../../../../rules/preflight/preflight-admission.js";
import { RerunRefusedError } from "../../../runs/start/rerun.js";
/**
 * The ONE place a throw becomes an HTTP status and a `WireError` body
 * (Track D row D2, audit C3).
 *
 * It lives beside `api.ts` rather than inside it so the mapping can be driven
 * directly: the whole point of the change is that a REWORDED refusal must not
 * move a status, and that is a claim about this function, not about any one
 * route. `routes/failure-status.test.ts` exercises it with a plain `Error`
 * carrying the exact phrases the retired substring table used to key on.
 */
import { z } from "zod";
import { WireErrorSchema } from "../../../../models/dashboard/primitives.js";
import {
  DiagnosticBundleBytesMissingError,
  DiagnosticBundleCorruptError,
  ProjectionDegradedError,
  RequestIdentityRefusedError,
  SectionUnavailableError,
  TargetNotFoundError,
} from "../../../runs/commands/refusals.js";
import { StartStepOmissionRefusedError } from "../../../runs/start/step-selection.js";
import { errorText } from "../../../runs/lifecycle/support.js";
import { ProviderAuditUncertainError } from "../../../runs/commands/command-kernel.js";
import { ProviderKeyStoreUnknownError } from "../../../storage/configuration/provider-key-store.js";

export type WireError = z.infer<typeof WireErrorSchema>;

export function wireError(code: string, message: string, retryable: boolean): WireError {
  return WireErrorSchema.parse({ state: "error", code, message, retryable });
}

/**
 * The status a throw leaves as, decided by the error's KIND
 * (`src/backend/runs/refusals.ts`) and never by reading its words.
 *
 * Until Track D row D2 this classified by substring — four phrases
 * (`"is not registered"`, `"does not exist"`, `"has no span fold"`,
 * `"not in authority"`) meant 404, `"is not available"` meant 409, and
 * `"degraded"` meant a retryable 500. So rewording an operator-facing refusal
 * moved its status, and a new producer phrasing the same refusal differently
 * got a 500 nobody noticed. The message belongs to the operator; the kind
 * belongs to the protocol, and they are now two separate things.
 *
 * Anything that is neither a schema failure nor a DECLARED refusal is a 500
 * carrying its real message — an unclassified throw is a defect in this
 * process, not a 404 the caller can act on.
 *
 * ## The ONE class of status that moved, named rather than discovered
 *
 * Every route-reachable refusal that used to answer 404/409 still does, because
 * each of its producers now throws the matching kind. What changed is the tail
 * the substring table caught by accident: an authority-layer INVARIANT
 * violation whose message happens to contain `"does not exist"` — a start plan
 * row a command names, a notification row, a write intent, a worker lease
 * (`src/backend/storage/sqlite/authority-database.ts` and the kernel modules) — used to
 * reach the operator as a 404 saying "the thing you asked for is not here" and
 * now reaches them as a 500 saying "this process is broken". That is the more
 * honest of the two: those rows are not caller-named targets on a request path
 * (the command kernel REJECTS a command whose target is missing, and a
 * rejection is a `CommandResult` arm, never a throw), so a 404 there was false
 * precision minted by a phrase. If one of them is ever found to be a genuine
 * caller-named absence, the fix is to give that producer a kind — not to put
 * the substring table back.
 */
export function failureStatus(
  error: unknown,
): { status: 400 | 403 | 404 | 409 | 500; body: Record<string, unknown> } {
  if (error instanceof z.ZodError) {
    return { status: 400, body: wireError("SCHEMA_INVALID", z.prettifyError(error), false) };
  }
  const message = errorText(error);
  if (error instanceof PreflightAdmissionRefusal) return { status: 409, body: wireError(`PREFLIGHT_${error.reason.toUpperCase().replaceAll("-", "_")}`, message, false) };
  if (error instanceof TargetNotFoundError) {
    return { status: 404, body: wireError("TARGET_NOT_FOUND", message, false) };
  }
  if (error instanceof RerunRefusedError) {
    return { status: error.code === "target-not-found" ? 404 : 409,
      body: { ...wireError("RERUN_REFUSED", message, false), refusalCode: error.code } };
  }
  if (error instanceof StartStepOmissionRefusedError) {
    // A caller-input refusal, in the same 400 family a schema failure leaves
    // as: the request named a real workflow and asked a coherent question, and
    // the answer is that this omission does not reconcile with the descriptor.
    // Its own code travels so the surface can tell it from a shape failure.
    return { status: 400, body: wireError("START_STEP_OMISSION_REFUSED", message, false) };
  }
  if (error instanceof SectionUnavailableError) {
    return { status: 409, body: wireError("SECTION_UNAVAILABLE", message, false) };
  }
  if (error instanceof RequestIdentityRefusedError) {
    return { status: 403, body: wireError("REQUEST_IDENTITY_REFUSED", message, false) };
  }
  if (error instanceof ProviderAuditUncertainError) {
    return { status: 409, body: wireError("PROVIDER_AUDIT_UNCERTAIN", message, true) };
  }
  if (error instanceof ProviderKeyStoreUnknownError) {
    return { status: 409, body: wireError("PROVIDER_STORE_UNKNOWN", message, false) };
  }
  if (error instanceof ProjectionDegradedError) {
    return { status: 500, body: wireError("PROJECTION_DEGRADED", message, true) };
  }
  if (error instanceof DiagnosticBundleBytesMissingError) {
    return { status: 500, body: wireError("DIAGNOSTIC_BUNDLE_BYTES_MISSING", message, false) };
  }
  if (error instanceof DiagnosticBundleCorruptError) {
    return { status: 500, body: wireError("DIAGNOSTIC_BUNDLE_CORRUPT", message, false) };
  }
  return { status: 500, body: wireError("INTERNAL_FAILURE", message, false) };
}
