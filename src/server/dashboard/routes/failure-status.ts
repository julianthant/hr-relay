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
import { WireErrorSchema } from "../../../domain/dashboard/primitives.js";
import {
  ProjectionDegradedError,
  SectionUnavailableError,
  TargetNotFoundError,
} from "../../failures.js";
import { errorText } from "../support.js";

export function wireError(code: string, message: string, retryable: boolean): Record<string, unknown> {
  return WireErrorSchema.parse({ state: "error", code, message, retryable });
}

/**
 * The status a throw leaves as, decided by the error's KIND
 * (`src/server/failures.ts`) and never by reading its words.
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
 * carrying its real message, exactly as before — an unclassified throw is a
 * defect in this process, not a 404 the caller can act on.
 */
export function failureStatus(
  error: unknown,
): { status: 400 | 404 | 409 | 500; body: Record<string, unknown> } {
  if (error instanceof z.ZodError) {
    return { status: 400, body: wireError("SCHEMA_INVALID", z.prettifyError(error), false) };
  }
  const message = errorText(error);
  if (error instanceof TargetNotFoundError) {
    return { status: 404, body: wireError("TARGET_NOT_FOUND", message, false) };
  }
  if (error instanceof SectionUnavailableError) {
    return { status: 409, body: wireError("SECTION_UNAVAILABLE", message, false) };
  }
  if (error instanceof ProjectionDegradedError) {
    return { status: 500, body: wireError("PROJECTION_DEGRADED", message, true) };
  }
  return { status: 500, body: wireError("INTERNAL_FAILURE", message, false) };
}
