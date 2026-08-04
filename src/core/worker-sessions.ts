/**
 * Worker-local browser ownership (doc 05 §§2,4,6.1).
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
} from "../base/session.js";
import type { BrowserDriver } from "../base/task.js";
import type { Clock } from "../domain/clock.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../domain/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  Fingerprint,
  WorkerId,
  WorkflowId,
} from "../domain/ids.js";
import { LoginResultSchema, SessionNeedSchema } from "../domain/session.js";
import type { LoginResult, SessionNeed } from "../domain/session.js";
import type { RegisteredTaskStore, TaskStoreRegistry } from "../base/store.js";

export type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../base/session.js";

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
  readonly onEvent?: (event: WorkerSessionEvent) => void;
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
 * The bind/release half of D116 (doc 11 §4) as a first-class surface: the
 * caller that OWNS a run context — the worker loop for its claimed run, doc 09
 * §4 recovery for a target run's out-of-loop probe lease — binds that run's
 * retained immutable `configFingerprint` for exactly the duration of the
 * operation and releases it afterwards, success or failure.
 */
export interface RunConfigFingerprintBinding {
  bindRunConfigFingerprint(fingerprint: Fingerprint): void;
  releaseRunConfigFingerprint(): void;
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
): Promise<Result> {
  sessions.bindRunConfigFingerprint(fingerprint);
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
  readonly #factory: WorkerBrowserSessionFactory;
  readonly #clock: Clock;
  readonly #scheduler: MonotonicDeadlineScheduler;
  readonly #acquireDeadlineMs: number;
  readonly #onEvent: (event: WorkerSessionEvent) => void;
  readonly #resources = new Map<BrowserSystemId, WorkerBrowserResource>();
  readonly #poisoned = new Set<BrowserSystemId>();
  readonly #starting = new Map<BrowserSystemId, Promise<WorkerBrowserResource>>();
  readonly #tails = new Map<BrowserSystemId, Promise<void>>();
  #closingReason: "parked" | "worker-stop" | undefined;
  #runConfigFingerprint: Fingerprint | undefined;

  constructor(options: WorkerSessionManagerOptions) {
    this.#workerId = WorkerIdSchema.parse(options.workerId);
    this.#workflowId = WorkflowIdSchema.parse(options.workflowId);
    this.#stores = options.stores;
    this.#factory = options.factory;
    this.#clock = options.clock;
    this.#scheduler = options.scheduler;
    this.#acquireDeadlineMs = z.number().int().positive().parse(options.acquireDeadlineMs);
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  activeSystems(): readonly BrowserSystemId[] {
    return Object.freeze([...this.#resources.keys()]);
  }

  /**
   * D116 (doc 11 §4): the worker loop binds the claimed run's immutable
   * `configFingerprint` before any task executes, making the fingerprint part
   * of the session lookup identity rather than evidence metadata. Exactly one
   * run is bound at a time — a second bind without a release is a programming
   * error and fails loud.
   */
  bindRunConfigFingerprint(fingerprint: Fingerprint): void {
    const parsed = FingerprintSchema.parse(fingerprint);
    if (this.#runConfigFingerprint !== undefined) {
      throw new Error(
        `worker ${this.#workerId} already has a bound run config fingerprint; one worker owns one active run`,
      );
    }
    this.#runConfigFingerprint = parsed;
  }

  releaseRunConfigFingerprint(): void {
    if (this.#runConfigFingerprint === undefined) {
      throw new Error(`worker ${this.#workerId} has no bound run config fingerprint to release`);
    }
    this.#runConfigFingerprint = undefined;
  }

  async withDriver<Result>(
    needInput: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (driver: BrowserDriver) => Promise<Result>,
  ): Promise<Result> {
    const need = SessionNeedSchema.parse(needInput);
    if (this.#closingReason !== undefined) {
      throw new Error(
        `${need.system} driver lease cannot start while worker sessions are closing for ${this.#closingReason}`,
      );
    }
    const configFingerprint = this.#runConfigFingerprint;
    if (configFingerprint === undefined) {
      throw new Error(
        `${need.system} driver lease requires the claimed run's bound config fingerprint (D116); none is bound`,
      );
    }
    return this.#withSystemTurn(need.system, signal, async () => {
      if (need.session === "fresh") {
        await this.#closeSystem(need.system, "fresh-boundary");
      }
      const resource = await this.#acquireBounded(need, instance, configFingerprint, signal);
      try {
        const result = await waitForOperation(
          Promise.resolve().then(() => operation(resource.driver)),
          signal,
          need.system,
        );
        try {
          await resource.reset({ signal });
          this.#emit({
            type: "browser-session:reset",
            system: resource.system,
            sessionId: resource.sessionId,
          });
        } catch (resetError) {
          try {
            await this.#closeSystem(need.system, "poisoned");
          } catch (closeError) {
            throw new AggregateError(
              [resetError, closeError],
              `${need.system} reset and poison-close both failed`,
              { cause: closeError },
            );
          }
          throw resetError;
        }
        return result;
      } catch (operationError) {
        if (this.#resources.get(need.system) === resource) {
          try {
            await this.#closeSystem(need.system, "poisoned");
          } catch (closeError) {
            throw new AggregateError(
              [operationError, closeError],
              `${need.system} operation and poison-close both failed`,
              { cause: closeError },
            );
          }
        }
        throw operationError;
      }
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
    signal: AbortSignal,
  ): Promise<WorkerBrowserResource> {
    const acquisition = new AbortController();
    const forwardAbort = (): void => {
      acquisition.abort(signal.reason instanceof Error ? signal.reason : abortError(need.system));
    };
    if (signal.aborted) forwardAbort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    let expiry: Error | undefined;
    const handle = this.#scheduler.schedule(
      this.#clock.monotonicMs() + this.#acquireDeadlineMs,
      () => {
        expiry = acquisitionDeadlineError(need.system, this.#acquireDeadlineMs);
        acquisition.abort(expiry);
      },
    );
    // The acquisition runs under the ACQUISITION signal, so a cooperative
    // login recipe aborts itself at the bound instead of only being raced.
    const started = this.#getOrStart(need, instance, configFingerprint, acquisition.signal);
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
    signal: AbortSignal,
  ): Promise<WorkerBrowserResource> {
    if (this.#poisoned.has(need.system)) {
      throw new Error(`${need.system} browser session has an unresolved failed-close proof`);
    }
    const existing = this.#resources.get(need.system);
    if (existing !== undefined) {
      // D116 (doc 11 §4, doc 05 §7): reuse requires the COMPLETE identity —
      // worker (this manager), system, resolved instance, AND the run's
      // config fingerprint. Any drift proves the old context closed (a forced
      // fresh boundary) before a replacement is authenticated; a context
      // configured under another run snapshot is never reused.
      if (existing.instance !== instance || existing.configFingerprint !== configFingerprint) {
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
    const started = this.#openAndLogin(need, instance, configFingerprint, signal);
    this.#starting.set(need.system, started);
    try {
      return await started;
    } finally {
      if (this.#starting.get(need.system) === started) this.#starting.delete(need.system);
    }
  }

  async #openAndLogin(
    need: SessionNeed,
    instance: string | undefined,
    configFingerprint: Fingerprint,
    signal: AbortSignal,
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
      acceptDownloads: need.acceptDownloads === true,
      exclusive,
      signal,
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
      if (resource.instance !== instance
        || resource.configFingerprint !== configFingerprint
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
