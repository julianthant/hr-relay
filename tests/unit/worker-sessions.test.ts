import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import type { TestClock } from "../../src/domain/clock.js";
import type { MonotonicDeadlineScheduler } from "../../src/core/deadline-scheduler.js";
import {
  BrowserSessionIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../src/domain/ids.js";
import {
  WorkerSessionManager,
} from "../../src/core/worker-sessions.js";
import type {
  BrowserSessionCloseProof,
  WorkerBrowserSessionFactory,
  WorkerSessionEvent,
} from "../../src/core/worker-sessions.js";
import type { RunBrowserScreenshotCapture } from "../../src/base/diagnostics.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "./fixtures/phase1f-executor-harness.js";

const WORKER_ID = WorkerIdSchema.parse("worker-session-fixture");
const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
const SIGNAL = new AbortController().signal;
const RUN_FINGERPRINT = FingerprintSchema.parse("1".repeat(64));
const OTHER_FINGERPRINT = FingerprintSchema.parse("2".repeat(64));

function sessionFactory(options: Readonly<{
  resetFailureAt?: number;
  loginFailure?: boolean;
  closeFailureAt?: number;
  omitExclusiveRelease?: boolean;
  screenshotFailure?: boolean;
  /**
   * A driver that stops responding: `authenticate` never settles until the
   * caller's signal aborts. This is the live exit run's CRM failure — every
   * step inside the login recipe is individually bounded, but the CHAIN was
   * not, so nothing surfaced for 262.9s.
   */
  loginHangs?: boolean;
}> = {}): Readonly<{
  factory: WorkerBrowserSessionFactory;
  opens: () => number;
  logins: () => number;
  resets: () => number;
  closes: () => number;
  screenshots: () => number;
}> {
  let opens = 0;
  let logins = 0;
  let resets = 0;
  let closes = 0;
  let screenshots = 0;
  return {
    factory: {
      async open(input) {
        opens += 1;
        const sessionId = BrowserSessionIdSchema.parse(
          `00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`,
        );
        return {
          sessionId,
          system: input.system,
          ...(input.instance === undefined ? {} : { instance: input.instance }),
          configFingerprint: input.configFingerprint,
          ...(input.browserMode === undefined ? {} : { browserMode: input.browserMode }),
          acceptDownloads: input.acceptDownloads,
          exclusive: input.exclusive,
          driver: { system: input.system },
          async screenshot() {
            screenshots += 1;
            if (options.screenshotFailure === true) throw new Error("injected screenshot persistence failure");
            return { bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 };
          },
          authentication: {
            authenticate(system, authOptions) {
              if (system !== input.system) {
                return Promise.reject(new Error(`${input.system} resource cannot authenticate ${system}`));
              }
              logins += 1;
              if (options.loginFailure === true) {
                return Promise.reject(new Error("injected login failure"));
              }
              if (options.loginHangs === true) {
                // Settles ONLY when someone aborts it. A cooperative recipe
                // rejects on the acquisition signal; a wedged one never would,
                // and the manager's race is what bounds that case.
                return new Promise<"logged-in">((_resolve, reject) => {
                  authOptions.signal?.addEventListener(
                    "abort",
                    () => reject(new Error("the hung login observed its abort")),
                    { once: true },
                  );
                });
              }
              return Promise.resolve("logged-in" as const);
            },
          },
          async reset() {
            resets += 1;
            if (resets === options.resetFailureAt) throw new Error("injected reset failure");
          },
          async close(): Promise<BrowserSessionCloseProof> {
            closes += 1;
            if (closes === options.closeFailureAt) throw new Error("injected close failure");
            return {
              sessionId,
              system: input.system,
              pagesClosed: true,
              contextClosed: true,
              ...(input.exclusive && options.omitExclusiveRelease !== true
                ? { exclusiveLeaseReleased: true as const }
                : {}),
            };
          },
        };
      },
    },
    opens: () => opens,
    logins: () => logins,
    resets: () => resets,
    closes: () => closes,
    screenshots: () => screenshots,
  };
}

function manager(
  harness: ReturnType<typeof sessionFactory>,
  events: WorkerSessionEvent[] = [],
  options: {
    clock?: TestClock;
    scheduler?: MonotonicDeadlineScheduler;
    browserScreenshotCapture?: RunBrowserScreenshotCapture;
    captureBrowserScreenshots?: boolean;
  } = {},
): WorkerSessionManager {
  const clock = options.clock ?? manualClock(new Date("2026-08-02T18:00:00.000Z"));
  const sessions = new WorkerSessionManager({
    workerId: WORKER_ID,
    workflowId: WORKFLOW_ID,
    stores: taskStoreRegistry,
    factory: harness.factory,
    clock,
    scheduler: options.scheduler ?? new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: fixtureDuoCeremonyGates(clock),
    onEvent: (event) => events.push(event),
    ...(options.browserScreenshotCapture === undefined
      ? {}
      : { browserScreenshotCapture: options.browserScreenshotCapture }),
  });
  // Stand-in for the worker loop's per-run D116 bind.
  sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, undefined, {
    runId: "00000000-0000-4000-8000-000000000099",
    descriptorFingerprint: RUN_FINGERPRINT,
    ...(options.captureBrowserScreenshots === undefined
      ? {}
      : { captureBrowserScreenshots: options.captureBrowserScreenshots }),
  });
  return sessions;
}

const UCPATH_REUSE = {
  system: "ucpath" as const,
  access: "read" as const,
  session: "reuse-worker" as const,
};

describe("worker browser sessions", () => {
  it("captures once before reset for successful and failed selected browser leases", async () => {
    const harness = sessionFactory();
    const captured: Parameters<RunBrowserScreenshotCapture["capture"]>[0][] = [];
    const sessions = manager(harness, [], {
      captureBrowserScreenshots: true,
      browserScreenshotCapture: { async capture(context) { captured.push(context); } },
    });

    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "ok");
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => {
        throw new Error("task failure after page use");
      }),
      /task failure after page use/,
    );

    assert.equal(harness.screenshots(), 2);
    assert.deepEqual(captured.map(({ leaseOutcome }) => leaseOutcome), ["succeeded", "failed"]);
    assert.deepEqual(captured.map(({ system }) => system), ["ucpath", "ucpath"]);
  });

  it("does not capture a historical or explicitly disabled browser lease", async () => {
    const harness = sessionFactory();
    const captured: unknown[] = [];
    const sessions = manager(harness, [], {
      captureBrowserScreenshots: false,
      browserScreenshotCapture: { async capture(context) { captured.push(context); } },
    });
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "ok");
    assert.equal(harness.screenshots(), 0);
    assert.deepEqual(captured, []);
  });

  it("preserves a task failure with its selected screenshot failure and still poison-closes", async () => {
    const harness = sessionFactory({ screenshotFailure: true });
    const sessions = manager(harness, [], {
      captureBrowserScreenshots: true,
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
    const sessions = manager(harness);
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

  it("proves an authored fresh boundary closes before starting the replacement", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
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

  it("poison-closes after task or reset failure and closes everything before a park", async () => {
    const taskFailureHarness = sessionFactory();
    const taskFailureSessions = manager(taskFailureHarness);
    await assert.rejects(
      taskFailureSessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, () =>
        Promise.reject(new Error("injected task failure"))),
      /injected task failure/,
    );
    assert.deepEqual(taskFailureSessions.activeSystems(), []);
    assert.equal(taskFailureHarness.closes(), 1);

    const resetFailureHarness = sessionFactory({ resetFailureAt: 1 });
    const resetFailureSessions = manager(resetFailureHarness);
    await assert.rejects(
      resetFailureSessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "result"),
      /injected reset failure/,
    );
    assert.deepEqual(resetFailureSessions.activeSystems(), []);
    assert.equal(resetFailureHarness.closes(), 1);

    const parkedHarness = sessionFactory();
    const parkedSessions = manager(parkedHarness);
    await parkedSessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "result");
    await parkedSessions.closeAll("parked");
    assert.deepEqual(parkedSessions.activeSystems(), []);
    assert.equal(parkedHarness.closes(), 1);
  });

  it("waits for an active driver callback before closing sessions for a park", async () => {
    const harness = sessionFactory();
    const sessions = manager(harness);
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
    const sessions = manager(harness);
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
    const sessions = manager(harness);
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
    const sessions = manager(harness);
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
    const sessions = manager(harness);
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

  it("requires a bound run config fingerprint before any driver lease (D116)", async () => {
    const harness = sessionFactory();
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(),
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

  it("reuses only on an exact fingerprint match and proves the boundary on drift (D116)", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "same-run-reuse");
    assert.equal(harness.opens(), 1);

    // The next run resolves a DIFFERENT config fingerprint: the old context is
    // closed with proof before a replacement authenticates — never reused.
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

  it("treats a changed resolved instance as identity drift, not silent reuse (D116)", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
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
    const sessions = manager(harness, events);
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

  it("refuses a factory resource that echoes a different fingerprint (D116)", async () => {
    const harness = sessionFactory();
    const forging: WorkerBrowserSessionFactory = {
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
      duoCeremony: fixtureDuoCeremonyGates(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
  });

  it("refuses an OnBase close that cannot prove identity-lease release", async () => {
    const harness = sessionFactory({ omitExclusiveRelease: true });
    const sessions = manager(harness);
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

/**
 * D125 — session acquisition is bounded SEPARATELY from the task that wants
 * a driver.
 *
 * The Phase-1 live exit run (`pl-000619-4ebf`, 2026-08-04) spent **262.9s**
 * inside one `withDriver` when the CRM browser died: `factory.open` succeeded,
 * the login recipe then chained a series of individually-bounded steps, and
 * the only bound reaching this code was the interpreter's whole-task deadline
 * — which must stay long enough for the real read (UCPath person-org ~22s,
 * Kuali fill→save→reload→verify 8–10s per cycle). Claim expiry surfaced the
 * dead session before the task deadline did.
 */
describe("bounded browser-session acquisition (D125)", () => {
  const UCPATH_NEED = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

  it("fails the lease at timeouts.sessionAcquireMs when the driver stops responding", async () => {
    const harness = sessionFactory({ loginHangs: true });
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const sessions = manager(harness, [], { clock, scheduler });

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

  it("poison-closes a session whose non-cooperative login lands after the bound expired", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();
    // A login that IGNORES its abort signal — the case the race exists for. It
    // is already past `defineWorkerSessionProvider`'s pre-flight abort check
    // when the bound expires, so it lands a live, authenticated session on a
    // lease that has already given up on it.
    const stubborn: WorkerBrowserSessionFactory = {
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
      duoCeremony: fixtureDuoCeremonyGates(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    // Now the abandoned acquisition completes. Its session is uncertain by
    // construction, so it is poison-closed rather than inherited as a warm
    // reuse by the next lease.
    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sessions.activeSystems(), []);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["poisoned"],
    );
  });

  it("lets an abandoned acquisition run its OWN proven cleanup when it is cooperative", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();
    const slowOpen: WorkerBrowserSessionFactory = {
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
      duoCeremony: fixtureDuoCeremonyGates(clock),
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

  it("leaves a healthy acquisition alone and cancels its bound", async () => {
    const harness = sessionFactory();
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const sessions = manager(harness, [], { clock, scheduler });

    assert.equal(await sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "read"), "read");
    assert.deepEqual(scheduler.pending(), []);
    assert.equal(harness.opens(), 1);
  });

  it("refuses to be built without a positive acquisition bound", () => {
    const harness = sessionFactory();
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    assert.throws(() => new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock,
      scheduler: new ManualScheduler(clock),
      acquireDeadlineMs: 0,
      duoCeremony: fixtureDuoCeremonyGates(clock),
    }));
  });
});
