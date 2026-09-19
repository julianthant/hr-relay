import type { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import type { WorkerSessionManager } from "../../core/worker-sessions.js";
import type { Clock } from "../../domain/clock.js";
import { WorkerControlRefusal } from "../../domain/worker-control.js";

/** Called between whole runs, before the next claim. Busy requests are never held for later. */
export function createWorkerBrowserControl(input: Readonly<{
  database: AuthorityDatabase; workerId: string; leaseGeneration: number; clock: Clock; signal: AbortSignal;
}>) {
  return async (sessions: WorkerSessionManager): Promise<void> => {
    const records = input.database.authority.workerControls.list().filter(record => record.phase.state === "ready"
      && "workerId" in record.request.target && record.request.target.workerId === input.workerId
      && record.request.target.controlBasis?.leaseGeneration === input.leaseGeneration);
    for (const record of records) {
      const { request } = record;
      if (request.type !== "refresh-browser" && request.type !== "reopen-browser") throw new Error("worker-browser-channel-invalid-operation");
      let started = false;
      const now = () => input.clock.now().toISOString();
      try {
        input.database.withAuthorityTransaction(repositories => {
          const current = repositories.workerControls.get(record.commandId);
          if (current?.phase.state !== "ready") throw new WorkerControlRefusal("worker-browser-request-no-longer-ready");
          if (input.clock.nowMs() >= Date.parse(record.expiresAt)) throw new WorkerControlRefusal("worker-control-expired-before-effect");
          const lease = repositories.workerLeases.get(input.workerId);
          const basis = request.target.controlBasis;
          if (lease === undefined || basis === undefined || lease.leaseGeneration !== input.leaseGeneration
            || lease.controlRevision !== basis.controlRevision + 1 || lease.controlCommandId !== record.commandId) throw new WorkerControlRefusal("worker-control-basis-changed-before-effect");
          if (lease.lifecycle.state === "busy" || repositories.runs.listByWorker(input.workerId).some(run => ["claimed", "validating", "running"].includes(run.lifecycle.state))) throw new WorkerControlRefusal("worker-browser-busy");
          if (lease.lifecycle.state !== "idle" && lease.lifecycle.state !== "paused") throw new WorkerControlRefusal("worker-browser-worker-unavailable");
          sessions.assertControlTarget(request.target.browserSessionId);
          repositories.workerControls.transition(record.commandId, "ready", { state: "executing", startedAt: now() });
          started = true;
        });
        const resource = await sessions.controlBrowser(request.type, request.target.browserSessionId, input.signal);
        input.database.withAuthorityTransaction(repositories => {
          const current = repositories.workerControls.get(record.commandId);
          if (current?.phase.state !== "executing") throw new Error("worker-browser-settlement-no-longer-owned");
          repositories.workerControls.transition(record.commandId, "executing", { state: "succeeded", startedAt: current.phase.startedAt,
            completedAt: now(), acknowledgement: { kind: "control", browserSessionId: resource.sessionId } });
        });
      } catch (error) {
        input.database.withAuthorityTransaction(repositories => {
          const current = repositories.workerControls.get(record.commandId);
          if (current === undefined) throw new Error("worker-browser-control-evidence-missing", { cause: error });
          if (current.phase.state !== "ready" && current.phase.state !== "executing") {
            // An expiring waiter can already have retained uncertainty. Never overwrite it with success.
            if (current.phase.state !== "uncertain" && current.phase.state !== "refused") throw error;
            return;
          }
          repositories.workerControls.transition(record.commandId, current.phase.state,
            !started || error instanceof WorkerControlRefusal
              ? { state: "refused", completedAt: now(), message: error instanceof WorkerControlRefusal ? error.message : "worker-browser-refused-before-effect" }
              : { state: "uncertain", startedAt: current.phase.state === "executing" ? current.phase.startedAt : now(), observedAt: now(), message: "worker-browser-effect-failed-or-uncertain" });
        });
      }
    }
  };
}
