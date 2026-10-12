import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { closeSmokeSessions, smokeErrorDiagnostic, withSmokeWorker } from "../../../scripts/verify/browser-login.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-database-admission.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createDuoCeremonyGateFactory } from "../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { BrowserLoginError, DuoTerminalRefusalError } from "../../../src/backend/systems/browser-shared/login-contract.js";
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

  it("prints safe nested error identities without dumping error objects", () => {
    const setup = new Error("offline setup failed");
    const close = new Error("offline closure failed");
    const reservation = new Error("offline profile reservation held");
    const diagnostic = smokeErrorDiagnostic(new AggregateError([
      new AggregateError([setup, close], "offline factory failed"), reservation,
    ], "offline smoke failed"));
    expect(JSON.parse(diagnostic)).toEqual([{ error: "AggregateError" }, { error: "AggregateError" },
      { error: "Error" }, { error: "Error" }, { error: "Error" }]);
    for (const error of [setup, close, reservation]) expect(diagnostic).not.toContain(error.message);
    expect(diagnostic).not.toContain("[object Object]");
  });

  it("withholds authentication material across aggregate members, causes and arbitrary properties", () => {
    const sentinels = ["synthetic-auth-user", "synthetic-auth-pass", "synthetic-saml-proof",
      "synthetic-execution-proof", "synthetic-fragment-proof", "synthetic-message-proof", "synthetic-property-proof"];
    const url = `https://${sentinels[0]}:${sentinels[1]}@login.example.invalid/sso?SAMLResponse=${sentinels[2]}&execution=${sentinels[3]}#${sentinels[4]}`;
    const login = new BrowserLoginError("ucpath", "sso-submit", sentinels[5], url,
      { cause: new TypeError(sentinels[5]) });
    Object.assign(login, { authentication: { token: sentinels[6], password: sentinels[1] } });
    const duo = new DuoTerminalRefusalError("crm", sentinels[5], url);
    const error = new AggregateError([new Error(sentinels[5], { cause: login }),
      new AggregateError([duo, sentinels[2], { authentication: { token: sentinels[6] } }], sentinels[5])],
    sentinels[5], { cause: new Error(sentinels[5], { cause: duo }) });
    const diagnostic = smokeErrorDiagnostic(error);
    for (const sentinel of sentinels) expect(diagnostic.includes(sentinel)).toBe(false);
    expect(diagnostic).not.toContain("SAMLResponse");
    expect(diagnostic).not.toContain("authentication");
    const entries = z.array(z.record(z.string(), z.string())).parse(JSON.parse(diagnostic));
    expect(entries).toContainEqual({ error: "BrowserLoginError", system: "ucpath", phase: "sso-submit", host: "login.example.invalid" });
    expect(entries).toContainEqual({ error: "DuoTerminalRefusalError", system: "crm", phase: "duo-clearance", host: "login.example.invalid" });
    expect(entries).toContainEqual({ error: "TypeError" });
    expect(entries.filter(entry => entry.error === "DuoTerminalRefusalError")).toHaveLength(1);
  });

  it("never echoes an unparseable target or its parser failure", () => {
    const sentinel = "synthetic-invalid-auth-url-proof";
    const error = new BrowserLoginError("ucpath", "verify-landing", sentinel, `https://[invalid?token=${sentinel}`);
    const diagnostic = smokeErrorDiagnostic(error);
    expect(diagnostic.includes(sentinel)).toBe(false);
    expect(JSON.parse(diagnostic)).toEqual([{ error: "BrowserLoginError", system: "ucpath", phase: "verify-landing", host: "<unparseable navigation target>" }]);
  });

  it("omits non-Error values without coercing or reading authentication objects", () => {
    const sentinel = "synthetic-non-error-auth-proof";
    const object = { authentication: { token: sentinel }, toString: () => { throw new Error("non-Error coercion reached"); } };
    for (const input of [sentinel, object, null, undefined]) {
      expect(smokeErrorDiagnostic(input)).toBe("[]");
    }
  });

  it("bounds cycles shared between aggregate members and error causes", () => {
    const child = new Error("synthetic-cycle-auth-proof");
    const aggregate = new AggregateError([child], "synthetic-cycle-auth-proof", { cause: child });
    child.cause = aggregate;
    expect(JSON.parse(smokeErrorDiagnostic(aggregate))).toEqual([{ error: "AggregateError" }, { error: "Error" }]);
  });

  it("does not admit arbitrary error names or forged login metadata", () => {
    const sentinel = "synthetic-forged-auth-proof";
    const error = new BrowserLoginError("ucpath", "sso-form", sentinel, "https://login.example.invalid/");
    Object.assign(error, { name: sentinel, system: sentinel, step: sentinel });
    const diagnostic = smokeErrorDiagnostic(error);
    expect(diagnostic.includes(sentinel)).toBe(false);
    expect(JSON.parse(diagnostic)).toEqual([{ error: "BrowserLoginError", host: "login.example.invalid" }]);
    const generic = new Error(sentinel);
    generic.name = sentinel;
    expect(smokeErrorDiagnostic(generic)).toBe('[{"error":"Error"}]');
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
