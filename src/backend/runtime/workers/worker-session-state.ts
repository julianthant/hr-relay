import { deepFreeze } from "../../../rules/validation/immutability.js";
import type { WorkerBrowserObservation } from "../../../models/run/worker-control.js";
import type { BrowserSessionCloseReason } from "../../../workflow-kit/session.js";

/**
 * The browser a worker holds for one system, from acquisition to proven closure.
 *
 * `starting` is one acquisition: `launching` matches the browser root launch's `launching`, and
 * `signing-in` begins when that launch is `open`, where the Duo ceremony lease is taken. A
 * `closing` owned by the acquisition is a sign-in that failed or was stopped. `closure-unproved`
 * holds a browser whose close did not prove (or a failed control left it untrusted); only a
 * proven close leaves it.
 */
export type WorkerSessionBrowser =
  | Readonly<{ state: "closed" }>
  | Readonly<{ state: "starting"; phase: "launching" | "signing-in" }>
  | Readonly<{ state: "authenticated"; lease: "idle" | "leased" }>
  | Readonly<{ state: "closing"; owner: "acquisition" | "session"; reason: BrowserSessionCloseReason }>
  | Readonly<{ state: "closure-unproved" }>;

/**
 * A worker's browser session for one system. `failed` is custody the worker cannot prove: an
 * `unknown` root launch, a ceremony lease left held, or a pending acquisition that outlived its
 * close bound. The acquisition releases its ceremony lease last and may still settle after its
 * close bound, so the browser keeps its own lifecycle underneath: a late browser still arrives
 * and is still closed. Nothing clears `failed`; it refuses reuse and an empty close.
 */
export type WorkerSessionState = WorkerSessionBrowser | Readonly<{ state: "failed"; browser: WorkerSessionBrowser }>;

export const WORKER_SESSION_BROWSER_KEYS = deepFreeze([
  "closed",
  "starting/launching",
  "starting/signing-in",
  "authenticated/idle",
  "authenticated/leased",
  "closing/acquisition",
  "closing/session",
  "closure-unproved",
] as const);
export type WorkerSessionBrowserKey = (typeof WORKER_SESSION_BROWSER_KEYS)[number];
export type WorkerSessionStateKey = WorkerSessionBrowserKey | `failed/${WorkerSessionBrowserKey}`;

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
  /** The acquisition's Duo ceremony lease release failed while unwinding, possibly after its browser closed; the lease row stays held. */
  | Readonly<{ type: "ceremony-release-failed" }>
  /** A close waited its acquisition bound for a pending acquisition, which may still settle. */
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

/** A browser target; `custody: "lost"` also makes the system failed. */
type Verdict = Readonly<{ to: WorkerSessionBrowserKey; custody?: "lost" }> | Readonly<{ refused: WorkerSessionRefusal }>;

const refuse = <Refusal extends WorkerSessionRefusal>(refused: Refusal) => deepFreeze({ refused });
const PENDING = refuse("acquisition-pending");
const NONE = refuse("no-session");
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
/** A custody loss marks the system failed; the browser moves only for an `unknown` launch. */
const lost = <Key extends WorkerSessionBrowserKey>(to: Key) => ({ to, custody: "lost" }) as const;

/**
 * Rows are browser states and columns are events. A closing target takes its reason from a close
 * event, keeps the reason of the close already running, or is a failed sign-in's `login-failed`.
 */
export const WORKER_SESSION_TRANSITIONS = deepFreeze({
  closed: {
    launch: { to: "starting/launching" }, ...PHASE, "launch-uncertain": lost("closed"),
    "ceremony-release-failed": lost("closed"), "acquisition-close-timeout": NOT_ACQUIRING,
    lease: NONE, reset: NOT_LEASED, poison: NONE, close: NONE, ...UNCLOSING,
  },
  "starting/launching": {
    launch: PENDING, ...PHASE, launched: { to: "starting/signing-in" }, "launch-failed": { to: "closed" },
    "launch-uncertain": lost("closed"), "ceremony-release-failed": lost("starting/launching"),
    "acquisition-close-timeout": lost("starting/launching"),
    lease: PENDING, reset: NOT_LEASED, poison: PENDING, close: PENDING, ...UNCLOSING,
  },
  "starting/signing-in": {
    launch: PENDING, ...PHASE, "signed-in": { to: "authenticated/idle" }, "login-failed": { to: "closing/acquisition" },
    "ceremony-release-failed": lost("starting/signing-in"), "acquisition-close-timeout": lost("starting/signing-in"),
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
  "closing/acquisition": {
    launch: CLOSING, ...PHASE, "ceremony-release-failed": lost("closing/acquisition"),
    "acquisition-close-timeout": lost("closing/acquisition"),
    lease: CLOSING, reset: NOT_LEASED, poison: CLOSING, close: CLOSING,
    "close-proved": { to: "closed" }, "close-failed": { to: "closure-unproved" },
  },
  "closing/session": {
    launch: CLOSING, ...PHASE, ...UNACQUIRED, lease: CLOSING, reset: NOT_LEASED, poison: CLOSING, close: CLOSING,
    "close-proved": { to: "closed" }, "close-failed": { to: "closure-unproved" },
  },
  "closure-unproved": {
    launch: refuse("closure-unproved"), ...PHASE, "ceremony-release-failed": lost("closure-unproved"),
    "acquisition-close-timeout": NOT_ACQUIRING,
    lease: refuse("closure-unproved"), reset: NOT_LEASED, poison: { to: "closure-unproved" }, close: { to: "closing/session" }, ...UNCLOSING,
  },
} as const satisfies Record<WorkerSessionBrowserKey, Record<WorkerSessionEventType, Verdict>>);

const SETTLED_BROWSERS = deepFreeze({
  closed: { state: "closed" },
  "starting/launching": { state: "starting", phase: "launching" },
  "starting/signing-in": { state: "starting", phase: "signing-in" },
  "authenticated/idle": { state: "authenticated", lease: "idle" },
  "authenticated/leased": { state: "authenticated", lease: "leased" },
  "closure-unproved": { state: "closure-unproved" },
} as const satisfies Record<Exclude<WorkerSessionBrowserKey, `closing/${string}`>, WorkerSessionBrowser>);

export function workerSessionBrowserKey(browser: WorkerSessionBrowser): WorkerSessionBrowserKey {
  switch (browser.state) {
    case "starting": return `starting/${browser.phase}`;
    case "authenticated": return `authenticated/${browser.lease}`;
    case "closing": return `closing/${browser.owner}`;
    default: return browser.state;
  }
}

export function workerSessionStateKey(state: WorkerSessionState): WorkerSessionStateKey {
  return state.state === "failed" ? `failed/${workerSessionBrowserKey(state.browser)}` : workerSessionBrowserKey(state);
}

/** A pending sign-in is closed only by a stop; any other close waits for the acquisition to settle. */
const STOP_REASONS: ReadonlySet<BrowserSessionCloseReason> = new Set(["parked", "worker-stop"]);

type BrowserStep = Readonly<{ browser: WorkerSessionBrowser; lost: boolean }> | Readonly<{ refused: WorkerSessionRefusal }>;

function nextBrowser(browser: WorkerSessionBrowser, event: WorkerSessionEvent): BrowserStep {
  const key = workerSessionBrowserKey(browser);
  const verdict: Verdict = WORKER_SESSION_TRANSITIONS[key][event.type];
  if ("refused" in verdict) return verdict;
  const lostCustody = verdict.custody === "lost";
  if (verdict.to === "closing/acquisition" || verdict.to === "closing/session") {
    const reason = event.type === "close" ? event.reason : browser.state === "closing" ? browser.reason : "login-failed";
    if (key === "starting/signing-in" && event.type === "close" && !STOP_REASONS.has(reason)) return PENDING;
    return { browser: { state: "closing", owner: verdict.to === "closing/acquisition" ? "acquisition" : "session", reason }, lost: lostCustody };
  }
  return { browser: SETTLED_BROWSERS[verdict.to], lost: lostCustody };
}

/**
 * A failed system's browser moves as any other, but the system refuses reuse (launch, lease) and
 * an empty close, so its closure is never proved.
 */
export function transitionWorkerSession(state: WorkerSessionState, event: WorkerSessionEvent): WorkerSessionTransition {
  const failed = state.state === "failed";
  if (failed && (event.type === "launch" || event.type === "lease")) return LOST;
  const next = nextBrowser(failed ? state.browser : state, event);
  if ("refused" in next) return failed && next.refused === "no-session" ? LOST : next;
  return deepFreeze({ state: failed || next.lost ? { state: "failed", browser: next.browser } : next.browser });
}

/**
 * The health a worker reports for its session's browser: in use or closing is `unknown` until a
 * proof settles it. A failed system reports its browser's health; its lost custody is reported as
 * unproved closure, not as browser health.
 */
export function workerSessionHealth(state: WorkerSessionState): WorkerBrowserObservation["health"] {
  const browser = state.state === "failed" ? state.browser : state;
  switch (browser.state) {
    case "closed": return "closed";
    case "starting": return "starting";
    case "authenticated": return browser.lease === "idle" ? "authenticated" : "unknown";
    case "closing": return "unknown";
    case "closure-unproved": return "failed";
  }
}
