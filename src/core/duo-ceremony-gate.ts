/**
 * The Duo ceremony gate — the per-acquisition handle through which ONE login
 * recipe takes, holds and releases the per-credential ceremony lease
 * (ref execution-and-sessions §10, D267).
 *
 * The lease ROW lives in authority (`worker_auth`); the TOKEN is minted
 * only by that store; this module is the WAITER and the HOLDER logic around
 * them, kernel-scheduled on the same monotonic clock that arms the acquisition
 * envelope (D125):
 *
 * - **Bounded waiters (§10.4).** A waiter's budget is what remains of its own
 *   `sessionAcquireMs` envelope MINUS the grace, so the lease refuses FIRST —
 *   naming the holder's worker id, system and `expiresAt` — instead of the
 *   envelope firing with §4.3's hands-on-approval message. The refusal is a
 *   typed error, never a retry loop.
 * - **TTL and supersession (§10.3).** The holder arms its own TTL deadline; if
 *   it fires while the ceremony is in flight the ceremony is CANCELLED through
 *   the acquisition's abort channel, because a waiter may now take the lease at
 *   the next generation and an assertion presented under a superseded
 *   generation is exactly the overlapping ceremony the lease exists to prevent.
 *   A release that finds the row already moved on is reported by the store
 *   and thrown here, loudly.
 * - **Fresh-profile-once (§10.5).** Duo's terminal refusal (the ONE error class
 *   the recovery keys on) leaves the lease HELD across the worker's
 *   poison-close + profile recreation + single retry; the second refusal
 *   releases it. Releasing between the two would let another worker start a
 *   ceremony against a credential that has just seen a cloned-key signal.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { DuoCeremonyGate, DuoCeremonyLeaseToken } from "../base/duo-ceremony-lease.js";
import type { Clock } from "../domain/clock.js";
import type { Config } from "../domain/config/schema.js";
import type { DuoCeremonyLeaseRecord } from "../domain/duo-ceremony-lease.js";
import { BrowserSystemIdSchema, FingerprintSchema, WorkerIdSchema } from "../domain/ids.js";
import type { BrowserSystemId, Fingerprint, WorkerId } from "../domain/ids.js";
import { resolveSecretFileIdentity } from "../domain/secrets.js";
import { DuoTerminalRefusalError } from "../infra/browser/login-contract.js";
import type { DuoCeremonyLeaseRepository } from "../infra/sqlite/authority-database.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";

/** §10.4 — another worker holds the ceremony for this credential, and the budget is spent. */
export class DuoCeremonyLeaseHeldError extends Error {
  readonly system: BrowserSystemId;
  readonly holder: Readonly<{ workerId: WorkerId; system: BrowserSystemId; generation: number; expiresAt: string }>;

  constructor(system: BrowserSystemId, holder: DuoCeremonyLeaseRecord, budgetMs: number) {
    super(
      `${system} login refused: another worker holds the Duo ceremony for this credential — `
      + `worker ${holder.holder.workerId} (${holder.holder.system}), generation ${String(holder.generation)}, `
      + `until ${holder.expiresAt}. This worker waited its whole budget (${String(budgetMs)}ms = the remaining `
      + "timeouts.sessionAcquireMs envelope minus timeouts.duoCeremonyLeaseGraceMs) and refuses BEFORE its "
      + "envelope fires; it is not retried here. One credential admits one Duo ceremony at a time "
      + "(ref execution-and-sessions §10) — a second one in the same second is the cloned-key signal that burns a profile.",
    );
    this.name = "DuoCeremonyLeaseHeldError";
    this.system = system;
    this.holder = Object.freeze({
      workerId: holder.holder.workerId,
      system: holder.holder.system,
      generation: holder.generation,
      expiresAt: holder.expiresAt,
    });
  }
}

/** §10.3 — this holder's lease TTL elapsed before the verifier returned. */
export class DuoCeremonyLeaseExpiredError extends Error {
  constructor(system: BrowserSystemId, token: DuoCeremonyLeaseToken) {
    super(
      `${system} login abandoned: this worker's Duo ceremony lease (generation ${String(token.generation)}) `
      + `expired at ${token.expiresAt} before the content verifier returned, so a waiter may now hold the `
      + "credential at the next generation. The ceremony is cancelled and the session is poison-closed rather "
      + "than presenting an assertion under a superseded lease (ref execution-and-sessions §10.3).",
    );
    this.name = "DuoCeremonyLeaseExpiredError";
  }
}

/**
 * Finding 1 (review, ref execution-and-sessions §10.4): the lease STORE's `release` call itself
 * threw (a transient DB failure, never the ordinary `superseded` report) while `#release` was
 * unwinding an earlier ceremony error — from `withCeremony`'s `threw` arm or from `dispose()` in a
 * caller's `finally`. That earlier error must not be silently replaced by this one: it is preserved
 * as `cause`, and its own message is folded into `releaseError` for callers that want it directly.
 * The lease's `#hold` is deliberately left SET when this is thrown (`release` was never confirmed),
 * so a later `dispose()`/`release` retries the UPDATE instead of stranding the row `held` for its
 * full TTL with nothing left to retry it.
 */
export class DuoCeremonyReleaseFailedError extends Error {
  readonly releaseError: unknown;

  constructor(system: BrowserSystemId, releaseError: unknown, unwindingError: unknown) {
    const detail = releaseError instanceof Error ? releaseError.message : String(releaseError);
    super(
      `${system} Duo ceremony lease release failed (${detail}) while unwinding an earlier ceremony `
      + "error; the lease row is left HELD (not cleared) so a later dispose()/release retries the "
      + "UPDATE, and the original ceremony error is preserved as this error's cause rather than "
      + "replaced by the release failure (ref execution-and-sessions §10.4).",
      { cause: unwindingError },
    );
    this.name = "DuoCeremonyReleaseFailedError";
    this.releaseError = releaseError;
  }
}

export interface DuoCeremonyGateHandle extends DuoCeremonyGate {
  /** True between Duo's FIRST terminal refusal and the single retry: the lease is held, not released. */
  retainedForRecovery(): boolean;
  /**
   * Releases any lease still held (a retained one whose recovery never ran).
   * Idempotent. Pass `unwindingError` when this call is itself unwinding an
   * earlier error (a `catch`/`finally` propagating a ceremony failure): if
   * the store's `release` throws, that original error is preserved as the
   * thrown `DuoCeremonyReleaseFailedError`'s `cause` instead of being
   * silently replaced (finding 1, ref execution-and-sessions §10.4).
   */
  dispose(unwindingError?: unknown): void;
}

export interface DuoCeremonyGateFactory {
  openGate(input: Readonly<{
    workerId: WorkerId;
    system: BrowserSystemId;
    /** The monotonic instant this acquisition's `sessionAcquireMs` envelope fires. */
    envelopeDeadlineMonotonicMs: number;
    /** The acquisition's abort channel: how a TTL expiry cancels an in-flight ceremony. */
    cancelCeremony: (reason: Error) => void;
    signal: AbortSignal;
  }>): DuoCeremonyGateHandle;
}

const GateFactoryInputSchema = z.strictObject({
  credentialKey: FingerprintSchema,
  sessionAcquireMs: z.number().int().positive(),
  graceMs: z.number().int().positive(),
  pollIntervalMs: z.number().int().positive(),
}).refine((input) => input.graceMs < input.sessionAcquireMs, {
  message: "timeouts.duoCeremonyLeaseGraceMs must be smaller than timeouts.sessionAcquireMs, or no waiter has any budget",
});

/**
 * The cadence at which a waiter re-asks authority for the lease. It is a
 * parameter rather than a config leaf because it decides nothing about the
 * outcome — the budget and the TTL do — only how soon after a release the
 * next worker notices.
 */
export const DUO_CEREMONY_LEASE_POLL_MS = 250;

export function createDuoCeremonyGateFactory(input: Readonly<{
  leases: DuoCeremonyLeaseRepository;
  /** The credential identity digest (`resolveSecretFileIdentity`), resolved ONCE at composition. */
  credentialKey: Fingerprint;
  clock: Clock;
  scheduler: MonotonicDeadlineScheduler;
  sessionAcquireMs: number;
  graceMs: number;
  pollIntervalMs: number;
}>): DuoCeremonyGateFactory {
  const parsed = GateFactoryInputSchema.parse({
    credentialKey: input.credentialKey,
    sessionAcquireMs: input.sessionAcquireMs,
    graceMs: input.graceMs,
    pollIntervalMs: input.pollIntervalMs,
  });
  const ttlMs = parsed.sessionAcquireMs + parsed.graceMs;
  const factory: DuoCeremonyGateFactory = {
    openGate: (gateInput) => new Gate({
      leases: input.leases,
      clock: input.clock,
      scheduler: input.scheduler,
      credentialKey: parsed.credentialKey,
      ttlMs,
      graceMs: parsed.graceMs,
      pollIntervalMs: parsed.pollIntervalMs,
      workerId: WorkerIdSchema.parse(gateInput.workerId),
      system: BrowserSystemIdSchema.parse(gateInput.system),
      envelopeDeadlineMonotonicMs: gateInput.envelopeDeadlineMonotonicMs,
      cancelCeremony: gateInput.cancelCeremony,
      signal: gateInput.signal,
    }),
  };
  return Object.freeze(factory);
}

interface GateOptions {
  readonly leases: DuoCeremonyLeaseRepository;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly credentialKey: Fingerprint;
  readonly ttlMs: number;
  readonly graceMs: number;
  readonly pollIntervalMs: number;
  readonly workerId: WorkerId;
  readonly system: BrowserSystemId;
  readonly envelopeDeadlineMonotonicMs: number;
  readonly cancelCeremony: (reason: Error) => void;
  readonly signal: AbortSignal;
}

type Settled<Result> =
  | Readonly<{ state: "returned"; value: Result }>
  | Readonly<{ state: "threw"; error: unknown }>;

interface Hold {
  readonly token: DuoCeremonyLeaseToken;
  readonly lease: DuoCeremonyLeaseRecord;
  readonly expiresAtMonotonicMs: number;
}

function abortReason(signal: AbortSignal, system: BrowserSystemId): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`${system} Duo ceremony lease wait was aborted`);
}

class Gate implements DuoCeremonyGateHandle {
  readonly #options: GateOptions;
  #hold: Hold | undefined;
  #refusals = 0;
  #disposed = false;

  constructor(options: GateOptions) {
    this.#options = options;
  }

  async withCeremony<Result>(run: (token: DuoCeremonyLeaseToken) => Promise<Result>): Promise<Result> {
    const { system, clock, scheduler, cancelCeremony } = this.#options;
    if (this.#disposed) throw new Error(`${system} Duo ceremony gate was disposed; a recipe cannot reuse it`);
    if (this.#hold === undefined) {
      this.#hold = await this.#acquire();
    } else if (clock.monotonicMs() >= this.#hold.expiresAtMonotonicMs) {
      const expired = new DuoCeremonyLeaseExpiredError(system, this.#hold.token);
      this.#release({ value: expired });
      throw expired;
    }
    const hold = this.#hold;
    const ttl = scheduler.schedule(hold.expiresAtMonotonicMs, () => {
      cancelCeremony(new DuoCeremonyLeaseExpiredError(system, hold.token));
    });
    // The ceremony's settlement is captured as DATA so the decision that
    // follows — keep the lease for §10.5's single retry, or release it — reads
    // as one branch, and the error is rethrown unchanged either way.
    const settled = await run(hold.token).then(
      (value): Settled<Result> => ({ state: "returned", value }),
      (error: unknown): Settled<Result> => ({ state: "threw", error }),
    );
    ttl.cancel();
    if (settled.state === "returned") {
      this.#release();
      return settled.value;
    }
    if (settled.error instanceof DuoTerminalRefusalError && this.#refusals === 0) {
      // §10.5: the FIRST terminal refusal keeps the lease for the single
      // fresh-profile retry. A second one releases.
      this.#refusals = 1;
    } else {
      // Finding 1: this release is unwinding `settled.error`. If the store's
      // release itself throws, that must not silently replace the ceremony's
      // own error — see `#release`.
      this.#release({ value: settled.error });
    }
    throw settled.error;
  }

  retainedForRecovery(): boolean {
    return this.#hold !== undefined && this.#refusals === 1;
  }

  dispose(unwindingError?: unknown): void {
    this.#disposed = true;
    if (this.#hold !== undefined) {
      this.#release(unwindingError === undefined ? undefined : { value: unwindingError });
    }
  }

  /**
   * Finding 1 (ref execution-and-sessions §10.4): `#hold` is cleared only AFTER `leases.release`
   * returns without throwing — never before. If the store's `release` call itself throws (not the
   * ordinary `superseded` report, which IS a returned outcome), `#hold` stays set so the row is
   * still retryable, and — when this release is unwinding an earlier ceremony error — the thrown
   * `DuoCeremonyReleaseFailedError` carries that original error as `cause` instead of replacing it.
   */
  #release(unwindingError?: Readonly<{ value: unknown }>): void {
    const hold = this.#hold;
    if (hold === undefined) return;
    const { leases, clock, system } = this.#options;
    let outcome: ReturnType<DuoCeremonyLeaseRepository["release"]>;
    try {
      outcome = leases.release({ token: hold.token, now: clock.now().toISOString() });
    } catch (releaseError) {
      if (unwindingError !== undefined) {
        throw new DuoCeremonyReleaseFailedError(system, releaseError, unwindingError.value);
      }
      throw releaseError;
    }
    this.#hold = undefined;
    if (outcome.state === "superseded") {
      throw new Error(
        `${system} Duo ceremony lease generation ${String(hold.token.generation)} was superseded by `
        + `generation ${String(outcome.current.generation)} (worker ${outcome.current.holder.workerId}, `
        + `${outcome.current.holder.system}) while this worker still held it; the ceremonies may have overlapped `
        + "(ref execution-and-sessions §10.3)",
      );
    }
  }

  async #acquire(): Promise<Hold> {
    const { leases, clock, credentialKey, ttlMs, graceMs, pollIntervalMs, workerId, system, signal } = this.#options;
    const budgetDeadline = this.#options.envelopeDeadlineMonotonicMs - graceMs;
    const started = clock.monotonicMs();
    for (;;) {
      if (signal.aborted) throw abortReason(signal, system);
      const now = clock.monotonicMs();
      const outcome = leases.acquire({
        credentialKey, workerId, system, now: clock.now().toISOString(), ttlMs,
      });
      if (outcome.state === "acquired") {
        return Object.freeze({ token: outcome.token, lease: outcome.lease, expiresAtMonotonicMs: now + ttlMs });
      }
      if (now >= budgetDeadline) {
        throw new DuoCeremonyLeaseHeldError(system, outcome.holder, Math.max(0, budgetDeadline - started));
      }
      await this.#sleepUntil(Math.min(now + pollIntervalMs, budgetDeadline));
    }
  }

  #sleepUntil(deadlineMonotonicMs: number): Promise<void> {
    const { scheduler, signal, system } = this.#options;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        handle.cancel();
        reject(abortReason(signal, system));
      };
      const handle = scheduler.schedule(deadlineMonotonicMs, () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve();
      });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/**
 * The credential identity the lease is keyed on (§10.1), decided by the MODE
 * the configuration declares — never by whether a resolution succeeded:
 *
 * - `features.duoWebAuthn` ON (the shipped default): the Duo Autopilot
 *   credential file's identity, a digest over its public `(rpId, credentialId)`
 *   pairs resolved through `domain/secrets.ts`. Unresolvable THROWS.
 * - OFF (a hands-on Duo deployment): there is no Autopilot counter, so no
 *   cloned-key hazard — but one human approves one prompt at a time, and the
 *   human IS the credential, so the key is derived from the configured actor.
 *
 * Neither arm is a fallback for the other: a per-worker key would be the
 * unserialized behaviour wearing a lease's name, and this never mints one.
 */
export function duoCeremonyCredentialKey(config: Config): Fingerprint {
  if (config.features.duoWebAuthn) return resolveSecretFileIdentity("duoWebauthnCredential", config);
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:duo-credential-identity:v1\0hands-on\0")
    .update(config.actor.id)
    .digest("hex"));
}

/** The production composition: the one place the key, the leaves and the poll cadence meet. */
export function composeDuoCeremonyGateFactory(input: Readonly<{
  config: Config;
  leases: DuoCeremonyLeaseRepository;
  clock: Clock;
  scheduler: MonotonicDeadlineScheduler;
}>): DuoCeremonyGateFactory {
  return createDuoCeremonyGateFactory({
    leases: input.leases,
    credentialKey: duoCeremonyCredentialKey(input.config),
    clock: input.clock,
    scheduler: input.scheduler,
    sessionAcquireMs: input.config.timeouts.sessionAcquireMs,
    graceMs: input.config.timeouts.duoCeremonyLeaseGraceMs,
    pollIntervalMs: DUO_CEREMONY_LEASE_POLL_MS,
  });
}
