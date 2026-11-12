import { describe, expect, it } from "vitest";
import { WorkerBrowserObservationSchema } from "../../../../src/models/run/worker-control.js";
import type { BrowserSessionCloseReason } from "../../../../src/workflow-kit/session.js";
import {
  transitionWorkerSession,
  workerSessionHealth,
  workerSessionStateKey,
  WORKER_SESSION_EVENT_TYPES,
  WORKER_SESSION_STATE_KEYS,
  WORKER_SESSION_TRANSITIONS,
  type WorkerSessionEvent,
  type WorkerSessionEventType,
  type WorkerSessionState,
  type WorkerSessionStateKey,
} from "../../../../src/backend/runtime/workers/worker-session-state.js";

const CLOSE_REASONS = [
  "fresh-boundary", "profile-reset", "poisoned", "parked", "worker-stop", "operator-reopen", "login-failed",
] as const satisfies readonly BrowserSessionCloseReason[];
const everyCloseReason: [Exclude<BrowserSessionCloseReason, (typeof CLOSE_REASONS)[number]>] extends [never] ? true : never = true;

/** One representative state per table row; a closing row's reason does not change its verdicts. */
const states: Record<WorkerSessionStateKey, WorkerSessionState> = {
  closed: { state: "closed" },
  "starting/launching": { state: "starting", phase: "launching" },
  "starting/signing-in": { state: "starting", phase: "signing-in" },
  "authenticated/idle": { state: "authenticated", lease: "idle" },
  "authenticated/leased": { state: "authenticated", lease: "leased" },
  "closing/acquisition": { state: "closing", owner: "acquisition", reason: "worker-stop" },
  "closing/session": { state: "closing", owner: "session", reason: "fresh-boundary" },
  "closure-unproved": { state: "closure-unproved" },
  failed: { state: "failed" },
};

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
const closingRow = (custody: unknown) => ({
  launch: CLOSING, ...PHASE, "ceremony-release-failed": custody, "acquisition-close-timeout": custody,
  lease: CLOSING, reset: NOT_LEASED, poison: CLOSING, close: CLOSING,
  "close-proved": to({ state: "closed" }), "close-failed": to({ state: "closure-unproved" }),
});
const expected: Record<WorkerSessionStateKey, Record<WorkerSessionEventType, unknown>> = {
  closed: {
    launch: to({ state: "starting", phase: "launching" }), ...PHASE, "launch-uncertain": to({ state: "failed" }),
    "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: NONE, reset: NOT_LEASED, poison: NONE, close: NONE, "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING,
  },
  "starting/launching": {
    launch: PENDING, ...PHASE, launched: to({ state: "starting", phase: "signing-in" }),
    "launch-failed": to({ state: "closed" }), "launch-uncertain": to({ state: "failed" }),
    "ceremony-release-failed": to({ state: "failed" }), "acquisition-close-timeout": to({ state: "failed" }),
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: PENDING, "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING,
  },
  "starting/signing-in": {
    launch: PENDING, ...PHASE, "signed-in": to({ state: "authenticated", lease: "idle" }),
    "login-failed": to({ state: "closing", owner: "acquisition", reason: "login-failed" }),
    "ceremony-release-failed": to({ state: "failed" }), "acquisition-close-timeout": to({ state: "failed" }),
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: to({ state: "closing", owner: "acquisition", reason: "parked" }),
    "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING,
  },
  "authenticated/idle": {
    launch: OPEN, ...PHASE, "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: to({ state: "authenticated", lease: "leased" }), reset: NOT_LEASED, poison: NOT_LEASED,
    close: to({ state: "closing", owner: "session", reason: "parked" }), "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING,
  },
  "authenticated/leased": {
    launch: OPEN, ...PHASE, "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: BUSY, reset: to({ state: "authenticated", lease: "idle" }), poison: to({ state: "closure-unproved" }),
    close: to({ state: "closing", owner: "session", reason: "parked" }), "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING,
  },
  "closing/acquisition": closingRow(to({ state: "failed" })),
  "closing/session": closingRow(NOT_ACQUIRING),
  "closure-unproved": {
    launch: UNPROVED, ...PHASE, "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING,
    lease: UNPROVED, reset: NOT_LEASED, poison: to({ state: "closure-unproved" }),
    close: to({ state: "closing", owner: "session", reason: "parked" }), "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING,
  },
  failed: {
    launch: LOST, launched: LOST, "launch-failed": LOST, "launch-uncertain": LOST, "signed-in": LOST, "login-failed": LOST,
    "ceremony-release-failed": LOST, "acquisition-close-timeout": LOST, lease: LOST, reset: LOST, poison: LOST, close: LOST,
    "close-proved": LOST, "close-failed": LOST,
  },
};

describe("worker browser session transition table", () => {
  it("has one row per state and one column per event", () => {
    expect(everyCloseReason).toBe(true);
    expect(Object.keys(WORKER_SESSION_TRANSITIONS).sort()).toEqual([...WORKER_SESSION_STATE_KEYS].sort());
    expect(Object.keys(expected).sort()).toEqual([...WORKER_SESSION_STATE_KEYS].sort());
    expect(Object.keys(events).sort()).toEqual([...WORKER_SESSION_EVENT_TYPES].sort());
    for (const key of WORKER_SESSION_STATE_KEYS) {
      expect(Object.keys(WORKER_SESSION_TRANSITIONS[key]).sort()).toEqual([...WORKER_SESSION_EVENT_TYPES].sort());
      expect(workerSessionStateKey(states[key])).toBe(key);
    }
  });

  for (const key of WORKER_SESSION_STATE_KEYS) {
    for (const type of WORKER_SESSION_EVENT_TYPES) {
      it(`${key} on ${type}`, () => {
        expect(transitionWorkerSession(states[key], events[type])).toEqual(expected[key][type]);
      });
    }
  }

  it("keeps each close reason on the closing state it produces", () => {
    for (const reason of CLOSE_REASONS) {
      for (const key of ["authenticated/idle", "authenticated/leased", "closure-unproved"] as const) {
        expect(transitionWorkerSession(states[key], { type: "close", reason })).toEqual(to({ state: "closing", owner: "session", reason }));
      }
    }
  });

  it("lets a pending sign-in close only for a stop; every other reason waits for the acquisition", () => {
    for (const reason of CLOSE_REASONS) {
      const verdict = transitionWorkerSession(states["starting/signing-in"], { type: "close", reason });
      expect(verdict).toEqual(reason === "parked" || reason === "worker-stop"
        ? to({ state: "closing", owner: "acquisition", reason })
        : PENDING);
    }
  });

  it("leaves closure-unproved for a usable state only through a proven close", () => {
    const reached = new Set<WorkerSessionStateKey>();
    const queue: WorkerSessionState[] = [states["closure-unproved"]];
    for (const state of queue) {
      const key = workerSessionStateKey(state);
      if (reached.has(key)) continue;
      reached.add(key);
      for (const type of WORKER_SESSION_EVENT_TYPES) {
        if (type === "close-proved") continue;
        const variants: readonly WorkerSessionEvent[] = type === "close" ? CLOSE_REASONS.map((reason) => ({ type, reason })) : [events[type]];
        for (const event of variants) {
          const verdict = transitionWorkerSession(state, event);
          if ("state" in verdict) queue.push(verdict.state);
        }
      }
    }
    expect([...reached].sort()).toEqual(["closing/session", "closure-unproved"]);
    const closing = transitionWorkerSession(states["closure-unproved"], { type: "close", reason: "worker-stop" });
    expect("state" in closing && transitionWorkerSession(closing.state, { type: "close-proved" })).toEqual(to({ state: "closed" }));
  });

  it("derives the reported health from the state alone and produces every declared health", () => {
    const health: Record<WorkerSessionStateKey, string> = {
      closed: "closed",
      "starting/launching": "starting",
      "starting/signing-in": "starting",
      "authenticated/idle": "authenticated",
      "authenticated/leased": "unknown",
      "closing/acquisition": "unknown",
      "closing/session": "unknown",
      "closure-unproved": "failed",
      failed: "failed",
    };
    for (const key of WORKER_SESSION_STATE_KEYS) expect(workerSessionHealth(states[key])).toBe(health[key]);
    expect([...new Set(Object.values(health))].sort()).toEqual([...WorkerBrowserObservationSchema.shape.health.options].sort());
  });

  it("keeps the registry and every verdict frozen", () => {
    for (const registry of [WORKER_SESSION_STATE_KEYS, WORKER_SESSION_EVENT_TYPES, WORKER_SESSION_TRANSITIONS]) expect(Object.isFrozen(registry)).toBe(true);
    for (const key of WORKER_SESSION_STATE_KEYS) {
      expect(Object.isFrozen(WORKER_SESSION_TRANSITIONS[key])).toBe(true);
      for (const type of WORKER_SESSION_EVENT_TYPES) {
        const verdict = transitionWorkerSession(states[key], events[type]);
        expect(Object.isFrozen(verdict)).toBe(true);
        if ("state" in verdict) expect(Object.isFrozen(verdict.state)).toBe(true);
      }
    }
  });
});
