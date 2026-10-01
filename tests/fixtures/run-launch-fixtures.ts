import { z } from "zod";
import { Hono } from "hono";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../src/base/workflow.js";
import { defineTaskStoreRegistry } from "../../src/base/store.js";
import { EidSchema } from "../../src/domain/ids.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS, type EnqueuePolicy } from "../../src/domain/workflow/presentation.js";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { createRunLaunchService } from "../../src/dashboard/app/run-launch-model.js";
import type { RunStartWorkflow } from "../../src/dashboard/surfaces/run-start.js";
import { projectStartSteps, startStepWireControl } from "../../src/backend/runs/start/step-selection.js";
import { readRerunValues } from "../../src/backend/runs/start/rerun-values.js";
import { registerQueueRoutes } from "../../src/backend/transports/dashboard/routes/queue.js";
import { operatorMutationIngressGuard } from "../../src/backend/transports/dashboard/routes/operator-mutation-ingress.js";
import { failureStatus } from "../../src/backend/transports/dashboard/routes/failure-status.js";
import type { DashboardApp } from "../../src/backend/transports/dashboard/routes/api-types.js";
import { sourceBoundHarness } from "../integration/fixtures/source-bound-fixtures.js";
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
export function launchHarness(enqueue: EnqueuePolicy = "reject-active") {
  const h = sourceBoundHarness(launchDescriptor(enqueue), (world) => {
    const reads = sourceBoundReadStores(world); const writes = buildWriteFixtureRegistry(world);
    return defineTaskStoreRegistry([...reads.stores, ...writes.stores], {
      scenarioIds: [...reads.corpus.scenarioIds, ...writes.corpus.scenarioIds], tasks: [...reads.corpus.tasks, ...writes.corpus.tasks],
    });
  });
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
  registerQueueRoutes(app, { queue: { day: () => { throw new Error("unrequested queue"); } }, startPlans: h.planner });
  app.get("/api/v1/runs/:id/rerun-values", (c) => {
    const response = readRerunValues({ reader: h.lifecycle, database: h.database, descriptors: { resolve: () => descriptor } },
      { runId: c.req.param("id"), expectedVersion: Number(c.req.query("expectedVersion")) });
    return c.json(response, response.state === "available" ? 200 : response.code === "target-deleted" ? 410 : response.code === "target-not-found" ? 404 : 409);
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
  return { ...h, get queueRoots() { return h.queueRoots; }, workflow, app, client, launch, submissions, finalCommands, loseResponse: () => { loseResponse = true; },
    async completeSource() { const run = h.start(h.proposal()); h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
      const result = await h.execute(run); if (result.state !== "done") throw new Error(`source did not complete: ${result.state}`); return h.fresh(run); },
    authoritySnapshot() { return JSON.stringify({ generation: h.database.getMeta(), roots: h.queueRoots,
      plans: h.planIds.minted(), ids: h.ids.minted(), lifecycleIds: h.lifecycleIds.minted() }); },
  };
}
