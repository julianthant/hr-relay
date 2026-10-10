import { plan1SeparationWorkflow, plan1SeparationStores, fictionalSeparationDrivers } from "../plan1-separation-operation.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { syntheticStateRoot } from "../../helpers/synthetic-storage-admission.js";
import type { FictionalFormDriver } from "../plan1-browser-operation.js";
import { plan1BrowserStores, plan1BrowserWorkflow, fictionalFormDriver } from "../plan1-browser-operation.js";
import { registerTrustRoutes } from "../../../../src/backend/transports/http/routes/trust.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { projectStartSteps, startStepWireControl } from "../../../../src/backend/runs/start/step-selection.js";
import { Hono } from "hono";
import { composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { DeclaredActionIdentitySchema } from "../../../../src/models/workflow/operation-action-identity.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import type { RunParent } from "../../../../src/models/run/envelope.js";
import { descriptorSetHash } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeExplorer } from "../../../../src/backend/app/composition/dashboard/explorer.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { dataOriginViewsOf, gateNodeViewsOf, writeContractViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { registerExplorerRoutes } from "../../../../src/backend/transports/http/routes/explorer.js";
import { registerRunDetailRoutes } from "../../../../src/backend/transports/http/routes/run-detail.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { startDashboardHttpServer } from "../../../../src/backend/transports/http/http-server.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { FrontendBootstrapWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { DashboardStreamEnvelopeSchema } from "../../../../src/models/dashboard/subscription.js";
import { CONFIG_SNAPSHOT } from "../phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../phase1f-run-fixtures.js";
import { testRunLifecycle, testRunService, testWorkerPorts } from "../run-lifecycle-fixtures.js";
import { openAuthorityHarness, sessionManagerFor, ManualScheduler, recordingLogger, sessionFactoryHarness } from "../../helpers/phase1f-executor-harness.js";
import { plan1Parent, plan1Workflows, Plan1Input, Plan1CanonicalInput } from "../plan1-operation-workflows.js";
import { fixtureBuildManifest } from "../workflow-definition-fixtures.js";
import { PARITY_DIST_DIR } from "../../../integration/dashboard/client/fixtures/helpers/bundle.js";
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { startFixtureServer } from "../../../integration/dashboard/client/fixtures/helpers/fixture-bff.js";

/** Local-only executor fixture; measured Explorer, Logs and source routes are production code. */
export async function startOperationAuthorityServer(mode: "local" | "browser" | "separation" | "separation-failed" | "separation-ambiguous" = "local", native?: Readonly<{ driver: FictionalFormDriver; screenshot(): Promise<Readonly<{ bytes: Uint8Array; width: number; height: number }>> }>) {
  const harness = openAuthorityHarness();
  const { database, clock, stateRoot } = harness;
  const separation = mode.startsWith("separation");
  const workflows = separation ? [plan1SeparationWorkflow] : [...plan1Workflows, plan1BrowserWorkflow];
  const stores = separation ? plan1SeparationStores : plan1BrowserStores;
  const separationDrivers = fictionalSeparationDrivers(mode === "separation-ambiguous");
  const modules = workflows.map((compiled) => composeWorkflowModule(compiled, stores.stores));
  const resolve = (id: string) => modules.find((module) => module.descriptor.id === id)?.descriptor;
  const hash = descriptorSetHash(modules.map((module) => module.descriptor.contractFingerprint));
  const config = { ...CONFIG_SNAPSHOT.config, actor: { ...CONFIG_SNAPSHOT.config.actor, label: "Fixture operator" } };
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
  const configSnapshotId = "00000000-0000-4000-8000-000000000c01";
  database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, configSnapshotId, config, fingerprint });
  const sessions = sessionManagerFor(sessionFactoryHarness({ ucpath: () => separation ? separationDrivers.ucpath : native?.driver ?? fictionalFormDriver(), kuali: () => separationDrivers.kuali }), clock);
  const deps: RunExecutorDependencies = { lifecycle: testRunLifecycle(database, clock), descriptor: plan1Parent.descriptor,
    stores, authority: database, sessions, emitter: createTimelineEmitter({ repository: database.authority.timelineEvents, clock }),
    clock, ids: sequentialIdFactory("b"), scheduler: new ManualScheduler(clock), taskDeadlineMs: 60_000,
    log: recordingLogger().log, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 }) };
  let sequence = 0;
  const createRun = (compiled: typeof plan1Parent, value: unknown, parent?: RunParent, itemId?: string) => {
    const number = ++sequence;
    return buildQueuedRun({ descriptor: compiled.descriptor, appVersion: "0.1.0", runId: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
      itemId: itemId ?? `00000000-0000-4000-8001-${String(number).padStart(12, "0")}`, traceId: `fp-170000-${String(number).padStart(4, "0")}`,
      rawInput: JsonValueSchema.parse(value), canonicalInput: { schemaHash: deriveSchemaHash(Plan1CanonicalInput, "output"), value: Plan1Input.parse(value), protectedBindings: [] }, ingressSchemaHash: deriveSchemaHash(Plan1Input, "input"),
      configFingerprint: fingerprint, configSnapshotId, resolvedInstance: separation ? { kuali: "prod", ucpath: "prod" } : mode === "browser" ? { ucpath: "prod" } : {}, shape: parent === undefined ? "single" : "operation-member", priority: "bulk", dryRun: true,
      attempt: 1, runNumber: number, now: clock.now().toISOString(), ...(parent === undefined ? {} : { parent }) });
  };
  const signal = new AbortController().signal;
  const execute = async (run: ReturnType<typeof createRun>, compiled: typeof plan1Parent) => {
    database.authority.runs.enqueue(run);
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: compiled.descriptor.label }));
    const worker = testWorkerPorts(database, clock, { path: harness.path, descriptor: compiled.descriptor, poolIndex: 1 });
    const slot = database.authority.workerSlots.list(compiled.descriptor.id).find(value => value.retiredAt === null && value.poolIndex === 1);
    if (slot === undefined) throw new Error("operation-fixture-slot-missing");
    const claim = worker.claimNext({ commandId: `00000000-0000-4000-8002-${String(sequence).padStart(12, "0")}`, workflow: compiled.descriptor.id, workerId: slot.workerId });
    if (claim.state !== "applied" || claim.run.envelope.runId !== run.envelope.runId || claim.run.lifecycle.state !== "claimed") throw new Error("operation-fixture-claim-mismatch");
    const outcome = await executeClaimedRun({ ...deps, descriptor: compiled.descriptor, childRuns }, { run: claim.run,
      claim: { workerId: claim.run.lifecycle.workerId, claimGeneration: claim.run.claimGeneration }, signal });
    if (outcome.state === "failed" && mode === "separation-failed" || outcome.state === "parked-gate" && mode === "separation-ambiguous") return undefined;
    if (outcome.state !== "done") throw new Error(`operation-fixture-executor-${outcome.state}: ${database.authority.failures.listByRun(run.envelope.runId).map((failure) => failure.summary).join("; ")}`);
    const result = database.authority.runResults.get(run.envelope.runId);
    if (result === undefined) throw new Error("operation-fixture-result-missing");
    return result;
  };
  const childRuns: NonNullable<RunExecutorDependencies["childRuns"]> = { async executeChildRun(context) {
    const { node } = context;
    if (node.cardinality !== "one" || node.await !== "terminal") throw new Error("operation-fixture-child-shape-mismatch");
    const compiled = plan1Workflows.find((candidate) => candidate.descriptor.id === node.target.id);
    if (compiled === undefined) throw new Error("operation-fixture-child-target-missing");
    const value = node.bind(context.scope);
    const run = createRun(compiled, value, { runId: context.run.envelope.runId, edgeId: node.edgeId, tracePrefix: context.run.envelope.traceId }, node.deriveChildItemId(Plan1Input.parse(value)));
    const result = await execute(run, compiled);
    if (result === undefined) throw new Error("operation-fixture-child-result-missing");
    return { state: "done", runId: run.envelope.runId, itemId: run.envelope.itemId, output: result.result.value };
  } };
  const rootWorkflow = separation ? plan1SeparationWorkflow : mode === "browser" ? plan1BrowserWorkflow : plan1Parent;
  const root = createRun(rootWorkflow, { emplId: "10800000", text: "synthetic", mode: mode === "separation-failed" ? "fail" : mode === "separation-ambiguous" ? "repeat" : "confirmed" });
  await execute(root, rootWorkflow);
  let captures;
  if (native !== undefined) {
    if (mode !== "browser") throw new Error("native-capture-requires-browser-fixture");
    const run = database.authority.runs.get(root.envelope.runId);
    if (run === undefined) throw new Error("native-capture-run-missing");
    const occurrence = readTimelineRecords(database.authority.timelineEvents, 0, run.envelope.runId).records.flatMap(record => record.payload.kind === "note" ? [record.payload.note.action?.operation] : []).find((operation) => operation?.logicalActionId === "search" && operation.state === "confirmed");
    if (occurrence === undefined) throw new Error("native-capture-confirmed-action-not-retained");
    const { value: _value, ...operation } = occurrence;
    const admission = syntheticStateRoot(stateRoot);
    const artifacts = createContentAddressedArtifactWriter({ admission });
    await artifacts.ready;
    const service = createDiagnosticCaptureService({ artifacts, authority: database.authority, clock, ids: sequentialIdFactory("d") });
    const screenshot = await native.screenshot();
    await service.capture({ trigger: "operator-request", requestedBy: "local-operator", runId: run.envelope.runId, operation: DeclaredActionIdentitySchema.parse(operation),
      configFingerprint: fingerprint, descriptorFingerprint: run.envelope.contractFingerprint, fields: [],
      attachments: [{ kind: "screenshot", mediaType: "image/png", sensitivity: "redacted", ...screenshot }] });
    captures = { authority: database.authority.diagnosticBundles, artifactReader: createServerVerifiedArtifactReader({ admission }) };
  }
  const reader = testRunService(database, clock);
  const projection = createOperatorProjection({ database, reader, stateRoot, clock, appVersion: "0.1.0", descriptorSetHash: hash,
    ledger: createTransactionHistory(database.authority), descriptors: { resolve } });
  projection.rebuildFromTimeline();
  const runDetail = createOperatorRunDetail({ database, runReader: reader, stateRoot, projection, ...(separation ? { trust: createReceiptService({ database, runReader: reader, descriptors: modules.map((module) => module.descriptor) }) } : {}), ...(captures === undefined ? {} : { captures: { ...captures, runReader: reader } }), canonical: { database, reader, descriptors: { resolve } } });
  const detailDeps = { ...runDetail, descriptors: { resolve: (id: string) => {
    const module = modules.find((candidate) => candidate.descriptor.id === id);
    return module === undefined ? undefined : { ...module.descriptor, dataOrigins: dataOriginViewsOf(module), gateNodes: gateNodeViewsOf(module.descriptor), writeContracts: writeContractViewsOf(module.descriptor) };
  } } };
  const explorer = composeExplorer({ database, clock, descriptorSetHash: hash });
  const app: DashboardApp = new Hono();
  app.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
  app.use("*", async (c, next) => { c.set("requestActorId", LOCAL_OPERATOR_ACTOR_ID); await next(); });
  registerExplorerRoutes(app, { ...explorer.routes, explorer: { ...explorer.routes.explorer, modules, buildManifest: fixtureBuildManifest(modules.map((module) => module.descriptor.id)) } });
  registerRunDetailRoutes(app, { runDetail: detailDeps });
  registerTrustRoutes(app, { runDetail: detailDeps, ...(captures === undefined ? {} : { diagnosticBundles: { ...captures, runReader: reader } }) });
  const day = clock.now().toISOString().slice(0, 10);
  const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, descriptorHash: hash, projectionGeneration: projection.generation(),
    serverClock: { now: clock.now().toISOString(), zone: "America/Los_Angeles" }, workflows: modules.map(({ descriptor, role }) => ({
      id: descriptor.id, code: descriptor.code, label: descriptor.label, categoryId: descriptor.category, descriptorFingerprint: descriptor.contractFingerprint,
      availability: { state: "available" }, role, start: { enqueue: descriptor.enqueue, version: descriptor.version, steps: projectStartSteps(descriptor).map((step) => ({ key: step.key, label: step.label, includedByDefault: step.includedByDefault, control: startStepWireControl(step.control) })), inputRun: descriptor.surfaces.inputRun, spreadsheetIntake: false } })) });
  const shell = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: { bootstrap, descriptorHash: hash, day: projection.buildDashboardDayWire(day) } });
  app.get("/events/v1", (c) => c.body(new ReadableStream<Uint8Array>({ start(controller) {
    for (const value of [{ type: "hello", wireVersion: 1, descriptorHash: hash, projectionGeneration: projection.generation(), cursor: projection.cursor() },
      { type: "snapshot", topic: "dashboard-day", cursor: projection.cursor(), payload: projection.buildDashboardDayWire(day) }, { type: "health", state: "live" }]) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(DashboardStreamEnvelopeSchema.parse(value))}\n\n`));
    }
  } }), 200, { "content-type": "text/event-stream", "cache-control": "no-cache" }));
  app.get("*", async (c) => { const response = await fetch(new URL(`${c.req.path}${new URL(c.req.url).search}`, shell.baseUrl)); return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers }); });
  const http = await startDashboardHttpServer({ app, port: 0 });
  return { baseUrl: `http://127.0.0.1:${http.port}`, day, runId: root.envelope.runId, database, stateRoot, projection,
    async close() { try { await http.close(); } finally { try { await shell.close(); } finally { harness.dispose(); } } } };
}
