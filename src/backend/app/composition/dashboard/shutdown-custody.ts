import type { Clock } from "../../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../storage/maintenance/custody-availability.js";
import { hasUnprovedSourceClosure } from "../../../storage/source-closure.js";
import type { DashboardHttpListener } from "../../../transports/http/http-server.js";
import { type DashboardHttpServer } from "../../../transports/http/http-server.js";
import type { composeProfileRuntime } from "../storage-compose.js";
import { RuntimeCustodyUncertainError,backupRegisteredPeopleAtCleanShutdown } from "../storage-compose.js";
import type { composeDashboardWiring } from "./dashboard-wiring.js";
import type { DashboardComposeInput } from "./runtime-contracts.js";
import { type DashboardRuntime,type StartupCustody } from "./runtime-contracts.js";
import type { prepareDashboardRuntime } from "./runtime-startup.js";

export function composeDashboardShutdown(input: Pick<Awaited<ReturnType<typeof prepareDashboardRuntime>>, "profile" | "selected" | "requireProducerClosure" | "notificationObserver"> & Pick<Awaited<ReturnType<typeof composeDashboardWiring>>, "timelineTimer" | "hub" | "runLogsHub" | "stopWorkerControl" | "assistantAuthorization" | "shutdownRequested" | "noteWriter"> & { server: DashboardHttpServer; gateParkTimer: ReturnType<typeof setInterval>; custody: StartupCustody }): DashboardRuntime {
  const { profile, selected, requireProducerClosure, notificationObserver, timelineTimer, hub, runLogsHub, stopWorkerControl, assistantAuthorization, shutdownRequested, noteWriter, server, gateParkTimer, custody } = input;
  let detaching: Promise<void> | undefined;
  const detach = (): Promise<void> => {
    detaching ??= (async () => {
      const failures: unknown[] = [];
      try { profile.runtime.beginClose("shutdown"); }
      catch (error) { custody.failedClosures.push(error); failures.push(error); }
      const transportClosure = (async () => {
        try { await server.close(); custody.transportClosed = true; } catch (error) { failures.push(error); }
      })();
      clearInterval(timelineTimer);
      clearInterval(gateParkTimer);
      const notificationClosure = (async () => {
        try { await notificationObserver.stop(); } catch (error) { failures.push(error); }
      })();
      await transportClosure;
      try { hub.close(); } catch (error) { failures.push(error); }
      try { runLogsHub.close(); } catch (error) { failures.push(error); }
      await notificationClosure;
      if (failures.length === 0) {
        try { requireProducerClosure(); await profile.runtime.awaitClosurePreparation(selected); } catch (error) { failures.push(error); }
      }
      try { await stopWorkerControl(); }
      catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
    })();
    return detaching;
  };
  return Object.freeze({
    assistantAuthorization,
    shutdownRequested,
    port: server.port,
    notificationStatus: notificationObserver.status,
    noteWriter,
    detach,
    stop: async (): Promise<void> => {
      const failures: unknown[] = [];
      try { await detach(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      try { await profile.runtime.close("shutdown"); }
      catch (error) { throw new RuntimeCustodyUncertainError([...failures, error]); }
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
  retainedFailures: readonly unknown[];
  beginTransition: () => void;
  readSelectedRuntime: () => DashboardRuntime | undefined;
}): () => Promise<void> {
  const { input, profileRuntime, listener, machine, installation, clock, retainedFailures, beginTransition, readSelectedRuntime } = resources;
  let stopping: Promise<void> | undefined;
  return (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    beginTransition();
    const failures: unknown[] = [];
    try { profileRuntime?.beginClose("shutdown"); } catch (error) { failures.push(error); }
    const transportClosure = listener.close();
    stopping = (async () => {
      try { await transportClosure; } catch (error) { failures.push(error); }
      failures.unshift(...retainedFailures);
      const selectedRuntime = readSelectedRuntime();
      if (selectedRuntime !== undefined) {
        try { await selectedRuntime.detach(); } catch (error) { failures.push(error); }
      }
      try { await profileRuntime?.session.closeOnboarding(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      try { await profileRuntime?.close("shutdown"); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      try { machine.release(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      try { await backupRegisteredPeopleAtCleanShutdown(installation.workspace, input.lifetimeLock, clock); }
      catch (error) {
        if (error instanceof StorageMaintenanceCustodyUnavailableError && error.constructor === StorageMaintenanceCustodyUnavailableError && error.cause === undefined && !hasUnprovedSourceClosure(error)) throw error;
        throw new RuntimeCustodyUncertainError([error]);
      }
    })();
    return stopping;
  };
}
