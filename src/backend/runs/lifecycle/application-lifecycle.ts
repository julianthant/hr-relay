import { randomUUID } from "node:crypto";
import { ApplicationLifecycleSchema } from "../../../models/dashboard/application-lifecycle.js";
import { runClaim } from "../../../models/run/record.js";
import { ApplicationAdmissionRefusedError } from "../../storage/sqlite/run-store-contracts.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

export interface ApplicationUpdateHost {
  pending(): boolean;
  install(): Promise<void>;
}

export function createApplicationLifecycle(input: Readonly<{
  database: AuthorityDatabase;
  requestQuit(): void;
  updateHost?: ApplicationUpdateHost;
  onFailure(error: unknown): void;
}>) {
  let quitting = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const snapshot = () => input.database.withAuthorityReadSnapshot(() => {
    const facts = input.database.readProfileResourceCustody();
    const active = facts.runs.filter(run => run.lifecycle.state !== "terminal");
    const admission = input.database.authority.runs.admission();
    const blocked = active.some(run => run.lifecycle.state === "parked-write")
      || facts.writeIntents.some(intent => !["committed", "observed-present"].includes(intent.status));
    const busy = active.length > 0 || facts.duoLeases.some(lease => lease.state === "held") || facts.pendingArtifacts.length > 0;
    const runtime = input.database.authority.runtimeConfig.get();
    if (runtime === undefined) throw new ApplicationAdmissionRefusedError("application-runtime-unavailable");
    return ApplicationLifecycleSchema.parse({ runtimeGeneration: runtime.generation,
      state: quitting ? "quitting" : admission.state === "open" ? "ready" : "pausing",
      targets: active.map(run => ({ runId: run.envelope.runId, expectedVersion: run.version,
        ...(run.pause === undefined ? {} : { pause: run.pause }), pauseUnavailable: run.lifecycle.state === "parked-write" || run.cancelRequested === true })),
      update: input.updateHost === undefined ? "installer-unavailable" : busy || blocked ? "deferred" : input.updateHost.pending() ? "pending" : "idle",
    });
  });
  const observeQuit = () => {
    scheduled = undefined;
    try {
      snapshot();
      const ready = input.database.withAuthorityReadSnapshot(() => input.database.readProfileResourceCustody().runs
        .every(run => run.lifecycle.state === "terminal" || run.lifecycle.state === "parked-write" || runClaim(run) === undefined && run.pause?.state === "paused"));
      if (!ready) { scheduled = setTimeout(observeQuit, 50); return; }
      quitting = true;
      input.requestQuit();
    } catch (error) { input.onFailure(error); }
  };
  return Object.freeze({ snapshot,
    quitAccepted() { if (!quitting && scheduled === undefined) scheduled = setTimeout(observeQuit, 0); },
    async installIdleUpdate() {
      if (input.updateHost === undefined) throw new ApplicationAdmissionRefusedError("application-update-installer-unavailable");
      input.database.withAuthorityTransaction(repositories => {
        const current = snapshot();
        if (current.update !== "pending" || repositories.runs.admission().state !== "open") throw new ApplicationAdmissionRefusedError("application-update-work-active");
        repositories.runs.holdAdmission({ commandId: randomUUID(), runtimeGeneration: current.runtimeGeneration, reason: "update" });
      });
      try { await input.updateHost.install(); }
      catch (error) { throw new ApplicationAdmissionRefusedError("application-update-install-failed", { cause: error }); }
    },
    dispose() { if (scheduled !== undefined) clearTimeout(scheduled); scheduled = undefined; },
  });
}
