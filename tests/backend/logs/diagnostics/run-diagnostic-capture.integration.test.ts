import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { withBrowserActionBinding, withBrowserActionSession } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { createDeclaredActionBinder } from "../../../../src/backend/runtime/writes/operation-action-binding.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { NodeIdSchema } from "../../../../src/rules/identity/ids.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { ucpathStore } from "../../../../src/backend/systems/ucpath/task-registry.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { ucpathSession } from "../../../../src/backend/systems/ucpath/session-provider.js";
import { searchPersonOrgTask } from "../../../../src/backend/systems/ucpath/tasks/search-person-org.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS } from "../../../support/helpers/phase1f-executor-harness.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { withBrowserActionNotes } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { z } from "zod";
import { testRunLifecycle,testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import {
createDiagnosticCaptureService,
type DiagnosticCaptureService,
} from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createDiagnosticRetentionSweep } from "../../../../src/backend/logs/diagnostics/diagnostic-retention.js";
import {
createRunBrowserScreenshotCapture,
classifiedFailureFields,
createRunDiagnosticCapture,
operatorRequestedCapture,
} from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { CrmReadOnboardingRecord } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { BrowserSessionIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { DiagnosticArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { HASH_A,HASH_B,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
happySessionHarness,
healthyUcpathDriver,
healthyCrmDriver,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingEmitter,
recordingLogger,
sessionFactoryHarness,
sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** A recording artifact writer: content-addressed by digest, like the real one. */
function recordingArtifacts(): DiagnosticArtifactWriter & { readonly puts: () => readonly string[] } {
  const puts: string[] = [];
  const stored = new Map<string, Uint8Array>();
  let sequence = 0;
  return Object.freeze({
    put: (source: Uint8Array | Readable, metadata: { mediaType: string }) => {
      if (!(source instanceof Uint8Array)) throw new Error("fixture writer takes bytes");
      sequence += 1;
      const sha256 = String(sequence).padStart(64, "0");
      stored.set(sha256, source);
      puts.push(metadata.mediaType);
      return Promise.resolve(ArtifactRefSchema.parse({
        id: `0000000${sequence}-0000-4000-8000-000000000000`,
        sha256,
        bytes: source.byteLength,
        mediaType: metadata.mediaType,
      }));
    },
    stageDiagnostic: (source: Uint8Array, metadata: { mediaType: string }) => {
      sequence += 1;
      const ref = ArtifactRefSchema.parse({ id: `0000000${sequence}-0000-4000-8000-000000000000`,
        sha256: String(sequence).padStart(64, "0"), bytes: source.byteLength, mediaType: metadata.mediaType });
      let published = false;
      return Promise.resolve({ ref, get published() { return published; },
        publish: () => { published = true; stored.set(ref.sha256, source); puts.push(metadata.mediaType); return ref; },
        dispose: () => {},
      });
    },
    open: () => Promise.resolve(Readable.from([new Uint8Array()])),
    puts: () => Object.freeze([...puts]),
  });
}

function openDatabase(now = NOW): AuthorityDatabase {
  const profile = createBoundProfileFixture();
  let database: AuthorityDatabase;
  try {
    database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "diagnostic-capture-test" },
      manualClock(new Date(now)), undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  } catch (error) {
    const failures: unknown[] = [error];
    try { profile.close(); } catch (cleanupError) { failures.push(cleanupError); }
    if (failures.length > 1) throw new AggregateError(failures, "diagnostic fixture opening cleanup failed", { cause: error });
    throw error;
  }
  disposers.push(() => { database.close(); profile.close(); });
  return database;
}

function captureService(database: AuthorityDatabase, now = NOW): {
  readonly service: DiagnosticCaptureService;
  readonly artifacts: ReturnType<typeof recordingArtifacts>;
} {
  const artifacts = recordingArtifacts();
  return {
    artifacts,
    service: createDiagnosticCaptureService({
      artifacts,
      authority: database.authority,
      clock: manualClock(new Date(now)),
      ids: sequentialIdFactory("d"),
    }),
  };
}

describe("diagnostic values at capture", () => {
  it("retains classified originals and names unclassified values", async () => {
    const database = openDatabase();
    const { service } = captureService(database);
    const bundle = await service.prepare({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [
        { key: "screen", classification: "safe-diagnostic", transform: "allow", value: "ucpath.smart-hr.transaction" },
        { key: "employeeName", classification: "sensitive-hr", transform: "digest", value: "Jane Q Public" },
        { key: "ucpathPassword", classification: "secret", transform: "drop", value: "hunter2" },
        // Unclassified: no classification/transform at all.
        { key: "storageState", value: { cookies: ["session=abc"] } },
        "not even an object",
      ],
      attachments: [],
    });

    const serialized = JSON.stringify(bundle);
    assert.ok(serialized.includes("hunter2"));
    assert.ok(serialized.includes("session=abc"));
    assert.ok(serialized.includes("Jane Q Public"));
    assert.equal(bundle.redaction.warnings.length, 2);
    assert.ok(bundle.redaction.fields.every(field => field.transform === "allow" && field.rawValue === undefined));
    assert.deepEqual(
      bundle.redaction.fields.map((field) => [field.key, field.state]),
      [["screen", "allowed"], ["employeeName", "allowed"], ["ucpathPassword", "allowed"]],
    );
  });

  it("retains a value even when its key names a credential source", async () => {
    const database = openDatabase();
    const { service } = captureService(database);
    const bundle = await service.prepare({
        trigger: "operator-request",
        runId: RUN_ID,
        requestedBy: "local-operator",
        configFingerprint: HASH_A,
        descriptorFingerprint: HASH_B,
        fields: [{ key: "storageState", classification: "safe-diagnostic", transform: "allow", value: "{}" }],
        attachments: [],
      });
    assert.equal(bundle.redaction.fields[0]?.state, "allowed");
  });

  it("refuses a non-screenshot attachment that stays restricted", async () => {
    const database = openDatabase();
    const { service } = captureService(database);
    await assert.rejects(
      service.prepare({
        trigger: "operator-request",
        runId: RUN_ID,
        requestedBy: "local-operator",
        configFingerprint: HASH_A,
        descriptorFingerprint: HASH_B,
        fields: [],
        attachments: [{
          kind: "console-summary",
          mediaType: "application/json",
          bytes: new TextEncoder().encode("[]"),
          sensitivity: "restricted",
        }],
      }),
      /must be redacted before capture/,
    );
  });
});

describe("the failure and its bundle land together", () => {
  for (const rollback of [false, true]) it(`settles diagnostic bundle with failure (rollback=${String(rollback)})`, async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;
    const sessions = sessionFactoryHarness({
      ucpath: () => ({ ...healthyUcpathDriver(), searchPersonOrg: () => Promise.reject(new TaskError(CrmReadOnboardingRecord.id, "crm-unavailable", "CRM returned an unexpected page SSN 902481357", { cause: new Error("nested SSN 902-48-1357", { cause: new Error("deep SSN 902 48 1357") }) })) }),
      crm: () => Object.freeze({
        system: "crm" as const,
        verifyOnboardingRecord: () => Promise.reject(new TaskError(
          CrmReadOnboardingRecord.id,
          "crm-unavailable",
          "CRM returned an unexpected page",
        )),
        readOnboardingDates: () => Promise.reject(new Error("unused")),
      }),
    });
    const artifacts = recordingArtifacts();
    const service = createDiagnosticCaptureService({
      artifacts,
      authority: database.authority,
      clock,
      ids: sequentialIdFactory("d"),
    });
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(database, clock),
      descriptor: personLookupDescriptor,
      stores: taskStoreRegistry,
      authority: database,
      sessions: sessionManagerFor(sessions, clock),
      emitter: recordingEmitter().emitter,
      clock,
      ids: sequentialIdFactory("b"),
      scheduler: new ManualScheduler(clock, 0),
      taskDeadlineMs: 60_000,
      log: recordingLogger().log,
      diagnostics: createRunDiagnosticCapture({
        service,
        attachmentsFor: () => Promise.resolve([{
          kind: "accessibility-excerpt" as const,
          mediaType: "text/yaml",
          bytes: new TextEncoder().encode("- heading: Person Org Summary\n"),
          sensitivity: "redacted" as const,
        }]),
      }),
    };

    database.authority.runs.enqueue(personLookupQueuedRun());
    const { workerId, workerLifetime } = testAdmittedWorker(database, clock, { path: authority.path,
      workflow: WORKFLOW_ID, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const claimed = database.authority.runs.claimNext({
      workerLifetime, workflow: WORKFLOW_ID,
      workerId: workerId,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;

    if (rollback) {
      const capture = deps.diagnostics;
      assert.ok(capture);
      const emitter = recordingEmitter();
      let terminalCommandId: string | undefined;
      const lifecycle = deps.lifecycle;
      await assert.rejects(executeClaimedRun({ ...deps, emitter: emitter.emitter,
        lifecycle: { ...lifecycle, terminalize: (input, descriptor, factoryAuthorization) => {
          const parsed = z.object({ commandId: z.string() }).parse(input);
          terminalCommandId = parsed.commandId;
          return lifecycle.terminalize(input, descriptor, factoryAuthorization);
        } },
        diagnostics: { ...capture, persist: (prepared) => {
          capture.persist(prepared);
          assert.ok(database.authority.diagnosticBundles.get(prepared.bundleId));
          throw new Error("after diagnostic persistence");
        } },
      }, { run: claimed.run, claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration },
        signal: new AbortController().signal }), /after diagnostic persistence/);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
      assert.deepEqual(database.authority.diagnosticBundles.listByRun(RUN_ID), []);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.ok(terminalCommandId);
      assert.equal(database.authority.lifecycleJournal.getCommand(terminalCommandId), undefined);
      assert.equal(emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 0);
      return;
    }
    const outcome = await executeClaimedRun(deps, {
      run: claimed.run,
      claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration },
      signal: new AbortController().signal,
    });
    assert.equal(outcome.state, "failed");

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);

    // The forward reference is populated, and it resolves.
    assert.ok(failure.diagnosticBundleId);
    const bundle = database.authority.diagnosticBundles.get(failure.diagnosticBundleId);
    assert.ok(bundle);
    assert.equal(bundle.runId, RUN_ID);
    assert.deepEqual(bundle.origin, { kind: "failure", failureId });
    assert.equal(bundle.retention.kind, "ordinary");
    // The attachment reached the content-addressed store and its index row.
    assert.deepEqual(artifacts.puts(), ["text/yaml"]);
    const indexed = database.authority.diagnosticBundles.listAttachments(bundle.bundleId);
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0]?.attachment.kind, "accessibility-excerpt");
    assert.deepEqual(
      database.authority.diagnosticBundles.findByArtifact(indexed[0]?.attachment.artifactId ?? "").length,
      1,
    );
    assert.ok(JSON.stringify(bundle).includes("UCPath search failed."));
    assert.ok(classifiedFailureFields(failure).length > 0);
    const persisted = JSON.stringify({ failure, bundle });
    for (const value of ["902481357", "902-48-1357", "902 48 1357", "1357"]) assert.equal(persisted.includes(value), false);
    assert.ok(failure.debug?.causes.some(cause => cause.includes("[SSN masked]")));
  });

  it("fails loud when a capture port is injected without an authority transaction", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;
    const { service } = captureService(database);
    const transactionless = {
      authority: database.authority,
      afterAuthorityCommit: database.afterAuthorityCommit.bind(database),
      terminalizeFailure: database.terminalizeFailure.bind(database),
      terminalizeSuccess: database.terminalizeSuccess.bind(database),
    };
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(database, clock),
      descriptor: personLookupDescriptor,
      stores: taskStoreRegistry,
      authority: transactionless,
      sessions: sessionManagerFor(happySessionHarness(), clock),
      emitter: recordingEmitter().emitter,
      clock,
      ids: sequentialIdFactory("b"),
      scheduler: new ManualScheduler(clock, 0),
      taskDeadlineMs: 60_000,
      log: recordingLogger().log,
      diagnostics: createRunDiagnosticCapture({ service }),
    };
    database.authority.runs.enqueue(personLookupQueuedRun({ startAt: "not-a-node" }));
    const { workerId, workerLifetime } = testAdmittedWorker(database, clock, { path: authority.path,
      workflow: WORKFLOW_ID, poolIndex: 1, browserSystems: ["ucpath", "crm"] });
    const claimed = database.authority.runs.claimNext({
      workerLifetime, workflow: WORKFLOW_ID,
      workerId: workerId,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    await assert.rejects(
      executeClaimedRun(deps, {
        run: claimed.run,
        claim: { workerId: workerId, claimGeneration: claimed.run.claimGeneration },
        signal: new AbortController().signal,
      }),
      /no authority transaction to settle its bundle with the failure/,
    );
  });
});

describe("retention and the pin sweep", () => {

  it("purges only the due ordinary bundles and never a pin", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database, clock } = authority;
    // A run and a failure the bundles can reference.
    database.authority.runs.enqueue(personLookupQueuedRun());

    const service = createDiagnosticCaptureService({
      artifacts: recordingArtifacts(),
      authority: database.authority,
      clock,
      ids: sequentialIdFactory("d"),
      retentionDays: 1,
    });
    const ordinary = await operatorRequestedCapture({
      service,
      runId: RUN_ID,
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
    });
    const pinned = await operatorRequestedCapture({
      service,
      runId: RUN_ID,
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      retention: { kind: "pinned", reason: "knowledge" },
    });

    const early = createDiagnosticRetentionSweep({ authority: database.authority, clock, lifecycle: testRunService(database, clock) });
    assert.deepEqual(early.sweep().purged, []);

    const later = new Date(clock.now().getTime() + 2 * 86_400_000);
    const sweep = createDiagnosticRetentionSweep({
      authority: database.authority,
      clock: manualClock(later),
      lifecycle: testRunService(database, manualClock(later)),
    });
    const report = sweep.sweep();
    assert.deepEqual(report.purged, [ordinary.bundleId]);
    assert.equal(database.authority.diagnosticBundles.get(ordinary.bundleId), undefined);
    assert.ok(database.authority.diagnosticBundles.get(pinned.bundleId));

    assert.throws(
      () => database.authority.diagnosticBundles.purge(pinned.bundleId, later.toISOString()),
      /is pinned for knowledge and is never purged by retention/,
    );
  });
});

describe("selected lease screenshot actions", () => {
  it("persists once and records only the real returned screenshot attachment", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);
    const { database } = authority;
    database.authority.runs.enqueue(personLookupQueuedRun());
    const { service } = captureService(database);
    const clock = manualClock(new Date(NOW));
    const actions: unknown[] = [];
    const capture = createRunBrowserScreenshotCapture({ service });
    const screenshotIdentity = { pageVersion: 1, sessionId: BrowserSessionIdSchema.parse("10000000-0000-4000-8000-000000000001"), observedAt: NOW };
    const context = { runId: RUN_ID, configFingerprint: HASH_A, descriptorFingerprint: HASH_B, system: "ucpath", trigger: { kind: "lease-end" as const, outcome: "succeeded" as const }, screenshot: { ...screenshotIdentity, state: "available" as const, bytes: new Uint8Array([137,80,78,71]), width: 1280, height: 720 } };
    await withBrowserActionNotes(clock, () => capture.capture(context), notes => { actions.push(...notes); });
    const bundles = database.authority.diagnosticBundles.listByRun(RUN_ID);
    assert.equal(bundles.length, 1);
    const attachment = bundles[0]?.attachments.find(value => value.kind === "screenshot"); assert.ok(attachment);
    assert.ok(JSON.stringify(actions).includes(`${bundles[0]?.bundleId}:${attachment.artifactId}`));
    const unavailableActions: unknown[] = [];
    await withBrowserActionNotes(clock, () => capture.capture({ ...context, screenshot: { ...screenshotIdentity, state: "unavailable", reason: "verification-failed" } }), notes => { unavailableActions.push(...notes); });
    assert.deepEqual(unavailableActions, []);
    const missing = createRunBrowserScreenshotCapture({ service: { ...service, capture: async input => ({ ...await service.capture(input), attachments: [] }) } });
    await assert.rejects(missing.capture(context), /without its screenshot artifact/);
  });
});

describe("task screenshot persistence before checkpoint", () => {
  for (const failure of ["none", "note", "unavailable", "capture", "persist", "undeclared"] as const) it(`preserves task results and screenshot action persistence rules (${failure})`, async () => {
    const world = createRunExecutorTestWorld();
    try {
      const captureTask = defineTask(ucpathDriver, SearchPersonOrg, {
        sessions: searchPersonOrgTask.impl.sessions, ...(failure === "undeclared" ? {} : { screenshots: "task" as const }),
        async run(args) {
          const output = await searchPersonOrgTask.impl.run({ ...args, ctx: { ...args.ctx, captureScreenshot: async () => {} } });
          await args.ctx.captureScreenshot();
          return output;
        },
      });
      const stores = defineTaskStoreRegistry([...taskStoreRegistry.stores.filter(store => store.namespace !== "ucpath"), defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { ...ucpathStore.tasks, searchPersonOrg: captureTask })], taskStoreRegistry.corpus);
      const harness = world.executorHarness({ stores });
      const { database, clock } = harness.authority;
      const queued = RunRecordSchema.parse(personLookupQueuedRun());
      const claimed = world.enqueueAndClaim(database, { ...queued, envelope: { ...queued.envelope, captureBrowserScreenshots: true } }, clock.now().toISOString());
      const { service } = captureService(database);
      const capture = createRunBrowserScreenshotCapture({ service });
      const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(claimed.claim.workerId), workflowId: WorkflowIdSchema.parse("person-lookup"), stores,
        factory: { open: async input => {
          const resource = await harness.sessions.factory.open(input);
          return { ...resource, screenshot: async () => {
            if (failure === "capture" && resource.system === "ucpath") throw Object.assign(new Error("private fixture content"), { name: "private fixture name" });
            if (failure === "unavailable" && resource.system === "ucpath") return { state: "unavailable" as const, reason: "secret-controls-present" as const, sessionId: resource.sessionId, pageVersion: 1, observedAt: clock.now().toISOString() };
            return { state: "available" as const, sessionId: resource.sessionId, pageVersion: 1, observedAt: clock.now().toISOString(), bytes: new Uint8Array([137,80,78,71]), width: 1280, height: 720 };
          } };
        } }, clock, scheduler: new ManualScheduler(clock), acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
        duoCeremony: fixtureDuoCeremonyGates(clock), browserScreenshotCapture: failure === "persist" ? { capture: async context => { if (context.system === "ucpath") throw new TypeError("private persistence content"); await capture.capture(context); } } : capture,
      });
      sessions.bindRunConfigFingerprint(FingerprintSchema.parse(claimed.run.envelope.configFingerprint), "headless", { runId: claimed.run.envelope.runId,
        descriptorFingerprint: claimed.run.envelope.contractFingerprint, captureBrowserScreenshots: true });
      const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
      const result = await executeClaimedRun({ ...harness.deps, sessions, taskNotes: { ...notes, emitRunAction: (input, authority) => {
        if (failure === "note" && input.action.kind === "screenshot") throw new Error("note append failure");
        return notes.emitRunAction(input, authority);
      } } }, { ...claimed, signal: new AbortController().signal });
      if (failure === "none") {
        assert.equal(result.state, "done", JSON.stringify(database.authority.failures.listByRun(claimed.run.envelope.runId)));
        assert.ok(database.authority.timelineEvents.page({ runId: claimed.run.envelope.runId }).some(row => row.payload.kind === "note" && row.payload.note.action?.kind === "screenshot"));
      } else if (failure === "unavailable" || failure === "capture" || failure === "persist") {
        assert.equal(result.state, "done");
        const settledRun = database.authority.runs.get(claimed.run.envelope.runId);
        assert.ok(settledRun);
        const lifecycle = settledRun.lifecycle;
        assert.ok(lifecycle?.state === "terminal" && lifecycle.outcome === "done");
        assert.deepEqual(database.authority.failures.listByRun(claimed.run.envelope.runId), []);
        assert.ok(database.authority.runCheckpoints.latest(claimed.run.envelope.workflow, claimed.run.envelope.itemId, "searching"));
        const notes = database.authority.timelineEvents.page({ runId: claimed.run.envelope.runId })
          .flatMap(row => row.payload.kind === "note" ? [row.payload.note] : []);
        assert.equal(notes.filter(note => note.spanPath === taskSpanPath(claimed.run.envelope.traceId, NodeIdSchema.parse("searching"), 1, claimed.claim.claimGeneration) && note.action?.kind === "screenshot").length, 0);
        const warnings = notes.filter(note => note.level === "warn");
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0]?.message, "Screenshot capture failed.");
        assert.deepEqual(warnings[0]?.fields?.map(field => ({ key: field.key, value: field.value })), [{ key: "reason", value: failure === "unavailable" ? "secret-controls-present" : failure === "persist" ? "TypeError" : "Error" }]);
        assert.doesNotMatch(JSON.stringify(warnings), /private/);
        const section = buildRunLogsSection({ timeline: database.authority.timelineEvents, projection: { runLogSnapshot: () => ({ entries: [] }) }, descriptors: { resolve: () => undefined } } as unknown as RunDetailQueryDeps,
          claimed.run.envelope.runId, undefined, settledRun);
        assert.ok(section.section === "logs");
        const warningRows = section.payload.rows?.filter(row => row.kind === "note" && row.note.level === "warning");
        assert.equal(warningRows?.length, 1);
        assert.match(JSON.stringify(warningRows), failure === "unavailable" ? /secret-controls-present/ : failure === "persist" ? /TypeError/ : /Error/);
        assert.doesNotMatch(JSON.stringify(warningRows), /private/);
      } else {
        assert.equal(result.state, "failed");
        const failures = database.authority.failures.listByRun(claimed.run.envelope.runId);
        assert.equal(failures[0]?.code, "BROWSER_SCREENSHOT_CAPTURE_FAILED");
        assert.equal(database.authority.runCheckpoints.latest(claimed.run.envelope.workflow, claimed.run.envelope.itemId, "searching"), undefined);
        if (failure === "note") assert.ok(database.authority.diagnosticBundles.listByRun(claimed.run.envelope.runId).length > 0, "image persisted before note failure");
      }
    } finally { await world.cleanup(); }
  });
});

it("persists a task screenshot through a complete frozen binder into Logs without operation proof", async () => {
  const world = createRunExecutorTestWorld();
  try {
    const harness = world.executorHarness({ descriptor: world.actionBindingCompiled.descriptor });
    const { database, clock } = harness.authority;
    const claimed = world.enqueueAndClaim(database, world.actionBindingQueuedRun(clock.now().toISOString()), clock.now().toISOString(), world.ACTION_BINDING_WORKFLOW_ID);
    const snapshot = claimed.run.envelope.operationDisplaySnapshot;
    assert.ok(snapshot);
    const binder = createDeclaredActionBinder({ snapshot, runId: claimed.run.envelope.runId, attempt: claimed.run.envelope.attempt,
      claimGeneration: claimed.claim.claimGeneration, taskAttempt: 1, nodeId: "search", taskId: SearchPersonOrg.id, contractRole: "task",
      parsedInput: { kind: "by-eid", emplId: "10873698" }, protectedBindings: [] });
    const { service } = captureService(database);
    const capture = createRunBrowserScreenshotCapture({ service });
    const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const sessionId = BrowserSessionIdSchema.parse("00000000-0000-4000-8000-000000000003");
    const address = { runId: claimed.run.envelope.runId, attempt: claimed.run.envelope.attempt, traceId: claimed.run.envelope.traceId,
      spanPath: taskSpanPath(claimed.run.envelope.traceId, NodeIdSchema.parse("search"), 1, claimed.claim.claimGeneration) };
    await withBrowserActionNotes(clock, () => withBrowserActionSession(sessionId, () => withBrowserActionBinding(binder, () => capture.capture({
      runId: claimed.run.envelope.runId, configFingerprint: claimed.run.envelope.configFingerprint, descriptorFingerprint: claimed.run.envelope.contractFingerprint,
      system: "ucpath", trigger: { kind: "task-point", nodeId: "search", attempt: claimed.run.envelope.attempt },
      screenshot: { state: "available", sessionId, pageVersion: 1, observedAt: clock.now().toISOString(), bytes: new Uint8Array([137,80,78,71]), width: 1280, height: 720 },
    }))), actions => { for (const action of actions) notes.emitRunAction({ workflow: claimed.run.envelope.workflow, address, action }, claimed.run); });
    const stored = database.authority.timelineEvents.page({ runId: claimed.run.envelope.runId }).filter(row => row.payload.kind === "note");
    assert.equal(stored.length, 1);
    assert.ok(stored[0].payload.kind === "note");
    assert.equal(stored[0].payload.note.action?.operation, undefined);
    const section = buildRunLogsSection({ timeline: database.authority.timelineEvents, projection: { runLogSnapshot: () => ({ entries: [] }) }, descriptors: { resolve: () => undefined } } as unknown as RunDetailQueryDeps,
      claimed.run.envelope.runId, undefined, claimed.run);
    assert.ok(section.section === "logs");
    const row = section.payload.rows?.[0];
    assert.ok(row?.kind === "note");
    assert.equal(row.native?.nodeId, "search");
    assert.equal(row.note.screenshot?.sessionId, sessionId);
    assert.equal(row.note.screenshot?.bundleId, database.authority.diagnosticBundles.listByRun(claimed.run.envelope.runId)[0]?.bundleId);
  } finally { await world.cleanup(); }
});

describe("Person Lookup final capture points", () => {
  for (const kind of ["selected", "empty", "ambiguous"] as const) for (const enabled of [true, false]) {
    it(`captures exactly the final CRM ${kind} page (enabled=${enabled})`, async () => {
      const world = createRunExecutorTestWorld();
      let sessions: WorkerSessionManager | undefined;
      try {
        const pages = new Map<string, string>();
        const baseCrm = healthyCrmDriver();
        const records = await baseCrm.searchOnboardingRecords({ eid: "10873698" });
        const expected = kind === "empty" ? [] : kind === "ambiguous" ? [records[0], { ...records[0], recordId: "ONB-2", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-2" }] : records;
        const factory = sessionFactoryHarness({
          ucpath: () => ({ ...healthyUcpathDriver(), searchPersonOrg: async (input: z.output<typeof SearchPersonOrg.input>) => { pages.set("ucpath", "ucpath-detail"); return healthyUcpathDriver().searchPersonOrg(input); } }),
          crm: () => ({ ...baseCrm,
            searchOnboardingRecords: async () => { pages.set("crm", "crm-results"); return expected; },
            verifyOnboardingRecord: async (record: Parameters<typeof baseCrm.verifyOnboardingRecord>[0]) => { pages.set("crm", "crm-record"); return record; },
          }),
        });
        const harness = world.executorHarness({ sessions: factory });
        const { database, clock } = harness.authority;
        const queued = RunRecordSchema.parse(personLookupQueuedRun());
        const claimed = world.enqueueAndClaim(database, { ...queued, envelope: { ...queued.envelope, captureBrowserScreenshots: enabled } }, clock.now().toISOString());
        const { service } = captureService(database);
        const capture = createRunBrowserScreenshotCapture({ service });
        const acquired: string[] = [];
        const persisted: string[] = [];
        sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(claimed.claim.workerId), workflowId: WorkflowIdSchema.parse("person-lookup"), stores: taskStoreRegistry,
          factory: { open: async input => {
            const resource = await factory.factory.open(input);
            return { ...resource, screenshot: async () => {
              acquired.push(pages.get(input.system) ?? "unexpected-page");
              return { state: "available" as const, sessionId: resource.sessionId, pageVersion: 1, observedAt: clock.now().toISOString(), bytes: new Uint8Array([137,80,78,71]), width: 1280, height: 720 };
            } };
          } }, clock, scheduler: new ManualScheduler(clock), acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS, duoCeremony: fixtureDuoCeremonyGates(clock),
          browserScreenshotCapture: { capture: async context => { await capture.capture(context); persisted.push(pages.get(context.system) ?? "unexpected-page"); } },
        });
        sessions.bindRunConfigFingerprint(FingerprintSchema.parse(claimed.run.envelope.configFingerprint), "headless", { runId: claimed.run.envelope.runId,
          descriptorFingerprint: claimed.run.envelope.contractFingerprint, captureBrowserScreenshots: enabled });
        const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
        const result = await executeClaimedRun({ ...harness.deps, sessions, taskNotes: notes }, { ...claimed, signal: new AbortController().signal });
        assert.equal(result.state, "done", JSON.stringify(database.authority.failures.listByRun(claimed.run.envelope.runId)));
        const points = enabled ? ["ucpath-detail", kind === "selected" ? "crm-record" : "crm-results"] : [];
        assert.deepEqual(acquired, points);
        assert.deepEqual(persisted, points);
        const screenshotNotes = database.authority.timelineEvents.page({ runId: claimed.run.envelope.runId }).flatMap(row => row.payload.kind === "note" && row.payload.note.action?.kind === "screenshot" ? [row.payload.note] : []);
        assert.equal(screenshotNotes.length, points.length);
        assert.equal(database.authority.diagnosticBundles.listByRun(claimed.run.envelope.runId).length, points.length);
        assert.equal(database.authority.runCheckpoints.latest(claimed.run.envelope.workflow, claimed.run.envelope.itemId, "crm-results") !== undefined, kind !== "selected");
      } finally { await sessions?.closeAll("worker-stop"); await world.cleanup(); }
    });
  }
});
