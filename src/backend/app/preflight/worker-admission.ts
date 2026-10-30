import type { WorkerBrowserSessionFactory } from "../../../workflow-kit/session.js";
import type { RunMutationOutcome } from "../../runs/lifecycle/run-record-service.js";
import type { RunRecord } from "../../../models/run/record.js";
import { PreflightAdmissionRefusal, type PreflightAdmissionScope } from "../../../rules/preflight/preflight-admission.js";
import type { RuntimePreflight } from "./runtime-admission.js";

class PreparationRequired extends Error {
  constructor(readonly scope: PreflightAdmissionScope, readonly run: RunRecord) { super("Selected run needs preflight preparation."); }
}
/** Selection and assertion are atomic. A thrown preparation request rolls back before the claim write. */
export async function claimWithPreflight(input: Readonly<{
  preflight: RuntimePreflight; signal: AbortSignal;
  prepareRun(run: RunRecord, signal: AbortSignal): Promise<void>;
  claim(admit: (run: RunRecord) => void): RunMutationOutcome;
}>): Promise<RunMutationOutcome> {
  let prepared: Readonly<{ runId: string; version: number }> | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (input.signal.aborted) throw input.signal.reason;
    try {
      return input.claim(run => {
        const scope = input.preflight.runScope(run.envelope);
        try { input.preflight.admission.assertReady(scope); }
        catch (error) {
          if (error instanceof PreflightAdmissionRefusal && (error.reason === "unavailable" || error.reason === "stale")) throw new PreparationRequired(scope, run);
          throw error;
        }
        if (prepared?.runId !== run.envelope.runId || prepared.version !== run.version) throw new PreparationRequired(scope, run);
      });
    } catch (error) {
      if (!(error instanceof PreparationRequired)) throw error;
      await input.preflight.admission.prepare(error.scope, input.signal);
      input.preflight.admission.assertReady(error.scope);
      if (prepared?.runId !== error.run.envelope.runId || prepared.version !== error.run.version) {
        await input.prepareRun(error.run, input.signal);
        prepared = { runId: error.run.envelope.runId, version: error.run.version };
      }
    }
  }
  throw new PreflightAdmissionRefusal("stale", "Queued selection changed during preflight; retry the worker command.");
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
