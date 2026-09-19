import type { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import type { Clock } from "../../domain/clock.js";
import type { MonotonicDeadlineScheduler } from "../../core/deadline-scheduler.js";
import { WorkerControlRefusal } from "../../domain/worker-control.js";

/** SQLite is the only cross-process channel. Polling never delivers a second effect. */
export function createWorkerBrowserChannel(input: Readonly<{
  database: AuthorityDatabase; clock: Clock; scheduler: MonotonicDeadlineScheduler;
}>) {
  return Object.freeze({
    async request(commandId: string): Promise<string> {
      const record = input.database.withAuthorityTransaction(repositories => {
        const current = repositories.workerControls.get(commandId);
        if (current === undefined) throw new WorkerControlRefusal("worker-browser-command-not-admitted");
        if (current.request.type !== "refresh-browser" && current.request.type !== "reopen-browser") throw new WorkerControlRefusal("worker-browser-channel-invalid-operation");
        if (current.phase.state === "admitted") {
          if (input.clock.nowMs() >= Date.parse(current.expiresAt)) throw new WorkerControlRefusal("worker-control-expired-before-effect");
          return repositories.workerControls.transition(commandId, "admitted", { state: "ready" });
        }
        return current;
      });
      const deadline = input.clock.monotonicMs() + Math.max(0, Date.parse(record.expiresAt) - input.clock.nowMs());
      return new Promise<string>((resolve, reject) => {
        const poll = (): void => {
          try {
            const current = input.database.authority.workerControls.get(commandId);
            if (current === undefined) throw new Error("worker-browser-control-evidence-missing");
            if (current.phase.state === "succeeded") {
              const ack = current.phase.acknowledgement;
              if (ack.kind !== "control" || ack.browserSessionId === undefined) throw new Error("worker-browser-outcome-session-missing");
              resolve(ack.browserSessionId);
              return;
            }
            if (current.phase.state === "refused") throw new WorkerControlRefusal(current.phase.message);
            if (current.phase.state === "uncertain") throw new Error(current.phase.message);
            if (input.clock.monotonicMs() >= deadline) {
              if (current.phase.state === "executing") {
                input.database.authority.workerControls.transition(commandId, "executing", { state: "uncertain", startedAt: current.phase.startedAt,
                  observedAt: input.clock.now().toISOString(), message: "worker-browser-acknowledgement-uncertain" });
                throw new Error("worker-browser-acknowledgement-uncertain");
              }
              input.database.authority.workerControls.transition(commandId, current.phase.state,
                { state: "refused", completedAt: input.clock.now().toISOString(), message: "worker-control-expired-before-effect" });
              throw new WorkerControlRefusal("worker-control-expired-before-effect");
            }
            input.scheduler.schedule(Math.min(deadline, input.clock.monotonicMs() + 50), poll);
          } catch (error) { reject(error instanceof Error ? error : new Error("worker-browser-channel-failed", { cause: error })); }
        };
        poll();
      });
    },
  });
}
