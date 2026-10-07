import { z } from "zod";
import type { DuoCeremonyGate } from "./duo-ceremony-lease.js";
import { BrowserSystemIdSchema } from "../rules/identity/ids.js";
import type {
  BrowserSessionId,
  BrowserSystemId,
  Fingerprint,
  WorkerId,
  WorkflowId,
} from "../rules/identity/ids.js";
import type { BrowserPresentationMode } from "../models/run/envelope.js";
import {
  IdleRefreshCadenceSchema,
  LoginResultSchema,
} from "../models/sessions/session.js";
import type { IdleRefreshCadence, LoginResult } from "../models/sessions/session.js";
import type { BrowserDriver } from "./task.js";

/**
 * Proof that a worker browser resource is REALLY gone. Every field is a
 * required literal on the success path: a close that cannot assert page and
 * context closure must throw instead of returning a weaker proof, and the
 * session manager then retains the resource as poisoned (ref execution-and-sessions §4).
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
  | "operator-reopen"
  | "login-failed";

/**
 * One authenticated worker-owned browser session for one system (ref execution-and-sessions §1).
 * The D116 reuse identity is part of the resource itself: `instance` and
 * `configFingerprint` and `browserMode` record exactly which resolved instance and immutable
 * run-config snapshot the session was authenticated under.
 */
export interface WorkerBrowserResource {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly instance?: string;
  readonly configFingerprint: Fingerprint;
  /** Optional only for legacy fixture/session ports; real Playwright resources always report it. */
  readonly browserMode?: BrowserPresentationMode;
  readonly profileDirectory?: string;
  readonly acceptDownloads: boolean;
  readonly exclusive: boolean;
  readonly authentication: BrowserAuthenticationHandle;
  readonly driver: BrowserDriver;
  /** A viewport PNG from the resource's owned page; never a raw Page or path. */
  readonly screenshot?: () => Promise<Readonly<{
    bytes: Uint8Array;
    width: number;
    height: number;
  }>>;
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
    browserMode?: BrowserPresentationMode;
    acceptDownloads: boolean;
    exclusive: boolean;
    signal: AbortSignal;
    /**
     * D267 (ref execution-and-sessions §10): the Duo ceremony lease gate for
     * this acquisition. The factory hands it to the login recipe's context;
     * the worker session manager opens one gate per acquisition and HOLDS it
     * across the fresh-profile-once retry, which is why it is an input rather
     * than something the factory mints.
     */
    duoCeremony: DuoCeremonyGate;
  }>) => Promise<WorkerBrowserResource>;
  /**
   * D267 §10.5: remove and recreate the SAME profile directory after Duo
   * refused the assertion (a refused profile is burned). Optional on the
   * port because a fixture factory has no directory; the manager REFUSES the
   * recovery by name when a factory that observed a refusal lacks it — it
   * never skips the retry silently.
   */
  readonly discardProfile?: (input: Readonly<{
    workerId: WorkerId;
    system: BrowserSystemId;
    instance?: string;
    configFingerprint: Fingerprint;
    browserMode?: BrowserPresentationMode;
  }>) => Promise<Readonly<{ profileDirectory: string }>>;
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
