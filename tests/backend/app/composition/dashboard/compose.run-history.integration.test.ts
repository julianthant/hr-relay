import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/profile-session-routes.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { createProfileRegistry } from "../../../../../src/backend/profiles/registry.js";
import type { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import type { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { TimelineAppendSchema } from "../../../../../src/models/events/timeline.js";
import { ClearRunHistoryRequestSchema } from "../../../../../src/models/dashboard/run-history.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { CONFIG_SNAPSHOT, HASH_A, NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createBoundProfileFixture, createSyntheticProfileSession, finishProfileOnboarding, syntheticOnboardingDuo, releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

const world = createDashboardPortTestWorld(() => {}, releaseAdmissionFixtures);
afterEach(world.cleanup);

async function seedHistory(database: AuthorityDatabase, admission: RuntimeAdmission) {
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const config = database.authority.runtimeConfig.get(); assert.ok(config);
  const runId = randomUUID();
  const run = RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, itemId: runId,
    descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId } });
  database.authority.runs.enqueue(run);
  const envelope = run.envelope;
  const eventId = randomUUID();
  database.authority.timelineEvents.append(TimelineAppendSchema.parse({ schemaVersion: 1, eventId,
    workflow: envelope.workflow, scope: { kind: "run", runId }, occurredAt: NOW, recordedAt: NOW,
    retentionDate: NOW.slice(0, 10), source: { kind: "native" }, payload: { kind: "span", event: {
      t: "run.queued", kind: "run", pid: 1, ts: NOW, workflow: envelope.workflow, runId, attempt: 1,
      traceId: envelope.traceId, spanPath: envelope.traceId, itemId: envelope.itemId, shape: envelope.shape,
      priority: envelope.priority, dryRun: envelope.dryRun, actorId: "local-operator", title: "Synthetic history run",
      descriptorVersion: envelope.descriptorVersion, contractFingerprint: envelope.contractFingerprint,
      resolvedInstance: envelope.resolvedInstance, configFingerprint: envelope.configFingerprint, configSnapshotId: envelope.configSnapshotId,
    } } }));
  const writer = createContentAddressedArtifactWriter({ admission }); await writer.ready;
  const image = await writer.put(Buffer.from("synthetic screenshot bytes"), { mediaType: "image/png" });
  const bundleId = randomUUID();
  database.authority.diagnosticBundles.insert({ bundleId, runId, origin: { kind: "operator-request", requestedBy: "local-operator" },
    createdAt: NOW, contentDigest: HASH_A, configFingerprint: envelope.configFingerprint, descriptorFingerprint: envelope.contractFingerprint,
    redaction: { fields: [], warnings: [] }, retention: { kind: "ordinary", purgeAfter: "2026-12-01T00:00:00.000Z" },
    attachments: [{ kind: "screenshot", artifactId: image.id, mediaType: image.mediaType, byteLength: image.bytes,
      digest: image.sha256, sensitivity: "redacted", width: 1, height: 1 }] });
  const path = join(admission.artifactRoot, `${image.sha256}.artifact`);
  return { run, runId, eventId, bundleId, path };
}

it("serves history counts, refuses active deletion, then clears a finished run and its retained files over HTTP", async () => {
  const clock = manualClock(new Date(NOW));
  const profile = await world.createProfileFixture(clock);
  const runtime = await world.composeDashboardRuntime({ lifetimeLock: profile.lifetime, ...profile.dashboardInput,
    repoRoot: profile.workspace, isolation: rebuildRuntimeIsolation, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
  world.cleanups.push(() => runtime.stop());
  const { runtime: owner, token } = profile.dashboardInput.profile;
  const { database, admission, profileEpoch } = owner.selectedContext(token);
  const target = { profileId: admission.profileBinding.profileId, epoch: profileEpoch };
  const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${runtime.port}` });
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 0 });
  const { run, runId, eventId, bundleId, path } = await seedHistory(database, admission);
  assert.equal(existsSync(path), true);
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 1 });
  const refused = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID(), target });
  assert.deepEqual(await client.clearRunHistory(refused), { state: "refused", commandId: refused.commandId, reason: "active-runs" });
  assert.ok(database.authority.runs.get(runId)); assert.equal(existsSync(path), true);
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory(), publishQueued() {} });
  assert.equal(lifecycle.transition({ commandId: randomUUID(), runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "discarded", endedAt: NOW } }).state, "applied");
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 1, activeRuns: 0 });
  const command = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID(), target });
  assert.deepEqual(await client.clearRunHistory(command), { state: "cleared", commandId: command.commandId, deletedRuns: 1 });
  assert.deepEqual(database.authority.lifecycleJournal.getCommand(command.commandId)?.request, { commandId: command.commandId });
  assert.equal(database.authority.runs.get(runId), undefined);
  assert.equal(database.authority.timelineEvents.get(eventId), undefined);
  assert.equal(database.authority.diagnosticBundles.get(bundleId), undefined);
  assert.equal(existsSync(path), false);
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 0 });
  assert.deepEqual(await client.checkClearRunHistoryResult(command), { state: "cleared", commandId: command.commandId, deletedRuns: 1 });
});


it("binds Clear and result to the confirmed person and epoch despite a shared cookie changing tabs", async () => {
  const fixture = await createBoundProfileFixture();
  const clock = manualClock(new Date(NOW));
  world.copyRuntimePackageFixture(fixture.workspace);
  let app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  const password = "disposable-fixture-password";
  const seedPerson = async (email: string) => {
    const owner = composeProfileRuntime({ admission: fixture.machine, clock, hostFacts: { primaryDisplay: null } });
    try {
      const active = owner.session.signIn({ email, password, at: NOW });
      assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("synthetic seed sign-in refused");
      const { database, admission } = owner.selectedContext(active.token);
      const history = await seedHistory(database, admission);
      const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory(), publishQueued() {} });
      assert.equal(lifecycle.transition({ commandId: randomUUID(), runId: history.runId, expectedVersion: history.run.version,
        lifecycle: { state: "terminal", outcome: "discarded", endedAt: NOW } }).state, "applied");
      return { ...history, databasePath: join(admission.stateRoot, "state.db") };
    } finally { await owner.close(); }
  };
  try {
    const aHistory = await seedPerson("fixture@ucsd.edu");
    createProfileRegistry(fixture.machine).advanceSession(null);
    const setup = createSyntheticProfileSession({ admission: fixture.machine, machineRoot: fixture.machine.stateRoot, clock });
    try {
      const draft = setup.signUp({ firstName: "Synthetic", lastName: "Second", email: "second@ucsd.edu", password, createdAt: NOW });
      const active = await finishProfileOnboarding(setup, draft);
      assert.equal(active.state, "active");
    } finally { await setup.close(); }
    const bHistory = await seedPerson("second@ucsd.edu");
    app = await composeDashboardApplication({ admission: fixture.machine, lifetimeLock: fixture.lifetime, repoRoot: fixture.workspace,
      isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, clock, env: {},
      onboardingDuo: syntheticOnboardingDuo(), preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn() { throw new Error("history regression must not spawn a worker"); } } });
    const origin = `http://127.0.0.1:${app.port}`;
    let sharedCookie: string | undefined;
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(`${origin}${path}`, { ...init, headers: { ...init?.headers, origin,
        ...(sharedCookie === undefined ? {} : { cookie: sharedCookie }) } });
      const next = response.headers.get("set-cookie"); if (next !== null) sharedCookie = next.split(";", 1)[0];
      return response;
    };
    const tab = () => createDashboardClient({ baseUrl: origin, fetchImpl: (url, init) => request(new URL(url).pathname, init) });
    const aTab = tab(), bTab = tab();
    const a = await aTab.signInProfile({ email: "fixture@ucsd.edu", password });
    assert.equal(a.state, "active"); if (a.state !== "active") throw new Error("A sign-in refused");
    const confirmedA = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID(), target: { profileId: a.profileId, epoch: a.epoch } });
    const aCookie = sharedCookie;
    const b = await bTab.signInProfile({ email: "second@ucsd.edu", password });
    assert.equal(b.state, "active"); if (b.state !== "active") throw new Error("B sign-in refused");
    assert.notEqual(a.profileId, b.profileId); assert.notEqual(sharedCookie, aCookie);
    const snapshot = () => [aHistory, bHistory].map(history => {
      using raw = new DatabaseSync(history.databasePath, { readOnly: true });
      return { rows: ["runs", "diagnostic_snapshots", "diagnostic_files", "deleted_runs", "commands", "command_audits"].map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
        logs: raw.prepare("SELECT * FROM timeline_events WHERE run_id IS NOT NULL ORDER BY cursor").all(), file: readFileSync(history.path) };
    });
    const refuseWithoutEffects = async (command: unknown, code: string, status: number) => {
      const before = snapshot();
      for (const operation of ["clear", "result"]) {
        const response = await request(`/api/v1/storage/run-history/${operation}`, { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
        assert.equal(response.status, status);
        const body: unknown = await response.json(); assert.ok(body && typeof body === "object" && "code" in body);
        assert.equal(body.code, code);
        assert.deepEqual(snapshot(), before, `${operation} must preserve both profiles' history, journals, logs and files`);
      }
    };
    await refuseWithoutEffects(confirmedA, "PROFILE_SESSION_STALE", 409);
    await refuseWithoutEffects({ commandId: randomUUID() }, "SCHEMA_INVALID", 400);
    const confirmedB = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID(), target: { profileId: b.profileId, epoch: b.epoch } });
    const newerB = await bTab.signInProfile({ email: "second@ucsd.edu", password });
    assert.equal(newerB.state, "active"); if (newerB.state !== "active") throw new Error("new B sign-in refused");
    assert.equal(newerB.profileId, b.profileId); assert.ok(newerB.epoch > b.epoch);
    await refuseWithoutEffects(confirmedB, "PROFILE_SESSION_STALE", 409);
    const bound = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID(), target: { profileId: newerB.profileId, epoch: newerB.epoch } });
    const beforeA = snapshot()[0];
    assert.deepEqual(await aTab.clearRunHistory(bound), { state: "cleared", commandId: bound.commandId, deletedRuns: 1 });
    assert.deepEqual(await aTab.checkClearRunHistoryResult(bound), { state: "cleared", commandId: bound.commandId, deletedRuns: 1 });
    assert.deepEqual(await bTab.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 0 });
    assert.equal(existsSync(bHistory.path), false); assert.equal(existsSync(aHistory.path), true);
    using aDb = new DatabaseSync(aHistory.databasePath, { readOnly: true });
    assert.equal(aDb.prepare("SELECT count(*) AS n FROM runs WHERE id=?").get(aHistory.runId)?.n, 1);
    assert.equal(aDb.prepare("SELECT count(*) AS n FROM timeline_events WHERE id=?").get(aHistory.eventId)?.n, 1);
    assert.deepEqual(readFileSync(aHistory.path), beforeA?.file);
    using bDb = new DatabaseSync(bHistory.databasePath, { readOnly: true });
    assert.equal(bDb.prepare("SELECT count(*) AS n FROM runs WHERE id=?").get(bHistory.runId)?.n, 0);
    assert.equal(bDb.prepare("SELECT count(*) AS n FROM timeline_events WHERE id=?").get(bHistory.eventId)?.n, 0);
    assert.equal(bDb.prepare("SELECT count(*) AS n FROM diagnostic_snapshots WHERE id=?").get(bHistory.bundleId)?.n, 0);
  } finally { await app?.stop(); await fixture.close(); }
});
