import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { mintWorkerControlClosure, type WorkerControlClosure } from "../../storage/sqlite/worker-control.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { WorkerLifecycleBindingSchema, WorkerResetBindingSchema, type WorkerLifecycleBinding, type WorkerResetBinding } from "../../../models/run/worker-control.js";
import { WorkerControlRefusal, WorkerBrowserObservationSchema, type WorkerBrowserObservation } from "../../../models/run/worker-control.js";

import { z } from "zod";
import type {
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../../../workflow-kit/session.js";
import type { BrowserDriver } from "../../../workflow-kit/task.js";
import type { RunBrowserScreenshotCapture } from "../../../workflow-kit/diagnostics.js";
import type { Clock } from "../../../rules/time/clock.js";
import { DuoTerminalRefusalError } from "../../systems/browser-shared/login-contract.js";
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
  readonly resetOwner?: Pick<WorkerResetBinding, "member" | "lifetime">;
  readonly workerId: WorkerId;
  readonly workflowId: WorkflowId;
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
  readonly onActivity?: (activity: "acquiring" | "authenticating" | "closing") => () => void;
  readonly onObservation?: (observation: Omit<WorkerBrowserObservation, "leaseGeneration">) => void;
  /** Production persistence seam for explicit per-run browser screenshots. */
  readonly browserScreenshotCapture?: RunBrowserScreenshotCapture;
}

/** What `#acquireBounded` knows about its own envelope, handed down to the lease gate. */
interface AcquisitionEnvelope {
  readonly deadlineMonotonicMs: number;
  readonly cancel: (reason: Error) => void;
  readonly claimStaleRequestRecovery: () => boolean;
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
      captureBrowserScreenshots?: boolean;
    }>,
  ): void;
  releaseRunConfigFingerprint(): void;
}

// After the durable fence, parent cancellation cannot interrupt the transaction lease.
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
  readonly #onActivity: WorkerSessionManagerOptions["onActivity"];
  readonly #onObservation: WorkerSessionManagerOptions["onObservation"];
  readonly #resetOwner: Pick<WorkerResetBinding, "member" | "lifetime"> | undefined;
  #resetEpoch = 0;
  readonly #observedSessions = new Set<string>();
  #controlInFlight = false;
  readonly #retained = new Map<string, Readonly<{ openedAt: string; factory: WorkerBrowserSessionFactory; acquireMs: number; duo: DuoCeremonyGateFactory; defaultMode: BrowserPresentationMode }>>();
  readonly #resources = new Map<BrowserSystemId, WorkerBrowserResource>();
  readonly #poisoned = new Set<BrowserSystemId>();
  readonly #acquisitionCleanupFailures = new Map<BrowserSystemId, Error>();
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
    this.#resetOwner = options.resetOwner === undefined ? undefined : structuredClone(options.resetOwner);
    this.#workerId = WorkerIdSchema.parse(options.workerId);
    this.#workflowId = WorkflowIdSchema.parse(options.workflowId);
    this.#stores = options.stores;
    this.#onObservation = options.onObservation;
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
    this.#resetEpoch += 1;
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
      profileRevision: resource.profileRevision,
      signInFingerprint: resource.signInFingerprint,
      browserMode: effectiveResourceBrowserMode(resource, this.#defaultBrowserMode),
      ...(resource.profileDirectory === undefined ? {} : { profileDirectory: resource.profileDirectory }),
      acceptDownloads: resource.acceptDownloads, exclusive: resource.exclusive, health, observedAt: this.#clock.now().toISOString() }));
  }


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
    this.#resetEpoch += 1;
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
    return this.#withSystemTurn(need.system, signal, async () => {
      if (need.session === "fresh") {
        await this.#closeSystem(need.system, "fresh-boundary");
      }
      const resource = await withoutBrowserActionNotes(() => this.#acquireBounded(need, instance, configFingerprint, browserMode, signal));
      let operationCompleted = false;
      const screenshotFailures: unknown[] = [];
      const poisonCloseFailures: unknown[] = [];
      try {
        this.#observe(resource, "unknown");
        resource.beginDiagnostics?.();
        const result = await withBrowserActionSession(resource.sessionId, () => use(resource.driver));
        resource.endDiagnostics?.();
        operationCompleted = true;
        await withBrowserActionSession(resource.sessionId, () => this.#captureLeaseScreenshot(resource, "succeeded", configFingerprint));
        await resource.reset({ signal });
        this.#observe(resource, "authenticated");
        this.#emit({
          type: "browser-session:reset",
          system: resource.system,
          sessionId: resource.sessionId,
        });
        return result;
      } catch (leaseError) {
        resource.endDiagnostics?.();
        const failures: unknown[] = [leaseError];
        if (!operationCompleted) {
          try {
            await withBrowserActionSession(resource.sessionId, () => this.#captureLeaseScreenshot(resource, "failed", configFingerprint));
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
    if (context === undefined || leaseOutcome === "succeeded" && context.captureBrowserScreenshots !== true) return;
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

  async closeForReset(input: WorkerResetBinding): Promise<WorkerControlClosure> {
    return this.#closeForControl(WorkerResetBindingSchema.parse(input));
  }

  async closeForRetirement(input: WorkerLifecycleBinding): Promise<WorkerControlClosure> {
    const binding = WorkerLifecycleBindingSchema.parse(input);
    if (binding.operation.kind !== "remove") throw new Error("worker-retirement-invalid-operation");
    return this.#closeForControl(binding);
  }

  async #closeForControl(binding: WorkerResetBinding | WorkerLifecycleBinding): Promise<WorkerControlClosure> {
    if (binding.member.workerId !== this.#workerId || this.#resetOwner === undefined
      || canonicalJsonStringify(this.#resetOwner) !== canonicalJsonStringify({ member: binding.member, lifetime: binding.lifetime })) throw new Error("worker-reset-closure-member-conflict");
    await this.closeAll("worker-stop");
    if (this.#resources.size !== 0 || this.#starting.size !== 0 || this.#tails.size !== 0 || this.#acquisitionCleanupFailures.size !== 0) throw new Error("worker-reset-closure-unproved");
    const epoch = this.#resetEpoch;
    return mintWorkerControlClosure(binding, [...this.#observedSessions], () => this.#resetEpoch === epoch
      && this.#resources.size === 0 && this.#starting.size === 0 && this.#tails.size === 0);
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
        ...this.#acquisitionCleanupFailures.keys(),
        ...this.#tails.keys(),
      ]);
      for (const system of systems) {
        const starting = this.#starting.get(system);
        try {
          await this.#withSystemTurn(
            system,
            new AbortController().signal,
            async () => {
              if (starting !== undefined) {
                const closing = new AbortController();
                const timeout = new Error(`${system} pending acquisition closure exceeded its ${this.#acquireDeadlineMs}ms bound; closure is unproved`);
                const handle = this.#scheduler.schedule(this.#clock.monotonicMs() + this.#acquireDeadlineMs, () => {
                  this.#poisoned.add(system);
                  this.#acquisitionCleanupFailures.set(system, timeout);
                  closing.abort(timeout);
                });
                try { await waitForAcquisition(starting, closing.signal, system); }
                catch (error) {
                  if (error === timeout) throw error;
                  if ((error instanceof BrowserSessionClosureUnprovedError || error instanceof DuoCeremonyReleaseFailedError)
                    && !this.#acquisitionCleanupFailures.has(system)) failures.push(error);
                } finally {
                  handle.cancel();
                }
              }
              await this.#closeSystem(system, reason);
              const cleanupFailure = this.#acquisitionCleanupFailures.get(system);
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
      throw new WorkerSessionClosureUnprovedError(this.#workerId, failures);
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
        expiry = new SessionAcquisitionTimeoutError(need.system, this.#acquireDeadlineMs);
        acquisition.abort(expiry);
      },
    );
    // The acquisition runs under the ACQUISITION signal, so a cooperative
    // login recipe aborts itself at the bound instead of only being raced.
    let staleRequestRecovered = false;
    const started = this.#getOrStart(need, instance, configFingerprint, browserMode, acquisition.signal, {
      deadlineMonotonicMs,
      cancel: (reason) => acquisition.abort(reason),
      claimStaleRequestRecovery: () => {
        if (staleRequestRecovered) return false;
        staleRequestRecovered = true;
        return true;
      },
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
      // Mark poison before closing and clear it only after proven closure; later leases must refuse uncertain ownership.
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
    const cleanupFailure = this.#acquisitionCleanupFailures.get(need.system);
    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (this.#poisoned.has(need.system)) {
      throw new Error(`${need.system} browser session has an unresolved failed-close proof`);
    }
    const existing = this.#resources.get(need.system);
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
    const pending = this.#starting.get(need.system);
    if (pending !== undefined) return pending;
    const started = this.#openAndLogin(need, instance, configFingerprint, browserMode, signal, envelope);
    this.#starting.set(need.system, started);
    try {
      return await started;
    } catch (error) {
      if (error instanceof DuoCeremonyReleaseFailedError
        || error instanceof BrowserSessionClosureUnprovedError && !this.#resources.has(need.system)) {
        this.#acquisitionCleanupFailures.set(need.system, error);
      }
      throw error;
    } finally {
      if (this.#starting.get(need.system) === started) this.#starting.delete(need.system);
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
    this.#resetEpoch += 1;
    const acquired = this.#onActivity?.("acquiring");
    let resource: WorkerBrowserResource;
    try {
    resource = await this.#factory.open({
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
      claimStaleRequestRecovery: envelope.claimStaleRequestRecovery,
      acquisitionRemainingMs: () => Math.max(0, envelope.deadlineMonotonicMs - this.#clock.monotonicMs()),
    });
    } finally { acquired?.(); }
    this.#observedSessions.add(resource.sessionId);
    this.#retained.set(resource.sessionId, { openedAt: this.#clock.now().toISOString(), factory: this.#factory, acquireMs: this.#acquireDeadlineMs, duo: this.#duoCeremony, defaultMode: this.#defaultBrowserMode });
    let login: LoginResult;
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
      try {
      login = LoginResultSchema.parse(await store.session.login(resource.authentication, {
        ...(instance === undefined ? {} : { instance }),
        signal,
      }));
      } finally { authenticated?.(); }
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
      if (exclusive && proof.exclusiveLeaseReleased !== true) {
        throw new Error(`${resource.system} close proof is missing exclusive identity-lease release`);
      }
      this.#observe(resource, "closed");
      proved = true;
      this.#retained.delete(resource.sessionId);
      this.#emit({
        type: "browser-session:close",
        system: resource.system,
        sessionId: resource.sessionId,
        reason,
      });
    } catch (error) {
      if (!proved) {
        try { this.#observe(resource, "failed"); }
        catch (observationError) { throw new AggregateError([error, observationError], "worker browser close and failure observation failed", { cause: observationError }); }
      }
      throw error;
    } finally { closed?.(); }
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
