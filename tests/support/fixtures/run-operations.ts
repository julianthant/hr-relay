import { Hono } from "hono";
import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { registerQueueRoutes } from "../../../src/backend/transports/http/routes/queue.js";
import { operatorMutationIngressGuard } from "../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { failureStatus } from "../../../src/backend/transports/http/routes/failure-status.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "./intake-kernel-seams.js";
import { populatedProtectedRecord } from "./preflight/runtime-fixture.js";
import type { servedPreflightRuntime } from "./preflight/served-runtime.js";

/** Setup and launch share one real authority, detector set and retained admission report. */
export function installRunOperationsRoutes(app: DashboardApp, setup: Awaited<ReturnType<typeof servedPreflightRuntime>>) {
  const { database, clock, runtime, identity } = setup;
  const ids = sequentialIdFactory("c");
  const lifecycleIds = sequentialIdFactory("b");
  const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
  let publications = 0;
  const lifecycle = new RunRecordService({ database, clock, ids: lifecycleIds,
    publishQueued: () => { publications += 1; },
    admitQueuedRun: run => runtime.admission.assertReady(runtime.runScope(run.envelope)) });
  const plans = createStartPlanService({ authority: database, authorityRead: database, descriptors, clock,
    ids: sequentialIdFactory("a"), planTtlMs: 600_000, ...identity, plannedBy: "local-operator", preflight: runtime.admission });
  const unexpected = (): never => { throw new Error("Unexpected external effect in run operations proof"); };
  const kernel = createCommandKernel({ lifecycle, authority: database, clock, ids, appVersion: "0.1.0", descriptors,
    preflight: runtime.admission, configIdentity: identity,
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { resolvePresent: unexpected, resolveAbsent: unexpected },
    workerRuntime: { pool: { planPoolWorkerCount: unexpected, spawnPoolWorker: unexpected, refreshPoolBrowser: unexpected, reopenPoolBrowser: unexpected, stopPoolWorker: unexpected, pausePoolWorker: unexpected, resumePoolWorker: unexpected } } });
  const queueApp: DashboardApp = new Hono();
  queueApp.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
  registerQueueRoutes(queueApp, { startPlans: plans, queue: { day: unexpected } });
  for (const path of ["/api/v1/start-plans", "/api/v1/rerun-warnings", "/api/v1/commands"]) app.use(path, operatorMutationIngressGuard);
  app.post("/api/v1/start-plans", c => queueApp.fetch(c.req.raw));
  app.post("/api/v1/rerun-warnings", c => queueApp.fetch(c.req.raw));
  const commands: unknown[] = [];
  app.post("/api/v1/commands", async c => {
    const command: unknown = await c.req.json(); commands.push(command);
    return c.json(kernel.execute(command));
  });
  return { setup, plans, kernel, commands,
    runs: () => database.authority.runs.listByWorkflow(personLookupDescriptor.id),
    get publications() { return publications; },
    get mintedRunIdentities() { return lifecycleIds.minted().length; },
    repair() { setup.fixture.setProtected(populatedProtectedRecord()); },
    fault() { setup.fixture.setProtected(populatedProtectedRecord("ucpathPassword")); },
  };
}
