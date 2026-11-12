import type { WorkerBrowserSessionFactory } from "../../../workflow-kit/session.js";
import type { RunMutationOutcome } from "../../runs/lifecycle/run-record-service.js";
import type { RunRecord } from "../../../models/run/record.js";
import { PreflightAdmissionRefusal, PreflightObservationChangedError, type PreflightAdmissionScope } from "../../../rules/preflight/preflight-admission.js";
import { preflightRunnerTimeout } from "../../../models/preflight/preflight.js";
import type { WorkerPreflightRefusal } from "../../../models/preflight/preflight-contract.js";
import type { RuntimePreflight } from "./runtime-admission.js";

export function workerPreflightRefusal(error: unknown, runId?: RunRecord["envelope"]["runId"]): WorkerPreflightRefusal | undefined {
  if (preflightRunnerTimeout(error) !== undefined) {
    return { state: "preflight-refused", code: "PREFLIGHT_TIMEOUT", ...(runId === undefined ? {} : { runId }) };
  }
  const code = error instanceof PreflightObservationChangedError || (error instanceof PreflightAdmissionRefusal && error.reason === "stale")
    ? "PREFLIGHT_OBSERVATION_CHANGED"
    : error instanceof PreflightAdmissionRefusal && (error.reason === "blocked" || error.reason === "unavailable" || error.reason === "scope-mismatch")
      ? "PREFLIGHT_BLOCKED" : undefined;
  if (code === undefined) return undefined;
  const summary = error instanceof PreflightAdmissionRefusal ? error.observationSummary : undefined;
  return { state: "preflight-refused", code, ...(runId === undefined ? {} : { runId }), ...(summary === undefined || summary === "" ? {} : { summary }) };
}

class PreparationRequired extends Error {
  constructor(readonly scope: PreflightAdmissionScope, readonly run: RunRecord) { super("Selected run needs preflight preparation."); }
}
const CLAIM_ATTEMPTS = 4;
/** Selection and assertion are atomic. A thrown preparation request rolls back before the claim write. Preparations stop at the attempt bound; a preparation that succeeds still claims.
 * A preparation that fails because another worker changed the candidate re-selects; lost races alone end as an idle re-poll. */
export async function claimWithPreflight(input: Readonly<{
  preflight: RuntimePreflight; signal: AbortSignal;
  prepareRun(run: RunRecord, signal: AbortSignal): Promise<void>;
  claim(admit: (run: RunRecord) => void): RunMutationOutcome;
  candidateCurrent(run: RunRecord): boolean;
  onObservationChanged?(attempt: number): void;
}>): Promise<RunMutationOutcome | WorkerPreflightRefusal> {
  let prepared: Readonly<{ runId: string; version: number }> | undefined;
  let lostRace = false;
  for (let attempt = 0; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
    if (input.signal.aborted) throw input.signal.reason;
    let selected: RunRecord | undefined;
    try {
      return input.claim(run => {
        selected = run;
        if (run.pause !== undefined) throw new PreflightAdmissionRefusal("stale", "Paused work cannot prepare or acquire a claim.");
        const scope = input.preflight.runScope(run.envelope);
        try { input.preflight.admission.assertReady(scope); }
        catch (error) {
          if (error instanceof PreflightAdmissionRefusal && (error.reason === "unavailable" || error.reason === "stale")) throw new PreparationRequired(scope, run);
          throw error;
        }
        if (prepared?.runId !== run.envelope.runId || prepared.version !== run.version) throw new PreparationRequired(scope, run);
      });
    } catch (error) {
      if (!(error instanceof PreparationRequired)) {
        const refusal = workerPreflightRefusal(error, selected?.envelope.runId);
        if (refusal !== undefined) return refusal;
        throw error;
      }
      if (attempt === CLAIM_ATTEMPTS) return lostRace ? { state: "refused", refusal: { reason: "none-eligible" } } : { state: "preflight-refused", code: "PREFLIGHT_OBSERVATION_CHANGED", runId: error.run.envelope.runId };
      try {
        await input.preflight.admission.prepare(error.scope, input.signal);
        input.preflight.admission.assertReady(error.scope);
        if (prepared?.runId !== error.run.envelope.runId || prepared.version !== error.run.version) {
          await input.prepareRun(error.run, input.signal);
          prepared = { runId: error.run.envelope.runId, version: error.run.version };
        }
      } catch (preparationError) {
        const refusal = workerPreflightRefusal(preparationError, error.run.envelope.runId);
        if (refusal === undefined) {
          if (input.candidateCurrent(error.run)) throw preparationError;
          lostRace = true;
          input.onObservationChanged?.(attempt + 1);
          continue;
        }
        lostRace = false;
        if (refusal.code === "PREFLIGHT_BLOCKED" || refusal.code === "PREFLIGHT_TIMEOUT" || attempt === CLAIM_ATTEMPTS - 1) return refusal;
        input.onObservationChanged?.(attempt + 1);
      }
    }
  }
  return { state: "preflight-refused", code: "PREFLIGHT_OBSERVATION_CHANGED" };
}

export function preflightSessionFactory(factory: WorkerBrowserSessionFactory, preflight: RuntimePreflight, scope: PreflightAdmissionScope): WorkerBrowserSessionFactory {
  return Object.freeze({
    async open(request: Parameters<WorkerBrowserSessionFactory["open"]>[0]) {
      if (request.configFingerprint !== scope.configFingerprint
        || !scope.requestedCapabilities.includes(`system.${request.system}.${request.instance ?? "prod"}` as PreflightAdmissionScope["requestedCapabilities"][number])) {
        throw new PreflightAdmissionRefusal("scope-mismatch", "Browser request differs from its admitted preflight scope.");
      }
      await preflight.prepareSession(scope, request.system, request.signal);
      return factory.open(request);
    },
    async probeProfile(request: Parameters<WorkerBrowserSessionFactory["probeProfile"]>[0]) {
      if (!scope.requestedCapabilities.includes(`system.${request.system}.${request.instance ?? "prod"}` as PreflightAdmissionScope["requestedCapabilities"][number])) throw new PreflightAdmissionRefusal("scope-mismatch", "Browser probe differs from its admitted preflight scope.");
      await preflight.prepareSession(scope, request.system, request.signal);
      return factory.probeProfile(request);
    },
    ...(factory.discardProfile === undefined ? {} : { discardProfile: factory.discardProfile.bind(factory) }),
  });
}
