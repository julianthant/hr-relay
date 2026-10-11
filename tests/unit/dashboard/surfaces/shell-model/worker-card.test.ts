
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { WorkerLeaseRecordSchema } from "../../../../../src/models/run/worker.js";
import { workerCardOf } from "../../../../../src/backend/runs/projections/worker-cards.js";
import { browserSessionOfSpanPath } from "../../../../../src/backend/runs/lifecycle/support.js";
import {
  WORKER_STOP_REASON_LABEL,
  WORKER_TONE,
  canStopWorker,
  workerDirectiveNote,
  workerElapsedSeconds,
} from "../../../../../src/dashboard/surfaces/shell/shell-model.js";

const STARTED = "2026-08-20T16:00:00.000Z";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "11111111-1111-4111-8111-111111111111";
const TRACE = "pl-160500-1111";

function leaseOf(overrides: Readonly<Record<string, unknown>> = {}): ReturnType<typeof WorkerLeaseRecordSchema.parse> {
  return WorkerLeaseRecordSchema.parse({
    workerId: "person-lookup-worker-1",
    workflow: "person-lookup",
    browserSystems: ["ucpath"],
    processId: 1234,
    leaseGeneration: 1, controlRevision: 1,
    lifecycle: { state: "idle", startedAt: STARTED, heartbeatAt: "2026-08-20T16:00:30.000Z" },
    control: { directive: "run", requestedAt: STARTED, requestedBy: "local-operator" },
    version: 5,
    createdAt: STARTED,
    updatedAt: "2026-08-20T16:00:30.000Z",
    ...overrides,
  });
}

const NO_TRACE = (): undefined => undefined;
describe("the card the projector composes from a lease", () => {
  it("accepts the descriptor browser systems the worker persisted at launch", () => {
    const parsed = WorkerLeaseRecordSchema.safeParse({
      ...leaseOf(),
      browserSystems: ["kuali", "ucpath"],
    });

    assert.equal(parsed.success, true);
  });

  it("refuses a lease missing its required launch-time browser systems", () => {
    assert.throws(() => leaseOf({ browserSystems: undefined }));
  });

  it("reads identity, phase, directive and the CAS basis off the lease", () => {
    const card = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "busy", startedAt: STARTED, heartbeatAt: STARTED, runId: RUN },
        control: { directive: "pause", requestedAt: STARTED, requestedBy: "local-operator" },
      }),
      fold: { revision: 12, browsers: [{ sessionId: SESSION, system: "ucpath", openedAt: STARTED }] },
      resolveTrace: () => TRACE,
    });
    assert.equal(card.workflowId, "person-lookup");
    assert.equal(card.state, "working");
    // The pending pause travels BESIDE the phase and never as it: this worker
    // is running a real item and the card may not say otherwise.
    assert.equal(card.directive, "pause");
    assert.equal(card.leaseVersion, 5);
    assert.equal(card.revision, 12);
    assert.deepEqual(card.currentRun, { state: "present", runId: RUN, traceId: TRACE });
    assert.equal(card.browsers.length, 1);
  });

  it("says WHICH run it holds when the spans for it have not been folded", () => {

    const card = workerCardOf({
      lease: leaseOf({ lifecycle: { state: "busy", startedAt: STARTED, heartbeatAt: STARTED, runId: RUN } }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });
    assert.equal(card.currentRun.state, "absent");
    assert.match(
      card.currentRun.state === "absent" ? card.currentRun.reason : "",
      /worker holds run 11111111-1111-4111-8111-111111111111/,
    );
    // A lease with no spans folded nothing; the minimum revision is not a
    // count of events that happened.
    assert.equal(card.revision, 1);
  });

  it("splits a settled lease by its recorded reason and drops every tile", () => {
    const held = { revision: 4, browsers: [{ sessionId: SESSION, system: "ucpath", openedAt: STARTED }] };
    const stopped = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: "2026-08-20T16:05:00.000Z", reason: "operator" },
        control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" },
      }),
      fold: held,
      resolveTrace: NO_TRACE,
    });
    const crashed = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: "2026-08-20T16:05:00.000Z", reason: "crashed" },
        control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" },
      }),
      fold: held,
      resolveTrace: NO_TRACE,
    });
    assert.equal(stopped.state, "stopped");
    assert.equal(crashed.state, "failed");
    assert.equal(crashed.stopReason, "crashed");
    assert.equal(crashed.endedAt, "2026-08-20T16:05:00.000Z");
    // Its process is gone; the sessions the fold still shows open are the
    // absence of a close event, not a resource anybody holds.
    assert.deepEqual(stopped.browsers, []);
    assert.deepEqual(crashed.browsers, []);
  });

  it("calls a lease that has taken its generation and reported nothing `starting`", () => {
    const card = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "starting", startedAt: STARTED },
        browserSystems: ["ucpath", "crm"],
      }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });
    // The demo's own rule: a daemon that is alive and has not reported a phase
    // is not idle, and calling it idle misreads capacity.
    assert.equal(card.state, "starting");
    assert.deepEqual(card.currentRun, { state: "absent", reason: "no claimed run" });
    assert.deepEqual(Reflect.get(card, "browserRequirements"), {
      state: "present",
      systems: ["ucpath", "crm"],
    });
    assert.deepEqual(card.browsers, [], "a required browser is not reported as open before its span starts");
  });
});

describe("the browser span path is read, never guessed", () => {
  it("reads the system and session id the emitter composed", () => {
    assert.deepEqual(
      browserSessionOfSpanPath(`worker/person-lookup/person-lookup-worker-1/browser:ucpath#${SESSION}`, "ucpath"),
      { sessionId: SESSION, system: "ucpath" },
    );
  });

  it("refuses a path that names no session, rather than folding a guessed one", () => {

    assert.throws(
      () => browserSessionOfSpanPath("worker/person-lookup-worker-1/ucpath"),
      /does not name a session/,
    );
  });

  it("refuses a span whose declared system disagrees with its own path", () => {
    assert.throws(
      () => browserSessionOfSpanPath(`worker/person-lookup/w1/browser:ucpath#${SESSION}`, "crm"),
      /declares system crm while its own path names ucpath/,
    );
  });
});

describe("the words the card carries", () => {
  const live = workerCardOf({
    lease: leaseOf(),
    fold: undefined,
    resolveTrace: NO_TRACE,
  });

  it("states a standing directive beside the state word, never as it", () => {
    assert.equal(workerDirectiveNote(live), undefined);
    const pausing = workerCardOf({
      lease: leaseOf({ control: { directive: "pause", requestedAt: STARTED, requestedBy: "local-operator" } }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });
    assert.equal(workerDirectiveNote(pausing), "Pausing after this item");

    const settled = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: STARTED, reason: "shutdown" },
        control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" },
      }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });
    assert.equal(workerDirectiveNote(settled), undefined);
  });

  it("offers Stop only where a directive can still land", () => {
    assert.equal(canStopWorker(live), true);
    const stopping = workerCardOf({
      lease: leaseOf({ control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" } }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });
    assert.equal(canStopWorker(stopping), false);
    const dead = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: STARTED, reason: "lease-expired" },
        control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" },
      }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });
    assert.equal(canStopWorker(dead), false);
    assert.equal(dead.state, "failed");
  });

  it("counts a settled worker's uptime to its END, never to now", () => {
    const dead = workerCardOf({
      lease: leaseOf({
        lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: "2026-08-20T16:01:00.000Z", reason: "operator" },
        control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" },
      }),
      fold: undefined,
      resolveTrace: NO_TRACE,
    });

    assert.equal(workerElapsedSeconds(dead, "2026-08-20T18:00:00.000Z"), 60);
    assert.equal(workerElapsedSeconds(live, "2026-08-20T16:00:45.000Z"), 45);
  });

  it("has a word for every state and every recorded stop reason", () => {

    const labels = Object.values(WORKER_TONE).map(({ label }) => label);
    assert.equal(new Set(labels).size, labels.length);
    const reasons = Object.values(WORKER_STOP_REASON_LABEL);
    assert.equal(new Set(reasons).size, reasons.length);
    assert.notEqual(WORKER_STOP_REASON_LABEL.crashed, WORKER_STOP_REASON_LABEL.operator);
  });
});
