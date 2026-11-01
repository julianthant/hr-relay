import { createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { type MonotonicDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import { type BrowserSessionCloseProof, type WorkerBrowserSessionFactory, type WorkerSessionEvent, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { BrowserSessionIdSchema, FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { type TestClock, manualClock } from "../../../../src/rules/time/clock.js";
import { type RunBrowserScreenshotCapture } from "../../../../src/workflow-kit/diagnostics.js";
import { fixtureDuoCeremonyGates } from "../duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../phase1f-executor-harness.js";





export function createWorkerSessionManagerTestWorld(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  const WORKER_ID = WorkerIdSchema.parse("worker-session-fixture");

  const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");

  const RUN_FINGERPRINT = FingerprintSchema.parse("1".repeat(64));

  function sessionFactory(options: Readonly<{
    resetFailureAt?: number;
    loginFailure?: boolean;
    closeFailureAt?: number;
    omitExclusiveRelease?: boolean;
    screenshotFailure?: boolean;
    // The fake login waits for abort, reproducing a driver that never responds.
    loginHangs?: boolean;
  }> = {}): Readonly<{
    factory: WorkerBrowserSessionFactory;
    probes: () => number;
    opens: () => number;
    logins: () => number;
    resets: () => number;
    closes: () => number;
    screenshots: () => number;
  }> {
    let probes = 0;
    let opens = 0;
    let logins = 0;
    let resets = 0;
    let closes = 0;
    let screenshots = 0;
    return {
      factory: { probeProfile: async () => { probes++; },
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
            signInFingerprint: input.configFingerprint,
            profileRevision: 1,
            ...(input.browserMode === undefined ? {} : { browserMode: input.browserMode }),
            acceptDownloads: input.acceptDownloads,
            exclusive: input.exclusive,
            driver: { system: input.system },
            async screenshot() {
              screenshots += 1;
              if (options.screenshotFailure === true) throw new Error("injected screenshot persistence failure");
              return { state: "available" as const, sessionId, pageVersion: 1, observedAt: "2026-08-02T18:00:00.000Z", bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 };
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
      probes: () => probes,
      opens: () => opens,
      logins: () => logins,
      resets: () => resets,
      closes: () => closes,
      screenshots: () => screenshots,
    };
  }

  async function manager(
    harness: ReturnType<typeof sessionFactory>,
    events: WorkerSessionEvent[] = [],
    options: {
      clock?: TestClock;
      scheduler?: MonotonicDeadlineScheduler;
      browserScreenshotCapture?: RunBrowserScreenshotCapture;
    } = {},
  ): Promise<WorkerSessionManager> {
    const clock = options.clock ?? manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock,
      scheduler: options.scheduler ?? new ManualScheduler(clock),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: await fixtureDuoCeremonyGates(clock, undefined, profileFixture),
      onEvent: (event) => events.push(event),
      ...(options.browserScreenshotCapture === undefined
        ? { browserScreenshotCapture: { capture: async () => undefined } }
        : { browserScreenshotCapture: options.browserScreenshotCapture }),
    });

    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, undefined, {
      runId: "00000000-0000-4000-8000-000000000099",
      descriptorFingerprint: RUN_FINGERPRINT,
    });
    return sessions;
  }
  return { sessionFactory, manager, WORKER_ID, WORKFLOW_ID, RUN_FINGERPRINT };
}
