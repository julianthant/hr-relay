import { WorkerControlRefusal, WorkerBrowserObservationSchema, type WorkerBrowserObservation } from "../../domain/worker-control.js";
/**
 * Worker-local browser ownership (ref execution-and-sessions §§2,4,6.1).
 *
 * Drivers are exposed only inside `withDriver`'s awaited callback. A system is
 * serialized within one worker, a clean release resets before reuse, and every
 * uncertain release poison-closes the resource. An authored `fresh` need
 * closes the old resource before the replacement can emit `start`.
 */
import { z } from "zod";
import type {
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../../base/session.js";
import type { BrowserDriver } from "../../base/task.js";
import type { RunBrowserScreenshotCapture } from "../../base/diagnostics.js";
import type { Clock } from "../../domain/clock.js";
import { DuoTerminalRefusalError } from "../systems/browser-shared/login-contract.js";
import { withBrowserActionSession } from "../systems/browser-shared/action-notes.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";
import type { DuoCeremonyGateFactory, DuoCeremonyGateHandle } from "./duo-ceremony-gate.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../domain/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  Fingerprint,
  WorkerId,
  WorkflowId,
} from "../../domain/ids.js";
import { BrowserPresentationModeSchema } from "../../domain/run/envelope.js";
import type { BrowserPresentationMode } from "../../domain/run/envelope.js";
import { LoginResultSchema, SessionNeedSchema } from "../../domain/session.js";
import type { LoginResult, SessionNeed } from "../../domain/session.js";
import type { RegisteredTaskStore, TaskStoreRegistry } from "../../base/store.js";

export type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../../base/session.js";

export type WorkerSessionEvent =
  | Readonly<{
    type: "browser-session:start";
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
    /**
     * Whether this session had to authenticate or rode a live one. Both are
     * legitimate, and they are NOT interchangeable to an operator: a run of
     * `already-authenticated` sessions that should have been cold is exactly
     * the shape of the 2026-08-03 false pass, and an event that flattened the
     * two hid it.
     */
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
  readonly stores: TaskStoreRegistry;
  readonly factory: WorkerBrowserSessionFactory;
  /** Compatibility mode for historical envelopes that predate browserMode. */
  readonly defaultBrowserMode?: BrowserPresentationMode;
  readonly clock: Clock;
  /**
   * The kernel-owned monotonic deadline port — the SAME one the interpreter
   * arms task deadlines on, so a test drives acquisition time explicitly
   * instead of waiting on a wall clock (D125).
   */
  readonly scheduler: MonotonicDeadlineScheduler;
  /**
   * D125: the bound on ONE acquisition — `factory.open` plus the system's
   * login recipe. Required, with no default: a manager that could be built
   * without it would silently inherit the whole-task deadline again, which is
   * exactly the defect this closes. Non-positive values fail loud.
   */
  readonly acquireDeadlineMs: number;
  /**
   * D267 (ref execution-and-sessions §10): the per-credential Duo ceremony
   * lease. Required, with no default: a manager built without it would hand
   * every login recipe no gate, and the recipe's ceremony half could not run —
   * which is the correct refusal, made at construction instead of mid-login.
   */
  readonly duoCeremony: DuoCeremonyGateFactory;
  readonly onEvent?: (event: WorkerSessionEvent) => void;
  readonly onObservation?: (observation: Omit<WorkerBrowserObservation, "leaseGeneration">) => void;
  /** Production persistence seam for explicit per-run browser screenshots. */
  readonly browserScreenshotCapture?: RunBrowserScreenshotCapture;
}

/** What `#acquireBounded` knows about its own envelope, handed down to the lease gate. */
interface AcquisitionEnvelope {
  readonly deadlineMonotonicMs: number;
  readonly cancel: (reason: Error) => void;
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

function abortError(system: BrowserSystemId): Error {
  return new Error(`${system} driver lease was aborted before acquisition`);
}

/**
 * D125. The message names the bound, its config leaf, and the ONE other leaf
 * an operator might legitimately need to move — because the failure an
 * operator sees at 60s must be actionable without reading this file.
 */
function acquisitionDeadlineError(system: BrowserSystemId, boundMs: number): Error {
  return new Error(
    `${system} browser-session acquisition (open + login) exceeded its ${String(boundMs)}ms `
    + "timeouts.sessionAcquireMs bound; the session is treated as dead and this lease fails. "
    + "This bound is deliberately much shorter than timeouts.taskMs, which covers the READ once a "
    + "driver is in hand. If this deployment approves Duo by hand rather than through Duo Autopilot, "
    + "raise timeouts.sessionAcquireMs above timeouts.duoApprovalSeconds — never lengthen taskMs to "
    + "hide a dead session.",
  );
}

/**
 * The settled loser of an acquisition race. It is not discarded evidence: the
 * lease has already thrown the deadline error the operator sees, and
 * `#closeAbandonedAcquisition` owns whatever cleanup the late settlement
 * implies. This exists only so a promise nobody awaits any more cannot be
 * reported as an unhandled rejection.
 */
function observeAbandonedAcquisition(error: unknown): void {
  void error;
}

/**
 * Race one acquisition against its own bound. The loser is OBSERVED, never
 * swallowed: if the acquisition settles after losing, its own settlement is
 * handled by `#abandonAcquisition`, and this handler only keeps Node from
 * reporting an unhandled rejection for a promise nobody awaits any more.
 */
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

/**
 * The bind/release half of D116 (ref clock-config-secrets §4) as a first-class surface: the
 * caller that OWNS a run context — the worker loop for its claimed run, ref write-safety
 * §4 recovery for a target run's out-of-loop probe lease — binds that run's
 * retained immutable `configFingerprint` for exactly the duration of the
 * operation and releases it afterwards, success or failure.
 */
export interface RunConfigFingerprintBinding {
  bindRunConfigFingerprint(
    fingerprint: Fingerprint,
    browserMode?: BrowserPresentationMode,
    screenshotContext?: Readonly<{
      runId: string;
      descriptorFingerprint: string;
      captureBrowserScreenshots?: boolean;
    }>,
  ): void;
  releaseRunConfigFingerprint(): void;
}

/**
 * One-way ownership transition for ref write-safety's durable fence.
 * Before this arm is called, parent cancellation has ordinary `withDriver`
 * semantics. Afterwards cancellation is retained until the callback settles.
 */
export interface TransactionDriverLeaseOwnership {
  retainAfterFence(): void;
}

class TransactionDriverLeaseOwnershipState implements TransactionDriverLeaseOwnership {
  #retained = false;
  #cancellation: Error | undefined;

  retainAfterFence(): void {
    if (this.#retained) throw new Error("transaction driver lease was retained after its fence more than once");
    if (this.#cancellation !== undefined) throw this.#cancellation;
    this.#retained = true;
  }

  retainCancellation(error: Error): boolean {
    this.#cancellation ??= error;
    return this.#retained;
  }

  cancellation(): Error | undefined {
    return this.#cancellation;
  }

  retained(): boolean {
    return this.#retained;
  }
}

function containsFailure(root: unknown, target: unknown, seen = new Set<unknown>()): boolean {
  if (root === target) return true;
  if (root === null || typeof root !== "object" || seen.has(root)) return false;
  seen.add(root);
  if (root instanceof AggregateError) {
    return root.errors.some((error: unknown) => containsFailure(error, target, seen));
  }
  return root instanceof Error && containsFailure(root.cause, target, seen);
}

async function waitForTransactionOperation<Result>(
  start: (ownership: TransactionDriverLeaseOwnership) => Promise<Result>,
  signal: AbortSignal,
  system: BrowserSystemId,
): Promise<Result> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError(system);
  const ownership = new TransactionDriverLeaseOwnershipState();
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      const reason = signal.reason instanceof Error
        ? signal.reason
        : new Error(`${system} transaction driver lease was aborted during use`);
      if (!ownership.retainCancellation(reason)) reject(reason);
    };
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  const operation = Promise.resolve().then(() => start(ownership));
  try {
    const result = await Promise.race([operation, aborted]);
    const cancellation = ownership.cancellation();
    if (cancellation !== undefined) throw cancellation;
    return result;
  } catch (operationError) {
    const cancellation = ownership.cancellation();
    if (ownership.retained()
      && cancellation !== undefined
      && !containsFailure(operationError, cancellation)) {
      throw new AggregateError(
        [operationError, cancellation],
        `${system} transaction operation failed after its retained parent cancellation`,
        { cause: operationError },
      );
    }
    throw operationError;
  } finally {
    removeAbort();
  }
}

/**
 * The ONE bind/execute/release discipline every run-scoped driver-lease window
 * uses (worker loop and tests alike). A bind failure throws BEFORE `operation`
 * runs — a second concurrent run binding, or a malformed fingerprint, is a
 * loud precondition refusal, never a silently unbound lease.
 */
export async function withBoundRunConfigFingerprint<Result>(
  sessions: RunConfigFingerprintBinding,
  fingerprint: Fingerprint,
  operation: () => Promise<Result>,
  browserMode?: BrowserPresentationMode,
  screenshotContext?: Readonly<{
    runId: string;
    descriptorFingerprint: string;
    captureBrowserScreenshots?: boolean;
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
  readonly #workflowId: WorkflowId;
  readonly #stores: TaskStoreRegistry;
  #factory: WorkerBrowserSessionFactory;
  readonly #clock: Clock;
  readonly #scheduler: MonotonicDeadlineScheduler;
  #acquireDeadlineMs: number;
  #duoCeremony: DuoCeremonyGateFactory;
  readonly #onEvent: (event: WorkerSessionEvent) => void;
  #defaultBrowserMode: BrowserPresentationMode;
  readonly #browserScreenshotCapture: RunBrowserScreenshotCapture | undefined;
  readonly #onObservation: WorkerSessionManagerOptions["onObservation"];
  #controlInFlight = false;
  readonly #retained = new Map<string, Readonly<{ openedAt: string; factory: WorkerBrowserSessionFactory; acquireMs: number; duo: DuoCeremonyGateFactory; defaultMode: BrowserPresentationMode }>>();
  readonly #resources = new Map<BrowserSystemId, WorkerBrowserResource>();
  readonly #poisoned = new Set<BrowserSystemId>();
  readonly #starting = new Map<BrowserSystemId, Promise<WorkerBrowserResource>>();
  readonly #tails = new Map<BrowserSystemId, Promise<void>>();
  #closingReason: "parked" | "worker-stop" | undefined;
  #runConfigFingerprint: Fingerprint | undefined;
  #runBrowserMode: BrowserPresentationMode | undefined;
  #runScreenshotContext: Readonly<{
    runId: string;
    descriptorFingerprint: string;
    captureBrowserScreenshots: boolean;
  }> | undefined;

  constructor(options: WorkerSessionManagerOptions) {
    this.#workerId = WorkerIdSchema.parse(options.workerId);
    this.#workflowId = WorkflowIdSchema.parse(options.workflowId);
    this.#stores = options.stores;
    this.#onObservation = options.onObservation;
    this.#factory = options.factory;
    this.#defaultBrowserMode = BrowserPresentationModeSchema.parse(options.defaultBrowserMode ?? "headless");
    this.#browserScreenshotCapture = options.browserScreenshotCapture;
    this.#clock = options.clock;
    this.#scheduler = options.scheduler;
    this.#acquireDeadlineMs = z.number().int().positive().parse(options.acquireDeadlineMs);
    this.#duoCeremony = options.duoCeremony;
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  configureRunResources(resources: Readonly<{sessionFactory:WorkerBrowserSessionFactory;sessionAcquireMs:number;duoCeremony:DuoCeremonyGateFactory;defaultBrowserMode:BrowserPresentationMode}>): void {
    if (this.#controlInFlight || this.#runConfigFingerprint !== undefined || this.#starting.size > 0) throw new Error("run-resources-cannot-change-during-execution");
    this.#factory = resources.sessionFactory;
    this.#acquireDeadlineMs = z.number().int().positive().parse(resources.sessionAcquireMs);
    this.#duoCeremony = resources.duoCeremony;
    this.#defaultBrowserMode = BrowserPresentationModeSchema.parse(resources.defaultBrowserMode);
  }

  activeSystems(): readonly BrowserSystemId[] {
    return Object.freeze([...this.#resources.keys()]);
  }

  /** Refuse synchronously; no wait-for-idle action survives a busy target. */
  assertControlTarget(sessionId: string): WorkerBrowserResource {
    if (this.#controlInFlight || this.#runConfigFingerprint !== undefined || this.#starting.size > 0 || this.#tails.size > 0 || this.#closingReason !== undefined) throw new WorkerControlRefusal("worker-browser-busy");
    const resource = [...this.#resources.values()].find(value => value.sessionId === sessionId);
    if (resource === undefined) throw new WorkerControlRefusal("worker-browser-session-unavailable");
    if (this.#poisoned.has(resource.system)) throw new WorkerControlRefusal("worker-browser-unproven-close");
    if (resource.browserMode === undefined || !this.#retained.has(resource.sessionId)) throw new WorkerControlRefusal("worker-browser-retained-settings-unavailable");
    return resource;
  }

  async controlBrowser(type: "refresh-browser" | "reopen-browser", sessionId: string, signal: AbortSignal): Promise<WorkerBrowserResource> {
    const resource = this.assertControlTarget(sessionId);
    const retained = this.#retained.get(resource.sessionId);
    if (retained === undefined) throw new WorkerControlRefusal("worker-browser-retained-settings-unavailable");
    this.#controlInFlight = true;
    const current = { factory: this.#factory, acquireMs: this.#acquireDeadlineMs, duo: this.#duoCeremony, defaultMode: this.#defaultBrowserMode };
    try {
      return await this.#withSystemTurn(resource.system, signal, async () => {
      this.#observe(resource, "unknown");
      if (type === "refresh-browser") {
        // The resource factory's neutral reset includes content-level authentication proof.
        await resource.reset({ signal });
        this.#observe(resource, "authenticated");
        this.#emit({ type: "browser-session:reset", system: resource.system, sessionId: resource.sessionId });
        return resource;
      }
      await this.#closeSystem(resource.system, "operator-reopen");
      this.#factory = retained.factory;
      this.#acquireDeadlineMs = retained.acquireMs;
      this.#duoCeremony = retained.duo;
      this.#defaultBrowserMode = retained.defaultMode;
      const replacement = await this.#acquireBounded(SessionNeedSchema.parse({ system: resource.system, session: "reuse-worker", access: "read", ...(resource.acceptDownloads ? { acceptDownloads: true } : {}), ...(resource.exclusive ? { exclusive: true } : {}) }), resource.instance, resource.configFingerprint, BrowserPresentationModeSchema.parse(resource.browserMode), signal);
      if (replacement.sessionId === resource.sessionId || replacement.profileDirectory !== resource.profileDirectory) {
        await this.#closeSystem(replacement.system, "poisoned");
        throw new Error("worker-browser-replacement-identity-mismatch");
      }
      return replacement;
      });
    } catch (error) {
      const remaining = this.#resources.get(resource.system);
      if (remaining !== undefined) {
        this.#poisoned.add(remaining.system);
        this.#observe(remaining, "failed");
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

  #observe(resource: WorkerBrowserResource, health: WorkerBrowserObservation["health"]): void {
    this.#onObservation?.(WorkerBrowserObservationSchema.omit({ leaseGeneration: true }).parse({ ...(this.#retained.get(resource.sessionId) === undefined ? {} : { openedAt: this.#retained.get(resource.sessionId)?.openedAt }), workerId: this.#workerId, sessionId: resource.sessionId, system: resource.system,
      ...(resource.instance === undefined ? {} : { instance: resource.instance }), configFingerprint: resource.configFingerprint,
      browserMode: effectiveResourceBrowserMode(resource, this.#defaultBrowserMode),
      ...(resource.profileDirectory === undefined ? {} : { profileDirectory: resource.profileDirectory }),
      acceptDownloads: resource.acceptDownloads, exclusive: resource.exclusive, health, observedAt: this.#clock.now().toISOString() }));
  }

  /**
   * D116 (ref clock-config-secrets §4): the worker loop binds the claimed run's immutable
   * `configFingerprint` before any task executes, making the fingerprint part
   * of the session lookup identity rather than evidence metadata. Exactly one
   * run is bound at a time — a second bind without a release is a programming
   * error and fails loud.
   */
  bindRunConfigFingerprint(
    fingerprint: Fingerprint,
    browserMode?: BrowserPresentationMode,
    screenshotContext?: Readonly<{
      runId: string;
      descriptorFingerprint: string;
      captureBrowserScreenshots?: boolean;
    }>,
  ): void {
    const parsed = FingerprintSchema.parse(fingerprint);
    if (this.#controlInFlight) throw new WorkerControlRefusal("worker-browser-control-in-progress");
    if (this.#runConfigFingerprint !== undefined) {
      throw new Error(
        `worker ${this.#workerId} already has a bound run config fingerprint; one worker owns one active run`,
      );
    }
    this.#runConfigFingerprint = parsed;
    this.#runBrowserMode = BrowserPresentationModeSchema.parse(browserMode ?? this.#defaultBrowserMode);
    this.#runScreenshotContext = screenshotContext === undefined
      ? undefined
      : Object.freeze({
        runId: screenshotContext.runId,
        descriptorFingerprint: screenshotContext.descriptorFingerprint,
        captureBrowserScreenshots: screenshotContext.captureBrowserScreenshots === true,
      });
  }

  releaseRunConfigFingerprint(): void {
    if (this.#runConfigFingerprint === undefined) {
      throw new Error(`worker ${this.#workerId} has no bound run config fingerprint to release`);
    }
    this.#runConfigFingerprint = undefined;
    this.#runBrowserMode = undefined;
    this.#runScreenshotContext = undefined;
  }

  async withDriver<Result>(
    needInput: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (driver: BrowserDriver) => Promise<Result>,
  ): Promise<Result> {
    const need = SessionNeedSchema.parse(needInput);
    return this.#withDriverLease(need, instance, signal, (driver) => waitForOperation(
      Promise.resolve().then(() => operation(driver)),
      signal,
      need.system,
    ));
  }

  async withTransactionDriver<Result>(
    needInput: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (driver: BrowserDriver, ownership: TransactionDriverLeaseOwnership) => Promise<Result>,
  ): Promise<Result> {
    const need = SessionNeedSchema.parse(needInput);
    if (need.access !== "transaction") {
      throw new Error(`${need.system} retained driver lease requires transaction access`);
    }
    return this.#withDriverLease(need, instance, signal, (driver) =>
      waitForTransactionOperation(
        (ownership) => operation(driver, ownership),
        signal,
        need.system,
      ));
  }

  async #withDriverLease<Result>(
    need: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    use: (driver: BrowserDriver) => Promise<Result>,
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
        `${need.system} driver lease requires the claimed run's bound config fingerprint (D116); none is bound`,
      );
    }
    if (browserMode === undefined) {
      throw new Error(`${need.system} driver lease requires the claimed run's bound browser presentation; none is bound`);
    }
    return this.#withSystemTurn(need.system, signal, async () => {
      if (need.session === "fresh") {
        await this.#closeSystem(need.system, "fresh-boundary");
      }
      const resource = await this.#acquireBounded(need, instance, configFingerprint, browserMode, signal);
      let operationCompleted = false;
      const screenshotFailures: unknown[] = [];
      const poisonCloseFailures: unknown[] = [];
      try {
        this.#observe(resource, "unknown");
        const result = await withBrowserActionSession(resource.sessionId, () => use(resource.driver));
        operationCompleted = true;
        await this.#captureLeaseScreenshot(resource, "succeeded", configFingerprint);
        await resource.reset({ signal });
        this.#observe(resource, "authenticated");
        this.#emit({
          type: "browser-session:reset",
          system: resource.system,
          sessionId: resource.sessionId,
        });
        return result;
      } catch (leaseError) {
        const failures: unknown[] = [leaseError];
        if (!operationCompleted) {
          try {
            await this.#captureLeaseScreenshot(resource, "failed", configFingerprint);
          } catch (captureError) {
            screenshotFailures.push(captureError);
          }
        }
        if (this.#resources.get(need.system) === resource) {
          try {
            await this.#closeSystem(need.system, "poisoned");
          } catch (closeError) {
            poisonCloseFailures.push(closeError);
          }
        }
        failures.push(...screenshotFailures, ...poisonCloseFailures);
        if (failures.length > 1) {
          const failureSummary = screenshotFailures.length > 0 && poisonCloseFailures.length > 0
            ? "operation, selected browser screenshot, and poison-close all failed"
            : screenshotFailures.length > 0
              ? "operation and selected browser screenshot both failed"
              : "operation and poison-close both failed";
          throw new AggregateError(
            failures,
            `${need.system} ${failureSummary}`,
            { cause: leaseError },
          );
        }
        throw leaseError;
      }
    });
  }

  async #captureLeaseScreenshot(
    resource: WorkerBrowserResource,
    leaseOutcome: "succeeded" | "failed",
    configFingerprint: Fingerprint,
  ): Promise<void> {
    const context = this.#runScreenshotContext;
    if (context?.captureBrowserScreenshots !== true) return;
    if (this.#browserScreenshotCapture === undefined) {
      throw new Error(`run ${context.runId} selected browser screenshots but this worker has no screenshot persistence capability`);
    }
    if (resource.screenshot === undefined) {
      throw new Error(`run ${context.runId} selected browser screenshots but ${resource.system} has no screenshot capability`);
    }
    const screenshot = await resource.screenshot();
    await this.#browserScreenshotCapture.capture({
      runId: context.runId,
      descriptorFingerprint: context.descriptorFingerprint,
      configFingerprint,
      system: resource.system,
      leaseOutcome,
      screenshot,
    });
  }

  async closeAll(reason: "parked" | "worker-stop"): Promise<void> {
    if (this.#closingReason !== undefined) {
      throw new Error(`worker ${this.#workerId} browser sessions are already closing for ${this.#closingReason}`);
    }
    this.#closingReason = reason;
    const failures: unknown[] = [];
    try {
      const systems = new Set<BrowserSystemId>([
        ...this.#resources.keys(),
        ...this.#starting.keys(),
        ...this.#tails.keys(),
      ]);
      for (const system of systems) {
        try {
          await this.#withSystemTurn(
            system,
            new AbortController().signal,
            () => this.#closeSystem(system, reason),
          );
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      this.#closingReason = undefined;
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `worker ${this.#workerId} failed to close every browser session`);
    }
  }

  async #withSystemTurn<Result>(
    system: BrowserSystemId,
    signal: AbortSignal,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.#tails.get(system) ?? Promise.resolve();
    let releaseTurn = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(system, tail);
    try {
      await waitForTurn(previous, signal, system);
      return await operation();
    } finally {
      releaseTurn();
      if (this.#tails.get(system) === tail) this.#tails.delete(system);
    }
  }

  /**
   * D125 — acquisition is bounded SEPARATELY from the task that wants it.
   *
   * The live exit run (2026-08-04, `pl-000619-4ebf`) spent 262.9s inside one
   * `withDriver` because the only bound reaching this code was the
   * interpreter's whole-task deadline. `#openAndLogin` is a chain of
   * individually-bounded steps — `factory.open`, then a login recipe whose
   * navigations and Duo window each carry their own timeout — and nothing
   * bounded the CHAIN. The task deadline cannot do that job: it must stay long
   * enough for the real read (UCPath person-org ~22s, Kuali fill→save→reload→
   * verify 8–10s per cycle), and by the time it would have fired, claim expiry
   * had already requeued the run. So acquisition gets its own, much shorter,
   * kernel-scheduled monotonic bound, and blowing it FAILS — it is never
   * converted into a silent retry that hides a dead session.
   */
  async #acquireBounded(
    need: SessionNeed,
    instance: string | undefined,
    configFingerprint: Fingerprint,
    browserMode: BrowserPresentationMode,
    signal: AbortSignal,
  ): Promise<WorkerBrowserResource> {
    const acquisition = new AbortController();
    const forwardAbort = (): void => {
      acquisition.abort(signal.reason instanceof Error ? signal.reason : abortError(need.system));
    };
    if (signal.aborted) forwardAbort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    let expiry: Error | undefined;
    const deadlineMonotonicMs = this.#clock.monotonicMs() + this.#acquireDeadlineMs;
    const handle = this.#scheduler.schedule(
      deadlineMonotonicMs,
      () => {
        expiry = acquisitionDeadlineError(need.system, this.#acquireDeadlineMs);
        acquisition.abort(expiry);
      },
    );
    // The acquisition runs under the ACQUISITION signal, so a cooperative
    // login recipe aborts itself at the bound instead of only being raced.
    const started = this.#getOrStart(need, instance, configFingerprint, browserMode, acquisition.signal, {
      deadlineMonotonicMs,
      cancel: (reason) => acquisition.abort(reason),
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

  /**
   * An acquisition that outlived its bound is UNCERTAIN, so a session it
   * produces late is poison-closed rather than inherited by the next lease as
   * a warm reuse. A close that cannot be proven leaves `#poisoned` set, and
   * the next `#getOrStart` refuses by name — the failure is retained in
   * manager state, which is why nothing is rethrown out of a background task
   * nobody awaits.
   */
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
      // The abandoned acquisition failed on its own terms, which means
      // `#openAndLogin` already ran its PROVEN cleanup (or retained the
      // system as poisoned when it could not prove one). Nothing is left for
      // this observer to do.
      observeAbandonedAcquisition(error);
      return;
    }
    if (this.#resources.get(system) !== resource) return;
    try {
      await this.#withSystemTurn(
        system,
        new AbortController().signal,
        () => this.#closeSystem(system, "poisoned"),
      );
    } catch (error) {
      // `#closeSystem` marks `#poisoned` BEFORE closing and clears it only on
      // a proven close, so an unprovable close is RETAINED in manager state
      // and the next `#getOrStart` refuses this system by name. The fact is
      // kept; only the rethrow is dropped, because no caller awaits this.
      observeAbandonedAcquisition(error);
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
    if (this.#poisoned.has(need.system)) {
      throw new Error(`${need.system} browser session has an unresolved failed-close proof`);
    }
    const existing = this.#resources.get(need.system);
    if (existing !== undefined) {
      // D116 (ref clock-config-secrets §4, ref execution-and-sessions §7): reuse requires the COMPLETE identity —
      // worker (this manager), system, resolved instance, AND the run's
      // config fingerprint. Any drift proves the old context closed (a forced
      // fresh boundary) before a replacement is authenticated; a context
      // configured under another run snapshot is never reused.
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
    const pending = this.#starting.get(need.system);
    if (pending !== undefined) return pending;
    const started = this.#openAndLogin(need, instance, configFingerprint, browserMode, signal, envelope);
    this.#starting.set(need.system, started);
    try {
      return await started;
    } finally {
      if (this.#starting.get(need.system) === started) this.#starting.delete(need.system);
    }
  }

  /**
   * D267 §10.5 — ONE acquisition, with the fresh-profile-once recovery around
   * it. The Duo ceremony gate is opened here and HELD across the retry: a
   * terminal refusal poison-closes the resource (proof required — the
   * directory cannot be touched while a context may hold it), the factory
   * removes and recreates the SAME profile path, and the login runs once more
   * under the lease the gate still holds. A second refusal fails loud naming
   * the directory and never deletes a third time; every other login failure
   * takes the ordinary path. `dispose` in `finally` releases whatever the
   * gate still holds, so a recovery that dies between the two attempts cannot
   * strand the credential.
   */
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
    // Finding 1 (ref execution-and-sessions §10.4): the settlement is captured as DATA, exactly as
    // the gate's own `withCeremony` does, rather than reached through `try { … } finally { gate.dispose() }`.
    // A plain `finally` cannot hand `dispose()` the error it is unwinding, so a release failure there
    // would silently REPLACE this call's own thrown error instead of preserving it as `cause`.
    let settled: Readonly<{ state: "returned"; value: WorkerBrowserResource }> | Readonly<{ state: "threw"; error: unknown }>;
    try {
      let value: WorkerBrowserResource;
      try {
        value = await this.#openAndLoginOnce(need, instance, configFingerprint, browserMode, signal, gate);
      } catch (error) {
        if (this.#controlInFlight || !(error instanceof DuoTerminalRefusalError) || !gate.retainedForRecovery()) throw error;
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
          value = await this.#openAndLoginOnce(need, instance, configFingerprint, browserMode, signal, gate);
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
  ): Promise<WorkerBrowserResource> {
    const store = browserStoreFor(this.#stores, need.system);
    const exclusive = store.session.exclusive === true;
    if (exclusive !== (need.exclusive === true)) {
      throw new Error(`${need.system} session exclusivity disagrees with its registered provider`);
    }
    const resource = await this.#factory.open({
      workerId: this.#workerId,
      workflowId: this.#workflowId,
      system: need.system,
      ...(instance === undefined ? {} : { instance }),
      configFingerprint,
      browserMode,
      acceptDownloads: need.acceptDownloads === true,
      exclusive,
      signal,
      duoCeremony: gate,
    });
    let login: LoginResult;
    try {
      BrowserSessionIdSchema.parse(resource.sessionId);
      BrowserSystemIdSchema.parse(resource.system);
      if (resource.system !== need.system || resource.driver.system !== need.system) {
        throw new Error(
          `${need.system} session factory returned resource ${resource.system} with driver ${resource.driver.system}`,
        );
      }
      // `browserMode` was added after the fixture/session port, so a legacy
      // resource means the manager's configured default presentation. That
      // compatibility is deliberately one-way: an omitted echo can satisfy
      // headless only; a per-run headed request still has to be positively
      // echoed by the factory before a session can be used.
      const resourceBrowserMode = effectiveResourceBrowserMode(resource, this.#defaultBrowserMode);
      if (resource.instance !== instance
        || resource.configFingerprint !== configFingerprint
        || resourceBrowserMode !== browserMode
        || resource.acceptDownloads !== (need.acceptDownloads === true)
        || resource.exclusive !== exclusive) {
        throw new Error(`${need.system} session factory returned a resource with mismatched launch options`);
      }
      login = LoginResultSchema.parse(await store.session.login(resource.authentication, {
        ...(instance === undefined ? {} : { instance }),
        signal,
      }));
    } catch (loginError) {
      try {
        await this.#closeResource(resource, "login-failed", exclusive);
      } catch (closeError) {
        this.#resources.set(need.system, resource);
        this.#poisoned.add(need.system);
        throw new AggregateError(
          [loginError, closeError],
          `${need.system} login and cleanup both failed`,
          { cause: closeError },
        );
      }
      throw loginError;
    }
    this.#resources.set(need.system, resource);
    this.#retained.set(resource.sessionId, { openedAt: this.#clock.now().toISOString(), factory: this.#factory, acquireMs: this.#acquireDeadlineMs, duo: this.#duoCeremony, defaultMode: this.#defaultBrowserMode });
    this.#observe(resource, "authenticated");
    this.#emit({
      type: "browser-session:start",
      system: resource.system,
      sessionId: resource.sessionId,
      login,
    });
    return resource;
  }

  async #closeSystem(system: BrowserSystemId, reason: BrowserSessionCloseReason): Promise<void> {
    const resource = this.#resources.get(system);
    if (resource === undefined) return;
    const store = browserStoreFor(this.#stores, system);
    this.#poisoned.add(system);
    await this.#closeResource(resource, reason, store.session.exclusive === true);
    if (this.#resources.get(system) === resource) this.#resources.delete(system);
    this.#poisoned.delete(system);
  }

  async #closeResource(
    resource: WorkerBrowserResource,
    reason: BrowserSessionCloseReason,
    exclusive: boolean,
  ): Promise<void> {
    const proof = await resource.close({ reason });
    if (proof.sessionId !== resource.sessionId || proof.system !== resource.system) {
      throw new Error(`${resource.system} close proof does not identify the resource that was closed`);
    }
    if (proof.pagesClosed !== true || proof.contextClosed !== true) {
      throw new Error(`${resource.system} close proof is missing page/context closure`);
    }
    if (exclusive && proof.exclusiveLeaseReleased !== true) {
      throw new Error(`${resource.system} close proof is missing exclusive identity-lease release`);
    }
    this.#observe(resource, "closed");
    this.#retained.delete(resource.sessionId);
    this.#emit({
      type: "browser-session:close",
      system: resource.system,
      sessionId: resource.sessionId,
      reason,
    });
  }

  #emit(event: WorkerSessionEventCore): void {
    const common = {
      workerId: this.#workerId,
      workflowId: this.#workflowId,
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
