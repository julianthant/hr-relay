import { describe, expect, it } from "vitest";
import { WorkerBrowserObservationSchema } from "../../../../src/models/run/worker-control.js";
import type { BrowserSessionCloseReason } from "../../../../src/workflow-kit/session.js";
import {
  transitionWorkerSession,
  workerSessionBrowserKey,
  workerSessionHealth,
  workerSessionStateKey,
  WORKER_SESSION_BROWSER_KEYS,
  WORKER_SESSION_EVENT_TYPES,
  WORKER_SESSION_TRANSITIONS,
  type WorkerSessionBrowser,
  type WorkerSessionBrowserKey,
  type WorkerSessionEvent,
  type WorkerSessionEventType,
  type WorkerSessionState,
  type WorkerSessionStateKey,
  type WorkerSessionTransition,
} from "../../../../src/backend/runtime/workers/worker-session-state.js";

const CLOSE_REASONS = [
  "fresh-boundary", "profile-reset", "poisoned", "parked", "worker-stop", "operator-reopen", "login-failed",
] as const satisfies readonly BrowserSessionCloseReason[];
const everyCloseReason: [Exclude<BrowserSessionCloseReason, (typeof CLOSE_REASONS)[number]>] extends [never] ? true : never = true;

/** One representative browser per table row; a closing row's reason does not change its verdicts. */
const browsers: Record<WorkerSessionBrowserKey, WorkerSessionBrowser> = {
  closed: { state: "closed" },
  "starting/launching": { state: "starting", phase: "launching" },
  "starting/signing-in": { state: "starting", phase: "signing-in" },
  "authenticated/idle": { state: "authenticated", lease: "idle" },
  "authenticated/leased": { state: "authenticated", lease: "leased" },
  "closing/acquisition": { state: "closing", owner: "acquisition", reason: "worker-stop" },
  "closing/session": { state: "closing", owner: "session", reason: "fresh-boundary" },
  "closure-unproved": { state: "closure-unproved" },
};
const failed = (browser: WorkerSessionBrowser): WorkerSessionState => ({ state: "failed", browser });

const events: Record<WorkerSessionEventType, WorkerSessionEvent> = {
  launch: { type: "launch" },
  launched: { type: "launched" },
  "launch-failed": { type: "launch-failed" },
  "launch-uncertain": { type: "launch-uncertain" },
  "signed-in": { type: "signed-in" },
  "login-failed": { type: "login-failed" },
  "ceremony-release-failed": { type: "ceremony-release-failed" },
  "acquisition-close-timeout": { type: "acquisition-close-timeout" },
  lease: { type: "lease" },
  reset: { type: "reset" },
  poison: { type: "poison" },
  close: { type: "close", reason: "parked" },
  "close-proved": { type: "close-proved" },
  "close-failed": { type: "close-failed" },
};
const stop = { type: "close", reason: "worker-stop" } as const;

/**
 * Written by hand from the guards in worker-sessions.ts; it is the specification the table must reproduce.
 * `close` here is a stop (parked), the one reason a pending sign-in admits.
 */
const to = (state: WorkerSessionState) => ({ state });
const PENDING = { refused: "acquisition-pending" } as const;
const OPEN = { refused: "session-open" } as const;
const BUSY = { refused: "session-busy" } as const;
const NONE = { refused: "no-session" } as const;
const CLOSING = { refused: "closing" } as const;
const UNPROVED = { refused: "closure-unproved" } as const;
const LOST = { refused: "custody-lost" } as const;
const NOT_LAUNCHING = { refused: "not-launching" } as const;
const NOT_SIGNING_IN = { refused: "not-signing-in" } as const;
const NOT_ACQUIRING = { refused: "not-acquiring" } as const;
const NOT_LEASED = { refused: "not-leased" } as const;
const NOT_CLOSING = { refused: "not-closing" } as const;
const PHASE = {
  launched: NOT_LAUNCHING, "launch-failed": NOT_LAUNCHING, "launch-uncertain": NOT_LAUNCHING,
  "signed-in": NOT_SIGNING_IN, "login-failed": NOT_SIGNING_IN,
} as const;
const UNCLOSING = { "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING } as const;
const expected: Record<WorkerSessionBrowserKey, Record<WorkerSessionEventType, WorkerSessionTransition>> = {
  closed: {
    launch: to(browsers["starting/launching"]), ...PHASE, "launch-uncertain": to(failed(browsers.closed)),
    "ceremony-release-failed": to(failed(browsers.closed)), "acquisition-close-timeout": NOT_ACQUIRING,
    lease: NONE, reset: NOT_LEASED, poison: NONE, close: NONE, ...UNCLOSING,
  },
  "starting/launching": {
    launch: PENDING, ...PHASE, launched: to(browsers["starting/signing-in"]), "launch-failed": to(browsers.closed),
    "launch-uncertain": to(failed(browsers.closed)), "ceremony-release-failed": to(failed(browsers["starting/launching"])),
    "acquisition-close-timeout": to(failed(browsers["starting/launching"])),
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: PENDING, ...UNCLOSING,
  },
  "starting/signing-in": {
    launch: PENDING, ...PHASE, "signed-in": to(browsers["authenticated/idle"]),
    "login-failed": to({ state: "closing", owner: "acquisition", reason: "login-failed" }),
    "ceremony-release-failed": to(failed(browsers["starting/signing-in"])), "acquisition-close-timeout": to(failed(browsers["starting/signing-in"])),
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: to({ state: "closing", owner: "acquisition", reason: "parked" }), ...UNCLOSING,
  },
  "authenticated/idle": {
    launch: OPEN, ...PHASE, "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: to(browsers["authenticated/leased"]), reset: NOT_LEASED, poison: NOT_LEASED,
    close: to({ state: "closing", owner: "session", reason: "parked" }), ...UNCLOSING,
  },
  "authenticated/leased": {
    launch: OPEN, ...PHASE, "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: BUSY, reset: to(browsers["authenticated/idle"]), poison: to(browsers["closure-unproved"]),
    close: to({ state: "closing", owner: "session", reason: "parked" }), ...UNCLOSING,
  },
  "closing/acquisition": {
    launch: CLOSING, ...PHASE, "ceremony-release-failed": to(failed(browsers["closing/acquisition"])),
    "acquisition-close-timeout": to(failed(browsers["closing/acquisition"])),
    lease: CLOSING, reset: NOT_LEASED, poison: CLOSING, close: CLOSING,
    "close-proved": to(browsers.closed), "close-failed": to(browsers["closure-unproved"]),
  },
  "closing/session": {
    launch: CLOSING, ...PHASE, "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: CLOSING, reset: NOT_LEASED, poison: CLOSING, close: CLOSING,
    "close-proved": to(browsers.closed), "close-failed": to(browsers["closure-unproved"]),
  },
  "closure-unproved": {
    launch: UNPROVED, ...PHASE, "ceremony-release-failed": to(failed(browsers["closure-unproved"])),
    "acquisition-close-timeout": NOT_ACQUIRING,
    lease: UNPROVED, reset: NOT_LEASED, poison: to(browsers["closure-unproved"]),
    close: to({ state: "closing", owner: "session", reason: "parked" }), ...UNCLOSING,
  },
};

/** A failed system: launch, lease and an empty close are refused; otherwise its browser moves and the system stays failed. */
function expectedFailed(key: WorkerSessionBrowserKey, type: WorkerSessionEventType): WorkerSessionTransition {
  const verdict = expected[key][type];
  if (type === "launch" || type === "lease" || ("refused" in verdict && verdict.refused === "no-session")) return LOST;
  if ("refused" in verdict) return verdict;
  return to(failed(verdict.state.state === "failed" ? verdict.state.browser : verdict.state));
}

/** Applies events in order and returns each verdict; a refusal leaves the state where it was. */
function walk(start: WorkerSessionState, sequence: readonly WorkerSessionEvent[]) {
  let state = start;
  const states: WorkerSessionState[] = [];
  const verdicts = sequence.map((event) => {
    const verdict = transitionWorkerSession(state, event);
    if ("state" in verdict) state = verdict.state;
    states.push(state);
    return verdict;
  });
  return { verdicts, health: states.map(workerSessionHealth) };
}

const everyVariant = (type: WorkerSessionEventType): readonly WorkerSessionEvent[] =>
  type === "close" ? CLOSE_REASONS.map((reason) => ({ type, reason })) : [events[type]];

describe("worker browser session transition table", () => {
  it("has one row per browser state and one column per event", () => {
    expect(everyCloseReason).toBe(true);
    expect(Object.keys(WORKER_SESSION_TRANSITIONS).sort()).toEqual([...WORKER_SESSION_BROWSER_KEYS].sort());
    expect(Object.keys(expected).sort()).toEqual([...WORKER_SESSION_BROWSER_KEYS].sort());
    expect(Object.keys(events).sort()).toEqual([...WORKER_SESSION_EVENT_TYPES].sort());
    for (const key of WORKER_SESSION_BROWSER_KEYS) {
      expect(Object.keys(WORKER_SESSION_TRANSITIONS[key]).sort()).toEqual([...WORKER_SESSION_EVENT_TYPES].sort());
      expect(workerSessionBrowserKey(browsers[key])).toBe(key);
      expect(workerSessionStateKey(browsers[key])).toBe(key);
      expect(workerSessionStateKey(failed(browsers[key]))).toBe(`failed/${key}`);
    }
  });

  for (const key of WORKER_SESSION_BROWSER_KEYS) {
    for (const type of WORKER_SESSION_EVENT_TYPES) {
      it(`${key} on ${type}`, () => {
        expect(transitionWorkerSession(browsers[key], events[type])).toEqual(expected[key][type]);
      });
      it(`failed/${key} on ${type}`, () => {
        expect(transitionWorkerSession(failed(browsers[key]), events[type])).toEqual(expectedFailed(key, type));
      });
    }
  }

  it("keeps each close reason on the closing state it produces", () => {
    for (const reason of CLOSE_REASONS) {
      for (const key of ["authenticated/idle", "authenticated/leased", "closure-unproved"] as const) {
        expect(transitionWorkerSession(browsers[key], { type: "close", reason })).toEqual(to({ state: "closing", owner: "session", reason }));
        expect(transitionWorkerSession(failed(browsers[key]), { type: "close", reason }))
          .toEqual(to(failed({ state: "closing", owner: "session", reason })));
      }
    }
  });

  it("lets a pending sign-in close only for a stop; every other reason waits for the acquisition", () => {
    for (const reason of CLOSE_REASONS) {
      const verdict = transitionWorkerSession(browsers["starting/signing-in"], { type: "close", reason });
      expect(verdict).toEqual(reason === "parked" || reason === "worker-stop"
        ? to({ state: "closing", owner: "acquisition", reason })
        : PENDING);
    }
  });

  it("leaves closure-unproved for a usable state only through a proven close", () => {
    const reached = new Set<WorkerSessionStateKey>();
    const queue: WorkerSessionState[] = [browsers["closure-unproved"]];
    for (const state of queue) {
      const key = workerSessionStateKey(state);
      if (reached.has(key)) continue;
      reached.add(key);
      for (const type of WORKER_SESSION_EVENT_TYPES) {
        if (type === "close-proved") continue;
        for (const event of everyVariant(type)) {
          const verdict = transitionWorkerSession(state, event);
          if ("state" in verdict) queue.push(verdict.state);
        }
      }
    }
    expect([...reached].sort()).toEqual(["closing/session", "closure-unproved", "failed/closing/session", "failed/closure-unproved"]);
    for (const state of queue) {
      expect(transitionWorkerSession(state, events.launch)).toHaveProperty("refused");
      expect(transitionWorkerSession(state, events.lease)).toHaveProperty("refused");
    }
    expect(walk(browsers["closure-unproved"], [stop, events["close-proved"]]).verdicts.at(-1)).toEqual(to(browsers.closed));
  });

  it("never clears failed: every event from a failed state stays failed or is refused", () => {
    for (const key of WORKER_SESSION_BROWSER_KEYS) {
      for (const type of WORKER_SESSION_EVENT_TYPES) {
        for (const event of everyVariant(type)) {
          const verdict = transitionWorkerSession(failed(browsers[key]), event);
          if ("state" in verdict) expect(verdict.state.state).toBe("failed");
        }
      }
    }
  });

  it("keeps the retained browser closable after its acquisition also loses the Duo ceremony lease", () => {
    // Login fails, its close fails (the browser is retained), then the ceremony release fails while the gate unwinds.
    expect(walk(browsers.closed, [
      events.launch, events.launched, events["login-failed"], events["close-failed"], events["ceremony-release-failed"],
      stop, events["close-proved"], events.launch, stop,
    ]).verdicts).toEqual([
      to(browsers["starting/launching"]),
      to(browsers["starting/signing-in"]),
      to({ state: "closing", owner: "acquisition", reason: "login-failed" }),
      to(browsers["closure-unproved"]),
      to(failed(browsers["closure-unproved"])),
      to(failed({ state: "closing", owner: "session", reason: "worker-stop" })),
      to(failed(browsers.closed)),
      LOST,
      LOST,
    ]);
    // The release failure arrives first: the login's own close still runs, and a failed one is retried at shutdown.
    expect(walk(browsers["starting/signing-in"], [
      events["ceremony-release-failed"], events["login-failed"], events["close-failed"], stop, events["close-proved"],
    ]).verdicts).toEqual([
      to(failed(browsers["starting/signing-in"])),
      to(failed({ state: "closing", owner: "acquisition", reason: "login-failed" })),
      to(failed(browsers["closure-unproved"])),
      to(failed({ state: "closing", owner: "session", reason: "worker-stop" })),
      to(failed(browsers.closed)),
    ]);
    // A stopped sign-in's close keeps its reason when the release fails during it.
    expect(walk(browsers["starting/signing-in"], [stop, events["ceremony-release-failed"], events["close-proved"]]).verdicts).toEqual([
      to({ state: "closing", owner: "acquisition", reason: "worker-stop" }),
      to(failed({ state: "closing", owner: "acquisition", reason: "worker-stop" })),
      to(failed(browsers.closed)),
    ]);
  });

  it("fails a Reopen whose retained ceremony lease is first released after the replacement closed", () => {
    expect(walk(browsers["starting/signing-in"], [
      events["login-failed"], events["close-proved"], events["ceremony-release-failed"], events.launch, events.lease, stop,
    ]).verdicts).toEqual([
      to({ state: "closing", owner: "acquisition", reason: "login-failed" }),
      to(browsers.closed),
      to(failed(browsers.closed)),
      LOST,
      LOST,
      LOST,
    ]);
  });

  it("follows a late browser after a launching acquisition outlives its close bound", () => {
    // The late login fails and its close fails; a second shutdown proves the retained browser closed.
    const failedClose = walk(browsers.closed, [
      events.launch, events["acquisition-close-timeout"], events.launched, events["login-failed"], events["close-failed"],
      stop, events["close-proved"], events.launch, stop,
    ]);
    expect(failedClose.verdicts).toEqual([
      to(browsers["starting/launching"]),
      to(failed(browsers["starting/launching"])),
      to(failed(browsers["starting/signing-in"])),
      to(failed({ state: "closing", owner: "acquisition", reason: "login-failed" })),
      to(failed(browsers["closure-unproved"])),
      to(failed({ state: "closing", owner: "session", reason: "worker-stop" })),
      to(failed(browsers.closed)),
      LOST,
      LOST,
    ]);
    expect(failedClose.health).toEqual(["starting", "starting", "starting", "unknown", "failed", "unknown", "closed", "closed", "closed"]);
    // The late login's own close proves.
    expect(walk(browsers.closed, [
      events.launch, events["acquisition-close-timeout"], events.launched, events["login-failed"], events["close-proved"], events.launch,
    ]).verdicts.slice(-2)).toEqual([to(failed(browsers.closed)), LOST]);
    // The late login succeeds: the browser is held but refused for reuse, and shutdown closes it.
    expect(walk(browsers.closed, [
      events.launch, events["acquisition-close-timeout"], events.launched, events["signed-in"], events.lease,
      { type: "close", reason: "parked" }, events["close-proved"],
    ]).verdicts.slice(-4)).toEqual([
      to(failed(browsers["authenticated/idle"])),
      LOST,
      to(failed({ state: "closing", owner: "session", reason: "parked" })),
      to(failed(browsers.closed)),
    ]);
  });

  it("derives the reported health from the state alone and produces every declared health", () => {
    const health: Record<WorkerSessionBrowserKey, string> = {
      closed: "closed",
      "starting/launching": "starting",
      "starting/signing-in": "starting",
      "authenticated/idle": "authenticated",
      "authenticated/leased": "unknown",
      "closing/acquisition": "unknown",
      "closing/session": "unknown",
      "closure-unproved": "failed",
    };
    for (const key of WORKER_SESSION_BROWSER_KEYS) {
      expect(workerSessionHealth(browsers[key])).toBe(health[key]);
      expect(workerSessionHealth(failed(browsers[key]))).toBe(health[key]);
    }
    expect([...new Set(Object.values(health))].sort()).toEqual([...WorkerBrowserObservationSchema.shape.health.options].sort());
  });

  it("keeps the registry and every verdict frozen", () => {
    for (const registry of [WORKER_SESSION_BROWSER_KEYS, WORKER_SESSION_EVENT_TYPES, WORKER_SESSION_TRANSITIONS]) expect(Object.isFrozen(registry)).toBe(true);
    for (const key of WORKER_SESSION_BROWSER_KEYS) {
      expect(Object.isFrozen(WORKER_SESSION_TRANSITIONS[key])).toBe(true);
      for (const type of WORKER_SESSION_EVENT_TYPES) {
        for (const state of [browsers[key], failed(browsers[key])]) {
          const verdict = transitionWorkerSession(state, events[type]);
          expect(Object.isFrozen(verdict)).toBe(true);
          if ("state" in verdict) expect(Object.isFrozen(verdict.state)).toBe(true);
        }
      }
    }
    expect(Object.isFrozen(browsers["closing/acquisition"])).toBe(false);
  });
});
