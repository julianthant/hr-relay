import { deepFreeze } from "../../../rules/validation/immutability.js";
import type { WorkerBrowserObservation } from "../../../models/run/worker-control.js";
import type { BrowserSessionCloseReason } from "../../../workflow-kit/session.js";

/**
 * One worker's browser session for one system, from acquisition to proven closure.
 *
 * `starting` is one acquisition: `launching` matches the browser root launch's `launching`, and
 * `signing-in` begins when that launch is `open`; the Duo ceremony lease is held only inside it.
 * A `closing` owned by the acquisition is a sign-in that failed or was stopped; the acquisition
 * can still lose custody of its browser root or its ceremony lease while that close runs.
 * `closure-unproved` holds a session whose close did not prove (or a failed control left it
 * untrusted); only a proven close leaves it. `failed` is custody the worker cannot prove and
 * holds no session to close: an `unknown` root launch, a ceremony lease left held, or a pending
 * acquisition that outlived its close bound. Nothing leaves it.
 */
export type WorkerSessionState =
  | Readonly<{ state: "closed" }>
  | Readonly<{ state: "starting"; phase: "launching" | "signing-in" }>
  | Readonly<{ state: "authenticated"; lease: "idle" | "leased" }>
  | Readonly<{ state: "closing"; owner: "acquisition" | "session"; reason: BrowserSessionCloseReason }>
  | Readonly<{ state: "closure-unproved" }>
  | Readonly<{ state: "failed" }>;

export const WORKER_SESSION_STATE_KEYS = deepFreeze([
  "closed",
  "starting/launching",
  "starting/signing-in",
  "authenticated/idle",
  "authenticated/leased",
  "closing/acquisition",
  "closing/session",
  "closure-unproved",
  "failed",
] as const);
export type WorkerSessionStateKey = (typeof WORKER_SESSION_STATE_KEYS)[number];

export type WorkerSessionEvent =
  /** An acquisition opens the system's browser. */
  | Readonly<{ type: "launch" }>
  /** The factory returned a resource matching the launch; its browser root is `open`. */
  | Readonly<{ type: "launched" }>
  /** The open failed and left no browser. */
  | Readonly<{ type: "launch-failed" }>
  /** An open or profile probe could not prove its browser closed: the browser root launch is `unknown`. */
  | Readonly<{ type: "launch-uncertain" }>
  | Readonly<{ type: "signed-in" }>
  | Readonly<{ type: "login-failed" }>
  /** The acquisition's Duo ceremony lease release failed while unwinding; the lease row stays held. */
  | Readonly<{ type: "ceremony-release-failed" }>
  /** A close waited its acquisition bound for a pending acquisition. */
  | Readonly<{ type: "acquisition-close-timeout" }>
  /** A task lease or an operator control takes the session. */
  | Readonly<{ type: "lease" }>
  /** The lease or control ended with a proven reset. */
  | Readonly<{ type: "reset" }>
  /** An operator control failed and the session stays open but untrusted. */
  | Readonly<{ type: "poison" }>
  | Readonly<{ type: "close"; reason: BrowserSessionCloseReason }>
  /** The close proof names the session, its pages and context, and an exclusive session's released lease. */
  | Readonly<{ type: "close-proved" }>
  | Readonly<{ type: "close-failed" }>;
export type WorkerSessionEventType = WorkerSessionEvent["type"];
export const WORKER_SESSION_EVENT_TYPES = deepFreeze([
  "launch", "launched", "launch-failed", "launch-uncertain", "signed-in", "login-failed", "ceremony-release-failed",
  "acquisition-close-timeout", "lease", "reset", "poison", "close", "close-proved", "close-failed",
] as const satisfies readonly WorkerSessionEventType[]);

export type WorkerSessionRefusal =
  | "acquisition-pending"
  | "session-open"
  | "session-busy"
  | "no-session"
  | "closing"
  | "closure-unproved"
  | "custody-lost"
  | "not-launching"
  | "not-signing-in"
  | "not-acquiring"
  | "not-leased"
  | "not-closing";
export type WorkerSessionTransition =
  | Readonly<{ state: WorkerSessionState }>
  | Readonly<{ refused: WorkerSessionRefusal }>;

type Verdict = Readonly<{ to: WorkerSessionStateKey }> | Readonly<{ refused: WorkerSessionRefusal }>;

const refuse = <Refusal extends WorkerSessionRefusal>(refused: Refusal) => deepFreeze({ refused });
const PENDING = refuse("acquisition-pending");
const CLOSING = refuse("closing");
const LOST = refuse("custody-lost");
const NOT_LAUNCHING = refuse("not-launching");
const NOT_SIGNING_IN = refuse("not-signing-in");
const NOT_ACQUIRING = refuse("not-acquiring");
const NOT_LEASED = refuse("not-leased");
const NOT_CLOSING = refuse("not-closing");
const PHASE = {
  launched: NOT_LAUNCHING, "launch-failed": NOT_LAUNCHING, "launch-uncertain": NOT_LAUNCHING,
  "signed-in": NOT_SIGNING_IN, "login-failed": NOT_SIGNING_IN,
} as const;
const UNACQUIRED = { "ceremony-release-failed": NOT_ACQUIRING, "acquisition-close-timeout": NOT_ACQUIRING } as const;
const UNCLOSING = { "close-proved": NOT_CLOSING, "close-failed": NOT_CLOSING } as const;
const CLOSING_ROW = {
  launch: CLOSING, ...PHASE, lease: CLOSING, reset: NOT_LEASED, poison: CLOSING, close: CLOSING,
  "close-proved": { to: "closed" }, "close-failed": { to: "closure-unproved" },
} as const;

/** Rows are states and columns are events; a closing target takes its reason from the event. */
export const WORKER_SESSION_TRANSITIONS = deepFreeze({
  closed: {
    launch: { to: "starting/launching" }, ...PHASE, "launch-uncertain": { to: "failed" }, ...UNACQUIRED,
    lease: refuse("no-session"), reset: NOT_LEASED, poison: refuse("no-session"), close: refuse("no-session"), ...UNCLOSING,
  },
  "starting/launching": {
    launch: PENDING, ...PHASE, launched: { to: "starting/signing-in" }, "launch-failed": { to: "closed" },
    "launch-uncertain": { to: "failed" }, "ceremony-release-failed": { to: "failed" }, "acquisition-close-timeout": { to: "failed" },
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: PENDING, ...UNCLOSING,
  },
  "starting/signing-in": {
    launch: PENDING, ...PHASE, "signed-in": { to: "authenticated/idle" }, "login-failed": { to: "closing/acquisition" },
    "ceremony-release-failed": { to: "failed" }, "acquisition-close-timeout": { to: "failed" },
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: { to: "closing/acquisition" }, ...UNCLOSING,
  },
  "authenticated/idle": {
    launch: refuse("session-open"), ...PHASE, ...UNACQUIRED,
    lease: { to: "authenticated/leased" }, reset: NOT_LEASED, poison: NOT_LEASED, close: { to: "closing/session" }, ...UNCLOSING,
  },
  "authenticated/leased": {
    launch: refuse("session-open"), ...PHASE, ...UNACQUIRED,
    lease: refuse("session-busy"), reset: { to: "authenticated/idle" }, poison: { to: "closure-unproved" },
    close: { to: "closing/session" }, ...UNCLOSING,
  },
  "closing/acquisition": { ...CLOSING_ROW, "ceremony-release-failed": { to: "failed" }, "acquisition-close-timeout": { to: "failed" } },
  "closing/session": { ...CLOSING_ROW, ...UNACQUIRED },
  "closure-unproved": {
    launch: refuse("closure-unproved"), ...PHASE, ...UNACQUIRED,
    lease: refuse("closure-unproved"), reset: NOT_LEASED, poison: { to: "closure-unproved" }, close: { to: "closing/session" }, ...UNCLOSING,
  },
  failed: {
    launch: LOST, launched: LOST, "launch-failed": LOST, "launch-uncertain": LOST, "signed-in": LOST, "login-failed": LOST,
    "ceremony-release-failed": LOST, "acquisition-close-timeout": LOST, lease: LOST, reset: LOST, poison: LOST, close: LOST,
    "close-proved": LOST, "close-failed": LOST,
  },
} as const satisfies Record<WorkerSessionStateKey, Record<WorkerSessionEventType, Verdict>>);

const SETTLED_STATES = deepFreeze({
  closed: { state: "closed" },
  "starting/launching": { state: "starting", phase: "launching" },
  "starting/signing-in": { state: "starting", phase: "signing-in" },
  "authenticated/idle": { state: "authenticated", lease: "idle" },
  "authenticated/leased": { state: "authenticated", lease: "leased" },
  "closure-unproved": { state: "closure-unproved" },
  failed: { state: "failed" },
} as const satisfies Record<Exclude<WorkerSessionStateKey, `closing/${string}`>, WorkerSessionState>);

export function workerSessionStateKey(state: WorkerSessionState): WorkerSessionStateKey {
  switch (state.state) {
    case "starting": return `starting/${state.phase}`;
    case "authenticated": return `authenticated/${state.lease}`;
    case "closing": return `closing/${state.owner}`;
    default: return state.state;
  }
}

/** A pending sign-in is closed only by a stop; any other close waits for the acquisition to settle. */
const STOP_REASONS: ReadonlySet<BrowserSessionCloseReason> = new Set(["parked", "worker-stop"]);

export function transitionWorkerSession(state: WorkerSessionState, event: WorkerSessionEvent): WorkerSessionTransition {
  const key = workerSessionStateKey(state);
  const verdict: Verdict = WORKER_SESSION_TRANSITIONS[key][event.type];
  if ("refused" in verdict) return verdict;
  if (verdict.to === "closing/acquisition" || verdict.to === "closing/session") {
    const reason = event.type === "close" ? event.reason : "login-failed";
    if (key === "starting/signing-in" && event.type === "close" && !STOP_REASONS.has(reason)) return PENDING;
    return deepFreeze({ state: { state: "closing", owner: verdict.to === "closing/acquisition" ? "acquisition" : "session", reason } });
  }
  return deepFreeze({ state: SETTLED_STATES[verdict.to] });
}

/** The health a worker reports for its session: in use or closing is `unknown` until a proof settles it. */
export function workerSessionHealth(state: WorkerSessionState): WorkerBrowserObservation["health"] {
  switch (state.state) {
    case "closed": return "closed";
    case "starting": return "starting";
    case "authenticated": return state.lease === "idle" ? "authenticated" : "unknown";
    case "closing": return "unknown";
    case "closure-unproved":
    case "failed": return "failed";
  }
}
