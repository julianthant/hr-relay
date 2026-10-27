import { workerPoolMember } from "../../../models/run/worker-slot.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { RunRecordService } from "../../runs/lifecycle/run-record-service.js";
import { randomUUID } from "node:crypto";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { WorkerResetBinding } from "../../../models/run/worker-control.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { WorkerSessionManager } from "./worker-sessions.js";
import type { Clock } from "../../../rules/time/clock.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import type { WorkerEffectAcknowledgement } from "../../../models/run/worker-control.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";

/** Called between whole runs, before the next claim. Busy requests are never held for later. */
export function createWorkerBrowserControl(input: Readonly<{
  database: AuthorityDatabase; workerId: string; leaseGeneration: number; clock: Clock; signal: AbortSignal;
  checkParkedWrite?: (sessions: WorkerSessionManager, request: Extract<CommandRequest, { type: "check-parked-write" }>, expiresAt: string) => Promise<Extract<WorkerEffectAcknowledgement, { kind: "parked-write-check" }>>;
}>) {
  const removalAttempts = new Set<string>();
  return async (sessions: WorkerSessionManager): Promise<void> => {
    const removal = input.database.authority.workerControls.lifecycleForWorker(input.workerId);
    if (removal?.lifecycle?.operation.kind === "remove" && removal.closure === undefined && !removalAttempts.has(removal.commandId)) {
      removalAttempts.add(removal.commandId);
      try {
        const proof = await sessions.closeForRetirement(removal.lifecycle);
        input.database.observeWorkerRetirementClosure(removal.commandId, proof, input.clock.now().toISOString());
      } catch (error) {
        const current = input.database.authority.workerControls.get(removal.commandId);
        if (current?.phase.state === "executing") input.database.authority.workerControls.transition(current.commandId, "executing", { state: "uncertain", startedAt: current.phase.startedAt,
          observedAt: input.clock.now().toISOString(), message: "worker-removal-closure-unproved" });
        throw error;
      }
    }
    const records = input.database.authority.workerControls.list().filter(record => record.phase.state === "ready"
      && "workerId" in record.request.target && record.request.target.workerId === input.workerId
      && record.request.target.controlBasis?.leaseGeneration === input.leaseGeneration);
    for (const record of records) {
      const { request } = record;
      if (request.type !== "refresh-browser" && request.type !== "reopen-browser" && request.type !== "check-parked-write") throw new Error("worker-browser-channel-invalid-operation");
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
          if (request.type === "check-parked-write") {
            const slot = repositories.workerSlots.get(input.workerId);
            if (input.checkParkedWrite === undefined || lease.lifecycle.state !== "idle" || record.control === undefined
              || slot?.membershipRevision !== request.target.membershipRevision || slot.retiredAt !== null || slot.workflow !== request.target.workflowId
              || lease.processId !== request.target.processId || lease.lifecycle.startedAt !== request.target.startedAt
              || record.control.member.membershipRevision !== request.target.membershipRevision
              || record.control.lifetime.processId !== lease.processId || record.control.lifetime.startedAt !== lease.lifecycle.startedAt) {
              throw new WorkerControlRefusal("parked-check-worker-unavailable");
            }
          } else sessions.assertControlTarget(request.target.browserSessionId);
          repositories.workerControls.transition(record.commandId, "ready", { state: "executing", startedAt: now() });
          started = true;
        });
        let acknowledgement: WorkerEffectAcknowledgement;
        if (request.type === "check-parked-write") {
          const check = input.checkParkedWrite;
          if (check === undefined) throw new WorkerControlRefusal("PARKED_CHECK_UNAVAILABLE");
          acknowledgement = await check(sessions, request, record.expiresAt);
        } else acknowledgement = { kind: "control", browserSessionId: (await sessions.controlBrowser(request.type, request.target.browserSessionId, input.signal)).sessionId };
        input.database.withAuthorityTransaction(repositories => {
          const current = repositories.workerControls.get(record.commandId);
          if (current?.phase.state !== "executing") throw new Error("worker-browser-settlement-no-longer-owned");
          if (request.type === "check-parked-write") {
            const lease = repositories.workerLeases.get(input.workerId), slot = repositories.workerSlots.get(input.workerId);
            if (input.signal.aborted || input.clock.nowMs() >= Date.parse(record.expiresAt)
              || lease?.lifecycle.state !== "idle" || lease.workflow !== request.target.workflowId
              || lease.leaseGeneration !== request.target.controlBasis.leaseGeneration
              || lease.controlRevision !== request.target.controlBasis.controlRevision + 1 || lease.controlCommandId !== record.commandId
              || slot?.retiredAt !== null || slot.membershipRevision !== request.target.membershipRevision || slot.workflow !== request.target.workflowId
              || lease.processId !== request.target.processId || lease.lifecycle.startedAt !== request.target.startedAt
              || repositories.runs.listByWorker(input.workerId).some(run => ["claimed", "validating", "running"].includes(run.lifecycle.state))) {
              throw new Error("parked-check-worker-authority-changed-after-read");
            }
          }
          repositories.workerControls.transition(record.commandId, "executing", { state: "succeeded", startedAt: current.phase.startedAt,
            completedAt: now(), acknowledgement });
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
        if (request.type === "check-parked-write" && started && !(error instanceof WorkerControlRefusal)) throw error;
      }
    }
  };
}

export function createWorkerResetObserver(input: Readonly<{ database: AuthorityDatabase; workerId: string; leaseGeneration: number; clock: Clock; scheduler: MonotonicDeadlineScheduler; onFailure: (error: unknown) => void }>) {
  let scheduled: Readonly<{ commandId: string; cancel: () => void }> | undefined;
  let failure: Error | undefined;
  let stopped = false;
  const stop = () => { stopped = true; scheduled?.cancel(); scheduled = undefined; };
  const observe = (): WorkerResetBinding | undefined => {
    if (failure !== undefined) throw failure;
    if (stopped) throw new Error("worker-reset-observer-stopped");
    const reset = observeWorkerReset(input);
    if (scheduled?.commandId !== reset?.commandId) { scheduled?.cancel(); scheduled = undefined; }
    if (reset !== undefined && scheduled === undefined) {
      const record = input.database.authority.workerControls.get(reset.commandId);
      if (record === undefined) throw new Error("worker-reset-observer-authority-unavailable");
      const handle = input.scheduler.schedule(input.clock.monotonicMs() + Math.max(0, Date.parse(record.expiresAt) - input.clock.nowMs()), () => {
        try { observeWorkerReset(input); }
        catch (error) { failure = error instanceof Error ? error : new Error("worker-reset-observer-failed", { cause: error }); input.onFailure(failure); }
      });
      scheduled = { commandId: reset.commandId, cancel: () => { handle.cancel(); } };
    }
    return reset;
  };
  return Object.assign(observe, { stop, failure: () => failure });
}

function observeWorkerReset(input: Readonly<{ database: AuthorityDatabase; workerId: string; leaseGeneration: number; clock: Clock }>): WorkerResetBinding | undefined {
  return input.database.withAuthorityTransaction(repositories => {
    const current = repositories.workerControls.resetForWorker(input.workerId, input.leaseGeneration);
    if (current === undefined) return undefined;
    const reset = current.reset;
    const slot = repositories.workerSlots.get(input.workerId);
    const lease = repositories.workerLeases.get(input.workerId);
    if (reset === undefined || slot === undefined || slot.retiredAt !== null || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(reset.member)
      || lease?.controlRevision !== reset.reservedControlRevision || lease.controlCommandId !== current.commandId
      || lease.processId !== reset.lifetime.processId || lease.lifecycle.startedAt !== reset.lifetime.startedAt) throw new Error("worker-reset-observer-authority-unavailable");
    const now = input.clock.now().toISOString();
    let observed = current;
    if (observed.phase.state === "admitted") observed = repositories.workerControls.transition(observed.commandId, "admitted", { state: "executing", startedAt: now });
    if (observed.phase.state === "executing" && input.clock.nowMs() >= Date.parse(observed.expiresAt)) repositories.workerControls.transition(observed.commandId, "executing", {
      state: "uncertain", startedAt: observed.phase.startedAt, observedAt: now, message: "worker-reset-owner-release-pending" });
    return reset;
  });
}

export function createWorkerResetControl(input: Readonly<{ database: AuthorityDatabase; workerId: string; leaseGeneration: number; clock: Clock; lifecycle: RunRecordService }>) {
  return async (sessions: WorkerSessionManager, reset: WorkerResetBinding): Promise<void> => {
    const now = () => input.clock.now().toISOString();
    const observed = observeWorkerReset(input);
    if (observed === undefined || canonicalJsonStringify(observed) !== canonicalJsonStringify(reset)) throw new Error("worker-reset-owner-conflict");
    try {
      input.lifecycle.settleResetWork(reset);
      const proof = await sessions.closeForReset(reset);
      input.database.settleWorkerReset(reset.commandId, proof, now(), randomUUID());
    } catch (error) {
      input.database.withAuthorityTransaction(repositories => {
        const current = repositories.workerControls.get(reset.commandId);
        if (current?.phase.state === "executing") repositories.workerControls.transition(reset.commandId, "executing", {
          state: "uncertain", startedAt: current.phase.startedAt, observedAt: now(), message: "worker-reset-closure-or-settlement-unproved" });
      });
      throw error;
    }
  };
}
