/**
 * Worker-local browser ownership (doc 05 §§2,4,6.1).
 *
 * Drivers are exposed only inside `withDriver`'s awaited callback. A system is
 * serialized within one worker, a clean release resets before reuse, and every
 * uncertain release poison-closes the resource. An authored `fresh` need
 * closes the old resource before the replacement can emit `start`.
 */
import type { BrowserAuthenticationHandle } from "../base/session.js";
import type { BrowserDriver } from "../base/task.js";
import type { Clock } from "../domain/clock.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  IsoInstantSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../domain/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  WorkerId,
  WorkflowId,
} from "../domain/ids.js";
import { SessionNeedSchema } from "../domain/session.js";
import type { SessionNeed } from "../domain/session.js";
import type { RegisteredTaskStore, TaskStoreRegistry } from "../base/store.js";

export interface BrowserSessionCloseProof {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly pagesClosed: true;
  readonly contextClosed: true;
  readonly exclusiveLeaseReleased?: true;
}

export interface WorkerBrowserResource {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly instance?: string;
  readonly acceptDownloads: boolean;
  readonly exclusive: boolean;
  readonly authentication: BrowserAuthenticationHandle;
  readonly driver: BrowserDriver;
  readonly reset: (input: Readonly<{ signal: AbortSignal }>) => Promise<void>;
  readonly close: (input: Readonly<{ reason: BrowserSessionCloseReason }>) =>
    Promise<BrowserSessionCloseProof>;
}

export interface WorkerBrowserSessionFactory {
  readonly open: (input: Readonly<{
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    instance?: string;
    acceptDownloads: boolean;
    exclusive: boolean;
    signal: AbortSignal;
  }>) => Promise<WorkerBrowserResource>;
}

export type BrowserSessionCloseReason =
  | "fresh-boundary"
  | "poisoned"
  | "parked"
  | "worker-stop"
  | "login-failed";

export type WorkerSessionEvent =
  | Readonly<{
    type: "browser-session:start";
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    sessionId: BrowserSessionId;
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
    type: "browser-session:start" | "browser-session:reset";
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

export class WorkerSessionManager {
  readonly #workerId: WorkerId;
  readonly #workflowId: WorkflowId;
  readonly #stores: TaskStoreRegistry;
  readonly #factory: WorkerBrowserSessionFactory;
  readonly #clock: Clock;
  readonly #onEvent: (event: WorkerSessionEvent) => void;
  readonly #resources = new Map<BrowserSystemId, WorkerBrowserResource>();
  readonly #poisoned = new Set<BrowserSystemId>();
  readonly #starting = new Map<BrowserSystemId, Promise<WorkerBrowserResource>>();
  readonly #tails = new Map<BrowserSystemId, Promise<void>>();
  #closingReason: "parked" | "worker-stop" | undefined;

  constructor(options: WorkerSessionManagerOptions) {
    this.#workerId = WorkerIdSchema.parse(options.workerId);
    this.#workflowId = WorkflowIdSchema.parse(options.workflowId);
    this.#stores = options.stores;
    this.#factory = options.factory;
    this.#clock = options.clock;
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  activeSystems(): readonly BrowserSystemId[] {
    return Object.freeze([...this.#resources.keys()]);
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
    return this.#withSystemTurn(need.system, signal, async () => {
      if (need.session === "fresh") {
        await this.#closeSystem(need.system, "fresh-boundary");
      }
      const resource = await this.#getOrStart(need, instance, signal);
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

  async #getOrStart(
    need: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
  ): Promise<WorkerBrowserResource> {
    if (this.#poisoned.has(need.system)) {
      throw new Error(`${need.system} browser session has an unresolved failed-close proof`);
    }
    const existing = this.#resources.get(need.system);
    if (existing !== undefined) {
      if (existing.instance !== instance) {
        throw new Error(
          `${need.system} reuse requested instance ${String(instance)} but the worker session owns ${String(existing.instance)}`,
        );
      }
      if (need.acceptDownloads === true && !existing.acceptDownloads) {
        throw new Error(`${need.system} reused session was not opened with download acceptance`);
      }
      if (existing.exclusive !== (need.exclusive === true)) {
        throw new Error(`${need.system} reused session exclusivity disagrees with the task need`);
      }
      return existing;
    }
    const pending = this.#starting.get(need.system);
    if (pending !== undefined) return pending;
    const started = this.#openAndLogin(need, instance, signal);
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
      acceptDownloads: need.acceptDownloads === true,
      exclusive,
      signal,
    });
    try {
      BrowserSessionIdSchema.parse(resource.sessionId);
      BrowserSystemIdSchema.parse(resource.system);
      if (resource.system !== need.system || resource.driver.system !== need.system) {
        throw new Error(
          `${need.system} session factory returned resource ${resource.system} with driver ${resource.driver.system}`,
        );
      }
      if (resource.instance !== instance
        || resource.acceptDownloads !== (need.acceptDownloads === true)
        || resource.exclusive !== exclusive) {
        throw new Error(`${need.system} session factory returned a resource with mismatched launch options`);
      }
      await store.session.login(resource.authentication, {
        ...(instance === undefined ? {} : { instance }),
        signal,
      });
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
    this.#onEvent({ ...common, type: event.type });
  }
}
