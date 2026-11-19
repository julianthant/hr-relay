import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { WorkerControlRefusal, WorkerBrowserObservationSchema, type WorkerBrowserObservation } from "../../../models/run/worker-control.js";

import { z } from "zod";
import type {
  BrowserSessionCloseReason,
  BrowserScreenshotEvidence,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../../../workflow-kit/session.js";
import { TaskError } from "../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import type { TaskId } from "../../../rules/identity/ids.js";
import type { TaskLogger, BrowserDriver } from "../../../workflow-kit/task.js";
import type { RunBrowserScreenshotCapture } from "../../../workflow-kit/diagnostics.js";
import type { Clock } from "../../../rules/time/clock.js";
import { BrowserLoginError, DuoTerminalRefusalError } from "../../systems/browser-shared/login-contract.js";
import { withBrowserActionSession, withoutBrowserActionNotes } from "../../systems/browser-shared/action-notes.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { DuoCeremonyReleaseFailedError } from "../gates/duo-ceremony-gate.js";
import type { DuoCeremonyGateFactory, DuoCeremonyGateHandle } from "../gates/duo-ceremony-gate.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../rules/identity/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  Fingerprint,
  WorkerId,
  WorkflowId,
} from "../../../rules/identity/ids.js";
import { BrowserPresentationModeSchema } from "../../../models/run/envelope.js";
import type { BrowserPresentationMode } from "../../../models/run/envelope.js";
import { LoginResultSchema, SessionNeedSchema } from "../../../models/sessions/session.js";
import type { LoginResult, SessionNeed } from "../../../models/sessions/session.js";
import type { RegisteredTaskStore, TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { transitionWorkerSession, workerSessionHealth, workerSessionStateKey } from "./worker-session-state.js";
import type { WorkerSessionBrowser, WorkerSessionState, WorkerSessionEvent as SessionTransition } from "./worker-session-state.js";

export type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../../../workflow-kit/session.js";

export type WorkerSessionEvent =
  | Readonly<{
    type: "browser-session:start";
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
    // Authentication evidence distinguishes warm sessions from sessions that performed login.
    login: LoginResult;
    at: string;
  }>
  | Readonly<{
    type: "browser-session:reset";
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
    at: string;
  }>
  | Readonly<{
    type: "browser-session:close";
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
    reason: BrowserSessionCloseReason;
    at: string;
  }>;

type WorkerSessionEventCore =
  | Readonly<{
    type: "browser-session:start";
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
    login: LoginResult;
  }>
  | Readonly<{
    type: "browser-session:reset";
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
  }>
  | Readonly<{
    type: "browser-session:close";
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
    reason: BrowserSessionCloseReason;
  }>;

export interface WorkerSessionManagerOptions {
  readonly workerId: WorkerId;
  readonly workflowId: WorkflowId;
  readonly singleAcquisitionPerSystemPerClaim?: true;
  readonly stores: TaskStoreRegistry;
  readonly factory: WorkerBrowserSessionFactory;
  // Envelopes without browserMode use the configured compatibility mode.
  readonly defaultBrowserMode?: BrowserPresentationMode;
  readonly clock: Clock;

  readonly scheduler: MonotonicDeadlineScheduler;
  // Require an explicit acquisition bound; an unbounded login can strand every later run.
  readonly acquireDeadlineMs: number;
  // Require the per-credential ceremony gate for every acquired login context.
  readonly duoCeremony: DuoCeremonyGateFactory;
  readonly onEvent?: (event: WorkerSessionEvent) => void;
  readonly onFailure?: (failure: { system: BrowserSystemId; reason: "abandoned-acquisition-failed" | "abandoned-session-close-failed"; sessionId?: string }) => void;
  readonly onParking?: () => void;
  readonly onActivity?: (activity: "acquiring" | "authenticating" | "closing") => () => void;
  readonly onObservation?: (observation: WorkerBrowserObservation) => void;
  /** Production persistence seam for explicit per-run browser screenshots. */
  readonly browserScreenshotCapture?: RunBrowserScreenshotCapture;
}

/** What `#acquireBounded` knows about its own envelope, handed down to the lease gate. */
interface AcquisitionEnvelope {
  readonly deadlineMonotonicMs: () => number;
  readonly extend: () => void;
  readonly cancel: (reason: Error) => void;
  readonly claimStaleRequestRecovery: () => boolean;
  /** An idle Reopen names the retained session it replaces; that worker's own released lease admits the exclusive replacement. */
  readonly replacesSessionId?: string;
}

function browserStoreFor(
  stores: TaskStoreRegistry,
  system: BrowserSystemId,
): Extract<RegisteredTaskStore, { readonly kind: "browser" }> {
  const store = stores.stores.find((candidate) =>
    candidate.kind === "browser" && candidate.namespace === system);
  if (store === undefined || store.kind !== "browser") {
    throw new Error(`browser session request names unregistered system ${system}`);
  }
  return store;
}

function effectiveResourceBrowserMode(
  resource: WorkerBrowserResource,
  defaultBrowserMode: BrowserPresentationMode,
): BrowserPresentationMode {
  return BrowserPresentationModeSchema.parse(
    resource.browserMode === undefined ? defaultBrowserMode : resource.browserMode,
  );
}

/**
 * One system's browser session: `state` is its lifecycle, and each other field is what that state
 * carries. `browser` lives from the open until its close proves, `acquisition` while it starts,
 * `stopLogin` while it signs in, and `failure` (rethrown to every later lease) with `failed`.
 * `turn` serializes the system's operations; it is a lock, not a lifecycle.
 */
interface SystemSession {
  state: WorkerSessionState;
  browser?: Readonly<{ resource: WorkerBrowserResource; openedAt: string; factory: WorkerBrowserSessionFactory; acquireMs: number; duo: DuoCeremonyGateFactory; defaultMode: BrowserPresentationMode }>;
  acquisition?: Promise<WorkerBrowserResource>;
  stopLogin?: (reason: "parked" | "worker-stop") => void;
  failure?: Error;
  turn?: Promise<void>;
}

const browserOf = (state: WorkerSessionState): WorkerSessionBrowser => state.state === "failed" ? state.browser : state;

/** The browser a lease may reuse or a close must prove: signed in, closing it, or its close unproved. */
function heldResource(session: SystemSession): WorkerBrowserResource | undefined {
  const browser = browserOf(session.state);
  const held = browser.state === "authenticated" || browser.state === "closure-unproved"
    || browser.state === "closing" && browser.owner === "session";
  return held ? session.browser?.resource : undefined;
}

/** A session close that has not proved, or lost custody: refuses reuse until a proven close. */
function closureUnproved(state: WorkerSessionState): boolean {
  const browser = browserOf(state);
  return state.state === "failed" || browser.state === "closure-unproved" || browser.state === "closing" && browser.owner === "session";
}

// A parked write wraps its capture error. An aggregate can carry an independent transaction failure.
function requiredCaptureFailed(error: unknown): boolean {
  const seen = new Set<Error>();
  while (error instanceof Error && !(error instanceof AggregateError) && !seen.has(error)) {
    if (error instanceof TaskError) return error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED";
    seen.add(error);
    error = error.cause;
  }
  return false;
}

function abortError(system: BrowserSystemId): Error {
  return new Error(`${system} driver lease was aborted before acquisition`);
}

function retainedSessionUnavailable(system: BrowserSystemId, error: unknown): boolean {
  if (error instanceof BrowserLoginError) {
    return error.system === system && error.step === "verify-landing"
      && (error.check === "application-route" || error.check === "positive-evidence" || error.check === "sign-in-form-absent");
  }
  return error instanceof Error && /^TargetClosedError\d*$/u.test(error.constructor.name);
}


export function sessionAcquisitionTimeoutText(boundMs: number): string {
  if (!Number.isFinite(boundMs) || boundMs <= 0) throw new Error("session acquisition bound must be positive and finite");
  return `Browser-session acquisition (open + login) exceeded its ${boundMs}ms timeouts.sessionAcquireMs bound. `
    + "Check timeouts.duoApprovalSeconds against the acquisition bound; never lengthen taskMs to hide a dead session.";
}
export class WorkerSessionClosureUnprovedError extends AggregateError {
  constructor(workerId: string, failures: readonly unknown[] = []) {
    super(failures, `worker ${workerId} failed to close every browser session; closure is unproved`);
    this.name = "WorkerSessionClosureUnprovedError";
  }
}

export class BrowserScreenshotUnavailableError extends Error {
  constructor(readonly reason: Extract<BrowserScreenshotEvidence, { state: "unavailable" }>["reason"]) { super(reason); this.name = "BrowserScreenshotUnavailableError"; }
}

export class SessionAcquisitionTimeoutError extends Error {
  readonly code = "browser-session-acquisition-timeout";
  readonly phase = "acquisition";
  constructor(readonly system: BrowserSystemId, readonly boundMs: number) {
    super(sessionAcquisitionTimeoutText(boundMs));
    this.name = "SessionAcquisitionTimeoutError";
  }
}

// An acquisition race loser retains its own settlement and teardown evidence.
function observeAbandonedAcquisition(error: unknown): void {
  void error;
}

// Observe late acquisition settlement and prove cleanup even after its deadline wins.
async function waitForAcquisition<Result>(
  acquisition: Promise<Result>,
  signal: AbortSignal,
  system: BrowserSystemId,
): Promise<Result> {
  acquisition.catch(observeAbandonedAcquisition);
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError(system);
  }
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : abortError(system));
    };
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([acquisition, aborted]);
  } finally {
    removeAbort();
  }
}

async function waitForTurn(turn: Promise<void>, signal: AbortSignal, system: BrowserSystemId): Promise<void> {
  if (signal.aborted) throw abortError(system);
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => reject(abortError(system));
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    await Promise.race([turn, aborted]);
  } finally {
    removeAbort();
  }
}

async function waitForOperation<Result>(
  operation: Promise<Result>,
  signal: AbortSignal,
  system: BrowserSystemId,
): Promise<Result> {
  if (signal.aborted) throw abortError(system);
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => reject(new Error(`${system} driver lease was aborted during use`));
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeAbort();
  }
}


export interface RunConfigFingerprintBinding {
  bindRunConfigFingerprint(
    fingerprint: Fingerprint,
    browserMode?: BrowserPresentationMode,
    screenshotContext?: Readonly<{
      runId: string;
      descriptorFingerprint: string;
    }>,
  ): void;
  releaseRunConfigFingerprint(): void;
}

/** The lease signal follows the run's abort until the durable fence; afterwards only task deadlines bound the write. */
export interface TransactionDriverLeaseOwnership {
  readonly signal: AbortSignal;
  retainAfterFence(): void;
}

function transactionLeaseOwnership(parent: AbortSignal, system: BrowserSystemId): TransactionDriverLeaseOwnership & { release(): void } {
  const lease = new AbortController();
  const follow = (): void => { lease.abort(parent.reason instanceof Error ? parent.reason : new Error(`${system} transaction driver lease was aborted during use`)); };
  if (parent.aborted) follow(); else parent.addEventListener("abort", follow, { once: true });
  let retained = false;
  const release = (): void => { parent.removeEventListener("abort", follow); };
  return {
    signal: lease.signal,
    retainAfterFence: () => {
      if (retained) throw new Error("transaction driver lease was retained after its fence more than once");
      lease.signal.throwIfAborted();
      retained = true;
      release();
    },
    release,
  };
}

async function waitForTransactionOperation<Result>(operation: Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error("transaction driver lease was aborted during use")); };
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeAbort();
  }
}


export async function withBoundRunConfigFingerprint<Result>(
  sessions: RunConfigFingerprintBinding,
  fingerprint: Fingerprint,
  operation: () => Promise<Result>,
  browserMode?: BrowserPresentationMode,
  screenshotContext?: Readonly<{
    runId: string;
    descriptorFingerprint: string;
  }>,
): Promise<Result> {
  sessions.bindRunConfigFingerprint(fingerprint, browserMode, screenshotContext);
  try {
    return await operation();
  } finally {
    sessions.releaseRunConfigFingerprint();
  }
}

export class WorkerSessionManager {
  readonly #workerId: WorkerId;
  #executionWorkflowId: WorkflowId;
  #stores: TaskStoreRegistry;
  #factory: WorkerBrowserSessionFactory;
  readonly #clock: Clock;
  readonly #scheduler: MonotonicDeadlineScheduler;
  #acquireDeadlineMs: number;
  #duoCeremony: DuoCeremonyGateFactory;
  readonly #onEvent: (event: WorkerSessionEvent) => void;
  #defaultBrowserMode: BrowserPresentationMode;
  readonly #browserScreenshotCapture: RunBrowserScreenshotCapture | undefined;
  readonly #onParking: WorkerSessionManagerOptions["onParking"];
  readonly #onActivity: WorkerSessionManagerOptions["onActivity"];
  readonly #onObservation: WorkerSessionManagerOptions["onObservation"];
  readonly #onFailure: WorkerSessionManagerOptions["onFailure"];
  readonly #systems = new Map<BrowserSystemId, SystemSession>();
  // Worker-wide operations, not one system's session: they refuse work on every system, including one with no session yet.
  #controlInFlight = false;
  #closingReason: "parked" | "worker-stop" | undefined;
  readonly #singleAcquisitionPerSystemPerClaim: boolean;
  #claimAcquisitions: Map<BrowserSystemId, { resource: WorkerBrowserResource } | { error: unknown }> | undefined;
  #runConfigFingerprint: Fingerprint | undefined;
  #runBrowserMode: BrowserPresentationMode | undefined;
  #runScreenshotContext: Readonly<{
    runId: string;
    descriptorFingerprint: string;
  }> | undefined;

  constructor(options: WorkerSessionManagerOptions) {
    this.#workerId = WorkerIdSchema.parse(options.workerId);
    this.#executionWorkflowId = WorkflowIdSchema.parse(options.workflowId);
    this.#singleAcquisitionPerSystemPerClaim = options.singleAcquisitionPerSystemPerClaim === true;
    this.#stores = options.stores;
    this.#onObservation = options.onObservation;
    this.#onFailure = options.onFailure;
    this.#onParking = options.onParking;
    this.#onActivity = options.onActivity;
    this.#factory = options.factory;
    this.#defaultBrowserMode = BrowserPresentationModeSchema.parse(options.defaultBrowserMode ?? "headless");
    this.#browserScreenshotCapture = options.browserScreenshotCapture;
    this.#clock = options.clock;
    this.#scheduler = options.scheduler;
    this.#acquireDeadlineMs = z.number().int().positive().parse(options.acquireDeadlineMs);
    this.#duoCeremony = options.duoCeremony;
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  /** Sessions stay open across runs of one execution workflow; a workflow change parks them first. */
  async parkForExecution(workflowId: WorkflowId, stores: TaskStoreRegistry): Promise<void> {
    if (workflowId !== this.#executionWorkflowId || stores !== this.#stores) await this.closeAll("parked");
  }

  configureExecution(workflowId: WorkflowId, stores: TaskStoreRegistry): void {
    if (workflowId === this.#executionWorkflowId && stores === this.#stores) return;
    if (this.#controlInFlight || this.#runConfigFingerprint !== undefined || this.#closingReason !== undefined
      || [...this.#systems.values()].some(session => session.state.state !== "closed" || session.acquisition !== undefined || session.turn !== undefined)) {
      throw new WorkerSessionClosureUnprovedError(this.#workerId);
    }
    this.#executionWorkflowId = WorkflowIdSchema.parse(workflowId);
    this.#stores = stores;
  }

  configureRunResources(resources: Readonly<{sessionFactory:WorkerBrowserSessionFactory;sessionAcquireMs:number;duoCeremony:DuoCeremonyGateFactory;defaultBrowserMode:BrowserPresentationMode}>): void {
    if (this.#controlInFlight || this.#runConfigFingerprint !== undefined || this.#acquiring()) throw new Error("run-resources-cannot-change-during-execution");
    this.#factory = resources.sessionFactory;
    this.#acquireDeadlineMs = z.number().int().positive().parse(resources.sessionAcquireMs);
    this.#duoCeremony = resources.duoCeremony;
    this.#defaultBrowserMode = BrowserPresentationModeSchema.parse(resources.defaultBrowserMode);
  }

  async prepareProfile(needInput: SessionNeed, instance: string | undefined, signal: AbortSignal): Promise<void> {
    const need = SessionNeedSchema.parse(needInput), configFingerprint = this.#runConfigFingerprint, browserMode = this.#runBrowserMode;
    if (configFingerprint === undefined || browserMode === undefined || this.#closingReason !== undefined || this.#controlInFlight) throw new Error("browser-profile-preparation-unavailable");
    await this.#withSystemTurn(need.system, signal, async () => {
      const session = this.#session(need.system);
      if (session.failure !== undefined) throw session.failure;
      if (closureUnproved(session.state)) throw new WorkerSessionClosureUnprovedError(this.#workerId);
      const existing = heldResource(session);
      if (existing !== undefined) {
        if (existing.instance === instance && existing.configFingerprint === configFingerprint
          && effectiveResourceBrowserMode(existing, this.#defaultBrowserMode) === browserMode) return;
        await this.#closeSystem(need.system, "fresh-boundary");
      }
      const acquired = this.#onActivity?.("acquiring");
      try { await this.#factory.probeProfile({ workerId: this.#workerId, system: need.system, ...(instance === undefined ? {} : { instance }), browserMode, signal }); }
      catch (error) {
        if (error instanceof BrowserSessionClosureUnprovedError) this.#loseCustody(need.system, { type: "launch-uncertain" }, error);
        throw error;
      } finally { acquired?.(); }
    });
  }

  activeSystems(): readonly BrowserSystemId[] {
    return Object.freeze([...this.#systems].filter(([, session]) => heldResource(session) !== undefined).map(([system]) => system));
  }

  /** Refuse synchronously; no wait-for-idle action survives a busy target. */
  assertControlTarget(sessionId: string): WorkerBrowserResource {
    if (this.#controlInFlight || this.#runConfigFingerprint !== undefined || this.#acquiring()
      || [...this.#systems.values()].some(session => session.turn !== undefined) || this.#closingReason !== undefined) throw new WorkerControlRefusal("worker-browser-busy");
    const session = [...this.#systems.values()].find(candidate => heldResource(candidate)?.sessionId === sessionId);
    const resource = session === undefined ? undefined : heldResource(session);
    if (session === undefined || resource === undefined) throw new WorkerControlRefusal("worker-browser-session-unavailable");
    if (closureUnproved(session.state)) throw new WorkerControlRefusal("worker-browser-unproven-close");
    if (resource.browserMode === undefined) throw new WorkerControlRefusal("worker-browser-retained-settings-unavailable");
    return resource;
  }

  async controlBrowser(type: "refresh-browser" | "reopen-browser", sessionId: string, signal: AbortSignal): Promise<WorkerBrowserResource> {
    const resource = this.assertControlTarget(sessionId);
    const retained = this.#session(resource.system).browser;
    if (retained === undefined) throw new WorkerControlRefusal("worker-browser-retained-settings-unavailable");
    this.#controlInFlight = true;
    const current = { factory: this.#factory, acquireMs: this.#acquireDeadlineMs, duo: this.#duoCeremony, defaultMode: this.#defaultBrowserMode };
    try {
      // The control holds the session from here, so a control that fails before its turn still leaves it untrusted.
      this.#apply(resource.system, { type: "lease" });
      return await this.#withSystemTurn(resource.system, signal, async () => {
      this.#observe(resource.system, resource);
      if (type === "refresh-browser") {
        // The resource factory's neutral reset includes content-level authentication proof.
        await resource.reset({ signal });
        this.#observeAndApply(resource.system, resource, { type: "reset" });
        this.#emit({ type: "browser-session:reset", system: resource.system, sessionId: resource.sessionId });
        return resource;
      }
      await this.#closeSystem(resource.system, "operator-reopen");
      this.#factory = retained.factory;
      this.#acquireDeadlineMs = retained.acquireMs;
      this.#duoCeremony = retained.duo;
      this.#defaultBrowserMode = retained.defaultMode;
      const replacement = await this.#acquireBounded(SessionNeedSchema.parse({ system: resource.system, session: "reuse-worker", access: "read", ...(resource.acceptDownloads ? { acceptDownloads: true } : {}), ...(resource.exclusive ? { exclusive: true } : {}) }), resource.instance, resource.configFingerprint, BrowserPresentationModeSchema.parse(resource.browserMode), signal, resource.sessionId);
      if (replacement.sessionId === resource.sessionId || replacement.profileDirectory !== resource.profileDirectory) {
        await this.#closeSystem(replacement.system, "poisoned");
        throw new Error("worker-browser-replacement-identity-mismatch");
      }
      return replacement;
      });
    } catch (error) {
      const session = this.#session(resource.system);
      const remaining = heldResource(session);
      if (remaining !== undefined) {
        // A closing or already untrusted session needs no poison; refusing it would mask the control's error.
        if (!closureUnproved(session.state)) this.#apply(resource.system, { type: "poison" });
        this.#observe(resource.system, remaining);
      }
      throw error;
    } finally {
      this.#factory = current.factory;
      this.#acquireDeadlineMs = current.acquireMs;
      this.#duoCeremony = current.duo;
      this.#defaultBrowserMode = current.defaultMode;
      this.#controlInFlight = false;
    }
  }

  #session(system: BrowserSystemId): SystemSession {
    let session = this.#systems.get(system);
    if (session === undefined) {
      session = { state: { state: "closed" } };
      this.#systems.set(system, session);
    }
    return session;
  }

  #acquiring(): boolean {
    return [...this.#systems.values()].some(session => session.acquisition !== undefined);
  }

  /**
   * Every session write goes through the transition table. A failed system refuses with the custody
   * failure it recorded, as a new lease would; any other refusal is a broken invariant.
   */
  #transition(system: BrowserSystemId, event: SessionTransition): WorkerSessionState {
    const session = this.#session(system);
    const next = transitionWorkerSession(session.state, event);
    if (!("refused" in next)) return next.state;
    if (next.refused === "custody-lost" && session.failure !== undefined) throw session.failure;
    throw new Error(`${system} browser session refused ${event.type} in ${workerSessionStateKey(session.state)}: ${next.refused}`);
  }

  #apply(system: BrowserSystemId, event: SessionTransition): void {
    this.#session(system).state = this.#transition(system, event);
  }

  /** Report the state an event reaches before it is kept, so a failed report leaves the session where it was. */
  #observeAndApply(system: BrowserSystemId, resource: WorkerBrowserResource, event: SessionTransition): void {
    const next = this.#transition(system, event);
    this.#observe(system, resource, next);
    this.#session(system).state = next;
  }

  #loseCustody(system: BrowserSystemId, event: SessionTransition, failure: Error): void {
    this.#apply(system, event);
    this.#session(system).failure = failure;
  }

  #observe(system: BrowserSystemId, resource: WorkerBrowserResource, state: WorkerSessionState = this.#session(system).state): void {
    const opened = this.#session(system).browser;
    this.#onObservation?.(WorkerBrowserObservationSchema.parse({ ...(opened?.resource === resource ? { openedAt: opened.openedAt } : {}), workerId: this.#workerId, sessionId: resource.sessionId, system: resource.system,
      ...(resource.instance === undefined ? {} : { instance: resource.instance }), configFingerprint: resource.configFingerprint,
      profileRevision: resource.profileRevision,
      signInFingerprint: resource.signInFingerprint,
      browserMode: effectiveResourceBrowserMode(resource, this.#defaultBrowserMode),
      ...(resource.profileDirectory === undefined ? {} : { profileDirectory: resource.profileDirectory }),
      acceptDownloads: resource.acceptDownloads, exclusive: resource.exclusive, health: workerSessionHealth(state), observedAt: this.#clock.now().toISOString() }));
  }


  bindRunConfigFingerprint(
    fingerprint: Fingerprint,
    browserMode?: BrowserPresentationMode,
    screenshotContext?: Readonly<{
      runId: string;
      descriptorFingerprint: string;
    }>,
  ): void {
    const parsed = FingerprintSchema.parse(fingerprint);
    if (this.#controlInFlight) throw new WorkerControlRefusal("worker-browser-control-in-progress");
    if (this.#runConfigFingerprint !== undefined) {
      throw new Error(
        `worker ${this.#workerId} already has a bound run config fingerprint; one worker owns one active run`,
      );
    }
    if (this.#singleAcquisitionPerSystemPerClaim) this.#claimAcquisitions = new Map();
    this.#runConfigFingerprint = parsed;
    this.#runBrowserMode = BrowserPresentationModeSchema.parse(browserMode ?? this.#defaultBrowserMode);
    this.#runScreenshotContext = screenshotContext === undefined
      ? undefined
      : Object.freeze({
        runId: screenshotContext.runId,
        descriptorFingerprint: screenshotContext.descriptorFingerprint,
      });
  }

  releaseRunConfigFingerprint(): void {
    if (this.#runConfigFingerprint === undefined) {
      throw new Error(`worker ${this.#workerId} has no bound run config fingerprint to release`);
    }
    this.#claimAcquisitions = undefined;
    this.#runConfigFingerprint = undefined;
    this.#runBrowserMode = undefined;
    this.#runScreenshotContext = undefined;
  }

  async withDriver<Result>(
    needInput: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (driver: BrowserDriver, captureScreenshot: (boundary?: "step" | "before-submit" | "after-submit") => Promise<void>) => Promise<Result>,
    screenshotOwner?: Readonly<{ taskId: TaskId; nodeId: string; attempt: number; log: Pick<TaskLogger, "warn">; sampleLabels?: readonly string[] }>,
  ): Promise<Result> {
    const need = SessionNeedSchema.parse(needInput);
    return this.#withDriverLease(need, instance, signal, (driver, captureScreenshot) => waitForOperation(
      Promise.resolve().then(() => operation(driver, captureScreenshot)),
      signal,
      need.system,
    ), screenshotOwner);
  }

  async withTransactionDriver<Result>(
    needInput: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (driver: BrowserDriver, ownership: TransactionDriverLeaseOwnership, captureScreenshot: (boundary?: "step" | "before-submit" | "after-submit") => Promise<void>) => Promise<Result>,
    screenshotOwner?: Readonly<{ taskId: TaskId; nodeId: string; attempt: number; log: Pick<TaskLogger, "warn">; sampleLabels?: readonly string[] }>,
  ): Promise<Result> {
    const need = SessionNeedSchema.parse(needInput);
    if (need.access !== "transaction") {
      throw new Error(`${need.system} retained driver lease requires transaction access`);
    }
    const ownership = transactionLeaseOwnership(signal, need.system);
    try {
      return await this.#withDriverLease(need, instance, ownership.signal, (driver, captureScreenshot) =>
        waitForTransactionOperation(Promise.resolve().then(() => operation(driver, ownership, captureScreenshot)), ownership.signal),
      screenshotOwner);
    } finally {
      ownership.release();
    }
  }

  async #withDriverLease<Result>(
    need: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    use: (driver: BrowserDriver, captureScreenshot: (boundary?: "step" | "before-submit" | "after-submit") => Promise<void>) => Promise<Result>,
    screenshotOwner?: Readonly<{ taskId: TaskId; nodeId: string; attempt: number; log: Pick<TaskLogger, "warn">; sampleLabels?: readonly string[] }>,
  ): Promise<Result> {
    if (this.#closingReason !== undefined) {
      throw new Error(
        `${need.system} driver lease cannot start while worker sessions are closing for ${this.#closingReason}`,
      );
    }
    const configFingerprint = this.#runConfigFingerprint;
    const browserMode = this.#runBrowserMode;
    if (configFingerprint === undefined) {
      throw new Error(
        `${need.system} driver lease requires the claimed run's bound config fingerprint; none is bound`,
      );
    }
    if (browserMode === undefined) {
      throw new Error(`${need.system} driver lease requires the claimed run's bound browser presentation; none is bound`);
    }
    const session = this.#session(need.system);
    // An active lease must reset or close before this turn. An idle browser's last proof predates the request.
    const idleAtRequest = session.state.state === "authenticated" && session.state.lease === "idle"
      ? heldResource(session) : undefined;
    const acquisitions = this.#claimAcquisitions;
    return this.#withSystemTurn(need.system, signal, async () => {
      const prior = acquisitions?.get(need.system);
      if (prior !== undefined) {
        if (session.failure !== undefined) throw session.failure;
        if (closureUnproved(session.state)) throw new WorkerSessionClosureUnprovedError(this.#workerId);
        if ("error" in prior) throw prior.error;
        if (need.session === "fresh" || heldResource(session) !== prior.resource || prior.resource.instance !== instance) {
          throw new Error(`${need.system} was already acquired by this claim`);
        }
      }
      if (need.session === "fresh") {
        await this.#closeSystem(need.system, "fresh-boundary");
      }
      let resource: WorkerBrowserResource;
      try {
        resource = await withoutBrowserActionNotes(async () => {
          const acquire = () => this.#acquireBounded(need, instance, configFingerprint, browserMode, signal);
          const candidate = await acquire();
          if (candidate !== idleAtRequest) return candidate;
          try {
            await candidate.reset({ signal });
            return candidate;
          } catch (error) {
            const failures = [error];
            try { await this.#closeSystem(need.system, "poisoned"); }
            catch (closeError) { failures.push(closeError); }
            if (failures.length > 1) {
              throw new AggregateError(failures, `${need.system} retained session check and poison-close both failed`, { cause: error });
            }
            if (prior !== undefined || signal.aborted || !retainedSessionUnavailable(need.system, error)) throw error;
            return acquire();
          }
        });
      } catch (error) {
        acquisitions?.set(need.system, { error });
        throw error;
      }
      acquisitions?.set(need.system, { resource });
      let leaseActive = true;
      const captureScreenshot = async (boundary: "step" | "before-submit" | "after-submit" = "step"): Promise<void> => {
        if (screenshotOwner === undefined) throw new Error("task screenshot capability is outside its owned lease");
        const assertLeaseActive = (): void => {
          if (!leaseActive || signal.aborted) throw new TaskError(screenshotOwner.taskId, "BROWSER_SCREENSHOT_CAPTURE_FAILED", ERROR_CATALOG.BROWSER_SCREENSHOT_CAPTURE_FAILED.text);
        };
        assertLeaseActive();
        let reason: string | undefined;
        let detail: string | undefined;
        let failure: unknown;
        try {
          const unavailable = await this.#captureLeaseScreenshot(resource, { kind: "task-point", nodeId: screenshotOwner.nodeId, attempt: screenshotOwner.attempt, boundary }, configFingerprint, assertLeaseActive, screenshotOwner.sampleLabels);
          if (unavailable !== undefined) { reason = unavailable.reason; detail = unavailable.detail; failure = new BrowserScreenshotUnavailableError(unavailable.reason); }
        } catch (cause) {
          assertLeaseActive();
          failure = cause;
          reason = cause instanceof Error && ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError", "TimeoutError"].includes(cause.name) ? cause.name : "Error";
        }
        if (reason !== undefined) {
          screenshotOwner.log.warn("Screenshot capture unavailable.", { code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", boundary, reason, captureFailure: detail ?? reason });
          throw new TaskError(screenshotOwner.taskId, "BROWSER_SCREENSHOT_CAPTURE_FAILED", ERROR_CATALOG.BROWSER_SCREENSHOT_CAPTURE_FAILED.text, { cause: failure });
        }
      };
      let diagnosticsActive = false;
      let operationCompleted = false;
      let mayReset = false;
      try {
        signal.throwIfAborted();
        this.#apply(need.system, { type: "lease" });
        this.#observe(need.system, resource);
        resource.beginDiagnostics?.();
        diagnosticsActive = true;
        mayReset = acquisitions !== undefined;
        let result: Result;
        try { result = await withBrowserActionSession(resource.sessionId, () => use(resource.driver, captureScreenshot)); }
        finally { leaseActive = false; }
        resource.endDiagnostics?.();
        diagnosticsActive = false;
        operationCompleted = true;
        if (screenshotOwner === undefined) await withBrowserActionSession(resource.sessionId, () => this.#captureLeaseScreenshot(resource, { kind: "lease-end", outcome: "succeeded" }, configFingerprint));
        mayReset = false;
        await this.#resetLease(resource, signal);
        return result;
      } catch (leaseError) {
        const failures: unknown[] = [leaseError];
        const failedSteps = ["operation"];
        if (diagnosticsActive) {
          resource.endDiagnostics?.();
          try {
            await withBrowserActionSession(resource.sessionId, () => this.#captureLeaseScreenshot(resource, { kind: "lease-end", outcome: "failed" }, configFingerprint, undefined, screenshotOwner?.sampleLabels));
          } catch (captureError) {
            failures.push(captureError);
            failedSteps.push("selected browser screenshot");
          }
        }
        let retainedResource: WorkerBrowserResource | undefined;
        if (mayReset && !signal.aborted && (need.access === "read" || operationCompleted || requiredCaptureFailed(leaseError))) {
          try {
            await this.#resetLease(resource, signal);
            retainedResource = resource;
          } catch (resetError) {
            failures.push(resetError);
            failedSteps.push("session reset");
          }
        }
        if (retainedResource === undefined && heldResource(session) === resource) {
          try {
            await this.#closeSystem(need.system, "poisoned");
          } catch (closeError) {
            failures.push(closeError);
            failedSteps.push("poison-close");
          }
        }
        let failure = leaseError;
        if (failures.length > 1) {
          const summary = failedSteps.length === 2
            ? failedSteps.join(" and ") + " both failed"
            : failedSteps.slice(0, -1).join(", ") + ", and " + failedSteps.at(-1) + " all failed";
          failure = new AggregateError(failures, `${need.system} ${summary}`, { cause: leaseError });
        }
        if (retainedResource === undefined) acquisitions?.set(need.system, { error: failure });
        throw failure;
      }
    });
  }

  async #resetLease(resource: WorkerBrowserResource, signal: AbortSignal): Promise<void> {
    await resource.reset({ signal });
    this.#observeAndApply(resource.system, resource, { type: "reset" });
    this.#emit({ type: "browser-session:reset", system: resource.system, sessionId: resource.sessionId });
  }

  async #captureLeaseScreenshot(
    resource: WorkerBrowserResource,
    trigger: Parameters<RunBrowserScreenshotCapture["capture"]>[0]["trigger"],
    configFingerprint: Fingerprint,
    assertLeaseActive?: () => void,
    sampleLabels?: readonly string[],
  ): Promise<Pick<Extract<BrowserScreenshotEvidence, { state: "unavailable" }>, "reason" | "detail"> | undefined> {
    const context = this.#runScreenshotContext;
    if (context === undefined) {
      if (trigger.kind === "task-point") throw new Error("Required capture has no run binding");
      return;
    }
    if (this.#browserScreenshotCapture === undefined) {
      throw new Error(`run ${context.runId} selected browser screenshots but this worker has no screenshot persistence capability`);
    }
    if (resource.screenshot === undefined) {
      throw new Error(`run ${context.runId} selected browser screenshots but ${resource.system} has no screenshot capability`);
    }
    const screenshot = await resource.screenshot(sampleLabels);
    assertLeaseActive?.();
    await this.#browserScreenshotCapture.capture({
      runId: context.runId,
      descriptorFingerprint: context.descriptorFingerprint,
      configFingerprint,
      system: resource.system,
      trigger,
      screenshot,
      ...(sampleLabels === undefined ? {} : { sampleLabels }),
    });
    if (screenshot.state === "unavailable") return screenshot.detail === undefined ? { reason: screenshot.reason } : { reason: screenshot.reason, detail: screenshot.detail };
  }

  async closeAll(reason: "parked" | "worker-stop"): Promise<void> {
    if (this.#closingReason !== undefined) {
      throw new Error(`worker ${this.#workerId} browser sessions are already closing for ${this.#closingReason}`);
    }
    this.#closingReason = reason;
    let parkingFailure: { error: unknown } | undefined;
    const failures: unknown[] = [];
    try {
      const sessions = [...this.#systems];
      const systems = new Set<BrowserSystemId>([
        ...sessions.filter(([, session]) => heldResource(session) !== undefined).map(([system]) => system),
        ...sessions.filter(([, session]) => session.acquisition !== undefined).map(([system]) => system),
        ...sessions.filter(([, session]) => session.failure !== undefined).map(([system]) => system),
        ...sessions.filter(([, session]) => session.turn !== undefined).map(([system]) => system),
      ]);
      if (reason === "parked" && systems.size > 0) {
        try { this.#onParking?.(); } catch (error) { parkingFailure = { error }; }
      }
      // A pending login's context is closed instead of awaited, so the login ends and closure is proved.
      for (const system of systems) this.#session(system).stopLogin?.(reason);
      for (const system of systems) {
        const starting = this.#session(system).acquisition;
        try {
          await this.#withSystemTurn(
            system,
            new AbortController().signal,
            async () => {
              if (starting !== undefined) {
                const closing = new AbortController();
                const timeout = new Error(`${system} pending acquisition closure exceeded its ${this.#acquireDeadlineMs}ms bound; closure is unproved`);
                const handle = this.#scheduler.schedule(this.#clock.monotonicMs() + this.#acquireDeadlineMs, () => {
                  try { this.#loseCustody(system, { type: "acquisition-close-timeout" }, timeout); }
                  finally { closing.abort(timeout); }
                });
                try { await waitForAcquisition(starting, closing.signal, system); }
                catch (error) {
                  if (error === timeout) throw error;
                  if ((error instanceof BrowserSessionClosureUnprovedError || error instanceof DuoCeremonyReleaseFailedError)
                    && this.#session(system).failure === undefined) failures.push(error);
                } finally {
                  handle.cancel();
                }
              }
              await this.#closeSystem(system, reason);
              const cleanupFailure = this.#session(system).failure;
              if (cleanupFailure !== undefined) failures.push(cleanupFailure);
            },
          );
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      this.#closingReason = undefined;
    }
    if (failures.length > 0) {
      if (parkingFailure !== undefined) failures.push(parkingFailure.error);
      throw new WorkerSessionClosureUnprovedError(this.#workerId, failures);
    }
    if (parkingFailure !== undefined) throw parkingFailure.error;
  }

  async #withSystemTurn<Result>(
    system: BrowserSystemId,
    signal: AbortSignal,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const session = this.#session(system);
    const previous = session.turn ?? Promise.resolve();
    let releaseTurn = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const tail = previous.then(async () => {
      await current;
      if (session.turn === tail) session.turn = undefined;
    });
    session.turn = tail;
    try {
      await waitForTurn(previous, signal, system);
      return await operation();
    } finally {
      releaseTurn();
    }
  }


  async #acquireBounded(
    need: SessionNeed,
    instance: string | undefined,
    configFingerprint: Fingerprint,
    browserMode: BrowserPresentationMode,
    signal: AbortSignal,
    replacesSessionId?: string,
  ): Promise<WorkerBrowserResource> {
    const acquisition = new AbortController();
    const forwardAbort = (): void => {
      acquisition.abort(signal.reason instanceof Error ? signal.reason : abortError(need.system));
    };
    if (signal.aborted) forwardAbort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    let expiry: Error | undefined;
    let deadlineMonotonicMs = this.#clock.monotonicMs() + this.#acquireDeadlineMs;
    const arm = () => this.#scheduler.schedule(
      deadlineMonotonicMs,
      () => {
        expiry = new SessionAcquisitionTimeoutError(need.system, this.#acquireDeadlineMs);
        acquisition.abort(expiry);
      },
    );
    let handle = arm();
    // The acquisition runs under the ACQUISITION signal, so a cooperative
    // login recipe aborts itself at the bound instead of only being raced.
    let staleRequestRecovered = false;
    const started = this.#getOrStart(need, instance, configFingerprint, browserMode, acquisition.signal, {
      deadlineMonotonicMs: () => deadlineMonotonicMs,
      extend: () => {
        handle.cancel();
        deadlineMonotonicMs = this.#clock.monotonicMs() + this.#acquireDeadlineMs;
        handle = arm();
      },
      cancel: (reason) => acquisition.abort(reason),
      claimStaleRequestRecovery: () => {
        if (staleRequestRecovered) return false;
        staleRequestRecovered = true;
        return true;
      },
      ...(replacesSessionId === undefined ? {} : { replacesSessionId }),
    });
    try {
      return await waitForAcquisition(started, acquisition.signal, need.system);
    } catch (error) {
      if (expiry !== undefined) {
        this.#abandonAcquisition(need.system, started);
        throw expiry;
      }
      throw error;
    } finally {
      handle.cancel();
      signal.removeEventListener("abort", forwardAbort);
    }
  }

  // A late acquisition is uncertain; poison-close its session instead of reusing it.
  #abandonAcquisition(system: BrowserSystemId, started: Promise<WorkerBrowserResource>): void {
    void this.#closeAbandonedAcquisition(system, started);
  }

  async #closeAbandonedAcquisition(
    system: BrowserSystemId,
    started: Promise<WorkerBrowserResource>,
  ): Promise<void> {
    let resource: WorkerBrowserResource;
    try {
      resource = await started;
    } catch (error) {
      // A failed abandoned acquisition already owns cleanup; preserve poison state when that cleanup cannot prove closure.
      observeAbandonedAcquisition(error);
      this.#onFailure?.({ system, reason: "abandoned-acquisition-failed" });
      return;
    }
    if (heldResource(this.#session(system)) !== resource) return;
    try {
      await this.#withSystemTurn(
        system,
        new AbortController().signal,
        () => this.#closeSystem(system, "poisoned"),
      );
    } catch (error) {
      // Mark poison before closing and clear it only after proven closure; later leases must refuse uncertain ownership.
      observeAbandonedAcquisition(error);
      this.#onFailure?.({ system, reason: "abandoned-session-close-failed", sessionId: resource.sessionId });
    }
  }

  async #getOrStart(
    need: SessionNeed,
    instance: string | undefined,
    configFingerprint: Fingerprint,
    browserMode: BrowserPresentationMode,
    signal: AbortSignal,
    envelope: AcquisitionEnvelope,
  ): Promise<WorkerBrowserResource> {
    const session = this.#session(need.system);
    if (session.failure !== undefined) throw session.failure;
    if (closureUnproved(session.state)) {
      throw new Error(`${need.system} browser session has an unresolved failed-close proof`);
    }
    const existing = heldResource(session);
    if (existing !== undefined) {

      if (existing.instance !== instance
        || existing.configFingerprint !== configFingerprint
        || effectiveResourceBrowserMode(existing, this.#defaultBrowserMode) !== browserMode) {
        await this.#closeSystem(need.system, "fresh-boundary");
      } else {
        if (need.acceptDownloads === true && !existing.acceptDownloads) {
          throw new Error(`${need.system} reused session was not opened with download acceptance`);
        }
        if (existing.exclusive !== (need.exclusive === true)) {
          throw new Error(`${need.system} reused session exclusivity disagrees with the task need`);
        }
        return existing;
      }
    }
    if (session.acquisition !== undefined) return session.acquisition;
    this.#apply(need.system, { type: "launch" });
    const started = this.#openAndLogin(need, instance, configFingerprint, browserMode, signal, envelope);
    session.acquisition = started;
    try {
      return await started;
    } catch (error) {
      // An acquisition that failed before its factory opened a browser leaves none.
      const browser = browserOf(session.state);
      if (browser.state === "starting" && browser.phase === "launching") this.#apply(need.system, { type: "launch-failed" });
      if (error instanceof DuoCeremonyReleaseFailedError) this.#loseCustody(need.system, { type: "ceremony-release-failed" }, error);
      else if (error instanceof BrowserSessionClosureUnprovedError && heldResource(session) === undefined) {
        this.#loseCustody(need.system, { type: "launch-uncertain" }, error);
      }
      throw error;
    } finally {
      if (session.acquisition === started) session.acquisition = undefined;
    }
  }

  // Hold the same ceremony lease across the single fresh-profile retry.
  async #openAndLogin(
    need: SessionNeed,
    instance: string | undefined,
    configFingerprint: Fingerprint,
    browserMode: BrowserPresentationMode,
    signal: AbortSignal,
    envelope: AcquisitionEnvelope,
  ): Promise<WorkerBrowserResource> {
    const gate = this.#duoCeremony.openGate({
      workerId: this.#workerId,
      system: need.system,
      envelopeDeadlineMonotonicMs: envelope.deadlineMonotonicMs,
      cancelCeremony: envelope.cancel,
      signal,
    });

    // Capture settlement so a dispose failure preserves the primary error as its cause.
    let settled: Readonly<{ state: "returned"; value: WorkerBrowserResource }> | Readonly<{ state: "threw"; error: unknown }>;
    try {
      let value: WorkerBrowserResource;
      try {
        value = await this.#openAndLoginOnce(need, instance, configFingerprint, browserMode, signal, gate, envelope);
      } catch (error) {
        if (this.#controlInFlight || !(error instanceof DuoTerminalRefusalError) || !gate.retainedForRecovery()) throw error;
        // The retry is the same acquisition: it relaunches under the ceremony lease it kept.
        this.#apply(need.system, { type: "launch" });
        const discardProfile = this.#factory.discardProfile;
        if (discardProfile === undefined) {
          throw new Error(
            `${need.system}: Duo refused the WebAuthn assertion and this session factory cannot discard the burned `
            + "browser profile (no discardProfile), so the fresh-profile-once recovery (ref execution-and-sessions §10.5) "
            + "is unavailable; the ceremony lease is released and this login fails",
            { cause: error },
          );
        }
        const { profileDirectory } = await discardProfile.call(this.#factory, {
          workerId: this.#workerId,
          system: need.system,
          ...(instance === undefined ? {} : { instance }),
          configFingerprint,
          browserMode,
        });
        try {
          value = await this.#openAndLoginOnce(need, instance, configFingerprint, browserMode, signal, gate, envelope);
        } catch (retryError) {
          if (retryError instanceof DuoTerminalRefusalError) {
            throw new Error(
              `${need.system}: Duo refused the WebAuthn assertion AGAIN on a freshly created profile at `
              + `${profileDirectory}; the directory is not deleted a third time. The credential's counter needs a human `
              + "(ref execution-and-sessions §10.5; §4.2 names the cause)",
              { cause: retryError },
            );
          }
          throw retryError;
        }
      }
      settled = { state: "returned", value };
    } catch (error) {
      settled = { state: "threw", error };
    }
    if (settled.state === "returned") {
      gate.dispose();
      return settled.value;
    }
    gate.dispose(settled.error);
    throw settled.error;
  }

  async #openAndLoginOnce(
    need: SessionNeed,
    instance: string | undefined,
    configFingerprint: Fingerprint,
    browserMode: BrowserPresentationMode,
    signal: AbortSignal,
    gate: DuoCeremonyGateHandle,
    envelope: AcquisitionEnvelope,
  ): Promise<WorkerBrowserResource> {
    const store = browserStoreFor(this.#stores, need.system);
    const exclusive = store.session.exclusive === true;
    if (exclusive !== (need.exclusive === true)) {
      throw new Error(`${need.system} session exclusivity disagrees with its registered provider`);
    }
    const acquired = this.#onActivity?.("acquiring");
    let resource: WorkerBrowserResource;
    try {
    resource = await this.#factory.open({
      workerId: this.#workerId,
      workflowId: this.#executionWorkflowId,
      system: need.system,
      ...(instance === undefined ? {} : { instance }),
      configFingerprint,
      browserMode,
      acceptDownloads: need.acceptDownloads === true,
      exclusive,
      signal,
      duoCeremony: gate,
      claimStaleRequestRecovery: envelope.claimStaleRequestRecovery,
      ...(envelope.replacesSessionId === undefined ? {} : { replacesSessionId: envelope.replacesSessionId }),
      acquisitionRemainingMs: () => Math.max(0, envelope.deadlineMonotonicMs() - this.#clock.monotonicMs()),
      extendAcquisition: envelope.extend,
    });
    } catch (error) {
      this.#apply(need.system, { type: "launch-failed" });
      throw error;
    } finally { acquired?.(); }
    const session = this.#session(need.system);
    session.browser = { resource, openedAt: this.#clock.now().toISOString(), factory: this.#factory, acquireMs: this.#acquireDeadlineMs, duo: this.#duoCeremony, defaultMode: this.#defaultBrowserMode };
    this.#apply(need.system, { type: "launched" });
    let login: LoginResult;
    let stopClose: Promise<void> | undefined;
    try {
      BrowserSessionIdSchema.parse(resource.sessionId);
      BrowserSystemIdSchema.parse(resource.system);
      if (resource.system !== need.system || resource.driver.system !== need.system) {
        throw new Error(
          `${need.system} session factory returned resource ${resource.system} with driver ${resource.driver.system}`,
        );
      }
      // A resource without browserMode uses the configured compatibility presentation.
      const resourceBrowserMode = effectiveResourceBrowserMode(resource, this.#defaultBrowserMode);
      if (resource.instance !== instance
        || resource.configFingerprint !== configFingerprint
        || resourceBrowserMode !== browserMode
        || resource.acceptDownloads !== (need.acceptDownloads === true)
        || resource.exclusive !== exclusive) {
        throw new Error(`${need.system} session factory returned a resource with mismatched launch options`);
      }
      const authenticated = this.#onActivity?.("authenticating");
      session.stopLogin = reason => {
        if (stopClose === undefined) {
          this.#apply(need.system, { type: "close", reason });
          stopClose = this.#closeResource(need.system, resource, reason, exclusive);
        }
        stopClose.catch(observeAbandonedAcquisition);
      };
      try {
      this.#observe(need.system, resource);
      login = LoginResultSchema.parse(await store.session.login(resource.authentication, {
        ...(instance === undefined ? {} : { instance }),
        signal,
      }));
      } finally {
        session.stopLogin = undefined;
        authenticated?.();
      }
      if (stopClose !== undefined) throw new Error(`${need.system} login was stopped before it settled`);
    } catch (loginError) {
      if (stopClose === undefined) this.#apply(need.system, { type: "login-failed" });
      try {
        await (stopClose ?? this.#closeResource(need.system, resource, "login-failed", exclusive));
      } catch (closeError) {
        throw new AggregateError(
          [loginError, closeError],
          `${need.system} login and cleanup both failed`,
          { cause: closeError },
        );
      }
      throw loginError;
    }
    this.#apply(need.system, { type: "signed-in" });
    this.#observe(need.system, resource);
    this.#emit({
      type: "browser-session:start",
      system: resource.system,
      sessionId: resource.sessionId,
      login,
    });
    return resource;
  }

  async #closeSystem(system: BrowserSystemId, reason: BrowserSessionCloseReason): Promise<void> {
    const resource = heldResource(this.#session(system));
    if (resource === undefined) return;
    const store = browserStoreFor(this.#stores, system);
    this.#apply(system, { type: "close", reason });
    await this.#closeResource(system, resource, reason, store.session.exclusive === true);
  }

  /** Close the system's browser; only a proof that names it leaves the session closed. */
  async #closeResource(
    system: BrowserSystemId,
    resource: WorkerBrowserResource,
    reason: BrowserSessionCloseReason,
    exclusive: boolean,
  ): Promise<void> {
    const closed = this.#onActivity?.("closing");
    let proved = false;
    try {
      const proof = await resource.close({ reason });
      if (proof.sessionId !== resource.sessionId || proof.system !== resource.system) {
        throw new Error(`${resource.system} close proof does not identify the resource that was closed`);
      }
      if (proof.pagesClosed !== true || proof.contextClosed !== true) {
        throw new Error(`${resource.system} close proof is missing page/context closure`);
      }
      if (resource.exclusive !== exclusive) {
        throw new Error(`${resource.system} close proof has inconsistent session exclusivity`);
      }
      if (exclusive && proof.exclusiveLeaseReleased !== true) {
        throw new Error(`${resource.system} close proof is missing exclusive identity-lease release`);
      }
      this.#observeAndApply(system, resource, { type: "close-proved" });
      proved = true;
      const session = this.#session(system);
      if (session.browser?.resource === resource) session.browser = undefined;
      this.#emit({
        type: "browser-session:close",
        system: resource.system,
        sessionId: resource.sessionId,
        reason,
      });
    } catch (error) {
      if (!proved) {
        this.#apply(system, { type: "close-failed" });
        try { this.#observe(system, resource); }
        catch (observationError) { throw new AggregateError([error, observationError], "worker browser close and failure observation failed", { cause: observationError }); }
      }
      throw error;
    } finally { closed?.(); }
  }

  #emit(event: WorkerSessionEventCore): void {
    const common = {
      workerId: this.#workerId,
      workflowId: this.#executionWorkflowId,
      system: event.system,
      sessionId: event.sessionId,
      at: IsoInstantSchema.parse(this.#clock.now().toISOString()),
    };
    if (event.type === "browser-session:close") {
      this.#onEvent({ ...common, type: event.type, reason: event.reason });
      return;
    }
    if (event.type === "browser-session:start") {
      this.#onEvent({ ...common, type: event.type, login: event.login });
      return;
    }
    this.#onEvent({ ...common, type: event.type });
  }
}
