import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkerSessionClosureUnprovedError } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import {
  healthyCrmDriver,
  healthyUcpathDriver,
  personLookupQueuedRun,
  sessionFactoryHarness,
} from "../../../support/helpers/phase1f-executor-harness.js";

const world = createWorkerDirectiveTestWorld();
afterEach(world.cleanup);

it.each([
  { closure: "proved", throwSpans: false },
  { closure: "unproved", throwSpans: false },
  { closure: "unproved", throwSpans: true },
])("unwinds the run when a heartbeat write throws (browser closure $closure, throwing spans $throwSpans)", async ({ closure, throwSpans }) => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const sessions = sessionFactoryHarness({
    ucpath: () => {
      const driver = healthyUcpathDriver();
      return {
        ...driver,
        async searchPersonOrg(...args: Parameters<typeof driver.searchPersonOrg>) {
          started.resolve();
          await release.promise;
          return driver.searchPersonOrg(...args);
        },
      };
    },
    crm: () => healthyCrmDriver(),
  });
  const h = await world.loopHarness({ sessions, exitWhenIdle: false });
  const { clock, database } = h.authority;
  database.authority.runs.enqueue(personLookupQueuedRun());
  const failure = new Error("synthetic heartbeat write failure");
  const closeFailure = new Error("synthetic browser close failure");
  const cancelledTaskSpanFailure = new Error("synthetic cancelled task span write failure");
  const workerEndSpanFailure = new Error("synthetic worker end span write failure");
  let claims = 0;
  const settled = runWorkerLoop({
    ...h.deps,
    emitter: {
      emit(event) {
        if (throwSpans && event.t === "span.ended") {
          if (event.kind === "task" && event.outcome === "cancelled") throw cancelledTaskSpanFailure;
          if (event.kind === "worker") throw workerEndSpanFailure;
        }
        h.deps.emitter.emit(event);
      },
    },
    sessionFactory: {
      ...sessions.factory,
      async open(input) {
        const resource = await sessions.factory.open(input);
        if (closure === "proved") return resource;
        return {
          ...resource,
          async close(closeInput) {
            await resource.close(closeInput);
            throw closeFailure;
          },
        };
      },
    },
    claimNext: (...args) => {
      claims += 1;
      return h.deps.claimNext(...args);
    },
    lifecycle: {
      ...h.deps.lifecycle,
      renewClaim: () => { throw failure; },
    },
  }).then(
    () => ({ state: "returned" as const }),
    (error: unknown) => ({ state: "failed" as const, error }),
  );

  try {
    await started.promise;
    const deadline = clock.monotonicMs() + h.deps.heartbeatIntervalMs;
    const heartbeat = h.scheduler.pending().find(timer => timer.deadlineMonotonicMs === deadline);
    assert.ok(heartbeat);
    assert.doesNotThrow(heartbeat.fire);

    const result = await settled;
    assert.equal(result.state, "failed");
    assert.ok(result.error instanceof Error);
    if (closure === "proved") {
      assert.equal(result.error.cause, failure);
    } else {
      assert.ok(result.error instanceof WorkerSessionClosureUnprovedError);
      const [heartbeatError, browserError, ...drainErrors] = z.array(z.unknown()).parse(result.error.errors);
      assert.ok(heartbeatError instanceof Error);
      assert.equal(heartbeatError.cause, failure);
      assert.ok(browserError instanceof WorkerSessionClosureUnprovedError);
      assert.ok(browserError.errors.includes(closeFailure));
      assert.deepEqual(drainErrors, throwSpans ? [cancelledTaskSpanFailure, workerEndSpanFailure] : []);
    }
    assert.ok(sessions.closeReasons().includes("poisoned"));
    if (!throwSpans) {
      assert.ok(h.emitter.events().some(event => event.t === "span.ended" && event.kind === "task" && event.outcome === "cancelled"));
      assert.ok(h.emitter.events().some(event => event.t === "span.ended" && event.kind === "worker" && event.outcome === "failed"));
    }
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
    assert.equal(claims, 1);
    assert.equal(h.scheduler.pending().length, 0);
  } finally {
    h.stop.abort();
    release.resolve();
    await settled;
  }
});

it("reports the last 32 outcomes and leaves older results in the run store", async () => {
  const h = await world.loopHarness();
  const { runs } = h.authority.database.authority;
  for (let index = 0; index < 33; index += 1) {
    runs.enqueue(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
  }
  const report = await runWorkerLoop(h.deps);
  const claimedIds = h.emitter.events().filter(event => event.t === "run.claimed").map(event => event.runId);
  assert.equal(report.stopped, "idle");
  assert.equal(claimedIds.length, 33);
  assert.deepEqual(report.outcomes, claimedIds.slice(1).map(runId => ({ state: "done", runId })));
  const [oldest] = claimedIds;
  assert.ok(oldest);
  const result = runs.get(oldest)?.lifecycle;
  assert.ok(result?.state === "terminal");
  assert.equal(result.outcome, "done");
});
