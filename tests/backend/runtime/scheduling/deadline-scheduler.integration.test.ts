import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createWorkerSessionManagerTestWorld } from "../../../support/helpers/backend/worker-session-manager-world.js";
import assert from "node:assert/strict";
import { afterAll, describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const { sessionFactory, manager } = createWorkerSessionManagerTestWorld(profileFixtures.create);

const SIGNAL = new AbortController().signal;

const UCPATH_REUSE = {
  system: "ucpath" as const,
  access: "read" as const,
  session: "reuse-worker" as const,
};

describe("worker browser sessions", () => {

  it("preserves a task failure with its selected screenshot failure and still poison-closes", async () => {
    const harness = sessionFactory({ screenshotFailure: true });
    const sessions = await manager(harness, [], {
      browserScreenshotCapture: { async capture() {} },
    });
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => {
        throw new Error("injected task failure");
      }),
      (error: unknown) => error instanceof AggregateError
        && error.errors.some((failure: unknown) => failure instanceof Error && /injected task failure/.test(failure.message))
        && error.errors.some((failure: unknown) => failure instanceof Error && /injected screenshot persistence failure/.test(failure.message)),
    );
    assert.equal(harness.closes(), 1);
  });

  it("keeps driver use exclusive and login single-flight per worker/system", async () => {
    const harness = sessionFactory();
    const sessions = await manager(harness);
    let active = 0;
    let maximum = 0;
    let releaseFirst = (): void => undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted = (): void => undefined;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const run = (hold: boolean): Promise<string> => sessions.withDriver(
      UCPATH_REUSE,
      "prod",
      SIGNAL,
      async (driver) => {
        active += 1;
        maximum = Math.max(maximum, active);
        if (hold) {
          firstStarted();
          await firstMayFinish;
        }
        active -= 1;
        return driver.system;
      },
    );
    const first = run(true);
    await firstDidStart;
    const second = run(false);
    assert.equal(harness.opens(), 1);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), ["ucpath", "ucpath"]);
    assert.equal(maximum, 1);
    assert.equal(harness.opens(), 1);
    assert.equal(harness.logins(), 1);
    assert.equal(harness.resets(), 2);
  });

  it("poison-closes after task or reset failure and closes everything before a park", async () => {
    const taskFailureHarness = sessionFactory();
    const taskFailureSessions = await manager(taskFailureHarness);
    await assert.rejects(
      taskFailureSessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, () =>
        Promise.reject(new Error("injected task failure"))),
      /injected task failure/,
    );
    assert.deepEqual(taskFailureSessions.activeSystems(), []);
    assert.equal(taskFailureHarness.closes(), 1);

    const resetFailureHarness = sessionFactory({ resetFailureAt: 1 });
    const resetFailureSessions = await manager(resetFailureHarness);
    await assert.rejects(
      resetFailureSessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "result"),
      /injected reset failure/,
    );
    assert.deepEqual(resetFailureSessions.activeSystems(), []);
    assert.equal(resetFailureHarness.closes(), 1);

    const parkedHarness = sessionFactory();
    const parkedSessions = await manager(parkedHarness);
    await parkedSessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "result");
    await parkedSessions.closeAll("parked");
    assert.deepEqual(parkedSessions.activeSystems(), []);
    assert.equal(parkedHarness.closes(), 1);
  });

  it("waits for an active driver callback before closing sessions for a park", async () => {
    const harness = sessionFactory();
    const sessions = await manager(harness);
    let releaseOperation = (): void => undefined;
    const operationMayFinish = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let operationStarted = (): void => undefined;
    const operationDidStart = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    const inFlight = sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => {
      operationStarted();
      await operationMayFinish;
      return "result";
    });
    await operationDidStart;
    const closing = sessions.closeAll("parked");
    await Promise.resolve();
    assert.equal(harness.closes(), 0);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /cannot start while worker sessions are closing for parked/,
    );
    releaseOperation();
    assert.equal(await inFlight, "result");
    await closing;
    assert.equal(harness.closes(), 1);
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("abort-races an active callback and poison-closes its browser resource", async () => {
    const harness = sessionFactory();
    const sessions = await manager(harness);
    const controller = new AbortController();
    let operationStarted = (): void => undefined;
    const operationDidStart = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    const lease = sessions.withDriver(UCPATH_REUSE, "prod", controller.signal, async () => {
      operationStarted();
      return new Promise<string>(() => undefined);
    });
    await operationDidStart;
    controller.abort();
    await assert.rejects(lease, /driver lease was aborted during use/);
    assert.equal(harness.closes(), 1);
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("retains a fenced transaction callback through parent abort and poison-closes after settlement", async () => {
    const harness = sessionFactory();
    const sessions = await manager(harness);
    const controller = new AbortController();
    const parentFailure = new Error("parent cancelled retained transaction lease");
    let releaseOperation = (): void => undefined;
    const operationMayFinish = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let operationStarted = (): void => undefined;
    const operationDidStart = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    let leaseSettled = false;
    const lease = sessions.withTransactionDriver(
      { ...UCPATH_REUSE, access: "transaction" },
      "prod",
      controller.signal,
      async (_driver, ownership) => {
        ownership.retainAfterFence();
        operationStarted();
        await operationMayFinish;
        return "result";
      },
    ).then(
      (value) => ({ state: "fulfilled" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    ).finally(() => {
      leaseSettled = true;
    });

    await operationDidStart;
    controller.abort(parentFailure);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(leaseSettled, false);
    assert.equal(harness.closes(), 0);
    assert.deepEqual(sessions.activeSystems(), ["ucpath"]);

    releaseOperation();
    const outcome = await lease;
    assert.deepEqual(outcome, { state: "rejected", error: parentFailure });
    assert.equal(harness.closes(), 1);
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("keeps ordinary abort-race semantics before a transaction lease retains its fence", async () => {
    const harness = sessionFactory();
    const sessions = await manager(harness);
    const controller = new AbortController();
    let operationStarted = (): void => undefined;
    const operationDidStart = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    const lease = sessions.withTransactionDriver(
      { ...UCPATH_REUSE, access: "transaction" },
      "prod",
      controller.signal,
      async () => {
        operationStarted();
        return await new Promise<string>(() => undefined);
      },
    );

    await operationDidStart;
    controller.abort(new Error("parent cancelled before the durable fence"));
    await assert.rejects(lease, /parent cancelled before the durable fence/u);
    assert.equal(harness.closes(), 1);
    assert.deepEqual(sessions.activeSystems(), []);
  });

  it("retains and poisons a resource when failed login cleanup cannot prove closure", async () => {
    const harness = sessionFactory({ loginFailure: true, closeFailureAt: 1 });
    const sessions = await manager(harness);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      (error) => error instanceof AggregateError
        && error.errors.some((failure: unknown) => failure instanceof Error
          && /injected login failure/.test(failure.message))
        && error.errors.some((failure: unknown) => failure instanceof Error
          && /injected close failure/.test(failure.message)),
    );
    assert.deepEqual(sessions.activeSystems(), ["ucpath"]);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /unresolved failed-close proof/,
    );
    await sessions.closeAll("worker-stop");
    assert.deepEqual(sessions.activeSystems(), []);
    assert.equal(harness.closes(), 2);
  });

  it("refuses an OnBase close that cannot prove identity-lease release", async () => {
    const harness = sessionFactory({ omitExclusiveRelease: true });
    const sessions = await manager(harness);
    await sessions.withDriver(
      { system: "onbase", access: "read", session: "reuse-worker", exclusive: true },
      "prod",
      SIGNAL,
      async () => "result",
    );
    await assert.rejects(
      sessions.closeAll("worker-stop"),
      (error) => error instanceof AggregateError
        && error.errors.some((failure: unknown) => failure instanceof Error
          && /exclusive identity-lease release/.test(failure.message)),
    );
    assert.deepEqual(sessions.activeSystems(), ["onbase"]);
    await assert.rejects(
      sessions.withDriver(
        { system: "onbase", access: "read", session: "reuse-worker", exclusive: true },
        "prod",
        SIGNAL,
        async () => "must not run",
      ),
      /unresolved failed-close proof/,
    );
  });
});


describe("bounded browser-session acquisition", () => {
  const UCPATH_NEED = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

  it("fails the lease at timeouts.sessionAcquireMs when the driver stops responding", async () => {
    const harness = sessionFactory({ loginHangs: true });
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const sessions = await manager(harness, [], { clock, scheduler });

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert.rejects(lease, (error) => error instanceof Error
      && /exceeded its 60000ms timeouts\.sessionAcquireMs bound/.test(error.message)
      // The refusal must tell the operator which leaf to move, and must not
      // suggest lengthening the task deadline to hide a dead session.
      && /timeouts\.duoApprovalSeconds/.test(error.message)
      && /never lengthen taskMs/.test(error.message));

    // Let the acquisition reach the hung login, then expire its bound. The
    // TASK deadline is not involved: nothing here arms one.
    await new Promise((resolve) => setImmediate(resolve));
    const pending = scheduler.pending();
    assert.equal(pending.length, 1, "exactly one bound is armed: the acquisition's");
    assert.equal(pending[0].deadlineMonotonicMs, clock.monotonicMs() + FIXTURE_SESSION_ACQUIRE_MS);
    pending[0].fire();
    await rejection;

    // The bound is a REFUSAL, never a silent retry that hides a dead session.
    assert.equal(harness.opens(), 1);
    assert.equal(harness.logins(), 1);
  });

  it("leaves a healthy acquisition alone and cancels its bound", async () => {
    const harness = sessionFactory();
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const sessions = await manager(harness, [], { clock, scheduler });

    assert.equal(await sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "read"), "read");
    assert.deepEqual(scheduler.pending(), []);
    assert.equal(harness.opens(), 1);
  });
});
