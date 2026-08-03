import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import {
  BrowserSessionIdSchema,
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
import { taskStoreRegistry } from "../../src/stores/index.js";

const WORKER_ID = WorkerIdSchema.parse("worker-session-fixture");
const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
const SIGNAL = new AbortController().signal;

function sessionFactory(options: Readonly<{
  resetFailureAt?: number;
  loginFailure?: boolean;
  closeFailureAt?: number;
  omitExclusiveRelease?: boolean;
}> = {}): Readonly<{
  factory: WorkerBrowserSessionFactory;
  opens: () => number;
  logins: () => number;
  resets: () => number;
  closes: () => number;
}> {
  let opens = 0;
  let logins = 0;
  let resets = 0;
  let closes = 0;
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
          acceptDownloads: input.acceptDownloads,
          exclusive: input.exclusive,
          driver: { system: input.system },
          authentication: {
            authenticate(system) {
              if (system !== input.system) {
                return Promise.reject(new Error(`${input.system} resource cannot authenticate ${system}`));
              }
              logins += 1;
              if (options.loginFailure === true) {
                return Promise.reject(new Error("injected login failure"));
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
  };
}

function manager(
  harness: ReturnType<typeof sessionFactory>,
  events: WorkerSessionEvent[] = [],
): WorkerSessionManager {
  return new WorkerSessionManager({
    workerId: WORKER_ID,
    workflowId: WORKFLOW_ID,
    stores: taskStoreRegistry,
    factory: harness.factory,
    clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
    onEvent: (event) => events.push(event),
  });
}

const UCPATH_REUSE = {
  system: "ucpath" as const,
  access: "read" as const,
  session: "reuse-worker" as const,
};

describe("worker browser sessions", () => {
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
