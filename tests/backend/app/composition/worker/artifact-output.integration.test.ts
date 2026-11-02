import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { it } from "vitest";
import { z } from "zod";
import { collectSourceClosure,fingerprintSourceSet } from "../../../../../scripts/build/workflow-build-manifest.js";
import { parseBuildManifest } from "../../../../../src/models/workflow/build-manifest.js";
import { BUILD_MANIFEST } from "../../../../../src/workflow-kit/validation/build-manifest.js";
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
import { ArtifactRefSchema, NamedArtifactOutputSchema } from "../../../../../src/models/artifacts/artifacts.js";
import { defineTaskContract } from "../../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../src/models/workflow/presentation.js";
import { ScenarioIdSchema, taskId, TraceIdSchema } from "../../../../../src/rules/identity/ids.js";
import { namedArtifactOutput } from "../../../../../src/workflow-kit/artifacts.js";
import { flow } from "../../../../../src/workflow-kit/flow.js";
import { defineTaskStoreRegistry, defineWorkflowStore } from "../../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { testRunLifecycle, testWorkerPorts } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { foundationFixture } from "../../../../support/helpers/database-foundation/fixtures.js";
import { happySessionHarness, ManualScheduler, recordingEmitter, recordingLogger, sessionManagerFor } from "../../../../support/helpers/phase1f-executor-harness.js";

it("publishes a task's one batch zip through the real checkpoint, outbox, worker sink and retained documents path", async () => {
  const f = await foundationFixture(), fileName = `Onboarding Docs ${randomUUID()}.zip`;
  const scenario = ScenarioIdSchema.parse("wiring-projection/archive"), input = z.strictObject({ name: z.string() });
  const canonicalInput = defineCanonicalInput(input, input, [{ name: "Synthetic batch" }]);
  const zip = new JSZip(); zip.file("Worksheet A/Synthetic One/document.pdf", "synthetic one"); zip.file("Worksheet B/Synthetic Two/document.pdf", "synthetic two");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const contract = defineTaskContract({ id: taskId("workflow:wiring-projection/read-archive"), title: "Publish archive", effect: "read", input,
    output: z.strictObject({ archive: NamedArtifactOutputSchema }), errorCodes: ["archive-unavailable"] as const, artifacts: "content-addressed",
    subject: { kind: "none", reason: "synthetic batch archive" }, scenarios: [scenario], freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
    provenance: { default: "live" }, example: { archive: { fileName, artifact: ArtifactRefSchema.parse({ id: randomUUID(), sha256: "a".repeat(64), bytes: 1, mediaType: "application/zip" }) } } });
  const task = defineTask(contract, { sessions: [], async run({ ctx }) {
    const archive = namedArtifactOutput(await ctx.artifacts.put(bytes, { mediaType: "application/zip" }), fileName);
    for (const [field, value] of Object.entries(archive.artifact)) ctx.recordData({ direction: "read", field: `archive.artifact.${field}`, value });
    ctx.recordData({ direction: "read", field: "archive.fileName", value: archive.fileName });
    return { archive };
  } });
  const definition = flow(input).step("archive", contract, { dependsOn: [], replay: "checkpoint", bind: ({ input: value }) => ({ name: value.name }) })
    .build({ schema: z.strictObject({ done: z.boolean() }), dependsOn: ["archive"], derive: () => ({ done: true }) });
  const descriptor = defineWorkflowDescriptor({ id: "wiring-projection", version: 1, contractFingerprint: "a".repeat(64), code: "wj", label: "Named output fixture", icon: "Search", category: "operations",
    canonicalInput, inputSubject: "name", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
    identity: { matchKey: (value: z.output<typeof input>) => value.name }, presentation: { title: (value: z.output<typeof input>) => value.name }, scenarios: [String(scenario)],
    artifactProjections: [{ id: "batch-archive", source: { nodeId: "archive", fieldPath: "archive" }, keyFields: ["archive.fileName"], sink: "documents-file", blocking: true }], flow: definition });
  const sources = collectSourceClosure(process.cwd(), fileURLToPath(import.meta.url));
  const entry = (id: string) => ({ id, sources, fingerprint: fingerprintSourceSet(BUILD_MANIFEST.toolchain, id, sources) });
  const buildManifest = parseBuildManifest({ ...BUILD_MANIFEST, workflows: [...BUILD_MANIFEST.workflows, entry(descriptor.id)],
    tasks: [...BUILD_MANIFEST.tasks, entry(contract.id)] });
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const artifactProjector = composeWorkerArtifactProjector({ admission: f.profile.admission, database: f.db, artifacts, clock: f.clock });
    const ports = testWorkerPorts(f.db, f.clock, { path: f.path, descriptor, poolIndex: 1 });
    const slot = f.db.authority.workerSlots.list(descriptor.id).find(row => row.poolIndex === 1); assert.ok(slot);
    const runId = randomUUID();
    f.db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, itemId: runId, workflow: descriptor.id, contractFingerprint: descriptor.contractFingerprint,
      traceId: TraceIdSchema.parse("wj-170000-2222"), configSnapshotId: f.snapshot.configSnapshotId, configFingerprint: f.snapshot.fingerprint, resolvedInstance: {} },
      input: { raw: { name: "Synthetic batch" }, parsed: { schemaHash: deriveSchemaHash(canonicalInput, "output"), value: { name: "Synthetic batch" }, protectedBindings: [] }, ingressSchemaHash: "a".repeat(64) } });
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: slot.workerId }); assert.equal(claimed.state, "applied");
    if (claimed.state !== "applied") throw new Error("synthetic output run was not claimed");
    const sessions = await sessionManagerFor(happySessionHarness(), f.clock);
    const result = await executeClaimedRun({ descriptor, lifecycle: testRunLifecycle(f.db, f.clock), stores: defineTaskStoreRegistry([defineWorkflowStore(descriptor.id, { publishArchive: task })],
      { scenarioIds: [scenario], tasks: [{ id: contract.id, effect: "read" }] }), authority: f.db, sessions, emitter: recordingEmitter().emitter, clock: f.clock,
      ids: sequentialIdFactory("f"), scheduler: new ManualScheduler(f.clock, 0), taskDeadlineMs: 60_000, log: recordingLogger().log, artifacts, artifactProjector, buildManifest },
      { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: new AbortController().signal });
    assert.equal(result.state, "done", JSON.stringify(result.state === "failed" ? f.db.authority.failures.get(result.failureId) : result));
    const file = f.db.authority.generatedArtifacts.get(`sink:documents-file-${runId}`); assert.ok(file);
    assert.equal(file.mediaType, "application/zip"); assert.equal(file.state, "ready"); assert.equal(file.head?.generation, 1); assert.equal(file.updates.length, 1);
    assert.equal(file.updates[0]?.record.state, "projected"); assert.equal(file.versions.length, 1); assert.equal(f.db.authority.artifactOutbox.listPending().length, 0);
    const path = join(f.snapshot.config.paths.onboardingDocsDir, fileName), before = statSync(path);
    assert.deepEqual(readFileSync(path), bytes);
    const published = await JSZip.loadAsync(readFileSync(path));
    assert.equal(await published.file("Worksheet A/Synthetic One/document.pdf")?.async("string"), "synthetic one");
    assert.equal(await published.file("Worksheet B/Synthetic Two/document.pdf")?.async("string"), "synthetic two");
    const update = file.updates[0]; assert.ok(update);
    assert.deepEqual(await artifactProjector.projectOutbox([update.record.outboxId]), { projected: 0 });
    assert.equal(statSync(path).ino, before.ino); assert.deepEqual(readFileSync(path), bytes);
    assert.throws(() => f.db.authority.artifactOutbox.insert({ ...update.record, outboxId: randomUUID(), projectedAt: undefined, state: "pending" }), /already-registered/u);
  } finally { await f.dispose(); }
});

it("publishes retained run output at its moved physical destination without rewriting run evidence", async () => {
  const f = await foundationFixture(), target = realpathSync(mkdtempSync(join(tmpdir(), "named-output-layout-")));
  let lifetime: RuntimeLifetimeLock | undefined, machine: RuntimeAdmission | undefined, admission: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const bytes = Buffer.from("retained output across layout conversion"), artifact = await artifacts.put(bytes, { mediaType: "application/zip" });
    const fileName = `Moved ${randomUUID()}.zip`, profileId = f.profile.admission.profileBinding.profileId, run = f.db.authority.runs.get(f.run.envelope.runId); assert.ok(run);
    const row = ArtifactOutboxStorageRecordSchema.parse({ outboxId: randomUUID(), artifactId: randomUUID(), projectionId: "batch-archive", stableKeyFingerprint: "a".repeat(64),
      keyValues: [{ field: "archive.fileName", value: fileName }], sinkId: `documents-file-${run.envelope.runId}`, sourceRunId: run.envelope.runId, sourceNodeId: "searching", state: "pending",
      payload: { schemaHash: "b".repeat(64), value: namedArtifactOutput(artifact, fileName) }, createdAt: f.clock.now().toISOString() });
    f.db.authority.artifactOutbox.insert(row);
    f.db.close(); await f.profile.closeController();
    lifetime = await RuntimeLifetimeLock.acquire(0);
    await prepareApplicationDataWorkspace(f.profile.workspace, target, lifetime, { primaryDisplay: null }, f.clock);
    machine = acquireEntrypointAdmission(target, "shared", lifetime); admission = machine.admitProfile(profileId);
    database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "moved-output-proof" }, f.clock,
      undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: admission.stateRoot }));
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), run);
    assert.deepEqual(database.authority.configSnapshots.get(f.snapshot.configSnapshotId), f.snapshot);
    assert.deepEqual(database.authority.artifactOutbox.get(row.outboxId), row);
    const movedArtifacts = createContentAddressedArtifactWriter({ admission }); await movedArtifacts.ready;
    const projector = composeWorkerArtifactProjector({ admission, database, artifacts: movedArtifacts, clock: f.clock });
    await projector.projectOutbox([row.outboxId]);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const snapshot = database.authority.configSnapshots.get(active.configSnapshotId); assert.ok(snapshot);
    assert.notEqual(snapshot.config.paths.onboardingDocsDir, f.snapshot.config.paths.onboardingDocsDir);
    assert.deepEqual(readFileSync(join(snapshot.config.paths.onboardingDocsDir, fileName)), bytes);
    assert.equal(existsSync(join(f.snapshot.config.paths.onboardingDocsDir, fileName)), false);
    assert.deepEqual(database.authority.configSnapshots.get(f.snapshot.configSnapshotId), f.snapshot);
    assert.equal(database.authority.artifactOutbox.get(row.outboxId)?.state, "projected");
  } finally { database?.close(); admission?.release(); machine?.release(); await lifetime?.close(); await f.dispose(); rmSync(target, { recursive: true, force: true }); }
});

it("keeps an interrupted named publication pending and refuses to duplicate its external effect", async () => {
  const f = await foundationFixture();
  const { createNamedFileOutputSink } = await import("../../../../../src/backend/storage/artifacts/named-file-output-sink.js");
  const { createArtifactSinkProjector } = await import("../../../../../src/backend/storage/artifacts/artifact-sink-projector.js");
  const { ArtifactOutboxStorageRecordSchema } = await import("../../../../../src/models/artifacts/generated-artifact.js");
  try {
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const bytes = Buffer.from("synthetic retained publication"), artifact = await artifacts.put(bytes, { mediaType: "application/zip" });
    const fileName = `Interrupted ${randomUUID()}.zip`, sinkId = `documents-file-${f.run.envelope.runId}`;
    const row = ArtifactOutboxStorageRecordSchema.parse({ outboxId: randomUUID(), artifactId: randomUUID(), projectionId: "batch-archive", stableKeyFingerprint: "a".repeat(64),
      keyValues: [{ field: "archive.fileName", value: fileName }], sinkId, sourceRunId: f.run.envelope.runId, sourceNodeId: "searching", state: "pending",
      payload: { schemaHash: "b".repeat(64), value: namedArtifactOutput(artifact, fileName) }, createdAt: f.clock.now().toISOString() });
    f.db.authority.artifactOutbox.insert(row);
    const make = (interrupt: boolean) => createArtifactSinkProjector({ authority: f.db.authority, withAuthorityTransaction: work => f.db.withAuthorityTransaction(work),
      assertCurrent: () => f.profile.admission.assertProfileRuntime(), lockDir: join(f.root, "scratch"), clock: f.clock,
      sinks: { "documents-file": createNamedFileOutputSink({ artifacts, documentsDirectory: () => f.snapshot.config.paths.onboardingDocsDir,
        fault(point) { if (interrupt && point === "published") throw new Error("interrupt-after-atomic-publication"); } }) } });
    await assert.rejects(make(true).projectOutbox([row.outboxId]), /interrupt-after-atomic-publication/u);
    const path = join(f.snapshot.config.paths.onboardingDocsDir, fileName), before = statSync(path);
    assert.deepEqual(readFileSync(path), bytes);
    const pending = f.db.authority.generatedArtifacts.get(`sink:${sinkId}`); assert.ok(pending);
    assert.equal(pending.prepared?.updateId, row.outboxId); assert.equal(pending.head, null); assert.equal(pending.updates[0]?.record.state, "pending");
    await assert.rejects(make(false).projectOutbox([row.outboxId]), /prepared-conflict/u);
    assert.equal(statSync(path).ino, before.ino); assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.db.authority.artifactOutbox.get(row.outboxId)?.state, "pending");
  } finally { await f.dispose(); }
});
