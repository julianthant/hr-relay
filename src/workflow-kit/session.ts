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

// Unproved page/context closure poisons the retained resource.
export interface BrowserSessionCloseProof {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly pagesClosed: true;
  readonly contextClosed: true;
  readonly exclusiveLeaseReleased?: true;
}

export type BrowserSessionCloseReason =
  | "fresh-boundary"
  | "profile-reset"
  | "poisoned"
  | "parked"
  | "worker-stop"
  | "operator-reopen"
  | "login-failed";

export type BrowserScreenshotEvidence = Readonly<{
  pageVersion: number; sessionId: BrowserSessionId; observedAt: string;
  diagnosticAttachments?: readonly Readonly<{ kind: "console-summary" | "network-summary"; mediaType: string; bytes: Uint8Array; sensitivity: "redacted" }>[];
}> & (Readonly<{ state: "available"; bytes: Uint8Array; width: number; height: number }>
  | Readonly<{ state: "unavailable"; reason: "authentication-unverified" | "page-changed" | "page-closed" | "secret-controls-present" | "verification-failed" }>);

/** One authenticated worker-owned browser session for one system; the reuse identity (`instance`/`configFingerprint`/`browserMode`) records the exact instance and run-config it authenticated under. */
export interface WorkerBrowserResource {
  readonly sessionId: BrowserSessionId;
  readonly system: BrowserSystemId;
  readonly instance?: string;
  readonly configFingerprint: Fingerprint;
  readonly signInFingerprint: Fingerprint;
  /** Optional only for legacy fixture/session ports; real Playwright resources always report it. */
  readonly browserMode?: BrowserPresentationMode;
  readonly profileDirectory?: string;
  readonly profileRevision: number;
  readonly acceptDownloads: boolean;
  readonly exclusive: boolean;
  readonly authentication: BrowserAuthenticationHandle;
  readonly driver: BrowserDriver;
  /** A viewport PNG from the resource's owned page; never a raw Page or path. */
  readonly screenshot?: (sampleLabels?: readonly string[]) => Promise<BrowserScreenshotEvidence>;
  readonly beginDiagnostics?: () => void;
  readonly endDiagnostics?: () => void;
  readonly reset: (input: Readonly<{ signal: AbortSignal }>) => Promise<void>;
  readonly close: (input: Readonly<{ reason: BrowserSessionCloseReason }>) =>
    Promise<BrowserSessionCloseProof>;
}

export class BrowserSessionClosureUnprovedError extends AggregateError {
  constructor(errors: readonly unknown[], message: string, options?: ErrorOptions) {
    super(errors, message, options);
    this.name = "BrowserSessionClosureUnprovedError";
  }
}

/** The one concrete browser-creation port: the worker session manager is its only caller; implementations own launch, profile isolation, auth dispatch and provable teardown. */
export interface WorkerBrowserSessionFactory {
  readonly probeProfile: (input: Readonly<{ workerId: WorkerId; system: BrowserSystemId; instance?: string; browserMode?: BrowserPresentationMode; signal: AbortSignal }>) => Promise<void>;
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
    /** The Duo ceremony lease gate for this acquisition: the manager opens one per acquisition and holds it across the fresh-profile-once retry, so it is an input. */
    duoCeremony: DuoCeremonyGate;
    acquisitionRemainingMs?: () => number;
    claimStaleRequestRecovery?: () => boolean;
  }>) => Promise<WorkerBrowserResource>;
// Duo refusal burns the profile; recreate it before the single retry.
  readonly discardProfile?: (input: Readonly<{
    workerId: WorkerId;
    system: BrowserSystemId;
    instance?: string;
    configFingerprint: Fingerprint;
    browserMode?: BrowserPresentationMode;
  }>) => Promise<Readonly<{ profileDirectory: string }>>;
}

interface SessionLoginOptions {
  readonly instance?: string;
  readonly signal?: AbortSignal;
}

/** Authentication belongs to the worker-owned browser resource, not a task: a factory supplies this handle after opening its isolated context, and each system provider owns the login recipe. */
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
      throw new Error(`${system} session login is declared but unwired`);
    },
  });
}

/** The runtime session provider: small by design — browser/context creation stays with the worker session factory, and the provider performs one bounded authentication against that handle. */
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
