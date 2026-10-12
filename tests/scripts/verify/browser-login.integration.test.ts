import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeSmokeSessions, smokeErrorDiagnostic, withSmokeWorker } from "../../../scripts/verify/browser-login.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-database-admission.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createDuoCeremonyGateFactory } from "../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { DuoTerminalRefusalError } from "../../../src/backend/systems/browser-shared/login-contract.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";

const clock = manualClock(new Date("2026-10-11T10:00:00.000Z"));
const credentialKey = FingerprintSchema.parse("ab".repeat(32));
const fixtures: { root: string; database: AuthorityDatabase }[] = [];
afterEach(() => {
  for (const { root, database } of fixtures.splice(0)) {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "relay-browser-login-"));
  const database = AuthorityDatabase.open({ path: join(root, "authority.sqlite"), busyTimeoutMs: 250,
    migrationOwner: "browser-login-test" }, clock);
  fixtures.push({ root, database });
  const plan = (desiredWorkers: number) => database.authority.workerPools.plan({ workflow: "person-lookup",
    expectedVersion: 0, desiredWorkers, requestedBy: "local-operator", now: clock.now().toISOString() });
  const allocate = (poolIndex: number) => database.authority.workerSlots.allocate({ workflow: "person-lookup",
    poolIndex, commandId: null, now: clock.now().toISOString() });
  const gates = createDuoCeremonyGateFactory({ leases: database.authority.duoCeremonyLeases, credentialKey,
    clock, scheduler: { schedule: () => ({ cancel: () => undefined }) }, sessionAcquireMs: 60000,
    graceMs: 20000, pollIntervalMs: 250 });
  return { database, plan, allocate, gates };
}

describe("registered browser-login smoke lifecycle", () => {
  it("reproduces the old unregistered worker FK refusal without touching live state", () => {
    const { database } = fixture();
    expect(() => database.authority.duoCeremonyLeases.acquire({ credentialKey, workerId: "live-smoke-worker-1",
      system: "ucpath", now: clock.now().toISOString(), ttlMs: 80000 })).toThrow(/FOREIGN KEY constraint failed/u);
    expect(database.authority.workerSlots.list()).toEqual([]);
    expect(database.authority.duoCeremonyLeases.get(credentialKey)).toBeUndefined();
  });

  it("admits exactly one fresh identity, uses it for the real lease FK, releases and retires it", async () => {
    const { database, gates } = fixture();
    await withSmokeWorker(database, async (slot, ownedGates) => {
      expect(database.authority.workerSlots.list()).toEqual([slot]);
      const gate = gates.openGate({ workerId: slot.workerId, system: "ucpath", envelopeDeadlineMonotonicMs: 60000,
        cancelCeremony: () => undefined, signal: new AbortController().signal });
      ownedGates.add(gate);
      await gate.withCeremony(async token => {
        expect(token.holder.workerId).toBe(slot.workerId);
        expect(database.authority.duoCeremonyLeases.get(credentialKey)?.state).toBe("held");
      });
    }, clock);
    const slots = database.authority.workerSlots.list();
    expect(slots).toHaveLength(1);
    expect(slots[0].retiredAt).toBe(clock.now().toISOString());
    expect(database.authority.duoCeremonyLeases.get(credentialKey)?.state).toBe("released");
    expect(database.authority.workerPools.get("person-lookup")?.desiredWorkers).toBe(0);
    expect(database.authority.commands.get(String(slots[0].retirementCommandId))).toMatchObject({ source: "live-smoke", type: "stop-worker", target: { workerId: slots[0].workerId } });
  });

  it("keeps the existing pool and peers unchanged and allocates the free index with its global ordinal", async () => {
    const { database, plan, allocate } = fixture();
    plan(2);
    const peers = [allocate(1), allocate(3)];
    const pool = database.authority.workerPools.get("person-lookup");
    await withSmokeWorker(database, async slot => {
      expect(slot.poolIndex).toBe(2);
      expect(slot.ordinal).toBe(3);
      expect(slot.workerId).toBe("person-lookup-worker-3");
    }, clock);
    expect(database.authority.workerPools.get("person-lookup")).toEqual(pool);
    expect(database.authority.workerSlots.list().slice(0, 2)).toEqual(peers);
    expect(database.authority.workerSlots.list()[2].retiredAt).not.toBeNull();
  });

  it("refuses full capacity before the operation and leaves persisted rows unchanged", async () => {
    const { database, plan, allocate } = fixture();
    plan(3);
    const peers = [allocate(1), allocate(2), allocate(3)];
    const pool = database.authority.workerPools.get("person-lookup");
    let operated = false;
    await expect(withSmokeWorker(database, async () => { operated = true; }, clock)).rejects.toThrow(/capacity-exceeded/u);
    expect(operated).toBe(false);
    expect(database.authority.workerSlots.list()).toEqual(peers);
    expect(database.authority.workerPools.get("person-lookup")).toEqual(pool);
    expect(database.authority.duoCeremonyLeases.get(credentialKey)).toBeUndefined();
  });

  it("retires after setup failure before any gate opens", async () => {
    const { database } = fixture();
    const failure = new Error("offline setup failed");
    await expect(withSmokeWorker(database, async () => { throw failure; }, clock)).rejects.toBe(failure);
    expect(database.authority.workerSlots.list()).toHaveLength(1);
    expect(database.authority.workerSlots.list()[0].retiredAt).not.toBeNull();
  });

  it("disposes a retained Duo lease before retirement when login throws", async () => {
    const { database, gates } = fixture();
    const failure = new DuoTerminalRefusalError("ucpath", "offline refusal", "https://example.test");
    await expect(withSmokeWorker(database, async (slot, ownedGates) => {
      const gate = gates.openGate({ workerId: slot.workerId, system: "ucpath", envelopeDeadlineMonotonicMs: 60000,
        cancelCeremony: () => undefined, signal: new AbortController().signal });
      ownedGates.add({ withCeremony: run => gate.withCeremony(run), retainedForRecovery: () => gate.retainedForRecovery(),
        dispose: error => {
          expect(database.authority.workerSlots.get(slot.workerId)?.retiredAt).toBeNull();
          gate.dispose(error);
        } });
      await gate.withCeremony(async () => { throw failure; });
    }, clock)).rejects.toBe(failure);
    expect(database.authority.duoCeremonyLeases.get(credentialKey)?.state).toBe("released");
    expect(database.authority.workerSlots.list()[0].retiredAt).not.toBeNull();
  });

  it("releases its held gate but preserves the slot when browser closure is unproved", async () => {
    const { database, gates, plan, allocate } = fixture();
    plan(1);
    const peer = allocate(1);
    const pool = database.authority.workerPools.get("person-lookup");
    const login = new DuoTerminalRefusalError("ucpath", "offline refusal", "https://example.test");
    const close = new Error("offline browser closure failed");
    await expect(withSmokeWorker(database, async (slot, ownedGates) => {
      const gate = gates.openGate({ workerId: slot.workerId, system: "ucpath", envelopeDeadlineMonotonicMs: 60000,
        cancelCeremony: () => undefined, signal: new AbortController().signal });
      ownedGates.add(gate);
      const session = { closeAll: async () => { throw close; } };
      const errors: unknown[] = [];
      try { await gate.withCeremony(async () => { throw login; }); } catch (error) { errors.push(error); }
      await closeSmokeSessions(session, () => { throw new Error("profile deletion must not follow failed close"); }, errors);
    }, clock)).rejects.toMatchObject({ name: "SmokeSessionClosureError", errors: [login, close] });
    expect(database.authority.duoCeremonyLeases.get(credentialKey)?.state).toBe("released");
    expect(database.authority.workerSlots.list()).toHaveLength(2);
    expect(database.authority.workerSlots.list()[0]).toEqual(peer);
    expect(database.authority.workerSlots.list()[1].retiredAt).toBeNull();
    expect(database.authority.workerPools.get("person-lookup")).toEqual(pool);
  });

  it("preserves the slot when factory setup and closure fail before session registration", async () => {
    const { database, plan, allocate } = fixture();
    plan(1);
    const peer = allocate(1);
    const setup = new Error("offline context setup failed");
    const close = new Error("offline unregistered context closure failed");
    const factoryFailure = new AggregateError([setup, close], "browser session setup and closure failed");
    const reservation = new Error("owned profile reservation still held");
    await expect(withSmokeWorker(database, async () => {
      const registered: string[] = [];
      const factory = { open: async () => { throw factoryFailure; } };
      const sessions = { closeAll: async () => { expect(registered).toEqual([]); } };
      const errors: unknown[] = [];
      try { registered.push(await factory.open()); } catch (error) { errors.push(error); }
      await closeSmokeSessions(sessions, () => { throw reservation; }, errors);
    }, clock)).rejects.toMatchObject({ name: "SmokeSessionClosureError", errors: [factoryFailure, reservation] });
    expect(database.authority.workerSlots.list()).toHaveLength(2);
    expect(database.authority.workerSlots.list()[0]).toEqual(peer);
    expect(database.authority.workerSlots.list()[1].retiredAt).toBeNull();
    expect(database.authority.duoCeremonyLeases.get(credentialKey)).toBeUndefined();
    expect(database.authority.workerPools.get("person-lookup")?.desiredWorkers).toBe(1);
  });

  it("prints decisive nested aggregate diagnostics without dumping error objects", () => {
    const setup = new Error("offline setup failed");
    const close = new Error("offline closure failed");
    const reservation = new Error("offline profile reservation held");
    const diagnostic = smokeErrorDiagnostic(new AggregateError([
      new AggregateError([setup, close], "offline factory failed"), reservation,
    ], "offline smoke failed"));
    for (const error of [setup, close, reservation]) expect(diagnostic).toContain(error.message);
    expect(diagnostic).not.toContain("[object Object]");
  });

  it("keeps cleanup failure visible and never retires while its gate remains held", async () => {
    const { database } = fixture();
    const failure = new DuoTerminalRefusalError("ucpath", "offline refusal", "https://example.test");
    const cleanup = new Error("offline gate release failed");
    const gates = createDuoCeremonyGateFactory({
      leases: { ...database.authority.duoCeremonyLeases, release: () => { throw cleanup; } }, credentialKey,
      clock, scheduler: { schedule: () => ({ cancel: () => undefined }) }, sessionAcquireMs: 60000,
      graceMs: 20000, pollIntervalMs: 250,
    });
    await expect(withSmokeWorker(database, async (slot, ownedGates) => {
      const gate = gates.openGate({ workerId: slot.workerId, system: "ucpath", envelopeDeadlineMonotonicMs: 60000,
        cancelCeremony: () => undefined, signal: new AbortController().signal });
      ownedGates.add(gate);
      await gate.withCeremony(async () => { throw failure; });
    }, clock)).rejects.toMatchObject({ errors: [failure, { name: "DuoCeremonyReleaseFailedError", releaseError: cleanup, cause: failure }] });
    expect(database.authority.duoCeremonyLeases.get(credentialKey)?.state).toBe("held");
    expect(database.authority.workerSlots.list()[0].retiredAt).toBeNull();
  });
});
