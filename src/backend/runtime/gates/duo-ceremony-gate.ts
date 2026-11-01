import type { DuoSigningSource } from "../../storage/configuration/duo-signing.js";

import { createHash, randomUUID } from "node:crypto";
import type { DebugEvent } from "../../../models/events/timeline.js";
import { z } from "zod";
import type { DuoCeremonyGate, DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { Config } from "../../../models/config/schema.js";
import type { DuoCeremonyLeaseRecord } from "../../../rules/sessions/duo-ceremony-lease.js";
import { BrowserSystemIdSchema, FingerprintSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import type { BrowserSystemId, Fingerprint, WorkerId } from "../../../rules/identity/ids.js";
import { DuoTerminalRefusalError } from "../../systems/browser-shared/login-contract.js";
import type { DuoCeremonyLeaseRepository } from "../../storage/sqlite/authority-database.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";

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

// Aggregate release failures with ceremony failures; a failed release must not mask the login error.
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
  // Release is idempotent; pass an unwinding error so cleanup failure cannot mask it.
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
  onDebug?: (workerId: WorkerId, event: Pick<DebugEvent, "phase" | "correlationId"> & Partial<Pick<DebugEvent, "code" | "durationMs" | "pinned">>) => void;
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
      correlationId: randomUUID(),
      onDebug: event => input.onDebug?.(gateInput.workerId, event),
    }),
  };
  return Object.freeze(factory);
}

interface GateOptions {
  readonly correlationId: string;
  readonly onDebug: (event: Pick<DebugEvent, "phase" | "correlationId"> & Partial<Pick<DebugEvent, "code" | "durationMs" | "pinned">>) => void;
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
      this.#options.onDebug({ phase: "expired", correlationId: this.#options.correlationId, code: "duo-ceremony-lease-expired", pinned: true });
      cancelCeremony(new DuoCeremonyLeaseExpiredError(system, hold.token));
    });

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
      this.#options.onDebug({ phase: "failed", correlationId: this.#options.correlationId, code: "duo-terminal-refusal", pinned: true });
    } else {
      // A failing release must preserve the ceremony error it is unwinding.
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

  // Clear the held token only after release settles; failed cleanup must retain custody.
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
    this.#options.onDebug({ phase: "released", correlationId: this.#options.correlationId });
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
        this.#options.onDebug({ phase: "acquired", correlationId: this.#options.correlationId });
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

// Credential identity follows configured mode; resolution failure cannot select a different identity.
export function duoCeremonyCredentialKey(config: Config, duo?: DuoSigningSource): Fingerprint {
  if (config.features.duoWebAuthn) { if (duo === undefined) throw new Error("duo-signing-source-required"); duo.assertCurrent(); return duo.identity(); }
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:duo-credential-identity:v1\0hands-on\0")
    .update(config.actor.id)
    .digest("hex"));
}

/** The production composition: the one place the key, the leaves and the poll cadence meet. */
export function composeDuoCeremonyGateFactory(input: Readonly<{
  config: Config;
  duo?: DuoSigningSource;
  leases: DuoCeremonyLeaseRepository;
  clock: Clock;
  scheduler: MonotonicDeadlineScheduler;
  onDebug?: (workerId: WorkerId, event: Pick<DebugEvent, "phase" | "correlationId"> & Partial<Pick<DebugEvent, "code" | "durationMs" | "pinned">>) => void;
}>): DuoCeremonyGateFactory {
  return createDuoCeremonyGateFactory({
    leases: input.leases,
    credentialKey: duoCeremonyCredentialKey(input.config, input.duo),
    clock: input.clock,
    scheduler: input.scheduler,
    sessionAcquireMs: input.config.timeouts.sessionAcquireMs,
    graceMs: input.config.timeouts.duoCeremonyLeaseGraceMs,
    pollIntervalMs: DUO_CEREMONY_LEASE_POLL_MS,
    ...(input.onDebug === undefined ? {} : { onDebug: input.onDebug }),
  });
}
