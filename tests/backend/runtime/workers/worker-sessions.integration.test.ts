import { BrowserSessionClosureUnprovedError } from "../../../../src/workflow-kit/session.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { createWorkerSessionManagerTestWorld } from "../../../support/helpers/backend/worker-session-manager-world.js";

import { default as assert } from "node:assert/strict";




import { describe, it } from "vitest";


import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { type BrowserDeadlineScheduler } from "../../../../src/backend/runtime/browser/browser-session-factory.js";

import { type WorkerBrowserSessionFactory, type WorkerSessionEvent } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { WorkerSessionManager, WorkerSessionClosureUnprovedError } from "../../../../src/backend/runtime/workers/worker-sessions.js";



import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fixtureDuoCeremonyGate, fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";

{

const CLOCK = manualClock(new Date("2026-08-03T09:00:00.000Z"));
const WORKER_ID = WorkerIdSchema.parse("person-lookup-worker-1");
const FINGERPRINT = FingerprintSchema.parse("ab".repeat(32));
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

const NEVER_SCHEDULER: BrowserDeadlineScheduler = {
  schedule: () => ({ cancel: () => undefined }),
};

const { fakeLauncher, recordingBindings, withTempRuntime, factoryFor } =
  createBrowserSessionFactoryFixtures(CLOCK, SESSION_ID, NEVER_SCHEDULER);

const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");

describe("worker browser session factory", () => {

  it("retains custody after the real factory launcher rejects without a context", async () => {
    await withTempRuntime(async ({ config }) => {
      const cause = new Error("uncertain launch failure");
      let launches = 0;
      const factory = factoryFor(config, {
        ...fakeLauncher(),
        launcher: { launch: async () => { launches += 1; throw cause; } },
      }, recordingBindings());
      const manager = new WorkerSessionManager({
        workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry, factory,
        clock: CLOCK, scheduler: new ManualScheduler(CLOCK),
        acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS, duoCeremony: await fixtureDuoCeremonyGates(CLOCK),
      });
      manager.bindRunConfigFingerprint(FINGERPRINT);
      const acquire = () => manager.withDriver(
        { system: "ucpath", access: "read", session: "reuse-worker" }, "prod",
        new AbortController().signal, async () => assert.fail("unlaunched context cannot run"),
      );
      await assert.rejects(acquire(), error => error instanceof AggregateError
        && error.cause === cause && error.errors.includes(cause) && /closure is unproved/.test(error.message));
      await assert.rejects(manager.closeAll("worker-stop"), WorkerSessionClosureUnprovedError);
      await assert.rejects(manager.closeAll("worker-stop"), WorkerSessionClosureUnprovedError);
      await assert.rejects(acquire());
      await assert.rejects(factory.open({
        workerId: WORKER_ID, workflowId: WORKFLOW_ID, system: "ucpath", instance: "prod",
        configFingerprint: FINGERPRINT, acceptDownloads: false, exclusive: false,
        signal: new AbortController().signal, duoCeremony: await fixtureDuoCeremonyGate("ucpath", WORKER_ID, CLOCK),
      }));
      assert.equal(launches, 1, "uncertain profile stays reserved");
    });
  });

  it("poisons the manager's ownership when a failed setup cannot prove closure", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ emitCloseEvent: false });
      const factory = factoryFor(
        config,
        harness,
        recordingBindings(),
        NEVER_SCHEDULER,
        protectedSecretSource(),
      );
      const manager = new WorkerSessionManager({
        workerId: WORKER_ID,
        workflowId: WORKFLOW_ID,
        stores: taskStoreRegistry,
        // The store's provider rejects (no credential); cleanup then cannot be
        // proven because this context never announces its close.
        factory,
        clock: CLOCK,
        scheduler: new ManualScheduler(CLOCK),
        acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
        duoCeremony: await fixtureDuoCeremonyGates(CLOCK),
      });
      manager.bindRunConfigFingerprint(FINGERPRINT);
      await assert.rejects(
        manager.withDriver(
          { system: "ucpath", access: "read", session: "reuse-worker" },
          "prod",
          new AbortController().signal,
          async () => "must not run",
        ),
        (error: unknown) => error instanceof AggregateError
          && error.errors.some((failure: unknown) => failure instanceof Error
            && /ucpathUserId is missing/.test(failure.message))
          && error.errors.some((failure: unknown) => failure instanceof Error
            && /never emitted its context close event/.test(failure.message)),
      );
      assert.deepEqual(manager.activeSystems(), ["ucpath"], "an unprovable cleanup stays owned");
      await assert.rejects(
        manager.withDriver(
          { system: "ucpath", access: "read", session: "reuse-worker" },
          "prod",
          new AbortController().signal,
          async () => "must not run",
        ),
        /unresolved failed-close proof/,
      );
    });
  });
});
}

{

const { WORKER_ID, WORKFLOW_ID, RUN_FINGERPRINT, sessionFactory, manager } = createWorkerSessionManagerTestWorld();

const SIGNAL = new AbortController().signal;
const OTHER_FINGERPRINT = FingerprintSchema.parse("2".repeat(64));

const UCPATH_REUSE = {
  system: "ucpath" as const,
  access: "read" as const,
  session: "reuse-worker" as const,
};

describe("worker browser sessions", () => {

  it("proves an authored fresh boundary closes before starting the replacement", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = await manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(
      { ...UCPATH_REUSE, session: "fresh" },
      "prod",
      SIGNAL,
      async () => "second",
    );
    assert.equal(harness.opens(), 2);
    const relevant = events.filter(({ type }) => type !== "browser-session:reset");
    assert.deepEqual(relevant.map(({ type }) => type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ]);
    assert.equal(
      relevant[1]?.type === "browser-session:close" ? relevant[1].reason : undefined,
      "fresh-boundary",
    );
    assert.notEqual(relevant[0]?.sessionId, relevant[2]?.sessionId);
  });

  it("requires a bound run config fingerprint before any driver lease", async () => {
    const harness = sessionFactory();
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(),
    });
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /requires the claimed run's bound config fingerprint/,
    );
    assert.equal(harness.opens(), 0);
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    assert.throws(
      () => sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT),
      /already has a bound run config fingerprint/,
    );
    sessions.releaseRunConfigFingerprint();
    assert.throws(
      () => sessions.releaseRunConfigFingerprint(),
      /no bound run config fingerprint to release/,
    );
  });

  it("reuses only on an exact fingerprint match and proves the boundary on drift", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = await manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "same-run-reuse");
    assert.equal(harness.opens(), 1);

    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "next-run");
    assert.equal(harness.opens(), 2);
    assert.equal(harness.logins(), 2);
    const relevant = events.filter(({ type }) => type !== "browser-session:reset");
    assert.deepEqual(relevant.map(({ type }) => type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ]);
    assert.equal(
      relevant[1]?.type === "browser-session:close" ? relevant[1].reason : undefined,
      "fresh-boundary",
    );
    assert.notEqual(relevant[0]?.sessionId, relevant[2]?.sessionId);
  });

  it("treats a changed resolved instance as identity drift, not silent reuse", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = await manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "prod-run");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "test", SIGNAL, async () => "test-run");
    assert.equal(harness.opens(), 2);
    const closes = events.filter((event) => event.type === "browser-session:close");
    assert.deepEqual(closes.map((event) => event.reason), ["fresh-boundary"]);
  });

  it("treats a changed browser presentation as identity drift, not silent reuse", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = await manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "headless-run");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, "headed");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "headed-run");
    assert.equal(harness.opens(), 2);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["fresh-boundary"],
    );
  });

  it("admits a legacy headless resource only at the configured default, never for a headed run", async () => {
    const harness = sessionFactory();
    const legacy: WorkerBrowserSessionFactory = { probeProfile: async () => undefined,
      async open(input) {
        const resource = await harness.factory.open(input);
        const { browserMode: _browserMode, ...withoutMode } = resource;
        return withoutMode;
      },
    };
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: legacy,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "legacy-headless");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, "headed");
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
    assert.equal(harness.opens(), 2, "headed identity drift must force a fresh acquisition before refusing its missing echo");
  });

  it("refuses a factory resource that echoes a different fingerprint", async () => {
    const harness = sessionFactory();
    const forging: WorkerBrowserSessionFactory = { probeProfile: async () => undefined,
      async open(input) {
        const resource = await harness.factory.open(input);
        return { ...resource, configFingerprint: OTHER_FINGERPRINT };
      },
    };
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: forging,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
  });
});

describe("bounded browser-session acquisition", () => {
  const UCPATH_NEED = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

  it("poison-closes a session whose non-cooperative login lands after the bound expired", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();

    const stubborn: WorkerBrowserSessionFactory = { probeProfile: async () => undefined,
      async open(input) {
        const resource = await base.factory.open(input);
        return {
          ...resource,
          authentication: {
            async authenticate(system: typeof input.system) {
              await gate;
              return resource.authentication.authenticate(system, {});
            },
          },
        };
      },
    };
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const events: WorkerSessionEvent[] = [];
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: stubborn,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sessions.activeSystems(), []);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["poisoned"],
    );
  });

  it("shares one stale recovery claim and acquisition deadline across the Duo profile retry", async () => {
    const base = sessionFactory();
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const claims: (() => boolean)[] = [];
    const budgets: number[] = [];
    let attempts = 0;
    const factory: WorkerBrowserSessionFactory = { probeProfile: async () => undefined,
      discardProfile: async () => ({ profileDirectory: "/fixture/profile" }),
      open: async input => {
        assert.ok(input.claimStaleRequestRecovery);
        assert.ok(input.acquisitionRemainingMs);
        claims.push(input.claimStaleRequestRecovery);
        budgets.push(input.acquisitionRemainingMs());
        const resource = await base.factory.open(input);
        return { ...resource, authentication: { authenticate: async () => {
          if (attempts++ === 0) {
            assert.equal(input.claimStaleRequestRecovery?.(), true);
            clock.advanceMonotonic(100);
            throw new DuoTerminalRefusalError("ucpath", "fixture refusal", "https://duosecurity.com/");
          }
          assert.equal(input.claimStaleRequestRecovery?.(), false);
          return "logged-in";
        } } };
      },
    };
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry, factory, clock,
      scheduler: new ManualScheduler(clock), acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: { openGate: () => ({
        withCeremony: async () => { throw new Error("unused fixture ceremony"); },
        retainedForRecovery: () => true, dispose: () => undefined,
      }) },
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => undefined);
    assert.equal(claims.length, 2);
    assert.equal(claims[0], claims[1]);
    assert.deepEqual(budgets, [FIXTURE_SESSION_ACQUIRE_MS, FIXTURE_SESSION_ACQUIRE_MS - 100]);
    await sessions.closeAll("worker-stop");
  });

  it("propagates a login diagnostic aggregate without poisoning proved closure", async () => {
    const base = sessionFactory();
    const failure = new AggregateError([new Error("login failed"), new Error("diagnostic failed")], "operation failed");
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry,
      factory: { probeProfile: async () => undefined, open: async input => ({ ...await base.factory.open(input),
        authentication: { authenticate: async () => { throw failure; } } }) },
      clock, scheduler: new ManualScheduler(clock), acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await assert.rejects(sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => assert.fail("login failed")), error => error === failure);
    assert.equal(base.closes(), 1);
    await sessions.closeAll("worker-stop");
    await sessions.closeAll("worker-stop");
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("allows shutdown while pending login settles with an aggregate and proved closure", async () => {
    const base = sessionFactory();
    const failure = new AggregateError([new Error("login failed"), new Error("diagnostic failed")], "operation failed");
    let rejectLogin: (error: unknown) => void = () => assert.fail("login has not started");
    let loginStarted: () => void = () => undefined;
    const started = new Promise<void>(resolve => { loginStarted = resolve; });
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry,
      factory: { probeProfile: async () => undefined, open: async input => ({ ...await base.factory.open(input), authentication: {
        authenticate: () => new Promise<never>((_resolve, reject) => { rejectLogin = reject; loginStarted(); }),
      } }) }, clock, scheduler: new ManualScheduler(clock), acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    const acquisition = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => assert.fail("login failed"));
    const rejected = assert.rejects(acquisition, error => error === failure);
    await started;
    const closing = sessions.closeAll("worker-stop");
    rejectLogin(failure);
    await rejected;
    await closing;
    assert.equal(base.closes(), 1);
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("awaits failed acquisition cleanup before closeAll returns", async () => {
    const base = sessionFactory({ loginHangs: true });
    let releaseCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    let closureProved = false;
    const factory: WorkerBrowserSessionFactory = { probeProfile: async () => undefined,
      open: async input => {
        const resource = await base.factory.open(input);
        return { ...resource, close: async closeInput => {
          await cleanup;
          const proof = await resource.close(closeInput);
          closureProved = true;
          return proof;
        } };
      },
    };
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry, factory,
      clock, scheduler, acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => undefined);
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise(resolve => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;
    let shutdownCompleted = false;
    const shutdown = sessions.closeAll("worker-stop").then(() => { shutdownCompleted = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shutdownCompleted, false);
    assert.equal(closureProved, false);
    releaseCleanup?.();
    await shutdown;
    assert.equal(closureProved, true);
    assert.equal(base.closes(), 1);
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("bounds pending acquisition closure, retains its failure and still cleans a late resource", async () => {
    const base = sessionFactory();
    let releaseOpen: (() => void) | undefined;
    const opened = new Promise<void>(resolve => { releaseOpen = resolve; });
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry,
      factory: { probeProfile: async () => undefined, open: async input => {
        const resource = await base.factory.open(input);
        await opened;
        return resource;
      } }, clock, scheduler, acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => assert.fail("expired acquisition must not run"));
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise(resolve => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    const shutdown = sessions.closeAll("worker-stop");
    const shutdownFailure = assert.rejects(shutdown, error => error instanceof AggregateError
      && error.errors.some(value => value instanceof Error && /closure is unproved/.test(value.message)));
    await new Promise(resolve => setImmediate(resolve));
    const pending = scheduler.pending();
    assert.equal(pending.length, 1, "pending acquisition closure must arm a bound");
    assert.equal(pending[0].deadlineMonotonicMs, clock.monotonicMs() + FIXTURE_SESSION_ACQUIRE_MS);
    pending[0].fire();
    await shutdownFailure;
    await assert.rejects(sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => undefined), /closure is unproved/);

    releaseOpen?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise(resolve => setImmediate(resolve));
    assert.equal(base.opens(), 1);
    assert.equal(base.closes(), 1, "the late resource must still prove its own cleanup");
    assert.deepEqual(sessions.activeSystems(), []);
    await assert.rejects(sessions.closeAll("worker-stop"), error => error instanceof AggregateError
      && error.errors.some(value => value instanceof Error && /closure is unproved/.test(value.message)));
  });

  it("retains failed factory cleanup after its acquisition promise has settled", async () => {
    const failure = new BrowserSessionClosureUnprovedError([new Error("launch failed"), new Error("closure unproved")], "setup cleanup failed");
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID, workflowId: WORKFLOW_ID, stores: taskStoreRegistry,
      factory: { probeProfile: async () => undefined, open: async () => { throw failure; } }, clock, scheduler: new ManualScheduler(clock),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS, duoCeremony: await fixtureDuoCeremonyGates(clock),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await assert.rejects(sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => undefined), error => error === failure);
    await new Promise(resolve => setImmediate(resolve));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(sessions.closeAll("worker-stop"), error => error instanceof WorkerSessionClosureUnprovedError
        && error.name === "WorkerSessionClosureUnprovedError" && error.errors.includes(failure));
    }
    await assert.rejects(sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => undefined), error => error === failure);
  });

  it("lets an abandoned acquisition run its OWN proven cleanup when it is cooperative", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();
    const slowOpen: WorkerBrowserSessionFactory = { probeProfile: async () => undefined,
      async open(input) {
        const resource = await base.factory.open(input);
        await gate;
        return resource;
      },
    };
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const events: WorkerSessionEvent[] = [];
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: slowOpen,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    // The provider refuses to authenticate under an aborted signal, so
    // `#openAndLogin` proved its own close; nothing is left owned or leaked.
    assert.deepEqual(sessions.activeSystems(), []);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["login-failed"],
    );
  });

  it("refuses to be built without a positive acquisition bound", async () => {
    const harness = sessionFactory();
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    await assert.rejects(async () => new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock,
      scheduler: new ManualScheduler(clock),
      acquireDeadlineMs: 0,
      duoCeremony: await fixtureDuoCeremonyGates(clock),
    }));
  });
});
}
