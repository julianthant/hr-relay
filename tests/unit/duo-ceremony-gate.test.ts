/**
 * Ref execution-and-sessions §10.8 (D267): the serialization PROOF, on the
 * manual clock — two workers cold-starting one credential, the second's
 * ceremony provably beginning AFTER the first's verifier returned — plus the
 * waiter refusal (§10.4), the expiry / generation takeover and the
 * poison-on-supersede arm (§10.3), and the fresh-profile-once recovery arms
 * (§10.5) on the real `WorkerSessionManager`.
 *
 * Nothing here is a stand-in for the lease: both managers run over ONE
 * authority database, the fake factories run the REAL
 * `defineVerifiedLoginRecipe` wrapper against a stub page, and the token each
 * ceremony receives is the one the store minted.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { Page } from "playwright";
import type { DuoCeremonyLeaseToken } from "../../src/base/duo-ceremony-lease.js";
import type {
  BrowserSessionCloseProof,
  WorkerBrowserSessionFactory,
} from "../../src/base/session.js";
import {
  createDuoCeremonyGateFactory,
  DUO_CEREMONY_LEASE_POLL_MS,
  DuoCeremonyLeaseExpiredError,
  DuoCeremonyLeaseHeldError,
  DuoCeremonyReleaseFailedError,
} from "../../src/core/duo-ceremony-gate.js";
import type { DuoCeremonyGateFactory } from "../../src/core/duo-ceremony-gate.js";
import { WorkerSessionManager } from "../../src/core/worker-sessions.js";
import { manualClock } from "../../src/domain/clock.js";
import type { TestClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import {
  BrowserSessionIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../src/domain/ids.js";
import type { BrowserSystemId, WorkerId } from "../../src/domain/ids.js";
import { defineVerifiedLoginRecipe } from "../../src/infra/browser/authenticated-application.js";
import { DuoTerminalRefusalError } from "../../src/infra/browser/login-contract.js";
import type { SystemLoginContext } from "../../src/infra/browser/login-contract.js";
import type { AuthorityDatabase, DuoCeremonyLeaseRepository } from "../../src/infra/sqlite/authority-database.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import {
  duoCeremonyGatesOver,
  FIXTURE_DUO_CREDENTIAL_KEY,
  FIXTURE_DUO_LEASE_GRACE_MS,
  FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
  openDuoCeremonyLeaseDatabase,
} from "./fixtures/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "./fixtures/phase1f-executor-harness.js";

const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
const WORKER_A = WorkerIdSchema.parse("duo-proof-worker-a");
const WORKER_B = WorkerIdSchema.parse("duo-proof-worker-b");
const RUN_FINGERPRINT = FingerprintSchema.parse("3".repeat(64));
const SYSTEM: BrowserSystemId = "ucpath";
const NEED = { system: SYSTEM, access: "read", session: "reuse-worker" } as const;
const T0 = new Date("2026-08-21T12:00:00.000Z");
const TTL_MS = FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS + FIXTURE_DUO_LEASE_GRACE_MS;
const BUDGET_MS = FIXTURE_SESSION_ACQUIRE_MS - FIXTURE_DUO_LEASE_GRACE_MS;
const POLL_MS = 250;
const CONFIG = resolveConfig({}, {}, manualClock(T0));

interface Deferred { readonly promise: Promise<void>; resolve(): void; reject(error: Error): void }
function deferred(): Deferred {
  let resolve = (): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Advance both halves of the clock and fire every scheduler entry that came due, to a fixpoint. */
async function advance(clock: TestClock, scheduler: ManualScheduler, ms: number): Promise<void> {
  clock.advanceMonotonic(ms);
  clock.advanceWall(ms);
  await flush();
  for (;;) {
    const due = scheduler.pending().filter((entry) => entry.deadlineMonotonicMs <= clock.monotonicMs());
    if (due.length === 0) break;
    for (const entry of due) entry.fire();
    await flush();
  }
}

interface CeremonyScript {
  /** Called with the minted token when the ceremony half starts. Resolve it to let the ceremony finish. */
  readonly onCeremony: (token: DuoCeremonyLeaseToken, context: SystemLoginContext) => Promise<void>;
}

/**
 * A factory whose `authenticate` runs the REAL wrapper: a stub page, a verifier
 * that proves the session only after the scripted ceremony ran, and the gate
 * the manager handed in. `discardProfile` is recorded; omit it to model a
 * factory that cannot recover.
 */
function recipeFactory(
  workerId: WorkerId,
  script: CeremonyScript,
  options: Readonly<{ withDiscard?: boolean }> = {},
): Readonly<{
  factory: WorkerBrowserSessionFactory;
  opens: () => number;
  closes: () => number;
  discards: () => readonly unknown[];
}> {
  let opens = 0;
  let closes = 0;
  const discards: unknown[] = [];
  const page = { url: () => "https://app.example/" } as unknown as Page;
  const factory: WorkerBrowserSessionFactory = {
    async open(input) {
      opens += 1;
      let ceremonyCompleted = false;
      const sessionId = BrowserSessionIdSchema.parse(`00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`);
      const recipe = defineVerifiedLoginRecipe({
        system: SYSTEM,
        verify: async () => ceremonyCompleted
          ? { authenticated: true, evidence: { system: SYSTEM, url: page.url(), positive: "stub session", negative: "no form" } }
          : { authenticated: false, reason: "the stub session is not proven until the ceremony ran" },
        navigate: async () => undefined,
        ceremony: async (context, token) => {
          await script.onCeremony(token, context);
          ceremonyCompleted = true;
        },
      });
      return {
        sessionId,
        system: input.system,
        instance: input.instance,
        configFingerprint: input.configFingerprint,
        acceptDownloads: input.acceptDownloads,
        exclusive: input.exclusive,
        driver: { system: input.system },
        authentication: {
          authenticate: (system, authOptions) => recipe({
            page,
            config: CONFIG,
            instance: "prod",
            label: `worker ${workerId} ${system} session`,
            signal: authOptions.signal ?? input.signal,
            credentials: { userId: "stub-user", password: "stub-pass" },
            recordEvidence: () => undefined,
            duoCeremony: input.duoCeremony,
          }),
        },
        async reset() { return undefined; },
        async close(): Promise<BrowserSessionCloseProof> {
          closes += 1;
          return { sessionId, system: input.system, pagesClosed: true, contextClosed: true };
        },
      };
    },
    ...(options.withDiscard === false ? {} : {
      async discardProfile(input) {
        discards.push(input);
        return { profileDirectory: `/tmp/fixture-profiles/${input.workerId}/${input.system}` };
      },
    }),
  };
  return { factory, opens: () => opens, closes: () => closes, discards: () => Object.freeze([...discards]) };
}

function managerFor(
  workerId: WorkerId,
  factory: WorkerBrowserSessionFactory,
  clock: TestClock,
  scheduler: ManualScheduler,
  duoCeremony: DuoCeremonyGateFactory,
): WorkerSessionManager {
  const manager = new WorkerSessionManager({
    workerId,
    workflowId: WORKFLOW_ID,
    stores: taskStoreRegistry,
    factory,
    clock,
    scheduler,
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony,
  });
  manager.bindRunConfigFingerprint(RUN_FINGERPRINT);
  return manager;
}

const databases: AuthorityDatabase[] = [];
function sharedAuthority(clock: TestClock): AuthorityDatabase {
  const database = openDuoCeremonyLeaseDatabase(clock);
  databases.push(database);
  return database;
}
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function leaseRow(database: AuthorityDatabase) {
  const row = database.authority.duoCeremonyLeases.get(FIXTURE_DUO_CREDENTIAL_KEY);
  assert.ok(row !== undefined, "the credential's lease row must exist");
  return row;
}

describe("D267 — two workers, one credential, one ceremony at a time", () => {
  it("starts the second worker's ceremony strictly after the first worker's verifier returned", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const events: string[] = [];
    const holdA = deferred();
    const a = recipeFactory(WORKER_A, {
      onCeremony: async () => { events.push("A:ceremony-begin"); await holdA.promise; events.push("A:ceremony-end"); },
    });
    const b = recipeFactory(WORKER_B, {
      onCeremony: async () => { events.push("B:ceremony-begin"); },
    });
    const managerA = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    const managerB = managerFor(WORKER_B, b.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));

    const runA = managerA.withDriver(NEED, "prod", new AbortController().signal, async () => {
      events.push("A:verifier-returned+driver");
      return "a";
    });
    await flush();
    const runB = managerB.withDriver(NEED, "prod", new AbortController().signal, async () => {
      events.push("B:driver");
      return "b";
    });
    await flush();
    // B polls while A is inside its ceremony: several poll intervals pass and B never begins.
    for (let i = 0; i < 8; i += 1) await advance(clock, scheduler, POLL_MS);
    assert.deepEqual(events, ["A:ceremony-begin"]);
    assert.equal(leaseRow(database).holder.workerId, WORKER_A);
    assert.equal(leaseRow(database).generation, 1);

    holdA.resolve();
    await flush();
    assert.equal(await runA, "a");
    // A released; B's NEXT poll acquires at generation 2 and only then begins.
    await advance(clock, scheduler, POLL_MS);
    assert.equal(await runB, "b");
    assert.deepEqual(events, [
      "A:ceremony-begin",
      "A:ceremony-end",
      "A:verifier-returned+driver",
      "B:ceremony-begin",
      "B:driver",
    ]);
    assert.equal(leaseRow(database).generation, 2);
    assert.equal(leaseRow(database).state, "released");
    await managerA.closeAll("worker-stop");
    await managerB.closeAll("worker-stop");
  });

  it("refuses the waiter by NAME before its acquisition envelope fires, and never retries", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const holdA = deferred();
    const a = recipeFactory(WORKER_A, { onCeremony: async () => holdA.promise });
    const bCeremonies: number[] = [];
    const b = recipeFactory(WORKER_B, { onCeremony: async () => { bCeremonies.push(clock.monotonicMs()); } });
    const managerA = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    const managerB = managerFor(WORKER_B, b.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));

    const runA = managerA.withDriver(NEED, "prod", new AbortController().signal, async () => "a");
    await flush();
    const runB = managerB.withDriver(NEED, "prod", new AbortController().signal, async () => "b");
    const refusal = runB.then(() => undefined, (error: unknown) => error);
    // B's envelope and its first poll both start NOW, before any time passes.
    await flush();
    // Just inside the budget: still waiting.
    await advance(clock, scheduler, BUDGET_MS - POLL_MS);
    assert.equal(await Promise.race([refusal.then(() => "settled"), flush().then(() => "pending")]), "pending");
    // At the budget: refused — 20 s before the 60 s envelope would have fired.
    await advance(clock, scheduler, POLL_MS);
    const error = await refusal;
    assert.ok(error instanceof DuoCeremonyLeaseHeldError, `expected DuoCeremonyLeaseHeldError, got ${String(error)}`);
    assert.equal(error.holder.workerId, WORKER_A);
    assert.equal(error.holder.system, SYSTEM);
    assert.equal(error.holder.expiresAt, leaseRow(database).expiresAt);
    assert.match(error.message, new RegExp(`worker ${WORKER_A} \\(${SYSTEM}\\), generation 1, until ${leaseRow(database).expiresAt}`));
    assert.match(error.message, /refuses BEFORE its envelope fires; it is not retried/);
    assert.ok(clock.monotonicMs() < FIXTURE_SESSION_ACQUIRE_MS, "the refusal landed inside the envelope");
    assert.deepEqual(bCeremonies, [], "B never reached its ceremony");
    assert.equal(b.closes(), 1, "B's opened resource was closed with proof");
    // A still holds; no retry loop re-entered the lease for B.
    assert.equal(leaseRow(database).holder.workerId, WORKER_A);
    holdA.resolve();
    assert.equal(await runA, "a");
    await managerA.closeAll("worker-stop");
    await managerB.closeAll("worker-stop");
  });

  it("a lease past its TTL is taken over at the next generation, and the old holder's in-flight ceremony is cancelled", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const gatesA = duoCeremonyGatesOver(database, clock, scheduler);
    const gatesB = duoCeremonyGatesOver(database, clock, scheduler);
    const cancellations: Error[] = [];
    const gateA = gatesA.openGate({
      workerId: WORKER_A, system: SYSTEM,
      // The envelope deliberately sits BEYOND the TTL here, so the TTL is the arm under test.
      envelopeDeadlineMonotonicMs: clock.monotonicMs() + 10 * TTL_MS,
      cancelCeremony: (reason) => cancellations.push(reason),
      signal: new AbortController().signal,
    });
    const holdA = deferred();
    const ceremonyA = gateA.withCeremony(async () => holdA.promise);
    await flush();
    assert.equal(leaseRow(database).generation, 1);

    await advance(clock, scheduler, TTL_MS - 1);
    assert.equal(cancellations.length, 0, "one millisecond before TTL nothing is cancelled");
    await advance(clock, scheduler, 1);
    assert.equal(cancellations.length, 1);
    assert.ok(cancellations[0] instanceof DuoCeremonyLeaseExpiredError);
    assert.match(cancellations[0].message, /expired at .* before the content verifier returned/);

    const gateB = gatesB.openGate({
      workerId: WORKER_B, system: "crm",
      envelopeDeadlineMonotonicMs: clock.monotonicMs() + FIXTURE_SESSION_ACQUIRE_MS,
      cancelCeremony: () => undefined,
      signal: new AbortController().signal,
    });
    let tokenB: DuoCeremonyLeaseToken | undefined;
    await gateB.withCeremony(async (token) => { tokenB = token; });
    assert.equal(tokenB?.generation, 2);
    assert.equal(tokenB?.holder.workerId, WORKER_B);
    assert.equal(leaseRow(database).generation, 2);

    // Poison-on-supersede: A's ceremony finally settles and its release finds
    // the row moved on — loud, never a silent write over B's row.
    holdA.resolve();
    await assert.rejects(ceremonyA, /generation 1 was superseded by generation 2 \(worker duo-proof-worker-b, crm\)/);
    assert.equal(leaseRow(database).generation, 2, "the successor's row is untouched");
    gateA.dispose();
    gateB.dispose();
  });

  it("recovers from ONE Duo terminal refusal on a fresh profile under the SAME lease generation", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const tokens: DuoCeremonyLeaseToken[] = [];
    let refusalsLeft = 1;
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (token, context) => {
        tokens.push(token);
        if (refusalsLeft > 0) {
          refusalsLeft -= 1;
          throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
        }
      },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    const result = await manager.withDriver(NEED, "prod", new AbortController().signal, async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(a.opens(), 2, "the burned context was replaced by a fresh one");
    assert.equal(a.closes(), 1, "the burned context was closed with proof before the directory was touched");
    assert.deepEqual(a.discards(), [{
      workerId: WORKER_A, system: SYSTEM, instance: "prod", configFingerprint: RUN_FINGERPRINT,
    }]);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], tokens[1], "the retry ran under the very token the first ceremony held");
    assert.equal(tokens[0]?.generation, 1);
    assert.equal(leaseRow(database).generation, 1, "no release and re-acquire happened between the two attempts");
    assert.equal(leaseRow(database).state, "released");
    await manager.closeAll("worker-stop");
  });

  it("fails loud naming the profile directory on the SECOND refusal, and releases the lease", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (_token, context) => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
      },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Duo refused the WebAuthn assertion AGAIN on a freshly created profile at \/tmp\/fixture-profiles\/duo-proof-worker-a\/ucpath/);
        assert.match(error.message, /not deleted a third time/);
        assert.ok(error.cause instanceof DuoTerminalRefusalError);
        return true;
      },
    );
    assert.equal(a.discards().length, 1, "the directory was recreated exactly once");
    assert.equal(a.opens(), 2);
    assert.equal(a.closes(), 2, "both burned contexts were closed with proof");
    assert.equal(leaseRow(database).generation, 1);
    assert.equal(leaseRow(database).state, "released", "the lease is released after the second refusal");
  });

  it("refuses the recovery by name when the factory cannot discard a profile, and releases the lease", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (_token, context) => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
      },
    }, { withDiscard: false });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      /cannot discard the burned browser profile \(no discardProfile\)/,
    );
    assert.equal(a.opens(), 1, "no retry without a fresh profile");
    assert.equal(a.closes(), 1);
    assert.equal(leaseRow(database).state, "released");
  });

  it("lets an ordinary login failure through untouched: no discard, no retry, lease released", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async () => { throw new Error("the SSO form never rendered (fixture)"); },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      /the SSO form never rendered \(fixture\)/,
    );
    assert.deepEqual(a.discards(), []);
    assert.equal(a.opens(), 1);
    assert.equal(leaseRow(database).state, "released");
  });
});

describe("Gate#release preserves the original error when the store's release() itself throws (review finding 1, §10.4)", () => {
  it("throws DuoCeremonyReleaseFailedError carrying the ceremony error as cause, and leaves #hold set so a later dispose() retries the UPDATE", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const real = database.authority.duoCeremonyLeases;
    const releaseError = new Error("sqlite: database is locked (fixture)");
    let releaseCalls = 0;
    // A store double whose `release` throws on its FIRST call (a transient store failure, never the
    // ordinary `superseded` report — that is a returned outcome, not a throw) and delegates for
    // every later call, so a retry can be proved to succeed.
    const flaky: DuoCeremonyLeaseRepository = Object.freeze({
      acquire: (input: unknown) => real.acquire(input),
      get: (credentialKey: string) => real.get(credentialKey),
      release: (input: Readonly<{ token: unknown; now: string }>) => {
        releaseCalls += 1;
        if (releaseCalls === 1) throw releaseError;
        return real.release(input);
      },
    });
    const factory = createDuoCeremonyGateFactory({
      leases: flaky,
      credentialKey: FIXTURE_DUO_CREDENTIAL_KEY,
      clock,
      scheduler,
      sessionAcquireMs: FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
      graceMs: FIXTURE_DUO_LEASE_GRACE_MS,
      pollIntervalMs: DUO_CEREMONY_LEASE_POLL_MS,
    });
    const gate = factory.openGate({
      workerId: WORKER_A,
      system: SYSTEM,
      envelopeDeadlineMonotonicMs: clock.monotonicMs() + FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
      cancelCeremony: () => undefined,
      signal: new AbortController().signal,
    });
    const ceremonyError = new Error("SSO form never rendered (fixture)");

    // (a) The thrown error must expose the ceremony's ORIGINAL error via `cause` rather than
    // silently replacing it with the release failure.
    await assert.rejects(
      gate.withCeremony(async () => { throw ceremonyError; }),
      (error: unknown) => {
        assert.ok(error instanceof DuoCeremonyReleaseFailedError);
        assert.equal(error.cause, ceremonyError, "the ceremony's original error must survive as cause");
        assert.equal(error.releaseError, releaseError, "the release failure itself is exposed too");
        assert.match(error.message, /release failed/);
        return true;
      },
    );
    assert.equal(releaseCalls, 1);

    // (b) #hold is still set (the store never confirmed the release), so the row is still `held` and
    // a second dispose()/release call retries the UPDATE instead of stranding the row for its TTL.
    assert.equal(leaseRow(database).state, "held", "the row must still be held after the failed release");
    gate.dispose();
    assert.equal(releaseCalls, 2, "a later dispose() retried the UPDATE rather than finding #hold already cleared");
    assert.equal(leaseRow(database).state, "released", "the retry actually released the row");
  });

  it("dispose(unwindingError) — the shape worker-sessions.ts's #openAndLogin uses when a login error is already in flight — carries that error as cause too", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const real = database.authority.duoCeremonyLeases;
    const releaseError = new Error("sqlite: database is locked (fixture)");
    const flaky: DuoCeremonyLeaseRepository = Object.freeze({
      acquire: (input: unknown) => real.acquire(input),
      get: (credentialKey: string) => real.get(credentialKey),
      release: () => { throw releaseError; },
    });
    const factory = createDuoCeremonyGateFactory({
      leases: flaky,
      credentialKey: FIXTURE_DUO_CREDENTIAL_KEY,
      clock,
      scheduler,
      sessionAcquireMs: FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
      graceMs: FIXTURE_DUO_LEASE_GRACE_MS,
      pollIntervalMs: DUO_CEREMONY_LEASE_POLL_MS,
    });
    const gate = factory.openGate({
      workerId: WORKER_A,
      system: SYSTEM,
      envelopeDeadlineMonotonicMs: clock.monotonicMs() + FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
      cancelCeremony: () => undefined,
      signal: new AbortController().signal,
    });
    // Get a held-but-never-released gate the SAME way §10.5 recovery does: the first terminal
    // refusal keeps #hold without ever calling leases.release — no flaky release involved yet.
    await assert.rejects(
      gate.withCeremony(async () => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", "https://app.example/");
      }),
      DuoTerminalRefusalError,
    );
    assert.ok(gate.retainedForRecovery(), "the first refusal must retain the lease");

    const loginError = new Error("login recipe failed (fixture)");
    assert.throws(
      () => { gate.dispose(loginError); },
      (error: unknown) => {
        assert.ok(error instanceof DuoCeremonyReleaseFailedError);
        assert.equal(error.cause, loginError);
        return true;
      },
    );
    assert.equal(leaseRow(database).state, "held", "still held: dispose()'s release failed and #hold was never cleared");
  });
});
