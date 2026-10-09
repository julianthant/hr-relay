
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MonotonicDeadlineScheduler } from "../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import {
  createDuoCeremonyGateFactory,
  DUO_CEREMONY_LEASE_POLL_MS,
} from "../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import type { DuoCeremonyGateFactory, DuoCeremonyGateHandle } from "../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import { FingerprintSchema, WorkerIdSchema } from "../../../src/rules/identity/ids.js";
import type { BrowserSystemId, WorkerId } from "../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "./synthetic-database-admission.js";

export const FIXTURE_DUO_CREDENTIAL_KEY = FingerprintSchema.parse("d0".repeat(32));

export const FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS = 60_000;
export const FIXTURE_DUO_LEASE_GRACE_MS = 20_000;

const realScheduler: MonotonicDeadlineScheduler = {
  schedule(deadlineMonotonicMs, onDeadline) {
    const handle = setTimeout(onDeadline, Math.max(0, deadlineMonotonicMs - systemClock.monotonicMs()));
    return { cancel: () => { clearTimeout(handle); } };
  },
};

export function openDuoCeremonyLeaseDatabase(clock: Clock): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-duo-lease-fixture-"));
  return AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
}


export function fixtureDuoCeremonyGates(
  clock: Clock = systemClock,
  scheduler: MonotonicDeadlineScheduler = realScheduler,
): DuoCeremonyGateFactory {
  let real: DuoCeremonyGateFactory | undefined;
  const lazy: DuoCeremonyGateFactory = {
    openGate: (input) => {
      real ??= duoCeremonyGatesOver(openDuoCeremonyLeaseDatabase(clock), clock, scheduler);
      return real.openGate(input);
    },
  };
  return Object.freeze(lazy);
}

export function duoCeremonyGatesOver(
  database: AuthorityDatabase,
  clock: Clock,
  scheduler: MonotonicDeadlineScheduler,
  options: Readonly<{ sessionAcquireMs?: number; graceMs?: number; pollIntervalMs?: number }> = {},
): DuoCeremonyGateFactory {
  return createDuoCeremonyGateFactory({
    leases: database.authority.duoCeremonyLeases,
    credentialKey: FIXTURE_DUO_CREDENTIAL_KEY,
    clock,
    scheduler,
    sessionAcquireMs: options.sessionAcquireMs ?? FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
    graceMs: options.graceMs ?? FIXTURE_DUO_LEASE_GRACE_MS,
    pollIntervalMs: options.pollIntervalMs ?? DUO_CEREMONY_LEASE_POLL_MS,
  });
}

/** One open gate for a recipe test that drives `defineVerifiedLoginRecipe` directly. */
export function fixtureDuoCeremonyGate(
  system: BrowserSystemId,
  workerId: WorkerId = WorkerIdSchema.parse("recipe-fixture-worker"),
  clock: Clock = systemClock,
): DuoCeremonyGateHandle {
  return fixtureDuoCeremonyGates(clock).openGate({
    workerId,
    system,
    envelopeDeadlineMonotonicMs: clock.monotonicMs() + FIXTURE_DUO_LEASE_SESSION_ACQUIRE_MS,
    cancelCeremony: () => undefined,
    signal: new AbortController().signal,
  });
}
