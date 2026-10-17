import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import type { BrowserSessionCloseProof, WorkerBrowserSessionFactory, WorkerSessionEvent } from "../../src/backend/runtime/workers/worker-sessions.js";
import { WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { BrowserSessionIdSchema, FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import type { RunBrowserScreenshotCapture } from "../../src/workflow-kit/diagnostics.js";
import { fixtureDuoCeremonyGates } from "../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../support/helpers/phase1f-executor-harness.js";

const WORKER_ID = WorkerIdSchema.parse("worker-session-fixture");
const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
const SIGNAL = new AbortController().signal;
const RUN_FINGERPRINT = FingerprintSchema.parse("1".repeat(64));
const UCPATH_REUSE = {
  system: "ucpath" as const,
  access: "read" as const,
  session: "reuse-worker" as const,
};

describe("worker browser sessions", () => {
  it("captures once before reset for successful and failed selected browser leases", async () => {
    let opens = 0;
    let screenshots = 0;
    const factory: WorkerBrowserSessionFactory = {
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
            return { state: "available" as const, sessionId, pageVersion: 1, observedAt: "2026-08-02T18:00:00.000Z", bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 };
          },
          authentication: {
            authenticate(system) {
              if (system !== input.system) {
                return Promise.reject(new Error(`${input.system} resource cannot authenticate ${system}`));
              }
              return Promise.resolve("logged-in" as const);
            },
          },
          async reset() {},
          async close(): Promise<BrowserSessionCloseProof> {
            return {
              sessionId,
              system: input.system,
              pagesClosed: true,
              contextClosed: true,
              ...(input.exclusive ? { exclusiveLeaseReleased: true as const } : {}),
            };
          },
        };
      },
    };
    const captured: Parameters<RunBrowserScreenshotCapture["capture"]>[0][] = [];
    const events: WorkerSessionEvent[] = [];
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory,
      clock,
      scheduler: new ManualScheduler(clock),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      onEvent: (event) => events.push(event),
      browserScreenshotCapture: { async capture(context) { captured.push(context); } },
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, undefined, {
      runId: "00000000-0000-4000-8000-000000000099",
      descriptorFingerprint: RUN_FINGERPRINT,
      captureBrowserScreenshots: true,
    });

    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "ok");
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => {
        throw new Error("task failure after page use");
      }),
      /task failure after page use/,
    );

    assert.equal(screenshots, 2);
    assert.deepEqual(captured.map(({ trigger }) => trigger), [{ kind: "lease-end", outcome: "succeeded" }, { kind: "lease-end", outcome: "failed" }]);
    assert.deepEqual(captured.map(({ system }) => system), ["ucpath", "ucpath"]);
  });
});
