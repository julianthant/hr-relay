import { WireErrorSchema } from "../../../../../src/models/dashboard/primitives.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it, vi } from "vitest";
import { z } from "zod";
import { neverBornFixture, refusedStart, nativeWorkerBytes } from "../../../../support/helpers/backend/never-born-worker-world.js";
import { kernelOver } from "../../../../support/helpers/backend/dashboard-pool-world.js";
import { testProcessImport } from "../../../../support/compiled-process.js";
import { FakeKeyringEntry, credentialKeychainTestEnvironment } from "../../../../support/helpers/credential-keychain-fake.js";
import { lifecycleCommandId } from "../../../../../src/rules/commands/lifecycle-command-id.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { assertStoppedProfileResourcesClosed } from "../../../../../src/backend/storage/maintenance/profile-custody.js";
import { RuntimeCustodyUncertainError } from "../../../../../src/backend/app/composition/storage-compose.js";
import * as proofs from "../../../../../src/backend/storage/sqlite/worker-control.js";

vi.mock("../../../../../src/backend/storage/sqlite/worker-control.js", { spy: true });

function onlyHttpDiagnostics(before: ReturnType<typeof nativeWorkerBytes>, after: ReturnType<typeof nativeWorkerBytes>, expected: number) {
  const ids = new Set(before.timeline.map(row => row.id));
  const added = after.timeline.filter(row => !ids.has(row.id));
  assert.equal(added.length, expected);
  for (const row of added) {
    assert.equal(row.kind, "debug");
    const payload = z.object({ payload: z.object({ kind: z.literal("debug"), event: z.object({ category: z.literal("http"), route: z.literal("/api/v1/commands") }) }) }).parse(JSON.parse(String(row.payload_json)));
    assert.equal(payload.payload.event.category, "http");
  }
  assert.deepEqual(after.timeline.filter(row => ids.has(row.id)), before.timeline);
  const generation = (rows: typeof before.generation) => z.object({ authority_generation: z.number() }).parse(rows[0]).authority_generation;
  assert.equal(generation(after.generation), generation(before.generation) + expected);
  assert.deepEqual({ ...after, generation: before.generation, timeline: before.timeline }, before);
}

function hold(f: Awaited<ReturnType<typeof neverBornFixture>>) {
  const db = f.context.database, active = db.authority.runtimeConfig.get(); assert.ok(active);
  db.authority.runs.holdAdmission({ commandId: randomUUID(), runtimeGeneration: active.generation, reason: "shutdown" });
}
function settlement(started: Awaited<ReturnType<typeof refusedStart>>) {
  return CommandRequestSchema.parse({ ...started.spawn.request,
    commandId: lifecycleCommandId("never-born-retirement", [started.slot.reservationCommandId, started.spawn.commandId, started.slot.workerId]),
    type: "plan-worker-count", target: { workflowId: started.slot.workflow, expectedVersion: 1 }, payload: { desiredWorkers: 0 } });
}
async function positiveControl() {
  const f = await neverBornFixture(true);
  try { const started = await refusedStart(f); assert.equal(f.context.database.hasWorkerNonBirth(started.slot), true); }
  finally { await f.close(); }
}

it("retires only the exact fresh allocation, preserves native refusal bytes, and replays all completed identities read-only", async () => {
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database;
    let before = nativeWorkerBytes(f.profile.path); const command = settlement(started);
    assert.equal(db.hasWorkerNonBirth(started.slot), true);
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
    hold(f); before = nativeWorkerBytes(f.profile.path); db.settleNeverSpawnedWorkers();
    const after = nativeWorkerBytes(f.profile.path), slot = db.authority.workerSlots.get(started.slot.workerId); assert.ok(slot);
    assert.equal(slot.retirementCommandId, command.commandId); assert.equal(slot.membershipRevision, started.slot.membershipRevision + 1);
    const control = db.authority.workerControls.get(command.commandId); assert.ok(control?.phase.state === "succeeded");
    assert.deepEqual(control.roster?.selected, []); assert.deepEqual(control.roster?.excess, [started.slot]);
    assert.equal(control.phase.acknowledgement.kind, "plan"); assert.ok(control.auditedAt);
    assert.equal(db.authority.workerPools.get(started.slot.workflow)?.desiredWorkers, 0);
    assert.equal(db.authority.workerPools.get(started.slot.workflow)?.version, 2);
    assertStoppedProfileResourcesClosed(db.readProfileResourceCustody());
    assert.deepEqual(after.commands.filter(row => row.id !== command.commandId), before.commands);
    assert.deepEqual(after.controls.filter(row => row.command_id !== command.commandId), before.controls);
    assert.deepEqual(after.audits.filter(row => row.command_id !== command.commandId), before.audits);
    const mintCount = vi.mocked(proofs.mintWorkerNonBirthProof).mock.calls.length;
    for (let i = 0; i < 2; i += 1) {
      for (const request of [started.command, started.spawn.request, control.request]) {
        const response = await f.post("commands", request);
        const result = CommandResultSchema.parse(await response.json());
        assert.ok(result.state === "already-applied" || result.state === "rejected");
      }
      db.settleNeverSpawnedWorkers();
    }
    onlyHttpDiagnostics(after, nativeWorkerBytes(f.profile.path), 4); assert.equal(f.spawns(), 0);
    assert.equal(vi.mocked(proofs.mintWorkerNonBirthProof).mock.calls.length, mintCount);
  } finally { await f.close(); }
});

it("refuses the missing settlement identity through native, sync, async and HTTP admission without creating records", async () => {
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database, request = settlement(started), before = nativeWorkerBytes(f.profile.path);
    assert.throws(() => db.withAuthorityTransaction(repositories => repositories.commands.assertIdentity(request)), /missing-settlement-replay-refused/);
    assert.throws(() => db.withAuthorityTransaction(repositories => repositories.commands.insert(request)), /missing-settlement-replay-refused/);
    const unused = async (): Promise<never> => { throw new Error("missing settlement must not dispatch"); };
    const kernel = kernelOver(db, f.clock, { planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused,
      reopenPoolBrowser: unused, stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused });
    assert.equal(kernel.execute(request).state, "rejected");
    assert.equal((await kernel.executeWorkerPool(request)).state, "rejected");
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
    const response = await f.post("commands", request); assert.equal(CommandResultSchema.parse(await response.json()).state, "rejected");
    onlyHttpDiagnostics(before, nativeWorkerBytes(f.profile.path), 1);
    assert.equal(f.spawns(), 0); assert.equal(db.hasWorkerNonBirth(started.slot), true);
  } finally { await f.close(); }
});

it("does not admit settlement replay when the original Spawn control record is missing", async () => {
  await positiveControl();
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database;
    const raw = new DatabaseSync(f.profile.path);
    try { raw.prepare("DELETE FROM worker_controls WHERE command_id=?").run(started.spawn.commandId); }
    finally { raw.close(); }
    const before = nativeWorkerBytes(f.profile.path);
    assert.throws(() => db.withAuthorityTransaction(repositories => repositories.commands.assertIdentity(settlement(started))));
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
  } finally { await assert.rejects(f.close(), RuntimeCustodyUncertainError); }
});

for (const typed of [false, true]) it(`does not treat an entered ${typed ? "typed-refusal" : "unknown-outcome"} spawner as positive non-birth`, async () => {
  await positiveControl();
  const f = await neverBornFixture(false, typed);
  try {
    const started = await refusedStart(f, false, typed ? "refused" : "unknown"); assert.equal(f.spawns(), 1);
    assert.equal(f.context.database.hasWorkerNonBirth(started.slot), false);
    hold(f); const before = nativeWorkerBytes(f.profile.path); f.context.database.settleNeverSpawnedWorkers();
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
  } finally { await assert.rejects(f.close(), RuntimeCustodyUncertainError); }
});

for (const attempted of [false, true]) it(`refuses generic Plan retirement of an unleased Spawn member (${String(attempted)})`, async () => {
  await positiveControl();
  const f = await neverBornFixture(!attempted, attempted);
  try {
    const started = await refusedStart(f, !attempted, "refused"), db = f.context.database;
    const before = nativeWorkerBytes(f.profile.path);
    const response = await f.post("commands", { ...settlement(started), commandId: randomUUID() });
    const result = CommandResultSchema.parse(await response.json());
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("ordinary Plan must not settle non-birth");
    assert.equal(result.message, "worker-retirement-non-birth-capability-required");
    const after = nativeWorkerBytes(f.profile.path);
    assert.deepEqual(after.slots, before.slots); assert.deepEqual(after.pools, before.pools); assert.deepEqual(after.runs, before.runs);
    for (const row of before.controls) assert.deepEqual(after.controls.find(value => value.command_id === row.command_id), row);
    for (const row of before.audits) assert.deepEqual(after.audits.find(value => value.id === row.id), row);
    assert.equal(db.hasWorkerNonBirth(started.slot), !attempted);
  } finally {
    if (attempted) await assert.rejects(f.close(), RuntimeCustodyUncertainError);
    else await f.close();
  }
});

it("does not publish allocation registration from a successful nested allocation followed by outer rollback", async () => {
  await positiveControl();
  const f = await neverBornFixture();
  try {
    const db = f.context.database, before = nativeWorkerBytes(f.profile.path), publish = db.afterAuthorityCommit.bind(db);
    let published = 0;
    const spy = vi.spyOn(db, "afterAuthorityCommit").mockImplementation(callback => publish(() => { published += 1; callback(); }));
    try {
      assert.throws(() => db.withAuthorityTransaction(repositories => {
        const now = f.clock.now().toISOString();
        repositories.workerPools.plan({ workflow: "person-lookup", expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now });
        repositories.workerSlots.allocate({ workflow: "person-lookup", poolIndex: 1, commandId: null, now });
        assert.equal(published, 0);
        throw new Error("outer-allocation-rollback");
      }), /outer-allocation-rollback/);
      assert.equal(published, 0); assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
    } finally { spy.mockRestore(); }
  } finally { await f.close(); }
});

it("rolls back a successful nested retirement with its outer transaction without consuming the capability", async () => {
  await positiveControl();
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database; hold(f);
    const before = nativeWorkerBytes(f.profile.path), consumed = vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length;
    assert.throws(() => db.withAuthorityTransaction(() => {
      db.settleNeverSpawnedWorkers(); assert.notEqual(db.authority.workerSlots.get(started.slot.workerId)?.retiredAt, null);
      assert.equal(vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length, consumed);
      throw new Error("outer-retirement-rollback");
    }), /outer-retirement-rollback/);
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
    assert.equal(db.hasWorkerNonBirth(started.slot), true);
    assert.equal(vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length, consumed);
    assert.throws(() => db.withAuthorityTransaction(repositories => repositories.commands.assertIdentity(settlement(started))), /missing-settlement-replay-refused/);
  } finally { await assert.rejects(f.close(), RuntimeCustodyUncertainError); }
});

it("rolls back every retirement row on a fault immediately before COMMIT", async () => {
  await positiveControl();
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database; hold(f);
    const before = nativeWorkerBytes(f.profile.path), consumed = vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length;
    const spy = vi.spyOn(db, "afterAuthorityCommit").mockImplementation(() => { throw new Error("before-retirement-commit"); });
    try { assert.throws(() => db.settleNeverSpawnedWorkers(), /before-retirement-commit/); }
    finally { spy.mockRestore(); }
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
    assert.equal(db.hasWorkerNonBirth(started.slot), true);
    assert.equal(vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length, consumed);
  } finally { await assert.rejects(f.close(), RuntimeCustodyUncertainError); }
});

for (const attempted of [false, true]) it(`covers later refusals and invalidates non-birth on a later attempted launch (${String(attempted)})`, async () => {
  await positiveControl();
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database;
    if (attempted) f.disarmDoctorRace();
    const next = { ...started.spawn.request, commandId: randomUUID() };
    const response = await f.post("commands", next);
    if (attempted) { assert.equal(response.status, 500); assert.equal(WireErrorSchema.parse(await response.json()).code, "INTERNAL_FAILURE"); }
    else assert.equal(CommandResultSchema.parse(await response.json()).state, "rejected");
    if (attempted) {
      assert.equal(f.spawns(), 1);
      assert.throws(() => db.hasWorkerNonBirth(started.slot), /authority-unavailable/);
    } else {
      assert.equal(f.spawns(), 0); assert.equal(db.hasWorkerNonBirth(started.slot), true);
      const old = nativeWorkerBytes(f.profile.path);
      hold(f); db.settleNeverSpawnedWorkers();
      const after = nativeWorkerBytes(f.profile.path);
      for (const row of old.controls) assert.deepEqual(after.controls.find(value => value.command_id === row.command_id), row);
    }
  } finally {
    if (attempted) await assert.rejects(f.close(), RuntimeCustodyUncertainError);
    else await f.close();
  }
});

it("keeps the complete retirement after a post-COMMIT fault before consumption and replays it without a second audit", async () => {
  await positiveControl();
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database; hold(f);
    const consumed = vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length, publish = db.afterAuthorityCommit.bind(db);
    const spy = vi.spyOn(db, "afterAuthorityCommit").mockImplementation(() => publish(() => { throw new Error("after-commit-before-consume"); }));
    try { assert.throws(() => db.settleNeverSpawnedWorkers(), /after-commit-before-consume/); }
    finally { spy.mockRestore(); }
    assert.equal(vi.mocked(proofs.consumeWorkerNonBirthProof).mock.calls.length, consumed);
    const control = db.authority.workerControls.get(settlement(started).commandId); assert.ok(control?.auditedAt);
    assertStoppedProfileResourcesClosed(db.readProfileResourceCustody());
    const before = nativeWorkerBytes(f.profile.path);
    assert.throws(() => db.settleNeverSpawnedWorkers(), /settlement-unproved/);
    const response = await f.post("commands", control.request); assert.equal(CommandResultSchema.parse(await response.json()).state, "already-applied");
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
  } finally { await assert.rejects(f.close(), RuntimeCustodyUncertainError); }
});

for (const arm of ["pool", "resource", "forged-proof"] as const) it(`refuses ${arm} drift while preserving the refused start`, async () => {
  await positiveControl();
  const f = await neverBornFixture(true);
  try {
    const started = await refusedStart(f), db = f.context.database;
    if (arm === "pool") {
      const pool = db.authority.workerPools.get(started.slot.workflow); assert.ok(pool);
      db.authority.workerPools.plan({ workflow: pool.workflow, expectedVersion: pool.version, desiredWorkers: pool.desiredWorkers,
        requestedBy: "local-operator", now: f.clock.now().toISOString() });
    } else if (arm === "resource") {
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      mkdirSync(join(f.profile.stateRoot, "browsers", `w${String(started.slot.ordinal)}`), { recursive: true, mode: 0o700 });
    } else {
      const minted = vi.mocked(proofs.mintWorkerNonBirthProof), call = minted.mock.lastCall, result = minted.mock.results.at(-1);
      assert.ok(call); assert.ok(result?.type === "return");
      const binding = proofs.authenticateWorkerNonBirthProof(result.value, call[0], call[1]);
      assert.throws(() => Object.assign(binding, { commandId: randomUUID() }), TypeError);
      assert.throws(() => Object.assign(binding.member, { membershipRevision: binding.member.membershipRevision + 1 }), TypeError);
      assert.throws(() => proofs.authenticateWorkerNonBirthProof({ ...result.value }, call[0], call[1]), /authority-unavailable/);
      assert.throws(() => proofs.authenticateWorkerNonBirthProof(result.value, {}, call[1]), /authority-unavailable/);
      assert.throws(() => proofs.authenticateWorkerNonBirthProof(result.value, call[0], {}), /authority-unavailable/);
      assert.throws(() => proofs.authenticateWorkerNonBirthProof({ kind: "worker-non-birth" }, {}, {}), /authority-unavailable/);
      assert.throws(() => db.bindWorkerNonBirthSupervisor({ nonBirthProof: () => ({ kind: "worker-non-birth" }) }, () => undefined), /already-bound/);
      return;
    }
    assert.throws(() => db.hasWorkerNonBirth(started.slot)); hold(f);
    const before = nativeWorkerBytes(f.profile.path);
    assert.throws(() => db.settleNeverSpawnedWorkers());
    assert.deepEqual(nativeWorkerBytes(f.profile.path), before);
  } finally {
    if (arm === "forged-proof") await f.close();
    else await assert.rejects(f.close(), RuntimeCustodyUncertainError);
  }
});

it("loses positive proof across an actual controller crash and refuses the unfinished reservation in a new process", async () => {
  await positiveControl();
  const message = z.object({ workspace: z.string(), profileId: z.string(), path: z.string(), keychain: z.array(z.tuple([z.string(), z.string()])) });
  const launch = (args: string[], env: NodeJS.ProcessEnv) => spawn(process.execPath,
    ["--import", testProcessImport(), fileURLToPath(new URL("../../../../support/processes/never-born-worker-controller.ts", import.meta.url)), ...args],
    { env, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const child = launch([], credentialKeychainTestEnvironment(process.env));
  let workspace: string | undefined;
  try {
    const values: unknown = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("original controller exited before refusal proof"); })]);
    const info = message.parse(z.array(z.unknown()).parse(values)[0]); workspace = info.workspace;
    const closed = once(child, "close"); assert.equal(child.kill("SIGKILL"), true); await closed;
    FakeKeyringEntry.import(info.keychain);
    const successor = launch([info.workspace, info.profileId, info.path], credentialKeychainTestEnvironment(process.env));
    const output: string[] = []; successor.stderr?.on("data", chunk => output.push(String(chunk)));
    const successorClosed = once(successor, "close");
    try {
      const observed: unknown = await Promise.race([once(successor, "message"), successorClosed.then(() => { throw new Error(`successor exited before observation: ${output.join("")}`); })]);
      assert.deepEqual(z.array(z.unknown()).parse(observed)[0], { observed: true });
      const [code] = z.tuple([z.number().nullable(), z.string().nullable()]).parse(await successorClosed); assert.equal(code, 0, output.join(""));
    } finally { if (successor.exitCode === null && successor.signalCode === null) { successor.kill("SIGKILL"); await successorClosed; } }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGKILL"); await closed; }
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  }
});
