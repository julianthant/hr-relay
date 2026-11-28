import { Server } from "node:http";
import { mock } from "node:test";
import { DashboardStreamHub } from "../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { installProcessCrashHandlers } from "../../../src/backend/app/bootstrap/process-crash.js";
import { composeDashboardApplication } from "../../../src/backend/app/composition/dashboard/compose.js";
import { startRebuildRuntime } from "../../../src/backend/app/composition/runtime-composition.js";
import { initializeRegisteredPersonStores, RuntimeCustodyUncertainError } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../src/backend/runtime/browser/profile-browser-closure.js";
import { acquireDashboardEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
import { fixtureWorkerLaunch } from "../helpers/backend/dashboard-child-world.js";

// The dashboard entry as secure bootstrap runs it, on a fixture workspace with OS-assigned ports and fixture pool workers; it owns the real SIGINT/SIGTERM.
const [workspace, barrier, fault] = process.argv.slice(2);
if (workspace === undefined || barrier === undefined) throw new Error("dashboard-signal-child requires <workspace> <barrier>");
if (fault === "stream-close" || fault === "stream-close-unproved" || fault === "transport-close") {
  process.once("SIGINT", () => {
    if (fault !== "transport-close") {
      mock.method(DashboardStreamHub.prototype, "close", async function (this: DashboardStreamHub) {
        mock.restoreAll();
        if (fault === "stream-close") this.close();
        throw new TypeError("private synthetic shutdown detail");
      });
    } else {
      mock.method(Server.prototype, "close", function (this: Server, callback?: (error?: Error) => void) {
        mock.restoreAll();
        return this.close(error => callback?.(error ?? new TypeError("private synthetic shutdown detail")));
      });
    }
  });
}
const lifetime = await RuntimeLifetimeLock.acquire(0);
try {
  await initializeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
  const admission = await acquireDashboardEntrypointAdmission(profileBrowserClosure, workspace, "shared", lifetime);
  installProcessCrashHandlers({ stateRoot: admission.stateRoot, processKind: "dashboard" });
  process.stdout.write(`LIFETIME LOCK ${String(lifetime.port)}\n`);
  const observeStop: NonNullable<NonNullable<Parameters<typeof composeDashboardApplication>[0]["workerProcess"]>["spawn"]> = (request, spawn) => {
    const port = spawn(request);
    return { ...port, send(message, callback) {
      if (message.kind === "worker-stop") process.stdout.write("Sending worker stop\n");
      port.send(message, error => callback(error ?? (fault === "worker-stop" && message.kind === "worker-stop"
        ? new TypeError("private synthetic shutdown detail") : null)));
    } };
  };
  await startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"],
    dashboard: () => composeDashboardApplication({ admission, isolation: rebuildRuntimeIsolation, repoRoot: workspace, lifetimeLock: lifetime,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { launch: fixtureWorkerLaunch(lifetime, barrier), spawn: observeStop } }) }).catch((error: unknown) => {
    if (fault === "stream-close-unproved" && error instanceof RuntimeCustodyUncertainError) {
      admission.assertLive();
      lifetime.assertHeld();
      process.stdout.write("Stream close refused with admission and lifetime held\n");
    }
    throw error;
  });
} finally { await lifetime.close(); }
