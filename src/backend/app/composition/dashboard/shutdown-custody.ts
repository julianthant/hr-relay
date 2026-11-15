import { ProfileOnboardingBrowserFailureCodeSchema } from "../../../../models/profiles/public-profile.js";
import { ProfileSessionRefusedError } from "../../../profiles/profile-errors.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../storage/maintenance/custody-availability.js";
import { AuthoritySourceClosureUnprovedError,assertSourceClosuresProved,hasUnprovedSourceClosure } from "../../../storage/source-closure.js";
import type { DashboardHttpListener } from "../../../transports/http/http-server.js";
import { type DashboardHttpServer } from "../../../transports/http/http-server.js";
import type { composeProfileRuntime } from "../storage-compose.js";
import { RuntimeCustodyUncertainError,backupRegisteredPeopleAtCleanShutdown } from "../storage-compose.js";
import type { DashboardComposeInput } from "./runtime-contracts.js";
import { type DashboardRuntime,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";
import type { prepareDashboardRuntime } from "./runtime-resources.js";
import type { composeShell } from "./shell.js";

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

export function composeDashboardShutdown(input: Pick<ReturnType<typeof prepareDashboardRuntime>, "profile" | "selected" | "requireProducerClosure" | "notificationObserver" | "loopDelayMonitor"> & { timelineTimer: ReturnType<typeof setInterval>; diagnosticRetentionTimer: ReturnType<typeof setInterval>; hub: ReturnType<typeof composeShell>["hub"]; stopWorkerControl: StartupCleanup; assistantAuthorization: NonNullable<DashboardRuntime["assistantAuthorization"]>; shutdownRequested: Promise<void>; noteWriter: DashboardRuntime["noteWriter"] } & { server: DashboardHttpServer; gateParkTimer: ReturnType<typeof setInterval>; custody: StartupCustody }): DashboardRuntime {
  const { profile, selected, requireProducerClosure, notificationObserver, loopDelayMonitor, timelineTimer, diagnosticRetentionTimer, hub, stopWorkerControl, assistantAuthorization, shutdownRequested, noteWriter, server, gateParkTimer, custody } = input;
  let producerClosure: Promise<void> | undefined, producersClosed = false;
  const closeProducers = (): Promise<void> => {
    producerClosure ??= (async () => {
      const failures: unknown[] = [];
      const transportClosure = (async () => {
        try { await server.close(); custody.transportClosed = true; } catch (error) { failures.push(error); }
      })();
      clearInterval(timelineTimer);
      clearInterval(diagnosticRetentionTimer);
      clearInterval(gateParkTimer);
      try { loopDelayMonitor.stop(); } catch (error) { failures.push(error); }
      const notificationClosure = (async () => {
        try { await notificationObserver.stop(); } catch (error) { failures.push(error); }
      })();
      await transportClosure;
      try { hub.close(); } catch (error) { failures.push(error); }
      await notificationClosure;
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
    const failures: unknown[] = [];
    try { profileRuntime?.beginClose("shutdown"); } catch (error) { failures.push(error); }
    phase("closing transport");
    const transportClosure = listener.close();
    stopping = (async () => {
      try { await transportClosure; } catch (error) { failures.push(error); }
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
        try { await selectedRuntime.detach(); } catch (error) { failures.push(error); }
      }
      try { await profileRuntime?.session.closeOnboarding(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      phase("closing store");
      try { await profileRuntime?.close("shutdown"); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      try { machine.release(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      phase("backing up");
      try { await backupRegisteredPeopleAtCleanShutdown(installation.workspace, input.lifetimeLock, clock); }
      catch (error) {
        if (error instanceof StorageMaintenanceCustodyUnavailableError && error.constructor === StorageMaintenanceCustodyUnavailableError && error.cause === undefined && !hasUnprovedSourceClosure(error)) throw error;
        throw new RuntimeCustodyUncertainError([error]);
      }
      phase("done");
    })();
    return stopping;
  };
}
