import { recordDashboardStopFailure } from "../../bootstrap/process-crash.js";
import { DashboardShutdownCompletedWithErrors } from "../runtime-composition.js";
import { ProfileOnboardingBrowserFailureCodeSchema } from "../../../../models/profiles/public-profile.js";
import { ProfileSessionRefusedError } from "../../../profiles/profile-errors.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../storage/maintenance/custody-availability.js";
import { AuthoritySourceClosureUnprovedError,assertSourceClosuresProved,hasUnprovedSourceClosure } from "../../../storage/source-closure.js";
import type { DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import type { DashboardHttpListener } from "../../../transports/http/http-server.js";
import { type DashboardHttpServer } from "../../../transports/http/http-server.js";
import type { composeProfileRuntime } from "../storage-compose.js";
import { RuntimeCustodyUncertainError,backupRegisteredPeopleAtCleanShutdown } from "../storage-compose.js";
import type { DashboardComposeInput, DashboardStopFailure } from "./runtime-contracts.js";
import { type DashboardRuntime,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";

export function retainPublicFailureCustody(error: Error, retainedCustodyFailures: unknown[]): boolean {
  const causes: unknown[] = [error], seen = new Set<unknown>();
  let custodyUnproved = false;
  while (causes.length > 0) {
    const current = causes.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (current instanceof RuntimeCustodyUncertainError || current instanceof AuthoritySourceClosureUnprovedError) { custodyUnproved = true; break; }
    if (current instanceof AggregateError) { const nested: readonly unknown[] = current.errors; causes.push(...nested); }
    if (current instanceof Error && current.cause !== undefined) causes.push(current.cause);
  }
  if (custodyUnproved) retainedCustodyFailures.push(error);
  return custodyUnproved;
}

export function composeDashboardShutdown(input: Pick<ReturnType<typeof prepareDashboardRuntime>, "profile" | "selected" | "requireProducerClosure" | "notificationObserver" | "loopDelayMonitor" | "stopLogWriter"> & Partial<Pick<ReturnType<typeof prepareDashboardRuntime>, "settingsProcesses">> & { stopTimeline: () => Promise<void>; readLanes: Pick<DashboardReadLanes, "close">; diagnosticRetentionTimer: ReturnType<typeof setInterval>; hub: { close: StartupCleanup; readonly subscriptionsClosed: boolean }; stopWorkerControl: StartupCleanup; takeWorkerStopFailures(): readonly unknown[]; shutdownRequested: Promise<void>; noteWriter: DashboardRuntime["noteWriter"] } & { server: DashboardHttpServer; gateParkTimer: ReturnType<typeof setInterval>; historyTimer: ReturnType<typeof setInterval>; custody: StartupCustody }): DashboardRuntime {
  const { profile, selected, requireProducerClosure, notificationObserver, loopDelayMonitor, stopTimeline, readLanes, settingsProcesses, diagnosticRetentionTimer, hub, stopWorkerControl, shutdownRequested, noteWriter, server, gateParkTimer, historyTimer, custody } = input;
  const stepFailures: DashboardStopFailure[] = [];
  let producerClosure: Promise<void> | undefined, producersClosed = false;
  const closeProducers = (): Promise<void> => {
    producerClosure ??= (async () => {
      const failures: unknown[] = [];
      const commandClosure = (async () => {
        try { await settingsProcesses?.closeCommands(); } catch (error) { failures.push(error); }
      })();
      const transportClosure = (async () => {
        try { await server.close(cause => stepFailures.push({ step: "transport-close", cause })); custody.transportClosed = true; } catch (error) { failures.push(error); }
      })();
      const timelineClosure = stopTimeline().catch((error: unknown) => { failures.push(error); });
      clearInterval(diagnosticRetentionTimer);
      clearInterval(gateParkTimer);
      clearInterval(historyTimer);
      try { loopDelayMonitor.stop(); } catch (cause) { stepFailures.push({ step: "loop-monitor-stop", cause }); }
      const notificationClosure = (async () => {
        try { await notificationObserver.stop(); } catch (error) { failures.push(error); }
      })();
      const editorClosure = (async () => {
        try { await settingsProcesses?.close(); } catch (error) { failures.push(error); }
      })();
      await transportClosure;
      try { await hub.close(); }
      catch (cause) {
        stepFailures.push({ step: "stream-close", cause });
        if (!hub.subscriptionsClosed) failures.push(cause);
      }
      await Promise.all([timelineClosure, notificationClosure, editorClosure, commandClosure]);
      // Lanes close after their readers stop and before restore, logout or shutdown closes the store they read.
      try { await readLanes.close(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      producersClosed = true;
    })();
    return producerClosure;
  };
  profile.runtime.registerCommandActivity(profile.token, {
    hasUnquiescedWork: () => producerClosure !== undefined && !producersClosed,
    requestCancellation() { void closeProducers(); },
    awaitCancellation: closeProducers,
  });
  let detaching: Promise<void> | undefined;
  const detach = (): Promise<void> => {
    detaching ??= (async () => {
      const failures: unknown[] = [];
      try { profile.runtime.beginClose("shutdown"); }
      catch (error) { custody.failedClosures.push(error); failures.push(error); }
      try { await closeProducers(); } catch (error) { failures.push(error); }
      if (failures.length === 0) {
        try { requireProducerClosure(); await profile.runtime.awaitClosurePreparation(selected); } catch (error) { failures.push(error); }
      }
      try { await stopWorkerControl(); }
      catch (error) { failures.push(error); }
      for (const cause of input.takeWorkerStopFailures()) stepFailures.push({ step: "worker-stop", cause });
      for (const { cause } of stepFailures) if (cause instanceof Error) retainPublicFailureCustody(cause, failures);
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
    })();
    return detaching;
  };
  return Object.freeze({
    shutdownRequested,
    port: server.port,
    notificationStatus: notificationObserver.status,
    noteWriter,
    async drainForLogout(): Promise<void> {
      await profile.runtime.drainForLogout(profile.token);
      // Logout binds the database image after this drain, so queued debug rows must already be committed.
      await input.stopLogWriter();
    },
    async detach(onStopFailure?: (failure: DashboardStopFailure) => void): Promise<void> {
      try { await detach(); }
      finally { if (onStopFailure) stepFailures.forEach(onStopFailure); }
      if (!onStopFailure && stepFailures.length > 0) throw new RuntimeCustodyUncertainError(stepFailures.map(failure => failure.cause));
    },
    stop: async (): Promise<void> => {
      try { await detach(); await profile.runtime.close("shutdown"); }
      catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      if (stepFailures.length > 0) throw new AggregateError(stepFailures.map(failure => failure.cause), "dashboard producers stopped with errors");
    },
  });
}

export function composeApplicationStop(resources: {
  input: DashboardComposeInput;
  profileRuntime: ReturnType<typeof composeProfileRuntime>;
  listener: DashboardHttpListener;
  machine: RuntimeAdmission;
  installation: NonNullable<ReturnType<RuntimeAdmission["readInstallationContext"]>>;
  clock: Clock;
  retainedCustodyFailures: readonly unknown[];
  beginTransition: () => void;
  readSelectedRuntime: () => DashboardRuntime | undefined;
}): () => Promise<void> {
  const { input, profileRuntime, listener, machine, installation, clock, retainedCustodyFailures, beginTransition, readSelectedRuntime } = resources;
  let stopping: Promise<void> | undefined;
  return (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    beginTransition();
    const phase = (name: "closing transport" | "stopping workers" | "closing store" | "backing up" | "done"): void => {
      process.stdout.write(`${JSON.stringify({ ts: clock.now().toISOString(), level: "info", message: "dashboard shutdown", phase: name })}\n`);
    };
    const failures: unknown[] = [], stepFailures: DashboardStopFailure[] = [];
    phase("closing transport");
    try { profileRuntime?.beginClose("shutdown"); } catch (error) { failures.push(error); }
    stopping = (async () => {
      try { await listener.close(cause => stepFailures.push({ step: "transport-close", cause })); } catch (error) { failures.push(error); }
      for (const error of retainedCustodyFailures) {
        const pending = [error], seen = new Set<unknown>();
        let runtimeFailure = false;
        while (pending.length) {
          const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
          if (value instanceof RuntimeCustodyUncertainError) { runtimeFailure = true; break; }
          if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
          if (value instanceof Error) pending.push(value.cause);
        }
        if (!runtimeFailure && error instanceof ProfileSessionRefusedError && (error.code === "BROWSER_CLOSURE_UNPROVED" || ProfileOnboardingBrowserFailureCodeSchema.safeParse(error.code).success)) {
          try { assertSourceClosuresProved(new Set([error])); }
          catch (unproved) { failures.push(unproved); }
        } else failures.push(error);
      }
      const selectedRuntime = readSelectedRuntime();
      if (selectedRuntime !== undefined) {
        phase("stopping workers");
        try { await selectedRuntime.detach(failure => stepFailures.push(failure)); }
        catch (error) { failures.push(error); }
      }
      try { await profileRuntime?.session.closeOnboarding(); } catch (error) { failures.push(error); }
      for (const { step, cause } of stepFailures) {
        if (cause instanceof Error) retainPublicFailureCustody(cause, failures);
        try { recordDashboardStopFailure(machine.stateRoot, step, cause, clock.now()); }
        catch { process.stderr.write(`${JSON.stringify({ level: "error", message: "shutdown diagnostic unavailable", step })}\n`); }
      }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      phase("closing store");
      try { await profileRuntime?.close("shutdown"); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      try { machine.release(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      phase("backing up");
      try { await (input.shutdownBackup ?? backupRegisteredPeopleAtCleanShutdown)(installation.workspace, input.lifetimeLock, clock); }
      catch (error) {
        if (error instanceof StorageMaintenanceCustodyUnavailableError && error.constructor === StorageMaintenanceCustodyUnavailableError && error.cause === undefined && !hasUnprovedSourceClosure(error)) throw error;
        throw new RuntimeCustodyUncertainError([error]);
      }
      phase("done");
      if (stepFailures.length > 0) throw new DashboardShutdownCompletedWithErrors(stepFailures.map(failure => failure.cause), "dashboard stopped with errors");
    })();
    return stopping;
  };
}
