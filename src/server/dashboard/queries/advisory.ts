/**
 * The BFF's advisory seam (ref operator-trust §4.4, D178).
 *
 * It does three things and nothing else: read the subject run and its failure
 * from authority, obtain an admitted client bound to that run's OWN retained
 * identity, and hand the failure VALUE to the producer. It never writes, and
 * the producer it calls holds no store — so "an advisory cannot reach
 * authority" is a property of the wiring rather than a rule someone follows.
 *
 * A run with no failure is not an error condition to smooth over: there is
 * nothing to triage, and the route says so with a 404-shaped message rather
 * than asking a model about an empty record.
 */
import {
  RunAdvisoryWireSchema,
  type RunAdvisoryWire,
} from "../../../domain/dashboard/advisory.js";
import { RunIdSchema } from "../../../domain/ids.js";
import type { FailureTriageOutcome } from "../../../domain/trust/advisory.js";
import type { FailureRecord } from "../../../domain/trust/failure.js";
import type { RunRecord } from "../../../domain/run/record.js";
import { SectionUnavailableError } from "../../failures.js";
import { requireTrustRun, assertTrustEvidenceIdentity, type TrustRunReader } from "../../trust/run-reader.js";

export interface AdvisoryQueryDeps {
  readonly runReader: Pick<TrustRunReader, "read">;
  readonly authority: Readonly<{
    /** The run's terminal failure, when it has one. */
    getFailureForRun: (runId: string) => FailureRecord | undefined;
  }>;
  /**
   * Produce one advisory. The composition root owns this closure because it
   * alone holds the adapters and the admission repository — and because the
   * query then names no provider type at all, which is exactly the D162
   * boundary this seam is careful not to widen twice.
   */
  readonly advise: (run: RunRecord, failure: FailureRecord) => Promise<FailureTriageOutcome>;
}

export async function buildRunAdvisory(
  deps: AdvisoryQueryDeps,
  runIdInput: string,
): Promise<RunAdvisoryWire> {
  const runId = RunIdSchema.parse(runIdInput);
  const run = requireTrustRun(deps.runReader, runId);
  if (run.lifecycle.state !== "terminal" || run.lifecycle.failureId === undefined) {
    throw new SectionUnavailableError(`run ${runId} has no terminal failure; the failure advisory is not available`);
  }
  const failure = deps.authority.getFailureForRun(runId);
  if (failure === undefined) {
    // Not a degraded advisory — there is genuinely nothing to explain.
    throw new SectionUnavailableError(`run ${runId} has no failure record; the failure advisory is not available`);
  }
  const assertFailure = (current: RunRecord): void => {
    assertTrustEvidenceIdentity(current, failure, "advisory failure");
    if (current.lifecycle.state !== "terminal" || current.lifecycle.failureId !== failure.failureId) {
      throw new Error(`TRUST_EVIDENCE_IDENTITY_MISMATCH: advisory failure for ${runId}`);
    }
  };
  assertFailure(run);
  const outcome = await deps.advise(run, failure);
  assertFailure(requireTrustRun(deps.runReader, runId));
  return RunAdvisoryWireSchema.parse({
    wireVersion: 1,
    runId,
    failureId: failure.failureId,
    outcome,
  });
}
