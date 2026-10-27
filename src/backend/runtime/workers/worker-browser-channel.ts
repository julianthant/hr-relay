import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { WorkerControlRefusal, type WorkerControlRecord, type WorkerEffectAcknowledgement } from "../../../models/run/worker-control.js";

/** SQLite is the only cross-process channel. Polling never delivers a second effect. */
export function createWorkerBrowserChannel(input: Readonly<{
  database: AuthorityDatabase; clock: Clock; scheduler: MonotonicDeadlineScheduler;
}>) {
  const check = async (commandId: string): Promise<Extract<WorkerEffectAcknowledgement, { kind: "parked-write-check" }>> => {
    const record = input.database.withAuthorityTransaction(repositories => {
      const current = repositories.workerControls.get(commandId);
      if (current?.request.type !== "check-parked-write") throw new WorkerControlRefusal("parked-check-not-admitted");
      if (current.phase.state !== "admitted") return current;
      if (input.clock.nowMs() >= Date.parse(current.expiresAt)) throw new WorkerControlRefusal("worker-control-expired-before-effect");
      return repositories.workerControls.transition(commandId, "admitted", { state: "ready" });
    });
    const deadline = input.clock.monotonicMs() + Math.max(0, Date.parse(record.expiresAt) - input.clock.nowMs());
    return new Promise((resolve, reject) => {
      const poll = () => {
        try {
          const current: WorkerControlRecord | undefined = input.database.authority.workerControls.get(commandId);
          if (current?.request.type !== "check-parked-write") throw new Error("parked-check-journal-unavailable");
          if (current.phase.state === "succeeded") {
            if (current.phase.acknowledgement.kind !== "parked-write-check") throw new Error("parked-check-result-unavailable");
            resolve(current.phase.acknowledgement); return;
          }
          if (current.phase.state === "refused") throw new WorkerControlRefusal(current.phase.message);
          if (current.phase.state === "uncertain") throw new Error("parked-check-outcome-uncertain");
          if (input.clock.monotonicMs() >= deadline) {
            if (current.phase.state === "executing") {
              input.database.authority.workerControls.transition(commandId, "executing", { state: "uncertain", startedAt: current.phase.startedAt,
                observedAt: input.clock.now().toISOString(), message: "parked-check-outcome-uncertain" });
              throw new Error("parked-check-outcome-uncertain");
            }
            input.database.authority.workerControls.transition(commandId, current.phase.state,
              { state: "refused", completedAt: input.clock.now().toISOString(), message: "worker-control-expired-before-effect" });
            throw new WorkerControlRefusal("worker-control-expired-before-effect");
          }
          input.scheduler.schedule(Math.min(deadline, input.clock.monotonicMs() + 50), poll);
        } catch (error) { reject(error); }
      };
      poll();
    });
  };
  return Object.freeze({
    check,
    async closeForRemoval(commandId: string): Promise<void> {
      const initial = input.database.authority.workerControls.get(commandId);
      if (initial?.lifecycle?.operation.kind !== "remove") throw new Error("worker-removal-command-unavailable");
      const deadline = input.clock.monotonicMs() + Math.max(0, Date.parse(initial.expiresAt) - input.clock.nowMs());
      return new Promise<void>((resolve, reject) => {
        const poll = () => {
          try {
            const current = input.database.authority.workerControls.get(commandId);
            if (current?.lifecycle?.operation.kind !== "remove") throw new Error("worker-removal-authority-unavailable");
            if (current.closure !== undefined) { resolve(); return; }
            if (current.phase.state === "uncertain") throw new Error("worker-removal-closure-uncertain");
            if (input.clock.monotonicMs() >= deadline) throw new Error("worker-removal-closure-unproved");
            input.scheduler.schedule(Math.min(deadline, input.clock.monotonicMs() + 50), poll);
          } catch (error) { reject(error instanceof Error ? error : new Error("worker-removal-channel-failed", { cause: error })); }
        };
        poll();
      });
    },
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
