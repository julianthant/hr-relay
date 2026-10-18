import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { composeQueueSummaries } from "../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { serverLocalDay } from "../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { createItemAttemptHistoryQuery } from "../../../src/backend/runs/queries/item-attempt-history.js";
import { ItemAttemptHistoryRequestSchema } from "../../../src/models/dashboard/item-attempt-history.js";
import { dirname } from "node:path";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { CommandExecutor } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding, DashboardAuthority } from "../../../src/dashboard/app/dashboard-app-model.js";
import { FIXTURE_BOOTSTRAP } from "./dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "./dashboard/fixture-queue.js";
import { z } from "zod";
import { Hono } from "hono";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import type { ProtectedSecretSource } from "../../../src/models/config/secrets.js";
import { defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS, type EnqueuePolicy } from "../../../src/models/workflow/presentation.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { createRunLaunchService } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import type { RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start/run-start.js";
import { projectStartSteps, startStepWireControl } from "../../../src/backend/runs/start/step-selection.js";
import { readRerunValues } from "../../../src/backend/runs/start/rerun-values.js";
import { registerQueueRoutes } from "../../../src/backend/transports/http/routes/queue.js";
import { operatorMutationIngressGuard } from "../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { failureStatus } from "../../../src/backend/transports/http/routes/failure-status.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { sourceBoundHarness } from "./integration/source-bound-fixtures.js";
import { sourceBoundReadContract, sourceBoundReadStores } from "./source-bound-read-fixtures.js";
import { WriteFixturePrepare, WriteFixtureCommit, buildWriteFixtureRegistry, absentProbeEvidence } from "./write-sequencer-fixtures.js";

const Input = z.strictObject({ eid: EidSchema, memo: z.string().optional() });
export function launchDescriptor(enqueue: EnqueuePolicy = "reject-active") {
  return defineWorkflowDescriptor({ id: "launch-proof", version: 1, contractFingerprint: "a".repeat(64), code: "lp",
    label: "Launch proof", icon: "Search", category: "operations", inputSubject: "eid", surface: { shape: "single" },
    canonicalInput: defineCanonicalInput(Input, Input, [{ eid: "10812345" }]), enqueue, actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: { inputRun: { placeholder: "Employee ID", parser: { split: { kind: "delimited", delimiters: [",", "\n"] },
      rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "eid" }] } } }, details: [],
    identity: { matchKey: (input) => input.eid }, presentation: { title: (input) => input.eid }, scenarios: ["launch-proof/happy"],
    timeline: [
      { key: "reading", label: "Read employee", nodes: ["read"] },
      { key: "checking", label: "Check employee", nodes: ["check"], omission: { form: { fields: [{ key: "eid", label: "Checked employee ID", kind: "eid" }] }, produces: {} } },
      { key: "filing", label: "File transaction", nodes: ["submit-write"], omission: { form: { fields: [] }, produces: {} } },
    ],
    rerunValues: [
      { nodeId: "read", fieldPath: "eid", targetFieldPath: "eid", label: "Employee ID" },
      { nodeId: "check", fieldPath: "eid", targetFieldPath: "eid", targetStepKey: "checking", label: "Checked employee ID" },
      { nodeId: "submit-write", fieldPath: "output.value.transactionId", targetFieldPath: "memo", label: "Previous transaction" },
    ],
    flow: flow(Input)
      .step("read", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
      .step("check", sourceBoundReadContract, { dependsOn: ["read"], replay: "checkpoint", bind: ({ input }) => input })
      .transaction("submit-write", { dependsOn: ["read"],
        prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
        commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
        dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000,
      }).build({ schema: sourceBoundReadContract.output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }),
  });
}
export function launchHarness(enqueue: EnqueuePolicy = "reject-active", initializeRuntime?: Parameters<typeof sourceBoundHarness>[2], selection?: Readonly<{ descriptor: AnyWorkflowDescriptor; protectedSecrets: ProtectedSecretSource }>) {
  const h = sourceBoundHarness(selection?.descriptor ?? launchDescriptor(enqueue), (world) => {
    const reads = sourceBoundReadStores(world); const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  }, initializeRuntime, selection?.protectedSecrets);
  const descriptor = h.descriptor;
  if (descriptor.surfaces.inputRun === undefined) throw new Error("launch fixture requires typed input");
  const workflow: RunStartWorkflow = { workflowId: descriptor.id, label: descriptor.label, categoryId: descriptor.category,
    role: { kind: "standalone" }, enqueue: descriptor.enqueue, version: descriptor.version, spreadsheetIntake: false,
    inputRun: { state: "present", surface: descriptor.surfaces.inputRun },
    steps: projectStartSteps(descriptor).map((step) => ({ ...step, control: startStepWireControl(step.control) })) };
  const app: DashboardApp = new Hono();
  app.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
  app.use("/api/v1/start-plans", operatorMutationIngressGuard);
  app.use("/api/v1/rerun-warnings", operatorMutationIngressGuard);
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  const reader = { read: h.lifecycle.read.bind(h.lifecycle), list: h.lifecycle.list.bind(h.lifecycle), withRunTreeSnapshot: h.lifecycle.withRunTreeSnapshot.bind(h.lifecycle),
    summaries: { ...composeQueueSummaries(h.database), activity: () => { throw new Error("unrequested fixture activity"); } } };
  const projection = createOperatorProjection({ database: h.database, reader, stateRoot: dirname(h.authorityPath), clock: h.clock,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(h.database.authority),
    descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined } });
  registerQueueRoutes(app, { queue: { day: day => { projection.rebuildFromTimeline(); return projection.buildDashboardDayWire(day); } }, startPlans: h.planner });
  app.get("/api/v1/runs/:id/rerun-values", (c) => {
    const response = readRerunValues({ reader: h.lifecycle, database: h.database, descriptors: { resolve: () => descriptor } },
      { runId: c.req.param("id"), expectedVersion: Number(c.req.query("expectedVersion")) });
    return c.json(response, response.state === "available" ? 200 : response.code === "target-deleted" ? 410 : response.code === "target-not-found" ? 404 : 409);
  });
  const history = createItemAttemptHistoryQuery({ database: h.database, reader: h.lifecycle });
  app.get("/api/v1/runs/:runId/attempt-history", c => {
    const limit = c.req.query("limit"); const cursor = c.req.query("cursor");
    return c.json(history.read(c.req.param("runId"), ItemAttemptHistoryRequestSchema.parse({
      ...(limit === undefined ? {} : { limit: Number(limit) }), ...(cursor === undefined ? {} : { cursor }),
    })));
  });
  app.post("/api/v1/commands", async (c) => c.json(h.kernel.execute(await c.req.json())));
  const submissions: unknown[] = []; const finalCommands: unknown[] = [];
  let loseResponse = false;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async (url, init) => {
    const request = new Request(url, init);
    request.headers.set("host", "localhost"); request.headers.set("origin", "http://localhost");
    if (new URL(url).pathname === "/api/v1/start-plans") submissions.push(JSON.parse(await request.clone().text()));
    if (new URL(url).pathname === "/api/v1/commands") finalCommands.push(JSON.parse(await request.clone().text()));
    const result = await app.fetch(request);
    if (loseResponse && new URL(url).pathname === "/api/v1/commands") { loseResponse = false; throw new Error("lost response after commit"); }
    return result;
  } });
  const launch = createRunLaunchService(client, "local-operator", { uuid: () => h.ids.uuid(), now: () => h.clock.now().toISOString() });
  const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, serverClock: { ...FIXTURE_BOOTSTRAP.serverClock, now: h.clock.now().toISOString(), zone: "America/Los_Angeles" } });
  const epoch = Object.freeze({ client, bootstrap });
  const day = serverLocalDay(bootstrap.serverClock);
  const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day });
  const request = Object.freeze({ client, day, epoch, revision: 0 });
  const scope = Object.freeze({ actorId: "local-operator", client, authority: epoch, dayRequest: request });
  const executor = new CommandExecutor(() => scope);
  const authority: DashboardAuthority = { epoch, catalog: [], nowIso: bootstrap.serverClock.now, today: day, day,
    dayState: { subscribePublications: () => { throw new Error("fixture publications are not served"); }, request, day: { state: "loaded", value: dayWire }, connection: { state: "connecting" }, refresh: () => undefined },
    selection: { route: { start: false }, workflowId: descriptor.id } };
  const binding: DashboardCommandBinding = { authority, executor, scope, feedback: () => undefined };
  return { ...h, get queueRoots() { return h.queueRoots; }, workflow, app, client, launch, binding, submissions, finalCommands, loseResponse: () => { loseResponse = true; },
    async completeSource() { const run = h.start(h.proposal()); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
      const result = await h.execute(run); if (result.state !== "done") throw new Error(`source did not complete: ${result.state}`); return h.fresh(run); },
    authoritySnapshot() { return JSON.stringify({ generation: h.database.getMeta(), roots: h.queueRoots,
      plans: h.planIds.minted(), ids: h.ids.minted(), lifecycleIds: h.lifecycleIds.minted() }); },
  };
}
