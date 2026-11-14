import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { it } from "vitest";
import { composeWorkerArtifactProjector } from "../../../../../src/backend/app/composition/worker/artifact-output.js";
import { prepareApplicationDataWorkspace } from "../../../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import type { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { ArtifactOutboxStorageRecordSchema } from "../../../../../src/models/artifacts/generated-artifact.js";
import { executeClaimedRun } from "../../../../../src/backend/runtime/execution/run-executor.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { TraceIdSchema } from "../../../../../src/rules/identity/ids.js";
import { collectionArtifactOutput, namedArtifactOutput } from "../../../../../src/workflow-kit/artifacts.js";
import { defineTaskStoreRegistry, defineWorkflowStore } from "../../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../../src/workflow-kit/task.js";
import { namedFileOutputContract as contract,namedFileOutputDescriptor as descriptor,namedFileOutputScenario as scenario } from "../../../../support/fixtures/named-file-output-workflow.js";
import { testRunLifecycle, testWorkerPorts } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { foundationFixture } from "../../../../support/helpers/database-foundation/fixtures.js";
import { createRunRecordServiceTestWorld } from "../../../../support/helpers/backend/run-record-service-world.js";
import { happySessionHarness, ManualScheduler, recordingEmitter, recordingLogger, sessionManagerFor } from "../../../../support/helpers/phase1f-executor-harness.js";

it.each(["single", "collection"] as const)("publishes a task's %s output through its checkpoint, outbox, worker sink and retained documents path", async kind => {
  const f = await foundationFixture(), fileName = `Onboarding Docs ${randomUUID()}.zip`;
  const zip = new JSZip(); zip.file("Worksheet A/Synthetic One/document.pdf", "synthetic one"); zip.file("Worksheet B/Synthetic Two/document.pdf", "synthetic two");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const task = defineTask(contract, { sessions: [], async run({ ctx }) {
    const archive = kind === "single" ? namedArtifactOutput(await ctx.artifacts.put(bytes, { mediaType: "application/zip" }), fileName)
      : await collectionArtifactOutput(ctx.artifacts, await Promise.all([
        { relativePath: "July 6/July 6.zip", person: "Synthetic One", document: "synthetic one" },
        { relativePath: "August 2/August 2.zip", person: "Synthetic Two", document: "synthetic two" },
      ].map(async file => {
        const worksheet = new JSZip(); worksheet.file(`${file.person}/document.pdf`, file.document);
        return { relativePath: file.relativePath, artifact: await ctx.artifacts.put(await worksheet.generateAsync({ type: "nodebuffer" }), { mediaType: "application/zip" }) };
      })));
    for (const [field, value] of Object.entries(archive.artifact)) ctx.recordData({ direction: "read", field: `archive.artifact.${field}`, value });
    if ("fileName" in archive) ctx.recordData({ direction: "read", field: "archive.fileName", value: archive.fileName });
    else ctx.recordData({ direction: "read", field: "archive.files", value: archive.files });
    return { archive };
  } });
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const artifactProjector = composeWorkerArtifactProjector({ admission: f.profile.admission, database: f.db, artifacts, clock: f.clock });
    const ports = testWorkerPorts(f.db, f.clock, { path: f.path, descriptor, poolIndex: 1 });
    const slot = f.db.authority.workerSlots.list(descriptor.id).find(row => row.poolIndex === 1); assert.ok(slot);
    const runId = randomUUID();
    f.db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, itemId: runId, workflow: descriptor.id, contractFingerprint: descriptor.contractFingerprint,
      traceId: TraceIdSchema.parse("wj-170000-2222"), configSnapshotId: f.snapshot.configSnapshotId, configFingerprint: f.snapshot.fingerprint, resolvedInstance: {} },
      input: { raw: { name: "Synthetic batch" }, parsed: { schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: { name: "Synthetic batch" }, protectedBindings: [] }, ingressSchemaHash: "a".repeat(64) } });
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: slot.workerId }); assert.equal(claimed.state, "applied");
    if (claimed.state !== "applied") throw new Error("synthetic output run was not claimed");
    const sessions = await sessionManagerFor(happySessionHarness(), f.clock);
    const result = await executeClaimedRun({ descriptor, lifecycle: testRunLifecycle(f.db, f.clock), stores: defineTaskStoreRegistry([defineWorkflowStore(descriptor.id, { publishArchive: task })],
      { scenarioIds: [scenario], tasks: [{ id: contract.id, effect: "read" }] }), authority: f.db, sessions, emitter: recordingEmitter().emitter, clock: f.clock,
      ids: sequentialIdFactory("f"), scheduler: new ManualScheduler(f.clock, 0), taskDeadlineMs: 60_000, log: recordingLogger().log, artifacts, artifactProjector },
      { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: new AbortController().signal });
    assert.equal(result.state, "done", JSON.stringify(result.state === "failed" ? f.db.authority.failures.get(result.failureId) : result));
    const file = f.db.authority.generatedArtifacts.get(`sink:documents-file-${runId}`); assert.ok(file);
    assert.equal(file.mediaType, kind === "single" ? "application/zip" : "application/vnd.relay.artifact-collection+json"); assert.equal(file.state, "ready"); assert.equal(file.head?.generation, 1); assert.equal(file.updates.length, 1);
    assert.equal(file.updates[0]?.record.state, "projected"); assert.equal(file.versions.length, 1); assert.equal(f.db.authority.artifactOutbox.listPending().length, 0);
    const destinations = kind === "single" ? [{ path: fileName, person: "Worksheet A/Synthetic One", document: "synthetic one" }]
      : [{ path: "July 6/July 6.zip", person: "Synthetic One", document: "synthetic one" }, { path: "August 2/August 2.zip", person: "Synthetic Two", document: "synthetic two" }];
    const observed = [];
    for (const destination of destinations) {
      const path = join(f.snapshot.config.paths.onboardingDocsDir, destination.path), retained = readFileSync(path);
      const published = await JSZip.loadAsync(retained);
      assert.equal(await published.file(`${destination.person}/document.pdf`)?.async("string"), destination.document);
      if (kind === "single") {
        assert.deepEqual(retained, bytes);
        assert.equal(await published.file("Worksheet B/Synthetic Two/document.pdf")?.async("string"), "synthetic two");
      } else assert.deepEqual(Object.keys(published.files).filter(name => !published.files[name]?.dir), [`${destination.person}/document.pdf`]);
      observed.push({ path, bytes: retained, inode: statSync(path).ino });
    }
    const update = file.updates[0]; assert.ok(update);
    assert.deepEqual(await artifactProjector.projectOutbox([update.record.outboxId]), { projected: 0 });
    for (const output of observed) { assert.equal(statSync(output.path).ino, output.inode); assert.deepEqual(readFileSync(output.path), output.bytes); }
    assert.throws(() => f.db.authority.artifactOutbox.insert({ ...update.record, outboxId: randomUUID(), projectedAt: undefined, state: "pending" }), /already-registered/u);
  } finally { await f.dispose(); }
});

it("publishes retained run output at its moved physical destination without rewriting run evidence", async () => {
  const world = createRunRecordServiceTestWorld(), f = await world.interruptedFixture({ nativePaths: true });
  const target = realpathSync(mkdtempSync(join(tmpdir(), "named-output-layout-")));
  let lifetime: RuntimeLifetimeLock | undefined, machine: RuntimeAdmission | undefined, admission: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.admission }); await artifacts.ready;
    const bytes = Buffer.from("retained output across layout conversion"), artifact = await artifacts.put(bytes, { mediaType: "application/zip" });
    const fileName = `Moved ${randomUUID()}.zip`, profileId = f.admission.profileBinding.profileId, run = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(run);
    const activeBefore = f.database.authority.runtimeConfig.get(); assert.ok(activeBefore);
    const snapshotBefore = f.database.authority.configSnapshots.get(activeBefore.configSnapshotId); assert.ok(snapshotBefore);
    const workspace = f.machine.readInstallationContext()?.workspace; assert.ok(workspace);
    const row = ArtifactOutboxStorageRecordSchema.parse({ outboxId: randomUUID(), artifactId: randomUUID(), projectionId: "batch-archive", stableKeyFingerprint: "a".repeat(64),
      keyValues: [{ field: "archive.fileName", value: fileName }], sinkId: `documents-file-${run.envelope.runId}`, sourceRunId: run.envelope.runId, sourceNodeId: "searching", state: "pending",
      payload: { schemaHash: "b".repeat(64), value: namedArtifactOutput(artifact, fileName) }, createdAt: f.clock.now().toISOString() });
    f.database.authority.artifactOutbox.insert(row);
    await f.closeController();
    lifetime = await RuntimeLifetimeLock.acquire(0);
    await prepareApplicationDataWorkspace(workspace, target, lifetime, { primaryDisplay: null }, f.clock);
    machine = acquireEntrypointAdmission(target, "shared", lifetime); admission = machine.admitProfile(profileId);
    database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "moved-output-proof" }, f.clock,
      undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), run);
    assert.deepEqual(database.authority.configSnapshots.get(snapshotBefore.configSnapshotId), snapshotBefore);
    assert.deepEqual(database.authority.artifactOutbox.get(row.outboxId), row);
    const movedArtifacts = createContentAddressedArtifactWriter({ admission }); await movedArtifacts.ready;
    const projector = composeWorkerArtifactProjector({ admission, database, artifacts: movedArtifacts, clock: f.clock });
    await projector.projectOutbox([row.outboxId]);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const snapshot = database.authority.configSnapshots.get(active.configSnapshotId); assert.ok(snapshot);
    assert.notEqual(snapshot.config.paths.onboardingDocsDir, snapshotBefore.config.paths.onboardingDocsDir);
    assert.deepEqual(readFileSync(join(snapshot.config.paths.onboardingDocsDir, fileName)), bytes);
    assert.equal(existsSync(join(snapshotBefore.config.paths.onboardingDocsDir, fileName)), false);
    assert.deepEqual(database.authority.configSnapshots.get(snapshotBefore.configSnapshotId), snapshotBefore);
    assert.equal(database.authority.artifactOutbox.get(row.outboxId)?.state, "projected");
  } finally { database?.close(); admission?.release(); machine?.release(); await lifetime?.close(); await world.cleanup(); rmSync(target, { recursive: true, force: true }); }
});

it.each([
  ["single", "published"], ["collection", "prepared"], ["collection", "published"],
  ["collection", "directory-synced"], ["collection", "before-settlement"], ["collection", "after-head"], ["collection", "after-ack"],
] as const)("keeps an interrupted %s publication pending across %s and a new database connection", async (kind, window) => {
  const f = await foundationFixture();
  const { createNamedFileOutputSink } = await import("../../../../../src/backend/storage/artifacts/named-file-output-sink.js");
  const { createArtifactSinkProjector } = await import("../../../../../src/backend/storage/artifacts/artifact-sink-projector.js");
  const { ArtifactOutboxStorageRecordSchema } = await import("../../../../../src/models/artifacts/generated-artifact.js");
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const bytes = Buffer.from("synthetic retained publication"), artifact = await artifacts.put(bytes, { mediaType: "application/zip" });
    const fileName = `Interrupted ${randomUUID()}.zip`, sinkId = `documents-file-${f.run.envelope.runId}`;
    const output = kind === "single" ? namedArtifactOutput(artifact, fileName) : await collectionArtifactOutput(artifacts,
      [{ relativePath: "July 6/July 6.zip", artifact }, { relativePath: "August 2/August 2.zip", artifact }]);
    const row = ArtifactOutboxStorageRecordSchema.parse({ outboxId: randomUUID(), artifactId: randomUUID(), projectionId: "batch-archive", stableKeyFingerprint: "a".repeat(64),
      keyValues: [{ field: "archive.fileName", value: fileName }], sinkId, sourceRunId: f.run.envelope.runId, sourceNodeId: "searching", state: "pending",
      payload: { schemaHash: "b".repeat(64), value: output }, createdAt: f.clock.now().toISOString() });
    f.db.authority.artifactOutbox.insert(row);
    const make = (interrupt: boolean, database = f.db) => {
      const fault = (point: string) => { if (interrupt && point === window) throw new Error(`interrupt:${window}`); };
      return createArtifactSinkProjector({ authority: database.authority, withAuthorityTransaction: work => database.withAuthorityTransaction(work),
        assertCurrent: () => f.profile.admission.assertProfileRuntime(), lockDir: join(f.root, "scratch"), clock: f.clock, fault,
        sinks: { "documents-file": createNamedFileOutputSink({ artifacts, documentsDirectory: () => f.snapshot.config.paths.onboardingDocsDir, fault }) } });
    };
    await assert.rejects(make(true).projectOutbox([row.outboxId]), new RegExp(`interrupt:${window}`, "u"));
    const path = join(f.snapshot.config.paths.onboardingDocsDir, kind === "single" ? fileName : "July 6/July 6.zip");
    const before = existsSync(path) ? statSync(path).ino : undefined;
    assert.equal(existsSync(path), window !== "prepared");
    if (before !== undefined) assert.deepEqual(readFileSync(path), bytes);
    const pending = f.db.authority.generatedArtifacts.get(`sink:${sinkId}`); assert.ok(pending);
    assert.equal(pending.prepared?.updateId, row.outboxId); assert.equal(pending.head, null); assert.equal(pending.updates[0]?.record.state, "pending");
    assert.deepEqual(pending.prepared?.artifact, output.artifact);
    if (kind === "collection") assert.equal(existsSync(join(f.snapshot.config.paths.onboardingDocsDir, "August 2/August 2.zip")), window !== "prepared" && window !== "published");
    const restarted = AuthorityDatabase.open(f.profile.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "collection-restart" }, f.clock);
    try {
      assert.deepEqual(restarted.authority.generatedArtifacts.get(`sink:${sinkId}`)?.prepared, pending.prepared);
      await assert.rejects(make(false, restarted).projectOutbox([row.outboxId]), /prepared-conflict/u);
      if (before !== undefined) { assert.equal(statSync(path).ino, before); assert.deepEqual(readFileSync(path), bytes); }
      else assert.equal(existsSync(path), false);
    } finally { restarted.close(); }
    assert.equal(f.db.authority.artifactOutbox.get(row.outboxId)?.state, "pending");
  } finally { await f.dispose(); }
});

it("fails a dry run at a node that declares an artifact projection, before its task, outbox or sink runs", async () => {
  const f = await foundationFixture();
  let invoked = 0;
  const task = defineTask(contract, { sessions: [], async run() { invoked += 1; throw new Error("dry run invoked the projection source task"); } });
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const projector = composeWorkerArtifactProjector({ admission: f.profile.admission, database: f.db, artifacts, clock: f.clock });
    let projected = 0;
    const artifactProjector = { ...projector, async projectOutbox(ids: Parameters<typeof projector.projectOutbox>[0]) { projected += 1; return projector.projectOutbox(ids); } };
    const ports = testWorkerPorts(f.db, f.clock, { path: f.path, descriptor, poolIndex: 1 });
    const slot = f.db.authority.workerSlots.list(descriptor.id).find(row => row.poolIndex === 1); assert.ok(slot);
    const runId = randomUUID();
    f.db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, itemId: runId, workflow: descriptor.id, contractFingerprint: descriptor.contractFingerprint, dryRun: true,
      traceId: TraceIdSchema.parse("wj-170000-2223"), configSnapshotId: f.snapshot.configSnapshotId, configFingerprint: f.snapshot.fingerprint, resolvedInstance: {} },
      input: { raw: { name: "Synthetic batch" }, parsed: { schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: { name: "Synthetic batch" }, protectedBindings: [] }, ingressSchemaHash: "a".repeat(64) } });
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: slot.workerId }); assert.equal(claimed.state, "applied");
    if (claimed.state !== "applied") throw new Error("synthetic output run was not claimed");
    const result = await executeClaimedRun({ descriptor, lifecycle: testRunLifecycle(f.db, f.clock), stores: defineTaskStoreRegistry([defineWorkflowStore(descriptor.id, { publishArchive: task })],
      { scenarioIds: [scenario], tasks: [{ id: contract.id, effect: "read" }] }), authority: f.db, sessions: await sessionManagerFor(happySessionHarness(), f.clock), emitter: recordingEmitter().emitter, clock: f.clock,
      ids: sequentialIdFactory("f"), scheduler: new ManualScheduler(f.clock, 0), taskDeadlineMs: 60_000, log: recordingLogger().log, artifacts, artifactProjector },
      { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: new AbortController().signal });
    assert.equal(result.state, "failed");
    if (result.state !== "failed") return;
    assert.match(f.db.authority.failures.get(result.failureId)?.summary ?? "", /dry run must never reach/u);
    assert.deepEqual([invoked, projected], [0, 0]);
    assert.equal(f.db.authority.generatedArtifacts.list().some(file => file.updates.some(update => update.record.sourceRunId === runId)), false);
  } finally { await f.dispose(); }
});
