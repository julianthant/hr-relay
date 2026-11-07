import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { it, vi } from "vitest";
import { composeProfileRuntime, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { ProfileSessionRefusedError } from "../../../../src/backend/profiles/profile-errors.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";

async function fixture(drain: () => Promise<void> = async () => undefined) {
  const profile = await createBoundProfileFixture({ sharedMachine: true }), clock = manualClock(new Date("2026-11-04T12:00:00Z"));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null } });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("genuine fixture session required");
  const context = runtime.selectedContext(active.token);
  runtime.beginSupervisorConstruction(active.token); runtime.bindSupervisor(active.token, { snapshot: () => [], stopAll: async () => { await drain(); return []; } });
  return { profile, clock, runtime, active, context, logout: () => runtime.session.logOut(active.token, { at: clock.now().toISOString() }),
    async close(unproved = false) {
      try { await runtime.close(); }
      catch (error) { if (!unproved) throw error; assert.ok(error instanceof RuntimeCustodyUncertainError); }
      finally { await context.account.close(); context.database.close(); context.admission.release(); await profile.close(); }
    } };
}

function blocked(error: unknown): boolean {
  assert.ok(error instanceof ProfileSessionRefusedError); assert.equal(error.code, "PROFILE_LOGOUT_BLOCKED"); return true;
}

it("refuses synchronous revocation without a completed controller drain", async () => {
  const f = await fixture();
  try {
    const before = f.profile.machine.readProfileRegistry();
    assert.throws(f.logout, blocked);
    assert.deepEqual(f.profile.machine.readProfileRegistry(), before); assert.deepEqual(f.runtime.session.logoutOperations(), []);
    assert.equal(f.context.database.authority.runs.admission().state, "open");
  } finally { await f.close(); }
});

it("joins repeated drains and publishes exactly one revocation only after command and worker closure", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let stops = 0, cancellations = 0, busy = true;
  const f = await fixture(async () => { stops++; entered.resolve(); await release.promise; });
  f.runtime.registerCommandActivity(f.active.token, { hasUnquiescedWork: () => busy,
    requestCancellation() { cancellations++; }, awaitCancellation: () => release.promise.then(() => { busy = false; }) });
  try {
    const first = f.runtime.drainForLogout(f.active.token), second = f.runtime.drainForLogout(f.active.token); await entered.promise;
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch);
    assert.throws(f.logout, blocked); assert.equal(f.runtime.session.logoutOperations().length, 0);
    assert.equal(f.context.database.authority.runs.admission().state, "draining");
    release.resolve(); await Promise.all([first, second]); await f.runtime.drainForLogout(f.active.token);
    const result = f.logout(); assert.equal(result.state, "cancelling");
    if (result.state !== "cancelling" || result.operationId === undefined) throw new Error("completed drain must admit logout");
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch + 1);
    await f.runtime.awaitClosurePreparation(f.active.profileId);
    assert.equal(f.runtime.session.resumeLogout(result.operationId).state, "signed-out");
    assert.equal(f.runtime.session.resumeLogout(result.operationId).state, "signed-out");
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch + 1);
    assert.equal(stops, 1); assert.equal(cancellations, 1);
    assert.throws(() => f.context.admission.assertProfileRuntime());
  } finally { release.resolve(); await f.close(); }
});

it("rejects a changed native custody snapshot after the drain without publishing logout", async () => {
  const f = await fixture();
  try {
    await f.runtime.drainForLogout(f.active.token);
    const at = f.clock.now().toISOString();
    f.context.database.authority.notifications.create({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "e".repeat(64), trigger: "failed", channel: "ping",
      status: "unread", snooze: { state: "not-snoozed" }, title: "Fixture notice", summary: "Changed after drain", links: [{ kind: "run", runId: randomUUID() }],
      count: 1, lastSeenAt: at, version: 1, createdAt: at, updatedAt: at });
    assert.throws(f.logout, blocked); assert.deepEqual(f.runtime.session.logoutOperations(), []);
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch);
    assert.equal(f.context.database.authority.runs.admission().state, "draining");
  } finally { await f.close(); }
});

it("retains the original failed worker closure and current epoch without repeating drainage", async () => {
  const primary = new Error("fixture browser closure unproved"); let stops = 0;
  const f = await fixture(async () => { stops++; throw primary; });
  try {
    let failure: unknown;
    await assert.rejects(f.runtime.drainForLogout(f.active.token), error => { failure = error; assert.ok(error instanceof RuntimeCustodyUncertainError); return true; });
    await assert.rejects(f.runtime.drainForLogout(f.active.token), error => error === failure);
    const contains = (error: unknown): boolean => error === primary || error instanceof AggregateError && error.errors.some(contains);
    assert.ok(contains(failure)); assert.equal(stops, 1); assert.throws(f.logout, blocked);
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch);
    assert.deepEqual(f.runtime.session.logoutOperations(), []); f.context.admission.assertProfileRuntime(); f.profile.lifetime.assertHeld();
  } finally { await f.close(true); }
});

it("does not accept a changed session epoch while its drain is awaiting closure", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture(async () => { entered.resolve(); await release.promise; });
  try {
    const drain = f.runtime.drainForLogout(f.active.token); await entered.promise;
    createProfileRegistry(f.profile.machine).advanceSession(null); release.resolve();
    await assert.rejects(drain, RuntimeCustodyUncertainError);
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch + 1);
    assert.deepEqual(f.runtime.session.logoutOperations(), []);
    assert.throws(() => f.context.admission.assertProfileRuntime(), /profile-storage-claim-generation-changed/u);
  } finally { release.resolve(); await f.close(true); }
});

it("requires actual owned IPC child CLOSE after the supervisor acknowledgement", async () => {
  const f = await fixture(), reachedClose = Promise.withResolvers<void>();
  const child = spawn(process.execPath, ["-e", "process.on('message', () => process.send('ready'));"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const closed = once(child, "close"), ready = once(child, "message");
  const awaitClosed = f.profile.lifetime.awaitOwnedChildrenClosed.bind(f.profile.lifetime);
  const observe = vi.spyOn(f.profile.lifetime, "awaitOwnedChildrenClosed").mockImplementation(() => { reachedClose.resolve(); return awaitClosed(); });
  try {
    await f.profile.lifetime.share(child); f.profile.lifetime.observeOwnedChildClosure(child); await ready;
    const drain = f.runtime.drainForLogout(f.active.token); await reachedClose.promise;
    assert.throws(f.logout, blocked); assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch);
    assert.deepEqual(f.runtime.session.logoutOperations(), []);
    child.kill("SIGTERM"); await closed; await drain;
    f.profile.lifetime.assertOwnedChildClosed(child);
    const result = f.logout(); assert.equal(result.state, "cancelling");
    if (result.state !== "cancelling" || result.operationId === undefined) throw new Error("genuine close should admit logout");
    await f.runtime.awaitClosurePreparation(f.active.profileId);
    assert.equal(f.runtime.session.resumeLogout(result.operationId).state, "signed-out");
  } finally { child.kill("SIGKILL"); await closed; observe.mockRestore(); await f.close(); }
});

it("refuses a runtime-generation change that invalidates the owned new-run hold during drainage", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture(async () => { entered.resolve(); await release.promise; });
  try {
    const drain = f.runtime.drainForLogout(f.active.token); await entered.promise;
    const active = f.context.database.authority.runtimeConfig.get(); assert.ok(active);
    f.context.database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint, activatedAt: f.clock.now().toISOString() });
    release.resolve();
    const contains = (error: unknown): boolean => error instanceof Error && error.message === "profile-logout-admission-changed"
      || error instanceof AggregateError && error.errors.some(contains);
    await assert.rejects(drain, contains);
    assert.equal(f.profile.machine.readProfileRegistry().sessionGeneration, f.active.epoch);
    assert.deepEqual(f.runtime.session.logoutOperations(), []); assert.throws(f.logout, blocked);
  } finally { release.resolve(); await f.close(true); }
});

it("retains a genuine UNKNOWN submit and its exact attempt without revoking the profile or retrying", async () => {
  const world = createParkedWriteRoundTripTestWorld(), h = await world.roundTrip();
  let runtime: ReturnType<typeof composeProfileRuntime> | undefined, context: ReturnType<ReturnType<typeof composeProfileRuntime>["selectedContext"]> | undefined;
  try {
    await h.park(); stopSyntheticDatabaseWorkers({ database: h.database, path: h.profile.path });
    const intent = world.parkedIntent(h.database); assert.equal(intent.status, "parked");
    if (intent.status !== "parked") throw new Error("actual sequencer must park its unknown submit");
    assert.equal(intent.parkedCode, "unknown");
    const run = h.database.authority.runs.get(intent.runId), attempt = h.database.authority.writeAttempts.get(intent.currentAttemptId);
    assert.equal(run?.lifecycle.state, "parked-write");
    h.database.close();
    runtime = composeProfileRuntime({ admission: h.profile.machine, clock: h.clock, hostFacts: { primaryDisplay: null } });
    const active = runtime.session.resumeSignedInProfile({ at: h.clock.now().toISOString() });
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("genuine retained profile required");
    context = runtime.selectedContext(active.token);
    runtime.beginSupervisorConstruction(active.token); runtime.bindSupervisor(active.token, { snapshot: () => [], stopAll: async () => [] });
    const contains = (error: unknown): boolean => error instanceof Error && error.message === "profile-logout-work-unsettled"
      || error instanceof AggregateError && error.errors.some(contains);
    await assert.rejects(runtime.drainForLogout(active.token), contains);
    assert.equal(h.profile.machine.readProfileRegistry().sessionGeneration, active.epoch);
    assert.deepEqual(runtime.session.logoutOperations(), []);
    assert.deepEqual(world.parkedIntent(context.database), intent);
    assert.deepEqual(context.database.authority.writeAttempts.get(intent.currentAttemptId), attempt);
    assert.deepEqual(context.database.authority.runs.get(intent.runId), run);
    const held = runtime;
    assert.throws(() => held.session.logOut(active.token, { at: h.clock.now().toISOString() }), blocked);
  } finally {
    if (runtime !== undefined) await assert.rejects(runtime.close(), RuntimeCustodyUncertainError);
    if (context !== undefined) { await context.account.close(); context.database.close(); context.admission.release(); }
    await world.cleanup();
  }
});
