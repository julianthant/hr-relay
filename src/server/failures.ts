/**
 * The BFF's REFUSAL KINDS, as types rather than as words (Track D row D2, audit C3).
 *
 * `routes/api.ts` has to answer every throw with a status code, and until this
 * module existed it did so by reading the thrown message: a list of four
 * substrings (`"is not registered"`, `"does not exist"`, `"has no span fold"`,
 * `"not in authority"`) meant 404, `"is not available"` meant 409, and
 * `"degraded"` meant a retryable 500. That is a classification derived from
 * PROSE — rewording a refusal, or adding a producer that phrases the same
 * refusal differently, silently moves a 404 to a 500 and vice versa, and
 * nothing in the tree fails when it happens. The message is for the operator;
 * it is not a protocol.
 *
 * So the KIND travels with the throw. A producer that means "the thing you
 * named is not here" throws `TargetNotFoundError`; one that means "this run
 * exists and this particular section/capability is not servable for it" throws
 * `SectionUnavailableError`; the projection refusing to answer over a degraded
 * fold throws `ProjectionDegradedError`, the one arm the wire marks retryable.
 * Everything else is a 500 with its real message, exactly as before.
 *
 * These live at `src/server/` rather than under `dashboard/` because the trust
 * receipt service (`src/server/trust/`) is one of the producers the route maps,
 * and a shared refusal vocabulary that only half the server can import is the
 * same defect one directory down.
 */

/**
 * The named target does not exist: an unknown run, archived run, capture or
 * intake session, an unregistered workflow, or a run the span stream names and
 * authority does not. Answered 404.
 */
export class TargetNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TargetNotFoundError";
  }
}

/**
 * The target exists and the SECTION or capability asked of it is not servable
 * — a section this run never had, an advisory with no failure to explain, an
 * advisory provider this process did not compose. Answered 409, because the
 * caller asked a coherent question about a real thing and the answer is "not
 * for this one", never "no such thing".
 */
export class SectionUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SectionUnavailableError";
  }
}

/**
 * The run/queue projection is degraded and refuses to derive from a fold it
 * cannot trust. The ONE retryable arm: the projection's guarded rebuild may
 * clear it, so a caller that asks again later can legitimately get an answer.
 */
export class ProjectionDegradedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectionDegradedError";
  }
}

/**
 * A durable D137 bundle or one of its content-addressed attachments no longer
 * agrees with its own recorded identity. This is a server fault, never an
 * ordinary missing target, and it must be visible as a typed route error.
 */
export class DiagnosticBundleCorruptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiagnosticBundleCorruptError";
  }
}

/**
 * Exact diagnostic authority names an attachment whose physical bytes are
 * missing. This does not attest a purge: the authority record still exists.
 * Kept distinct from malformed bytes without inspecting free-text causes.
 * Existing corruption catchers still refuse it; the wire mapper checks this
 * narrower kind first so viewers can tell physical absence from bad bytes.
 */
export class DiagnosticBundleBytesMissingError extends DiagnosticBundleCorruptError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiagnosticBundleBytesMissingError";
  }
}
