import { z } from "zod";
import { BrowserSystemIdSchema } from "../domain/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  Fingerprint,
  WorkerId,
  WorkflowId,
} from "../domain/ids.js";
import {
  IdleRefreshCadenceSchema,
  LoginResultSchema,
} from "../domain/session.js";
import type { IdleRefreshCadence, LoginResult } from "../domain/session.js";
import type { BrowserDriver } from "./task.js";

/**
 * Proof that a worker browser resource is REALLY gone. Every field is a
 * required literal on the success path: a close that cannot assert page and
 * context closure must throw instead of returning a weaker proof, and the
 * session manager then retains the resource as poisoned (doc 05 §4).
 */
export interface BrowserSessionCloseProof {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly pagesClosed: true;
  readonly contextClosed: true;
  readonly exclusiveLeaseReleased?: true;
}

export type BrowserSessionCloseReason =
  | "fresh-boundary"
  | "poisoned"
  | "parked"
  | "worker-stop"
  | "login-failed";

/**
 * One authenticated worker-owned browser session for one system (doc 05 §1).
 * The D116 reuse identity is part of the resource itself: `instance` and
 * `configFingerprint` record exactly which resolved instance and immutable
 * run-config snapshot the session was authenticated under.
 */
export interface WorkerBrowserResource {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly instance?: string;
  readonly configFingerprint: Fingerprint;
  readonly acceptDownloads: boolean;
  readonly exclusive: boolean;
  readonly authentication: BrowserAuthenticationHandle;
  readonly driver: BrowserDriver;
  readonly reset: (input: Readonly<{ signal: AbortSignal }>) => Promise<void>;
  readonly close: (input: Readonly<{ reason: BrowserSessionCloseReason }>) =>
    Promise<BrowserSessionCloseProof>;
}

/**
 * The one concrete browser-creation port. The worker session manager is the
 * only caller (driver-lease-boundary guard); implementations own launch,
 * profile isolation, authentication dispatch, and provable teardown.
 */
export interface WorkerBrowserSessionFactory {
  readonly open: (input: Readonly<{
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    instance?: string;
    configFingerprint: Fingerprint;
    acceptDownloads: boolean;
    exclusive: boolean;
    signal: AbortSignal;
  }>) => Promise<WorkerBrowserResource>;
}

export interface SessionLoginOptions {
  readonly instance?: string;
  readonly signal?: AbortSignal;
}

/**
 * Authentication belongs to the worker-owned browser resource, not to a task.
 * A concrete browser factory supplies this handle after opening its isolated
 * context; each system provider owns the corresponding login recipe.
 */
export interface BrowserAuthenticationHandle {
  readonly authenticate: (
    system: BrowserSystemId,
    options: SessionLoginOptions,
  ) => Promise<LoginResult>;
}

export interface SessionProvider<S extends BrowserSystemId, Handle = unknown> {
  readonly system: S;
  readonly login: (handle: Handle, options: SessionLoginOptions) => Promise<LoginResult>;
  readonly prepareLogin?: (handle: Handle) => Promise<void>;
  readonly resetUrl?: string;
  readonly idleRefresh?: IdleRefreshCadence;
  readonly exclusive?: true;
}

const SessionProviderRuntimeSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  login: z.custom<SessionProvider<BrowserSystemId>["login"]>((value) => typeof value === "function"),
  prepareLogin: z.custom<NonNullable<SessionProvider<BrowserSystemId>["prepareLogin"]>>(
    (value) => typeof value === "function",
  ).optional(),
  resetUrl: z.url().optional(),
  idleRefresh: IdleRefreshCadenceSchema.optional(),
  exclusive: z.literal(true).optional(),
});

export function defineSessionProvider<S extends BrowserSystemId, Handle>(
  provider: SessionProvider<S, Handle>,
): SessionProvider<S, Handle> {
  SessionProviderRuntimeSchema.parse(provider);
  if (provider.system === "onbase" && provider.exclusive !== true) {
    throw new Error("onbase session provider must declare exclusive:true");
  }
  if (provider.system !== "onbase" && provider.exclusive === true) {
    throw new Error(`${provider.system} session provider cannot declare exclusive:true`);
  }
  return Object.freeze({ ...provider });
}

export function defineUnwiredSessionProvider<S extends BrowserSystemId>(
  system: S,
  options: Readonly<{ exclusive?: true }> = {},
): SessionProvider<S> {
  return defineSessionProvider({
    system,
    ...options,
    async login() {
      throw new Error(`${system} session login is declared but unwired in Phase 1d`);
    },
  });
}

/**
 * The Phase-1f runtime provider. It is intentionally small: browser/context
 * creation stays with the worker session factory, while the provider performs
 * exactly one bounded authentication against that owned handle.
 */
export function defineWorkerSessionProvider<S extends BrowserSystemId>(
  system: S,
  options: Readonly<{
    exclusive?: true;
    resetUrl?: string;
    idleRefresh?: IdleRefreshCadence;
  }> = {},
): SessionProvider<S, BrowserAuthenticationHandle> {
  return defineSessionProvider({
    system,
    ...options,
    async login(handle, loginOptions) {
      if (loginOptions.signal?.aborted === true) {
        throw new Error(`${system} session login was aborted before authentication`);
      }
      return LoginResultSchema.parse(await handle.authenticate(system, loginOptions));
    },
  });
}

export interface DeterministicSessionHarness<S extends BrowserSystemId> {
  readonly provider: SessionProvider<S>;
  readonly calls: () => readonly SessionLoginOptions[];
}

export function createDeterministicSessionProvider<S extends BrowserSystemId>(
  system: S,
  results: readonly LoginResult[],
  options: Readonly<{ exclusive?: true }> = {},
): DeterministicSessionHarness<S> {
  const queue = results.map((result) => LoginResultSchema.parse(result));
  const calls: SessionLoginOptions[] = [];
  const provider = defineSessionProvider({
    system,
    ...options,
    async login(_handle, loginOptions) {
      calls.push(Object.freeze({ ...loginOptions }));
      const result = queue.shift();
      if (result === undefined) throw new Error(`${system} deterministic session has no queued login result`);
      return result;
    },
  });
  return Object.freeze({
    provider,
    calls: () => Object.freeze(calls.map((call) => Object.freeze({ ...call }))),
  });
}
